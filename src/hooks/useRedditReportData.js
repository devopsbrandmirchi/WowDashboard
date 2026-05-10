import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

function getRowDate(r) {
  const v = r.campaign_date ?? r.day ?? r.date ?? r.stat_date ?? r.report_date ?? r.segment_date;
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.length >= 10 && v[4] === '-' && v[7] === '-') return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
    case 'this_month': return { from: fmtLocal(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmtLocal(today) };
    case 'last_month': {
      const f = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const l = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: fmtLocal(f), to: fmtLocal(l) };
    }
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

function addMetrics(o) {
  const cost = o.cost ?? 0;
  const impressions = o.impressions ?? 0;
  const clicks = o.clicks ?? 0;
  const purchases = o.purchases ?? 0;
  o.ctr = impressions ? (clicks / impressions) * 100 : 0;
  o.cpc = clicks ? cost / clicks : 0;
  o.cpm = impressions ? (cost / (impressions / 1000)) : 0;
  o.cpa = purchases ? cost / purchases : 0;
  return o;
}

/** Normalize campaign row: campaign_name, ad_group_name, community, campaign_date, amount_spent_usd / total_spent, purchase_view, purchase_click */
function normalizeCampaignRow(r) {
  const cost = num(r.amount_spent_usd ?? r.total_spent ?? r.amount_spent ?? r.spend ?? r.cost);
  const purchaseClick = num(r.purchase_click ?? r.total_purchase_click);
  const purchaseView = num(r.purchase_view ?? r.total_purchase_view);
  const purchases = purchaseClick + purchaseView;
  const day = getRowDate(r) ?? toDayKey(r.campaign_date ?? r.day ?? r.date) ?? null;
  const impressions = num(r.impressions ?? r.total_impressions ?? r.impression);
  const clicks = num(r.clicks ?? r.total_clicks);
  return {
    id: r.id,
    campaign_name: r.campaign_name ?? r.campaign ?? '',
    ad_group_name: r.ad_group_name ?? r.adgroup_name ?? r.campaign_name ?? '',
    community: r.community ?? r.subreddit ?? '',
    country: (r.country ?? '').toString().trim() || null,
    day,
    impressions,
    clicks,
    cost,
    purchases,
    purchase_click: purchaseClick,
    purchase_view: purchaseView,
    total_value_purchase: num(r.total_value_purchase),
    total_records: num(r.total_records),
    unique_campaigns: num(r.unique_campaigns),
  };
}

/** Normalize placement/community row (generic metric row) */
function normalizeMetricRow(r, nameKey = 'name') {
  const cost = num(r.amount_spent_usd ?? r.amount_spent ?? r.spend ?? r.cost);
  const purchaseClick = num(r.purchase_click);
  const purchaseView = num(r.purchase_view);
  const purchases = purchaseClick + purchaseView;
  const name = r[nameKey] ?? r.placement ?? r.community ?? r.subreddit ?? r.name ?? '';
  return {
    key: String(r.id != null && r.id !== '' ? r.id : (name || Math.random())),
    name: String(name),
    impressions: num(r.impressions ?? r.impression),
    clicks: num(r.clicks),
    cost,
    purchases,
    day: getRowDate(r) ?? toDayKey(r.campaign_date ?? r.day ?? r.date) ?? null,
  };
}

function calendarDays(from, to) {
  if (!from || !to) return [];
  const out = [];
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  const d = new Date(start);
  const fmt = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  while (d <= end) { out.push(fmt(d)); d.setDate(d.getDate() + 1); }
  return out;
}

export function useRedditReportData() {
  const [filters, setFilters] = useState({
    datePreset: 'this_month',
    dateFrom: '',
    dateTo: '',
    campaignSearch: '',
  });

  const [rawCampaigns, setRawCampaigns] = useState([]);
  const [rawPlacement, setRawPlacement] = useState([]);
  const [campaignRef, setCampaignRef] = useState([]);
  const [dateRange, setDateRange] = useState({ from: null, to: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

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

      const [campaignRows, placementRows, refRows] = await Promise.all([
        fetchAllRows(() => supabase.from('reddit_campaigns_ad_group').select('*')),
        fetchAllRows(() => supabase.from('reddit_campaigns_placement').select('*')).catch(() => []),
        fetchAllRows(() => supabase.from('reddit_campaigns_reference_data').select('*')).catch(() => []),
      ]);

      const normalizedCampaigns = (campaignRows || []).map(normalizeCampaignRow);
      let filtered = from && to
        ? normalizedCampaigns.filter((r) => r.day && r.day >= from && r.day <= to)
        : normalizedCampaigns;
      const search = (f.campaignSearch || '').trim().toLowerCase();
      if (search) {
        filtered = filtered.filter((r) =>
          (r.campaign_name && r.campaign_name.toLowerCase().includes(search)) ||
          (r.community && r.community.toLowerCase().includes(search))
        );
      }
      setRawCampaigns(filtered);

      const normPlacement = (placementRows || []).map((r) => normalizeMetricRow(r, 'placement'));
      setRawPlacement(normPlacement);

      setCampaignRef(refRows || []);
    } catch (err) {
      console.error('Reddit fetch error:', err);
      const msg = err.message || 'Failed to fetch data';
      setError(msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
        ? 'Cannot reach Supabase. Check your network connection.' : msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, filters.dateFrom, filters.dateTo, filters.datePreset]);

  const campaignRefMap = useMemo(() => {
    const m = new Map();
    (campaignRef || []).forEach((r) => {
      const nameKey = (r.campaign_name || '').trim();
      if (nameKey && !m.has(nameKey)) {
        m.set(nameKey, {
          campaign_name: r.campaign_name,
          country: r.country ?? '',
          product_type: r.product_type ?? '',
          showname: r.showname ?? '',
        });
      }
    });
    return m;
  }, [campaignRef]);

  const getRef = useCallback((campaignName) => {
    const nameKey = (campaignName || '').trim();
    return nameKey ? campaignRefMap.get(nameKey) : null;
  }, [campaignRefMap]);

  // Campaign tab = one row per campaign_name (aggregate by campaign_name)
  const campaigns = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const name = (r.campaign_name || '').trim() || 'Unknown';
      const key = String(r.campaign_name ?? r.id ?? name);
      if (!map.has(key)) map.set(key, { key, name, impressions: 0, clicks: 0, cost: 0, purchases: 0 });
      const a = map.get(key);
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns]);

  // Ad Groups tab = aggregate by ad_group_name (total_impressions, total_clicks, total_spent, total_purchase_view, total_purchase_click)
  const adGroups = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const name = (r.ad_group_name || '').trim() || 'Unknown';
      const key = String(r.ad_group_name ?? r.id ?? name);
      if (!map.has(key)) map.set(key, { key, name, impressions: 0, clicks: 0, cost: 0, purchases: 0 });
      const a = map.get(key);
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns]);

  const placements = useMemo(() => {
    const map = new Map();
    rawPlacement.forEach((r) => {
      const key = r.name || r.key || 'Unknown';
      if (!map.has(key)) map.set(key, { key, name: key, impressions: 0, clicks: 0, cost: 0, purchases: 0 });
      const a = map.get(key);
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawPlacement]);

  const countryData = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const country = r.country || 'Unknown';
      if (!map.has(country)) map.set(country, { key: country, name: country, impressions: 0, clicks: 0, cost: 0, purchases: 0 });
      const a = map.get(country);
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns]);

  const productData = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const ref = getRef(r.campaign_name);
      const product = (ref && ref.product_type) ? ref.product_type : 'Unknown';
      if (!map.has(product)) map.set(product, { key: product, name: product, impressions: 0, clicks: 0, cost: 0, purchases: 0 });
      const a = map.get(product);
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns, getRef]);

  const showsData = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const ref = getRef(r.campaign_name);
      const show = (ref && ref.showname) ? ref.showname : 'Unknown';
      if (!map.has(show)) map.set(show, { key: show, name: show, impressions: 0, clicks: 0, cost: 0, purchases: 0 });
      const a = map.get(show);
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns, getRef]);

  const days = useMemo(() => {
    const dayMap = new Map();
    rawCampaigns.forEach((r) => {
      const dkey = toDayKey(r.day) || 'Undefined';
      if (!dayMap.has(dkey)) dayMap.set(dkey, { key: dkey, name: dkey, impressions: 0, clicks: 0, cost: 0, purchases: 0 });
      const a = dayMap.get(dkey);
      a.impressions += r.impressions;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
    });
    dayMap.forEach(addMetrics);
    let allDays = calendarDays(dateRange.from, dateRange.to);
    if (allDays.length <= 1 && dayMap.size > 0) {
      const keys = Array.from(dayMap.keys()).filter((k) => k !== 'Undefined');
      if (keys.length > 0) {
        keys.sort();
        allDays = calendarDays(keys[0], keys[keys.length - 1]);
      }
    }
    const out = allDays.map((d) => dayMap.get(d) || { key: d, name: d, impressions: 0, clicks: 0, cost: 0, purchases: 0, ctr: 0, cpc: 0, cpm: 0, cpa: 0 });
    return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rawCampaigns, dateRange]);

  const kpis = useMemo(() => {
    if (!campaigns.length && !rawCampaigns.length) return null;
    const k = { impressions: 0, clicks: 0, cost: 0, purchases: 0 };
    campaigns.forEach((c) => {
      k.impressions += c.impressions || 0;
      k.clicks += c.clicks || 0;
      k.cost += c.cost || 0;
      k.purchases += c.purchases || 0;
    });
    k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
    k.cpc = k.clicks ? k.cost / k.clicks : 0;
    k.cpm = k.impressions ? (k.cost / (k.impressions / 1000)) : 0;
    k.cpa = k.purchases ? k.cost / k.purchases : 0;
    k.roas = 0;
    return k;
  }, [campaigns, rawCampaigns]);

  const dailyTrends = useMemo(() => {
    return days.map((d) => ({
      date: d.name,
      cost: d.cost,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.purchases,
      ctr: d.ctr,
      cpc: d.cpc,
      cpa: d.cpa,
    }));
  }, [days]);

  return {
    filters,
    dateRange,
    batchUpdateFilters,
    fetchData,
    loading,
    error,
    campaigns,
    adGroups,
    placements,
    countryData,
    productData,
    showsData,
    days,
    kpis,
    dailyTrends,
  };
}
