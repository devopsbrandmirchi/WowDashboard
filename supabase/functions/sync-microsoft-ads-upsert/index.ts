// Microsoft Advertising → Supabase upsert + microsoft_ads_sync_by_date + ads_sync_by_date_log.
// Mirrors sync-google-ads-upsert vs sync-google-ads-data. Fetch: ./microsoft_ads_reporting.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  defaultDateRange,
  eachDateInRange,
  fetchMicrosoftAdsAdGroupRows,
  normalizeISODate,
} from "./microsoft_ads_reporting.ts";

const LOG = "[sync-microsoft-ads-upsert]";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v?.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
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
        body.date_to != null ? normalizeISODate(String(body.date_to)) : null,
      );
      dateFromStr = r.from;
      dateToStr = r.to;
    } else if (req.method === "GET") {
      const u = new URL(req.url);
      const r = apply(
        normalizeISODate(u.searchParams.get("date_from") || ""),
        normalizeISODate(u.searchParams.get("date_to") || ""),
      );
      dateFromStr = r.from;
      dateToStr = r.to;
    } else {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { accountId, rows: dedupedAdGroup } = await fetchMicrosoftAdsAdGroupRows(dateFromStr, dateToStr);

    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const BATCH = 400;
    const stripId = <T extends Record<string, unknown>>(row: T) => {
      const { id: _i, ...rest } = row;
      return rest;
    };

    for (let i = 0; i < dedupedAdGroup.length; i += BATCH) {
      const chunk = dedupedAdGroup.slice(i, i + BATCH).map(stripId);
      const { error } = await supabase.from("microsoft_campaigns_ad_group").upsert(chunk, {
        onConflict: "account_id,campaign_date,campaign_name,ad_group_name",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`microsoft_campaigns_ad_group upsert: ${error.message}`);
    }

    const uniqueCampaignNames = [...new Set(dedupedAdGroup.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean))];
    if (uniqueCampaignNames.length > 0) {
      const { data: existing } = await supabase.from("microsoft_campaigns_reference_data").select("campaign_name").in(
        "campaign_name",
        uniqueCampaignNames,
      );
      const existingSet = new Set((existing ?? []).map((r) => (r.campaign_name as string)?.trim()).filter(Boolean));
      const toInsert = uniqueCampaignNames.filter((n) => !existingSet.has(n)).map((campaign_name) => ({ campaign_name }));
      if (toInsert.length > 0) {
        const { error: refErr } = await supabase.from("microsoft_campaigns_reference_data").insert(toInsert);
        if (refErr) throw new Error(`microsoft_campaigns_reference_data: ${refErr.message}`);
      }
    }

    const dates = eachDateInRange(dateFromStr, dateToStr);
    const syncedAt = new Date().toISOString();
    const hist = dates.map((segment_date) => ({ account_id: accountId, segment_date, synced_at: syncedAt }));
    for (let i = 0; i < hist.length; i += BATCH) {
      const { error } = await supabase.from("microsoft_ads_sync_by_date").upsert(hist.slice(i, i + BATCH), {
        onConflict: "account_id,segment_date",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`microsoft_ads_sync_by_date: ${error.message}`);
    }

    const runId = crypto.randomUUID();
    const logMeta = { ad_group_rows: dedupedAdGroup.length };
    const logRows = hist.map((r) => ({
      platform: "microsoft_ads",
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
      function: "sync-microsoft-ads-upsert",
      account_id: accountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      upserted: { ad_group_rows: dedupedAdGroup.length },
      sync_history_rows: hist.length,
      run_id: runId,
    };
    console.log(LOG, JSON.stringify(result));
    return new Response(JSON.stringify(result), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "sync_microsoft_ads_upsert_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
