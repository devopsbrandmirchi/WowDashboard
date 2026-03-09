import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

const num = (v) => Number(v) || 0;

const MONTHS_2025 = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
];

function monthStart(monthKey) {
  return `${monthKey}-01`;
}

function monthEnd(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0);
  return `${y}-${String(m).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

function prevMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  if (m === 1) return '2024-12';
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

const FETCH_TIMEOUT_MS = 60000;
/** Keep at 1000 to match typical Supabase/PostgREST row limit and avoid truncated batches */
const BATCH_SIZE = 1000;

function withTimeout(promise, ms = FETCH_TIMEOUT_MS, msg = 'Request timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

async function fetchCount(table, dateFrom, dateTo) {
  const { count, error } = await withTimeout(
    supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .gte('stat_date', dateFrom)
      .lte('stat_date', dateTo),
    FETCH_TIMEOUT_MS,
    `Timeout counting ${table}`
  );
  if (error) throw error;
  return count || 0;
}

async function fetchAllRows(table, columns, dateFrom = '2025-01-01', dateTo = '2025-12-31') {
  const total = await fetchCount(table, dateFrom, dateTo);
  if (total === 0) return [];

  const batches = [];
  for (let from = 0; from < total; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, total - 1);
    batches.push({ from, to });
  }

  const baseQuery = () =>
    supabase
      .from(table)
      .select(columns)
      .gte('stat_date', dateFrom)
      .lte('stat_date', dateTo)
      .order('stat_date', { ascending: true })
      .order('country', { ascending: true });

  const results = await Promise.all(
    batches.map(({ from, to }) =>
      withTimeout(
        baseQuery().range(from, to),
        FETCH_TIMEOUT_MS,
        `Timeout fetching ${table}`
      ).then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      })
    )
  );

  return results.flat();
}

function thisMonthRange() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const from = `${y}-${m}-01`;
  const to = today.toISOString().slice(0, 10);
  return { from, to };
}

/** Default date range: December 2025 only. */
function decemberRange() {
  return { from: '2025-12-01', to: '2025-12-31' };
}

/** Previous month for comparison (November 2025). */
function defaultCompareRange() {
  return { from: '2025-11-01', to: '2025-11-30' };
}

export function useVimeoAnalyticsData() {
  const { from: defaultFrom, to: defaultTo } = decemberRange();
  const { from: defaultCompareFrom, to: defaultCompareTo } = defaultCompareRange();
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [compareFrom, setCompareFrom] = useState(defaultCompareFrom);
  const [compareTo, setCompareTo] = useState(defaultCompareTo);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rawData, setRawData] = useState(null);

  const updateDateRange = useCallback((from, to, compFrom, compTo) => {
    const { from: fallbackFrom, to: fallbackTo } = decemberRange();
    setDateFrom(from || fallbackFrom);
    setDateTo(to || fallbackTo);
    setCompareFrom(compFrom || null);
    setCompareTo(compTo || null);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const from = dateFrom || decemberRange().from;
    const to = dateTo || decemberRange().to;
    const cf = compareFrom || null;
    const ct = compareTo || null;
    const fetchFrom = cf ? (from < cf ? from : cf) : from;
    const fetchTo = ct ? (to > ct ? to : ct) : to;
    try {
      const [gained, lost, total, trials, trialsLost, trialsTotal, sptGained, sptLost, sptTotal] = await Promise.all([
        fetchAllRows('subscriptions_gained', 'country, stat_date, gained_subscriptions', fetchFrom, fetchTo),
        fetchAllRows('subscriptions_lost', 'country, stat_date, lost_subscriptions', fetchFrom, fetchTo),
        fetchAllRows('subscriptions_total', 'country, stat_date, total_subscriptions', fetchFrom, fetchTo),
        fetchAllRows('subscriptions_trials_gained', 'country, stat_date, gained_subscriptions_trials', fetchFrom, fetchTo),
        fetchAllRows('subscriptions_trials_lost', 'country, stat_date, lost_subscriptions_trials', fetchFrom, fetchTo).catch(() => []),
        fetchAllRows('subscriptions_trials_total', 'country, stat_date, total_subscriptions_trials', fetchFrom, fetchTo).catch(() => []),
        fetchAllRows('subscriptions_plus_trials_gained', 'country, stat_date, gained_subscriptions_plus_trials', fetchFrom, fetchTo),
        fetchAllRows('subscriptions_plus_trials_lost', 'country, stat_date, lost_subscriptions_plus_trials', fetchFrom, fetchTo),
        fetchAllRows('subscriptions_plus_trials_total', 'country, stat_date, total_subscriptions_plus_trials', fetchFrom, fetchTo),
      ]);
      setRawData({ gained, lost, total, trials, trialsLost, trialsTotal, sptGained, sptLost, sptTotal });
    } catch (e) {
      setError(e?.message || 'Failed to fetch Vimeo analytics');
      setRawData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, compareFrom, compareTo]);

  const lastDayByMonth = useMemo(() => {
    const m = {};
    MONTHS_2025.forEach((mk) => { m[mk] = monthEnd(mk); });
    return m;
  }, []);

  const monthlySummary = useMemo(() => {
    if (!rawData) return [];
    const { gained, lost, total, trials, trialsLost, trialsTotal, sptGained, sptLost, sptTotal } = rawData;
    const byMonth = {};
    MONTHS_2025.forEach((mk) => {
      byMonth[mk] = { gained: 0, lost: 0, trials: 0, trialsLost: 0, trialsActive: 0, plusGained: 0, plusLost: 0, active: 0, sptActive: 0 };
    });
    gained.forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk]) byMonth[mk].gained += num(r.gained_subscriptions);
    });
    lost.forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk]) byMonth[mk].lost += num(r.lost_subscriptions);
    });
    trials.forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk]) byMonth[mk].trials += num(r.gained_subscriptions_trials);
    });
    (trialsLost || []).forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk]) byMonth[mk].trialsLost += num(r.lost_subscriptions_trials);
    });
    (trialsTotal || []).forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk] && r.stat_date === lastDayByMonth[mk]) {
        byMonth[mk].trialsActive += num(r.total_subscriptions_trials);
      }
    });
    sptGained.forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk]) byMonth[mk].plusGained += num(r.gained_subscriptions_plus_trials);
    });
    sptLost.forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk]) byMonth[mk].plusLost += num(r.lost_subscriptions_plus_trials);
    });
    total.forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk] && r.stat_date === lastDayByMonth[mk]) {
        byMonth[mk].active += num(r.total_subscriptions);
      }
    });
    sptTotal.forEach((r) => {
      const mk = r.stat_date?.slice(0, 7);
      if (mk && byMonth[mk] && r.stat_date === lastDayByMonth[mk]) {
        byMonth[mk].sptActive += num(r.total_subscriptions_plus_trials);
      }
    });
    return MONTHS_2025.map((mk) => {
      const d = byMonth[mk];
      const gained = d.gained || 0;
      const lost = d.lost || 0;
      const trials = d.trials || 0;
      const trialsLost = d.trialsLost || 0;
      const plusGained = d.plusGained || 0;
      const plusLost = d.plusLost || 0;
      return {
        month: mk,
        monthLabel: new Date(mk + '-01').toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        gained,
        lost,
        netGrowth: gained - lost,
        active: d.active || 0,
        trials,
        trialsLost,
        trialsNet: trials - trialsLost,
        trialsActive: d.trialsActive || 0,
        plusGained,
        plusLost,
        plusNet: plusGained - plusLost,
        sptActive: d.sptActive || 0,
      };
    });
  }, [rawData, lastDayByMonth]);

  const countryByMonth = useMemo(() => {
    if (!rawData) return {};
    const { gained, lost, total, trials, trialsLost, trialsTotal, sptGained, sptLost, sptTotal } = rawData;
    const byKey = {};
    const add = (rows, col, key) => {
      (rows || []).forEach((r) => {
        const c = r.country || 'Unknown';
        const mk = r.stat_date?.slice(0, 7);
        if (!mk) return;
        const k = `${c}::${mk}`;
        if (!byKey[k]) byKey[k] = { country: c, month: mk, gained: 0, lost: 0, trials: 0, trialsLost: 0, trialsActive: 0, plusGained: 0, plusLost: 0, active: 0, sptActive: 0 };
        byKey[k][key] = (byKey[k][key] || 0) + num(r[col]);
      });
    };
    add(gained, 'gained_subscriptions', 'gained');
    add(lost, 'lost_subscriptions', 'lost');
    add(trials, 'gained_subscriptions_trials', 'trials');
    add(trialsLost, 'lost_subscriptions_trials', 'trialsLost');
    add(sptGained, 'gained_subscriptions_plus_trials', 'plusGained');
    add(sptLost, 'lost_subscriptions_plus_trials', 'plusLost');
    total.forEach((r) => {
      const c = r.country || 'Unknown';
      const mk = r.stat_date?.slice(0, 7);
      if (!mk || r.stat_date !== lastDayByMonth[mk]) return;
      const k = `${c}::${mk}`;
      if (!byKey[k]) byKey[k] = { country: c, month: mk, gained: 0, lost: 0, trials: 0, trialsLost: 0, trialsActive: 0, plusGained: 0, plusLost: 0, active: 0, sptActive: 0 };
      byKey[k].active += num(r.total_subscriptions);
    });
    (trialsTotal || []).forEach((r) => {
      const c = r.country || 'Unknown';
      const mk = r.stat_date?.slice(0, 7);
      if (!mk || r.stat_date !== lastDayByMonth[mk]) return;
      const k = `${c}::${mk}`;
      if (!byKey[k]) byKey[k] = { country: c, month: mk, gained: 0, lost: 0, trials: 0, trialsLost: 0, trialsActive: 0, plusGained: 0, plusLost: 0, active: 0, sptActive: 0 };
      byKey[k].trialsActive += num(r.total_subscriptions_trials);
    });
    sptTotal.forEach((r) => {
      const c = r.country || 'Unknown';
      const mk = r.stat_date?.slice(0, 7);
      if (!mk || r.stat_date !== lastDayByMonth[mk]) return;
      const k = `${c}::${mk}`;
      if (!byKey[k]) byKey[k] = { country: c, month: mk, gained: 0, lost: 0, trials: 0, plusGained: 0, plusLost: 0, active: 0, sptActive: 0 };
      byKey[k].sptActive += num(r.total_subscriptions_plus_trials);
    });
    const result = {};
    Object.values(byKey).forEach((r) => {
      const row = {
        ...r,
        net: (r.gained || 0) - (r.lost || 0),
        trialsNet: (r.trials || 0) - (r.trialsLost || 0),
        plusNet: (r.plusGained || 0) - (r.plusLost || 0),
      };
      if (!result[r.month]) result[r.month] = [];
      result[r.month].push(row);
    });
    MONTHS_2025.forEach((m) => {
      if (result[m]) result[m].sort((a, b) => (b.active || 0) - (a.active || 0));
    });
    return result;
  }, [rawData, lastDayByMonth]);

  const monthByCountry = useMemo(() => {
    const result = {};
    Object.entries(countryByMonth).forEach(([month, rows]) => {
      rows.forEach((r) => {
        const c = r.country || 'Unknown';
        if (!result[c]) result[c] = [];
        result[c].push({ ...r, monthLabel: new Date(month + '-01').toLocaleString('en-US', { month: 'short', year: 'numeric' }) });
      });
    });
    Object.keys(result).forEach((c) => {
      result[c].sort((a, b) => a.month.localeCompare(b.month));
    });
    return result;
  }, [countryByMonth]);

  const aggregateByDateRange = useCallback((from, to, { gained, lost, total, trials, trialsLost, trialsTotal, sptGained, sptLost, sptTotal }) => {
    if (!from || !to) return null;
    const add = (rows, col, key) => {
      let sum = 0;
      (rows || []).forEach((r) => {
        const d = r.stat_date;
        if (!d || d < from || d > to) return;
        sum += num(r[col]);
      });
      return sum;
    };
    const gainedSum = add(gained, 'gained_subscriptions', 'gained');
    const lostSum = add(lost, 'lost_subscriptions', 'lost');
    const trialsSum = add(trials, 'gained_subscriptions_trials', 'trials');
    const trialsLostSum = add(trialsLost, 'lost_subscriptions_trials', 'trialsLost');
    const plusGainedSum = add(sptGained, 'gained_subscriptions_plus_trials', 'plusGained');
    const plusLostSum = add(sptLost, 'lost_subscriptions_plus_trials', 'plusLost');
    let activeSum = 0;
    (total || []).forEach((r) => {
      if (r.stat_date === to) activeSum += num(r.total_subscriptions);
    });
    let trialsActiveSum = 0;
    (trialsTotal || []).forEach((r) => {
      if (r.stat_date === to) trialsActiveSum += num(r.total_subscriptions_trials);
    });
    let sptActiveSum = 0;
    (sptTotal || []).forEach((r) => {
      if (r.stat_date === to) sptActiveSum += num(r.total_subscriptions_plus_trials);
    });
    return {
      gained: gainedSum,
      lost: lostSum,
      netGrowth: gainedSum - lostSum,
      active: activeSum,
      trials: trialsSum,
      trialsLost: trialsLostSum,
      trialsNet: trialsSum - trialsLostSum,
      trialsActive: trialsActiveSum,
      plusGained: plusGainedSum,
      plusLost: plusLostSum,
      plusNet: plusGainedSum - plusLostSum,
      sptActive: sptActiveSum,
    };
  }, []);

  const dailyData = useMemo(() => {
    if (!rawData || !dateFrom || !dateTo) return [];
    const { gained, lost, trials, trialsLost, sptGained, sptLost } = rawData;
    const byDate = {};
    const add = (rows, col, key) => {
      (rows || []).forEach((r) => {
        const d = r.stat_date;
        if (!d || d < dateFrom || d > dateTo) return;
        if (!byDate[d]) byDate[d] = {};
        byDate[d][key] = (byDate[d][key] || 0) + num(r[col]);
      });
    };
    add(gained, 'gained_subscriptions', 'gained');
    add(lost, 'lost_subscriptions', 'lost');
    add(trials, 'gained_subscriptions_trials', 'trials');
    add(trialsLost, 'lost_subscriptions_trials', 'trialsLost');
    add(sptGained, 'gained_subscriptions_plus_trials', 'plusGained');
    add(sptLost, 'lost_subscriptions_plus_trials', 'plusLost');
    return Object.keys(byDate)
      .sort()
      .map((d) => ({
        date: d,
        gained: byDate[d]?.gained ?? 0,
        lost: byDate[d]?.lost ?? 0,
        netGrowth: (byDate[d]?.gained ?? 0) - (byDate[d]?.lost ?? 0),
        trials: byDate[d]?.trials ?? 0,
        trialsLost: byDate[d]?.trialsLost ?? 0,
        trialsNet: (byDate[d]?.trials ?? 0) - (byDate[d]?.trialsLost ?? 0),
        plusGained: byDate[d]?.plusGained ?? 0,
        plusLost: byDate[d]?.plusLost ?? 0,
        plusNet: (byDate[d]?.plusGained ?? 0) - (byDate[d]?.plusLost ?? 0),
      }));
  }, [rawData, dateFrom, dateTo]);

  const dailyCompareData = useMemo(() => {
    if (!rawData || !compareFrom || !compareTo) return [];
    const { gained, lost, trials, trialsLost, sptGained, sptLost } = rawData;
    const byDate = {};
    const add = (rows, col, key) => {
      (rows || []).forEach((r) => {
        const d = r.stat_date;
        if (!d || d < compareFrom || d > compareTo) return;
        if (!byDate[d]) byDate[d] = {};
        byDate[d][key] = (byDate[d][key] || 0) + num(r[col]);
      });
    };
    add(gained, 'gained_subscriptions', 'gained');
    add(lost, 'lost_subscriptions', 'lost');
    add(trials, 'gained_subscriptions_trials', 'trials');
    add(trialsLost, 'lost_subscriptions_trials', 'trialsLost');
    add(sptGained, 'gained_subscriptions_plus_trials', 'plusGained');
    add(sptLost, 'lost_subscriptions_plus_trials', 'plusLost');
    return Object.keys(byDate)
      .sort()
      .map((d) => ({
        date: d,
        gained: byDate[d]?.gained ?? 0,
        lost: byDate[d]?.lost ?? 0,
        netGrowth: (byDate[d]?.gained ?? 0) - (byDate[d]?.lost ?? 0),
        trials: byDate[d]?.trials ?? 0,
        trialsLost: byDate[d]?.trialsLost ?? 0,
        trialsNet: (byDate[d]?.trials ?? 0) - (byDate[d]?.trialsLost ?? 0),
        plusGained: byDate[d]?.plusGained ?? 0,
        plusLost: byDate[d]?.plusLost ?? 0,
        plusNet: (byDate[d]?.plusGained ?? 0) - (byDate[d]?.plusLost ?? 0),
      }));
  }, [rawData, compareFrom, compareTo]);

  const kpis = useMemo(() => {
    if (!rawData) return {};
    return aggregateByDateRange(dateFrom, dateTo, rawData) || {};
  }, [rawData, dateFrom, dateTo, aggregateByDateRange]);

  const compareKpis = useMemo(() => {
    if (!rawData || !compareFrom || !compareTo) return null;
    return aggregateByDateRange(compareFrom, compareTo, rawData);
  }, [rawData, compareFrom, compareTo, aggregateByDateRange]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    dateFrom,
    dateTo,
    compareFrom,
    compareTo,
    updateDateRange,
    loading,
    error,
    fetchData: fetchAll,
    monthlySummary,
    countryByMonth,
    monthByCountry,
    dailyData,
    dailyCompareData,
    kpis,
    compareKpis,
    months: MONTHS_2025,
  };
}
