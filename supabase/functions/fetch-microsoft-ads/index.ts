// Fetch Microsoft Advertising ad-group daily rows as JSON (no Supabase writes).
// Same Microsoft secrets as sync-microsoft-ads-upsert; use for debugging or custom pipelines.
// POST/GET: date_from, date_to (optional). POST body: { limit?: number } caps rows returned (default 500, max 5000).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  defaultDateRange,
  eachDateInRange,
  fetchMicrosoftAdsAdGroupRows,
  normalizeISODate,
} from "./microsoft_ads_reporting.ts";

const LOG = "[fetch-microsoft-ads]";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function clampLimit(n: unknown): number {
  const x = Math.floor(Number(n));
  if (!isFinite(x) || x < 1) return 500;
  return Math.min(x, 5000);
}

Deno.serve(async (req: Request) => {
  console.log(LOG, new Date().toISOString());
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    let dateFromStr: string;
    let dateToStr: string;
    let limit = 500;

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
        body.date_to != null ? normalizeISODate(String(body.date_to)) : null,
      );
      dateFromStr = r.from;
      dateToStr = r.to;
      limit = clampLimit(body.limit);
    } else if (req.method === "GET") {
      const u = new URL(req.url);
      const r = apply(
        normalizeISODate(u.searchParams.get("date_from") || ""),
        normalizeISODate(u.searchParams.get("date_to") || ""),
      );
      dateFromStr = r.from;
      dateToStr = r.to;
      limit = clampLimit(u.searchParams.get("limit"));
    } else {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { accountId, rows } = await fetchMicrosoftAdsAdGroupRows(dateFromStr, dateToStr);
    const truncated = rows.length > limit;
    const outRows = truncated ? rows.slice(0, limit) : rows;

    const result = {
      ok: true,
      function: "fetch-microsoft-ads",
      account_id: accountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      row_count: rows.length,
      limit,
      truncated,
      rows: outRows,
    };
    return new Response(JSON.stringify(result), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "fetch_microsoft_ads_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
