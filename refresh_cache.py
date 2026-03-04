import os, sys, json
from datetime import datetime

try:
    import psycopg2
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2

sys.stdout.reconfigure(line_buffering=True)

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: Missing DATABASE_URL")
    sys.exit(1)

print(f"Starting cache refresh at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")

PLAN_FILTER = "current_plan IN ('Standard Tier', 'All Access Tier')"

def upsert_cache(conn, metric_name, metric_data):
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO subscription_kpi_cache (metric_name, metric_value, metric_data, updated_at)
        VALUES (%s, 0, %s, NOW())
        ON CONFLICT (metric_name) DO UPDATE
        SET metric_data = EXCLUDED.metric_data, updated_at = NOW()
    """, (metric_name, json.dumps(metric_data)))
    conn.commit()
    cur.close()
    print(f"  Upserted: {metric_name}")

def rows_to_list(cur):
    cols = [d[0] for d in cur.description]
    result = []
    for row in cur.fetchall():
        obj = {}
        for i in range(len(cols)):
            v = row[i]
            if v is None:
                obj[cols[i]] = 0
            elif isinstance(v, (int, float)):
                obj[cols[i]] = round(float(v), 2)
            else:
                obj[cols[i]] = str(v)
        result.append(obj)
    return result

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()
cur.execute("SET statement_timeout = '300s'")
conn.commit()

# ============================================================
# 1. ACTIVE SUBSCRIBERS SNAPSHOT
# ============================================================
print("\n[1/6] Active subscribers snapshot...")
cur.execute(f"""
    SELECT
        COUNT(*) AS total_active,
        COUNT(*) FILTER (WHERE current_plan = 'Standard Tier') AS standard_tier,
        COUNT(*) FILTER (WHERE current_plan = 'All Access Tier') AS all_access_tier,
        COUNT(*) FILTER (WHERE frequency = 'monthly') AS monthly,
        COUNT(*) FILTER (WHERE frequency = 'yearly') AS yearly,
        COUNT(*) FILTER (WHERE frequency = 'custom') AS custom
    FROM vimeo_subscriptions
    WHERE {PLAN_FILTER} AND status = 'enabled'
""")
row = cur.fetchone()
cols = [d[0] for d in cur.description]
active_snapshot = {cols[i]: round(float(row[i]), 2) if row[i] else 0 for i in range(len(cols))}
print(f"  total_active={active_snapshot['total_active']:.0f}")
upsert_cache(conn, 'active_snapshot', active_snapshot)

# ============================================================
# 2. ACTIVE TRIALS SNAPSHOT
# ============================================================
print("\n[2/6] Active trials snapshot...")
cur.execute(f"""
    SELECT
        COUNT(*) AS total_active_trials
    FROM vimeo_subscriptions
    WHERE {PLAN_FILTER} AND status = 'free_trial'
""")
row = cur.fetchone()
trials_snapshot = {'total_active_trials': round(float(row[0]), 2) if row[0] else 0}
print(f"  active_trials={trials_snapshot['total_active_trials']:.0f}")
upsert_cache(conn, 'trials_snapshot', trials_snapshot)

# ============================================================
# 3. ACTIVE BY COUNTRY (top 50)
# ============================================================
print("\n[3/6] Active by country...")
cur.execute(f"""
    SELECT
        COALESCE(country, 'Unknown') AS country,
        COUNT(*) AS active,
        COUNT(*) FILTER (WHERE frequency = 'monthly') AS monthly,
        COUNT(*) FILTER (WHERE frequency = 'yearly') AS yearly
    FROM vimeo_subscriptions
    WHERE {PLAN_FILTER} AND status = 'enabled'
    GROUP BY COALESCE(country, 'Unknown')
    ORDER BY active DESC
    LIMIT 50
""")
by_country = rows_to_list(cur)
print(f"  {len(by_country)} countries")
upsert_cache(conn, 'hs_by_country', by_country)

# ============================================================
# 4. ACTIVE BY PLATFORM
# ============================================================
print("\n[4/6] Active by platform...")
cur.execute(f"""
    SELECT
        COALESCE(platform, 'Unknown') AS platform,
        COUNT(*) AS active,
        COUNT(*) FILTER (WHERE frequency = 'monthly') AS monthly,
        COUNT(*) FILTER (WHERE frequency = 'yearly') AS yearly
    FROM vimeo_subscriptions
    WHERE {PLAN_FILTER} AND status = 'enabled'
    GROUP BY COALESCE(platform, 'Unknown')
    ORDER BY active DESC
""")
by_platform = rows_to_list(cur)
print(f"  {len(by_platform)} platforms")
upsert_cache(conn, 'hs_by_platform', by_platform)

# ============================================================
# 5. TRIALS STARTED BY MONTH
# ============================================================
print("\n[5/6] Trials by month...")
cur.execute(f"""
    SELECT
        date_trunc('month', trial_started_date)::date::text AS month,
        COUNT(*) AS trials_started,
        COUNT(*) FILTER (WHERE converted_trial = 'true') AS converted,
        COUNT(*) FILTER (WHERE status = 'free_trial') AS still_on_trial,
        COUNT(*) FILTER (WHERE status = 'enabled') AS now_active
    FROM vimeo_subscriptions
    WHERE {PLAN_FILTER}
      AND trial_started_date IS NOT NULL
    GROUP BY 1
    ORDER BY 1
""")
trials_monthly = rows_to_list(cur)
for t in trials_monthly:
    print(f"  {t['month']}: started={t['trials_started']:.0f} converted={t['converted']:.0f} active={t['now_active']:.0f}")
upsert_cache(conn, 'hs_trials_monthly', trials_monthly)

# ============================================================
# 6. STATUS BREAKDOWN
# ============================================================
print("\n[6/6] Status breakdown...")
cur.execute(f"""
    SELECT
        status,
        COUNT(*) AS total
    FROM vimeo_subscriptions
    WHERE {PLAN_FILTER}
    GROUP BY status
    ORDER BY total DESC
""")
by_status = rows_to_list(cur)
for s in by_status:
    print(f"  {s['status']}: {s['total']:.0f}")
upsert_cache(conn, 'hs_by_status', by_status)

# ============================================================
cur.close()
conn.close()
print(f"\nCache refresh complete at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
print(f"Active subs: {active_snapshot['total_active']:.0f}")
print(f"Active trials: {trials_snapshot['total_active_trials']:.0f}")