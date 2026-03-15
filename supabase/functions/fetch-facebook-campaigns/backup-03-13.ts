// supabase/functions/fetch-facebook-campaigns/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FB_API_VERSION = "v21.0";
const FB_BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`;

serve(async () => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const FB_ACCESS_TOKEN = Deno.env.get("FB_ACCESS_TOKEN")!;
    const FB_ACCOUNT_ID = Deno.env.get("FB_ACCOUNT_ID")!;

    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // ---------- SAFE PAGINATION ----------
    async function fetchAllPages(initialUrl: string, params: Record<string, any>) {
      let allData: any[] = [];
      let url: string | null = initialUrl;

      while (url) {
        const query = new URLSearchParams({
          ...params,
          access_token: FB_ACCESS_TOKEN
        }).toString();

        const res = await fetch(`${url}?${query}`);
        const json = await res.json();

        if (!res.ok) {
          console.error("Facebook API error:", json);
          break;
        }

        allData.push(...(json.data || []));
        url = json.paging?.next || null;

        // prevent reusing old params with cursor
        params = {};
      }

      return allData;
    }

    // ---------- DATE RANGE ----------
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const start_date = twoDaysAgo.toISOString().split("T")[0];
    const end_date = yesterday.toISOString().split("T")[0];

    const account_id = `act_${FB_ACCOUNT_ID}`;

    // ---------- FETCH INSIGHTS ----------
    const insights = await fetchAllPages(
      `${FB_BASE_URL}/${account_id}/insights`,
      {
        level: "ad",
        time_increment: 1,
        time_range: JSON.stringify({
          since: start_date,
          until: end_date
        }),
        breakdowns: "publisher_platform,platform_position,device_platform",
        fields: `
          account_id,campaign_id,campaign_name,
          adset_id,adset_name,ad_id,ad_name,
          date_start,date_stop,
          reach,impressions,clicks,spend
        `,
        limit: 500
      }
    );

    console.log(`Fetched ${insights.length} rows`);

    if (!insights.length) {
      return new Response("No data", { status: 200 });
    }

    // ---------- TRANSFORM ----------
    const rows = insights.map((row) => ({
      account_id: row.account_id,
      campaign_name: row.campaign_name,
      adset_name: row.adset_name,
      ad_name: row.ad_name,

      // Normalize UNIQUE columns (avoid NULL conflict issue)
      platform: row.publisher_platform ?? "",
      placement: row.platform_position ?? "",
      device_platform: row.device_platform ?? "",

      day: row.date_start,
      campaign_id: row.campaign_id,
      adset_id: row.adset_id,
      ad_id: row.ad_id,

      reach: Number(row.reach || 0),
      impressions: Number(row.impressions || 0),
      clicks_all: Number(row.clicks || 0),
      amount_spent_usd: Number(row.spend || 0),

      reporting_starts: row.date_start,
      reporting_ends: row.date_stop
    }));

    // ---------- FORCE REMOVE ID (CRITICAL FIX) ----------
    const cleanedRows = rows.map(({ id, ...rest }) => rest);

    // ---------- UPSERT ----------
    const { error } = await supabase
      .from("facebook_campaigns_data")
      .upsert(cleanedRows, {
        onConflict: "ad_id,day,platform,placement,device_platform"
      });

    if (error) {
      console.error("Supabase upsert error:", error);
      throw error;
    }

    return new Response(
      JSON.stringify({
        status: "success",
        rows_processed: cleanedRows.length
      }),
      { status: 200 }
    );

  } catch (err: any) {
    console.error("FULL ERROR:", err);

    return new Response(
      JSON.stringify({
        status: "error",
        message: err?.message || err
      }),
      { status: 500 }
    );
  }
});