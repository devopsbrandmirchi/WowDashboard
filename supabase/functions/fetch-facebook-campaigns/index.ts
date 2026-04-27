// Sync Facebook/Meta Ads campaign data into Supabase via Graph API.
// App ID/secret: facebook_ads_integration_settings (fb_app_id, fb_app_secret) or FB_APP_ID / FB_APP_SECRET secrets.
// FB_ACCESS_TOKEN (user token), FB_AD_ACCOUNT_ID or FB_ACCOUNT_ID (act_xxx). SUPABASE_* auto-set on Edge.
//
// Tokens: Settings row access_token first, else FB_ACCESS_TOKEN secret, else app token.
// Short-lived user tokens expire in ~1–2 hours; use a long-lived user or system user token with ads_read for cron.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH_VERSION = "v19.0";
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

async function resolveFacebookAppCredentials(
  supabase: ReturnType<typeof createClient>
): Promise<{ appId: string; appSecret: string }> {
  const { data, error } = await supabase
    .from("facebook_ads_integration_settings")
    .select("fb_app_id, fb_app_secret")
    .eq("id", 1)
    .maybeSingle();
  const fromId = !error && data?.fb_app_id ? String(data.fb_app_id).trim() : "";
  const fromSecret = !error && data?.fb_app_secret ? String(data.fb_app_secret).trim() : "";
  const appId = fromId || Deno.env.get("FB_APP_ID")?.trim() || "";
  const appSecret = fromSecret || Deno.env.get("FB_APP_SECRET")?.trim() || "";
  if (!appId || !appSecret) {
    throw new Error(
      "Missing Facebook app credentials: set fb_app_id and fb_app_secret in facebook_ads_integration_settings (Settings) or FB_APP_ID / FB_APP_SECRET secrets."
    );
  }
  return { appId, appSecret };
}

/** App token from DB app fields or env. Not sufficient for ad account reads without ads_read user token. */
async function getAppAccessToken(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { appId, appSecret } = await resolveFacebookAppCredentials(supabase);
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

/** DB token (Settings) → env FB_ACCESS_TOKEN → app token */
async function resolveFacebookAccessToken(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const { data, error } = await supabase
    .from("facebook_ads_integration_settings")
    .select("access_token")
    .eq("id", 1)
    .maybeSingle();
  if (!error && data?.access_token && String(data.access_token).trim().length > 0) {
    return String(data.access_token).trim();
  }
  const userToken = Deno.env.get("FB_ACCESS_TOKEN");
  if (userToken?.trim()) return userToken.trim();
  return getAppAccessToken(supabase);
}

/** Thrown when FB_ACCESS_TOKEN is expired or invalid (Meta OAuthException 190). */
class FacebookTokenError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "FacebookTokenError";
  }
}

interface GraphErrorPayload {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

function throwIfFacebookAuthError(status: number, bodyText: string, context: string): void {
  let payload: GraphErrorPayload = {};
  try {
    payload = JSON.parse(bodyText) as GraphErrorPayload;
  } catch {
    /* keep raw message path */
  }
  const e = payload.error;
  const code = e?.code;
  const sub = e?.error_subcode;
  // 190 = OAuth invalid/expired; 463 = session expired; 467 = invalid access token
  const isToken = code === 190 || sub === 463 || sub === 467;
  if (isToken) {
    const meta = e?.message ?? bodyText;
    throw new FacebookTokenError(
      `${context}: Facebook access token is expired or invalid. In Dashboard → Settings → Facebook / Meta Ads, save a new token, or update the FB_ACCESS_TOKEN Edge Function secret. Use a long-lived user or system user token with ads_read. Meta said: ${meta}`
    );
  }
}

async function readGraphFailure(res: Response, context: string): Promise<never> {
  const t = await res.text();
  throwIfFacebookAuthError(res.status, t, context);
  throw new Error(`${context}: ${res.status} ${t}`);
}

async function graphGet<T = unknown>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
  const pathClean = path.startsWith("/") ? path : `/${path}`;
  const search = new URLSearchParams({ ...params, access_token: token });
  const url = `${base}${pathClean}?${search}`;
  const res = await fetch(url);
  if (!res.ok) await readGraphFailure(res, `Graph API ${path}`);
  return res.json() as Promise<T>;
}

/** Paginate through a Graph API edge (e.g. insights). */
async function graphGetAll<T>(
  token: string,
  path: string,
  params: Record<string, string>,
  extractData: (json: { data?: T[]; paging?: { next?: string } }) => T[] = (j) => j.data ?? []
): Promise<T[]> {
  const out: T[] = [];
  let nextUrl: string | null = `${path}?${new URLSearchParams(params)}`;

  while (nextUrl) {
    const fullUrl = nextUrl.startsWith("http") ? nextUrl : `https://graph.facebook.com/${GRAPH_VERSION}${nextUrl}`;
    const url = fullUrl.includes("access_token=") ? fullUrl : `${fullUrl}${fullUrl.includes("?") ? "&" : "?"}access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) await readGraphFailure(res, "Graph API pagination");
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
  /** Breakdown: facebook | instagram | audience_network | messenger */
  publisher_platform?: string;
  /** Breakdown: feed, story, reels, etc. */
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
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const graphToken = await resolveFacebookAccessToken(supabase);

    // Last 5 full days ending yesterday (excludes incomplete today); delete+insert for that window refreshes metrics and drops stale rows
    const now = new Date();
    const dateTo = new Date(now);
    dateTo.setDate(dateTo.getDate() - 1);
    const dateFrom = new Date(now);
    dateFrom.setDate(dateFrom.getDate() - 5);
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
      graphToken,
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

    console.log("[fetch-facebook-campaigns] Insights rows:", insights.length);

    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const rows = insights.map((i) => toDataRow(i, accountId, dateFromStr, dateToStr));

    await supabase
      .from("facebook_campaigns_data")
      .delete()
      .gte("day", dateFromStr)
      .lte("day", dateToStr)
      .eq("account_id", accountId);

    const { error: seqErr } = await supabase.rpc("reset_facebook_campaigns_data_sequence");
    if (seqErr) console.warn("[fetch-facebook-campaigns] Identity sequence reset failed:", seqErr.message);

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
    const isToken = err instanceof FacebookTokenError;
    return new Response(
      JSON.stringify({
        error: isToken ? "fb_access_token_expired" : "fetch_facebook_campaigns_failed",
        message,
      }),
      {
        status: isToken ? 401 : 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      }
    );
  }
});
