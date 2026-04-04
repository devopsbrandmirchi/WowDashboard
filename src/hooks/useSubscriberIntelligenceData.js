import { useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/** Cached KPI rows from Supabase (see subscription_kpi_cache_new). */
const SUBSCRIPTION_KPI_CACHE_TABLE = 'subscription_kpi_cache_new';

function num(v) { return Number(v) || 0; }

/** Snapshot field present (including 0); null/undefined/'' → treat as missing for fallbacks. */
function snapNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function planCountByNameMatch(byPlan, test) {
  if (!Array.isArray(byPlan)) return 0;
  let sum = 0;
  for (const p of byPlan) {
    const name = String(p.name ?? p.plan ?? p.tier ?? '').trim();
    if (!name || !test(name)) continue;
    sum += num(p.value ?? p.total ?? p.count ?? p.active);
  }
  return sum;
}

function frequencySum(byFreq, test) {
  if (!Array.isArray(byFreq)) return 0;
  let sum = 0;
  for (const r of byFreq) {
    const label = String(r.frequency ?? r.name ?? r.billing ?? '').toLowerCase();
    if (!test(label)) continue;
    sum += num(r.active ?? r.total ?? r.value);
  }
  return sum;
}

/** Rows: { country, active, monthly, yearly } — supports hs_by_country / by_country shapes. */
function normalizeCountryRows(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    country: r.country ?? r.name ?? '',
    active: num(r.active ?? r.value),
    monthly: num(r.monthly),
    yearly: num(r.yearly),
  }));
}

/** Rows: { platform, active, monthly, yearly } — supports name/value or platform/total/active. */
function normalizePlatformRows(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    platform: r.platform ?? r.name ?? '',
    active: num(r.active ?? r.value ?? r.total),
    monthly: num(r.monthly),
    yearly: num(r.yearly),
  }));
}

/** Align hs_trials_monthly / trials metric_data with SubscriberIntelligencePage expectations. */
function normalizeTrialsMonthly(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const converted = num(r.converted ?? r.trial_conversions);
    const still = num(r.still ?? r.still_on_trial);
    const nowActive = num(r.now_active ?? r.new_subscribers);
    const trialsStarted = num(r.trials_started ?? r.trialsStarted);
    return {
      ...r,
      month: r.month ?? r.month_key ?? '',
      trials_started: trialsStarted || converted + still,
      trial_conversions: converted,
      still_on_trial: still,
      now_active: nowActive,
    };
  });
}

function buildKpisFromCache(cache) {
  const activeSnapshot = cache.active_snapshot?.data ?? {};
  const trialsSnapshot = cache.trials_snapshot?.data ?? {};
  const byPlan = Array.isArray(cache.by_plan?.data) ? cache.by_plan.data : [];

  let standardTier = snapNum(activeSnapshot.standard_tier);
  if (standardTier == null) standardTier = planCountByNameMatch(byPlan, (n) => /standard/i.test(n));
  let allAccessTier = snapNum(activeSnapshot.all_access_tier);
  if (allAccessTier == null) allAccessTier = planCountByNameMatch(byPlan, (n) => /all\s*access/i.test(n));

  let monthly = snapNum(activeSnapshot.monthly);
  let yearly = snapNum(activeSnapshot.yearly);
  if (monthly == null || yearly == null) {
    const byFreq = Array.isArray(cache.by_frequency?.data) ? cache.by_frequency.data : [];
    if (monthly == null) monthly = frequencySum(byFreq, (l) => l.includes('month')) || 0;
    if (yearly == null) yearly = frequencySum(byFreq, (l) => l.includes('year') || l.includes('annual')) || 0;
  }

  const rawTotalActive = activeSnapshot.total_active;
  const totalActive =
    rawTotalActive != null && rawTotalActive !== ''
      ? num(rawTotalActive)
      : standardTier + allAccessTier + num(activeSnapshot.free_tier);

  return {
    totalActive,
    standardTier,
    allAccessTier,
    monthly,
    yearly,
    activeTrials: num(
      trialsSnapshot.total_active_trials
        ?? trialsSnapshot.total_active
        ?? trialsSnapshot.active_trials,
    ),
  };
}

export function useSubscriberIntelligenceData() {
  const [cacheRows, setCacheRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [emailListLoading, setEmailListLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.from(SUBSCRIPTION_KPI_CACHE_TABLE).select('*');
      if (err) throw err;
      setCacheRows(data || []);
    } catch (e) {
      const msg = e?.message || 'Failed to fetch subscriber intelligence';
      setError(
        msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
          ? 'Cannot reach Supabase. Check your network connection or try a VPN/mobile hotspot.'
          : msg,
      );
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

  const byCountry = useMemo(() => {
    const hs = cache.hs_by_country?.data;
    const legacy = cache.by_country?.data;
    return normalizeCountryRows(Array.isArray(hs) && hs.length ? hs : legacy);
  }, [cache]);

  const byPlatform = useMemo(() => {
    const hs = cache.hs_by_platform?.data;
    const legacy = cache.by_platform?.data;
    return normalizePlatformRows(Array.isArray(hs) && hs.length ? hs : legacy);
  }, [cache]);

  const trialsMonthly = useMemo(() => {
    const hs = cache.hs_trials_monthly?.data;
    return normalizeTrialsMonthly(Array.isArray(hs) ? hs : []);
  }, [cache]);

  const byStatus = useMemo(() => {
    const hs = cache.hs_by_status?.data;
    const legacy = cache.by_status?.data;
    const raw = Array.isArray(hs) && hs.length ? hs : legacy;
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({
      status: r.status ?? r.name ?? '',
      total: num(r.total ?? r.value),
    }));
  }, [cache]);

  const kpis = useMemo(() => buildKpisFromCache(cache), [cache]);

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
