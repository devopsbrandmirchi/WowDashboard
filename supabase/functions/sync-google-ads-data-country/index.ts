import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API_VERSION = "v23";
const LOG = "[sync-google-ads-data-country]";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TABLES = {
  campaigns: "google_campaigns_data_country",
  adGroups: "google_ad_groups_data_country",
  keywords: "google_keywords_data_country",
};

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getAccessToken(): Promise<string> {
  const clientId = getEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_ADS_CLIENT_SECRET");
  const refreshToken = getEnv("GOOGLE_ADS_REFRESH_TOKEN");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token;
}

async function searchStream(
  accessToken: string,
  customerId: string,
  query: string,
  loginCustomerId: string,
  developerToken: string
): Promise<Record<string, unknown>[]> {
  const cid = customerId.replace(/-/g, "");
  const loginCid = loginCustomerId.replace(/-/g, "");
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${cid}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": loginCid,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Google Ads API failed: ${res.status} ${await res.text()}`);
  const text = (await res.text()).trim();
  if (!text) return [];

  const rows: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      for (const b of parsed) {
        const batch = b as { results?: Record<string, unknown>[] };
        if (batch?.results) rows.push(...batch.results);
      }
      return rows;
    }
  } catch {
    // Parse as NDJSON.
  }

  for (const line of text.split("\n").filter(Boolean)) {
    try {
      const batch = JSON.parse(line) as { results?: Record<string, unknown>[] };
      if (batch?.results) rows.push(...batch.results);
    } catch {
      // Skip malformed line.
    }
  }
  return rows;
}

async function getClientCustomerIds(accessToken: string, managerCustomerId: string, developerToken: string) {
  const mcc = managerCustomerId.replace(/-/g, "");
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${mcc}/googleAds:searchStream`;
  const query = `
    SELECT customer_client.id, customer_client.descriptive_name
    FROM customer_client
    WHERE customer_client.status = 'ENABLED'
      AND customer_client.manager = false
  `;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": mcc,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`List client customers failed: ${res.status} ${await res.text()}`);
  const text = (await res.text()).trim();
  if (!text) return [] as { id: string; name: string }[];

  const out: { id: string; name: string }[] = [];
  const push = (batch: { results?: Record<string, unknown>[] }) => {
    for (const r of batch?.results ?? []) {
      const cc = (r.customerClient as Record<string, unknown>) ?? {};
      if (cc.id != null) {
        out.push({
          id: String(cc.id).replace(/-/g, ""),
          name: String(cc.descriptiveName ?? `Customer ${cc.id}`),
        });
      }
    }
  };

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) for (const b of parsed) push(b as { results?: Record<string, unknown>[] });
    else push(parsed as { results?: Record<string, unknown>[] });
  } catch {
    for (const line of text.split("\n").filter(Boolean)) {
      try { push(JSON.parse(line) as { results?: Record<string, unknown>[] }); } catch { /* skip */ }
    }
  }
  return out;
}

async function getCampaignCountryMap(
  accessToken: string,
  customerId: string,
  loginCustomerId: string,
  developerToken: string
): Promise<Map<string, string>> {
  const locationQuery = `
    SELECT
      campaign.id,
      campaign_criterion.location.geo_target_constant
    FROM campaign_criterion
    WHERE campaign_criterion.type = LOCATION
      AND campaign_criterion.status != 'REMOVED'
  `;
  const locationRows = await searchStream(accessToken, customerId, locationQuery, loginCustomerId, developerToken);
  const campaignToGeoResources = new Map<string, Set<string>>();
  const allGeoResources = new Set<string>();

  for (const row of locationRows) {
    const campaign = (row.campaign as Record<string, unknown>) ?? {};
    const criterion = (row.campaignCriterion as Record<string, unknown>) ?? {};
    const location = (criterion.location as Record<string, unknown>) ?? {};
    const campaignId = campaign.id != null ? String(campaign.id) : null;
    const resourceName = location.geoTargetConstant != null ? String(location.geoTargetConstant) : null;
    if (!campaignId || !resourceName) continue;
    if (!campaignToGeoResources.has(campaignId)) campaignToGeoResources.set(campaignId, new Set<string>());
    campaignToGeoResources.get(campaignId)?.add(resourceName);
    allGeoResources.add(resourceName);
  }

  const geoResourceToCountry = new Map<string, string>();
  const resources = [...allGeoResources];
  const chunkSize = 200;
  for (let i = 0; i < resources.length; i += chunkSize) {
    const chunk = resources.slice(i, i + chunkSize);
    const inList = chunk.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(", ");
    const geoQuery = `
      SELECT
        geo_target_constant.resource_name,
        geo_target_constant.country_code
      FROM geo_target_constant
      WHERE geo_target_constant.resource_name IN (${inList})
    `;
    const geoRows = await searchStream(accessToken, customerId, geoQuery, loginCustomerId, developerToken);
    for (const row of geoRows) {
      const geo = (row.geoTargetConstant as Record<string, unknown>) ?? {};
      const resourceName = geo.resourceName != null ? String(geo.resourceName) : null;
      const countryCode = geo.countryCode != null ? String(geo.countryCode) : null;
      if (resourceName && countryCode) geoResourceToCountry.set(resourceName, countryCode);
    }
  }

  const campaignCountryMap = new Map<string, string>();
  for (const [campaignId, geoSet] of campaignToGeoResources.entries()) {
    for (const geoResource of geoSet) {
      const country = geoResourceToCountry.get(geoResource);
      if (country) {
        campaignCountryMap.set(campaignId, country);
        break;
      }
    }
  }
  return campaignCountryMap;
}

function toCampaignRow(
  r: Record<string, unknown>,
  customerId: string,
  customerName: string,
  campaignCountryMap: Map<string, string>
): Record<string, unknown> {
  const campaign = (r.campaign as Record<string, unknown>) ?? {};
  const segments = (r.segments as Record<string, unknown>) ?? {};
  const metrics = (r.metrics as Record<string, unknown>) ?? {};
  const campaignBudget = (r.campaignBudget as Record<string, unknown>) ?? {};
  const customer = (r.customer as Record<string, unknown>) ?? {};
  const campaignId = campaign.id != null ? String(campaign.id) : null;
  return {
    customer_id: customerId,
    customer_name: customerName,
    campaign_id: campaign.id ?? null,
    campaign_name: (campaign.name as string) ?? null,
    segment_date: (segments.date as string) ?? null,
    currency: (customer.currencyCode as string) ?? null,
    country: campaignId ? (campaignCountryMap.get(campaignId) ?? null) : null,
    budget: campaignBudget.amountMicros != null ? Number(campaignBudget.amountMicros) / 1e6 : null,
    campaign_status: (campaign.status as string) ?? null,
    channel_type: (campaign.advertisingChannelType as string) ?? null,
    strategy_type: (campaign.biddingStrategyType as string) ?? null,
    all_conversions: metrics.allConversions ?? null,
    conversions: metrics.conversions ?? null,
    cost_micros: metrics.costMicros ?? null,
    clicks: metrics.clicks ?? null,
    impressions: metrics.impressions ?? null,
    ctr: metrics.ctr ?? null,
    average_cpc: metrics.averageCpc ?? null,
    invalid_clicks: metrics.invalidClicks ?? null,
    interactions: metrics.interactions ?? null,
    interaction_rate: metrics.interactionRate ?? null,
    search_impression_share: metrics.searchImpressionShare ?? null,
    search_top_impression_share: metrics.searchTopImpressionShare ?? null,
    search_click_share: metrics.searchClickShare ?? null,
    search_exact_match_impression_share: metrics.searchExactMatchImpressionShare ?? null,
    content_impression_share: metrics.contentImpressionShare ?? null,
    cost_per_conversion: metrics.costPerConversion ?? null,
    cost_per_all_conversions: metrics.costPerAllConversions ?? null,
    phone_calls: metrics.phoneCalls ?? null,
    average_cpm: metrics.averageCpm ?? null,
    score: (campaign.optimizationScore as number) ?? null,
    network_type: (segments.adNetworkType as string) ?? null,
  };
}

function toAdGroupRow(r: Record<string, unknown>, customerId: string): Record<string, unknown> {
  const campaign = (r.campaign as Record<string, unknown>) ?? {};
  const adGroup = (r.adGroup as Record<string, unknown>) ?? {};
  const segments = (r.segments as Record<string, unknown>) ?? {};
  const metrics = (r.metrics as Record<string, unknown>) ?? {};
  return {
    customer_id: customerId, campaign_id: campaign.id ?? null, campaign_name: (campaign.name as string) ?? null,
    ad_group_id: adGroup.id ?? null, ad_group_name: (adGroup.name as string) ?? null, ad_group_status: (adGroup.status as string) ?? null,
    ad_group_type: (adGroup.type as string) ?? null, segment_date: (segments.date as string) ?? null,
    impressions: metrics.impressions ?? null, clicks: metrics.clicks ?? null, cost_micros: metrics.costMicros ?? null,
  };
}

function toKeywordRow(r: Record<string, unknown>, customerId: string): Record<string, unknown> {
  const campaign = (r.campaign as Record<string, unknown>) ?? {};
  const adGroup = (r.adGroup as Record<string, unknown>) ?? {};
  const adGroupCriterion = (r.adGroupCriterion as Record<string, unknown>) ?? {};
  const keyword = (adGroupCriterion.keyword as Record<string, unknown>) ?? {};
  const segments = (r.segments as Record<string, unknown>) ?? {};
  const metrics = (r.metrics as Record<string, unknown>) ?? {};
  return {
    customer_id: customerId, campaign_id: campaign.id ?? null, ad_group_id: adGroup.id ?? null,
    criterion_id: adGroupCriterion.criterionId ?? null, keyword_text: (keyword.text as string) ?? null,
    keyword_match_type: (keyword.matchType as string) ?? null, criterion_status: (adGroupCriterion.status as string) ?? null,
    segment_date: (segments.date as string) ?? null, impressions: metrics.impressions ?? null,
    clicks: metrics.clicks ?? null, cost_micros: metrics.costMicros ?? null, conversions: metrics.conversions ?? null,
  };
}

function normalizeISODate(s: string): string | null {
  const t = String(s).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + "T12:00:00.000Z");
  if (isNaN(d.getTime())) return null;
  return t;
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const dateTo = new Date(now);
  dateTo.setUTCDate(dateTo.getUTCDate() - 1);
  const dateFrom = new Date(now);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 5);
  return {
    from: dateFrom.toISOString().slice(0, 10),
    to: dateTo.toISOString().slice(0, 10),
  };
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
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    let dateFromStr: string;
    let dateToStr: string;
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json() as Record<string, unknown>;
      } catch {
        // Empty body uses defaults.
      }
      const df = body.date_from != null ? normalizeISODate(String(body.date_from)) : null;
      const dt = body.date_to != null ? normalizeISODate(String(body.date_to)) : null;
      if (df && dt) {
        if (df > dt) throw new Error("date_from must be on or before date_to");
        dateFromStr = df;
        dateToStr = dt;
      } else {
        const d = defaultDateRange();
        dateFromStr = d.from;
        dateToStr = d.to;
      }
    } else if (req.method === "GET") {
      const u = new URL(req.url);
      const df = normalizeISODate(u.searchParams.get("date_from") || "");
      const dt = normalizeISODate(u.searchParams.get("date_to") || "");
      if (df && dt) {
        if (df > dt) throw new Error("date_from must be on or before date_to");
        dateFromStr = df;
        dateToStr = dt;
      } else {
        const d = defaultDateRange();
        dateFromStr = d.from;
        dateToStr = d.to;
      }
    } else {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const developerToken = getEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
    const loginCustomerId = getEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const accessToken = await getAccessToken();

    let customers: { id: string; name: string }[];
    const singleId = Deno.env.get("GOOGLE_ADS_CUSTOMER_ID");
    if (singleId) customers = [{ id: singleId.replace(/-/g, ""), name: `Customer ${singleId}` }];
    else {
      const clients = await getClientCustomerIds(accessToken, loginCustomerId, developerToken);
      customers = clients.length > 0
        ? clients
        : [{ id: loginCustomerId, name: `Customer ${loginCustomerId}` }];
    }

    const campaignQuery = `SELECT customer.id, customer.descriptive_name, customer.currency_code, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.optimization_score, campaign_budget.amount_micros, segments.date, segments.ad_network_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.all_conversions, metrics.cost_per_conversion, metrics.cost_per_all_conversions, metrics.interactions, metrics.interaction_rate, metrics.invalid_clicks, metrics.search_impression_share, metrics.search_top_impression_share, metrics.search_click_share, metrics.search_exact_match_impression_share, metrics.content_impression_share, metrics.phone_calls, metrics.average_cpm FROM campaign WHERE segments.date BETWEEN '${dateFromStr}' AND '${dateToStr}' AND campaign.status != 'REMOVED'`;
    const adGroupQuery = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status, ad_group.type, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros FROM ad_group WHERE segments.date BETWEEN '${dateFromStr}' AND '${dateToStr}' AND ad_group.status != 'REMOVED'`;
    const keywordQuery = `SELECT campaign.id, campaign.name, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE segments.date BETWEEN '${dateFromStr}' AND '${dateToStr}' AND ad_group_criterion.status != 'REMOVED'`;

    const allCampaignRows: Record<string, unknown>[] = [];
    const allAdGroupRows: Record<string, unknown>[] = [];
    const allKeywordRows: Record<string, unknown>[] = [];
    for (const c of customers) {
      const campaignCountryMap = await getCampaignCountryMap(accessToken, c.id, loginCustomerId, developerToken);
      const [campaignRows, adGroupRows, keywordRows] = await Promise.all([
        searchStream(accessToken, c.id, campaignQuery, loginCustomerId, developerToken),
        searchStream(accessToken, c.id, adGroupQuery, loginCustomerId, developerToken),
        searchStream(accessToken, c.id, keywordQuery, loginCustomerId, developerToken),
      ]);
      for (const r of campaignRows) {
        allCampaignRows.push({
          ...r,
          __customerId: c.id,
          __customerName: c.name,
          __campaignCountryMap: campaignCountryMap,
        });
      }
      for (const r of adGroupRows) allAdGroupRows.push({ ...r, __customerId: c.id });
      for (const r of keywordRows) allKeywordRows.push({ ...r, __customerId: c.id });
    }

    const campaignsPayload = allCampaignRows.map((r) => {
      const { __customerId, __customerName, __campaignCountryMap, ...rest } = r as Record<string, unknown> & {
        __customerId: string;
        __customerName: string;
        __campaignCountryMap: Map<string, string>;
      };
      return toCampaignRow(rest, __customerId, __customerName, __campaignCountryMap);
    });
    const adGroupsPayload = allAdGroupRows.map((r) => {
      const { __customerId, ...rest } = r as Record<string, unknown> & { __customerId: string };
      return toAdGroupRow(rest, __customerId);
    });
    const keywordsPayload = allKeywordRows.map((r) => {
      const { __customerId, ...rest } = r as Record<string, unknown> & { __customerId: string };
      return toKeywordRow(rest, __customerId);
    });

    const customerIds = customers.map((c) => c.id);
    for (const table of [TABLES.campaigns, TABLES.adGroups, TABLES.keywords]) {
      const { error } = await supabase.from(table).delete().in("customer_id", customerIds).gte("segment_date", dateFromStr).lte("segment_date", dateToStr);
      if (error) throw new Error(`${table} delete: ${error.message}`);
    }

    const { error: seqErr } = await supabase.rpc("reset_google_ads_data_country_sequences");
    if (seqErr) console.warn(LOG, "Sequence reset warning:", seqErr.message);

    const BATCH = 500;
    const stripId = <T extends Record<string, unknown>>(row: T): Omit<T, "id"> => {
      const { id: _id, ...rest } = row;
      return rest as Omit<T, "id">;
    };
    for (let i = 0; i < campaignsPayload.length; i += BATCH) {
      const { error } = await supabase.from(TABLES.campaigns).insert(campaignsPayload.slice(i, i + BATCH).map(stripId));
      if (error) throw new Error(`Campaign insert: ${error.message}`);
    }
    for (let i = 0; i < adGroupsPayload.length; i += BATCH) {
      const { error } = await supabase.from(TABLES.adGroups).insert(adGroupsPayload.slice(i, i + BATCH).map(stripId));
      if (error) throw new Error(`Ad group insert: ${error.message}`);
    }
    for (let i = 0; i < keywordsPayload.length; i += BATCH) {
      const { error } = await supabase.from(TABLES.keywords).insert(keywordsPayload.slice(i, i + BATCH).map(stripId));
      if (error) throw new Error(`Keyword insert: ${error.message}`);
    }

    const runId = crypto.randomUUID();
    const rangeDates = eachDateInRange(dateFromStr, dateToStr);
    const syncedAt = new Date().toISOString();
    const accountCountryMap = new Map<string, Set<string>>();
    for (const row of campaignsPayload) {
      const accountId = row.customer_id != null ? String(row.customer_id) : null;
      const country = row.country != null ? String(row.country) : null;
      if (!accountId || !country) continue;
      if (!accountCountryMap.has(accountId)) accountCountryMap.set(accountId, new Set<string>());
      accountCountryMap.get(accountId)?.add(country);
    }
    const logMeta = {
      campaigns: campaignsPayload.length,
      ad_groups: adGroupsPayload.length,
      keywords: keywordsPayload.length,
    };
    const logRows: Record<string, unknown>[] = [];
    for (const c of customers) {
      const countries = [...(accountCountryMap.get(c.id) ?? new Set<string>())];
      for (const segmentDate of rangeDates) {
        logRows.push({
          platform: "google_ads_country",
          account_id: c.id,
          segment_date: segmentDate,
          synced_at: syncedAt,
          run_id: runId,
          date_range_start: dateFromStr,
          date_range_end: dateToStr,
          metadata: { ...logMeta, countries },
        });
      }
    }
    for (let i = 0; i < logRows.length; i += BATCH) {
      const { error: logErr } = await supabase.from("ads_sync_by_date_log").insert(logRows.slice(i, i + BATCH));
      if (logErr) throw new Error(`ads_sync_by_date_log insert: ${logErr.message}`);
    }

    return new Response(JSON.stringify({
      ok: true,
      function: "sync-google-ads-data-country",
      date_from: dateFromStr,
      date_to: dateToStr,
      run_id: runId,
      tables: TABLES,
      customers_synced: customers.length,
      inserted: { campaigns: campaignsPayload.length, ad_groups: adGroupsPayload.length, keywords: keywordsPayload.length },
    }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "sync_google_ads_data_country_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
