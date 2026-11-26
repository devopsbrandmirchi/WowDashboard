// Reddit Ads sync: upsert + reddit_ads_sync_by_date (original: fetch-reddit-campaigns).
// Secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN, REDDIT_ACCOUNT_ID.
// POST { date_from?, date_to?, include_placement? } or GET ?date_from=&date_to=&include_placement=
// Days are calendar days in the ad account time zone (Ads Manager buckets), read from GET /ad_accounts/{id};
// optional secret REDDIT_TIME_ZONE_ID is used only when that lookup fails. Each local day is pulled with an
// HOUR breakdown and only hours on that local date are summed (Reddit's DATE buckets and day windows do not
// follow the account time zone). POST { dry_run: true } fetches and totals without writing.
// Default: day before yesterday through today (account time zone), ad-group report only — used by cron.
// Today is partial when the cron runs; later runs overwrite it with the complete day.
// Set include_placement=true for manual syncs that also refresh the Placements tab.
// Reporting is capped at 60 requests / 60s. Calls are paced under that cap and each page asks for
// 1000 rows. An invocation stops before the Edge idle timeout (150s), writes the days it finished,
// and returns { partial: true, next_date } so the caller can continue. A timed-out request writes nothing.
// Requires migration 20250318200000_reddit_ads_upsert_sync_history.sql
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://ads-api.reddit.com/api/v3";
const UA = "WowDashboard-RedditSyncUpsert/1.0";
const LOG = "[fetch-reddit-campaigns-upsert]";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getAccountId(): string {
  const v = Deno.env.get("REDDIT_ACCOUNT_ID");
  if (!v?.trim()) throw new Error("Missing env: REDDIT_ACCOUNT_ID");
  return v.trim();
}

async function getAccessToken(): Promise<string> {
  const clientId = getEnv("REDDIT_CLIENT_ID");
  const clientSecret = getEnv("REDDIT_CLIENT_SECRET");
  const refreshToken = getEnv("REDDIT_REFRESH_TOKEN");
  const res = await fetch(REDDIT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
      "User-Agent": UA,
    },
    body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Reddit OAuth failed: ${res.status} ${t}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("No access_token in Reddit OAuth response");
  return json.access_token;
}

const REPORT_FIELDS = [
  "IMPRESSIONS", "CLICKS", "SPEND",
  "CPC", "CTR", "ECPM", "REACH", "FREQUENCY",
  "CONVERSION_PURCHASE_VIEWS", "CONVERSION_PURCHASE_CLICKS",
  "CONVERSION_PURCHASE_TOTAL_VALUE", "CONVERSION_PURCHASE_ECPA",
  "CONVERSION_LEAD_CLICKS", "CONVERSION_LEAD_VIEWS",
  "CONVERSION_SIGN_UP_CLICKS", "CONVERSION_SIGN_UP_VIEWS",
  "CONVERSION_PAGE_VISIT_CLICKS", "CONVERSION_PAGE_VISIT_VIEWS",
  "CONVERSION_ADD_TO_CART_CLICKS", "CONVERSION_ADD_TO_CART_VIEWS",
  "CONVERSION_ADD_TO_CART_TOTAL_VALUE",
  "CONVERSION_ROAS",
];

const REPORT_PAGE_SIZE = 1000;
/** Stay under Reddit ads-reporting (60 requests / 60s). Retries count toward the same quota. */
const REPORT_MIN_GAP_MS = 1_100;
const REPORT_RATE_LIMIT_RETRIES = 3;
const REPORT_RATE_LIMIT_CAP_MS = 25_000;
/** Stop fetching before the 150s Edge idle timeout so the response and the upserts still go out. */
const INVOKE_BUDGET_MS = 110_000;
const MIN_MS_BEFORE_REPORT = 12_000;

class SyncBudgetExceeded extends Error {
  constructor() {
    super("sync_budget");
    this.name = "SyncBudgetExceeded";
  }
}

type ReportLimit = { remaining: number; resetSec: number };
type ReportThrottle = {
  startedAt: number;
  notBefore: number;
  lastLimit: ReportLimit | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function budgetLeft(throttle: ReportThrottle): number {
  return INVOKE_BUDGET_MS - (Date.now() - throttle.startedAt);
}

/** `RateLimit: "ads-reporting";r=12;t=40` — remaining requests and seconds until that window resets. */
function parseAdsReportingLimit(header: string | null): ReportLimit | null {
  if (!header) return null;
  const policies = header.split(/,(?=\s*")/);
  let fallback: ReportLimit | null = null;
  for (const policy of policies) {
    const name = /"([^"]+)"/.exec(policy)?.[1] ?? "";
    const remaining = Number(/[;\s]r=(\d+)/.exec(policy)?.[1]);
    const resetSec = Number(/[;\s]t=(\d+)/.exec(policy)?.[1]);
    if (!Number.isFinite(remaining) || !Number.isFinite(resetSec)) continue;
    const parsed = { remaining, resetSec };
    if (name === "ads-reporting") return parsed;
    fallback ??= parsed;
  }
  return fallback;
}

function ensureReportBudget(throttle: ReportThrottle, extraMs = 0): void {
  if (budgetLeft(throttle) < MIN_MS_BEFORE_REPORT + extraMs) throw new SyncBudgetExceeded();
}

/** Wait out the spacing gap, or the published reset when the reporting window is empty. */
async function paceReport(throttle: ReportThrottle): Promise<void> {
  const limit = throttle.lastLimit;
  let wait = Math.max(0, throttle.notBefore - Date.now());
  if (limit && limit.remaining <= 1 && limit.resetSec > 0) {
    wait = Math.max(wait, limit.resetSec * 1000 + 250);
  }
  throttle.lastLimit = null;
  if (wait > 0) {
    ensureReportBudget(throttle, Math.min(wait, REPORT_RATE_LIMIT_CAP_MS));
    await sleep(Math.min(wait, REPORT_RATE_LIMIT_CAP_MS));
  }
  throttle.notBefore = Date.now() + REPORT_MIN_GAP_MS;
}

/** Next calendar day YYYY-MM-DD. Reddit report ends_at is exclusive. */
function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function calendarDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Minutes the zone is ahead of UTC at `utcMs` (negative for the Americas). */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60_000);
}

/** UTC instant of local midnight on `dateStr` in `timeZone`, as Reddit's hourly `YYYY-MM-DDTHH:00:00Z`. */
function localMidnightAsUtcHour(dateStr: string, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const wallMs = Date.UTC(y, m - 1, d);
  let utcMs = wallMs - zoneOffsetMinutes(wallMs, timeZone) * 60_000;
  utcMs = wallMs - zoneOffsetMinutes(utcMs, timeZone) * 60_000;
  return new Date(utcMs).toISOString().slice(0, 13) + ":00:00Z";
}

/** Ad account time zone (what Ads Manager uses for daily totals). */
async function resolveAccountTimeZone(
  accessToken: string,
  accountId: string
): Promise<{ timeZoneId: string; source: "ad_account" | "secret" | "utc_fallback" }> {
  try {
    const res = await fetch(`${API_BASE}/ad_accounts/${accountId}`, {
      headers: { "Authorization": `Bearer ${accessToken}`, "User-Agent": UA },
    });
    if (res.status === 200) {
      const json = (await res.json()) as { data?: { time_zone_id?: string } };
      const tz = json.data?.time_zone_id?.trim();
      if (tz) return { timeZoneId: tz, source: "ad_account" };
      console.warn(LOG, "ad account has no time_zone_id");
    } else {
      console.warn(LOG, "ad account lookup", res.status, (await res.text()).slice(0, 200));
    }
  } catch (e) {
    console.warn(LOG, "ad account lookup failed", e instanceof Error ? e.message : e);
  }
  const fromSecret = Deno.env.get("REDDIT_TIME_ZONE_ID")?.trim();
  if (fromSecret) return { timeZoneId: fromSecret, source: "secret" };
  return { timeZoneId: "UTC", source: "utc_fallback" };
}

async function fetchReport(
  accessToken: string,
  customerId: string,
  dateStr: string,
  breakdowns: string[],
  timeZoneId: string,
  throttle: ReportThrottle
): Promise<Record<string, unknown>[]> {
  const baseUrl = `${API_BASE}/ad_accounts/${customerId}/reports?page.size=${REPORT_PAGE_SIZE}`;
  const hdrs = {
    "Authorization": `Bearer ${accessToken}`,
    "User-Agent": UA,
    "Content-Type": "application/json",
  };
  // One local calendar day as UTC hours (DST-aware). Callers break down by HOUR and keep only hours whose
  // local date is dateStr, because Reddit can return hours outside the requested window.
  const tz = isIanaTimeZone(timeZoneId) ? timeZoneId : "UTC";
  const reqBody = {
    data: {
      starts_at: localMidnightAsUtcHour(dateStr, tz),
      ends_at: localMidnightAsUtcHour(dayAfter(dateStr), tz),
      breakdowns,
      fields: REPORT_FIELDS,
    },
  };
  const allRows: Record<string, unknown>[] = [];
  let url: string | null = baseUrl;
  let pages = 0;
  while (url) {
    ensureReportBudget(throttle);
    await paceReport(throttle);
    let res = await fetch(url, { method: "POST", headers: hdrs, body: JSON.stringify(reqBody) });
    // A 429 still spends quota. Wait for the window Reddit publishes instead of retrying into it.
    for (let attempt = 0; res.status === 429 && attempt < REPORT_RATE_LIMIT_RETRIES; attempt++) {
      const limit = parseAdsReportingLimit(res.headers.get("RateLimit"));
      await res.body?.cancel();
      const retryAfterSec = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, REPORT_RATE_LIMIT_CAP_MS)
        : limit && limit.resetSec > 0
          ? Math.min(limit.resetSec * 1000 + 250, REPORT_RATE_LIMIT_CAP_MS)
          : Math.min(5_000 * 2 ** attempt, REPORT_RATE_LIMIT_CAP_MS);
      console.warn(LOG, `report 429, waiting ${waitMs}ms (${attempt + 1}/${REPORT_RATE_LIMIT_RETRIES})`);
      ensureReportBudget(throttle, waitMs);
      await sleep(waitMs);
      throttle.notBefore = Date.now() + REPORT_MIN_GAP_MS;
      res = await fetch(url, { method: "POST", headers: hdrs, body: JSON.stringify(reqBody) });
    }
    throttle.lastLimit = parseAdsReportingLimit(res.headers.get("RateLimit"));
    if (res.status !== 200) {
      const t = (await res.text()).substring(0, 300);
      throw new Error(`Reddit Ads report ${res.status}: ${t}`);
    }
    const json = (await res.json()) as { data?: { metrics?: unknown[] }; pagination?: { next_url?: string } };
    const metrics = (json.data?.metrics ?? []) as Record<string, unknown>[];
    allRows.push(...metrics);
    pages++;
    const nextUrl = json.pagination?.next_url ?? null;
    url = nextUrl && !/[?&]page\.size=/.test(nextUrl)
      ? `${nextUrl}${nextUrl.includes("?") ? "&" : "?"}page.size=${REPORT_PAGE_SIZE}`
      : nextUrl;
  }
  console.log(LOG, "report", dateStr, breakdowns.join("+"), "rows", allRows.length, "pages", pages);
  return allRows;
}

async function loadNames(
  accessToken: string,
  customerId: string,
  type: "campaigns" | "ad_groups"
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  let nextUrl: string | null = `${API_BASE}/ad_accounts/${customerId}/${type}?page.size=500`;
  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { "Authorization": `Bearer ${accessToken}`, "User-Agent": UA },
    });
    if (res.status !== 200) break;
    const json = (await res.json()) as { data?: Array<{ id?: string; name?: string }>; pagination?: { next_url?: string } };
    for (const item of json.data ?? []) {
      if (item.id && item.name) map[item.id] = item.name;
    }
    nextUrl = json.pagination?.next_url ?? null;
  }
  return map;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function microDiv(v: unknown): number | null {
  const n = num(v);
  return n != null ? Math.round(n / 1e6 * 1e6) / 1e6 : null;
}
function centDiv(v: unknown): number | null {
  const n = num(v);
  return n != null ? Math.round(n / 100 * 100) / 100 : null;
}

/** Collapse pagination / report duplicates. Last row wins — do not sum (summing doubles spend). */
function dedupeAdGroupRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key =
      `${r.account_id}|${r.campaign_date}|${r.campaign_name ?? ""}|${r.ad_group_name ?? ""}|${r.country ?? ""}`;
    map.set(key, { ...r });
  }
  return Array.from(map.values());
}

/** Collapse pagination / report duplicates. Last row wins — do not sum. */
function dedupePlacementRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = `${r.account_id}|${r.campaign_id}|${r.campaign_date}|${r.placement ?? ""}`;
    map.set(key, { ...r });
  }
  return Array.from(map.values());
}

/** UTC start of an HOUR-breakdown row: ISO timestamp in `hour`, or `date` plus an hour number. */
function rowHourUtcMs(r: Record<string, unknown>): number | null {
  const hour = r.hour;
  if (typeof hour === "string" && /T\d{2}/.test(hour)) {
    const t = Date.parse(hour);
    return isNaN(t) ? null : t;
  }
  const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : null;
  const h = hour != null && hour !== "" ? Number(String(hour).slice(0, 2)) : NaN;
  if (date && Number.isFinite(h)) return Date.parse(`${date}T00:00:00Z`) + h * 3_600_000;
  return null;
}

type HourlyAgg = {
  key: string;
  campaign_id: string;
  second_id: string;
  impressions: number;
  clicks: number;
  spend_micro: number;
  purchase_view: number;
  purchase_click: number;
  purchase_value_cents: number;
};

/** Sum HOUR rows that fall on `localDate` in `timeZone`, grouped by campaign + second breakdown id. */
function sumHoursForLocalDay(
  rows: Record<string, unknown>[],
  localDate: string,
  timeZone: string,
  secondKey: "ad_group_id" | "placement"
): { groups: HourlyAgg[]; kept: number; outside: number; unparsed: number } {
  const map = new Map<string, HourlyAgg>();
  let kept = 0;
  let outside = 0;
  let unparsed = 0;
  for (const r of rows) {
    const ms = rowHourUtcMs(r);
    if (ms == null) {
      unparsed++;
      continue;
    }
    if (calendarDateInTimeZone(new Date(ms), timeZone) !== localDate) {
      outside++;
      continue;
    }
    kept++;
    const cid = String(r.campaign_id ?? "");
    const second = String(r[secondKey] ?? "");
    const key = `${cid}|${second}`;
    let a = map.get(key);
    if (!a) {
      a = {
        key,
        campaign_id: cid,
        second_id: second,
        impressions: 0,
        clicks: 0,
        spend_micro: 0,
        purchase_view: 0,
        purchase_click: 0,
        purchase_value_cents: 0,
      };
      map.set(key, a);
    }
    a.impressions += num(r.impressions) ?? 0;
    a.clicks += num(r.clicks) ?? 0;
    a.spend_micro += num(r.spend) ?? 0;
    a.purchase_view += num(r.conversion_purchase_views) ?? 0;
    a.purchase_click += num(r.conversion_purchase_clicks) ?? 0;
    a.purchase_value_cents += num(r.conversion_purchase_total_value) ?? 0;
  }
  return { groups: [...map.values()], kept, outside, unparsed };
}

function normalizeISODate(s: string): string | null {
  const t = String(s).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + "T12:00:00.000Z");
  return isNaN(d.getTime()) ? null : t;
}

function defaultDateRange(timeZoneId: string): { from: string; to: string } {
  const tz = isIanaTimeZone(timeZoneId) ? timeZoneId : "UTC";
  const today = calendarDateInTimeZone(new Date(), tz);
  return { from: dayBefore(dayBefore(today)), to: today };
}

function eachDateInRange(fromStr: string, toStr: string): string[] {
  const out: string[] = [];
  const d = new Date(fromStr + "T12:00:00.000Z");
  const end = new Date(toStr + "T12:00:00.000Z");
  let n = 0;
  while (d <= end && n++ < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

Deno.serve(async (req: Request) => {
  console.log(LOG, new Date().toISOString());
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    let requested: { from: string; to: string } | null;
    /** Cron sends {} → false (1 reports call/day). Manual Settings sync can pass true. */
    let includePlacement = false;
    /** Fetch and total the days without writing anything. */
    let dryRun = false;
    const apply = (df: string | null, dt: string | null) => {
      if (df && dt) {
        if (df > dt) throw new Error("date_from must be on or before date_to");
        if (eachDateInRange(df, dt).length > 366) throw new Error("Date range cannot exceed 366 days");
        return { from: df, to: dt };
      }
      return null;
    };
    const parseFlag = (v: unknown): boolean => {
      if (v === true || v === 1) return true;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "1" || s === "true" || s === "yes";
      }
      return false;
    };
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch { /* empty */ }
      requested = apply(
        body.date_from != null ? normalizeISODate(String(body.date_from)) : null,
        body.date_to != null ? normalizeISODate(String(body.date_to)) : null
      );
      includePlacement = parseFlag(body.include_placement);
      dryRun = parseFlag(body.dry_run);
    } else if (req.method === "GET") {
      const u = new URL(req.url);
      requested = apply(normalizeISODate(u.searchParams.get("date_from") || ""), normalizeISODate(u.searchParams.get("date_to") || ""));
      includePlacement = parseFlag(u.searchParams.get("include_placement"));
      dryRun = parseFlag(u.searchParams.get("dry_run"));
    } else {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const accountId = getAccountId();
    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const accessToken = await getAccessToken();

    const { timeZoneId, source: timeZoneSource } = await resolveAccountTimeZone(accessToken, accountId);
    console.log(LOG, "time zone", timeZoneId, timeZoneSource);
    const range = requested ?? defaultDateRange(timeZoneId);
    const dateFromStr = range.from;
    const dateToStr = range.to;

    const [campaignNames, adGroupNames] = await Promise.all([
      loadNames(accessToken, accountId, "campaigns"),
      loadNames(accessToken, accountId, "ad_groups"),
    ]);
    console.log(LOG, "names", Object.keys(campaignNames).length, Object.keys(adGroupNames).length);

    const dates = eachDateInRange(dateFromStr, dateToStr);
    const throttle: ReportThrottle = { startedAt: Date.now(), notBefore: 0, lastLimit: null };
    let nextDate: string | null = null;
    const adGroupRows: Record<string, unknown>[] = [];
    const placementRows: Record<string, unknown>[] = [];
    const tz = isIanaTimeZone(timeZoneId) ? timeZoneId : "UTC";
    const perDate: Record<string, {
      ad_group_raw: number;
      hours_kept: number;
      hours_outside_day: number;
      hours_unparsed: number;
      placement_raw: number;
      totals: { spend: number; impressions: number; clicks: number };
      time_fields?: Record<string, unknown>;
      error?: string;
    }> = {};

    for (const dateStr of dates) {
      if (budgetLeft(throttle) < MIN_MS_BEFORE_REPORT) {
        nextDate = dateStr;
        console.log(LOG, "budget stop before", dateStr, "left_ms", budgetLeft(throttle));
        break;
      }
      const day = (perDate[dateStr] = {
        ad_group_raw: 0,
        hours_kept: 0,
        hours_outside_day: 0,
        hours_unparsed: 0,
        placement_raw: 0,
        totals: { spend: 0, impressions: 0, clicks: 0 },
      } as (typeof perDate)[string]);
      const adGroupMark = adGroupRows.length;
      const placementMark = placementRows.length;
      let budgetHit = false;
      try {
        const rows = await fetchReport(accessToken, accountId, dateStr, ["HOUR", "CAMPAIGN_ID", "AD_GROUP_ID"], timeZoneId, throttle);
        day.ad_group_raw = rows.length;
        if (rows.length > 0) {
          day.time_fields = Object.fromEntries(
            Object.entries(rows[0]).filter(([k]) => /date|hour|time|start|end/i.test(k)),
          );
        }
        const summed = sumHoursForLocalDay(rows, dateStr, tz, "ad_group_id");
        day.hours_kept = summed.kept;
        day.hours_outside_day = summed.outside;
        day.hours_unparsed = summed.unparsed;
        for (const g of summed.groups) {
          adGroupRows.push({
            account_id: accountId,
            country: null,
            campaign_name: campaignNames[g.campaign_id] ?? null,
            ad_group_name: adGroupNames[g.second_id] ?? null,
            campaign_date: dateStr,
            impressions: g.impressions,
            clicks: g.clicks,
            amount_spent_usd: microDiv(g.spend_micro),
            purchase_view: g.purchase_view,
            purchase_click: g.purchase_click,
            total_value_purchase: centDiv(g.purchase_value_cents),
          });
          day.totals.spend += g.spend_micro / 1e6;
          day.totals.impressions += g.impressions;
          day.totals.clicks += g.clicks;
        }
        day.totals.spend = Math.round(day.totals.spend * 100) / 100;
      } catch (e) {
        if (e instanceof SyncBudgetExceeded) budgetHit = true;
        else {
          day.error = e instanceof Error ? e.message : String(e);
          console.warn(LOG, "ad_group report", dateStr, e);
        }
      }

      if (!budgetHit && includePlacement && !day.error) {
        try {
          const rows = await fetchReport(accessToken, accountId, dateStr, ["HOUR", "CAMPAIGN_ID", "PLACEMENT"], timeZoneId, throttle);
          day.placement_raw = rows.length;
          for (const g of sumHoursForLocalDay(rows, dateStr, tz, "placement").groups) {
            if (!g.second_id) continue;
            placementRows.push({
              account_id: accountId,
              campaign_id: g.campaign_id || null,
              placement: g.second_id,
              campaign_date: dateStr,
              impressions: g.impressions,
              clicks: g.clicks,
              amount_spent_usd: microDiv(g.spend_micro),
              purchase_view: g.purchase_view,
              purchase_click: g.purchase_click,
              total_value_purchase: centDiv(g.purchase_value_cents),
            });
          }
        } catch (e) {
          if (e instanceof SyncBudgetExceeded) budgetHit = true;
          else {
            day.error = e instanceof Error ? e.message : String(e);
            console.warn(LOG, "placement report", dateStr, e);
          }
        }
      }

      if (budgetHit) {
        adGroupRows.length = adGroupMark;
        placementRows.length = placementMark;
        delete perDate[dateStr];
        nextDate = dateStr;
        console.log(LOG, "budget stop during", dateStr);
        break;
      }
    }

    const completedDates = dates.filter((d) => perDate[d] && !perDate[d].error);
    if (completedDates.length === 0 && !nextDate) {
      const firstErr = Object.entries(perDate).find(([, day]) => day.error);
      throw new Error(firstErr ? `${firstErr[0]}: ${firstErr[1].error}` : "No days synced");
    }

    const dedupedAdGroup = dedupeAdGroupRows(adGroupRows);
    const dedupedPlacement = dedupePlacementRows(placementRows).filter((r) => r.campaign_id);

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true,
        dry_run: true,
        account_id: accountId,
        date_from: dateFromStr,
        date_to: dateToStr,
        partial: nextDate != null,
        next_date: nextDate,
        synced_through: completedDates[completedDates.length - 1] ?? null,
        time_zone_id: timeZoneId,
        time_zone_source: timeZoneSource,
        per_date: perDate,
      }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const BATCH = 400;
    const stripId = <T extends Record<string, unknown>>(row: T) => {
      const { id: _i, ...rest } = row;
      return rest;
    };

    // Replace only days that came back with rows, so a failed/empty Reddit pull cannot wipe history.
    const adGroupDates = [...new Set(dedupedAdGroup.map((r) => String(r.campaign_date)))];
    const placementDates = [...new Set(dedupedPlacement.map((r) => String(r.campaign_date)))];
    if (adGroupDates.length > 0) {
      const { error: delAgErr } = await supabase
        .from("reddit_campaigns_ad_group")
        .delete()
        .eq("account_id", accountId)
        .in("campaign_date", adGroupDates);
      if (delAgErr) throw new Error(`reddit_campaigns_ad_group delete: ${delAgErr.message}`);
    }
    if (includePlacement && placementDates.length > 0) {
      const { error: delPlErr } = await supabase
        .from("reddit_campaigns_placement")
        .delete()
        .eq("account_id", accountId)
        .in("campaign_date", placementDates);
      if (delPlErr) throw new Error(`reddit_campaigns_placement delete: ${delPlErr.message}`);
    }

    for (let i = 0; i < dedupedAdGroup.length; i += BATCH) {
      const chunk = dedupedAdGroup.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("reddit_campaigns_ad_group").upsert(chunk, {
        onConflict: "account_id,campaign_date,campaign_name,ad_group_name,country",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`reddit_campaigns_ad_group upsert: ${error.message}`);
    }
    for (let i = 0; i < dedupedPlacement.length; i += BATCH) {
      const chunk = dedupedPlacement.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("reddit_campaigns_placement").upsert(chunk, {
        onConflict: "account_id,campaign_id,campaign_date,placement",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`reddit_campaigns_placement upsert: ${error.message}`);
    }

    const uniqueCampaignNames = [...new Set(dedupedAdGroup.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean))];
    if (uniqueCampaignNames.length > 0) {
      const { data: existing } = await supabase.from("reddit_campaigns_reference_data").select("campaign_name").in("campaign_name", uniqueCampaignNames);
      const existingSet = new Set((existing ?? []).map((r) => (r.campaign_name as string)?.trim()).filter(Boolean));
      const toInsert = uniqueCampaignNames.filter((n) => !existingSet.has(n)).map((campaign_name) => ({ campaign_name }));
      if (toInsert.length > 0) {
        const { error: refErr } = await supabase.from("reddit_campaigns_reference_data").insert(toInsert);
        if (refErr) throw new Error(`reddit_campaigns_reference_data: ${refErr.message}`);
      }
    }

    const syncedAt = new Date().toISOString();
    const hist = completedDates.map((segment_date) => ({ account_id: accountId, segment_date, synced_at: syncedAt }));
    const loggedFrom = completedDates[0] ?? dateFromStr;
    const loggedTo = completedDates[completedDates.length - 1] ?? dateToStr;
    for (let i = 0; i < hist.length; i += BATCH) {
      const { error } = await supabase.from("reddit_ads_sync_by_date").upsert(hist.slice(i, i + BATCH), {
        onConflict: "account_id,segment_date",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`reddit_ads_sync_by_date: ${error.message}`);
    }

    const runId = crypto.randomUUID();
    const logMeta = {
      ad_group_rows: dedupedAdGroup.length,
      placement_rows: dedupedPlacement.length,
      include_placement: includePlacement,
      partial: nextDate != null,
      next_date: nextDate,
      requested_from: dateFromStr,
      requested_to: dateToStr,
    };
    const logRows = hist.map((r) => ({
      platform: "reddit_ads",
      account_id: r.account_id,
      segment_date: r.segment_date,
      synced_at: r.synced_at,
      run_id: runId,
      date_range_start: loggedFrom,
      date_range_end: loggedTo,
      metadata: logMeta,
    }));
    for (let i = 0; i < logRows.length; i += BATCH) {
      const { error: logErr } = await supabase.from("ads_sync_by_date_log").insert(logRows.slice(i, i + BATCH));
      if (logErr) throw new Error(`ads_sync_by_date_log: ${logErr.message}`);
    }

    const result = {
      ok: true,
      function: "fetch-reddit-campaigns-upsert",
      account_id: accountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      partial: nextDate != null,
      next_date: nextDate,
      synced_through: completedDates[completedDates.length - 1] ?? null,
      time_zone_id: timeZoneId,
      time_zone_source: timeZoneSource,
      include_placement: includePlacement,
      upserted: { ad_group_rows: dedupedAdGroup.length, placement_rows: dedupedPlacement.length },
      per_date: perDate,
      sync_history_rows: hist.length,
      run_id: runId,
    };
    console.log(LOG, JSON.stringify(result));
    return new Response(JSON.stringify(result), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "fetch_reddit_campaigns_upsert_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
