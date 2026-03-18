// Google Ads sync with upsert + google_ads_sync_by_date history.
// Same secrets as sync-google-ads-data. POST body: { date_from, date_to } optional (default last 2 days).
// Requires migration 20250318120000_google_ads_upsert_and_sync_history.sql.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const API_VERSION = "v23";
const LOG = "[sync-google-ads-upsert]";
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
    /* NDJSON */
  }
  const lines = trimmed.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const batch = JSON.parse(line) as { results?: Record<string, unknown>[] };
      if (batch?.results) rows.push(...batch.results);
    } catch {
      /* skip */
    }
  }
  return rows;
}

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
          /* skip */
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

function toAdGroupRow(r: Record<string, unknown>, customerId: string): Record<string, unknown> {
  const campaign = (r.campaign as Record<string, unknown>) ?? {};
  const adGroup = (r.adGroup as Record<string, unknown>) ?? {};
  const segments = (r.segments as Record<string, unknown>) ?? {};
  const metrics = (r.metrics as Record<string, unknown>) ?? {};
  return {
    customer_id: customerId,
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

function toKeywordRow(r: Record<string, unknown>, customerId: string): Record<string, unknown> {
  const campaign = (r.campaign as Record<string, unknown>) ?? {};
  const adGroup = (r.adGroup as Record<string, unknown>) ?? {};
  const adGroupCriterion = (r.adGroupCriterion as Record<string, unknown>) ?? {};
  const keyword = (adGroupCriterion.keyword as Record<string, unknown>) ?? {};
  const segments = (r.segments as Record<string, unknown>) ?? {};
  const metrics = (r.metrics as Record<string, unknown>) ?? {};
  return {
    customer_id: customerId,
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
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 2);
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
  console.log(LOG, "Request", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    let dateFromStr: string;
    let dateToStr: string;

    const applyRange = (df: string | null, dt: string | null) => {
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
      } catch {
        /* empty */
      }
      const df = body.date_from != null ? normalizeISODate(String(body.date_from)) : null;
      const dt = body.date_to != null ? normalizeISODate(String(body.date_to)) : null;
      const r = applyRange(df, dt);
      dateFromStr = r.from;
      dateToStr = r.to;
    } else if (req.method === "GET") {
      const u = new URL(req.url);
      const df = normalizeISODate(u.searchParams.get("date_from") || "");
      const dt = normalizeISODate(u.searchParams.get("date_to") || "");
      const r = applyRange(df, dt);
      dateFromStr = r.from;
      dateToStr = r.to;
    } else {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const developerToken = getEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
    const loginCustomerId = getEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const accessToken = await getAccessToken();

    let customers: { id: string; name: string }[];
    const singleId = Deno.env.get("GOOGLE_ADS_CUSTOMER_ID");
    if (singleId) {
      customers = [{ id: singleId.replace(/-/g, ""), name: `Customer ${singleId}` }];
      console.log(LOG, "GOOGLE_ADS_CUSTOMER_ID", singleId);
    } else {
      const clients = await getClientCustomerIds(accessToken, loginCustomerId, developerToken);
      if (clients.length > 0) {
        customers = clients;
        console.log(LOG, clients.length, "client(s)", loginCustomerId);
      } else {
        customers = [{ id: loginCustomerId, name: `Customer ${loginCustomerId}` }];
        console.log(LOG, "login_customer_id as customer", loginCustomerId);
      }
    }

    console.log(LOG, "Range", dateFromStr, "→", dateToStr);

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

    const allCampaignRows: Record<string, unknown>[] = [];
    const allAdGroupRows: Record<string, unknown>[] = [];
    const allKeywordRows: Record<string, unknown>[] = [];

    for (const customer of customers) {
      const [campaignRows, adGroupRows, keywordRows] = await Promise.all([
        searchStream(accessToken, customer.id, campaignQuery, loginCustomerId, developerToken),
        searchStream(accessToken, customer.id, adGroupQuery, loginCustomerId, developerToken),
        searchStream(accessToken, customer.id, keywordQuery, loginCustomerId, developerToken),
      ]);
      console.log(LOG, "Customer", customer.id, campaignRows.length, adGroupRows.length, keywordRows.length);
      for (const r of campaignRows) {
        allCampaignRows.push({ ...r, __customerId: customer.id, __customerName: customer.name });
      }
      for (const r of adGroupRows) {
        allAdGroupRows.push(toAdGroupRow(r, customer.id));
      }
      for (const r of keywordRows) {
        allKeywordRows.push(toKeywordRow(r, customer.id));
      }
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const dedupeCampaigns = (rows: Record<string, unknown>[]) => {
      const m = new Map<string, Record<string, unknown>>();
      for (const r of rows) {
        const k = `${r.customer_id}\0${r.campaign_id}\0${r.segment_date}\0${r.network_type ?? ""}`;
        m.set(k, r);
      }
      return [...m.values()];
    };
    const dedupeAdGroups = (rows: Record<string, unknown>[]) => {
      const m = new Map<string, Record<string, unknown>>();
      for (const r of rows) {
        const k = `${r.customer_id}\0${r.campaign_id}\0${r.ad_group_id}\0${r.segment_date}`;
        m.set(k, r);
      }
      return [...m.values()];
    };
    const dedupeKeywords = (rows: Record<string, unknown>[]) => {
      const m = new Map<string, Record<string, unknown>>();
      for (const r of rows) {
        const k = `${r.customer_id}\0${r.campaign_id}\0${r.ad_group_id}\0${r.criterion_id}\0${r.segment_date}`;
        m.set(k, r);
      }
      return [...m.values()];
    };

    const campaignsPayload = dedupeCampaigns(
      allCampaignRows.map((r) => {
        const { __customerId, __customerName, ...rest } = r as Record<string, unknown> & {
          __customerId: string;
          __customerName: string;
        };
        return toCampaignRow(rest, __customerId, __customerName);
      })
    );
    const adGroupsPayload = dedupeAdGroups(allAdGroupRows);
    const keywordsPayload = dedupeKeywords(allKeywordRows);

    const BATCH = 500;
    const stripId = <T extends Record<string, unknown>>(row: T): Omit<T, "id"> => {
      const { id: _id, ...rest } = row;
      return rest as Omit<T, "id">;
    };

    for (let i = 0; i < campaignsPayload.length; i += BATCH) {
      const chunk = campaignsPayload.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("google_campaigns_data").upsert(chunk, {
        onConflict: "customer_id,campaign_id,segment_date,network_type",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`Campaigns upsert: ${error.message}`);
    }

    const uniqueCampaignNames = [...new Set(
      campaignsPayload.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean)
    )];
    if (uniqueCampaignNames.length > 0) {
      const { data: existing } = await supabase
        .from("google_campaigns_reference_data")
        .select("campaign_name")
        .in("campaign_name", uniqueCampaignNames);
      const existingSet = new Set((existing ?? []).map((r) => (r.campaign_name as string)?.trim()).filter(Boolean));
      const toInsert = uniqueCampaignNames
        .filter((name) => !existingSet.has(name))
        .map((campaign_name) => ({ campaign_name }));
      if (toInsert.length > 0) {
        const { error: refErr } = await supabase.from("google_campaigns_reference_data").insert(toInsert);
        if (refErr) throw new Error(`Reference data insert: ${refErr.message}`);
        console.log(LOG, "reference_data +", toInsert.length);
      }
    }
    for (let i = 0; i < adGroupsPayload.length; i += BATCH) {
      const chunk = adGroupsPayload.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("google_ad_groups_data").upsert(chunk, {
        onConflict: "customer_id,campaign_id,ad_group_id,segment_date",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`Ad groups upsert: ${error.message}`);
    }
    for (let i = 0; i < keywordsPayload.length; i += BATCH) {
      const chunk = keywordsPayload.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("google_keywords_data").upsert(chunk, {
        onConflict: "customer_id,campaign_id,ad_group_id,criterion_id,segment_date",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`Keywords upsert: ${error.message}`);
    }

    const syncedAt = new Date().toISOString();
    const rangeDates = eachDateInRange(dateFromStr, dateToStr);
    const syncHistoryRows: { customer_id: string; segment_date: string; synced_at: string }[] = [];
    for (const c of customers) {
      for (const segment_date of rangeDates) {
        syncHistoryRows.push({ customer_id: c.id, segment_date, synced_at: syncedAt });
      }
    }
    for (let i = 0; i < syncHistoryRows.length; i += BATCH) {
      const chunk = syncHistoryRows.slice(i, i + BATCH);
      const { error: histErr } = await supabase.from("google_ads_sync_by_date").upsert(chunk, {
        onConflict: "customer_id,segment_date",
        ignoreDuplicates: false,
      });
      if (histErr) throw new Error(`Sync history upsert: ${histErr.message}`);
    }

    const result = {
      ok: true,
      function: "sync-google-ads-upsert",
      date_from: dateFromStr,
      date_to: dateToStr,
      customers_synced: customers.length,
      customer_ids: customers.map((c) => c.id),
      upserted: {
        campaigns: campaignsPayload.length,
        ad_groups: adGroupsPayload.length,
        keywords: keywordsPayload.length,
      },
      sync_history_rows: syncHistoryRows.length,
    };
    console.log(LOG, "Success", JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, "Error", message);
    return new Response(
      JSON.stringify({ error: "sync_google_ads_upsert_failed", message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
