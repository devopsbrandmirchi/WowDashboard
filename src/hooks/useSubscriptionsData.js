import { useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';

function num(v) { return Number(v) || 0; }

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  const [y, m] = dateStr.split('-');
  return y && m ? `${y}-${m}` : null;
}

function prevMonthKey(monthKey) {
  if (!monthKey) return null;
  const [y, m] = monthKey.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function dayInRange(dayStr, fromStr, toStr) {
  if (!dayStr || !fromStr || !toStr) return false;
  return dayStr >= fromStr && dayStr <= toStr;
}

function resolvePresetDates(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  switch (preset) {
    case 'today': return { from: iso(today), to: iso(today) };
    case 'yesterday': { const y = addDays(today, -1); return { from: iso(y), to: iso(y) }; }
    case 'last7': return { from: iso(addDays(today, -6)), to: iso(today) };
    case 'last14': return { from: iso(addDays(today, -13)), to: iso(today) };
    case 'last30': return { from: iso(addDays(today, -29)), to: iso(today) };
    case 'this_month': return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case 'last_month': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: iso(first), to: iso(last) };
    }
    case 'all': return { from: '2020-01-01', to: iso(today) };
    default: return null;
  }
}

export function useSubscriptionsData() {
  const [filters, setFilters] = useState({
    datePreset: 'last30', dateFrom: '', dateTo: '',
    compareOn: false, compareFrom: '', compareTo: '',
  });
  const [cacheRows, setCacheRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [emailListLoading, setEmailListLoading] = useState(false);

  const updateFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const batchUpdateFilters = useCallback((updates) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('subscription_kpi_cache')
        .select('*');
      if (err) throw err;
      setCacheRows(data || []);
    } catch (e) {
      setError(e?.message || 'Failed to fetch subscription cache');
      setCacheRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!loading && !filters.dateFrom && !filters.dateTo && filters.datePreset) {
      const resolved = resolvePresetDates(filters.datePreset);
      if (resolved) batchUpdateFilters({ dateFrom: resolved.from, dateTo: resolved.to });
    }
  }, [loading, filters.dateFrom, filters.dateTo, filters.datePreset, batchUpdateFilters]);

  const cache = useMemo(() => {
    const map = {};
    (cacheRows || []).forEach((row) => {
      map[row.metric_name] = {
        data: row.metric_data ?? null,
        updated_at: row.updated_at ?? null,
      };
    });
    return map;
  }, [cacheRows]);

  const lastUpdated = useMemo(() => {
    const dates = Object.values(cache).map((v) => v.updated_at).filter(Boolean);
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates.map((d) => new Date(d).getTime())));
  }, [cache]);

  const allTime = useMemo(() => cache.all_time?.data ?? {}, [cache]);
  const monthlyArr = useMemo(() => (Array.isArray(cache.monthly?.data) ? cache.monthly.data : []), [cache]);
  const dailyArr = useMemo(() => (Array.isArray(cache.daily?.data) ? cache.daily.data : []), [cache]);

  const totalActive = num(allTime.total_active);
  const totalMrr = num(allTime.total_mrr);
  const totalLtv = num(allTime.total_ltv);
  const totalCancelled = num(allTime.total_cancelled);

  const selectedMonthKey = useMemo(() => {
    const to = filters.dateTo || filters.dateFrom;
    return getMonthKey(to) || (monthlyArr.length ? monthlyArr[monthlyArr.length - 1]?.month : null);
  }, [filters.dateFrom, filters.dateTo, monthlyArr]);

  const prevMonthKeyVal = useMemo(() => prevMonthKey(selectedMonthKey), [selectedMonthKey]);

  const selectedMonth = useMemo(() => {
    if (!selectedMonthKey) return null;
    return monthlyArr.find((m) => m.month === selectedMonthKey) ?? null;
  }, [monthlyArr, selectedMonthKey]);

  const prevMonth = useMemo(() => {
    if (!prevMonthKeyVal) return null;
    return monthlyArr.find((m) => m.month === prevMonthKeyVal) ?? null;
  }, [monthlyArr, prevMonthKeyVal]);

  const kpis = useMemo(() => {
    const newSub = num(selectedMonth?.new_subscribers);
    const canc = num(selectedMonth?.cancellations);
    const expir = num(selectedMonth?.expirations);
    const cancPlusExp = canc + expir;
    const trials = num(selectedMonth?.trials_started);
    const conv = num(selectedMonth?.trial_conversions);
    const rev = num(selectedMonth?.revenue);
    return {
      totalActive,
      totalLtv,
      newSubscribers: newSub,
      cancellations: cancPlusExp,
      netGrowth: newSub - cancPlusExp,
      mrr: totalMrr,
      trialsStarted: trials,
      trialConversions: conv,
      convRate: trials > 0 ? (conv / trials) * 100 : 0,
      avgRevenue: newSub > 0 ? rev / newSub : 0,
      churnRate: (totalActive + cancPlusExp) > 0 ? (cancPlusExp / (totalActive + cancPlusExp)) * 100 : 0,
    };
  }, [totalActive, totalMrr, totalLtv, selectedMonth]);

  const compareKpis = useMemo(() => {
    if (!prevMonth) return null;
    const newSub = num(prevMonth.new_subscribers);
    const canc = num(prevMonth.cancellations);
    const expir = num(prevMonth.expirations);
    const cancPlusExp = canc + expir;
    const trials = num(prevMonth.trials_started);
    const conv = num(prevMonth.trial_conversions);
    const rev = num(prevMonth.revenue);
    return {
      totalActive,
      newSubscribers: newSub,
      cancellations: cancPlusExp,
      netGrowth: newSub - cancPlusExp,
      mrr: totalMrr,
      trialsStarted: trials,
      trialConversions: conv,
      convRate: trials > 0 ? (conv / trials) * 100 : 0,
      avgRevenue: newSub > 0 ? rev / newSub : 0,
      churnRate: (totalActive + cancPlusExp) > 0 ? (cancPlusExp / (totalActive + cancPlusExp)) * 100 : 0,
    };
  }, [totalActive, totalMrr, prevMonth]);

  const dailyTrends = useMemo(() => {
    const from = filters.dateFrom;
    const to = filters.dateTo;
    if (!from || !to) return dailyArr;
    return dailyArr.filter((d) => dayInRange(d.day, from, to));
  }, [dailyArr, filters.dateFrom, filters.dateTo]);

  const compareDailyTrends = [];

  const plansData = useMemo(() => {
    const arr = Array.isArray(cache.by_plan?.data) ? cache.by_plan.data : [];
    const totalActiveSum = arr.reduce((s, x) => s + num(x.active), 0);
    return arr.map((r) => {
      const total = num(r.total);
      const active = num(r.active);
      const cancelled = num(r.cancelled);
      const expired = num(r.expired);
      const revenue = num(r.revenue);
      const avgPrice = num(r.avg_price) || (active > 0 ? revenue / active : 0);
      const pct = totalActiveSum > 0 ? (active / totalActiveSum) * 100 : 0;
      return {
        planName: r.plan || 'Unknown',
        plan: r.plan || 'Unknown',
        total,
        active,
        cancelled,
        expired,
        revenue,
        avgPrice,
        pctOfTotal: pct,
        _filterKey: r.plan || 'Unknown',
      };
    }).sort((a, b) => b.active - a.active);
  }, [cache]);

  const countriesData = useMemo(() => {
    const arr = Array.isArray(cache.by_country?.data) ? cache.by_country.data : [];
    const totalActiveSum = arr.reduce((s, x) => s + num(x.active), 0);
    return arr.map((r) => {
      const total = num(r.total);
      const active = num(r.active);
      const cancelled = num(r.cancelled);
      const expired = num(r.expired);
      const trials = num(r.trials);
      const converted = num(r.converted);
      const revenue = num(r.revenue);
      const avgPrice = num(r.avg_price) || (active > 0 ? revenue / active : 0);
      const pct = totalActiveSum > 0 ? (active / totalActiveSum) * 100 : 0;
      return {
        country: r.country || 'Unknown',
        total,
        active,
        cancelled,
        expired,
        trials,
        converted,
        revenue,
        avgPrice,
        pctOfTotal: pct,
        _filterKey: r.country || 'Unknown',
      };
    }).sort((a, b) => b.active - a.active);
  }, [cache]);

  const platformsData = useMemo(() => {
    const arr = Array.isArray(cache.by_platform?.data) ? cache.by_platform.data : [];
    const totalActiveSum = arr.reduce((s, x) => s + num(x.active), 0);
    return arr.map((r) => {
      const total = num(r.total);
      const active = num(r.active);
      const cancelled = num(r.cancelled);
      const pct = totalActiveSum > 0 ? (active / totalActiveSum) * 100 : 0;
      return {
        platform: r.platform || 'unknown',
        total,
        active,
        cancelled,
        pctOfTotal: pct,
        _filterKey: r.platform || 'unknown',
      };
    }).sort((a, b) => b.active - a.active);
  }, [cache]);

  const frequencyData = useMemo(() => {
    const arr = Array.isArray(cache.by_frequency?.data) ? cache.by_frequency.data : [];
    const totalActiveSum = arr.reduce((s, x) => s + num(x.active), 0);
    return arr.map((r) => {
      const total = num(r.total);
      const active = num(r.active);
      const avgPrice = num(r.avg_price);
      const revenue = num(r.revenue);
      const pct = totalActiveSum > 0 ? (active / totalActiveSum) * 100 : 0;
      return {
        frequency: r.frequency || 'Unknown',
        total,
        active,
        avgPrice,
        revenue,
        pctOfTotal: pct,
        _filterKey: r.frequency || 'Unknown',
      };
    }).sort((a, b) => b.active - a.active);
  }, [cache]);

  const statusData = useMemo(() => {
    const arr = Array.isArray(cache.by_status?.data) ? cache.by_status.data : [];
    const totalSum = arr.reduce((s, x) => s + num(x.total), 0);
    return arr.map((r) => {
      const total = num(r.total);
      const pct = totalSum > 0 ? (total / totalSum) * 100 : 0;
      return {
        status: r.status || 'Unknown',
        total,
        pctOfTotal: pct,
        _filterKey: r.status || 'Unknown',
      };
    }).sort((a, b) => b.total - a.total);
  }, [cache]);

  const churnReasonsData = useMemo(() => {
    const arr = Array.isArray(cache.by_churn_reason?.data) ? cache.by_churn_reason.data : [];
    const totalSum = arr.reduce((s, x) => s + num(x.total), 0);
    return arr.map((r) => {
      const count = num(r.total);
      const pct = totalSum > 0 ? (count / totalSum) * 100 : 0;
      return {
        reason: r.reason || 'Unknown',
        count,
        avgLifetimeValue: 0,
        avgDaysSubscribed: 0,
        pctOfCancellations: pct,
        _filterKey: r.reason || 'Unknown',
      };
    }).sort((a, b) => b.count - a.count);
  }, [cache]);

  const revenueMonthlyTrend = useMemo(() => {
    return monthlyArr.map((m) => ({ month: m.month, mrr: num(m.revenue) }));
  }, [monthlyArr]);

  const revenueByCountry = useMemo(() => {
    const arr = Array.isArray(cache.by_country?.data) ? cache.by_country.data : [];
    return arr.slice(0, 15).map((r) => ({ name: r.country || 'Unknown', value: num(r.revenue) }));
  }, [cache]);

  const revenueByPlan = useMemo(() => {
    const arr = Array.isArray(cache.by_plan?.data) ? cache.by_plan.data : [];
    return arr.map((r) => ({ name: r.plan || 'Unknown', value: num(r.revenue) }));
  }, [cache]);

  const revenueByFreq = { monthly: totalMrr * 0.6, yearly: totalMrr * 0.4 };
  const revenueByPlatform = useMemo(() => {
    const arr = Array.isArray(cache.by_platform?.data) ? cache.by_platform.data : [];
    return arr.map((r) => ({ name: r.platform || 'unknown', value: num(r.active) * (totalMrr / Math.max(totalActive, 1)) }));
  }, [cache, totalMrr, totalActive]);

  const fetchEmailList = useCallback(async (metricKey, filterKey = null) => {
    setEmailListLoading(true);
    try {
      let q = supabase
        .from('vimeo_subscriptions')
        .select('record_id, vimeo_email, email, first_name, last_name, country, state, current_plan, status, frequency, subscription_price, date_became_enabled, customer_created_at')
        .limit(50);

      let orderCol = 'synced_at';
      let orderAsc = false;

      switch (metricKey) {
        case 'totalActive':
          q = q.eq('status', 'enabled');
          break;
        case 'newSubscribers':
          q = q.eq('status', 'enabled');
          orderCol = 'date_became_enabled';
          orderAsc = false;
          break;
        case 'cancellations':
        case 'total_canceled':
          q = q.not('date_last_canceled', 'is', null);
          orderCol = 'date_last_canceled';
          orderAsc = false;
          break;
        case 'trialsStarted':
        case 'total_trials':
          q = q.not('trial_started_date', 'is', null);
          orderCol = 'trial_started_date';
          orderAsc = false;
          break;
        case 'trialConversions':
        case 'total_converted':
          q = q.not('converted_trial', 'is', null);
          break;
        case 'by_country':
          if (filterKey) q = q.eq('country', filterKey);
          break;
        case 'by_plan':
          if (filterKey) q = q.eq('current_plan', filterKey);
          break;
        case 'by_platform':
          if (filterKey) q = q.eq('platform', filterKey);
          break;
        case 'by_churn_reason':
          if (filterKey) q = q.eq('cancel_reason_category', filterKey);
          break;
        case 'by_frequency':
          if (filterKey) q = q.eq('frequency', filterKey);
          break;
        case 'by_status':
          if (filterKey) q = q.eq('status', filterKey);
          break;
        default:
          q = q.eq('status', 'enabled');
      }

      const { data, error: err } = await q.order(orderCol, { ascending: orderAsc });
      if (err) throw err;
      return data || [];
    } catch (e) {
      console.error('fetchEmailList error:', e);
      return [];
    } finally {
      setEmailListLoading(false);
    }
  }, []);

  return {
    filters, updateFilter, batchUpdateFilters, fetchData,
    loading, error, emailListLoading,
    kpis, compareKpis,
    dailyTrends, compareDailyTrends,
    plansData, countriesData, platformsData, frequencyData, statusData,
    churnReasonsData,
    revenueMonthlyTrend, revenueByCountry, revenueByPlan, revenueByFreq, revenueByPlatform,
    totalLtv,
    fetchEmailList,
    lastUpdated,
  };
}
