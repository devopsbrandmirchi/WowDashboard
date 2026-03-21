/**
 * Microsoft Ads: OAuth + Reporting SOAP + ZIP/CSV → ad-group daily rows.
 * Inlined in this folder: Supabase Edge deploy bundles only each function directory (no `../_shared`).
 * Keep in sync with the same file in `sync-microsoft-ads-upsert/` and `fetch-microsoft-ads/`.
 */
import { unzipSync } from "npm:fflate@0.8.2";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const REPORTING_URL =
  "https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc";
const REPORT_NS = "https://bingads.microsoft.com/Reporting/v13";
const ARRAY_NS = "http://schemas.microsoft.com/2003/10/Serialization/Arrays";
const INSTANCE_NS = "http://www.w3.org/2001/XMLSchema-instance";

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v?.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: getEnv("MICROSOFT_ADS_CLIENT_ID"),
    client_secret: getEnv("MICROSOFT_ADS_CLIENT_SECRET"),
    refresh_token: getEnv("MICROSOFT_ADS_REFRESH_TOKEN"),
    grant_type: "refresh_token",
    scope: "https://ads.microsoft.com/msads.manage offline_access",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Microsoft OAuth failed: ${res.status} ${t.slice(0, 400)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("No access_token in Microsoft OAuth response");
  return json.access_token;
}

function soapEnvelopeWithAuth(
  action: string,
  innerBody: string,
  authToken: string,
  customerId: string,
  accountId: string,
  developerToken: string,
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="${REPORT_NS}">
    <Action mustUnderstand="1">${action}</Action>
    <AuthenticationToken>${escapeXml(authToken)}</AuthenticationToken>
    <CustomerAccountId>${escapeXml(accountId)}</CustomerAccountId>
    <CustomerId>${escapeXml(customerId)}</CustomerId>
    <DeveloperToken>${escapeXml(developerToken)}</DeveloperToken>
  </s:Header>
  <s:Body>
    ${innerBody}
  </s:Body>
</s:Envelope>`;
}

function parseParts(from: string, to: string): { sy: number; sm: number; sd: number; ey: number; em: number; ed: number } {
  const [ys, ms, ds] = from.split("-").map(Number);
  const [ye, me, de] = to.split("-").map(Number);
  return { sy: ys, sm: ms, sd: ds, ey: ye, em: me, ed: de };
}

function submitReportBody(accountId: string, from: string, to: string): string {
  const { sy, sm, sd, ey, em, ed } = parseParts(from, to);
  return `
    <SubmitGenerateReportRequest xmlns="${REPORT_NS}">
      <ReportRequest xmlns:i="${INSTANCE_NS}" i:type="AdGroupPerformanceReportRequest">
        <ExcludeColumnHeaders>false</ExcludeColumnHeaders>
        <ExcludeReportFooter>true</ExcludeReportFooter>
        <ExcludeReportHeader>true</ExcludeReportHeader>
        <Format>Csv</Format>
        <FormatVersion>2.0</FormatVersion>
        <ReportName>WowDashboard_AdGroup_Daily</ReportName>
        <ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
        <Aggregation>Daily</Aggregation>
        <Columns>
          <AdGroupPerformanceReportColumn>TimePeriod</AdGroupPerformanceReportColumn>
          <AdGroupPerformanceReportColumn>CampaignId</AdGroupPerformanceReportColumn>
          <AdGroupPerformanceReportColumn>CampaignName</AdGroupPerformanceReportColumn>
          <AdGroupPerformanceReportColumn>AdGroupId</AdGroupPerformanceReportColumn>
          <AdGroupPerformanceReportColumn>AdGroupName</AdGroupPerformanceReportColumn>
          <AdGroupPerformanceReportColumn>Impressions</AdGroupPerformanceReportColumn>
          <AdGroupPerformanceReportColumn>Clicks</AdGroupPerformanceReportColumn>
          <AdGroupPerformanceReportColumn>Spend</AdGroupPerformanceReportColumn>
          <AdGroupPerformanceReportColumn>Conversions</AdGroupPerformanceReportColumn>
        </Columns>
        <Filter i:nil="true" xmlns:i="${INSTANCE_NS}" />
        <Scope>
          <AccountIds xmlns:a1="${ARRAY_NS}">
            <a1:long>${escapeXml(accountId)}</a1:long>
          </AccountIds>
        </Scope>
        <Time>
          <CustomDateRangeStart>
            <Day>${sd}</Day>
            <Month>${sm}</Month>
            <Year>${sy}</Year>
          </CustomDateRangeStart>
          <CustomDateRangeEnd>
            <Day>${ed}</Day>
            <Month>${em}</Month>
            <Year>${ey}</Year>
          </CustomDateRangeEnd>
          <PredefinedTime i:nil="true" xmlns:i="${INSTANCE_NS}" />
          <ReportTimeZone>PacificTimeUSCanadaTijuana</ReportTimeZone>
        </Time>
      </ReportRequest>
    </SubmitGenerateReportRequest>`;
}

async function soapCall(action: string, bodyXml: string, authToken: string): Promise<string> {
  const customerId = getEnv("MICROSOFT_ADS_CUSTOMER_ID");
  const accountId = getEnv("MICROSOFT_ADS_ACCOUNT_ID");
  const developerToken = getEnv("MICROSOFT_ADS_DEVELOPER_TOKEN");
  const envelope = soapEnvelopeWithAuth(action, bodyXml, authToken, customerId, accountId, developerToken);
  const res = await fetch(REPORTING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": `"${action}"`,
    },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SOAP ${action} HTTP ${res.status}: ${text.slice(0, 500)}`);
  if (text.includes("soap:Fault") || text.includes(">Fault<")) {
    const fm = text.match(/<faultstring[^>]*>([^<]*)<\/faultstring>/i);
    throw new Error(`SOAP Fault: ${fm?.[1]?.trim() || text.slice(0, 400)}`);
  }
  return text;
}

function xmlPick(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

async function submitAndDownloadReport(authToken: string, accountId: string, from: string, to: string): Promise<string> {
  const submitXml = submitReportBody(accountId, from, to);
  const submitRes = await soapCall("SubmitGenerateReport", submitXml, authToken);
  const reportRequestId = xmlPick(submitRes, "ReportRequestId");
  if (!reportRequestId) throw new Error(`No ReportRequestId in response: ${submitRes.slice(0, 300)}`);

  const pollBody = `
    <PollGenerateReportRequest xmlns="${REPORT_NS}">
      <ReportRequestId>${escapeXml(reportRequestId)}</ReportRequestId>
    </PollGenerateReportRequest>`;

  let downloadUrl: string | null = null;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await soapCall("PollGenerateReport", pollBody, authToken);
    const status = (xmlPick(pollRes, "Status") || "").toLowerCase();
    downloadUrl = xmlPick(pollRes, "ReportDownloadUrl");
    if (status === "success" && downloadUrl) break;
    if (status === "error") {
      const err = xmlPick(pollRes, "Error") || pollRes.slice(0, 400);
      throw new Error(`Report generation error: ${err}`);
    }
  }
  if (!downloadUrl) throw new Error("Report not ready (timeout polling Microsoft Reporting API)");

  const dl = await fetch(downloadUrl);
  if (!dl.ok) throw new Error(`Report download failed: ${dl.status}`);
  const buf = new Uint8Array(await dl.arrayBuffer());
  let csvText: string;
  try {
    const files = unzipSync(buf);
    const keys = Object.keys(files);
    const csvKey = keys.find((k) => /\.csv$/i.test(k)) || keys[0];
    if (!csvKey) throw new Error("Empty ZIP from Microsoft report");
    csvText = new TextDecoder("utf-8").decode(files[csvKey]);
  } catch {
    csvText = new TextDecoder("utf-8").decode(buf);
  }
  return csvText.replace(/^\uFEFF/, "");
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "");
}

function splitDataLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (!inQ && c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseMicrosoftReport(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitDataLine(lines[0], delim).map(normHeader);
  const rows: Record<string, string>[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitDataLine(lines[li], delim);
    if (cells.length === 1 && cells[0] === "") continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function parseTimePeriod(v: string): string | null {
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const m2 = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}
function numOrZero(v: unknown): number {
  return num(v) ?? 0;
}

function getCell(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const nk = normHeader(k);
    for (const rk of Object.keys(row)) {
      if (rk === nk || rk.replace(/[^a-z0-9]/g, "") === nk.replace(/[^a-z0-9]/g, "")) {
        return row[rk] ?? "";
      }
    }
  }
  return "";
}

function rowsToAdGroupRecords(parsed: Record<string, string>[], accountId: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of parsed) {
    const timeRaw = getCell(row, "TimePeriod", "timeperiod", "GregorianDate", "Time");
    const day = parseTimePeriod(timeRaw);
    if (!day) continue;
    const cid = getCell(row, "CampaignId", "campaignid");
    const cname = getCell(row, "CampaignName", "campaignname");
    const agid = getCell(row, "AdGroupId", "adgroupid");
    const agname = getCell(row, "AdGroupName", "adgroupname");
    const impressions = num(getCell(row, "Impressions", "impressions"));
    const clicks = num(getCell(row, "Clicks", "clicks"));
    const spend = num(getCell(row, "Spend", "spend"));
    const conv = num(getCell(row, "Conversions", "conversions"));
    out.push({
      account_id: accountId,
      campaign_id: cid || null,
      campaign_name: cname || null,
      ad_group_id: agid || null,
      ad_group_name: agname || null,
      community: null,
      campaign_date: day,
      impressions,
      clicks,
      amount_spent_usd: spend,
      purchase_click: conv != null ? Math.round(conv) : null,
      purchase_view: null,
    });
  }
  return out;
}

function dedupeAdGroupRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = `${r.account_id}|${r.campaign_date}|${r.campaign_name ?? ""}|${r.ad_group_name ?? ""}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
      continue;
    }
    (existing.impressions as number) = numOrZero(existing.impressions) + numOrZero(r.impressions);
    (existing.clicks as number) = numOrZero(existing.clicks) + numOrZero(r.clicks);
    existing.amount_spent_usd = (num(existing.amount_spent_usd) ?? 0) + (num(r.amount_spent_usd) ?? 0);
    (existing.purchase_click as number) = numOrZero(existing.purchase_click) + numOrZero(r.purchase_click);
  }
  return Array.from(map.values());
}

export function normalizeISODate(s: string): string | null {
  const t = String(s).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + "T12:00:00.000Z");
  return isNaN(d.getTime()) ? null : t;
}

export function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const dateTo = new Date(now);
  dateTo.setUTCDate(dateTo.getUTCDate() - 1);
  const dateFrom = new Date(now);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 2);
  return { from: dateFrom.toISOString().slice(0, 10), to: dateTo.toISOString().slice(0, 10) };
}

export function eachDateInRange(fromStr: string, toStr: string): string[] {
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

export async function fetchMicrosoftAdsAdGroupRows(
  dateFrom: string,
  dateTo: string,
): Promise<{ accountId: string; rows: Record<string, unknown>[] }> {
  const accountId = getEnv("MICROSOFT_ADS_ACCOUNT_ID");
  const accessToken = await getAccessToken();
  const csvText = await submitAndDownloadReport(accessToken, accountId, dateFrom, dateTo);
  const parsed = parseMicrosoftReport(csvText);
  const rawRows = rowsToAdGroupRecords(parsed, accountId);
  const rows = dedupeAdGroupRows(rawRows);
  return { accountId, rows };
}
