import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

async function fetchAllRows(queryBuilder) {
  const results = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryBuilder().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return results;
}

function getMonthBounds(monthOffset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + monthOffset);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function num(v) {
  return Number(v) || 0;
}

export function useVimeoSubscriptionsData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rawData, setRawData] = useState([]);
  const [kpis, setKpis] = useState({});
  const [chartData, setChartData] = useState({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('vimeo_subscriptions')
        .select('*')
        .order('synced_at', { ascending: false });
      if (err) throw err;
      setRawData(data || []);
    } catch (e) {
      setError(e?.message || 'Failed to load subscriptions');
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (rawData.length === 0) {
      setKpis({});
      setChartData({});
      return;
    }

    const now = new Date();
    const thisMonth = getMonthBounds(0);
    const lastMonth = getMonthBounds(-1);

    const isThisMonth = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    };
    const isLastMonth = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() - 1;
    };

    const active = rawData.filter((r) => (r.status || '').toLowerCase() === 'enabled');
    const newThisMonth = rawData.filter((r) => isThisMonth(r.date_became_enabled));
    const newLastMonth = rawData.filter((r) => isLastMonth(r.date_became_enabled));
    const momGrowth =
      newLastMonth.length > 0
        ? ((newThisMonth.length - newLastMonth.length) / newLastMonth.length) * 100
        : newThisMonth.length > 0
          ? 100
          : 0;

    const activeTrials = rawData.filter((r) => {
      if (!r.trial_started_date || !r.trial_end_date) return false;
      const end = new Date(r.trial_end_date);
      if (end <= now) return false;
      const enabled = (r.status || '').toLowerCase() === 'enabled';
      const converted = r.converted_trial && String(r.converted_trial).trim() !== '';
      return !enabled || !converted;
    });

    const trialConversionsThisMonth = rawData.filter(
      (r) =>
        r.converted_trial &&
        String(r.converted_trial).trim() !== '' &&
        isThisMonth(r.date_became_enabled)
    );

    const cancellationsThisMonth = rawData.filter((r) => isThisMonth(r.date_last_canceled));
    const activeAtStartApprox = active.length + cancellationsThisMonth.length;
    const churnRate =
      activeAtStartApprox > 0 ? (cancellationsThisMonth.length / activeAtStartApprox) * 100 : 0;

    let mrr = 0;
    active.forEach((r) => {
      const price = num(r.subscription_price) || num(r.vimeo_subscription_price_usd) || 0;
      const freq = (r.frequency || '').toLowerCase();
      if (freq === 'yearly') mrr += price / 12;
      else mrr += price;
    });

    const ltvValues = rawData.filter((r) => num(r.lifetime_value) > 0).map((r) => num(r.lifetime_value));
    const avgLtv = ltvValues.length > 0 ? ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length : 0;

    setKpis({
      totalActiveSubscribers: active.length,
      newSubscribersThisMonth: newThisMonth.length,
      newSubscribersLastMonth: newLastMonth.length,
      momGrowth,
      activeTrials: activeTrials.length,
      trialConversionsThisMonth: trialConversionsThisMonth.length,
      cancellationsThisMonth: cancellationsThisMonth.length,
      churnRate,
      mrr,
      avgLifetimeValue: avgLtv,
    });

    const planCounts = {};
    rawData.forEach((r) => {
      const p = r.current_plan || 'Unknown';
      planCounts[p] = (planCounts[p] || 0) + 1;
    });
    const subscriptionsByPlan = Object.entries(planCounts).map(([name, value]) => ({ name, value }));

    const countryCounts = {};
    rawData.forEach((r) => {
      const c = r.country || 'Unknown';
      countryCounts[c] = (countryCounts[c] || 0) + 1;
    });
    const subscribersByCountry = Object.entries(countryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, value]) => ({ name, value }));

    const healthCounts = { Healthy: 0, 'At Risk': 0, Unhealthy: 0 };
    rawData.forEach((r) => {
      const h = r.health_score_status || 'Unknown';
      if (healthCounts[h] !== undefined) healthCounts[h]++;
      else healthCounts['Healthy']++;
    });
    const healthDistribution = Object.entries(healthCounts).map(([name, value]) => ({ name, value }));

    const thisMonthWeeks = {};
    const lastMonthWeeks = {};
    newThisMonth.forEach((r) => {
      const d = new Date(r.date_became_enabled);
      const week = `W${Math.ceil(d.getDate() / 7)}`;
      thisMonthWeeks[week] = (thisMonthWeeks[week] || 0) + 1;
    });
    newLastMonth.forEach((r) => {
      const d = new Date(r.date_became_enabled);
      const week = `W${Math.ceil(d.getDate() / 7)}`;
      lastMonthWeeks[week] = (lastMonthWeeks[week] || 0) + 1;
    });
    const newSubsThisVsLast = ['W1', 'W2', 'W3', 'W4'].map((w) => ({
      week: w,
      thisMonth: thisMonthWeeks[w] || 0,
      lastMonth: lastMonthWeeks[w] || 0,
    }));

    const monthlyTrend = [];
    for (let i = 11; i >= 0; i--) {
      const m = getMonthBounds(-i);
      const count = rawData.filter((r) => {
        const d = r.date_became_enabled;
        if (!d) return false;
        const dt = new Date(d);
        return dt >= new Date(m.start) && dt <= new Date(m.end);
      }).length;
      monthlyTrend.push({
        month: `${m.start.slice(0, 7)}`,
        count,
      });
    }

    setChartData({
      subscriptionsByPlan,
      subscribersByCountry,
      healthDistribution,
      newSubsThisVsLast,
      monthlyTrend,
    });
  }, [rawData]);

  return {
    loading,
    error,
    rawData,
    kpis,
    chartData,
    refetch: fetchAll,
  };
}
