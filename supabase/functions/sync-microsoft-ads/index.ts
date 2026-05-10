// Sync Microsoft Advertising (Bing Ads) data into Supabase via SOAP Reporting API.
// Required Supabase secrets (set via: supabase secrets set KEY=value):
//   MS_ADS_CLIENT_ID        – Azure AD Application (client) ID
//   MS_ADS_CLIENT_SECRET    – Azure AD client secret
//   MS_ADS_REFRESH_TOKEN    – OAuth2 refresh token from the one-time auth flow
//                             (run scripts/get-ms-ads-token.ps1 to obtain it)
//   MS_ADS_DEVELOPER_TOKEN  – Microsoft Advertising developer token
//   MS_ADS_CUSTOMER_ID      – Microsoft Advertising Customer ID (cid in URL)
//   MS_ADS_ACCOUNT_ID       – Microsoft Advertising Account ID (aid in URL)
//   SUPABASE_URL            – auto-set in Supabase Edge runtime
//   SUPABASE_SERVICE_ROLE_KEY – auto-set in Supabase Edge runtime

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate@0.8.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPORTING_ENDPOINT =
  "https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc";

/** Default sync window: this many distinct calendar dates (UTC), ending on the last completed day (yesterday). */
const DEFAULT_SYNC_DAY_COUNT = 3;

// ─── Env helpers ─────────────────────────────────────────────────────────────

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env secret: ${name}`);
  return v;
}

// ─── OAuth2 – Refresh Token flow (user-delegated, required by MS Ads SOAP) ───
//
// Microsoft Advertising SOAP API only accepts user-delegated tokens.
// Use scripts/get-ms-ads-token.ps1 to perform the one-time interactive auth
// and obtain MS_ADS_REFRESH_TOKEN.

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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MS OAuth2 refresh failed ${res.status}: ${t}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error(`No access_token in MS OAuth response: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

// ─── Customer Management API: discover correct CustomerId + AccountId ────────
// Searches ALL active accounts accessible to the user under the configured
// customerId context, logs every account (Id, Number, ParentCustomerId),
// and returns the best match. This auto-corrects a wrong MS_ADS_ACCOUNT_ID.

const CM_ENDPOINT =
  "https://clientcenter.api.bingads.microsoft.com/Api/CustomerManagement/v13/CustomerManagementService.svc";

interface AccountInfo {
  id: string;
  number: string;
  parentCustomerId: string;
}

// Raw CM API response stored for debug mode
let _lastCmRawResponse = "";

async function discoverAccountInfo(
  accessToken: string,
  developerToken: string,
  customerId: string,
  accountId: string
): Promise<{ effectiveCustomerId: string; effectiveAccountId: string }> {
  const NS = "https://bingads.microsoft.com/CustomerManagement/v13";

  // Try two predicate strategies:
  // 1. CustomerId = configured cid  (accounts owned by that customer)
  // 2. AccountId = configured aid   (direct lookup of the specific account)
  const predicateStrategies = [
    `<Predicate><Field>CustomerId</Field><Operator>Equals</Operator><Value>${customerId}</Value></Predicate>`,
    `<Predicate><Field>AccountId</Field><Operator>Equals</Operator><Value>${accountId}</Value></Predicate>`,
  ];

  for (const predicate of predicateStrategies) {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance"
            xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="${NS}">
    <Action mustUnderstand="1">SearchAccounts</Action>
    <AuthenticationToken>${accessToken}</AuthenticationToken>
    <CustomerId>${customerId}</CustomerId>
    <DeveloperToken>${developerToken}</DeveloperToken>
  </s:Header>
  <s:Body>
    <SearchAccountsRequest xmlns="${NS}">
      <Predicates>${predicate}</Predicates>
      <Ordering i:nil="true"/>
      <PageInfo><Index>0</Index><Size>100</Size></PageInfo>
    </SearchAccountsRequest>
  </s:Body>
</s:Envelope>`;

    try {
      const res = await fetch(CM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "SearchAccounts" },
        body: envelope,
      });
      const text = await res.text();
      _lastCmRawResponse = text;
      console.log(`[ms-ads] SearchAccounts(${predicate.includes("CustomerId") ? "CustomerId" : "AccountId"}) HTTP ${res.status} raw (first 2000):`, text.slice(0, 2000));

      const accounts: AccountInfo[] = [];
      const re = /<AdvertiserAccount[\s\S]*?<\/AdvertiserAccount>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const xml = m[0];
        const idM  = xml.match(/<Id>(\d+)<\/Id>/);
        const numM = xml.match(/<Number>([^<]+)<\/Number>/);
        const parM = xml.match(/<ParentCustomerId>(\d+)<\/ParentCustomerId>/);
        if (idM) {
          accounts.push({
            id: idM[1],
            number: numM?.[1] ?? "?",
            parentCustomerId: parM?.[1] ?? customerId,
          });
        }
      }
      console.log(`[ms-ads] Accounts found (${accounts.length}):`, JSON.stringify(accounts));

      if (accounts.length > 0) {
        const matched = accounts.find((a) => a.id === accountId) ?? accounts[0];
        console.log(`[ms-ads] Using account id=${matched.id} number=${matched.number} parentCustomerId=${matched.parentCustomerId}`);
        return { effectiveCustomerId: matched.parentCustomerId, effectiveAccountId: matched.id };
      }
    } catch (e) {
      console.warn("[ms-ads] SearchAccounts error:", e instanceof Error ? e.message : String(e));
    }
  }

  console.warn("[ms-ads] All SearchAccounts strategies returned no accounts. Using configured values.");
  return { effectiveCustomerId: customerId, effectiveAccountId: accountId };
}

// ─── SOAP helpers ─────────────────────────────────────────────────────────────

// Official MS Advertising SOAP header element order (strict alphabetical, WCF DataContract):
//   AuthenticationToken → CustomerId → DeveloperToken
// CustomerAccountId is optional for Reporting and is omitted here to avoid
// AccountNotAuthorized errors when the exact numeric account ID is unknown.
// The Scope in the report body already targets accounts under the customer.
function soapHeader(
  action: string,
  accessToken: string,
  developerToken: string,
  customerId: string,
  _customerAccountId: string
): string {
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

/** Extract the text content of the first matching XML tag (exact name, optional namespace prefix). */
function xmlText(xml: string, tag: string): string | null {
  // Use word boundary approach: match EXACTLY "tag" not tags that END in "tag"
  // e.g., for "Status" we must NOT match "ReportRequestStatus"
  const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s[^>]*)?>([^<]*)`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

// ─── Submit report request ────────────────────────────────────────────────────

async function submitReport(
  accessToken: string,
  developerToken: string,
  customerId: string,
  customerAccountId: string,
  reportXmlBody: string
): Promise<string> {
  const header = soapHeader("SubmitGenerateReport", accessToken, developerToken, customerId, customerAccountId);
  const body = `<SubmitGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">
    ${reportXmlBody}
  </SubmitGenerateReportRequest>`;

  const res = await fetch(REPORTING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "SubmitGenerateReport",
    },
    body: wrapSoap(header, body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SubmitGenerateReport HTTP ${res.status}: ${text.slice(0, 1200)}`);

  const id = xmlText(text, "ReportRequestId");
  if (!id) throw new Error(`No ReportRequestId in response: ${text.slice(0, 1200)}`);
  return id;
}

// ─── Poll for report completion ───────────────────────────────────────────────

interface PollResult {
  status: string;
  downloadUrl: string | null;
}

async function pollReport(
  accessToken: string,
  developerToken: string,
  customerId: string,
  customerAccountId: string,
  reportRequestId: string,
  logRaw = false
): Promise<PollResult> {
  const header = soapHeader("PollGenerateReport", accessToken, developerToken, customerId, customerAccountId);
  const body = `<PollGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">
    <ReportRequestId>${reportRequestId}</ReportRequestId>
  </PollGenerateReportRequest>`;

  const res = await fetch(REPORTING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "PollGenerateReport",
    },
    body: wrapSoap(header, body),
  });
  const text = await res.text();
  if (logRaw) console.log(`[ms-ads] PollGenerateReport HTTP ${res.status} raw (first 800):`, text.slice(0, 800));
  if (!res.ok) throw new Error(`PollGenerateReport HTTP ${res.status}: ${text.slice(0, 800)}`);

  const status = xmlText(text, "Status") ?? "Pending";
  if (status === "Error") {
    const msg = xmlText(text, "Message") ?? "Unknown report error";
    throw new Error(`Report generation error: ${msg}`);
  }

  const downloadUrl = xmlText(text, "ReportDownloadUrl");
  return { status, downloadUrl };
}

/** Poll until Success or timeout (maxWaitMs). Returns download URL or null (empty report). */
async function waitForReport(
  accessToken: string,
  developerToken: string,
  customerId: string,
  customerAccountId: string,
  reportRequestId: string,
  maxWaitMs = 110_000
): Promise<string | null> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < maxWaitMs) {
    attempt++;
    await new Promise((r) => setTimeout(r, attempt === 1 ? 5_000 : 5_000));
    // Log raw response for first 2 polls to diagnose issues
    const { status, downloadUrl } = await pollReport(
      accessToken, developerToken, customerId, customerAccountId, reportRequestId, attempt <= 2
    );
    console.log(`[ms-ads] Poll #${attempt} status=${status} downloadUrl=${downloadUrl ? "yes" : "none"}`);
    // Use downloadUrl presence as success indicator — status can parse as empty even when ready
    if (downloadUrl || status === "Success") return downloadUrl ?? null;
    if (status === "Error") throw new Error("Report failed");
  }
  throw new Error(`Report did not complete within ${maxWaitMs / 1000}s`);
}

// ─── Download + decompress ZIP report ────────────────────────────────────────

async function downloadReportCsv(url: string): Promise<string> {
  // The URL comes from XML so ampersands are encoded as &amp; — decode before fetching
  const decodedUrl = url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  const res = await fetch(decodedUrl);
  if (!res.ok) throw new Error(`Report download failed ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());

  // ZIP signature: PK (0x50 0x4B)
  if (buf[0] === 0x50 && buf[1] === 0x4B) {
    const unzipped = unzipSync(buf);
    const files = Object.values(unzipped);
    if (!files.length) throw new Error("Empty ZIP archive from report download");
    return new TextDecoder("utf-8").decode(files[0]);
  }
  return new TextDecoder("utf-8").decode(buf);
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

/** Parse CSV text into an array of header-keyed objects, skipping MS Ads report preamble rows. */
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

  // MS Ads CSV preamble lines are all single-column (even ones with commas, because the
  // comma is inside quotes). The actual column-header row has MULTIPLE comma-separated values.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseLine(line);
    if (cols.length > 1) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const headers = parseLine(lines[headerIdx]);
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === '""' || line.startsWith('"©')) break; // footer
    const cols = parseLine(lines[i]);
    if (cols.length < 2) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] ?? ""; });
    rows.push(obj);
  }
  return rows;
}

/** Parse Microsoft Ads date formats: "3/20/2026" or "2026-03-20" → "2026-03-20" */
function parseMsDate(val: string): string | null {
  if (!val) return null;
  val = val.trim();
  if (val.match(/^\d{4}-\d{2}-\d{2}$/)) return val;
  const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  }
  return null;
}

/** Strip thousand-separator commas and parse as float (returns null if blank/dash). */
function parseNum(val: string): number | null {
  if (!val || val === "--" || val === "") return null;
  return parseFloat(val.replace(/,/g, "")) || null;
}

// ─── Report XML builders ──────────────────────────────────────────────────────

function buildDateRange(from: Date, to: Date): string {
  // Microsoft Advertising SOAP schema requires elements in alphabetical (WCF DataContract) order:
  // CustomDateRangeEnd → CustomDateRangeStart → PredefinedTime (nil) → ReportTimeZone
  const fmt = (d: Date) =>
    `<Day>${d.getUTCDate()}</Day><Month>${d.getUTCMonth() + 1}</Month><Year>${d.getUTCFullYear()}</Year>`;
  return `
    <CustomDateRangeEnd>${fmt(to)}</CustomDateRangeEnd>
    <CustomDateRangeStart>${fmt(from)}</CustomDateRangeStart>
    <PredefinedTime i:nil="true"/>
    <ReportTimeZone>GreenwichMeanTimeDublinEdinburghLisbonLondon</ReportTimeZone>`;
}

// WCF DataContract order: base-class props first (Format…ReturnOnlyCompleteData),
// then derived-class props alphabetically: Aggregation, Columns, Filter, MaxRows, Scope, Time.
function adGroupReportXml(accountId: string, from: Date, to: Date): string {
  return `<ReportRequest i:type="AdGroupPerformanceReportRequest"
    xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <Format>Csv</Format>
    <Language>English</Language>
    <ReportName>AdGroupPerformanceReport</ReportName>
    <ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
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
    <Filter i:nil="true"/>
    <MaxRows i:nil="true"/>
    <Scope>
      <AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
        <a:long>${accountId}</a:long>
      </AccountIds>
    </Scope>
    <Time>${buildDateRange(from, to)}</Time>
  </ReportRequest>`;
}

// PublisherUsagePerformanceReportRequest derived order: Aggregation, Columns, Filter, Scope, Time
function publisherReportXml(accountId: string, from: Date, to: Date): string {
  return `<ReportRequest i:type="PublisherUsagePerformanceReportRequest"
    xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <Format>Csv</Format>
    <Language>English</Language>
    <ReportName>PublisherUsagePerformanceReport</ReportName>
    <ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
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
    <Scope>
      <AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
        <a:long>${accountId}</a:long>
      </AccountIds>
    </Scope>
    <Time>${buildDateRange(from, to)}</Time>
  </ReportRequest>`;
}

function geographicReportXml(accountId: string, from: Date, to: Date): string {
  return `<ReportRequest i:type="GeographicPerformanceReportRequest"
    xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
    <Format>Csv</Format>
    <Language>English</Language>
    <ReportName>GeographicPerformanceReferenceReport</ReportName>
    <ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
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
    <Scope>
      <AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
        <a:long>${accountId}</a:long>
      </AccountIds>
    </Scope>
    <Time>${buildDateRange(from, to)}</Time>
  </ReportRequest>`;
}

function pickCountryFromGeoRow(r: Record<string, string>): string {
  const c = (r["Country"] ?? r["Country/Region"] ?? r["Country Code"] ?? r["CountryCode"] ?? "").trim();
  if (c) return c;
  const locationType = (r["Location type"] ?? r["LocationType"] ?? "").trim().toLowerCase();
  const mostSpecific = (r["Most specific location"] ?? r["MostSpecificLocation"] ?? "").trim();
  if (mostSpecific && (locationType === "country" || !locationType)) return mostSpecific;
  return "unknown";
}

/** Distinct (campaign_name, country) from geographic report rows for reference_data. */
function referencePairsFromGeoRows(geoRows: Record<string, string>[]): { campaign_name: string; country: string }[] {
  const m = new Map<string, { campaign_name: string; country: string }>();
  for (const r of geoRows) {
    const campaign_name = (r["Campaign"] ?? r["CampaignName"] ?? "").trim();
    const country = pickCountryFromGeoRow(r);
    if (!campaign_name || !country || country === "unknown") continue;
    m.set(`${campaign_name}\t${country}`, { campaign_name, country });
  }
  return [...m.values()];
}

interface GeoAgg {
  spend: number;
  impr: number;
}

/** Same dimensions as microsoft_campaigns_ad_group upsert key; pick country with largest geo Spend (then Impressions). */
function adGroupCountryFromGeoRows(
  geoRows: Record<string, string>[],
  fallbackAccountId: string
): Map<string, string> {
  const perKey = new Map<string, Map<string, GeoAgg>>();

  for (const r of geoRows) {
    const campaign_date = parseMsDate(r["Time period"] ?? r["TimePeriod"] ?? r["Day"] ?? "");
    if (!campaign_date) continue;
    const account_id = String(r["Account ID"] ?? r["AccountId"] ?? fallbackAccountId).trim();
    const campaign_name = String(r["Campaign"] ?? r["CampaignName"] ?? "").trim();
    const ad_group_name = String(r["Ad group"] ?? r["AdGroupName"] ?? "").trim();
    if (!campaign_name || !ad_group_name) continue;
    const country = pickCountryFromGeoRow(r);
    if (!country || country === "unknown") continue;
    const spend = parseNum(r["Spend"] ?? "") ?? 0;
    const impr = parseNum(r["Impressions"] ?? "") ?? 0;
    const rowKey = `${account_id}\t${campaign_date}\t${campaign_name}\t${ad_group_name}`;
    if (!perKey.has(rowKey)) perKey.set(rowKey, new Map());
    const byCountry = perKey.get(rowKey)!;
    const prev = byCountry.get(country);
    if (prev) {
      prev.spend += spend;
      prev.impr += impr;
    } else {
      byCountry.set(country, { spend, impr });
    }
  }

  const out = new Map<string, string>();
  for (const [rowKey, byCountry] of perKey) {
    let best = "";
    let bestSpend = -1;
    let bestImpr = -1;
    for (const [country, { spend, impr }] of byCountry) {
      if (spend > bestSpend || (spend === bestSpend && impr > bestImpr)) {
        bestSpend = spend;
        bestImpr = impr;
        best = country;
      }
    }
    if (best) out.set(rowKey, best);
  }
  return out;
}

function adGroupRowKey(row: Record<string, unknown>): string {
  const account_id = String(row.account_id ?? "").trim();
  const campaign_date = String(row.campaign_date ?? "").trim();
  const campaign_name = String(row.campaign_name ?? "").trim();
  const ad_group_name = String(row.ad_group_name ?? "").trim();
  return `${account_id}\t${campaign_date}\t${campaign_name}\t${ad_group_name}`;
}

// ─── Data transformers ────────────────────────────────────────────────────────

function toAdGroupRow(
  r: Record<string, string>,
  accountId: string
): Record<string, unknown> | null {
  const campaign_date = parseMsDate(r["Time period"] ?? r["TimePeriod"] ?? r["Day"] ?? "");
  if (!campaign_date) return null;
  const spend = parseNum(r["Spend"] ?? r["spend"] ?? "");
  const account_id = (r["Account ID"] ?? r["AccountId"] ?? accountId).trim();
  return {
    account_id,
    campaign_id: r["Campaign ID"] ?? r["CampaignId"] ?? null,
    campaign_name: r["Campaign"] ?? r["CampaignName"] ?? null,
    ad_group_id: r["Ad group ID"] ?? r["AdGroupId"] ?? null,
    ad_group_name: r["Ad group"] ?? r["AdGroupName"] ?? null,
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
    community: null,
  };
}

function toPlacementRow(
  r: Record<string, string>,
  accountId: string
): Record<string, unknown> | null {
  const campaign_date = parseMsDate(r["Time period"] ?? r["TimePeriod"] ?? r["Day"] ?? "");
  if (!campaign_date) return null;
  const account_id = (r["Account ID"] ?? r["AccountId"] ?? accountId).trim();
  return {
    account_id,
    campaign_id: r["Campaign ID"] ?? r["CampaignId"] ?? null,
    campaign_date,
    name: r["Campaign"] ?? r["CampaignName"] ?? null,
    placement: r["Website"] ?? r["PublisherUrl"] ?? r["Ad distribution"] ?? r["AdDistribution"] ?? null,
    community: null,
    impressions: parseNum(r["Impressions"] ?? "") ?? 0,
    clicks: parseNum(r["Clicks"] ?? "") ?? 0,
    amount_spent_usd: parseNum(r["Spend"] ?? ""),
    purchase_click: parseNum(r["Conversions"] ?? r["All conv."] ?? ""),
    purchase_view: parseNum(r["View-through conv."] ?? r["ViewThroughConversions"] ?? ""),
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  console.log("[sync-microsoft-ads] Started", new Date().toISOString());

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── Config ──────────────────────────────────────────────────────────────
    const clientId     = getEnv("MS_ADS_CLIENT_ID");
    const clientSecret = getEnv("MS_ADS_CLIENT_SECRET");
    const refreshToken = getEnv("MS_ADS_REFRESH_TOKEN");
    const developerToken = getEnv("MS_ADS_DEVELOPER_TOKEN");
    const customerId   = getEnv("MS_ADS_CUSTOMER_ID");
    const accountId    = getEnv("MS_ADS_ACCOUNT_ID");
    const supabaseUrl  = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    // ── Date range ────────────────────────────────────────────────────────
    // Default: last DEFAULT_SYNC_DAY_COUNT UTC calendar days through yesterday (update + insert via upsert below).
    // Override: ?date_from=2025-12-01&date_to=2025-12-31 or body {"date_from":"...","date_to":"..."}
    let bodyDateFrom = "", bodyDateTo = "";
    try {
      const b = await req.clone().json() as Record<string, string>;
      bodyDateFrom = b?.date_from ?? "";
      bodyDateTo   = b?.date_to   ?? "";
    } catch { /* no JSON body */ }

    const reqUrl = new URL(req.url);
    const fromParam = reqUrl.searchParams.get("date_from") ?? bodyDateFrom;
    const toParam   = reqUrl.searchParams.get("date_to")   ?? bodyDateTo;

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const defaultDateTo = new Date(todayUtc);
    defaultDateTo.setUTCDate(todayUtc.getUTCDate() - 1); // yesterday — daily reports complete through prior UTC day
    const defaultDateFrom = new Date(defaultDateTo);
    defaultDateFrom.setUTCDate(defaultDateTo.getUTCDate() - (DEFAULT_SYNC_DAY_COUNT - 1)); // inclusive N days ending defaultDateTo

    let dateFrom = fromParam ? new Date(`${fromParam}T00:00:00Z`) : defaultDateFrom;
    let dateTo   = toParam   ? new Date(`${toParam}T00:00:00Z`)   : defaultDateTo;
    if (dateFrom.getTime() > dateTo.getTime()) {
      const t = dateFrom;
      dateFrom = dateTo;
      dateTo = t;
    }

    const rangeNote = !fromParam && !toParam
      ? ` (default: last ${DEFAULT_SYNC_DAY_COUNT} UTC calendar days through yesterday)`
      : "";
    console.log(`[sync-microsoft-ads] Date range: ${dateFrom.toISOString().slice(0,10)} → ${dateTo.toISOString().slice(0,10)}${rangeNote}`);

    // ── OAuth2 token (refresh token flow) ────────────────────────────────
    console.log("[sync-microsoft-ads] Getting access token…");
    const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
    console.log("[sync-microsoft-ads] Access token obtained.");

    // CM API discovery is skipped — it requires a different auth context and
    // always falls back to configured values. Use configured IDs directly.
    const effectiveCustomerId = customerId;
    const effectiveAccountId  = accountId;
    console.log(`[ms-ads] Using CustomerId=${effectiveCustomerId}, AccountId=${effectiveAccountId}`);

    const url = reqUrl;

    // ── Debug mode: return discovery result without calling Reporting API ─
    if (url.searchParams.get("debug") === "true") {
      return new Response(JSON.stringify({
        debug: true,
        configured: { customerId, accountId },
        discovered: { effectiveCustomerId, effectiveAccountId },
        cm_raw_response: _lastCmRawResponse.slice(0, 3000),
      }, null, 2), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── Submit-only mode: submit reports and return request IDs (no polling) ─
    // Use ?submit_only=true to get report IDs, then ?poll_ids=ID1,ID2 to poll.
    if (url.searchParams.get("submit_only") === "true") {
      const supabaseSubmit = createClient(supabaseUrl, serviceRoleKey);
      void supabaseSubmit; // unused here
      const [adGroupReqId2, publisherReqId2, geoReqId2] = await Promise.all([
        submitReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId,
          adGroupReportXml(effectiveAccountId, dateFrom, dateTo)),
        submitReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId,
          publisherReportXml(effectiveAccountId, dateFrom, dateTo)),
        submitReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId,
          geographicReportXml(effectiveAccountId, dateFrom, dateTo)),
      ]);
      return new Response(JSON.stringify({
        submit_only: true,
        adGroupReportId: adGroupReqId2,
        publisherReportId: publisherReqId2,
        geographicReportId: geoReqId2,
      }, null, 2), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── Poll-only mode: poll specific report IDs ─────────────────────────
    // Use ?poll_ids=ID1,ID2 to check status of previously submitted reports.
    const pollIds = url.searchParams.get("poll_ids");
    if (pollIds) {
      const ids = pollIds.split(",").filter(Boolean);
      const results = await Promise.all(ids.map(async (id) => {
        try {
          const result = await pollReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId, id.trim(), true);
          return { id, ...result };
        } catch (e) {
          return { id, error: e instanceof Error ? e.message : String(e) };
        }
      }));
      return new Response(JSON.stringify({ poll_results: results }, null, 2),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Submit reports concurrently (ad group, publisher, geographic → country on facts + reference) ──
    console.log("[sync-microsoft-ads] Submitting reports…");
    const [adGroupReqId, publisherReqId, geoReqId] = await Promise.all([
      submitReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId,
        adGroupReportXml(effectiveAccountId, dateFrom, dateTo)),
      submitReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId,
        publisherReportXml(effectiveAccountId, dateFrom, dateTo)),
      submitReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId,
        geographicReportXml(effectiveAccountId, dateFrom, dateTo)),
    ]);
    console.log(`[sync-microsoft-ads] AdGroup report ID: ${adGroupReqId}`);
    console.log(`[sync-microsoft-ads] Publisher report ID: ${publisherReqId}`);
    console.log(`[sync-microsoft-ads] Geographic report ID: ${geoReqId}`);

    // ── Wait for reports ────────────────────────────────────────────────
    console.log("[sync-microsoft-ads] Waiting for reports…");
    const [adGroupUrl, publisherUrl, geoUrl] = await Promise.all([
      waitForReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId, adGroupReqId, 110_000),
      waitForReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId, publisherReqId, 110_000),
      waitForReport(accessToken, developerToken, effectiveCustomerId, effectiveAccountId, geoReqId, 110_000),
    ]);

    // ── Download and parse ───────────────────────────────────────────────
    // null URL = empty report (no data for this date range) → treat as 0 rows
    console.log("[sync-microsoft-ads] Downloading reports…");
    const [adGroupCsv, publisherCsv, geoCsv] = await Promise.all([
      adGroupUrl  ? downloadReportCsv(adGroupUrl)  : Promise.resolve(""),
      publisherUrl ? downloadReportCsv(publisherUrl) : Promise.resolve(""),
      geoUrl ? downloadReportCsv(geoUrl) : Promise.resolve(""),
    ]);

    console.log(`[sync-microsoft-ads] AdGroup CSV length: ${adGroupCsv.length}, Publisher CSV length: ${publisherCsv.length}, Geographic CSV length: ${geoCsv.length}`);

    // ── CSV debug mode: return raw CSV for inspection ─────────────────────
    if (url.searchParams.get("csv_debug") === "true") {
      return new Response(JSON.stringify({
        adGroupCsvFirst1000: adGroupCsv.slice(0, 1000),
        publisherCsvFirst1000: publisherCsv.slice(0, 1000),
        geoCsvFirst1000: geoCsv.slice(0, 1000),
        adGroupUrl, publisherUrl, geoUrl,
      }, null, 2), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const adGroupRawRows = parseMsAdsCsv(adGroupCsv);
    const publisherRawRows = parseMsAdsCsv(publisherCsv);
    const geoRows = parseMsAdsCsv(geoCsv);
    console.log(`[sync-microsoft-ads] AdGroup rows: ${adGroupRawRows.length}, Publisher rows: ${publisherRawRows.length}, Geo rows: ${geoRows.length}`);
    // Log the real account IDs returned by the API so MS_ADS_ACCOUNT_ID can be verified/corrected
    const realAccountIds = [...new Set(adGroupRawRows.map(r => r["Account ID"] ?? r["AccountId"]).filter(Boolean))];
    console.log(`[sync-microsoft-ads] Account IDs in report: ${JSON.stringify(realAccountIds)}`);

    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    const dateToStr = dateTo.toISOString().slice(0, 10);

    // ── Upsert Ad Group performance (existing rows for the same key are updated; new keys are inserted) ──
    const geoCountryByKey = adGroupCountryFromGeoRows(geoRows, effectiveAccountId);
    const adGroupRows: Record<string, unknown>[] = adGroupRawRows
      .map((r) => toAdGroupRow(r, effectiveAccountId))
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((row): Record<string, unknown> => {
        const c = geoCountryByKey.get(adGroupRowKey(row));
        return { ...row, country: c ?? null };
      });
    const adGroupRowsWithCountry = adGroupRows.filter(
      (r) => r.country != null && String(r.country).trim() !== ""
    ).length;
    console.log(`[sync-microsoft-ads] Ad group rows with country from geo: ${adGroupRowsWithCountry} / ${adGroupRows.length}`);

    if (adGroupRows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < adGroupRows.length; i += BATCH) {
        const chunk = adGroupRows.slice(i, i + BATCH);
        const { error } = await supabase
          .from("microsoft_campaigns_ad_group")
          .upsert(chunk, {
            onConflict: "account_id,campaign_date,campaign_name,ad_group_name",
            ignoreDuplicates: false,
          });
        if (error) throw new Error(`microsoft_campaigns_ad_group upsert: ${error.message}`);
      }
      console.log(`[sync-microsoft-ads] Upserted ${adGroupRows.length} ad group rows.`);

      // Sync reference data (new campaigns only)
      const uniqueCampaigns = [...new Set(
        adGroupRows.map((r) => (r.campaign_name as string)?.trim()).filter(Boolean)
      )];
      if (uniqueCampaigns.length > 0) {
        const { data: existing } = await supabase
          .from("microsoft_campaigns_reference_data")
          .select("campaign_name")
          .in("campaign_name", uniqueCampaigns);
        const existingSet = new Set(
          (existing ?? []).map((e) => (e.campaign_name as string)?.trim()).filter(Boolean)
        );
        const newCampaigns = uniqueCampaigns
          .filter((n) => !existingSet.has(n))
          .map((campaign_name) => ({ campaign_name }));
        if (newCampaigns.length > 0) {
          const { error: refErr } = await supabase
            .from("microsoft_campaigns_reference_data")
            .insert(newCampaigns);
          if (refErr) console.warn("[sync-microsoft-ads] Reference data insert:", refErr.message);
          else console.log(`[sync-microsoft-ads] Added ${newCampaigns.length} new campaign(s) to reference data.`);
        }
      }
    }

    // Reference rows with country from geographic performance report (runs even if ad group fact rows are empty).
    const geoRefPairs = referencePairsFromGeoRows(geoRows);
    if (geoRefPairs.length > 0) {
      const geoNames = [...new Set(geoRefPairs.map((p) => p.campaign_name))];
      const { data: existingGeo } = await supabase
        .from("microsoft_campaigns_reference_data")
        .select("campaign_name, country")
        .in("campaign_name", geoNames);
      const existingGeoSet = new Set(
        (existingGeo ?? []).map((e) => {
          const n = String(e.campaign_name ?? "").trim();
          const c = String(e.country ?? "").trim();
          return `${n}\t${c}`;
        })
      );
      const newGeoRef = geoRefPairs.filter((p) => !existingGeoSet.has(`${p.campaign_name}\t${p.country}`));
      if (newGeoRef.length > 0) {
        const REF_BATCH = 500;
        let geoRefInsertFailed = false;
        for (let gi = 0; gi < newGeoRef.length; gi += REF_BATCH) {
          const chunk = newGeoRef.slice(gi, gi + REF_BATCH);
          const { error: geoRefErr } = await supabase
            .from("microsoft_campaigns_reference_data")
            .insert(chunk);
          if (geoRefErr) {
            console.warn("[sync-microsoft-ads] Reference data (country from geo) insert:", geoRefErr.message);
            geoRefInsertFailed = true;
            break;
          }
        }
        if (!geoRefInsertFailed) {
          console.log(`[sync-microsoft-ads] Added ${newGeoRef.length} campaign+country reference row(s) from geographic report.`);
        }
      }
    }

    // ── Upsert Placement performance (same: update on conflict, insert otherwise) ──
    // Deduplicate by conflict key (account_id, campaign_id, campaign_date, placement)
    // Multiple ad groups can share the same placement URL — sum their metrics.
    const rawPlacementRows = publisherRawRows
      .map((r) => toPlacementRow(r, effectiveAccountId))
      .filter((r): r is Record<string, unknown> => r !== null);

    const placementDedup = new Map<string, Record<string, unknown>>();
    for (const row of rawPlacementRows) {
      const key = `${row.account_id}|${row.campaign_id}|${row.campaign_date}|${row.placement}`;
      if (placementDedup.has(key)) {
        const ex = placementDedup.get(key)!;
        ex.impressions     = ((ex.impressions     as number) || 0) + ((row.impressions     as number) || 0);
        ex.clicks          = ((ex.clicks          as number) || 0) + ((row.clicks          as number) || 0);
        ex.amount_spent_usd= ((ex.amount_spent_usd as number) || 0) + ((row.amount_spent_usd as number) || 0);
        ex.purchase_click  = ((ex.purchase_click  as number) || 0) + ((row.purchase_click  as number) || 0);
        ex.purchase_view   = ((ex.purchase_view   as number) || 0) + ((row.purchase_view   as number) || 0);
      } else {
        placementDedup.set(key, { ...row });
      }
    }
    const placementRows = Array.from(placementDedup.values());

    if (placementRows.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < placementRows.length; i += BATCH) {
        const chunk = placementRows.slice(i, i + BATCH);
        const { error } = await supabase
          .from("microsoft_campaigns_placement")
          .upsert(chunk, {
            onConflict: "account_id,campaign_id,campaign_date,placement",
            ignoreDuplicates: false,
          });
        if (error) throw new Error(`microsoft_campaigns_placement upsert: ${error.message}`);
      }
      console.log(`[sync-microsoft-ads] Upserted ${placementRows.length} placement rows.`);
    }

    // ── Record sync log ──────────────────────────────────────────────────
    const syncDates: string[] = [];
    for (let d = new Date(dateFrom); d <= dateTo; d.setUTCDate(d.getUTCDate() + 1)) {
      syncDates.push(d.toISOString().slice(0, 10));
    }
    const syncLogRows = syncDates.map((segment_date) => ({
      account_id: effectiveAccountId,
      segment_date,
      synced_at: new Date().toISOString(),
    }));
    await supabase
      .from("microsoft_ads_sync_by_date")
      .upsert(syncLogRows, { onConflict: "account_id,segment_date" });

    // Also log to the platform-wide ads_sync_by_date_log table (run_id + metadata required for UI sync log)
    const syncedAtLog = new Date().toISOString();
    const runId = crypto.randomUUID();
    const logMeta = {
      ad_group_rows: adGroupRows.length,
      placement_rows: placementRows.length,
    };
    const logRows = syncDates.map((segment_date) => ({
      platform: "microsoft_ads",
      account_id: effectiveAccountId,
      segment_date,
      synced_at: syncedAtLog,
      run_id: runId,
      date_range_start: dateFromStr,
      date_range_end: dateToStr,
      metadata: logMeta,
    }));
    await supabase
      .from("ads_sync_by_date_log")
      .upsert(logRows, { onConflict: "platform,account_id,segment_date" })
      .then(({ error }) => {
        if (error) console.warn("[sync-microsoft-ads] ads_sync_by_date_log:", error.message);
      });

    const result = {
      ok: true,
      account_id: effectiveAccountId,
      date_from: dateFromStr,
      date_to: dateToStr,
      upserted: {
        ad_group_rows: adGroupRows.length,
        placement_rows: placementRows.length,
      },
    };
    console.log("[sync-microsoft-ads] Done", JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-microsoft-ads] Error:", message);
    return new Response(
      JSON.stringify({ error: "sync_microsoft_ads_failed", message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
