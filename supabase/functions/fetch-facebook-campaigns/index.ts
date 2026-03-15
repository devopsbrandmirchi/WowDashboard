// Sync Facebook/Meta Ads campaign data into Supabase via Graph API.
// Set env: FB_APP_ID, FB_APP_SECRET, FB_ACCESS_TOKEN (user or system token with ads_read), FB_AD_ACCOUNT_ID or FB_ACCOUNT_ID (act_xxx).
// Optional: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-set in Supabase Edge).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH_VERSION = "v18.0";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Ad account ID: FB_AD_ACCOUNT_ID or FB_ACCOUNT_ID (Supabase secret name may be either). */
function getAdAccountId(): string {
  const v = Deno.env.get("FB_AD_ACCOUNT_ID") ?? Deno.env.get("FB_ACCOUNT_ID");
  if (!v?.trim()) throw new Error("Missing env: FB_AD_ACCOUNT_ID or FB_ACCOUNT_ID");
  return v.trim();
}

/** Get app access token from FB_APP_ID and FB_APP_SECRET. Not sufficient for ad account reads; use FB_ACCESS_TOKEN for that. */
async function getAppAccessToken(): Promise<string> {
  const appId = getEnv("FB_APP_ID");
  const appSecret = getEnv("FB_APP_SECRET");
  const url = `https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Facebook OAuth failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  const token = json.access_token;
  if (!token) throw new Error("No access_token in Facebook OAuth response");
  return token;
}

/** Use FB_ACCESS_TOKEN if set (required for reading ad account); else fall back to app token (may fail for ads). */
async function getAccessToken(): Promise<string> {
  const userToken = Deno.env.get("FB_ACCESS_TOKEN");
  if (userToken?.trim()) return userToken.trim();
  return getAppAccessToken();
}

async function graphGet<T = unknown>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getAccessToken();
  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
  const pathClean = path.startsWith("/") ? path : `/${path}`;
  const search = new URLSearchParams({ ...params, access_token: token });
  const url = `${base}${pathClean}?${search}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Graph API ${path}: ${res.status} ${t}`);
  }
  return res.json() as Promise<T>;
}

/** Paginate through a Graph API edge (e.g. insights). */
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
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Graph API pagination: ${res.status} ${t}`);
    }
    const json = (await res.json()) as { data?: T[]; paging?: { next?: string } };
    const data = extractData(json);
    out.push(...data);
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

/** Map Graph API insight to public.facebook_campaigns_data row (all columns). */
function toDataRow(insight: InsightRow, accountId: string, dateFromStr: string, dateToStr: string): Record<string, unknown> {
  const actions = insight.actions ?? [];
  const actionValues = insight.action_values ?? [];
  const purchaseCount =
    (parseActions(actions, "purchase") ||
      parseActions(actions, "omni_purchase") ||
      parseActions(actions, "offsite_conversion.fb_pixel_purchase")) || 0;
  const purchaseValue =
    (parseActionValue(actionValues, "purchase") ||
      parseActionValue(actionValues, "omni_purchase") ||
      parseActionValue(actionValues, "offsite_conversion.fb_pixel_purchase")) || 0;
  const spend = insight.spend != null ? parseFloat(insight.spend) : null;
  const results = purchaseCount || parseActions(actions, "link_click") || null;
  const costPerResult = spend != null && results != null && results > 0 ? spend / results : null;

  return {
    account_id: accountId || insight.account_id || "",
    campaign_name: insight.campaign_name ?? null,
    adset_name: insight.adset_name ?? null,
    ad_name: insight.ad_name ?? null,
    placement: null,
    day: insight.date_start ?? null,
    campaign_id: insight.campaign_id ?? null,
    adset_id: insight.adset_id ?? null,
    ad_id: insight.ad_id ?? null,
    platform: null,
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

Deno.serve(async (req: Request) => {
  console.log("[fetch-facebook-campaigns] Request received", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const rawAccountId = getAdAccountId();
    const adAccountId = rawAccountId.toLowerCase().startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;
    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const now = new Date();
    const dateTo = new Date(now);
    dateTo.setDate(dateTo.getDate() - 1);
    const dateFrom = new Date(now);
    dateFrom.setDate(dateFrom.getDate() - 2);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    const dateToStr = dateTo.toISOString().slice(0, 10);

    const fields = [
      "account_id",
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
      "date_start",
      "date_stop",
      "impressions",
      "reach",
      "spend",
      "clicks",
      "frequency",
      "actions",
      "action_values",
    ].join(",");

    const insights = await graphGetAll<InsightRow>(
      `/${adAccountId}/insights`,
      {
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({ since: dateFromStr, until: dateToStr }),
        fields,
        limit: "500",
      },
      (j) => j.data ?? []
    );

    console.log("[fetch-facebook-campaigns] Insights rows:", insights.length);

    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const rows = insights.map((i) => toDataRow(i, accountId, dateFromStr, dateToStr));

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await supabase
      .from("facebook_campaigns_data")
      .delete()
      .gte("day", dateFromStr)
      .lte("day", dateToStr)
      .eq("account_id", accountId);

    const BATCH = 500;
    const stripId = <T extends Record<string, unknown>>(row: T): Omit<T, "id" | "created_at"> => {
      const { id: _id, created_at: _ca, ...rest } = row;
      return rest as Omit<T, "id" | "created_at">;
    };
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("facebook_campaigns_data").insert(chunk);
      if (error) throw new Error(`facebook_campaigns_data insert: ${error.message}`);
    }

    const uniqueCampaignNames = [...new Set(rows.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean))];
    if (uniqueCampaignNames.length > 0) {
      const { data: existing } = await supabase
        .from("facebook_campaigns_reference_data")
        .select("campaign_name")
        .in("campaign_name", uniqueCampaignNames);
      const existingSet = new Set((existing ?? []).map((r) => (r.campaign_name as string)?.trim()).filter(Boolean));
      const toInsert = uniqueCampaignNames
        .filter((name) => !existingSet.has(name))
        .map((campaign_name) => ({ campaign_name, campaign_id: null }));
      if (toInsert.length > 0) {
        const { error: seqErr } = await supabase.rpc("reset_facebook_campaigns_reference_sequence");
        if (seqErr) console.warn("[fetch-facebook-campaigns] Sequence reset failed:", seqErr.message);
        const { error: refErr } = await supabase.from("facebook_campaigns_reference_data").insert(toInsert);
        if (refErr) throw new Error(`facebook_campaigns_reference_data insert: ${refErr.message}`);
        console.log("[fetch-facebook-campaigns] Inserted", toInsert.length, "into facebook_campaigns_reference_data");
      }
    }

    const result = {
      ok: true,
      account_id: accountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      inserted: { rows: rows.length },
    };
    console.log("[fetch-facebook-campaigns] Success", JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[fetch-facebook-campaigns] Error", message);
    return new Response(
      JSON.stringify({ error: "fetch_facebook_campaigns_failed", message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
