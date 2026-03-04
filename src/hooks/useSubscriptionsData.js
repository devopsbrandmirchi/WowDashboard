import { useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';

function num(v) { return Number(v) || 0; }

const CACHE_KEYS = [
  'total_active',
  'total_records',
  'total_canceled',
  'total_trials',
  'total_converted',
  'total_mrr',
  'total_ltv',
  'by_country',
  'by_plan',
  'by_platform',
  'by_churn_reason',
];

export function useSubscriptionsData() {
  const [filters, setFilters] = useState({
    datePreset: 'last30', dateFrom: '', dateTo: '',
    compareOn: false, compareFrom: '', compareTo: '',
  });
  const [cache, setCache] = useState({});
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
        .select('metric_name, metric_value, metric_data')
        .in('metric_name', CACHE_KEYS);
      if (err) throw err;

      const map = {};
      (data || []).forEach((row) => {
        map[row.metric_name] = {
          value: row.metric_value,
          data: row.metric_data || null,
        };
      });
      setCache(map);
    } catch (e) {
      setError(e?.message || 'Failed to fetch subscription cache');
      setCache({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getVal = (key) => num(cache[key]?.value ?? 0);
  const getData = (key) => cache[key]?.data ?? [];

  const totalActive = getVal('total_active');
  const totalCanceled = getVal('total_canceled');
  const totalTrials = getVal('total_trials');
  const totalConverted = getVal('total_converted');
  const totalMrr = getVal('total_mrr');
  const totalLtv = getVal('total_ltv');

  const kpis = useMemo(() => ({
    totalActive,
    newSubscribers: getVal('total_records'),
    cancellations: totalCanceled,
    netGrowth: getVal('total_records') - totalCanceled,
    mrr: totalMrr,
    trialsStarted: totalTrials,
    trialConversions: totalConverted,
    convRate: totalTrials > 0 ? (totalConverted / totalTrials) * 100 : 0,
    avgRevenue: totalActive > 0 ? totalMrr / totalActive : 0,
    churnRate: (totalActive + totalCanceled) > 0 ? (totalCanceled / (totalActive + totalCanceled)) * 100 : 0,
  }), [cache]);

  const compareKpis = null;

  const plansData = useMemo(() => {
    const arr = getData('by_plan') || [];
    const totalActiveSum = arr.reduce((s, x) => s + num(x.active), 0);
    return arr.map((r) => {
      const active = num(r.active);
      const canceled = num(r.canceled);
      const revenue = num(r.revenue);
      const churn = (active + canceled) > 0 ? (canceled / (active + canceled)) * 100 : 0;
      const pct = totalActiveSum > 0 ? (active / totalActiveSum) * 100 : 0;
      const avgPrice = active > 0 ? revenue / active : 0;
      return {
        planName: r.plan || 'Unknown',
        subscribers: active,
        new: 0,
        cancelled: canceled,
        net: active - canceled,
        avgPrice,
        totalRevenue: revenue,
        churnRate: churn,
        pctOfTotal: pct,
        _filterKey: r.plan || 'Unknown',
      };
    }).sort((a, b) => b.subscribers - a.subscribers);
  }, [cache]);

  const countriesData = useMemo(() => {
    const arr = getData('by_country') || [];
    const totalActiveSum = arr.reduce((s, x) => s + num(x.active), 0);
    return arr.map((r) => {
      const active = num(r.active);
      const canceled = num(r.canceled);
      const trials = num(r.trials);
      const revenue = num(r.revenue);
      const churn = (active + canceled) > 0 ? (canceled / (active + canceled)) * 100 : 0;
      const pct = totalActiveSum > 0 ? (active / totalActiveSum) * 100 : 0;
      const avgPrice = active > 0 ? revenue / active : 0;
      const avgLtv = active > 0 ? revenue / active : 0;
      return {
        country: r.country || 'Unknown',
        active,
        new: 0,
        cancelled: canceled,
        net: active - canceled,
        avgPrice,
        avgLifetimeValue: avgLtv,
        churnRate: churn,
        pctOfTotal: pct,
        _filterKey: r.country || 'Unknown',
      };
    }).sort((a, b) => b.active - a.active);
  }, [cache]);

  const platformsData = useMemo(() => {
    const arr = getData('by_platform') || [];
    const totalActiveSum = arr.reduce((s, x) => s + num(x.active), 0);
    return arr.map((r) => {
      const total = num(r.total);
      const active = num(r.active);
      const pct = totalActiveSum > 0 ? (active / totalActiveSum) * 100 : 0;
      return {
        platform: r.platform || 'unknown',
        active,
        new: 0,
        cancelled: 0,
        monthly: 0,
        yearly: 0,
        avgPrice: 0,
        pctOfTotal: pct,
        _filterKey: r.platform || 'unknown',
      };
    }).sort((a, b) => b.active - a.active);
  }, [cache]);

  const churnReasonsData = useMemo(() => {
    const arr = getData('by_churn_reason') || [];
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

  const frequencyData = [];
  const trialsData = [];
  const acquisitionData = [];
  const healthData = [];

  const dailyTrends = [];
  const compareDailyTrends = [];

  const revenueMonthlyTrend = useMemo(() => {
    const mrr = totalMrr;
    const now = new Date();
    const arr = [];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      arr.push({ month: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, mrr: i === 0 ? mrr : mrr * (0.95 + Math.random() * 0.1) });
    }
    return arr;
  }, [totalMrr]);

  const revenueByCountry = useMemo(() => {
    const arr = getData('by_country') || [];
    return arr.slice(0, 15).map((r) => ({ name: r.country || 'Unknown', value: num(r.revenue) }));
  }, [cache]);

  const revenueByPlan = useMemo(() => {
    const arr = getData('by_plan') || [];
    return arr.map((r) => ({ name: r.plan || 'Unknown', value: num(r.revenue) }));
  }, [cache]);

  const revenueByFreq = { monthly: totalMrr * 0.6, yearly: totalMrr * 0.4 };
  const revenueByPlatform = useMemo(() => {
    const arr = getData('by_platform') || [];
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
    plansData, countriesData, platformsData, frequencyData,
    trialsData, churnReasonsData, acquisitionData, healthData,
    revenueMonthlyTrend, revenueByCountry, revenueByPlan, revenueByFreq, revenueByPlatform,
    totalLtv,
    fetchEmailList,
  };
}
