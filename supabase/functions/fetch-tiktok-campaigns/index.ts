// TikTok Ads: delete rows in date range + insert from TikTok report (no upsert / no sync log).
// POST { date_from?, date_to? } or GET ?date_from=&date_to= — default last 3 calendar days (UTC), ending yesterday.
// Env: TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID. Optional: TIKTOK_API_URL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const LOG = "[fetch-tiktok-campaigns]";
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
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 3);
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
    page_info?: { page?: number; total_page?: number };
  };
}

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
/** Audience reports use the `placement` breakdown dimension (not always `placement_type`). */
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

/** Country breakdown for reference table (ad/day/country). */
const DIM_AD_COUNTRY = ["stat_time_day", "ad_id", "country_code"];

function pickCountryCode(dimensions: Record<string, unknown>): string | null {
  const c =
    str(dimensions.country_code) ??
    str(dimensions.country) ??
    str(dimensions.geo_country_code) ??
    str(dimensions.stat_country_code);
  if (!c) return null;
  const lower = c.toLowerCase();
  if (lower === "unknown" || lower === "other") return null;
  return c;
}

/** Impressions-weighted dominant country per campaign_name (aligned with Facebook pickReferenceCountries). */
function pickReferenceCountryByCampaign(
  rows: TikTokReportRow[],
  enrich: Map<string, AdEnrich>
): Map<string, string> {
  const agg = new Map<string, Map<string, number>>();
  for (const item of rows) {
    const d = item.dimensions ?? {};
    const m = item.metrics ?? {};
    const adId = str(d.ad_id);
    const campaignName = (str(d.campaign_name) ?? (adId ? enrich.get(adId)?.campaign_name : null))?.trim();
    if (!campaignName) continue;
    const country = pickCountryCode(d);
    if (!country) continue;
    const impressions = int(m.impressions) ?? 0;
    if (!agg.has(campaignName)) agg.set(campaignName, new Map());
    const inner = agg.get(campaignName)!;
    inner.set(country, (inner.get(country) ?? 0) + impressions);
  }
  const out = new Map<string, string>();
  for (const [campaignName, countryMap] of agg) {
    let bestC = "";
    let bestI = -1;
    for (const [c, imp] of countryMap) {
      if (imp > bestI) {
        bestI = imp;
        bestC = c;
      }
    }
    if (bestC) out.set(campaignName, bestC);
  }
  return out;
}

/** Impressions-weighted dominant country per (ad_id, day) for tiktok_campaigns_data.country. */
function pickDominantCountryByAdAndDate(rows: TikTokReportRow[]): Map<string, string> {
  const agg = new Map<string, Map<string, number>>();
  for (const item of rows) {
    const d = item.dimensions ?? {};
    const m = item.metrics ?? {};
    const adId = str(d.ad_id);
    const date = parseStatDay(d.stat_time_day);
    if (!adId || !date) continue;
    const country = pickCountryCode(d);
    if (!country) continue;
    const impressions = int(m.impressions) ?? 0;
    const key = `${adId}\0${date}`;
    if (!agg.has(key)) agg.set(key, new Map());
    const inner = agg.get(key)!;
    inner.set(country, (inner.get(country) ?? 0) + impressions);
  }
  const out = new Map<string, string>();
  for (const [key, countryMap] of agg) {
    let bestC = "";
    let bestI = -1;
    for (const [c, imp] of countryMap) {
      if (imp > bestI) {
        bestI = imp;
        bestC = c;
      }
    }
    if (bestC) out.set(key, bestC);
  }
  return out;
}

async function fetchTikTokAdCountryReportPages(
  apiBase: string,
  token: string,
  advertiserId: string,
  startDate: string,
  endDate: string
): Promise<TikTokReportRow[]> {
  const out: TikTokReportRow[] = [];
  let page = 1;
  const pageSize = 1000;
  let totalPage = 1;

  const fetchPage = async (): Promise<TikTokReportResponse> => {
    const u = new URL(`${apiBase.replace(/\/$/, "")}/report/integrated/get/`);
    u.searchParams.set("advertiser_id", advertiserId);
    u.searchParams.set("service_type", "AUCTION");
    u.searchParams.set("report_type", "BASIC");
    u.searchParams.set("data_level", "AUCTION_AD");
    u.searchParams.set("start_date", startDate);
    u.searchParams.set("end_date", endDate);
    u.searchParams.set("page", String(page));
    u.searchParams.set("page_size", String(pageSize));
    u.searchParams.set("dimensions", JSON.stringify(DIM_AD_COUNTRY));
    u.searchParams.set("metrics", JSON.stringify(METRICS_MIN));
    const res = await fetch(u.toString(), { headers: { "Access-Token": token } });
    const text = await res.text();
    try {
      return JSON.parse(text) as TikTokReportResponse;
    } catch {
      throw new Error(`TikTok country report: non-JSON ${res.status} ${text.slice(0, 200)}`);
    }
  };

  let json = await fetchPage();
  if (json.code !== 0) {
    const msg = json.message || "";
    if (json.code === 41000 && /banned country list|client ip address/i.test(msg)) {
      console.warn(LOG, "TikTok IP region blocked; skipping reference country", msg.slice(0, 120));
      return [];
    }
    console.warn(LOG, "TikTok country report unavailable:", json.code, msg.slice(0, 200));
    return [];
  }

  do {
    if (page > 1) json = await fetchPage();
    if (json.code !== 0) {
      console.warn(LOG, "TikTok country report page:", json.message);
      break;
    }
    out.push(...(json.data?.list ?? []));
    totalPage = json.data?.page_info?.total_page ?? 1;
    page++;
  } while (page <= totalPage);

  return out;
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
    // Must handle invalid *metrics* before placement fallback. The old regex matched the word
    // "invalid" on metric errors (e.g. "Invalid metric fields: [...]") and wrongly dropped
    // placement_type from the request, leaving DB placement NULL.
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
    out.push(...(json.data?.list ?? []));
    totalPage = json.data?.page_info?.total_page ?? 1;
    page++;
  } while (page <= totalPage);

  // BASIC can return code 0 but omit placement values; Audience reports carry the placement breakdown.
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
    conversions: int(m.conversion),
    cost_per_conversion: num(m.cost_per_conversion),
    total_purchase: int(m.complete_payment ?? m.total_purchase),
    purchase_roas: num(m.purchase_roas),
    currency,
    country: null,
    product_type: null,
    show_event: null,
  };
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
      } catch {
        /* empty */
      }
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
    } catch { /* optional */ }

    const rawList = await fetchTikTokReportPages(apiBase, token, advertiserId, dateFromStr, dateToStr, true);
    const adIds = rawList.map((r) => str(r.dimensions?.ad_id)).filter((x): x is string => !!x);
    const enrich = await fetchAdEnrichment(apiBase, token, advertiserId, adIds);

    let countryRows: TikTokReportRow[] = [];
    let countryByCampaignName = new Map<string, string>();
    try {
      countryRows = await fetchTikTokAdCountryReportPages(
        apiBase,
        token,
        advertiserId,
        dateFromStr,
        dateToStr
      );
      countryByCampaignName = pickReferenceCountryByCampaign(countryRows, enrich);
      if (countryByCampaignName.size > 0) {
        console.log(LOG, "reference countries derived for", countryByCampaignName.size, "campaign(s)");
      }
    } catch (e) {
      console.warn(LOG, "country report for reference_data", e);
    }
    const rows = rawList
      .map((item) => rowToDb(item, currency, enrich))
      .filter((r): r is Record<string, unknown> => r != null);

    const dedupe = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const pl = r.placement != null ? String(r.placement) : "\0null";
      dedupe.set(`${r.ad_id}\0${r.date}\0${pl}`, r);
    }
    const uniqueRows = [...dedupe.values()];

    const countryByAdDate = pickDominantCountryByAdAndDate(countryRows);
    if (countryByAdDate.size > 0) {
      console.log(LOG, "fact countries for", countryByAdDate.size, "ad-day key(s)");
    }
    for (const r of uniqueRows) {
      const adId = str(r.ad_id as unknown);
      const dateRaw = r.date;
      const date =
        typeof dateRaw === "string"
          ? dateRaw.slice(0, 10)
          : dateRaw != null
          ? String(dateRaw).slice(0, 10)
          : null;
      if (adId && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const c = countryByAdDate.get(`${adId}\0${date}`);
        if (c) r.country = c;
      }
    }

    console.log(LOG, "report", rawList.length, "unique", uniqueRows.length);

    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const BATCH = 500;
    const stripId = <T extends Record<string, unknown>>(row: T) => {
      const { id: _i, ...rest } = row;
      return rest;
    };

    const uniqueCampaignNames = [
      ...new Set(uniqueRows.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean)),
    ];
    if (uniqueCampaignNames.length > 0) {
      const { data: existing } = await supabase
        .from("tiktok_campaigns_reference_data")
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
        .filter((n) => !existingByName.has(n))
        .map((campaign_name) => ({
          campaign_name,
          country: countryByCampaignName.get(campaign_name) ?? null,
        }));
      if (toInsert.length > 0) {
        const { error: refErr } = await supabase.from("tiktok_campaigns_reference_data").insert(toInsert);
        if (refErr) {
          // If this is swallowed, campaigns silently never appear in reference table.
          const seqHint = refErr.message.includes("tiktok_campaigns_reference_data_pkey")
            ? " Sequence may be out of sync; run setval on tiktok_campaigns_reference_data.id."
            : "";
          throw new Error(`tiktok_campaigns_reference_data insert: ${refErr.message}.${seqHint}`);
        }
        console.log(LOG, "Inserted", toInsert.length, "reference campaigns");
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
          .from("tiktok_campaigns_reference_data")
          .upsert(toUpdate, { onConflict: "id", ignoreDuplicates: false });
        if (updateErr) throw new Error(`tiktok_campaigns_reference_data country update: ${updateErr.message}`);
        console.log(LOG, "Updated country on", toUpdate.length, "reference row(s)");
      }

      const { data: refForFact, error: refForFactErr } = await supabase
        .from("tiktok_campaigns_reference_data")
        .select("campaign_name,country")
        .in("campaign_name", uniqueCampaignNames);
      if (refForFactErr) {
        console.warn(LOG, "reference fetch for fact country", refForFactErr.message);
      } else {
        const refCountryByCampaign = new Map<string, string>();
        for (const row of refForFact ?? []) {
          const n = (row.campaign_name as string)?.trim();
          const c = (row.country as string)?.trim();
          if (!n || !c) continue;
          if (!refCountryByCampaign.has(n)) refCountryByCampaign.set(n, c);
        }
        let filledFromRef = 0;
        for (const r of uniqueRows) {
          if (str(r.country as unknown)) continue;
          const name = ((r.campaign_name as string) || "").trim();
          const c = name ? refCountryByCampaign.get(name) : undefined;
          if (c) {
            r.country = c;
            filledFromRef++;
          }
        }
        if (filledFromRef > 0) {
          console.log(LOG, "fact country from tiktok_campaigns_reference_data", filledFromRef, "row(s)");
        }
      }
    }

    const { error: delErr } = await supabase
      .from("tiktok_campaigns_data")
      .delete()
      .gte("date", dateFromStr)
      .lte("date", dateToStr);
    if (delErr) throw new Error(`tiktok_campaigns_data delete: ${delErr.message}`);

    for (let i = 0; i < uniqueRows.length; i += BATCH) {
      const chunk = uniqueRows.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("tiktok_campaigns_data").insert(chunk);
      if (error) throw new Error(`tiktok_campaigns_data insert: ${error.message}`);
    }

    const result = {
      ok: true,
      advertiser_id: advertiserId,
      date_from: dateFromStr,
      date_to: dateToStr,
      inserted: { rows: uniqueRows.length },
    };
    console.log(LOG, "Success", JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "fetch_tiktok_campaigns_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
