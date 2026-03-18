// TikTok Ads: sync report rows into tiktok_campaigns_data (+ reference campaign names, sync log).
// Secrets (set in Supabase Dashboard → Edge Functions):
//   TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID
// Optional: TIKTOK_API_URL (default https://business-api.tiktok.com/open_api/v1.3)
// POST { date_from?, date_to? } or GET ?date_from=&date_to= — default last 2 days.
// Requires migration 20250318220000_tiktok_campaigns_data_and_sync.sql
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
const DIM_BASE = ["stat_time_day", "ad_id"];

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
    u.searchParams.set("filtering", JSON.stringify([{ field: "ad_ids", operator: "IN", value: ids }]));
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
  metricsList: string[] = METRICS_FULL
): Promise<TikTokReportRow[]> {
  const dimensions = withPlacement ? DIM_PLACEMENT : DIM_BASE;

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
    u.searchParams.set("dimensions", JSON.stringify(dimensions));
    u.searchParams.set("metrics", JSON.stringify(metricsList));
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
    if (withPlacement && /dimension|placement|invalid|40002|length must be/i.test(msg)) {
      return fetchTikTokReportPages(apiBase, token, advertiserId, startDate, endDate, false, metricsList);
    }
    if (metricsList !== METRICS_MIN && /metric|invalid/i.test(msg)) {
      return fetchTikTokReportPages(apiBase, token, advertiserId, startDate, endDate, withPlacement, METRICS_MIN);
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
    const uniqueRows = [...dedupe.values()];

    console.log(LOG, "report rows", rawList.length, "unique", uniqueRows.length);

    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
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
        if (refErr) console.warn(LOG, "tiktok_campaigns_reference_data", refErr.message);
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

    const result = {
      ok: true,
      function: "fetch-tiktok-campaigns-upsert",
      advertiser_id: advertiserId,
      date_from: dateFromStr,
      date_to: dateToStr,
      upserted: { rows: uniqueRows.length },
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
