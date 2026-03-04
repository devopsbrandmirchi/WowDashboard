import os, sys, json, time
from datetime import datetime, timedelta
from collections import defaultdict

sys.stdout.reconfigure(line_buffering=True)

# Load .env if running locally
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

print(f"Starting cache refresh at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Installing psycopg2-binary...")
    os.system(f"{sys.executable} -m pip install psycopg2-binary")
    import psycopg2
    import psycopg2.extras

conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

# Set long timeout for this session
cur.execute("SET statement_timeout = '600s';")

print("Connected to database directly!")

# Count total records
cur.execute("SELECT COUNT(*) as total FROM vimeo_subscriptions;")
total = cur.fetchone()["total"]
print(f"Total records in table: {total}")

print("\n" + "=" * 60)
print("STEP 1: All-time KPIs (single query)...")
print("=" * 60)

cur.execute("""
    SELECT 
        COUNT(*) FILTER(WHERE status='enabled') AS total_active,
        COUNT(*) AS total_records,
        COUNT(*) FILTER(WHERE status='canceled') AS total_canceled,
        COUNT(*) FILTER(WHERE trial_started_date IS NOT NULL) AS total_trials,
        COUNT(*) FILTER(WHERE converted_trial IS NOT NULL AND converted_trial!='') AS total_converted,
        COALESCE(SUM(CASE 
            WHEN status='enabled' AND frequency='monthly' THEN subscription_price 
            WHEN status='enabled' AND frequency='yearly' THEN subscription_price/12 
            ELSE 0 END), 0) AS total_mrr,
        COALESCE(SUM(lifetime_value), 0) AS total_ltv
    FROM vimeo_subscriptions;
""")
row = cur.fetchone()
all_time = {k: float(v) if v else 0 for k, v in row.items()}
print(f"  Active: {int(all_time['total_active'])} | Records: {int(all_time['total_records'])} | MRR: {all_time['total_mrr']:.2f}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('all_time', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(all_time)])
print("  SAVED: all_time")

print("\n" + "=" * 60)
print("STEP 2: Country breakdown...")
print("=" * 60)

cur.execute("""
    SELECT 
        COALESCE(country,'Unknown') AS country,
        COUNT(*) FILTER(WHERE status='enabled') AS active,
        COUNT(*) FILTER(WHERE status='canceled') AS canceled,
        COUNT(*) FILTER(WHERE trial_started_date IS NOT NULL) AS trials,
        COALESCE(SUM(lifetime_value),0) AS revenue,
        COALESCE(AVG(subscription_price),0) AS avg_price
    FROM vimeo_subscriptions 
    GROUP BY COALESCE(country,'Unknown') 
    ORDER BY active DESC LIMIT 50;
""")
country_list = [dict(r) for r in cur.fetchall()]
for c in country_list:
    c["revenue"] = float(c["revenue"])
    c["avg_price"] = float(c["avg_price"])
    c["active"] = int(c["active"])
    c["canceled"] = int(c["canceled"])
    c["trials"] = int(c["trials"])
print(f"  Countries: {len(country_list)} | Top: {country_list[0]['country'] if country_list else 'none'}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_country', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(country_list)])
print("  SAVED: by_country")

print("\n" + "=" * 60)
print("STEP 3: Plan breakdown...")
print("=" * 60)

cur.execute("""
    SELECT 
        COALESCE(current_plan,'Unknown') AS plan,
        COUNT(*) FILTER(WHERE status='enabled') AS active,
        COUNT(*) FILTER(WHERE status='canceled') AS canceled,
        COALESCE(SUM(lifetime_value),0) AS revenue,
        COALESCE(AVG(subscription_price),0) AS avg_price
    FROM vimeo_subscriptions 
    GROUP BY COALESCE(current_plan,'Unknown') 
    ORDER BY active DESC;
""")
plan_list = [dict(r) for r in cur.fetchall()]
for p in plan_list:
    p["revenue"] = float(p["revenue"])
    p["avg_price"] = float(p["avg_price"])
    p["active"] = int(p["active"])
    p["canceled"] = int(p["canceled"])
print(f"  Plans: {len(plan_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_plan', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(plan_list)])
print("  SAVED: by_plan")

print("\n" + "=" * 60)
print("STEP 4: Platform breakdown...")
print("=" * 60)

cur.execute("""
    SELECT 
        COALESCE(platform,'Unknown') AS platform,
        COUNT(*) AS total,
        COUNT(*) FILTER(WHERE status='enabled') AS active
    FROM vimeo_subscriptions 
    GROUP BY COALESCE(platform,'Unknown') 
    ORDER BY total DESC;
""")
platform_list = [dict(r) for r in cur.fetchall()]
for p in platform_list:
    p["total"] = int(p["total"])
    p["active"] = int(p["active"])
print(f"  Platforms: {len(platform_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_platform', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(platform_list)])
print("  SAVED: by_platform")

print("\n" + "=" * 60)
print("STEP 5: Churn reasons...")
print("=" * 60)

cur.execute("""
    SELECT 
        COALESCE(cancel_reason_category,'Unknown') AS reason,
        COUNT(*) AS total
    FROM vimeo_subscriptions 
    WHERE status='canceled' 
    GROUP BY COALESCE(cancel_reason_category,'Unknown') 
    ORDER BY total DESC LIMIT 20;
""")
reason_list = [dict(r) for r in cur.fetchall()]
for r in reason_list:
    r["total"] = int(r["total"])
print(f"  Churn reasons: {len(reason_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_churn_reason', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(reason_list)])
print("  SAVED: by_churn_reason")

print("\n" + "=" * 60)
print("STEP 6: Monthly breakdown (last 12 months)...")
print("=" * 60)

cur.execute("""
    SELECT 
        to_char(m.month, 'YYYY-MM') AS month,
        COALESCE(ns.c, 0) AS new_subscribers,
        COALESCE(ca.c, 0) AS cancellations,
        COALESCE(ts.c, 0) AS trials_started,
        COALESCE(tc.c, 0) AS trial_conversions,
        COALESCE(rv.s, 0) AS revenue
    FROM generate_series(
        date_trunc('month', NOW() - INTERVAL '11 months'),
        date_trunc('month', NOW()),
        '1 month'
    ) AS m(month)
    LEFT JOIN (
        SELECT date_trunc('month', date_became_enabled) AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE date_became_enabled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) ns ON ns.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', date_last_canceled) AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE date_last_canceled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) ca ON ca.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', trial_started_date) AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE trial_started_date >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) ts ON ts.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', date_became_enabled) AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE converted_trial IS NOT NULL AND converted_trial != '' 
        AND date_became_enabled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) tc ON tc.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', date_became_enabled) AS dt, COALESCE(SUM(subscription_price), 0) AS s 
        FROM vimeo_subscriptions WHERE date_became_enabled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) rv ON rv.dt = m.month
    ORDER BY m.month;
""")
monthly_list = [dict(r) for r in cur.fetchall()]
for m in monthly_list:
    m["new_subscribers"] = int(m["new_subscribers"])
    m["cancellations"] = int(m["cancellations"])
    m["trials_started"] = int(m["trials_started"])
    m["trial_conversions"] = int(m["trial_conversions"])
    m["revenue"] = float(m["revenue"])
print(f"  Months: {len(monthly_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('monthly', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(monthly_list)])
print("  SAVED: monthly")

print("\n" + "=" * 60)
print("STEP 7: Daily breakdown (last 90 days)...")
print("=" * 60)

cur.execute("""
    SELECT 
        d.day::text AS day,
        COALESCE(ns.c, 0) AS new_subscribers,
        COALESCE(ca.c, 0) AS cancellations,
        COALESCE(ts.c, 0) AS trials_started,
        COALESCE(tc.c, 0) AS trial_conversions,
        COALESCE(rv.s, 0) AS revenue
    FROM generate_series(
        (NOW() - INTERVAL '90 days')::date,
        CURRENT_DATE,
        '1 day'
    ) AS d(day)
    LEFT JOIN (
        SELECT date_became_enabled::date AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE date_became_enabled >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) ns ON ns.dt = d.day
    LEFT JOIN (
        SELECT date_last_canceled::date AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE date_last_canceled >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) ca ON ca.dt = d.day
    LEFT JOIN (
        SELECT trial_started_date::date AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE trial_started_date >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) ts ON ts.dt = d.day
    LEFT JOIN (
        SELECT date_became_enabled::date AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE converted_trial IS NOT NULL AND converted_trial != '' 
        AND date_became_enabled >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) tc ON tc.dt = d.day
    LEFT JOIN (
        SELECT date_became_enabled::date AS dt, COALESCE(SUM(subscription_price), 0) AS s 
        FROM vimeo_subscriptions WHERE date_became_enabled >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) rv ON rv.dt = d.day
    ORDER BY d.day;
""")
daily_list = [dict(r) for r in cur.fetchall()]
for d in daily_list:
    d["new_subscribers"] = int(d["new_subscribers"])
    d["cancellations"] = int(d["cancellations"])
    d["trials_started"] = int(d["trials_started"])
    d["trial_conversions"] = int(d["trial_conversions"])
    d["revenue"] = float(d["revenue"])
print(f"  Days: {len(daily_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('daily', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(daily_list)])
print("  SAVED: daily")

cur.close()
conn.close()

print(f"\n{'=' * 60}")
print(f"ALL DONE at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"Total records in table: {total}")
print("Completed in direct SQL — no row-by-row fetching needed!")
print("=" * 60)