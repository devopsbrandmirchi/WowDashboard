import os, requests, time
from datetime import datetime, timedelta
from collections import defaultdict

# Load .env if running locally
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing SUPABASE_URL or SUPABASE_KEY")
    exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

def upsert_cache(metric_name, metric_data):
    url = f"{SUPABASE_URL}/rest/v1/subscription_kpi_cache"
    row = {"metric_name": metric_name, "metric_data": metric_data}
    resp = requests.post(url, headers=HEADERS, json=[row], timeout=300)
    if resp.status_code in (200, 201):
        print(f"  OK: {metric_name}")
        return True
    else:
        print(f"  ERROR {resp.status_code}: {resp.text[:200]}")
        return False

def fetch_all_rows(fields):
    url = f"{SUPABASE_URL}/rest/v1/vimeo_subscriptions"
    all_rows = []
    offset = 0
    batch = 1000
    while True:
        resp = requests.get(url, headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json"
        }, params={"select": fields, "offset": offset, "limit": batch}, timeout=120)
        if resp.status_code != 200:
            print(f"  Fetch error: {resp.status_code}")
            break
        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        offset += batch
        if len(all_rows) % 10000 == 0:
            print(f"    fetched {len(all_rows)}...")
        if len(rows) < batch:
            break
    print(f"  Total: {len(all_rows)} rows")
    return all_rows

print("=" * 60)
print(f"REFRESHING KPI CACHE - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
print("=" * 60)

# Fetch all data in one pass
print("\nFetching all records...")
fields = "status,frequency,subscription_price,lifetime_value,trial_started_date,converted_trial,country,current_plan,platform,cancel_reason_category,date_became_enabled,date_last_canceled"
rows = fetch_all_rows(fields)

# 1. ALL TIME
print("\n1. All-time KPIs...")
total_active = sum(1 for r in rows if r.get("status") == "enabled")
all_time = {
    "total_active": total_active,
    "total_records": len(rows),
    "total_canceled": sum(1 for r in rows if r.get("status") == "canceled"),
    "total_trials": sum(1 for r in rows if r.get("trial_started_date")),
    "total_converted": sum(1 for r in rows if r.get("converted_trial") and r["converted_trial"].strip()),
    "total_mrr": round(sum(
        float(r.get("subscription_price") or 0) if r.get("frequency") == "monthly"
        else float(r.get("subscription_price") or 0) / 12 if r.get("frequency") == "yearly"
        else 0 for r in rows if r.get("status") == "enabled"
    ), 2),
    "total_ltv": round(sum(float(r.get("lifetime_value") or 0) for r in rows), 2)
}
print(f"  {all_time}")
upsert_cache("all_time", all_time)

# 2. COUNTRY
print("\n2. Country breakdown...")
countries = {}
for r in rows:
    c = r.get("country") or "Unknown"
    if c not in countries:
        countries[c] = {"country": c, "active": 0, "canceled": 0, "trials": 0, "revenue": 0, "prices": []}
    if r.get("status") == "enabled": countries[c]["active"] += 1
    if r.get("status") == "canceled": countries[c]["canceled"] += 1
    if r.get("trial_started_date"): countries[c]["trials"] += 1
    countries[c]["revenue"] += float(r.get("lifetime_value") or 0)
    if r.get("subscription_price"): countries[c]["prices"].append(float(r["subscription_price"]))
country_list = [{"country": c["country"], "active": c["active"], "canceled": c["canceled"], "trials": c["trials"], "revenue": round(c["revenue"], 2), "avg_price": round(sum(c["prices"])/len(c["prices"]), 2) if c["prices"] else 0} for c in countries.values()]
country_list.sort(key=lambda x: x["active"], reverse=True)
upsert_cache("by_country", country_list[:50])

# 3. PLAN
print("\n3. Plan breakdown...")
plans = {}
for r in rows:
    p = r.get("current_plan") or "Unknown"
    if p not in plans:
        plans[p] = {"plan": p, "active": 0, "canceled": 0, "revenue": 0, "prices": []}
    if r.get("status") == "enabled": plans[p]["active"] += 1
    if r.get("status") == "canceled": plans[p]["canceled"] += 1
    plans[p]["revenue"] += float(r.get("lifetime_value") or 0)
    if r.get("subscription_price"): plans[p]["prices"].append(float(r["subscription_price"]))
plan_list = [{"plan": p["plan"], "active": p["active"], "canceled": p["canceled"], "revenue": round(p["revenue"], 2), "avg_price": round(sum(p["prices"])/len(p["prices"]), 2) if p["prices"] else 0} for p in plans.values()]
plan_list.sort(key=lambda x: x["active"], reverse=True)
upsert_cache("by_plan", plan_list)

# 4. PLATFORM
print("\n4. Platform breakdown...")
platforms = {}
for r in rows:
    p = r.get("platform") or "Unknown"
    if p not in platforms: platforms[p] = {"platform": p, "total": 0, "active": 0}
    platforms[p]["total"] += 1
    if r.get("status") == "enabled": platforms[p]["active"] += 1
upsert_cache("by_platform", sorted(platforms.values(), key=lambda x: x["total"], reverse=True))

# 5. CHURN
print("\n5. Churn reasons...")
reasons = {}
for r in rows:
    if r.get("status") == "canceled":
        reason = r.get("cancel_reason_category") or "Unknown"
        reasons[reason] = reasons.get(reason, 0) + 1
reason_list = sorted([{"reason": k, "total": v} for k, v in reasons.items()], key=lambda x: x["total"], reverse=True)[:20]
upsert_cache("by_churn_reason", reason_list)

# 6. MONTHLY
print("\n6. Monthly breakdown...")
cutoff_m = (datetime.now() - timedelta(days=365)).strftime("%Y-%m")
monthly = defaultdict(lambda: {"new_subscribers": 0, "cancellations": 0, "trials_started": 0, "trial_conversions": 0, "revenue": 0})
for r in rows:
    if r.get("date_became_enabled"):
        m = r["date_became_enabled"][:7]
        if m >= cutoff_m:
            monthly[m]["new_subscribers"] += 1
            monthly[m]["revenue"] += float(r.get("subscription_price") or 0)
            if r.get("converted_trial") and r["converted_trial"].strip(): monthly[m]["trial_conversions"] += 1
    if r.get("date_last_canceled"):
        m = r["date_last_canceled"][:7]
        if m >= cutoff_m: monthly[m]["cancellations"] += 1
    if r.get("trial_started_date"):
        m = r["trial_started_date"][:7]
        if m >= cutoff_m: monthly[m]["trials_started"] += 1
monthly_list = [{"month": k, **v} for k, v in sorted(monthly.items())]
print(f"  Months: {len(monthly_list)}")
upsert_cache("monthly", monthly_list)

# 7. DAILY
print("\n7. Daily breakdown...")
cutoff_d = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
daily = defaultdict(lambda: {"new_subscribers": 0, "cancellations": 0, "trials_started": 0, "trial_conversions": 0, "revenue": 0})
for r in rows:
    if r.get("date_became_enabled"):
        d = r["date_became_enabled"][:10]
        if d >= cutoff_d:
            daily[d]["new_subscribers"] += 1
            daily[d]["revenue"] += float(r.get("subscription_price") or 0)
            if r.get("converted_trial") and r["converted_trial"].strip(): daily[d]["trial_conversions"] += 1
    if r.get("date_last_canceled"):
        d = r["date_last_canceled"][:10]
        if d >= cutoff_d: daily[d]["cancellations"] += 1
    if r.get("trial_started_date"):
        d = r["trial_started_date"][:10]
        if d >= cutoff_d: daily[d]["trials_started"] += 1
daily_list = [{"day": k, **v} for k, v in sorted(daily.items())]
print(f"  Days: {len(daily_list)}")
upsert_cache("daily", daily_list)

print(f"\nDONE! {datetime.now().strftime('%Y-%m-%d %H:%M')}")
