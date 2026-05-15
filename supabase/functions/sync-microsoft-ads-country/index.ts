import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate@0.8.2";

const LOG = "[sync-microsoft-ads-country]";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPORTING_ENDPOINT =
  "https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc";
const DEFAULT_SYNC_DAY_COUNT = 3;

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env secret: ${name}`);
  return v;
}

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      scope: "https://ads.microsoft.com/msads.manage offline_access",
    }),
  });
  if (!res.ok) throw new Error(`MS OAuth2 refresh failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error(`No access_token in MS OAuth response: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

function soapHeader(action: string, accessToken: string, developerToken: string, customerId: string): string {
  return `<s:Header xmlns="https://bingads.microsoft.com/Reporting/v13">
    <Action mustUnderstand="1">${action}</Action>
    <AuthenticationToken>${accessToken}</AuthenticationToken>
    <CustomerId>${customerId}</CustomerId>
    <DeveloperToken>${developerToken}</DeveloperToken>
  </s:Header>`;
}

function wrapSoap(header: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance"
            xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  ${header}
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

function xmlText(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s[^>]*)?>([^<]*)`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

async function submitReport(
  accessToken: string,
  developerToken: string,
  customerId: string,
  reportXmlBody: string
): Promise<string> {
  const header = soapHeader("SubmitGenerateReport", accessToken, developerToken, customerId);
  const body = `<SubmitGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">${reportXmlBody}</SubmitGenerateReportRequest>`;
  const res = await fetch(REPORTING_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "SubmitGenerateReport" },
    body: wrapSoap(header, body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SubmitGenerateReport HTTP ${res.status}: ${text.slice(0, 1200)}`);
  const id = xmlText(text, "ReportRequestId");
  if (!id) throw new Error(`No ReportRequestId in response: ${text.slice(0, 1200)}`);
  return id;
}

async function pollReport(
  accessToken: string,
  developerToken: string,
  customerId: string,
  reportRequestId: string
): Promise<{ status: string; downloadUrl: string | null }> {
  const header = soapHeader("PollGenerateReport", accessToken, developerToken, customerId);
  const body = `<PollGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13"><ReportRequestId>${reportRequestId}</ReportRequestId></PollGenerateReportRequest>`;
  const res = await fetch(REPORTING_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "PollGenerateReport" },
    body: wrapSoap(header, body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PollGenerateReport HTTP ${res.status}: ${text.slice(0, 800)}`);
  const status = xmlText(text, "Status") ?? "Pending";
  const downloadUrl = xmlText(text, "ReportDownloadUrl");
  return { status, downloadUrl };
}

async function waitForReport(
  accessToken: string,
  developerToken: string,
  customerId: string,
  reportRequestId: string,
  maxWaitMs = 110_000
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 5_000));
    const { status, downloadUrl } = await pollReport(accessToken, developerToken, customerId, reportRequestId);
    if (downloadUrl || status === "Success") return downloadUrl ?? null;
    if (status === "Error") throw new Error("Report failed");
  }
  throw new Error(`Report did not complete within ${maxWaitMs / 1000}s`);
}

async function downloadReportCsv(url: string): Promise<string> {
  const decodedUrl = url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  const res = await fetch(decodedUrl);
  if (!res.ok) throw new Error(`Report download failed ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4B) {
    const unzipped = unzipSync(buf);
    const files = Object.values(unzipped);
    if (!files.length) throw new Error("Empty ZIP archive from report download");
    return new TextDecoder("utf-8").decode(files[0] as Uint8Array);
  }
  return new TextDecoder("utf-8").decode(buf);
}

function parseMsAdsCsv(csv: string): Record<string, string>[] {
  const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let headerIdx = -1;
  const parseLine = (line: string): string[] => {
    const cols: string[] = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { cols.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (parseLine(line).length > 1) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];
  const headers = parseLine(lines[headerIdx]);
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === '""' || line.startsWith('"©')) break;
    const cols = parseLine(lines[i]);
    if (cols.length < 2) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] ?? ""; });
    rows.push(obj);
  }
  return rows;
}

function parseMsDate(val: string): string | null {
  if (!val) return null;
  const t = val.trim();
  if (t.match(/^\d{4}-\d{2}-\d{2}$/)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

function parseNum(val: string): number | null {
  if (!val || val === "--") return null;
  return parseFloat(val.replace(/,/g, "")) || null;
}

function buildDateRange(from: Date, to: Date): string {
  const fmt = (d: Date) => `<Day>${d.getUTCDate()}</Day><Month>${d.getUTCMonth() + 1}</Month><Year>${d.getUTCFullYear()}</Year>`;
  return `
    <CustomDateRangeEnd>${fmt(to)}</CustomDateRangeEnd>
    <CustomDateRangeStart>${fmt(from)}</CustomDateRangeStart>
    <PredefinedTime i:nil="true"/>
    <ReportTimeZone>GreenwichMeanTimeDublinEdinburghLisbonLondon</ReportTimeZone>`;
}

function adGroupReportXml(accountId: string, from: Date, to: Date): string {
  return `<ReportRequest i:type="AdGroupPerformanceReportRequest" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <Format>Csv</Format><Language>English</Language><ReportName>AdGroupPerformanceCountryReport</ReportName><ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
    <Aggregation>Daily</Aggregation>
    <Columns>
      <AdGroupPerformanceReportColumn>AccountId</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>AdGroupId</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>AdGroupName</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>CampaignId</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>CampaignName</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>Clicks</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>Conversions</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>Impressions</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>Revenue</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>Spend</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>TimePeriod</AdGroupPerformanceReportColumn>
      <AdGroupPerformanceReportColumn>ViewThroughConversions</AdGroupPerformanceReportColumn>
    </Columns>
    <Filter i:nil="true"/><MaxRows i:nil="true"/>
    <Scope><AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><a:long>${accountId}</a:long></AccountIds></Scope>
    <Time>${buildDateRange(from, to)}</Time>
  </ReportRequest>`;
}

function publisherReportXml(accountId: string, from: Date, to: Date): string {
  return `<ReportRequest i:type="PublisherUsagePerformanceReportRequest" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <Format>Csv</Format><Language>English</Language><ReportName>PublisherUsageCountryReport</ReportName><ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
    <Aggregation>Daily</Aggregation>
    <Columns>
      <PublisherUsagePerformanceReportColumn>AccountId</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>AdDistribution</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>CampaignId</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>CampaignName</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>Clicks</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>Conversions</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>Impressions</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>PublisherUrl</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>Spend</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>TimePeriod</PublisherUsagePerformanceReportColumn>
      <PublisherUsagePerformanceReportColumn>ViewThroughConversions</PublisherUsagePerformanceReportColumn>
    </Columns>
    <Filter i:nil="true"/>
    <Scope><AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><a:long>${accountId}</a:long></AccountIds></Scope>
    <Time>${buildDateRange(from, to)}</Time>
  </ReportRequest>`;
}

function geographicReportXml(accountId: string, from: Date, to: Date): string {
  return `<ReportRequest i:type="GeographicPerformanceReportRequest" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <Format>Csv</Format><Language>English</Language><ReportName>GeographicPerformanceCountryReport</ReportName><ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
    <Aggregation>Daily</Aggregation>
    <Columns>
      <GeographicPerformanceReportColumn>AccountId</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>CampaignId</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>CampaignName</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>AdGroupId</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>AdGroupName</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>Country</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>MostSpecificLocation</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>LocationType</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>TimePeriod</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>Impressions</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>Clicks</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>Spend</GeographicPerformanceReportColumn>
      <GeographicPerformanceReportColumn>Conversions</GeographicPerformanceReportColumn>
    </Columns>
    <Filter i:nil="true"/>
    <Scope><AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><a:long>${accountId}</a:long></AccountIds></Scope>
    <Time>${buildDateRange(from, to)}</Time>
  </ReportRequest>`;
}

function pickCountry(r: Record<string, string>): string {
  const c = (r["Country"] ?? r["Country/Region"] ?? r["Country Code"] ?? r["CountryCode"] ?? "").trim();
  if (c) return c;
  const locationType = (r["Location type"] ?? r["LocationType"] ?? "").trim().toLowerCase();
  const mostSpecific = (r["Most specific location"] ?? r["MostSpecificLocation"] ?? "").trim();
  if (mostSpecific && (locationType === "country" || !locationType)) return mostSpecific;
  return "unknown";
}

function normalizeId(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  // Some CSV exports may represent ids as "12345.0".
  if (/^\d+\.0+$/.test(s)) return s.split(".")[0];
  return s;
}

function normalizeText(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

function toAdGroupRow(r: Record<string, string>, accountId: string): Record<string, unknown> | null {
  const campaign_date = parseMsDate(r["Time period"] ?? r["TimePeriod"] ?? r["Day"] ?? "");
  if (!campaign_date) return null;
  const spend = parseNum(r["Spend"] ?? r["spend"] ?? "");
  return {
    account_id: normalizeId(r["Account ID"] ?? r["AccountId"] ?? accountId),
    campaign_id: normalizeId(r["Campaign ID"] ?? r["CampaignId"]) || null,
    campaign_name: r["Campaign"] ?? r["CampaignName"] ?? null,
    ad_group_id: normalizeId(r["Ad group ID"] ?? r["AdGroupId"]) || null,
    ad_group_name: r["Ad group"] ?? r["AdGroupName"] ?? null,
    community: null,
    campaign_date,
    impressions: parseNum(r["Impressions"] ?? "") ?? 0,
    clicks: parseNum(r["Clicks"] ?? "") ?? 0,
    amount_spent_usd: spend,
    total_spent: spend,
    purchase_click: parseNum(r["Conversions"] ?? r["All conv."] ?? ""),
    total_purchase_click: parseNum(r["Conversions"] ?? r["All conv."] ?? ""),
    purchase_view: parseNum(r["View-through conv."] ?? r["ViewThroughConversions"] ?? ""),
    total_purchase_view: parseNum(r["View-through conv."] ?? r["ViewThroughConversions"] ?? ""),
    total_value_purchase: parseNum(r["Revenue"] ?? r["Conv. value"] ?? ""),
    total_records: 1,
    unique_campaigns: null,
    country: pickCountry(r),
  };
}

function toPlacementRow(r: Record<string, string>, accountId: string): Record<string, unknown> | null {
  const campaign_date = parseMsDate(r["Time period"] ?? r["TimePeriod"] ?? r["Day"] ?? "");
  if (!campaign_date) return null;
  return {
    account_id: normalizeId(r["Account ID"] ?? r["AccountId"] ?? accountId),
    campaign_id: normalizeId(r["Campaign ID"] ?? r["CampaignId"]) || null,
    campaign_date,
    name: r["Campaign"] ?? r["CampaignName"] ?? null,
    placement: r["Website"] ?? r["PublisherUrl"] ?? r["Ad distribution"] ?? r["AdDistribution"] ?? null,
    community: null,
    impressions: parseNum(r["Impressions"] ?? "") ?? 0,
    clicks: parseNum(r["Clicks"] ?? "") ?? 0,
    amount_spent_usd: parseNum(r["Spend"] ?? ""),
    purchase_click: parseNum(r["Conversions"] ?? r["All conv."] ?? ""),
    purchase_view: parseNum(r["View-through conv."] ?? r["ViewThroughConversions"] ?? ""),
    country: pickCountry(r),
  };
}

type CountryMaps = {
  byAdGroupDate: Map<string, string>;
  byAdGroupNameDate: Map<string, string>;
  byCampaignDate: Map<string, string>;
  byCampaignNameDate: Map<string, string>;
  byAccountDate: Map<string, string>;
};

function buildCountryMapsFromGeoRows(geoRows: Record<string, string>[]): CountryMaps {
  const scoreByAdGroupDate = new Map<string, Map<string, number>>();
  const scoreByAdGroupNameDate = new Map<string, Map<string, number>>();
  const scoreByCampaignDate = new Map<string, Map<string, number>>();
  const scoreByCampaignNameDate = new Map<string, Map<string, number>>();
  const scoreByAccountDate = new Map<string, Map<string, number>>();

  const bumpScore = (m: Map<string, Map<string, number>>, key: string, country: string, weight: number) => {
    if (!key || !country || country === "unknown") return;
    let inner = m.get(key);
    if (!inner) {
      inner = new Map<string, number>();
      m.set(key, inner);
    }
    inner.set(country, (inner.get(country) ?? 0) + (Number.isFinite(weight) && weight > 0 ? weight : 1));
  };

  const pickTop = (m: Map<string, Map<string, number>>): Map<string, string> => {
    const out = new Map<string, string>();
    for (const [key, countries] of m.entries()) {
      let bestCountry = "";
      let bestScore = -1;
      for (const [country, score] of countries.entries()) {
        if (score > bestScore) {
          bestScore = score;
          bestCountry = country;
        }
      }
      if (bestCountry) out.set(key, bestCountry);
    }
    return out;
  };

  for (const r of geoRows) {
    const accountId = normalizeId(r["Account ID"] ?? r["AccountId"] ?? "");
    const campaignId = normalizeId(r["Campaign ID"] ?? r["CampaignId"] ?? "");
    const campaignName = normalizeText(r["Campaign"] ?? r["CampaignName"] ?? "");
    const adGroupId = normalizeId(r["Ad group ID"] ?? r["AdGroupId"] ?? "");
    const adGroupName = normalizeText(r["Ad group"] ?? r["AdGroupName"] ?? "");
    const date = parseMsDate(r["Time period"] ?? r["TimePeriod"] ?? r["Day"] ?? "") ?? "";
    const country = pickCountry(r);
    const weight = parseNum(r["Spend"] ?? "") ?? parseNum(r["Impressions"] ?? "") ?? 1;
    if (!accountId || !date || country === "unknown") continue;

    bumpScore(scoreByAccountDate, `${accountId}|${date}`, country, weight);
    if (campaignId) bumpScore(scoreByCampaignDate, `${accountId}|${campaignId}|${date}`, country, weight);
    if (campaignName) bumpScore(scoreByCampaignNameDate, `${accountId}|${campaignName}|${date}`, country, weight);
    if (campaignId && adGroupId) bumpScore(scoreByAdGroupDate, `${accountId}|${campaignId}|${adGroupId}|${date}`, country, weight);
    if (adGroupName) bumpScore(scoreByAdGroupNameDate, `${accountId}|${adGroupName}|${date}`, country, weight);
  }

  return {
    byAdGroupDate: pickTop(scoreByAdGroupDate),
    byAdGroupNameDate: pickTop(scoreByAdGroupNameDate),
    byCampaignDate: pickTop(scoreByCampaignDate),
    byCampaignNameDate: pickTop(scoreByCampaignNameDate),
    byAccountDate: pickTop(scoreByAccountDate),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const clientId = getEnv("MS_ADS_CLIENT_ID");
    const clientSecret = getEnv("MS_ADS_CLIENT_SECRET");
    const refreshToken = getEnv("MS_ADS_REFRESH_TOKEN");
    const developerToken = getEnv("MS_ADS_DEVELOPER_TOKEN");
    const customerId = getEnv("MS_ADS_CUSTOMER_ID");
    const accountId = getEnv("MS_ADS_ACCOUNT_ID");
    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

    let bodyDateFrom = "", bodyDateTo = "";
    try {
      const b = await req.clone().json() as Record<string, string>;
      bodyDateFrom = b?.date_from ?? "";
      bodyDateTo = b?.date_to ?? "";
    } catch {
      // Ignore empty body for GET calls.
    }
    const reqUrl = new URL(req.url);
    const fromParam = reqUrl.searchParams.get("date_from") ?? bodyDateFrom;
    const toParam = reqUrl.searchParams.get("date_to") ?? bodyDateTo;

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const defaultDateTo = new Date(todayUtc);
    defaultDateTo.setUTCDate(todayUtc.getUTCDate() - 1);
    const defaultDateFrom = new Date(defaultDateTo);
    defaultDateFrom.setUTCDate(defaultDateTo.getUTCDate() - (DEFAULT_SYNC_DAY_COUNT - 1));

    let dateFrom = fromParam ? new Date(`${fromParam}T00:00:00Z`) : defaultDateFrom;
    let dateTo = toParam ? new Date(`${toParam}T00:00:00Z`) : defaultDateTo;
    if (dateFrom.getTime() > dateTo.getTime()) [dateFrom, dateTo] = [dateTo, dateFrom];
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    const dateToStr = dateTo.toISOString().slice(0, 10);

    const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
    console.log(LOG, "Date range", dateFromStr, "->", dateToStr);

    const [adReqId, pubReqId, geoReqId] = await Promise.all([
      submitReport(accessToken, developerToken, customerId, adGroupReportXml(accountId, dateFrom, dateTo)),
      submitReport(accessToken, developerToken, customerId, publisherReportXml(accountId, dateFrom, dateTo)),
      submitReport(accessToken, developerToken, customerId, geographicReportXml(accountId, dateFrom, dateTo)),
    ]);
    const [adUrl, pubUrl, geoUrl] = await Promise.all([
      waitForReport(accessToken, developerToken, customerId, adReqId),
      waitForReport(accessToken, developerToken, customerId, pubReqId),
      waitForReport(accessToken, developerToken, customerId, geoReqId),
    ]);
    const [adCsv, pubCsv, geoCsv] = await Promise.all([
      adUrl ? downloadReportCsv(adUrl) : Promise.resolve(""),
      pubUrl ? downloadReportCsv(pubUrl) : Promise.resolve(""),
      geoUrl ? downloadReportCsv(geoUrl) : Promise.resolve(""),
    ]);

    const geoRows = parseMsAdsCsv(geoCsv);
    const {
      byAdGroupDate, byAdGroupNameDate, byCampaignDate, byCampaignNameDate, byAccountDate,
    } = buildCountryMapsFromGeoRows(geoRows);

    const adGroupRows = parseMsAdsCsv(adCsv)
      .map((r) => toAdGroupRow(r, accountId))
      .filter((r): r is Record<string, unknown> => r != null)
      .map((row) => {
        if (row.country !== "unknown") return row;
        const acc = normalizeId(row.account_id);
        const cid = normalizeId(row.campaign_id);
        const agid = normalizeId(row.ad_group_id);
        const agn = normalizeText(row.ad_group_name);
        const cn = normalizeText(row.campaign_name);
        const d = String(row.campaign_date ?? "");
        const fromGeo = byAdGroupDate.get(`${acc}|${cid}|${agid}|${d}`)
          ?? byAdGroupNameDate.get(`${acc}|${agn}|${d}`)
          ?? byCampaignDate.get(`${acc}|${cid}|${d}`)
          ?? byCampaignNameDate.get(`${acc}|${cn}|${d}`)
          ?? byAccountDate.get(`${acc}|${d}`);
        if (fromGeo) row.country = fromGeo;
        return row;
      });

    let rawPlacementRows = parseMsAdsCsv(pubCsv)
      .map((r) => toPlacementRow(r, accountId))
      .filter((r): r is Record<string, unknown> => r != null)
      .map((row) => {
        if (row.country !== "unknown") return row;
        const acc = normalizeId(row.account_id);
        const cid = normalizeId(row.campaign_id);
        const cn = normalizeText(row.name);
        const d = String(row.campaign_date ?? "");
        const fromGeo = byCampaignDate.get(`${acc}|${cid}|${d}`)
          ?? byCampaignNameDate.get(`${acc}|${cn}|${d}`)
          ?? byAccountDate.get(`${acc}|${d}`);
        if (fromGeo) row.country = fromGeo;
        return row;
      });

    // Second pass: infer country from already-known rows in the same run by name/date keys.
    const adGroupNameDateCountry = new Map<string, string>();
    const campaignNameDateCountry = new Map<string, string>();
    const campaignIdDateCountry = new Map<string, string>();

    for (const row of adGroupRows) {
      const c = normalizeText(row.country);
      if (!c || c === "unknown") continue;
      const acc = normalizeId(row.account_id);
      const cid = normalizeId(row.campaign_id);
      const agn = normalizeText(row.ad_group_name);
      const cn = normalizeText(row.campaign_name);
      const d = String(row.campaign_date ?? "");

      if (acc && cid && d) campaignIdDateCountry.set(`${acc}|${cid}|${d}`, c);
      if (acc && agn && d) adGroupNameDateCountry.set(`${acc}|${agn}|${d}`, c);
      if (acc && cn && d) campaignNameDateCountry.set(`${acc}|${cn}|${d}`, c);
    }

    adGroupRows.forEach((row) => {
      if (normalizeText(row.country) !== "unknown") return;
      const acc = normalizeId(row.account_id);
      const cid = normalizeId(row.campaign_id);
      const agn = normalizeText(row.ad_group_name);
      const cn = normalizeText(row.campaign_name);
      const d = String(row.campaign_date ?? "");
      const inferred = campaignIdDateCountry.get(`${acc}|${cid}|${d}`)
        ?? adGroupNameDateCountry.get(`${acc}|${agn}|${d}`)
        ?? campaignNameDateCountry.get(`${acc}|${cn}|${d}`);
      if (inferred) row.country = inferred;
    });

    rawPlacementRows = rawPlacementRows.map((row) => {
      if (normalizeText(row.country) !== "unknown") return row;
      const acc = normalizeId(row.account_id);
      const cid = normalizeId(row.campaign_id);
      const cn = normalizeText(row.name);
      const d = String(row.campaign_date ?? "");
      const inferred = campaignIdDateCountry.get(`${acc}|${cid}|${d}`)
        ?? campaignNameDateCountry.get(`${acc}|${cn}|${d}`);
      if (inferred) row.country = inferred;
      return row;
    });

    const placementDedup = new Map<string, Record<string, unknown>>();
    for (const row of rawPlacementRows) {
      const key = `${row.account_id}|${row.campaign_id}|${row.campaign_date}|${row.placement}|${row.country}`;
      if (placementDedup.has(key)) {
        const ex = placementDedup.get(key)!;
        ex.impressions = ((ex.impressions as number) || 0) + ((row.impressions as number) || 0);
        ex.clicks = ((ex.clicks as number) || 0) + ((row.clicks as number) || 0);
        ex.amount_spent_usd = ((ex.amount_spent_usd as number) || 0) + ((row.amount_spent_usd as number) || 0);
        ex.purchase_click = ((ex.purchase_click as number) || 0) + ((row.purchase_click as number) || 0);
        ex.purchase_view = ((ex.purchase_view as number) || 0) + ((row.purchase_view as number) || 0);
      } else {
        placementDedup.set(key, { ...row });
      }
    }
    const placementRows = Array.from(placementDedup.values());

    const BATCH = 500;
    for (let i = 0; i < adGroupRows.length; i += BATCH) {
      const { error } = await supabase.from("microsoft_campaigns_ad_group_country").upsert(adGroupRows.slice(i, i + BATCH), {
        onConflict: "account_id,campaign_date,campaign_name,ad_group_name,country",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`microsoft_campaigns_ad_group_country upsert: ${error.message}`);
    }
    for (let i = 0; i < placementRows.length; i += BATCH) {
      const { error } = await supabase.from("microsoft_campaigns_placement_country").upsert(placementRows.slice(i, i + BATCH), {
        onConflict: "account_id,campaign_id,campaign_date,placement,country",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`microsoft_campaigns_placement_country upsert: ${error.message}`);
    }

    const allDates: string[] = [];
    for (let d = new Date(dateFrom); d <= dateTo; d.setUTCDate(d.getUTCDate() + 1)) allDates.push(d.toISOString().slice(0, 10));
    const countries = [...new Set([
      ...adGroupRows.map((r) => (r.country as string) || "unknown"),
      ...placementRows.map((r) => (r.country as string) || "unknown"),
    ])];
    const syncRows = allDates.flatMap((segment_date) =>
      countries.map((country) => ({ account_id: accountId, segment_date, country, synced_at: new Date().toISOString() }))
    );
    for (let i = 0; i < syncRows.length; i += BATCH) {
      const { error } = await supabase.from("microsoft_ads_sync_by_date_country").upsert(syncRows.slice(i, i + BATCH), {
        onConflict: "account_id,segment_date,country",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(`microsoft_ads_sync_by_date_country upsert: ${error.message}`);
    }

    const runId = crypto.randomUUID();
    const logMeta = { ad_group_rows: adGroupRows.length, placement_rows: placementRows.length, countries };
    const logRows = syncRows.map((r) => ({
      platform: "microsoft_ads_country",
      account_id: r.account_id,
      segment_date: r.segment_date,
      synced_at: r.synced_at,
      run_id: runId,
      date_range_start: dateFromStr,
      date_range_end: dateToStr,
      metadata: logMeta,
    }));
    for (let i = 0; i < logRows.length; i += BATCH) {
      const { error } = await supabase.from("ads_sync_by_date_log").insert(logRows.slice(i, i + BATCH));
      if (error) console.warn(LOG, "ads_sync_by_date_log:", error.message);
    }

    return new Response(JSON.stringify({
      ok: true,
      function: "sync-microsoft-ads-country",
      account_id: accountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      upserted: { ad_group_rows: adGroupRows.length, placement_rows: placementRows.length },
      countries,
      run_id: runId,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG, message);
    return new Response(JSON.stringify({ error: "sync_microsoft_ads_country_failed", message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
