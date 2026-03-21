// Microsoft Advertising → Supabase insert (delete+replace for date range), no sync-by-date audit log.
// Mirrors sync-google-ads-data vs sync-google-ads-upsert: use this for cron/simple reload; use sync-microsoft-ads-upsert for date-range upsert + ads_sync_by_date_log.
// Reporting helpers live in ./microsoft_ads_reporting.ts (required for Supabase bundle).
// Secrets: same as sync-microsoft-ads-upsert (MICROSOFT_ADS_*). Also SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// No request body: syncs default last 2 UTC days (same default window as sync-google-ads-data).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  defaultDateRange,
  fetchMicrosoftAdsAdGroupRows,
} from "./microsoft_ads_reporting.ts";

const LOG = "[sync-microsoft-ads-data]";
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

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const { from: dateFromStr, to: dateToStr } = defaultDateRange();
    const { accountId, rows } = await fetchMicrosoftAdsAdGroupRows(dateFromStr, dateToStr);

    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const BATCH = 400;

    const { error: delErr } = await supabase
      .from("microsoft_campaigns_ad_group")
      .delete()
      .eq("account_id", accountId)
      .gte("campaign_date", dateFromStr)
      .lte("campaign_date", dateToStr);
    if (delErr) throw new Error(`microsoft_campaigns_ad_group delete: ${delErr.message}`);

    const stripId = <T extends Record<string, unknown>>(row: T) => {
      const { id: _i, ...rest } = row;
      return rest;
    };

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map(stripId);
      if (chunk.length === 0) continue;
      const { error } = await supabase.from("microsoft_campaigns_ad_group").insert(chunk);
      if (error) throw new Error(`microsoft_campaigns_ad_group insert: ${error.message}`);
    }

    const uniqueCampaignNames = [...new Set(rows.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean))];
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

    const result = {
      ok: true,
      function: "sync-microsoft-ads-data",
      account_id: accountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      inserted: { ad_group_rows: rows.length },
    };
    console.log(LOG, JSON.stringify(result));
    return new Response(JSON.stringify(result), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "sync_microsoft_ads_data_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
