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
    os.system(f"{sys.executable} -m pip install psycopg2-binary")
    import psycopg2
    import psycopg2.extras

conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute("SET statement_timeout = '600s';")

print("Connected to database!")

cur.execute("SELECT COUNT(*) as total FROM vimeo_subscriptions;")
total = cur.fetchone()["total"]
print(f"Total records: {total}")

# ============================================================
print("\nSTEP 1: All-time KPIs...")
# ============================================================

cur.execute("""
    SELECT 
        COUNT(*) FILTER(WHERE status='enabled') AS total_active,
        COUNT(*) AS total_records,
        COUNT(*) FILTER(WHERE status='cancelled') AS total_cancelled,
        COUNT(*) FILTER(WHERE status='expired') AS total_expired,
        COUNT(*) FILTER(WHERE status='disabled') AS total_disabled,
        COUNT(*) FILTER(WHERE status='refunded') AS total_refunded,
        COUNT(*) FILTER(WHERE status='paused') AS total_paused,
        COUNT(*) FILTER(WHERE status='free_trial') AS total_free_trial,
        COUNT(*) FILTER(WHERE status IN ('cancelled','expired','disabled','refunded')) AS total_churned,
        COUNT(*) FILTER(WHERE trial_started_date IS NOT NULL) AS total_trials_by_date,
        COUNT(*) FILTER(WHERE status='free_trial') AS total_trials_by_status,
        COUNT(*) FILTER(WHERE converted_trial='true') AS total_converted,
        COALESCE(SUM(CASE 
            WHEN status='enabled' AND frequency='monthly' THEN subscription_price 
            WHEN status='enabled' AND frequency='yearly' THEN subscription_price/12 
            WHEN status='enabled' AND frequency='custom' THEN subscription_price
            ELSE 0 END), 0) AS total_mrr,
        COALESCE(SUM(lifetime_value), 0) AS total_ltv,
        COALESCE(AVG(subscription_price) FILTER(WHERE status='enabled'), 0) AS avg_revenue_per_sub
    FROM vimeo_subscriptions;
""")
row = cur.fetchone()
all_time = {
    "total_active": int(row["total_active"]),
    "total_records": int(row["total_records"]),
    "total_cancelled": int(row["total_cancelled"]),
    "total_expired": int(row["total_expired"]),
    "total_disabled": int(row["total_disabled"]),
    "total_refunded": int(row["total_refunded"]),
    "total_paused": int(row["total_paused"]),
    "total_free_trial": int(row["total_free_trial"]),
    "total_churned": int(row["total_churned"]),
    "total_trials": int(row["total_trials_by_date"]) + int(row["total_trials_by_status"]),
    "total_converted": int(row["total_converted"]),
    "total_mrr": round(float(row["total_mrr"]), 2),
    "total_ltv": round(float(row["total_ltv"]), 2),
    "avg_revenue_per_sub": round(float(row["avg_revenue_per_sub"]), 2)
}
print(f"  Active: {all_time['total_active']} | Cancelled: {all_time['total_cancelled']} | Expired: {all_time['total_expired']}")
print(f"  Trials: {all_time['total_trials']} | Converted: {all_time['total_converted']} | MRR: {all_time['total_mrr']}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('all_time', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(all_time)])
print("  SAVED: all_time")

# ============================================================
print("\nSTEP 2: Status breakdown...")
# ============================================================

cur.execute("""
    SELECT status, COUNT(*) AS total
    FROM vimeo_subscriptions
    GROUP BY status ORDER BY total DESC;
""")
status_list = [{"status": r["status"] or "unknown", "total": int(r["total"])} for r in cur.fetchall()]

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_status', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(status_list)])
print(f"  Statuses: {len(status_list)}")
print("  SAVED: by_status")

# ============================================================
print("\nSTEP 3: Country breakdown...")
# ============================================================

cur.execute("""
    SELECT 
        COALESCE(country,'Unknown') AS country,
        COUNT(*) AS total,
        COUNT(*) FILTER(WHERE status='enabled') AS active,
        COUNT(*) FILTER(WHERE status='cancelled') AS cancelled,
        COUNT(*) FILTER(WHERE status='expired') AS expired,
        COUNT(*) FILTER(WHERE trial_started_date IS NOT NULL OR status='free_trial') AS trials,
        COUNT(*) FILTER(WHERE converted_trial='true') AS converted,
        COALESCE(SUM(lifetime_value),0) AS revenue,
        COALESCE(AVG(subscription_price),0) AS avg_price
    FROM vimeo_subscriptions 
    GROUP BY COALESCE(country,'Unknown') 
    ORDER BY active DESC LIMIT 50;
""")
country_list = []
for r in cur.fetchall():
    country_list.append({
        "country": r["country"], "total": int(r["total"]),
        "active": int(r["active"]), "cancelled": int(r["cancelled"]),
        "expired": int(r["expired"]), "trials": int(r["trials"]),
        "converted": int(r["converted"]),
        "revenue": round(float(r["revenue"]), 2),
        "avg_price": round(float(r["avg_price"]), 2)
    })
print(f"  Countries: {len(country_list)} | Top: {country_list[0]['country'] if country_list else 'none'}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_country', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(country_list)])
print("  SAVED: by_country")

# ============================================================
print("\nSTEP 4: Plan breakdown...")
# ============================================================

cur.execute("""
    SELECT 
        COALESCE(current_plan,'Unknown') AS plan,
        COUNT(*) AS total,
        COUNT(*) FILTER(WHERE status='enabled') AS active,
        COUNT(*) FILTER(WHERE status='cancelled') AS cancelled,
        COUNT(*) FILTER(WHERE status='expired') AS expired,
        COALESCE(SUM(lifetime_value),0) AS revenue,
        COALESCE(AVG(subscription_price),0) AS avg_price
    FROM vimeo_subscriptions 
    GROUP BY COALESCE(current_plan,'Unknown') 
    ORDER BY active DESC;
""")
plan_list = []
for r in cur.fetchall():
    plan_list.append({
        "plan": r["plan"], "total": int(r["total"]),
        "active": int(r["active"]), "cancelled": int(r["cancelled"]),
        "expired": int(r["expired"]),
        "revenue": round(float(r["revenue"]), 2),
        "avg_price": round(float(r["avg_price"]), 2)
    })
print(f"  Plans: {len(plan_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_plan', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(plan_list)])
print("  SAVED: by_plan")

# ============================================================
print("\nSTEP 5: Platform breakdown...")
# ============================================================

cur.execute("""
    SELECT 
        COALESCE(platform,'Unknown') AS platform,
        COUNT(*) AS total,
        COUNT(*) FILTER(WHERE status='enabled') AS active,
        COUNT(*) FILTER(WHERE status='cancelled') AS cancelled
    FROM vimeo_subscriptions 
    GROUP BY COALESCE(platform,'Unknown') 
    ORDER BY total DESC;
""")
platform_list = []
for r in cur.fetchall():
    platform_list.append({
        "platform": r["platform"], "total": int(r["total"]),
        "active": int(r["active"]), "cancelled": int(r["cancelled"])
    })
print(f"  Platforms: {len(platform_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_platform', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(platform_list)])
print("  SAVED: by_platform")

# ============================================================
print("\nSTEP 6: Churn reasons...")
# ============================================================

cur.execute("""
    SELECT 
        COALESCE(cancel_reason_category,'Unknown') AS reason,
        COUNT(*) AS total
    FROM vimeo_subscriptions 
    WHERE status IN ('cancelled','expired','disabled','refunded')
    GROUP BY COALESCE(cancel_reason_category,'Unknown') 
    ORDER BY total DESC LIMIT 20;
""")
reason_list = [{"reason": r["reason"], "total": int(r["total"])} for r in cur.fetchall()]
print(f"  Churn reasons: {len(reason_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_churn_reason', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(reason_list)])
print("  SAVED: by_churn_reason")

# ============================================================
print("\nSTEP 7: Frequency breakdown...")
# ============================================================

cur.execute("""
    SELECT 
        COALESCE(frequency,'Unknown') AS frequency,
        COUNT(*) AS total,
        COUNT(*) FILTER(WHERE status='enabled') AS active,
        COALESCE(AVG(subscription_price),0) AS avg_price,
        COALESCE(SUM(lifetime_value),0) AS revenue
    FROM vimeo_subscriptions 
    GROUP BY COALESCE(frequency,'Unknown') 
    ORDER BY total DESC;
""")
freq_list = []
for r in cur.fetchall():
    freq_list.append({
        "frequency": r["frequency"], "total": int(r["total"]),
        "active": int(r["active"]),
        "avg_price": round(float(r["avg_price"]), 2),
        "revenue": round(float(r["revenue"]), 2)
    })
print(f"  Frequencies: {len(freq_list)}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('by_frequency', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(freq_list)])
print("  SAVED: by_frequency")

# ============================================================
print("\nSTEP 8: Monthly breakdown (last 12 months)...")
# ============================================================

cur.execute("""
    SELECT 
        to_char(m.month, 'YYYY-MM') AS month,
        COALESCE(ns.c, 0) AS new_subscribers,
        COALESCE(ca.c, 0) AS cancellations,
        COALESCE(ex.c, 0) AS expirations,
        COALESCE(ts.c, 0) AS trials_started,
        COALESCE(ft.c, 0) AS free_trial_starts,
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
        FROM vimeo_subscriptions WHERE status='cancelled' AND date_last_canceled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) ca ON ca.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', date_last_canceled) AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE status='expired' AND date_last_canceled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) ex ON ex.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', trial_started_date) AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE trial_started_date >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) ts ON ts.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', date_became_enabled) AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE status='free_trial' AND date_became_enabled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) ft ON ft.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', date_became_enabled) AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE converted_trial='true' AND date_became_enabled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) tc ON tc.dt = m.month
    LEFT JOIN (
        SELECT date_trunc('month', date_became_enabled) AS dt, COALESCE(SUM(subscription_price), 0) AS s 
        FROM vimeo_subscriptions WHERE date_became_enabled >= NOW() - INTERVAL '12 months' GROUP BY dt
    ) rv ON rv.dt = m.month
    ORDER BY m.month;
""")
monthly_list = []
for r in cur.fetchall():
    monthly_list.append({
        "month": r["month"],
        "new_subscribers": int(r["new_subscribers"]),
        "cancellations": int(r["cancellations"]),
        "expirations": int(r["expirations"]),
        "trials_started": int(r["trials_started"]) + int(r["free_trial_starts"]),
        "trial_conversions": int(r["trial_conversions"]),
        "revenue": round(float(r["revenue"]), 2)
    })
print(f"  Months: {len(monthly_list)}")
for m in monthly_list:
    print(f"    {m['month']}: new={m['new_subscribers']} cancel={m['cancellations']} expire={m['expirations']} trials={m['trials_started']} conv={m['trial_conversions']} rev=${m['revenue']:.0f}")

cur.execute("""
    INSERT INTO subscription_kpi_cache (metric_name, metric_data) 
    VALUES ('monthly', %s::jsonb)
    ON CONFLICT (metric_name) DO UPDATE SET metric_data=EXCLUDED.metric_data, updated_at=NOW();
""", [json.dumps(monthly_list)])
print("  SAVED: monthly")

# ============================================================
print("\nSTEP 9: Daily breakdown (last 90 days)...")
# ============================================================

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
        FROM vimeo_subscriptions WHERE status IN ('cancelled','expired') AND date_last_canceled >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) ca ON ca.dt = d.day
    LEFT JOIN (
        SELECT trial_started_date::date AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE trial_started_date >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) ts ON ts.dt = d.day
    LEFT JOIN (
        SELECT date_became_enabled::date AS dt, COUNT(*) AS c 
        FROM vimeo_subscriptions WHERE converted_trial='true' AND date_became_enabled >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) tc ON tc.dt = d.day
    LEFT JOIN (
        SELECT date_became_enabled::date AS dt, COALESCE(SUM(subscription_price), 0) AS s 
        FROM vimeo_subscriptions WHERE date_became_enabled >= NOW() - INTERVAL '90 days' GROUP BY dt
    ) rv ON rv.dt = d.day
    ORDER BY d.day;
""")
daily_list = []
for r in cur.fetchall():
    daily_list.append({
        "day": r["day"],
        "new_subscribers": int(r["new_subscribers"]),
        "cancellations": int(r["cancellations"]),
        "trials_started": int(r["trials_started"]),
        "trial_conversions": int(r["trial_conversions"]),
        "revenue": round(float(r["revenue"]), 2)
    })
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
print(f"Total records: {total}")
print("Cache entries: all_time, by_status, by_country, by_plan, by_platform, by_churn_reason, by_frequency, monthly, daily")
print("=" * 60)