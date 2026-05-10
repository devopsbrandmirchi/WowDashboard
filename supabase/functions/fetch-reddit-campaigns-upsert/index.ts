// Reddit Ads sync: upsert + reddit_ads_sync_by_date (original: fetch-reddit-campaigns).
// Secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN, REDDIT_ACCOUNT_ID.
// POST { date_from?, date_to? } or GET ?date_from=&date_to= (default: last 2 days).
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

async function fetchReport(
  accessToken: string,
  customerId: string,
  dateStr: string,
  breakdowns: string[]
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

function pickCountry(r: Record<string, unknown>): string | null {
  const candidates = ["country", "country_code", "geo_country", "geography_country"];
  for (const k of candidates) {
    const v = r[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickReferenceCountryByCampaign(
  rows: { campaign_name: string | null; country: string | null; impressions: number }[],
): Map<string, string> {
  const byCampaign = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const cn = row.campaign_name?.trim();
    const co = row.country?.trim();
    if (!cn || !co) continue;
    if (!byCampaign.has(cn)) byCampaign.set(cn, new Map());
    const m = byCampaign.get(cn)!;
    m.set(co, (m.get(co) ?? 0) + row.impressions);
  }
  const out = new Map<string, string>();
  for (const [campaignName, countryMap] of byCampaign) {
    let best = "";
    let bestImp = -1;
    for (const [country, imp] of countryMap) {
      if (imp > bestImp) {
        bestImp = imp;
        best = country;
      }
    }
    if (best) out.set(campaignName, best);
  }
  return out;
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
    const key = `${r.account_id}|${r.campaign_id}|${r.campaign_date}|${r.placement ?? ""}`;
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

    const accountId = getAccountId();
    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const accessToken = await getAccessToken();

    const [campaignNames, adGroupNames] = await Promise.all([
      loadNames(accessToken, accountId, "campaigns"),
      loadNames(accessToken, accountId, "ad_groups"),
    ]);
    console.log(LOG, "names", Object.keys(campaignNames).length, Object.keys(adGroupNames).length);

    const dates = eachDateInRange(dateFromStr, dateToStr);
    const adGroupRows: Record<string, unknown>[] = [];
    const placementRows: Record<string, unknown>[] = [];

    for (const dateStr of dates) {
      try {
        const rows = await fetchReport(accessToken, accountId, dateStr, ["DATE", "CAMPAIGN_ID", "AD_GROUP_ID", "COUNTRY"]);
        for (const r of rows) {
          if (!r.date) continue;
          const cid = String(r.campaign_id ?? "");
          const agid = String(r.ad_group_id ?? "");
          adGroupRows.push({
            account_id: accountId,
            campaign_name: campaignNames[cid] ?? null,
            ad_group_name: adGroupNames[agid] ?? null,
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
        const rows = await fetchReport(accessToken, accountId, dateStr, ["DATE", "CAMPAIGN_ID", "PLACEMENT"]);
        for (const r of rows) {
          if (!r.date || !r.placement) continue;
          const cid = String(r.campaign_id ?? "");
          placementRows.push({
            account_id: accountId,
            campaign_id: cid || null,
            placement: String(r.placement),
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
    const dedupedPlacement = dedupePlacementRows(placementRows).filter((r) => r.campaign_id);

    // Impression-weighted majority country per campaign_name (used to seed
    // reddit_campaigns_reference_data.country for new campaigns).
    const countryByCampaignName = pickReferenceCountryByCampaign(
      dedupedAdGroup.map((r) => ({
        campaign_name: (r.campaign_name as string | null) ?? null,
        country: (r.country as string | null) ?? null,
        impressions: numOrZero(r.impressions),
      })),
    );

    // Clear pre-migration NULL-country rows inside the synced range so the
    // upsert that follows doesn't double-count alongside the new per-country rows.
    {
      const { error: cleanupErr } = await supabase
        .from("reddit_campaigns_ad_group")
        .delete()
        .eq("account_id", accountId)
        .gte("campaign_date", dateFromStr)
        .lte("campaign_date", dateToStr)
        .is("country", null);
      if (cleanupErr) throw new Error(`reddit_campaigns_ad_group null-country cleanup: ${cleanupErr.message}`);
    }

    const BATCH = 400;
    const stripId = <T extends Record<string, unknown>>(row: T) => {
      const { id: _i, ...rest } = row;
      return rest;
    };

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
      const { data: existing } = await supabase
        .from("reddit_campaigns_reference_data")
        .select("id,campaign_name,country")
        .in("campaign_name", uniqueCampaignNames);
      const existingByName = new Map(
        (existing ?? [])
          .map((r) => {
            const name = (r.campaign_name as string)?.trim();
            return name ? [name, r] as const : null;
          })
          .filter(Boolean) as [string, { id: number; campaign_name: string; country: string | null }][],
      );
      const toInsert = uniqueCampaignNames
        .filter((name) => !existingByName.has(name))
        .map((campaign_name) => ({
          campaign_name,
          country: countryByCampaignName.get(campaign_name) ?? null,
        }));
      if (toInsert.length > 0) {
        const { error: refErr } = await supabase.from("reddit_campaigns_reference_data").insert(toInsert);
        if (refErr) throw new Error(`reddit_campaigns_reference_data: ${refErr.message}`);
      }
      const toUpdate = uniqueCampaignNames
        .map((campaign_name) => {
          const existingRow = existingByName.get(campaign_name);
          const derivedCountry = countryByCampaignName.get(campaign_name)?.trim() || null;
          const existingCountry = existingRow?.country?.trim() || null;
          if (!existingRow || existingCountry || !derivedCountry) return null;
          return { id: existingRow.id, country: derivedCountry };
        })
        .filter((r): r is { id: number; country: string } => r != null);
      if (toUpdate.length > 0) {
        const { error: updateErr } = await supabase
          .from("reddit_campaigns_reference_data")
          .upsert(toUpdate, { onConflict: "id", ignoreDuplicates: false });
        if (updateErr) throw new Error(`reddit_campaigns_reference_data country update: ${updateErr.message}`);
      }
    }

    const syncedAt = new Date().toISOString();
    const hist = dates.map((segment_date) => ({ account_id: accountId, segment_date, synced_at: syncedAt }));
    for (let i = 0; i < hist.length; i += BATCH) {
      const { error } = await supabase.from("reddit_ads_sync_by_date").upsert(hist.slice(i, i + BATCH), {
        onConflict: "account_id,segment_date",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`reddit_ads_sync_by_date: ${error.message}`);
    }

    const runId = crypto.randomUUID();
    const logMeta = { ad_group_rows: dedupedAdGroup.length, placement_rows: dedupedPlacement.length };
    const logRows = hist.map((r) => ({
      platform: "reddit_ads",
      account_id: r.account_id,
      segment_date: r.segment_date,
      synced_at: r.synced_at,
      run_id: runId,
      date_range_start: dateFromStr,
      date_range_end: dateToStr,
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
      upserted: { ad_group_rows: dedupedAdGroup.length, placement_rows: dedupedPlacement.length },
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
