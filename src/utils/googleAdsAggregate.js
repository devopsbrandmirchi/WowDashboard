/** Shared Google Ads row aggregation (used by useGoogleAdsData and verification scripts). */

export function num(v) {
  return Number(v) || 0;
}

export function costFromMicros(v) {
  return num(v) / 1e6;
}

export function toDayKey(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.length >= 10 && v[4] === '-' && v[7] === '-') return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addMetrics(o) {
  o.ctr = o.impressions ? (o.clicks / o.impressions) * 100 : 0;
  o.cpc = o.clicks ? o.cost / o.clicks : 0;
  o.conv_rate = o.clicks ? (o.conversions / o.clicks) * 100 : 0;
  o.cpa = o.conversions ? o.cost / o.conversions : 0;
  return o;
}

/** Sum metrics per calendar day from campaign-level rows. */
export function aggregateDailyFromRows(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const d = toDayKey(r.segment_date);
    if (!d) return;
    if (!map.has(d)) map.set(d, { date: d, cost: 0, clicks: 0, impressions: 0, conversions: 0 });
    const a = map.get(d);
    a.cost += costFromMicros(r.cost_micros);
    a.clicks += num(r.clicks);
    a.impressions += num(r.impressions);
    a.conversions += num(r.conversions);
  });
  return [...map.values()].map(addMetrics).sort((a, b) => a.date.localeCompare(b.date));
}

/** Roll up totals for one day key from raw rows. */
export function rollupDay(rows, dayKey) {
  const daily = aggregateDailyFromRows(rows);
  return daily.find((d) => d.date === dayKey) || null;
}

/**
 * Verify that filtering rows to one day matches rollup from a wider date range.
 * Returns { ok, dayKey, fromRange, fromDayOnly, diff }.
 */
export function verifyDayRollupConsistency(allRowsInRange, dayKey, rowsSingleDay) {
  const fromRange = rollupDay(allRowsInRange, dayKey);
  const fromDayOnly = rollupDay(rowsSingleDay, dayKey);
  const keys = ['cost', 'clicks', 'impressions', 'conversions'];
  const diff = {};
  let ok = true;
  for (const k of keys) {
    const a = fromRange?.[k] ?? 0;
    const b = fromDayOnly?.[k] ?? 0;
    if (Math.abs(a - b) > 0.0001) {
      ok = false;
      diff[k] = { fromRange: a, fromDayOnly: b, delta: b - a };
    }
  }
  return { ok, dayKey, fromRange, fromDayOnly, diff };
}
