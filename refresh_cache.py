import os, sys, requests, time
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

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing SUPABASE_URL or SUPABASE_KEY")
    sys.exit(1)

print(f"Starting cache refresh at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"Supabase URL: {SUPABASE_URL[:30]}...")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

READ_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}


def upsert_cache(metric_name, metric_data):
    url = f"{SUPABASE_URL}/rest/v1/subscription_kpi_cache"
    row = {"metric_name": metric_name, "metric_data": metric_data}
    for attempt in range(3):
        try:
            resp = requests.post(url, headers=HEADERS, json=[row], timeout=300)
            if resp.status_code in (200, 201):
                print(f"  SAVED: {metric_name}")
                return True
            else:
                print(f"  ERROR saving {metric_name}: {resp.status_code} {resp.text[:200]}")
        except Exception as e:
            print(f"  RETRY {attempt + 1}: {e}")
            time.sleep(3)
    return False


def fetch_all_rows(fields):
    """Fetch all rows using offset pagination with order by record_id"""
    url = f"{SUPABASE_URL}/rest/v1/vimeo_subscriptions"
    all_rows = []
    offset = 0
    batch = 1000

    print(f"  Fetching in batches of {batch}...")
    while True:
        try:
            resp = requests.get(url, headers=READ_HEADERS, params={
                "select": fields,
                "offset": offset,
                "limit": batch,
                "order": "record_id"
            }, timeout=120)

            if resp.status_code != 200:
                print(f"  Fetch error at offset {offset}: {resp.status_code} {resp.text[:100]}")
                break

            rows = resp.json()
            if not rows:
                break

            all_rows.extend(rows)
            offset += len(rows)

            if len(all_rows) % 10000 == 0 or len(rows) < batch:
                print(f"  Fetched: {len(all_rows)} rows...")

            if len(rows) < batch:
                break

        except Exception as e:
            print(f"  Error at offset {offset}: {e}, retrying in 5s...")
            time.sleep(5)
            continue

    print(f"  DONE: {len(all_rows)} total rows")
    return all_rows


print("=" * 60)
print("STEP 1: Fetching all records from Supabase...")
print("=" * 60)

fields = "status,frequency,subscription_price,lifetime_value,trial_started_date,converted_trial,country,current_plan,platform,cancel_reason_category,date_became_enabled,date_last_canceled,record_id"
rows = fetch_all_rows(fields)

if not rows:
    print("ERROR: No rows fetched! Check Supabase connection.")
    sys.exit(1)

print(f"\n{'=' * 60}")
print(f"STEP 2: Processing {len(rows)} records...")
print("=" * 60)

# 1. ALL TIME KPIs
print("\n  Processing all-time KPIs...")
total_active = sum(1 for r in rows if r.get("status") == "enabled")
all_time = {
    "total_active": total_active,
    "total_records": len(rows),
    "total_canceled": sum(1 for r in rows if r.get("status") == "canceled"),
    "total_trials": sum(1 for r in rows if r.get("trial_started_date")),
    "total_converted": sum(1 for r in rows if r.get("converted_trial") and str(r["converted_trial"]).strip()),
    "total_mrr": round(sum(
        float(r.get("subscription_price") or 0) if r.get("frequency") == "monthly"
        else float(r.get("subscription_price") or 0) / 12 if r.get("frequency") == "yearly"
        else 0 for r in rows if r.get("status") == "enabled"
    ), 2),
    "total_ltv": round(sum(float(r.get("lifetime_value") or 0) for r in rows), 2)
}
print(f"  Active: {all_time['total_active']} | Records: {all_time['total_records']} | MRR: {all_time['total_mrr']}")
upsert_cache("all_time", all_time)

# 2. COUNTRY BREAKDOWN
print("\n  Processing countries...")
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
country_list = []
for c in countries.values():
    avg_p = round(sum(c["prices"]) / len(c["prices"]), 2) if c["prices"] else 0
    country_list.append({"country": c["country"], "active": c["active"], "canceled": c["canceled"], "trials": c["trials"], "revenue": round(c["revenue"], 2), "avg_price": avg_p})
country_list.sort(key=lambda x: x["active"], reverse=True)
print(f"  Countries: {len(country_list)} | Top: {country_list[0]['country'] if country_list else 'none'}")
upsert_cache("by_country", country_list[:50])

# 3. PLAN BREAKDOWN
print("\n  Processing plans...")
plans = {}
for r in rows:
    p = r.get("current_plan") or "Unknown"
    if p not in plans:
        plans[p] = {"plan": p, "active": 0, "canceled": 0, "revenue": 0, "prices": []}
    if r.get("status") == "enabled": plans[p]["active"] += 1
    if r.get("status") == "canceled": plans[p]["canceled"] += 1
    plans[p]["revenue"] += float(r.get("lifetime_value") or 0)
    if r.get("subscription_price"): plans[p]["prices"].append(float(r["subscription_price"]))
plan_list = []
for p in plans.values():
    avg_p = round(sum(p["prices"]) / len(p["prices"]), 2) if p["prices"] else 0
    plan_list.append({"plan": p["plan"], "active": p["active"], "canceled": p["canceled"], "revenue": round(p["revenue"], 2), "avg_price": avg_p})
plan_list.sort(key=lambda x: x["active"], reverse=True)
print(f"  Plans: {len(plan_list)}")
upsert_cache("by_plan", plan_list)

# 4. PLATFORM BREAKDOWN
print("\n  Processing platforms...")
platforms = {}
for r in rows:
    p = r.get("platform") or "Unknown"
    if p not in platforms: platforms[p] = {"platform": p, "total": 0, "active": 0}
    platforms[p]["total"] += 1
    if r.get("status") == "enabled": platforms[p]["active"] += 1
platform_list = sorted(platforms.values(), key=lambda x: x["total"], reverse=True)
print(f"  Platforms: {len(platform_list)}")
upsert_cache("by_platform", platform_list)

# 5. CHURN REASONS
print("\n  Processing churn reasons...")
reasons = {}
for r in rows:
    if r.get("status") == "canceled":
        reason = r.get("cancel_reason_category") or "Unknown"
        reasons[reason] = reasons.get(reason, 0) + 1
reason_list = sorted([{"reason": k, "total": v} for k, v in reasons.items()], key=lambda x: x["total"], reverse=True)[:20]
print(f"  Churn reasons: {len(reason_list)}")
upsert_cache("by_churn_reason", reason_list)

# 6. MONTHLY BREAKDOWN
print("\n  Processing monthly breakdown...")
cutoff_m = (datetime.now() - timedelta(days=365)).strftime("%Y-%m")
monthly = defaultdict(lambda: {"new_subscribers": 0, "cancellations": 0, "trials_started": 0, "trial_conversions": 0, "revenue": 0})
for r in rows:
    if r.get("date_became_enabled"):
        m = str(r["date_became_enabled"])[:7]
        if m >= cutoff_m:
            monthly[m]["new_subscribers"] += 1
            monthly[m]["revenue"] += float(r.get("subscription_price") or 0)
            if r.get("converted_trial") and str(r["converted_trial"]).strip():
                monthly[m]["trial_conversions"] += 1
    if r.get("date_last_canceled"):
        m = str(r["date_last_canceled"])[:7]
        if m >= cutoff_m:
            monthly[m]["cancellations"] += 1
    if r.get("trial_started_date"):
        m = str(r["trial_started_date"])[:7]
        if m >= cutoff_m:
            monthly[m]["trials_started"] += 1
monthly_list = [{"month": k, **v} for k, v in sorted(monthly.items())]
print(f"  Months: {len(monthly_list)}")
upsert_cache("monthly", monthly_list)

# 7. DAILY BREAKDOWN
print("\n  Processing daily breakdown...")
cutoff_d = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
daily = defaultdict(lambda: {"new_subscribers": 0, "cancellations": 0, "trials_started": 0, "trial_conversions": 0, "revenue": 0})
for r in rows:
    if r.get("date_became_enabled"):
        d = str(r["date_became_enabled"])[:10]
        if d >= cutoff_d:
            daily[d]["new_subscribers"] += 1
            daily[d]["revenue"] += float(r.get("subscription_price") or 0)
            if r.get("converted_trial") and str(r["converted_trial"]).strip():
                daily[d]["trial_conversions"] += 1
    if r.get("date_last_canceled"):
        d = str(r["date_last_canceled"])[:10]
        if d >= cutoff_d:
            daily[d]["cancellations"] += 1
    if r.get("trial_started_date"):
        d = str(r["trial_started_date"])[:10]
        if d >= cutoff_d:
            daily[d]["trials_started"] += 1
daily_list = [{"day": k, **v} for k, v in sorted(daily.items())]
print(f"  Days: {len(daily_list)}")
upsert_cache("daily", daily_list)

print(f"\n{'=' * 60}")
print(f"ALL DONE at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"Total records processed: {len(rows)}")
print("=" * 60)
