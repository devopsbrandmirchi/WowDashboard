/**
 * Verify Jan 8 (or any day) rollup: month-range fetch vs single-day fetch must match.
 * Audits duplicates and status/network splits for the target date.
 *
 * Env (.env in project root):
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (preferred) or VITE_SUPABASE_ANON_KEY
 *
 *   node scripts/verify-google-ads-day-rollup.mjs
 *   node scripts/verify-google-ads-day-rollup.mjs --day=2026-01-08
 *   node scripts/verify-google-ads-day-rollup.mjs --resync  (also invoke sync for January)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  aggregateDailyFromRows,
  rollupDay,
  verifyDayRollupConsistency,
} from '../src/utils/googleAdsAggregate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  for (const envPath of [join(process.cwd(), '.env'), join(__dirname, '..', '.env')]) {
    try {
      const text = readFileSync(envPath, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key && val && !process.env[key]) process.env[key] = val;
      }
      return;
    } catch {
      /* try next */
    }
  }
}

loadEnv();

const PAGE = 1000;
const DAY = (process.argv.find((a) => a.startsWith('--day=')) || '--day=2026-01-08').split('=')[1];
const MONTH_FROM = DAY.slice(0, 8) + '01';
const MONTH_TO = DAY.slice(0, 8) + '31';
const DO_RESYNC = process.argv.includes('--resync');

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY) in .env');
  process.exit(1);
}

const supabase = createClient(url, key);

async function fetchAllRows(table, dateFrom, dateTo) {
  const out = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .gte('segment_date', dateFrom)
      .lte('segment_date', dateTo)
      .order('segment_date', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
    offset += data.length;
  }
  return out;
}

function dedupeCampaignRows(rows) {
  const m = new Map();
  for (const r of rows) {
    const d = String(r.segment_date).slice(0, 10);
    const k = `${r.customer_id}\0${r.campaign_id}\0${d}\0${r.network_type ?? ''}`;
    m.set(k, r);
  }
  return [...m.values()];
}

async function auditDuplicates(day) {
  const rows = await fetchAllRows('google_campaigns_data', day, day);
  const keyCount = new Map();
  for (const r of rows) {
    const k = `${r.customer_id}\0${r.campaign_id}\0${r.segment_date}\0${r.network_type ?? ''}`;
    keyCount.set(k, (keyCount.get(k) || 0) + 1);
  }
  const dupes = [...keyCount.entries()].filter(([, n]) => n > 1);
  return { rowCount: rows.length, uniqueKeys: keyCount.size, duplicateKeys: dupes.length, dupes: dupes.slice(0, 5) };
}

async function auditByStatusNetwork(day) {
  const { data, error } = await supabase.rpc('exec_sql', {});
  if (error) {
    const rows = await fetchAllRows('google_campaigns_data', day, day);
    const groups = new Map();
    for (const r of rows) {
      const g = `${r.campaign_status}|${r.channel_type}|${r.network_type ?? ''}`;
      if (!groups.has(g)) groups.set(g, { cost: 0, clicks: 0, conversions: 0, rows: 0 });
      const a = groups.get(g);
      a.rows += 1;
      a.cost += Number(r.cost_micros || 0) / 1e6;
      a.clicks += Number(r.clicks || 0);
      a.conversions += Number(r.conversions || 0);
    }
    return [...groups.entries()].map(([k, v]) => ({ group: k, ...v }));
  }
  return data;
}

async function invokeResync(from, to) {
  const fnUrl = `${url.replace(/\/+$/, '')}/functions/v1/sync-google-ads-upsert`;
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    body: JSON.stringify({ date_from: from, date_to: to }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resync failed ${res.status}: ${text}`);
  return JSON.parse(text || '{}');
}

async function main() {
  console.log(`\n=== Google Ads day rollup verification: ${DAY} ===\n`);

  if (DO_RESYNC) {
    console.log(`Resyncing ${MONTH_FROM} .. ${MONTH_TO} via sync-google-ads-upsert...`);
    const result = await invokeResync(MONTH_FROM, MONTH_TO);
    console.log('Resync result:', JSON.stringify(result, null, 2).slice(0, 500));
  }

  const { count: dbMonthCount } = await supabase
    .from('google_campaigns_data')
    .select('*', { count: 'exact', head: true })
    .gte('segment_date', MONTH_FROM)
    .lte('segment_date', MONTH_TO);
  const { count: dbDayCount } = await supabase
    .from('google_campaigns_data')
    .select('*', { count: 'exact', head: true })
    .eq('segment_date', DAY);

  const monthRowsRaw = await fetchAllRows('google_campaigns_data', MONTH_FROM, MONTH_TO);
  const dayRows = await fetchAllRows('google_campaigns_data', DAY, DAY);
  const monthRows = dedupeCampaignRows(monthRowsRaw);
  console.log(`Month rows after dedupe: ${monthRows.length} (raw ${monthRowsRaw.length})`);
  const monthJan8 = monthRows.filter((r) => String(r.segment_date).slice(0, 10) === DAY);
  const rowKey = (r) =>
    `${r.customer_id}\0${r.campaign_id}\0${String(r.segment_date).slice(0, 10)}\0${r.network_type ?? ''}`;
  const dayKeys = new Set(dayRows.map(rowKey));
  const monthJan8Keys = new Set(monthJan8.map(rowKey));
  const dayByKey = new Map(dayRows.map((r) => [rowKey(r), r]));
  const monthByKey = new Map(monthJan8.map((r) => [rowKey(r), r]));
  const metricDiffs = [];
  for (const k of dayKeys) {
    const d = dayByKey.get(k);
    const m = monthByKey.get(k);
    if (!m) continue;
    if (Number(d.clicks) !== Number(m.clicks) || Number(d.cost_micros) !== Number(m.cost_micros)) {
      metricDiffs.push({
        key: k,
        dayClicks: d.clicks,
        monthClicks: m.clicks,
        dayCost: Number(d.cost_micros) / 1e6,
        monthCost: Number(m.cost_micros) / 1e6,
        dayId: d.id,
        monthId: m.id,
      });
    }
  }
  const missingInMonth = [...dayKeys].filter((k) => !monthJan8Keys.has(k));
  const extraInMonth = [...monthJan8Keys].filter((k) => !dayKeys.has(k));

  console.log(`DB count month: ${dbMonthCount}, fetched: ${monthRows.length}`);
  console.log(`DB count ${DAY}: ${dbDayCount}, fetched: ${dayRows.length}`);
  const dupJan8 = [...monthJan8Keys].length < monthJan8.length;
  const monthDupCount = monthJan8.length - monthJan8Keys.size;
  console.log(`Jan 8 rows inside month fetch: ${monthJan8.length} unique keys: ${monthJan8Keys.size} (dup rows: ${monthDupCount}, missing ${missingInMonth.length} vs single-day)`);
  if (missingInMonth.length) console.log('Sample missing keys:', missingInMonth.slice(0, 3));
  console.log(`Rows with same key but different metrics: ${metricDiffs.length}`);
  if (metricDiffs.length) console.table(metricDiffs.slice(0, 10));

  const check = verifyDayRollupConsistency(monthRows, DAY, dayRows);
  const monthDay = rollupDay(monthRows, DAY);
  const onlyDay = rollupDay(dayRows, DAY);

  console.log('\n--- Rollup for', DAY, '---');
  console.log('From month range:', monthDay);
  console.log('From single-day fetch:', onlyDay);

  if (check.ok) {
    console.log('\n✓ PASS: Month-range rollup matches single-day fetch.');
  } else {
    console.log('\n✗ FAIL: Mismatch (should not happen with identical DB rows):');
    console.log(JSON.stringify(check.diff, null, 2));
  }

  const dup = await auditDuplicates(DAY);
  console.log('\n--- Duplicate key audit ---');
  console.log(dup);

  const splits = await auditByStatusNetwork(DAY);
  console.log('\n--- By status | channel | network ---');
  console.table(splits);

  const daily = aggregateDailyFromRows(monthRows);
  const jan8InMonth = daily.find((d) => d.date === DAY);
  console.log('\n--- Jan 8 in month dailyTrends ---');
  console.log(jan8InMonth);

  process.exit(check.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
