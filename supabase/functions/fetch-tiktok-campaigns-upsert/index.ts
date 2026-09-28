// TikTok Ads: sync report rows into tiktok_campaigns_data (+ reference campaign names, sync log).
// Secrets (set in Supabase Dashboard → Edge Functions):
//   TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID
// Optional: TIKTOK_API_URL (default https://business-api.tiktok.com/open_api/v1.3)
// POST { date_from?, date_to? } or GET ?date_from=&date_to= — default last 2 days.
// Requires migration 20250318220000_tiktok_campaigns_data_and_sync.sql
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const LOG = "[fetch-tiktok-campaigns-upsert]";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_API = "https://business-api.tiktok.com/open_api/v1.3";

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v?.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return Math.round(n);
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function parseStatDay(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d;
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

interface TikTokReportRow {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

interface TikTokReportResponse {
  code: number;
  message?: string;
  data?: {
    list?: TikTokReportRow[];
    page_info?: { page?: number; total_page?: number; total_number?: number };
  };
}

/** Dimensions/metrics: try placement breakdown; fall back without placement if API rejects. */
const METRICS_FULL = [
  "spend",
  "impressions",
  "clicks",
  "cpm",
  "ctr",
  "conversion",
  "cost_per_conversion",
  "complete_payment",
  "purchase_roas",
];
const METRICS_MIN = ["spend", "impressions", "clicks"];

/** TikTok report/integrated/get: max 4 dimensions (else code 40002). */
const DIM_PLACEMENT = ["stat_time_day", "ad_id", "placement_type"];
const DIM_AUDIENCE_PLACEMENT = ["stat_time_day", "ad_id", "placement"];
const DIM_BASE = ["stat_time_day", "ad_id"];

function isDimensionOrPlacementRejection(msg: string): boolean {
  return (
    /dimension|placement_type|\bplacement\b|length must be/i.test(msg) ||
    (/\b40002\b/.test(msg) && !/metric/i.test(msg))
  );
}

function rowsHaveAnyPlacement(rows: TikTokReportRow[]): boolean {
  for (const item of rows) {
    const d = item.dimensions ?? {};
    if (str(d.placement_type ?? d.placement) != null) return true;
  }
  return false;
}

interface AdEnrich {
  campaign_name: string | null;
  adgroup_name: string | null;
  ad_name: string | null;
  campaign_id: string | null;
  adgroup_id: string | null;
  objective_type: string | null;
}

async function fetchAdEnrichment(
  apiBase: string,
  token: string,
  advertiserId: string,
  adIds: string[]
): Promise<Map<string, AdEnrich>> {
  const map = new Map<string, AdEnrich>();
  const unique = [...new Set(adIds.map((x) => String(x).trim()).filter(Boolean))];
  const ID_CHUNK = 100;
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const ids = unique.slice(i, i + ID_CHUNK);
    const u = new URL(`${apiBase.replace(/\/$/, "")}/ad/get/`);
    u.searchParams.set("advertiser_id", advertiserId);
    // TikTok ad/get expects FilteringAdGet shape: { "ad_ids": ["..."] }, not [{ field, operator, value }].
    u.searchParams.set("filtering", JSON.stringify({ ad_ids: ids }));
    u.searchParams.set("page", "1");
    u.searchParams.set("page_size", "1000");
    try {
      const res = await fetch(u.toString(), { headers: { "Access-Token": token } });
      const json = (await res.json()) as {
        code?: number;
        message?: string;
        data?: { list?: Record<string, unknown>[] };
      };
      if (json.code !== 0) {
        console.warn(LOG, "ad/get", json.message);
        continue;
      }
      for (const a of json.data?.list ?? []) {
        const id = str(a.ad_id);
        if (!id) continue;
        map.set(id, {
          campaign_name: str(a.campaign_name),
          adgroup_name: str(a.adgroup_name),
          ad_name: str(a.ad_name),
          campaign_id: str(a.campaign_id),
          adgroup_id: str(a.adgroup_id),
          objective_type: str(a.objective_type),
        });
      }
    } catch (e) {
      console.warn(LOG, "ad/get", e);
    }
  }
  return map;
}

async function fetchTikTokReportPages(
  apiBase: string,
  token: string,
  advertiserId: string,
  startDate: string,
  endDate: string,
  withPlacement: boolean,
  metricsList: string[] = METRICS_FULL,
  reportType: "BASIC" | "AUDIENCE" = "BASIC",
  audiencePlacementDim: "placement" | "placement_type" = "placement",
): Promise<TikTokReportRow[]> {
  let dimensions: string[];
  if (!withPlacement) dimensions = [...DIM_BASE];
  else if (reportType === "BASIC") dimensions = [...DIM_PLACEMENT];
  else {
    dimensions = audiencePlacementDim === "placement" ? [...DIM_AUDIENCE_PLACEMENT] : [...DIM_PLACEMENT];
  }

  const metricsForRequest = reportType === "AUDIENCE" ? METRICS_MIN : metricsList;

  const out: TikTokReportRow[] = [];
  let page = 1;
  const pageSize = 1000;
  let totalPage = 1;

  const fetchPage = async (): Promise<TikTokReportResponse> => {
    const u = new URL(`${apiBase.replace(/\/$/, "")}/report/integrated/get/`);
    u.searchParams.set("advertiser_id", advertiserId);
    u.searchParams.set("service_type", "AUCTION");
    u.searchParams.set("report_type", reportType);
    u.searchParams.set("data_level", "AUCTION_AD");
    u.searchParams.set("start_date", startDate);
    u.searchParams.set("end_date", endDate);
    u.searchParams.set("page", String(page));
    u.searchParams.set("page_size", String(pageSize));
    u.searchParams.set("dimensions", JSON.stringify(dimensions));
    u.searchParams.set("metrics", JSON.stringify(metricsForRequest));
    const res = await fetch(u.toString(), { headers: { "Access-Token": token } });
    const text = await res.text();
    try {
      return JSON.parse(text) as TikTokReportResponse;
    } catch {
      throw new Error(`TikTok report: non-JSON ${res.status} ${text.slice(0, 200)}`);
    }
  };

  let json = await fetchPage();
  if (json.code !== 0) {
    const msg = json.message || "";
    if (reportType === "BASIC" && metricsList !== METRICS_MIN && /metric/i.test(msg)) {
      return fetchTikTokReportPages(
        apiBase,
        token,
        advertiserId,
        startDate,
        endDate,
        withPlacement,
        METRICS_MIN,
        "BASIC",
        audiencePlacementDim,
      );
    }
    if (withPlacement && isDimensionOrPlacementRejection(msg)) {
      if (reportType === "BASIC") {
        console.warn(LOG, "BASIC+placement rejected; trying AUDIENCE+placement:", msg.slice(0, 260));
        return fetchTikTokReportPages(
          apiBase,
          token,
          advertiserId,
          startDate,
          endDate,
          true,
          METRICS_FULL,
          "AUDIENCE",
          "placement",
        );
      }
      if (reportType === "AUDIENCE" && audiencePlacementDim === "placement") {
        console.warn(LOG, "AUDIENCE+placement rejected; trying AUDIENCE+placement_type:", msg.slice(0, 260));
        return fetchTikTokReportPages(
          apiBase,
          token,
          advertiserId,
          startDate,
          endDate,
          true,
          METRICS_FULL,
          "AUDIENCE",
          "placement_type",
        );
      }
      console.warn(
        LOG,
        "Placement breakdown unavailable; fetching ad/day without placement. API said:",
        msg.slice(0, 280),
      );
      return fetchTikTokReportPages(
        apiBase,
        token,
        advertiserId,
        startDate,
        endDate,
        false,
        METRICS_FULL,
        "BASIC",
        "placement",
      );
    }
    throw new Error(`TikTok report code ${json.code}: ${msg || "unknown"}`);
  }

  do {
    if (page > 1) json = await fetchPage();
    if (json.code !== 0) throw new Error(`TikTok report page ${page}: ${json.message}`);
    const list = json.data?.list ?? [];
    out.push(...list);
    totalPage = json.data?.page_info?.total_page ?? 1;
    page++;
  } while (page <= totalPage);

  if (withPlacement && reportType === "BASIC" && out.length > 0 && !rowsHaveAnyPlacement(out)) {
    console.warn(LOG, "BASIC report had no placement labels; trying AUDIENCE+placement", { rows: out.length });
    return fetchTikTokReportPages(
      apiBase,
      token,
      advertiserId,
      startDate,
      endDate,
      true,
      METRICS_FULL,
      "AUDIENCE",
      "placement",
    );
  }
  if (withPlacement && reportType === "AUDIENCE" && audiencePlacementDim === "placement" && !rowsHaveAnyPlacement(out)) {
    console.warn(LOG, "AUDIENCE+placement still blank; trying AUDIENCE+placement_type", { rows: out.length });
    return fetchTikTokReportPages(
      apiBase,
      token,
      advertiserId,
      startDate,
      endDate,
      true,
      METRICS_FULL,
      "AUDIENCE",
      "placement_type",
    );
  }
  if (withPlacement && reportType === "AUDIENCE" && audiencePlacementDim === "placement_type" && !rowsHaveAnyPlacement(out)) {
    console.warn(LOG, "Audience placement empty; falling back to ad/day without placement", { rows: out.length });
    return fetchTikTokReportPages(
      apiBase,
      token,
      advertiserId,
      startDate,
      endDate,
      false,
      METRICS_FULL,
      "BASIC",
      "placement",
    );
  }

  return out;
}

function rowToDb(
  item: TikTokReportRow,
  currency: string | null,
  enrich: Map<string, AdEnrich>
): Record<string, unknown> | null {
  const d = item.dimensions ?? {};
  const m = item.metrics ?? {};
  const date = parseStatDay(d.stat_time_day);
  const adId = str(d.ad_id);
  if (!date || !adId) return null;
  const e = enrich.get(adId);

  const spend = num(m.spend);
  const impressions = int(m.impressions);
  const clicks = int(m.clicks);
  let cpm = num(m.cpm);
  if (cpm == null && spend != null && impressions != null && impressions > 0) {
    cpm = (spend / impressions) * 1000;
  }
  let ctr = num(m.ctr);
  if (ctr == null && impressions && clicks != null && impressions > 0) {
    ctr = (clicks / impressions) * 100;
  }
  const conv = int(m.conversion);
  const totalPurchase = int(m.complete_payment ?? m.total_purchase);
  const roas = num(m.purchase_roas);

  return {
    campaign_name: str(d.campaign_name) ?? e?.campaign_name ?? null,
    campaign_id: str(d.campaign_id) ?? e?.campaign_id ?? null,
    campaign_type: str(d.objective_type ?? d.campaign_type) ?? e?.objective_type ?? null,
    ad_group_name: str(d.adgroup_name) ?? e?.adgroup_name ?? null,
    ad_group_id: str(d.adgroup_id) ?? e?.adgroup_id ?? null,
    ad_name: str(d.ad_name) ?? e?.ad_name ?? null,
    ad_id: adId,
    creative_url: null,
    date,
    placement: str(d.placement_type ?? d.placement),
    cost: spend,
    cpm,
    impressions: impressions ?? null,
    clicks: clicks ?? null,
    ctr,
    conversions: conv,
    cost_per_conversion: num(m.cost_per_conversion),
    total_purchase: totalPurchase,
    purchase_roas: roas,
    currency,
    country: null,
    product_type: null,
    show_event: null,
  };
}

interface CampaignDayTotal {
  campaign_id: string;
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
}

async function fetchCampaignDayTotals(
  apiBase: string,
  token: string,
  advertiserId: string,
  startDate: string,
  endDate: string,
): Promise<CampaignDayTotal[]> {
  const out: CampaignDayTotal[] = [];
  let page = 1;
  let totalPage = 1;
  do {
    const u = new URL(`${apiBase.replace(/\/$/, "")}/report/integrated/get/`);
    u.searchParams.set("advertiser_id", advertiserId);
    u.searchParams.set("service_type", "AUCTION");
    u.searchParams.set("report_type", "BASIC");
    u.searchParams.set("data_level", "AUCTION_CAMPAIGN");
    u.searchParams.set("start_date", startDate);
    u.searchParams.set("end_date", endDate);
    u.searchParams.set("page", String(page));
    u.searchParams.set("page_size", "1000");
    u.searchParams.set("dimensions", JSON.stringify(["stat_time_day", "campaign_id"]));
    u.searchParams.set("metrics", JSON.stringify(METRICS_MIN));
    const res = await fetch(u.toString(), { headers: { "Access-Token": token } });
    const json = (await res.json()) as TikTokReportResponse;
    if (json.code !== 0) throw new Error(`TikTok campaign report page ${page}: ${json.message}`);
    for (const item of json.data?.list ?? []) {
      const date = parseStatDay(item.dimensions?.stat_time_day);
      const campaignId = str(item.dimensions?.campaign_id);
      if (!date || !campaignId) continue;
      out.push({
        campaign_id: campaignId,
        date,
        cost: num(item.metrics?.spend) ?? 0,
        impressions: int(item.metrics?.impressions) ?? 0,
        clicks: int(item.metrics?.clicks) ?? 0,
      });
    }
    totalPage = json.data?.page_info?.total_page ?? 1;
    page++;
  } while (page <= totalPage);
  return out;
}

async function fetchCampaignNames(
  apiBase: string,
  token: string,
  advertiserId: string,
  campaignIds: string[],
): Promise<Map<string, { campaign_name: string | null; objective_type: string | null }>> {
  const map = new Map<string, { campaign_name: string | null; objective_type: string | null }>();
  const unique = [...new Set(campaignIds)];
  for (let i = 0; i < unique.length; i += 100) {
    const u = new URL(`${apiBase.replace(/\/$/, "")}/campaign/get/`);
    u.searchParams.set("advertiser_id", advertiserId);
    u.searchParams.set("filtering", JSON.stringify({ campaign_ids: unique.slice(i, i + 100) }));
    u.searchParams.set("page_size", "1000");
    try {
      const res = await fetch(u.toString(), { headers: { "Access-Token": token } });
      const json = (await res.json()) as { code?: number; message?: string; data?: { list?: Record<string, unknown>[] } };
      if (json.code !== 0) {
        console.warn(LOG, "campaign/get", json.message);
        continue;
      }
      for (const c of json.data?.list ?? []) {
        const id = str(c.campaign_id);
        if (id) map.set(id, { campaign_name: str(c.campaign_name), objective_type: str(c.objective_type) });
      }
    } catch (e) {
      console.warn(LOG, "campaign/get", e);
    }
  }
  return map;
}

/**
 * The ad-level report omits delivery TikTok cannot attribute to an ad, so ad rows sum below
 * the campaign and account totals shown in Ads Manager. Add one "(Campaign-level)" row per
 * campaign/day holding that gap so day and campaign totals match Ads Manager.
 */
async function campaignGapRows(
  apiBase: string,
  token: string,
  advertiserId: string,
  totals: CampaignDayTotal[],
  adRows: Record<string, unknown>[],
  currency: string | null,
): Promise<Record<string, unknown>[]> {
  const adSums = new Map<string, { cost: number; impressions: number; clicks: number }>();
  const names = new Map<string, { campaign_name: string | null; objective_type: string | null }>();
  for (const r of adRows) {
    const campaignId = str(r.campaign_id);
    if (!campaignId) continue;
    if (!names.has(campaignId)) {
      names.set(campaignId, { campaign_name: str(r.campaign_name), objective_type: str(r.campaign_type) });
    }
    const k = `${campaignId}\0${r.date}`;
    const s = adSums.get(k) ?? { cost: 0, impressions: 0, clicks: 0 };
    s.cost += num(r.cost) ?? 0;
    s.impressions += int(r.impressions) ?? 0;
    s.clicks += int(r.clicks) ?? 0;
    adSums.set(k, s);
  }

  const gaps = totals
    .map((t) => {
      const s = adSums.get(`${t.campaign_id}\0${t.date}`) ?? { cost: 0, impressions: 0, clicks: 0 };
      return {
        ...t,
        cost: Math.max(0, Math.round((t.cost - s.cost) * 100) / 100),
        impressions: Math.max(0, t.impressions - s.impressions),
        clicks: Math.max(0, t.clicks - s.clicks),
      };
    })
    .filter((g) => g.cost > 0 || g.impressions > 0 || g.clicks > 0);

  const missingNames = gaps.map((g) => g.campaign_id).filter((id) => !names.get(id)?.campaign_name);
  if (missingNames.length > 0) {
    for (const [id, v] of await fetchCampaignNames(apiBase, token, advertiserId, missingNames)) names.set(id, v);
  }

  return gaps.map((g) => ({
    campaign_name: names.get(g.campaign_id)?.campaign_name ?? null,
    campaign_id: g.campaign_id,
    campaign_type: names.get(g.campaign_id)?.objective_type ?? null,
    ad_group_name: null,
    ad_group_id: null,
    ad_name: "(Campaign-level)",
    ad_id: `campaign_${g.campaign_id}`,
    creative_url: null,
    date: g.date,
    placement: null,
    cost: g.cost,
    cpm: g.impressions > 0 ? (g.cost / g.impressions) * 1000 : null,
    impressions: g.impressions,
    clicks: g.clicks,
    ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : null,
    conversions: null,
    cost_per_conversion: null,
    total_purchase: null,
    purchase_roas: null,
    currency,
    country: null,
    product_type: null,
    show_event: null,
  }));
}

/** Compare stored day totals with TikTok campaign-level totals and record the result per day. */
async function reconcileDays(
  supabase: SupabaseClient,
  advertiserId: string,
  startDate: string,
  endDate: string,
  totals: CampaignDayTotal[],
): Promise<string[]> {
  type DayTotals = { cost: number; impressions: number; clicks: number };
  const add = (m: Map<string, DayTotals>, date: string, cost: number, impressions: number, clicks: number) => {
    const t = m.get(date) ?? { cost: 0, impressions: 0, clicks: 0 };
    t.cost += cost;
    t.impressions += impressions;
    t.clicks += clicks;
    m.set(date, t);
  };
  const api = new Map<string, DayTotals>();
  for (const t of totals) add(api, t.date, t.cost, t.impressions, t.clicks);

  const db = new Map<string, DayTotals>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("tiktok_campaigns_data")
      .select("id, date, cost, impressions, clicks")
      .gte("date", startDate)
      .lte("date", endDate)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`tiktok_campaigns_data reconcile: ${error.message}`);
    for (const r of data ?? []) {
      add(db, String(r.date).slice(0, 10), num(r.cost) ?? 0, int(r.impressions) ?? 0, int(r.clicks) ?? 0);
    }
    if (!data || data.length < PAGE) break;
  }

  const checkedAt = new Date().toISOString();
  const rows = eachDateInRange(startDate, endDate).map((date) => {
    const a = api.get(date) ?? { cost: 0, impressions: 0, clicks: 0 };
    const b = db.get(date) ?? { cost: 0, impressions: 0, clicks: 0 };
    return {
      platform: "tiktok",
      account_id: advertiserId,
      date,
      api_cost: Math.round(a.cost * 100) / 100,
      db_cost: Math.round(b.cost * 100) / 100,
      api_impressions: a.impressions,
      db_impressions: b.impressions,
      api_clicks: a.clicks,
      db_clicks: b.clicks,
      matched: Math.abs(a.cost - b.cost) < 0.01 && a.impressions === b.impressions && a.clicks === b.clicks,
      checked_at: checkedAt,
    };
  });
  const mismatched = rows.filter((r) => !r.matched);
  if (mismatched.length > 0) console.warn(LOG, "Day totals differ from campaign report:", JSON.stringify(mismatched));
  const { error: upErr } = await supabase
    .from("ads_daily_reconciliation")
    .upsert(rows, { onConflict: "platform,account_id,date" });
  if (upErr) console.warn(LOG, "ads_daily_reconciliation:", upErr.message);
  return mismatched.map((r) => r.date);
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
      const r = apply(
        normalizeISODate(u.searchParams.get("date_from") || ""),
        normalizeISODate(u.searchParams.get("date_to") || "")
      );
      dateFromStr = r.from;
      dateToStr = r.to;
    } else {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const token = getEnv("TIKTOK_ACCESS_TOKEN");
    const advertiserId = getEnv("TIKTOK_ADVERTISER_ID");
    const apiBase = (Deno.env.get("TIKTOK_API_URL") || DEFAULT_API).trim();

    let currency: string | null = null;
    try {
      const infoUrl = new URL(`${apiBase.replace(/\/$/, "")}/advertiser/info/`);
      infoUrl.searchParams.set("advertiser_ids", JSON.stringify([advertiserId]));
      const infoRes = await fetch(infoUrl.toString(), { headers: { "Access-Token": token } });
      const infoJson = (await infoRes.json()) as {
        code?: number;
        data?: { list?: Array<{ currency?: string }> };
      };
      if (infoJson.code === 0 && infoJson.data?.list?.[0]?.currency) {
        currency = infoJson.data.list[0].currency;
      }
    } catch {
      /* optional */
    }

    const rawList = await fetchTikTokReportPages(
      apiBase,
      token,
      advertiserId,
      dateFromStr,
      dateToStr,
      true
    );
    const adIds = rawList.map((r) => str(r.dimensions?.ad_id)).filter((x): x is string => !!x);
    const enrich = await fetchAdEnrichment(apiBase, token, advertiserId, adIds);

    const rows = rawList
      .map((item) => rowToDb(item, currency, enrich))
      .filter((r): r is Record<string, unknown> => r != null);

    const dedupe = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const pl = r.placement != null ? String(r.placement) : "\0null";
      const k = `${r.ad_id}\0${r.date}\0${pl}`;
      dedupe.set(k, r);
    }
    const adRows = [...dedupe.values()];
    const campaignTotals = await fetchCampaignDayTotals(apiBase, token, advertiserId, dateFromStr, dateToStr);
    const gapRows = await campaignGapRows(apiBase, token, advertiserId, campaignTotals, adRows, currency);
    const uniqueRows = [...adRows, ...gapRows];

    console.log(LOG, "report rows", rawList.length, "unique", adRows.length, "campaign-level", gapRows.length);

    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const { error: delErr } = await supabase
      .from("tiktok_campaigns_data")
      .delete()
      .gte("date", dateFromStr)
      .lte("date", dateToStr);
    if (delErr) throw new Error(`tiktok_campaigns_data delete: ${delErr.message}`);

    const BATCH = 500;
    const stripId = <T extends Record<string, unknown>>(row: T) => {
      const { id: _i, ...rest } = row;
      return rest;
    };

    for (let i = 0; i < uniqueRows.length; i += BATCH) {
      const chunk = uniqueRows.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("tiktok_campaigns_data").upsert(chunk, {
        onConflict: "ad_id,date,placement",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`tiktok_campaigns_data upsert: ${error.message}`);
    }

    const uniqueCampaignNames = [
      ...new Set(uniqueRows.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean)),
    ];
    if (uniqueCampaignNames.length > 0) {
      const { data: existing } = await supabase
        .from("tiktok_campaigns_reference_data")
        .select("campaign_name")
        .in("campaign_name", uniqueCampaignNames);
      const existingSet = new Set((existing ?? []).map((r) => (r.campaign_name as string)?.trim()).filter(Boolean));
      const toInsert = uniqueCampaignNames
        .filter((n) => !existingSet.has(n))
        .map((campaign_name) => ({ campaign_name }));
      if (toInsert.length > 0) {
        const { error: refErr } = await supabase.from("tiktok_campaigns_reference_data").insert(toInsert);
        if (refErr) {
          // Fail the run so missing reference campaigns are visible to operators.
          const seqHint = refErr.message.includes("tiktok_campaigns_reference_data_pkey")
            ? " Sequence may be out of sync; run setval on tiktok_campaigns_reference_data.id."
            : "";
          throw new Error(`tiktok_campaigns_reference_data insert: ${refErr.message}.${seqHint}`);
        }
      }
    }

    const accountKey = `tiktok_${advertiserId}`;
    const syncedAt = new Date().toISOString();
    const rangeDates = eachDateInRange(dateFromStr, dateToStr);
    const hist = rangeDates.map((segment_date) => ({
      account_id: accountKey,
      segment_date,
      synced_at: syncedAt,
    }));
    for (let i = 0; i < hist.length; i += BATCH) {
      const { error } = await supabase.from("tiktok_ads_sync_by_date").upsert(hist.slice(i, i + BATCH), {
        onConflict: "account_id,segment_date",
        ignoreDuplicates: false,
      });
      if (error) console.warn(LOG, "tiktok_ads_sync_by_date", error.message);
    }

    const runId = crypto.randomUUID();
    const logMeta = { report_rows: uniqueRows.length };
    const logRows = hist.map((r) => ({
      platform: "tiktok_ads",
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
      if (logErr) console.warn(LOG, "ads_sync_by_date_log", logErr.message);
    }

    const mismatchedDates = await reconcileDays(supabase, advertiserId, dateFromStr, dateToStr, campaignTotals);

    const result = {
      ok: true,
      function: "fetch-tiktok-campaigns-upsert",
      advertiser_id: advertiserId,
      date_from: dateFromStr,
      date_to: dateToStr,
      upserted: { rows: uniqueRows.length },
      mismatched_dates: mismatchedDates,
      sync_history_rows: hist.length,
      run_id: runId,
    };
    console.log(LOG, JSON.stringify(result));
    return new Response(JSON.stringify(result), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "fetch_tiktok_campaigns_upsert_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
