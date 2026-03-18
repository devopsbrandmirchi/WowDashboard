const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  
  function jsonRes(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  
    const L: string[] = [];
    const log = (msg: string) => { L.push(msg); console.log(msg); };
  
    try {
      const SB_URL = Deno.env.get("SUPABASE_URL") || "";
      const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const REDDIT_CLIENT_ID = Deno.env.get("REDDIT_CLIENT_ID") || "";
      const REDDIT_CLIENT_SECRET = Deno.env.get("REDDIT_CLIENT_SECRET") || "";
      const API_BASE = "https://ads-api.reddit.com/api/v3";
      const UA = "AgencyDashboard/1.0";
  
      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }
  
      const customerId = body.customer_id || null;
      const mode = body.mode || "daily";
      const daysBack = body.days_back || 5;
      let dateFrom = body.date_from || "";
      let dateTo = body.date_to || "";
  
      if (!customerId) return jsonRes({ error: "customer_id required" }, 400);
  
      if (!(mode === "backfill" && dateFrom && dateTo)) {
        const now = new Date();
        const from = new Date(now); from.setDate(from.getDate() - daysBack);
        const to = new Date(now); to.setDate(to.getDate() - 1);
        dateFrom = from.toISOString().split("T")[0];
        dateTo = to.toISOString().split("T")[0];
      }
  
      log("=== REDDIT FULL SYNC ===");
      log(`Customer: ${customerId} | Mode: ${mode}`);
      log(`Dates: ${dateFrom} to ${dateTo}`);
  
      // ── Credentials ──
      const cpaRes = await fetch(
        SB_URL + "/rest/v1/client_platform_accounts?" +
        "platform_customer_id=eq." + customerId +
        "&platform=eq.reddit&is_active=eq.true&select=agency_id",
        { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } }
      );
      const cpaRows = await cpaRes.json();
      if (!cpaRows?.length) return jsonRes({ error: "No account found", log: L }, 400);
      const agencyId = cpaRows[0].agency_id;
  
      const credRes = await fetch(
        SB_URL + "/rest/v1/agency_platform_credentials?" +
        "agency_id=eq." + agencyId +
        "&platform=eq.reddit&is_active=eq.true&select=oauth_refresh_token",
        { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } }
      );
      const credRows = await credRes.json();
      if (!credRows?.length || !credRows[0].oauth_refresh_token)
        return jsonRes({ error: "No credential", log: L }, 400);
  
      const refreshToken = credRows[0].oauth_refresh_token;
      log("Credential found for agency " + agencyId);
  
      // ── Token refresh ──
      const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`),
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
        },
        body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
      });
      if (tokenRes.status !== 200) {
        const txt = await tokenRes.text();
        return jsonRes({ error: "Token refresh failed: " + txt, log: L }, 400);
      }
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      log("Token OK");
  
      // ── Report fields (main metrics only, no video) ──
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
  
      // ── Fetch report with retry on 429 ──
      async function fetchReport(dateStr: string, breakdowns: string[]) {
        const baseUrl = `${API_BASE}/ad_accounts/${customerId}/reports`;
        const hdrs = {
          Authorization: `Bearer ${accessToken}`,
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
        const allRows: any[] = [];
        let page = 1;
        let url: string | null = baseUrl;
        while (url) {
          log(`  POST page ${page}: breakdowns=${breakdowns.join(",")}`);
          let res = await fetch(url, {
            method: "POST", headers: hdrs, body: JSON.stringify(reqBody),
          });
          if (res.status === 429) {
            log(`  429 rate limited, waiting 3s...`);
            await new Promise((r) => setTimeout(r, 3000));
            res = await fetch(url, {
              method: "POST", headers: hdrs, body: JSON.stringify(reqBody),
            });
          }
          if (res.status !== 200) {
            log(`  Report error ${res.status}: ${(await res.text()).substring(0, 300)}`);
            break;
          }
          const json = await res.json();
          const rows = json.data?.metrics || [];
          allRows.push(...rows);
          log(`  Page ${page}: ${rows.length} rows (total: ${allRows.length})`);
          url = json.pagination?.next_url || null;
          page++;
        }
        return allRows;
      }
  
      // ── Name lookups ──
      const campaignNames: Record<string, string> = {};
      const adGroupNames: Record<string, string> = {};
  
      async function loadNames(type: "campaigns" | "ad_groups") {
        const map = type === "campaigns" ? campaignNames : adGroupNames;
        let nextUrl: string | null = `${API_BASE}/ad_accounts/${customerId}/${type}?page.size=500`;
        while (nextUrl) {
          const res = await fetch(nextUrl, {
            headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UA },
          });
          if (res.status !== 200) { log(`  WARN: ${type} list ${res.status}`); break; }
          const json = await res.json();
          for (const item of json.data || []) {
            if (item.id && item.name) map[item.id] = item.name;
          }
          nextUrl = json.pagination?.next_url || null;
        }
        log(`  Loaded ${Object.keys(map).length} ${type} names`);
      }
  
      await loadNames("campaigns");
      await loadNames("ad_groups");
  
      // ── Metric helpers ──
      function num(v: any) { return Number(v || 0); }
      function microDiv(v: any) { return Math.round(num(v) / 1000000 * 1000000) / 1000000; }
      function centDiv(v: any) { return Math.round(num(v) / 100 * 100) / 100; }
  
      function baseMetrics(r: any) {
        return {
          impressions: num(r.impressions),
          clicks: num(r.clicks),
          spend: microDiv(r.spend),
          cpc: microDiv(r.cpc),
          ctr: num(r.ctr),
          ecpm: microDiv(r.ecpm),
          reach: num(r.reach),
          frequency: num(r.frequency),
          purchase_views: num(r.conversion_purchase_views),
          purchase_clicks: num(r.conversion_purchase_clicks),
          purchase_total_value: centDiv(r.conversion_purchase_total_value),
          purchase_ecpa: microDiv(r.conversion_purchase_ecpa),
          lead_clicks: num(r.conversion_lead_clicks),
          lead_views: num(r.conversion_lead_views),
          sign_up_clicks: num(r.conversion_sign_up_clicks),
          sign_up_views: num(r.conversion_sign_up_views),
          page_visit_clicks: num(r.conversion_page_visit_clicks),
          page_visit_views: num(r.conversion_page_visit_views),
          add_to_cart_clicks: num(r.conversion_add_to_cart_clicks),
          add_to_cart_views: num(r.conversion_add_to_cart_views),
          add_to_cart_total_value: centDiv(r.conversion_add_to_cart_total_value),
          conversion_roas: num(r.conversion_roas),
          currency: "USD",
          updated_at: new Date().toISOString(),
        };
      }
  
      // ── Supabase upsert helper ──
      async function su(table: string, data: any[], conflict: string) {
        if (!data.length) return 0;
        const seen = new Set();
        const deduped = data.filter((row) => {
          const key = conflict.split(",").map((k) => row[k.trim()] ?? "").join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        let total = 0;
        for (let i = 0; i < deduped.length; i += 400) {
          const chunk = deduped.slice(i, i + 400);
          const res = await fetch(SB_URL + "/rest/v1/" + table + "?on_conflict=" + conflict, {
            method: "POST",
            headers: {
              apikey: SB_KEY,
              Authorization: "Bearer " + SB_KEY,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates",
            },
            body: JSON.stringify(chunk),
          });
          if (!res.ok) {
            log(`  WARN upsert ${table}: ${(await res.text()).substring(0, 200)}`);
          } else {
            total += chunk.length;
          }
        }
        return total;
      }
  
      // ── Date list ──
      const dates: string[] = [];
      const cur = new Date(dateFrom);
      const endD = new Date(dateTo);
      while (cur <= endD) {
        dates.push(cur.toISOString().split("T")[0]);
        cur.setDate(cur.getDate() + 1);
      }
      log(`Processing ${dates.length} date(s)`);
  
      let totalRows = 0;
  
      for (const dateStr of dates) {
        log(`\n--- ${dateStr} ---`);
  
        // A. Campaign + Ad Group (single call, one row per ad group)
        try {
          log("A. Campaign+AdGroup...");
          const rows = await fetchReport(dateStr, ["DATE", "CAMPAIGN_ID", "AD_GROUP_ID"]);
          const data = rows.filter((r: any) => r.date).map((r: any) => ({
            customer_id: customerId,
            campaign_id: String(r.campaign_id || ""),
            campaign_name: campaignNames[r.campaign_id] || null,
            ad_group_id: String(r.ad_group_id || ""),
            ad_group_name: adGroupNames[r.ad_group_id] || null,
            report_date: r.date,
            country: "ALL",
            ...baseMetrics(r),
          }));
          const n = await su("reddit_campaign_daily", data,
            "customer_id,campaign_id,ad_group_id,report_date");
          log(`  OK: ${n} rows`);
          totalRows += n;
        } catch (e: any) { log(`  ERR: ${e.message}`); }
  
        // B. Placement
        try {
          log("B. Placement...");
          const rows = await fetchReport(dateStr, ["DATE", "CAMPAIGN_ID", "PLACEMENT"]);
          const data = rows.filter((r: any) => r.date && r.placement).map((r: any) => ({
            customer_id: customerId,
            campaign_id: String(r.campaign_id || ""),
            campaign_name: campaignNames[r.campaign_id] || null,
            placement: r.placement || "",
            report_date: r.date,
            ...baseMetrics(r),
          }));
          const n = await su("reddit_placement_daily", data,
            "customer_id,campaign_id,placement,report_date");
          log(`  OK: ${n} placement rows`);
          totalRows += n;
        } catch (e: any) { log(`  ERR placement: ${e.message}`); }
  
        // Small delay between dates to avoid 429
        if (dates.length > 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
  
      log(`\n=== DONE === Total: ${totalRows}`);
      return jsonRes({ success: true, total_rows: totalRows, log: L });
  
    } catch (err: any) {
      log("FATAL: " + (err.message || String(err)));
      return jsonRes({ success: false, error: err.message, log: L }, 500);
    }
  });
  