// Facebook/Meta sync: upsert + facebook_ads_sync_by_date (original: fetch-facebook-campaigns).
// FB_APP_ID, FB_APP_SECRET, FB_ACCESS_TOKEN, FB_AD_ACCOUNT_ID or FB_ACCOUNT_ID.
// POST { date_from?, date_to? } or GET query params. Default: last 2 days.
// Requires migration 20250318200001_facebook_ads_upsert_sync_history.sql
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH_VERSION = "v18.0";
const LOG = "[fetch-facebook-campaigns-upsert]";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getAdAccountId(): string {
  const v = Deno.env.get("FB_AD_ACCOUNT_ID") ?? Deno.env.get("FB_ACCOUNT_ID");
  if (!v?.trim()) throw new Error("Missing env: FB_AD_ACCOUNT_ID or FB_ACCOUNT_ID");
  return v.trim();
}

async function getAppAccessToken(): Promise<string> {
  const appId = getEnv("FB_APP_ID");
  const appSecret = getEnv("FB_APP_SECRET");
  const url = `https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Facebook OAuth: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("No access_token");
  return json.access_token;
}

async function getAccessToken(): Promise<string> {
  const userToken = Deno.env.get("FB_ACCESS_TOKEN");
  if (userToken?.trim()) return userToken.trim();
  return getAppAccessToken();
}

async function graphGetAll<T>(
  path: string,
  params: Record<string, string>,
  extractData: (json: { data?: T[]; paging?: { next?: string } }) => T[] = (j) => j.data ?? []
): Promise<T[]> {
  const out: T[] = [];
  let nextUrl: string | null = `${path}?${new URLSearchParams(params)}`;
  const token = await getAccessToken();
  while (nextUrl) {
    const fullUrl = nextUrl.startsWith("http") ? nextUrl : `https://graph.facebook.com/${GRAPH_VERSION}${nextUrl}`;
    const url = fullUrl.includes("access_token=") ? fullUrl : `${fullUrl}${fullUrl.includes("?") ? "&" : "?"}access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Graph: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data?: T[]; paging?: { next?: string } };
    out.push(...extractData(json));
    nextUrl = json.paging?.next ?? null;
  }
  return out;
}

interface InsightRow {
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  date_stop?: string;
  impressions?: string;
  reach?: string;
  spend?: string;
  clicks?: string;
  frequency?: string;
  publisher_platform?: string;
  platform_position?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
}

function parseActions(actions: InsightRow["actions"], actionType: string): number {
  if (!Array.isArray(actions)) return 0;
  const a = actions.find((x) => x.action_type === actionType);
  return a?.value ? parseInt(a.value, 10) || 0 : 0;
}

function parseActionValue(actionValues: InsightRow["action_values"], actionType: string): number {
  if (!Array.isArray(actionValues)) return 0;
  const a = actionValues.find((x) => x.action_type === actionType);
  return a?.value ? parseFloat(a.value) || 0 : 0;
}

function toDataRow(insight: InsightRow, accountId: string, dateFromStr: string, dateToStr: string): Record<string, unknown> | null {
  if (!insight.ad_id || !insight.date_start) return null;
  const actions = insight.actions ?? [];
  const actionValues = insight.action_values ?? [];
  const purchaseCount =
    parseActions(actions, "purchase") ||
    parseActions(actions, "omni_purchase") ||
    parseActions(actions, "offsite_conversion.fb_pixel_purchase") || 0;
  const purchaseValue =
    parseActionValue(actionValues, "purchase") ||
    parseActionValue(actionValues, "omni_purchase") ||
    parseActionValue(actionValues, "offsite_conversion.fb_pixel_purchase") || 0;
  const spend = insight.spend != null ? parseFloat(insight.spend) : null;
  const results = purchaseCount || parseActions(actions, "link_click") || null;
  const costPerResult = spend != null && results != null && results > 0 ? spend / results : null;

  const platform = insight.publisher_platform?.trim() || null;
  const placement = insight.platform_position?.trim() || null;

  return {
    account_id: accountId || insight.account_id || "",
    campaign_name: insight.campaign_name ?? null,
    adset_name: insight.adset_name ?? null,
    ad_name: insight.ad_name ?? null,
    placement,
    day: insight.date_start ?? null,
    campaign_id: insight.campaign_id ?? null,
    adset_id: insight.adset_id ?? null,
    ad_id: insight.ad_id ?? null,
    platform,
    device_platform: null,
    delivery_status: null,
    delivery_level: null,
    reach: insight.reach != null ? parseInt(insight.reach, 10) : null,
    impressions: insight.impressions != null ? parseInt(insight.impressions, 10) : null,
    frequency: insight.frequency != null ? parseFloat(insight.frequency) : null,
    attribution_setting: null,
    result_type: null,
    results: results,
    amount_spent_usd: spend,
    cost_per_result: costPerResult,
    meta_purchases: parseActions(actions, "omni_purchase") || null,
    clicks_all: insight.clicks != null ? parseInt(insight.clicks, 10) : parseActions(actions, "link_click") || null,
    purchases: purchaseCount || null,
    inapp_purchase_roas: null,
    direct_website_purchases: parseActions(actions, "offsite_conversion.fb_pixel_purchase") || null,
    direct_website_purchases_value: parseActionValue(actionValues, "offsite_conversion.fb_pixel_purchase") || null,
    inapp_purchases_value: parseActionValue(actionValues, "mobile_app_purchase") || null,
    website_purchases: parseActions(actions, "offsite_conversion.fb_pixel_purchase") || null,
    offline_purchases: null,
    purchases_value: purchaseValue || null,
    shops_assisted_purchases: null,
    inapp_purchases: parseActions(actions, "mobile_app_purchase") || null,
    website_purchases_value: parseActionValue(actionValues, "offsite_conversion.fb_pixel_purchase") || null,
    offline_purchases_value: null,
    meta_purchase_value: parseActionValue(actionValues, "omni_purchase") || null,
    reporting_starts: dateFromStr,
    reporting_ends: dateToStr,
  };
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
      return defaultDateRange();
    };
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch { /* empty */ }
      const r = apply(
        body.date_from != null ? normalizeISODate(String(body.date_from)) : null,
        body.date_to != null ? normalizeISODate(String(body.date_to)) : null
      );
      dateFromStr = r.from;
      dateToStr = r.to;
    } else if (req.method === "GET") {
      const u = new URL(req.url);
      const r = apply(normalizeISODate(u.searchParams.get("date_from") || ""), normalizeISODate(u.searchParams.get("date_to") || ""));
      dateFromStr = r.from;
      dateToStr = r.to;
    } else {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const rawAccountId = getAdAccountId();
    const adAccountId = rawAccountId.toLowerCase().startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const fields = [
      "account_id", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
      "date_start", "date_stop", "impressions", "reach", "spend", "clicks", "frequency", "actions", "action_values",
    ].join(",");

    const insights = await graphGetAll<InsightRow>(
      `/${adAccountId}/insights`,
      {
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({ since: dateFromStr, until: dateToStr }),
        fields,
        breakdowns: "publisher_platform,platform_position",
        limit: "500",
      },
      (j) => j.data ?? []
    );

    const rows = insights
      .map((i) => toDataRow(i, accountId, dateFromStr, dateToStr))
      .filter((r): r is Record<string, unknown> => r != null);

    const dedupe = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const k = `${r.account_id}\0${r.ad_id}\0${r.day}\0${r.platform ?? ""}\0${r.placement ?? ""}\0${r.device_platform ?? ""}`;
      dedupe.set(k, r);
    }
    const uniqueRows = [...dedupe.values()];

    console.log(LOG, "insights", insights.length, "rows", uniqueRows.length);

    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { error: seqErr } = await supabase.rpc("reset_facebook_campaigns_data_sequence");
    if (seqErr) console.warn(LOG, "facebook_campaigns_data sequence", seqErr.message);

    const BATCH = 500;
    const stripId = <T extends Record<string, unknown>>(row: T) => {
      const { id: _i, created_at: _c, ...rest } = row;
      return rest;
    };

    for (let i = 0; i < uniqueRows.length; i += BATCH) {
      const chunk = uniqueRows.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("facebook_campaigns_data").upsert(chunk, {
        onConflict: "account_id,ad_id,day,platform,placement,device_platform",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`facebook_campaigns_data upsert: ${error.message}`);
    }

    const uniqueCampaignNames = [...new Set(uniqueRows.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean))];
    if (uniqueCampaignNames.length > 0) {
      const { data: existing } = await supabase.from("facebook_campaigns_reference_data").select("campaign_name").in("campaign_name", uniqueCampaignNames);
      const existingSet = new Set((existing ?? []).map((r) => (r.campaign_name as string)?.trim()).filter(Boolean));
      const toInsert = uniqueCampaignNames.filter((n) => !existingSet.has(n)).map((campaign_name) => ({ campaign_name, campaign_id: null }));
      if (toInsert.length > 0) {
        const { error: seqErr } = await supabase.rpc("reset_facebook_campaigns_reference_sequence");
        if (seqErr) console.warn(LOG, "sequence", seqErr.message);
        const { error: refErr } = await supabase.from("facebook_campaigns_reference_data").insert(toInsert);
        if (refErr) throw new Error(`facebook_campaigns_reference_data: ${refErr.message}`);
      }
    }

    const syncedAt = new Date().toISOString();
    const rangeDates = eachDateInRange(dateFromStr, dateToStr);
    const hist = rangeDates.map((segment_date) => ({ account_id: accountId, segment_date, synced_at: syncedAt }));
    let historyWritten = false;
    for (let i = 0; i < hist.length; i += BATCH) {
      const { error } = await supabase.from("facebook_ads_sync_by_date").upsert(hist.slice(i, i + BATCH), {
        onConflict: "account_id,segment_date",
        ignoreDuplicates: false,
      });
      if (error) {
        if (isMissingTableError(error.message, "facebook_ads_sync_by_date")) {
          console.warn(LOG, "sync history table missing; skipping facebook_ads_sync_by_date writes");
          break;
        }
        throw new Error(`facebook_ads_sync_by_date: ${error.message}`);
      }
      historyWritten = true;
    }

    const runId = crypto.randomUUID();
    const logMeta = { insight_rows: uniqueRows.length };
    const logRows = hist.map((r) => ({
      platform: "facebook_ads",
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
    } else {
      console.warn(LOG, "history not written; skipping ads_sync_by_date_log writes");
    }

    const result = {
      ok: true,
      function: "fetch-facebook-campaigns-upsert",
      account_id: accountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      upserted: { rows: uniqueRows.length },
      sync_history_rows: historyWritten ? hist.length : 0,
      sync_history_skipped: !historyWritten,
      ads_sync_log_rows: logWritten ? logRows.length : 0,
      ads_sync_log_skipped: !logWritten,
      run_id: runId,
    };
    console.log(LOG, JSON.stringify(result));
    return new Response(JSON.stringify(result), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "fetch_facebook_campaigns_upsert_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
