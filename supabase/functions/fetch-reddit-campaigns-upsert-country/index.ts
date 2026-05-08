// Reddit Ads sync (country-aware): upsert + reddit_ads_sync_by_date_country.
// Duplicate of fetch-reddit-campaigns-upsert that adds the COUNTRY breakdown and writes to
// reddit_campaigns_ad_group_country / reddit_campaigns_placement_country.
// Secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN, REDDIT_ACCOUNT_ID.
// POST { date_from?, date_to? } or GET ?date_from=&date_to= (default: last 2 days).
// Requires migration 20260507120000_reddit_ads_country_sync_tables.sql.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://ads-api.reddit.com/api/v3";
const UA = "WowDashboard-RedditSyncUpsertCountry/1.0";
const LOG = "[fetch-reddit-campaigns-upsert-country]";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TABLES = {
  adGroup: "reddit_campaigns_ad_group_country",
  placement: "reddit_campaigns_placement_country",
  syncHistory: "reddit_ads_sync_by_date_country",
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

async function fetchReport(
  accessToken: string,
  customerId: string,
  dateStr: string,
  breakdowns: string[],
): Promise<Record<string, unknown>[]> {
  const baseUrl = `${API_BASE}/ad_accounts/${customerId}/reports`;
  const hdrs = {
    "Authorization": `Bearer ${accessToken}`,
    "User-Agent": UA,
    "Content-Type": "application/json",
  };
  const reqBody = {
    data: {
      starts_at: `${dateStr}T00:00:00Z`,
      ends_at: `${dateStr}T00:00:00Z`,
      breakdowns,
      fields: REPORT_FIELDS,
    },
  };
  const allRows: Record<string, unknown>[] = [];
  let url: string | null = baseUrl;
  while (url) {
    let res = await fetch(url, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(reqBody),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 3000));
      res = await fetch(url, { method: "POST", headers: hdrs, body: JSON.stringify(reqBody) });
    }
    if (res.status !== 200) {
      const t = (await res.text()).substring(0, 300);
      throw new Error(`Reddit Ads report ${res.status}: ${t}`);
    }
    const json = (await res.json()) as { data?: { metrics?: unknown[] }; pagination?: { next_url?: string } };
    allRows.push(...((json.data?.metrics ?? []) as Record<string, unknown>[]));
    url = json.pagination?.next_url ?? null;
  }
  return allRows;
}

async function loadCampaignNames(
  accessToken: string,
  customerId: string,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  let nextUrl: string | null = `${API_BASE}/ad_accounts/${customerId}/campaigns?page.size=500`;
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

interface AdGroupInfo {
  name: string | null;
  campaign_id: string | null;
}

async function loadAdGroupsWithCampaign(
  accessToken: string,
  customerId: string,
): Promise<Record<string, AdGroupInfo>> {
  const map: Record<string, AdGroupInfo> = {};
  let nextUrl: string | null = `${API_BASE}/ad_accounts/${customerId}/ad_groups?page.size=500`;
  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { "Authorization": `Bearer ${accessToken}`, "User-Agent": UA },
    });
    if (res.status !== 200) break;
    const json = (await res.json()) as {
      data?: Array<{ id?: string; name?: string; campaign_id?: string }>;
      pagination?: { next_url?: string };
    };
    for (const item of json.data ?? []) {
      if (!item.id) continue;
      map[item.id] = {
        name: item.name ?? null,
        campaign_id: item.campaign_id ?? null,
      };
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
function numOrZero(v: unknown): number {
  return num(v) ?? 0;
}
function microDiv(v: unknown): number | null {
  const n = num(v);
  return n != null ? Math.round(n / 1e6 * 1e6) / 1e6 : null;
}
function centDiv(v: unknown): number | null {
  const n = num(v);
  return n != null ? Math.round(n / 100 * 100) / 100 : null;
}

function dedupeAdGroupRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = `${r.account_id}|${r.campaign_date}|${r.campaign_name ?? ""}|${r.ad_group_name ?? ""}|${r.country ?? ""}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
      continue;
    }
    (existing.impressions as number) = numOrZero(existing.impressions) + numOrZero(r.impressions);
    (existing.clicks as number) = numOrZero(existing.clicks) + numOrZero(r.clicks);
    existing.amount_spent_usd = (num(existing.amount_spent_usd) ?? 0) + (num(r.amount_spent_usd) ?? 0);
    (existing.purchase_view as number) = numOrZero(existing.purchase_view) + numOrZero(r.purchase_view);
    (existing.purchase_click as number) = numOrZero(existing.purchase_click) + numOrZero(r.purchase_click);
    existing.total_value_purchase = (num(existing.total_value_purchase) ?? 0) + (num(r.total_value_purchase) ?? 0);
  }
  return Array.from(map.values());
}

function dedupePlacementRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = `${r.account_id}|${r.campaign_id}|${r.campaign_date}|${r.placement ?? ""}|${r.country ?? ""}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
      continue;
    }
    (existing.impressions as number) = numOrZero(existing.impressions) + numOrZero(r.impressions);
    (existing.clicks as number) = numOrZero(existing.clicks) + numOrZero(r.clicks);
    existing.amount_spent_usd = (num(existing.amount_spent_usd) ?? 0) + (num(r.amount_spent_usd) ?? 0);
    (existing.purchase_view as number) = numOrZero(existing.purchase_view) + numOrZero(r.purchase_view);
    (existing.purchase_click as number) = numOrZero(existing.purchase_click) + numOrZero(r.purchase_click);
    existing.total_value_purchase = (num(existing.total_value_purchase) ?? 0) + (num(r.total_value_purchase) ?? 0);
  }
  return Array.from(map.values());
}

function normalizeISODate(s: string): string | null {
  const t = String(s).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + "T12:00:00.000Z");
  return isNaN(d.getTime()) ? null : t;
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const dateTo = new Date(now);
  dateTo.setUTCDate(dateTo.getUTCDate() - 1);
  const dateFrom = new Date(now);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 2);
  return { from: dateFrom.toISOString().slice(0, 10), to: dateTo.toISOString().slice(0, 10) };
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

function isMissingTableError(message: string, tableName: string): boolean {
  const m = message.toLowerCase();
  const t = tableName.toLowerCase();
  return m.includes("could not find the table") && m.includes(t) && m.includes("schema cache");
}

function pickCountry(r: Record<string, unknown>): string | null {
  const candidates = ["country", "country_code", "geo_country", "geography_country"];
  for (const k of candidates) {
    const v = r[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

Deno.serve(async (req: Request) => {
  console.log(LOG, new Date().toISOString());
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    let dateFromStr: string;
    let dateToStr: string;
    const apply = (df: string | null, dt: string | null) => {
      if (df && dt) {
        if (df > dt) throw new Error("date_from must be on or before date_to");
        if (eachDateInRange(df, dt).length > 366) throw new Error("Date range cannot exceed 366 days");
        return { from: df, to: dt };
      }
      const d = defaultDateRange();
      return { from: d.from, to: d.to };
    };
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch { /* empty */ }
      const r = apply(
        body.date_from != null ? normalizeISODate(String(body.date_from)) : null,
        body.date_to != null ? normalizeISODate(String(body.date_to)) : null,
      );
      dateFromStr = r.from;
      dateToStr = r.to;
    } else if (req.method === "GET") {
      const u = new URL(req.url);
      const r = apply(
        normalizeISODate(u.searchParams.get("date_from") || ""),
        normalizeISODate(u.searchParams.get("date_to") || ""),
      );
      dateFromStr = r.from;
      dateToStr = r.to;
    } else {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const accountId = getAccountId();
    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const accessToken = await getAccessToken();

    // Reddit Ads API caps breakdowns at 3, so we do COUNTRY + (DATE + AD_GROUP_ID) for the
    // ad-group report and COUNTRY + (DATE + PLACEMENT) for the placement report. Campaign
    // identity is filled in from the ad_groups list (which carries each ad group's campaign_id).
    const [campaignNames, adGroupInfo] = await Promise.all([
      loadCampaignNames(accessToken, accountId),
      loadAdGroupsWithCampaign(accessToken, accountId),
    ]);
    console.log(LOG, "names", Object.keys(campaignNames).length, Object.keys(adGroupInfo).length);

    const dates = eachDateInRange(dateFromStr, dateToStr);
    const adGroupRows: Record<string, unknown>[] = [];
    const placementRows: Record<string, unknown>[] = [];

    for (const dateStr of dates) {
      try {
        const rows = await fetchReport(
          accessToken,
          accountId,
          dateStr,
          ["DATE", "AD_GROUP_ID", "COUNTRY"],
        );
        for (const r of rows) {
          if (!r.date) continue;
          const agid = String(r.ad_group_id ?? "");
          const info = adGroupInfo[agid];
          const cid = info?.campaign_id ?? null;
          adGroupRows.push({
            account_id: accountId,
            campaign_id: cid,
            campaign_name: cid ? (campaignNames[cid] ?? null) : null,
            ad_group_id: agid || null,
            ad_group_name: info?.name ?? null,
            country: pickCountry(r),
            campaign_date: String(r.date).slice(0, 10),
            impressions: num(r.impressions),
            clicks: num(r.clicks),
            amount_spent_usd: microDiv(r.spend),
            purchase_view: num(r.conversion_purchase_views),
            purchase_click: num(r.conversion_purchase_clicks),
            total_value_purchase: centDiv(r.conversion_purchase_total_value),
          });
        }
      } catch (e) {
        console.warn(LOG, "ad_group report", dateStr, e);
      }

      try {
        const rows = await fetchReport(
          accessToken,
          accountId,
          dateStr,
          ["DATE", "PLACEMENT", "COUNTRY"],
        );
        for (const r of rows) {
          if (!r.date || !r.placement) continue;
          placementRows.push({
            account_id: accountId,
            // Aggregated across campaigns (Reddit Ads max 3 breakdowns).
            campaign_id: null,
            placement: String(r.placement),
            country: pickCountry(r),
            campaign_date: String(r.date).slice(0, 10),
            impressions: num(r.impressions),
            clicks: num(r.clicks),
            amount_spent_usd: microDiv(r.spend),
            purchase_view: num(r.conversion_purchase_views),
            purchase_click: num(r.conversion_purchase_clicks),
            total_value_purchase: centDiv(r.conversion_purchase_total_value),
          });
        }
      } catch (e) {
        console.warn(LOG, "placement report", dateStr, e);
      }

      if (dates.length > 1) await new Promise((r) => setTimeout(r, 1000));
    }

    const dedupedAdGroup = dedupeAdGroupRows(adGroupRows);
    const dedupedPlacement = dedupePlacementRows(placementRows);

    const { error: seqErr } = await supabase.rpc("reset_reddit_ads_country_sequences");
    if (seqErr) console.warn(LOG, "reddit_ads_country sequence", seqErr.message);

    const BATCH = 400;
    const stripId = <T extends Record<string, unknown>>(row: T) => {
      const { id: _i, ...rest } = row;
      return rest;
    };

    for (let i = 0; i < dedupedAdGroup.length; i += BATCH) {
      const chunk = dedupedAdGroup.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from(TABLES.adGroup).upsert(chunk, {
        onConflict: "account_id,campaign_date,campaign_name,ad_group_name,country",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`${TABLES.adGroup} upsert: ${error.message}`);
    }
    for (let i = 0; i < dedupedPlacement.length; i += BATCH) {
      const chunk = dedupedPlacement.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from(TABLES.placement).upsert(chunk, {
        onConflict: "account_id,campaign_id,campaign_date,placement,country",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`${TABLES.placement} upsert: ${error.message}`);
    }

    const syncedAt = new Date().toISOString();
    const historyByKey = new Map<string, { account_id: string; segment_date: string; country: string }>();
    for (const row of dedupedAdGroup) {
      const segmentDate = typeof row.campaign_date === "string" ? row.campaign_date : null;
      const rowCountry = typeof row.country === "string" && row.country.trim()
        ? row.country.trim()
        : "unknown";
      if (!segmentDate) continue;
      const k = `${accountId}\0${segmentDate}\0${rowCountry}`;
      historyByKey.set(k, { account_id: accountId, segment_date: segmentDate, country: rowCountry });
    }
    if (historyByKey.size === 0) {
      for (const segment_date of dates) {
        const k = `${accountId}\0${segment_date}\0unknown`;
        historyByKey.set(k, { account_id: accountId, segment_date, country: "unknown" });
      }
    }
    const hist = [...historyByKey.values()].map((r) => ({ ...r, synced_at: syncedAt }));

    let historyWritten = false;
    for (let i = 0; i < hist.length; i += BATCH) {
      const { error } = await supabase.from(TABLES.syncHistory).upsert(hist.slice(i, i + BATCH), {
        onConflict: "account_id,segment_date,country",
        ignoreDuplicates: false,
      });
      if (error) {
        if (isMissingTableError(error.message, TABLES.syncHistory)) {
          console.warn(LOG, "sync history table missing; skipping reddit_ads_sync_by_date_country writes");
          break;
        }
        throw new Error(`${TABLES.syncHistory}: ${error.message}`);
      }
      historyWritten = true;
    }

    const runId = crypto.randomUUID();
    const countries = [...new Set(
      [...dedupedAdGroup, ...dedupedPlacement]
        .map((r) => (typeof r.country === "string" ? r.country : null))
        .filter(Boolean),
    )];
    const logMeta = {
      ad_group_rows: dedupedAdGroup.length,
      placement_rows: dedupedPlacement.length,
      countries,
    };
    const logRows = hist.map((r) => ({
      platform: "reddit_ads_country",
      account_id: r.account_id,
      segment_date: r.segment_date,
      synced_at: r.synced_at,
      run_id: runId,
      date_range_start: dateFromStr,
      date_range_end: dateToStr,
      metadata: logMeta,
    }));
    let logWritten = false;
    if (historyWritten) {
      for (let i = 0; i < logRows.length; i += BATCH) {
        const { error: logErr } = await supabase.from("ads_sync_by_date_log").insert(logRows.slice(i, i + BATCH));
        if (logErr) {
          if (isMissingTableError(logErr.message, "ads_sync_by_date_log")) {
            console.warn(LOG, "ads sync log table missing; skipping ads_sync_by_date_log writes");
            break;
          }
          throw new Error(`ads_sync_by_date_log: ${logErr.message}`);
        }
        logWritten = true;
      }
    }

    const result = {
      ok: true,
      function: "fetch-reddit-campaigns-upsert-country",
      account_id: accountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      upserted: { ad_group_rows: dedupedAdGroup.length, placement_rows: dedupedPlacement.length },
      sync_history_rows: historyWritten ? hist.length : 0,
      sync_history_skipped: !historyWritten,
      ads_sync_log_rows: logWritten ? logRows.length : 0,
      ads_sync_log_skipped: !logWritten,
      countries,
      run_id: runId,
    };
    console.log(LOG, JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(
      JSON.stringify({ error: "fetch_reddit_campaigns_upsert_country_failed", message }),
      {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      },
    );
  }
});
