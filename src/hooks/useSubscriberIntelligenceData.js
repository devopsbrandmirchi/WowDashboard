import { useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';

function num(v) { return Number(v) || 0; }

export function useSubscriberIntelligenceData() {
  const [cacheRows, setCacheRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [emailListLoading, setEmailListLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.from('subscription_kpi_cache').select('*');
      if (err) throw err;
      setCacheRows(data || []);
    } catch (e) {
      setError(e?.message || 'Failed to fetch subscriber intelligence');
      setCacheRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  const activeSnapshot = useMemo(() => cache.active_snapshot?.data ?? {}, [cache]);
  const trialsSnapshot = useMemo(() => cache.trials_snapshot?.data ?? {}, [cache]);
  const byCountry = useMemo(() => Array.isArray(cache.hs_by_country?.data) ? cache.hs_by_country.data : [], [cache]);
  const byPlatform = useMemo(() => Array.isArray(cache.hs_by_platform?.data) ? cache.hs_by_platform.data : [], [cache]);
  const trialsMonthly = useMemo(() => Array.isArray(cache.hs_trials_monthly?.data) ? cache.hs_trials_monthly.data : [], [cache]);
  const byStatus = useMemo(() => Array.isArray(cache.hs_by_status?.data) ? cache.hs_by_status.data : [], [cache]);

  const kpis = useMemo(() => ({
    totalActive: num(activeSnapshot.total_active),
    standardTier: num(activeSnapshot.standard_tier),
    allAccessTier: num(activeSnapshot.all_access_tier),
    monthly: num(activeSnapshot.monthly),
    yearly: num(activeSnapshot.yearly),
    activeTrials: num(trialsSnapshot.total_active_trials),
  }), [activeSnapshot, trialsSnapshot]);

  const fetchEmailList = useCallback(async (type, filterKey, monthKey = null) => {
    setEmailListLoading(true);
    try {
      let q = supabase
        .from('vimeo_subscriptions')
        .select('vimeo_email, email, first_name, last_name, current_plan, frequency, platform, country, status, date_became_enabled')
        .limit(50);

      switch (type) {
        case 'country':
          q = q.eq('status', 'enabled').eq('country', filterKey).in('current_plan', ['Standard Tier', 'All Access Tier']);
          break;
        case 'platform':
          q = q.eq('status', 'enabled').eq('platform', filterKey);
          break;
        case 'status':
          q = q.eq('status', filterKey);
          break;
        case 'trials':
          if (monthKey) {
            const [y, m] = monthKey.split('-').map(Number);
            const start = `${monthKey}-01`;
            const lastDay = new Date(y, m, 0).getDate();
            const end = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
            q = q.gte('trial_started_date', start).lte('trial_started_date', end);
          }
          break;
        default:
          q = q.eq('status', 'enabled');
      }

      const { data, error: err } = await q.order('synced_at', { ascending: false });
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
    loading, error, fetchData, emailListLoading,
    kpis, lastUpdated,
    byCountry, byPlatform, trialsMonthly, byStatus,
    fetchEmailList,
  };
}
