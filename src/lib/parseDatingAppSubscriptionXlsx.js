import * as XLSX from 'xlsx';

const METRIC_NAMES = ['spend', 'impressions', 'clicks', 'cpm', 'cpc'];

function norm(s) {
  if (s == null || s === '') return '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[$£€]/g, '')
    .replace(/,/g, '');
}

/** Map header cell to metric key or null */
function headerToMetricKey(cell) {
  const n = norm(cell);
  if (!n) return null;
  if (n === 'spend' || n.includes('spend')) return 'spend';
  if (n === 'impressions' || n.includes('impression')) return 'impressions';
  if (n === 'clicks' || n === 'click') return 'clicks';
  if (n === 'cpm' || n.endsWith(' cpm')) return 'cpm';
  if (n === 'cpc' || n.endsWith(' cpc')) return 'cpc';
  return null;
}

function rowIsEmpty(row) {
  if (!row || !row.length) return true;
  return row.every((c) => c == null || String(c).trim() === '');
}

function parseNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const s = String(v).trim().replace(/[$£€,]/g, '').replace(/%/g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function firstColLabel(row) {
  if (!row?.length) return '';
  return String(row[0] ?? '').trim();
}

/** Row qualifies as metric header if all five metrics map from some cell */
function findMetricColumns(row) {
  const colMap = {};
  row.forEach((cell, idx) => {
    const key = headerToMetricKey(cell);
    if (key && colMap[key] === undefined) colMap[key] = idx;
  });
  const ok = METRIC_NAMES.every((k) => colMap[k] !== undefined);
  return ok ? colMap : null;
}

function inferBreakdown(firstColHeader) {
  const h = norm(firstColHeader);
  if (
    h.includes('country') ||
    h === 'region' ||
    h.includes('region') ||
    h.includes('geo') ||
    h.includes('market') ||
    h.includes('territory') ||
    h.includes('location')
  ) {
    return 'by_country';
  }
  return 'by_app';
}

function looksLikeMetricHeaderRow(row) {
  return findMetricColumns(row) != null;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function monthIndexFromToken(token) {
  const t = String(token || '')
    .toLowerCase()
    .replace(/\./g, '');
  if (!t) return null;
  for (let i = 0; i < 12; i++) {
    const full = MONTH_NAMES[i];
    if (t === full) return i;
    if (t.length >= 3 && full.startsWith(t)) return i;
  }
  return null;
}

/**
 * Derive calendar month (1–12) and year from WOW tab name, sheet title, or filename (e.g. WOW JAN 2026, Jan'26).
 * @param {{ sheetName?: string|null, reportTitle?: string|null, sourceFilename?: string|null }} parts
 * @returns {{ year: number, month: number } | null}
 */
export function extractReportYearMonth(parts = {}) {
  const blob = [parts.sheetName, parts.reportTitle, parts.sourceFilename]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x))
    .join(' ');

  const wow = blob.match(/\bWOW\s+([A-Za-z]+)\s+(\d{4})\b/i);
  if (wow) {
    const mi = monthIndexFromToken(wow[1]);
    const y = parseInt(wow[2], 10);
    if (mi != null && Number.isFinite(y) && y >= 1900 && y <= 2100) return { year: y, month: mi + 1 };
  }

  const my = blob.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s*['']?\s*(\d{4}|\d{2})\b/i
  );
  if (my) {
    let y = parseInt(my[2], 10);
    if (y >= 0 && y < 100) y += 2000;
    const mi = monthIndexFromToken(my[1]);
    if (mi != null && Number.isFinite(y) && y >= 1900 && y <= 2100) return { year: y, month: mi + 1 };
  }

  const tight = blob.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)['']?(\d{2})\b/i);
  if (tight) {
    const y = parseInt(tight[2], 10) + 2000;
    const mi = monthIndexFromToken(tight[1]);
    if (mi != null && y >= 1900 && y <= 2100) return { year: y, month: mi + 1 };
  }

  return null;
}

/** Known region / country labels (normalized) when Excel uses "Apps" for both tables */
const GEO_LABELS = new Set([
  'us',
  'usa',
  'u s',
  'u s a',
  'united states',
  'america',
  'uk',
  'u k',
  'united kingdom',
  'britain',
  'great britain',
  'eu',
  'europe',
  'european union',
  'ca',
  'canada',
  'de',
  'germany',
  'fr',
  'france',
  'es',
  'spain',
  'it',
  'italy',
  'au',
  'australia',
  'in',
  'india',
  'br',
  'brazil',
  'mx',
  'mexico',
  'apac',
  'emea',
  'latam',
  'mea',
  'mena',
  'dach',
  'anz',
  'nordics',
  'global',
  'worldwide',
  'row',
  'rest of world',
  'north america',
  'south america',
  'asia',
  'africa',
]);

const ISO2_GEO = new Set([
  'us',
  'uk',
  'eu',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'be',
  'ch',
  'at',
  'se',
  'no',
  'dk',
  'fi',
  'ie',
  'pl',
  'br',
  'mx',
  'ca',
  'au',
  'nz',
  'jp',
  'kr',
  'in',
  'cn',
  'sg',
  'hk',
  'tw',
]);

function isLikelyGeoLabel(raw) {
  const s = norm(raw).replace(/\./g, ' ').trim();
  if (!s || /^total$/i.test(s)) return false;
  if (GEO_LABELS.has(s)) return true;
  if (s.length === 2 && ISO2_GEO.has(s)) return true;
  return false;
}

/**
 * When the second WOW table reuses an "Apps" header, country rows land in byApp.
 * Move contiguous rows after the first app subtotal (Total) into by_country when all look like regions.
 * @param {{ row_label: string, is_total?: boolean }[]} byApp
 * @param {{ row_label: string, is_total?: boolean }[]} byCountry
 * @param {string[]} warnings
 */
function moveTrailingGeoRowsFromAppToCountry(byApp, byCountry, warnings) {
  const idxFirstTotal = byApp.findIndex((r) => r.is_total);
  if (idxFirstTotal === -1) return;

  const tail = byApp.slice(idxFirstTotal + 1);
  if (tail.length === 0) return;

  const nonTotals = tail.filter((r) => !r.is_total);
  if (nonTotals.length === 0) return;
  if (!nonTotals.every((r) => isLikelyGeoLabel(r.row_label))) return;

  const head = byApp.slice(0, idxFirstTotal + 1);
  byApp.length = 0;
  byApp.push(...head);
  byCountry.push(...tail);
  warnings.push(
    'Rows after the app Total (e.g. US / UK / EU) were treated as country breakdown because the sheet reused an Apps-style header.'
  );
}

/**
 * Fix mis-split app vs country metrics (parser + already-saved Supabase rows).
 * @param {{ byApp: object[], byCountry: object[] }} input
 * @returns {{ byApp: object[], byCountry: object[] }}
 */
export function partitionDatingAppCountryMetrics(input) {
  const byApp = [...(input.byApp || [])];
  const byCountry = [...(input.byCountry || [])];
  const warnings = [];
  moveTrailingGeoRowsFromAppToCountry(byApp, byCountry, warnings);
  return { byApp, byCountry, warnings };
}

/**
 * Parse one worksheet as a 2D row array (WOW-style: title row optional, then by-app / by-country tables).
 * @param {any[][]} rows
 * @returns {{ reportTitle: string|null, byApp: object[], byCountry: object[], warnings: string[] }}
 */
function parseSingleSheetRows(rows) {
  const warnings = [];
  let reportTitle = null;
  let i = 0;

  while (i < rows.length && rowIsEmpty(rows[i])) i++;

  if (i < rows.length && !looksLikeMetricHeaderRow(rows[i])) {
    const r = rows[i];
    const label = firstColLabel(r);
    const rest = r.slice(1).every((c) => c == null || String(c).trim() === '');
    if (label && rest) {
      reportTitle = label;
      i++;
    } else if (label && !findMetricColumns(r)) {
      const joined = r
        .map((c) => (c == null ? '' : String(c).trim()))
        .filter(Boolean)
        .join(' ');
      if (joined && !looksLikeMetricHeaderRow(r)) {
        reportTitle = joined.length > 120 ? joined.slice(0, 117) + '…' : joined;
        i++;
      }
    }
    while (i < rows.length && rowIsEmpty(rows[i])) i++;
  }

  const byApp = [];
  const byCountry = [];

  while (i < rows.length) {
    while (i < rows.length && rowIsEmpty(rows[i])) i++;
    if (i >= rows.length) break;

    const headerRow = rows[i];
    const colMap = findMetricColumns(headerRow);
    if (!colMap) {
      warnings.push(`Skipped row ${i + 1}: expected a header row with Spend, Impressions, Clicks, CPM, CPC.`);
      i++;
      continue;
    }

    const breakdown = inferBreakdown(headerRow[0]);
    const target = breakdown === 'by_country' ? byCountry : byApp;
    i++;

    while (i < rows.length) {
      const dataRow = rows[i];
      if (rowIsEmpty(dataRow)) break;
      if (looksLikeMetricHeaderRow(dataRow)) break;

      const label = firstColLabel(dataRow);
      if (!label) {
        i++;
        continue;
      }

      const isTotal = /^total$/i.test(label);
      const spend = parseNumber(dataRow[colMap.spend]);
      const impressions = parseNumber(dataRow[colMap.impressions]);
      const clicks = parseNumber(dataRow[colMap.clicks]);
      const cpm = parseNumber(dataRow[colMap.cpm]);
      const cpc = parseNumber(dataRow[colMap.cpc]);

      const hasNumber =
        spend != null ||
        impressions != null ||
        clicks != null ||
        cpm != null ||
        cpc != null;
      if (!hasNumber) {
        i++;
        continue;
      }

      target.push({
        row_label: label,
        is_total: isTotal,
        spend: spend ?? 0,
        impressions: Math.round(impressions ?? 0),
        clicks: Math.round(clicks ?? 0),
        cpm: cpm ?? 0,
        cpc: cpc ?? 0,
      });
      i++;
    }
  }

  if (byApp.length === 0 && byCountry.length === 0) {
    warnings.push('No data tables found. Check that the sheet has headers: Spend, Impressions, Clicks, CPM, CPC.');
  }

  moveTrailingGeoRowsFromAppToCountry(byApp, byCountry, warnings);

  return { reportTitle, byApp, byCountry, warnings };
}

/**
 * Parse every worksheet in a WOW-style workbook (e.g. WOW JAN / FEB / MARCH 2026 tabs).
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{
 *   sheets: Array<{ sheetName: string, reportTitle: string|null, byApp: object[], byCountry: object[], warnings: string[] }>,
 *   warnings: string[]
 * }}
 */
export function parseDatingAppSubscriptionXlsx(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const warnings = [];

  if (!workbook.SheetNames?.length) {
    warnings.push('Workbook has no sheets.');
    return { sheets: [], warnings };
  }

  const sheets = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    /** @type {any[][]} */
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const parsed = parseSingleSheetRows(rows);
    const prefixedWarnings = parsed.warnings.map((w) => `[${sheetName}] ${w}`);

    if (parsed.byApp.length === 0 && parsed.byCountry.length === 0) {
      warnings.push(
        `Sheet "${sheetName}" skipped — no recognizable WOW tables (Spend, Impressions, Clicks, CPM, CPC).`
      );
      continue;
    }

    sheets.push({
      sheetName,
      reportTitle: parsed.reportTitle,
      byApp: parsed.byApp,
      byCountry: parsed.byCountry,
      warnings: prefixedWarnings,
    });
  }

  if (sheets.length === 0 && workbook.SheetNames.length > 0) {
    warnings.push('No sheets contained importable dating app campaign tables.');
  }

  return { sheets, warnings };
}
