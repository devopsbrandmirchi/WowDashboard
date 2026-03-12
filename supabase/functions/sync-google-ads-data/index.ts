// Sync Google Ads data into Supabase (campaigns, ad groups, keywords) via REST API.
// Set env: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
// GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_CUSTOMER_ID (optional).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API_VERSION = "v23";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OAuth failed: ${res.status} ${t}`);
  }
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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google Ads API failed: ${res.status} ${t}`);
  }
  const text = await res.text();
  const rows: Record<string, unknown>[] = [];
  // Google Ads searchStream can return either a single JSON array or NDJSON (one object per line)
  const trimmed = text.trim();
  if (!trimmed) return rows;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      for (const b of parsed) {
        const batch = b as { results?: Record<string, unknown>[] };
        if (batch?.results) rows.push(...batch.results);
      }
      return rows;
    }
  } catch {
    // Not a single JSON array, fall through to NDJSON parsing
  }
  const lines = trimmed.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const batch = JSON.parse(line) as { results?: Record<string, unknown>[] };
      if (batch?.results) rows.push(...batch.results);
    } catch {
      // Skip malformed lines
    }
  }
  return rows;
}

/** Get client customer IDs under the manager (login_customer_id). Use manager as customer_id in URL. */
async function getClientCustomerIds(
  accessToken: string,
  managerCustomerId: string,
  developerToken: string
): Promise<{ id: string; name: string }[]> {
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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`List client customers failed: ${res.status} ${t}`);
  }
  const text = await res.text();
  const clients: { id: string; name: string }[] = [];
  const pushResults = (batch: { results?: Record<string, unknown>[] }) => {
    if (!batch?.results) return;
    for (const r of batch.results) {
      const cc = (r.customerClient as Record<string, unknown>) ?? {};
      const id = cc.id;
      if (id != null) {
        clients.push({
          id: String(id).replace(/-/g, ""),
          name: (cc.descriptiveName as string) ?? `Customer ${id}`,
        });
      }
    }
  };
  const trimmed = text.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        for (const b of parsed) {
          pushResults(b as { results?: Record<string, unknown>[] });
        }
      } else {
        pushResults(parsed as { results?: Record<string, unknown>[] });
      }
    } catch {
      const lines = trimmed.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          pushResults(JSON.parse(line) as { results?: Record<string, unknown>[] });
        } catch {
          // skip
        }
      }
    }
  }
  return clients;
}

function toCampaignRow(r: Record<string, unknown>, customerId: string, customerName: string): Record<string, unknown> {
  const campaign = (r.campaign as Record<string, unknown>) ?? {};
  const segments = (r.segments as Record<string, unknown>) ?? {};
  const metrics = (r.metrics as Record<string, unknown>) ?? {};
  const campaignBudget = (r.campaignBudget as Record<string, unknown>) ?? {};
  const customer = (r.customer as Record<string, unknown>) ?? {};
  const segDate = segments.date as string | undefined;
  return {
    customer_id: customerId,
    customer_name: customerName,
    campaign_id: campaign.id ?? null,
    campaign_name: (campaign.name as string) ?? null,
    segment_date: segDate ?? null,
    currency: (customer.currencyCode as string) ?? (campaign as Record<string, unknown>).currencyCode ?? null,
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

function toAdGroupRow(r: Record<string, unknown>): Record<string, unknown> {
  const campaign = (r.campaign as Record<string, unknown>) ?? {};
  const adGroup = (r.adGroup as Record<string, unknown>) ?? {};
  const segments = (r.segments as Record<string, unknown>) ?? {};
  const metrics = (r.metrics as Record<string, unknown>) ?? {};
  return {
    campaign_id: campaign.id ?? null,
    campaign_name: (campaign.name as string) ?? null,
    ad_group_id: adGroup.id ?? null,
    ad_group_name: (adGroup.name as string) ?? null,
    ad_group_status: (adGroup.status as string) ?? null,
    ad_group_type: (adGroup.type as string) ?? null,
    segment_date: (segments.date as string) ?? null,
    impressions: metrics.impressions ?? null,
    clicks: metrics.clicks ?? null,
    cost_micros: metrics.costMicros ?? null,
  };
}

function toKeywordRow(r: Record<string, unknown>): Record<string, unknown> {
  const campaign = (r.campaign as Record<string, unknown>) ?? {};
  const adGroup = (r.adGroup as Record<string, unknown>) ?? {};
  const adGroupCriterion = (r.adGroupCriterion as Record<string, unknown>) ?? {};
  const keyword = (adGroupCriterion.keyword as Record<string, unknown>) ?? {};
  const segments = (r.segments as Record<string, unknown>) ?? {};
  const metrics = (r.metrics as Record<string, unknown>) ?? {};
  return {
    campaign_id: campaign.id ?? null,
    ad_group_id: adGroup.id ?? null,
    criterion_id: adGroupCriterion.criterionId ?? null,
    keyword_text: (keyword.text as string) ?? null,
    keyword_match_type: (keyword.matchType as string) ?? null,
    criterion_status: (adGroupCriterion.status as string) ?? null,
    segment_date: (segments.date as string) ?? null,
    impressions: metrics.impressions ?? null,
    clicks: metrics.clicks ?? null,
    cost_micros: metrics.costMicros ?? null,
    conversions: metrics.conversions ?? null,
  };
}

Deno.serve(async (req: Request) => {
  console.log("[sync-google-ads-data] Request received", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const developerToken = getEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
    const loginCustomerId = getEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const accessToken = await getAccessToken();

    // Resolve which customer(s) to sync: single ID from env, or all clients under the manager
    let customers: { id: string; name: string }[];
    const singleId = Deno.env.get("GOOGLE_ADS_CUSTOMER_ID");
    if (singleId) {
      customers = [{ id: singleId.replace(/-/g, ""), name: `Customer ${singleId}` }];
      console.log("[sync-google-ads-data] Using GOOGLE_ADS_CUSTOMER_ID", singleId);
    } else {
      const clients = await getClientCustomerIds(accessToken, loginCustomerId, developerToken);
      if (clients.length > 0) {
        customers = clients;
        console.log("[sync-google-ads-data] Found", clients.length, "client(s) under manager", loginCustomerId);
      } else {
        // No linked clients: use manager as the account to query (e.g. single non-manager account)
        customers = [{ id: loginCustomerId, name: `Customer ${loginCustomerId}` }];
        console.log("[sync-google-ads-data] No client list, using login_customer_id", loginCustomerId);
      }
    }

    // Date range: last 2 days (yesterday and the day before)
    const now = new Date();
    const dateTo = new Date(now);
    dateTo.setDate(dateTo.getDate() - 1);
    const dateFrom = new Date(now);
    dateFrom.setDate(dateFrom.getDate() - 2);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    const dateToStr = dateTo.toISOString().slice(0, 10);

    const campaignQuery = `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign.optimization_score,
        campaign_budget.amount_micros,
        segments.date,
        segments.ad_network_type,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.all_conversions,
        metrics.cost_per_conversion,
        metrics.cost_per_all_conversions,
        metrics.interactions,
        metrics.interaction_rate,
        metrics.invalid_clicks,
        metrics.search_impression_share,
        metrics.search_top_impression_share,
        metrics.search_click_share,
        metrics.search_exact_match_impression_share,
        metrics.content_impression_share,
        metrics.phone_calls,
        metrics.average_cpm
      FROM campaign
      WHERE segments.date BETWEEN '${dateFromStr}' AND '${dateToStr}'
        AND campaign.status != 'REMOVED'
    `;

    const adGroupQuery = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      FROM ad_group
      WHERE segments.date BETWEEN '${dateFromStr}' AND '${dateToStr}'
        AND ad_group.status != 'REMOVED'
    `;

    const keywordQuery = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM keyword_view
      WHERE segments.date BETWEEN '${dateFromStr}' AND '${dateToStr}'
        AND ad_group_criterion.status != 'REMOVED'
    `;

    // Fetch data for each customer (manager's client accounts or single ID)
    const allCampaignRows: Record<string, unknown>[] = [];
    const allAdGroupRows: Record<string, unknown>[] = [];
    const allKeywordRows: Record<string, unknown>[] = [];

    for (const customer of customers) {
      const [campaignRows, adGroupRows, keywordRows] = await Promise.all([
        searchStream(accessToken, customer.id, campaignQuery, loginCustomerId, developerToken),
        searchStream(accessToken, customer.id, adGroupQuery, loginCustomerId, developerToken),
        searchStream(accessToken, customer.id, keywordQuery, loginCustomerId, developerToken),
      ]);
      console.log(
        "[sync-google-ads-data] Customer",
        customer.id,
        "API rows: campaigns=" + campaignRows.length,
        "ad_groups=" + adGroupRows.length,
        "keywords=" + keywordRows.length
      );
      // Tag campaign rows with this customer for insert
      for (const r of campaignRows) {
        allCampaignRows.push({ ...r, __customerId: customer.id, __customerName: customer.name });
      }
      allAdGroupRows.push(...adGroupRows);
      allKeywordRows.push(...keywordRows);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const campaignsPayload = allCampaignRows.map((r) => {
      const { __customerId, __customerName, ...rest } = r as Record<string, unknown> & { __customerId: string; __customerName: string };
      return toCampaignRow(rest, __customerId, __customerName);
    });
    const adGroupsPayload = allAdGroupRows.map(toAdGroupRow);
    const keywordsPayload = allKeywordRows.map(toKeywordRow);

    // Delete existing rows for this date range so re-sync replaces data (no unique constraints needed)
    const customerIds = customers.map((c) => Number(c.id) || c.id);
    const { error: delCampErr } = await supabase
      .from("google_campaigns_data")
      .delete()
      .in("customer_id", customerIds)
      .gte("segment_date", dateFromStr)
      .lte("segment_date", dateToStr);
    if (delCampErr) throw new Error(`Campaigns delete: ${delCampErr.message}`);

    const campaignIds = [...new Set(campaignsPayload.map((r) => r.campaign_id).filter(Boolean))].map((x) => Number(x) || x);
    if (campaignIds.length > 0) {
      const { error: delAdErr } = await supabase
        .from("google_ad_groups_data")
        .delete()
        .in("campaign_id", campaignIds)
        .gte("segment_date", dateFromStr)
        .lte("segment_date", dateToStr);
      if (delAdErr) throw new Error(`Ad groups delete: ${delAdErr.message}`);

      const { error: delKwErr } = await supabase
        .from("google_keywords_data")
        .delete()
        .in("campaign_id", campaignIds)
        .gte("segment_date", dateFromStr)
        .lte("segment_date", dateToStr);
      if (delKwErr) throw new Error(`Keywords delete: ${delKwErr.message}`);
    }

    // Reset identity sequences so next INSERT gets new ids (avoids duplicate key on pkey)
    const { error: seqErr } = await supabase.rpc("reset_google_ads_data_sequences");
    if (seqErr) {
      console.warn("[sync-google-ads-data] Sequence reset failed (run migration 20250311120000 if needed):", seqErr.message);
    }

    const BATCH = 500;
    const stripId = <T extends Record<string, unknown>>(row: T): Omit<T, "id"> => {
      const { id: _id, ...rest } = row;
      return rest as Omit<T, "id">;
    };
    for (let i = 0; i < campaignsPayload.length; i += BATCH) {
      const chunk = campaignsPayload.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("google_campaigns_data").insert(chunk);
      if (error) throw new Error(`Campaigns insert: ${error.message}`);
    }
    for (let i = 0; i < adGroupsPayload.length; i += BATCH) {
      const chunk = adGroupsPayload.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("google_ad_groups_data").insert(chunk);
      if (error) throw new Error(`Ad groups insert: ${error.message}`);
    }
    for (let i = 0; i < keywordsPayload.length; i += BATCH) {
      const chunk = keywordsPayload.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("google_keywords_data").insert(chunk);
      if (error) throw new Error(`Keywords insert: ${error.message}`);
    }

    const result = {
      ok: true,
      customers_synced: customers.length,
      customer_ids: customers.map((c) => c.id),
      inserted: {
        campaigns: campaignsPayload.length,
        ad_groups: adGroupsPayload.length,
        keywords: keywordsPayload.length,
      },
    };
    console.log("[sync-google-ads-data] Success", JSON.stringify(result));
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-google-ads-data] Error", message);
    return new Response(
      JSON.stringify({ error: "sync_google_ads_failed", message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
