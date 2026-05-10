import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

/** Get date string (YYYY-MM-DD) from a raw row - tiktok_campaigns_data may use different column names */
function getRowDate(r) {
  return toDayKey(r.day ?? r.stat_time_day ?? r.date ?? r.stat_date ?? r.report_date);
}

async function fetchAllRows(queryFactory) {
  const results = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFactory().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return results;
}

function fmtLocal(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeDateRange(preset, customFrom, customTo) {
  const today = new Date();
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  switch (preset) {
    case 'today': return { from: fmtLocal(today), to: fmtLocal(today) };
    case 'yesterday': return { from: fmtLocal(daysAgo(1)), to: fmtLocal(daysAgo(1)) };
    case 'last7': return { from: fmtLocal(daysAgo(6)), to: fmtLocal(today) };
    case 'last14': return { from: fmtLocal(daysAgo(13)), to: fmtLocal(today) };
    case 'last30': return { from: fmtLocal(daysAgo(29)), to: fmtLocal(today) };
    case 'this_month': { const f = new Date(today.getFullYear(), today.getMonth(), 1); return { from: fmtLocal(f), to: fmtLocal(today) }; }
    case 'last_month': { const f = new Date(today.getFullYear(), today.getMonth() - 1, 1); const l = new Date(today.getFullYear(), today.getMonth(), 0); return { from: fmtLocal(f), to: fmtLocal(l) }; }
    case 'custom': return { from: customFrom || null, to: customTo || null };
    case '2025': return { from: '2025-01-01', to: '2025-12-31' };
    default: return { from: null, to: null };
  }
}

function num(v) { return Number(v) || 0; }

function toDayKey(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.length >= 10 && v[4] === '-' && v[7] === '-') return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calendarDays(from, to) {
  if (!from || !to) return [];
  const out = [];
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  const d = new Date(start);
  const fmtLocal = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  while (d <= end) {
    out.push(fmtLocal(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function addMetrics(o) {
  const cost = o.cost;
  const impressions = o.impressions;
  const clicks = o.clicks;
  const purchases = o.purchases || 0;
  o.ctr = impressions ? (clicks / impressions) * 100 : 0;
  o.cpc = clicks ? cost / clicks : 0;
  o.cpm = impressions ? (cost / (impressions / 1000)) : 0;
  o.conv_rate = clicks ? (purchases / clicks) * 100 : 0;
  o.cpa = purchases ? cost / purchases : 0;
  return o;
}

/** Normalize row: support common TikTok/DB column names (spend/cost, conversions/purchases) */
function normalizeRow(r) {
  const cost = num(r.amount_spent_usd ?? r.spend ?? r.cost);
  const purchases = num(r.purchases ?? r.conversions ?? r.conversion);
  return {
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name ?? '',
    country: (r.country != null && r.country !== '') ? String(r.country).trim() : '',
    adset_id: r.adset_id ?? r.adgroup_id ?? r.ad_group_id,
    adset_name: r.adset_name ?? r.adgroup_name ?? r.ad_group_name ?? '',
    ad_id: r.ad_id,
    ad_name: r.ad_name ?? '',
    placement: r.placement ?? '',
    day: r.day ?? r.stat_time_day ?? r.date,
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.clicks ?? r.clicks_all),
    cost,
    purchases,
    revenue: num(r.revenue ?? r.total_purchase_value),
  };
}

export function useTiktokReportData() {
  const [filters, setFilters] = useState({
    datePreset: 'this_month',
    dateFrom: '',
    dateTo: '',
    campaignSearch: '',
    adGroupSearch: '',
  });

  const [rawRows, setRawRows] = useState([]);
  const [dateRange, setDateRange] = useState({ from: null, to: null });
  const [campaignRef, setCampaignRef] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const updateFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const batchUpdateFilters = useCallback((updates) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  const fetchData = useCallback(async () => {
    const f = filtersRef.current;
    setLoading(true);
    setError(null);
    try {
      let { from, to } = computeDateRange(f.datePreset, f.dateFrom, f.dateTo);
      if (!from || !to) {
        const today = new Date();
        to = fmtLocal(today);
        const d = new Date(today);
        d.setDate(d.getDate() - 30);
        from = fmtLocal(d);
      }
      setDateRange({ from, to });

      const buildDataQuery = () => {
        let q = supabase.from('tiktok_campaigns_data').select('*');
        if ((f.campaignSearch || '').trim()) q = q.ilike('campaign_name', `%${f.campaignSearch.trim()}%`);
        if ((f.adGroupSearch || '').trim()) {
          q = q.ilike('ad_group_name', `%${f.adGroupSearch.trim()}%`);
        }
        return q;
      };

      const refQuery = () => supabase.from('tiktok_campaigns_reference_data').select('*');

      const [dataRows, refRes] = await Promise.all([
        fetchAllRows(buildDataQuery),
        fetchAllRows(refQuery).catch(() => []),
      ]);

      const filteredByDate = from && to
        ? dataRows.filter((r) => {
            const d = getRowDate(r);
            return d && d >= from && d <= to;
          })
        : dataRows;

      const normalized = filteredByDate.map(normalizeRow);
      setRawRows(normalized);
      setCampaignRef(refRes || []);
    } catch (err) {
      console.error('TikTok fetch error:', err);
      const msg = err.message || 'Failed to fetch data';
      setError(msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
        ? 'Cannot reach Supabase. Check your network connection.' : msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData, filters.dateFrom, filters.dateTo, filters.datePreset]);

  const campaignRefMap = useMemo(() => {
    const m = new Map();
    (campaignRef || []).forEach((r) => {
      const refVal = {
        campaign_name: r.campaign_name,
        country: r.country ?? '',
        product_type: r.product_type ?? '',
        showname: r.showname ?? '',
      };
      const nameKey = (r.campaign_name || '').trim();
      if (nameKey && !m.has(nameKey)) m.set(nameKey, refVal);
    });
    return m;
  }, [campaignRef]);

  const getRef = useCallback((r) => {
    const nameKey = (r.campaign_name || '').trim();
    return nameKey ? campaignRefMap.get(nameKey) : null;
  }, [campaignRefMap]);

  const campaigns = useMemo(() => {
    const map = new Map();
    rawRows.forEach((r) => {
      const cid = r.campaign_id != null ? String(r.campaign_id) : 'Undefined';
      const name = (r.campaign_name || '').trim() || cid;
      if (!map.has(cid)) map.set(cid, { key: cid, name, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(cid);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawRows]);

  const adSets = useMemo(() => {
    const map = new Map();
    rawRows.forEach((r) => {
      const asid = r.adset_id != null ? String(r.adset_id) : (r.adset_name || 'Undefined');
      const asName = r.adset_name || asid;
      if (!map.has(asid)) map.set(asid, { key: asid, name: asName, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(asid);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawRows]);

  const ads = useMemo(() => {
    const map = new Map();
    rawRows.forEach((r) => {
      const adid = r.ad_id != null ? String(r.ad_id) : (r.ad_name || 'Undefined');
      const adName = r.ad_name || adid;
      if (!map.has(adid)) map.set(adid, { key: adid, name: adName, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(adid);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawRows]);

  const placements = useMemo(() => {
    const map = new Map();
    rawRows.forEach((r) => {
      const pkey = r.placement != null && r.placement !== '' ? String(r.placement) : 'Undefined';
      if (!map.has(pkey)) map.set(pkey, { key: pkey, name: pkey, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(pkey);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawRows]);

  const countries = useMemo(() => {
    const map = new Map();
    rawRows.forEach((r) => {
      const country = (r.country && String(r.country).trim()) ? String(r.country).trim() : 'Undefined';
      if (!map.has(country)) map.set(country, { key: country, name: country, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(country);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawRows]);

  const products = useMemo(() => {
    const map = new Map();
    rawRows.forEach((r) => {
      const ref = getRef(r);
      const product_type = (ref && ref.product_type) ? ref.product_type : 'Undefined';
      if (!map.has(product_type)) map.set(product_type, { key: product_type, name: product_type, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(product_type);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawRows, getRef]);

  const shows = useMemo(() => {
    const map = new Map();
    rawRows.forEach((r) => {
      const ref = getRef(r);
      const showname = (ref && ref.showname) ? ref.showname : 'Undefined';
      if (!map.has(showname)) map.set(showname, { key: showname, name: showname, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(showname);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawRows, getRef]);

  const days = useMemo(() => {
    const dayMap = new Map();
    rawRows.forEach((r) => {
      const dkey = toDayKey(r.day) || 'Undefined';
      if (!dayMap.has(dkey)) dayMap.set(dkey, { key: dkey, name: dkey, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = dayMap.get(dkey);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    dayMap.forEach(addMetrics);
    let allDays = calendarDays(dateRange.from, dateRange.to);
    if (allDays.length <= 1 && dayMap.size > 0) {
      const keys = Array.from(dayMap.keys()).filter((k) => k !== 'Undefined' && k != null);
      if (keys.length > 0) {
        keys.sort();
        allDays = calendarDays(keys[0], keys[keys.length - 1]);
      }
    }
    const out = allDays.map((d) => dayMap.get(d) || { key: d, name: d, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0, ctr: 0, cpc: 0, cpm: 0, cpa: 0 });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [rawRows, dateRange]);

  const kpis = useMemo(() => {
    if (!campaigns.length) return null;
    const k = { impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 };
    campaigns.forEach((c) => {
      k.impressions += c.impressions; k.reach += c.reach; k.clicks += c.clicks; k.cost += c.cost; k.purchases += c.purchases; k.revenue += c.revenue;
    });
    k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
    k.cpc = k.clicks ? k.cost / k.clicks : 0;
    k.cpm = k.impressions ? (k.cost / (k.impressions / 1000)) : 0;
    k.cpa = k.purchases ? k.cost / k.purchases : 0;
    k.roas = k.cost ? k.revenue / k.cost : 0;
    k.conv_rate = k.clicks ? (k.purchases / k.clicks) * 100 : 0;
    k.campaign_count = campaigns.length;
    return k;
  }, [campaigns]);

  const dailyTrends = useMemo(() => {
    return days.map((d) => ({
      date: d.name,
      cost: d.cost,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.purchases,
      ctr: d.ctr,
      cpc: d.cpc,
      conv_rate: d.conv_rate,
      cpa: d.cpa,
    }));
  }, [days]);

  return {
    filters,
    updateFilter,
    batchUpdateFilters,
    fetchData,
    loading,
    error,
    campaigns,
    adSets,
    ads,
    placements,
    countries,
    products,
    shows,
    days,
    kpis,
    dailyTrends,
  };
}
