import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

/** Fetch ALL rows for the date range (no cap) so full data is processed */
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

function computeDateRange(preset, customFrom, customTo) {
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  switch (preset) {
    case 'today': return { from: fmt(today), to: fmt(today) };
    case 'yesterday': return { from: fmt(daysAgo(1)), to: fmt(daysAgo(1)) };
    case 'last7': return { from: fmt(daysAgo(6)), to: fmt(today) };
    case 'last14': return { from: fmt(daysAgo(13)), to: fmt(today) };
    case 'last30': return { from: fmt(daysAgo(29)), to: fmt(today) };
    case 'this_month': { const f = new Date(today.getFullYear(), today.getMonth(), 1); return { from: fmt(f), to: fmt(today) }; }
    case 'last_month': { const f = new Date(today.getFullYear(), today.getMonth() - 1, 1); const l = new Date(today.getFullYear(), today.getMonth(), 0); return { from: fmt(f), to: fmt(l) }; }
    case 'custom': return { from: customFrom || null, to: customTo || null };
    default: return { from: null, to: null };
  }
}

function num(v) { return Number(v) || 0; }

/** Normalize date to YYYY-MM-DD so dayMap keys match calendar days (Supabase may return ISO with time) */
function toDayKey(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.length >= 10 && v[4] === '-' && v[7] === '-') return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Generate all calendar days between from and to (YYYY-MM-DD), using local date so timezone doesn't collapse days */
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

const DATE_COL = 'day';

/** Add derived metrics to a row */
function addMetrics(o) {
  const cost = o.cost;
  const impressions = o.impressions;
  const clicks = o.clicks;
  const purchases = o.purchases || 0;
  o.ctr = impressions ? (clicks / impressions) * 100 : 0;
  o.cpc = clicks ? cost / clicks : 0;
  o.cpm = impressions ? (cost / (impressions / 1000)) : 0;
  o.conv_rate = clicks ? (purchases / clicks) * 100 : 0;
  return o;
}

/** Normalize one raw DB row (inline for speed) */
function normalizeRow(r) {
  const revenue = num(r.purchases_value) + num(r.inapp_purchases_value) + num(r.direct_website_purchases_value);
  return {
    account_id: r.account_id,
    delivery_status: r.delivery_status ?? '',
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    adset_id: r.adset_id,
    adset_name: r.adset_name,
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    placement: r.placement ?? '',
    day: r.day,
    platform: r.platform ?? '',
    device_platform: r.device_platform ?? '',
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.clicks_all),
    cost: num(r.amount_spent_usd),
    purchases: num(r.purchases) || num(r.meta_purchases),
    revenue,
  };
}

export function useMetaCampaignsData() {
  const [filters, setFilters] = useState({
    datePreset: 'last30',
    dateFrom: '',
    dateTo: '',
    compareOn: false,
    compareFrom: '',
    compareTo: '',
    customerId: 'ALL',
    productType: 'all',
    deliveryStatus: 'all',
    campaignSearch: '',
    adGroupSearch: '',
    keywordSearch: '',
  });

  const [rawRows, setRawRows] = useState([]);
  const [dateRange, setDateRange] = useState({ from: null, to: null });
  const [campaignRef, setCampaignRef] = useState([]);
  const [adsetRef, setAdsetRef] = useState([]);
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
        const fmt = (d) => d.toISOString().slice(0, 10);
        to = fmt(today);
        const d = new Date(today);
        d.setDate(d.getDate() - 30);
        from = fmt(d);
      }
      setDateRange({ from, to });

      const dataQuery = () =>
        supabase
          .from('facebook_campaigns_data')
          .select('*')
          .gte(DATE_COL, from)
          .lte(DATE_COL, to)
          .order(DATE_COL, { ascending: false });

      const refCampaign = () => supabase.from('facebook_campaigns_reference_data').select('campaign_id,campaign_name,country,product_type,showname');
      const refAdset = () => supabase.from('facebook_adset_reference_data').select('adset_name,country,product_type');

      const [dataRows, refCampaignRes, refAdsetRes] = await Promise.all([
        fetchAllRows(dataQuery),
        fetchAllRows(refCampaign).catch(() => []),
        fetchAllRows(refAdset).catch(() => []),
      ]);

      const normalized = [];
      for (let i = 0; i < dataRows.length; i++) normalized.push(normalizeRow(dataRows[i]));
      setRawRows(normalized);
      setCampaignRef(refCampaignRes || []);
      setAdsetRef(refAdsetRes || []);
    } catch (err) {
      console.error('Meta fetch error:', err);
      const msg = err.message || 'Failed to fetch data';
      setError(msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
        ? 'Cannot reach Supabase. Check your network connection.' : msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /** Reference map keyed by campaign_name (primary) and campaign_id when present. Shows, Country, Product come from here. */
  const campaignRefMap = useMemo(() => {
    const m = new Map();
    const arr = campaignRef || [];
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i];
      const nameKey = (r.campaign_name || '').trim();
      const refVal = { campaign_name: r.campaign_name, country: r.country ?? '', product_type: r.product_type ?? '', showname: r.showname ?? '' };
      if (nameKey && !m.has(nameKey)) m.set(nameKey, refVal);
      const id = r.campaign_id != null ? String(r.campaign_id) : '';
      if (id && !m.has(id)) m.set(id, refVal);
    }
    return m;
  }, [campaignRef]);

  /** Apply Customer, Type, Status, Campaign, Ad Group, Keyword filters */
  const filteredRows = useMemo(() => {
    const f = filters;
    const rows = rawRows;
    const refMap = campaignRefMap;
    const custOk = f.customerId === 'ALL';
    const statusOk = f.deliveryStatus === 'all';
    const campaignTerm = (f.campaignSearch || '').trim().toLowerCase();
    const adGroupTerm = (f.adGroupSearch || '').trim().toLowerCase();
    const keywordTerm = (f.keywordSearch || '').trim().toLowerCase();
    const productOk = f.productType === 'all';
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!custOk && String(r.account_id) !== f.customerId) continue;
      if (!statusOk && (r.delivery_status || '') !== f.deliveryStatus) continue;
      if (campaignTerm && (r.campaign_name || '').toLowerCase().includes(campaignTerm) === false) continue;
      if (adGroupTerm && (r.adset_name || '').toLowerCase().includes(adGroupTerm) === false) continue;
      if (keywordTerm && (r.ad_name || '').toLowerCase().includes(keywordTerm) === false) continue;
      if (!productOk) {
        const ref = refMap.get(String(r.campaign_id)) || (r.campaign_name ? refMap.get((r.campaign_name || '').trim()) : null);
        const pt = (ref && ref.product_type) ? ref.product_type : '';
        if (pt !== f.productType) continue;
      }
      out.push(r);
    }
    return out;
  }, [rawRows, campaignRefMap, filters]);

  /** Single-pass aggregation: build all tab datasets from filteredRows */
  const aggregated = useMemo(() => {
    const campaignMap = new Map();
    const adSetMap = new Map();
    const placementMap = new Map();
    const dayMap = new Map();
    const adMap = new Map();
    const platformMap = new Map();
    const deviceMap = new Map();
    const countryMap = new Map();
    const productMap = new Map();
    const showMap = new Map();

    const rows = filteredRows;
    const refMap = campaignRefMap;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const cid = r.campaign_id != null ? String(r.campaign_id) : '(not set)';
      const nameKey = (r.campaign_name || '').trim();
      const ref = refMap.get(cid) || (nameKey ? refMap.get(nameKey) : null);
      const campaignName = (ref && ref.campaign_name) ? ref.campaign_name : (r.campaign_name || cid);
      let a = campaignMap.get(cid);
      if (!a) { a = { key: cid, name: campaignName, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; campaignMap.set(cid, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const asid = r.adset_id != null ? String(r.adset_id) : (r.adset_name || '(not set)');
      const asName = r.adset_name || asid;
      a = adSetMap.get(asid);
      if (!a) { a = { key: asid, name: asName, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; adSetMap.set(asid, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const pkey = r.placement != null && r.placement !== '' ? String(r.placement) : '(not set)';
      a = placementMap.get(pkey);
      if (!a) { a = { key: pkey, name: pkey, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; placementMap.set(pkey, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const dkey = toDayKey(r.day) || '(not set)';
      a = dayMap.get(dkey);
      if (!a) { a = { key: dkey, name: dkey, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; dayMap.set(dkey, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const adid = r.ad_id != null ? String(r.ad_id) : (r.ad_name || '(not set)');
      const adName = r.ad_name || adid;
      a = adMap.get(adid);
      if (!a) { a = { key: adid, name: adName, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; adMap.set(adid, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const pplat = r.platform != null && r.platform !== '' ? String(r.platform) : '(not set)';
      a = platformMap.get(pplat);
      if (!a) { a = { key: pplat, name: pplat, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; platformMap.set(pplat, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const dev = r.device_platform != null && r.device_platform !== '' ? String(r.device_platform) : '(not set)';
      a = deviceMap.get(dev);
      if (!a) { a = { key: dev, name: dev, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; deviceMap.set(dev, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const country = (ref && ref.country) ? ref.country : '(not set)';
      a = countryMap.get(country);
      if (!a) { a = { key: country, name: country, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; countryMap.set(country, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const product_type = (ref && ref.product_type) ? ref.product_type : '(not set)';
      a = productMap.get(product_type);
      if (!a) { a = { key: product_type, name: product_type, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; productMap.set(product_type, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;

      const showname = (ref && ref.showname) ? ref.showname : '(not set)';
      a = showMap.get(showname);
      if (!a) { a = { key: showname, name: showname, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 }; showMap.set(showname, a); }
      a.impressions += r.impressions;
      a.reach += r.reach;
      a.clicks += r.clicks;
      a.cost += r.cost;
      a.purchases += r.purchases;
      a.revenue += r.revenue;
    }

    const finish = (map, sortByCost = true) => {
      const out = Array.from(map.values());
      out.forEach(addMetrics);
      if (sortByCost) out.sort((a, b) => b.cost - a.cost);
      return out;
    };
    dayMap.forEach((row) => addMetrics(row));

    return {
      campaigns: finish(campaignMap),
      adSets: finish(adSetMap),
      placements: finish(placementMap),
      dayMap,
      ads: finish(adMap),
      platforms: finish(platformMap),
      platformDevices: finish(deviceMap),
      countries: finish(countryMap),
      products: finish(productMap),
      shows: finish(showMap),
    };
  }, [filteredRows, campaignRefMap]);

  /** Day tab: show every calendar day in range, with zeros for missing days. If range is missing or single-day but we have more data, use min/max from dayMap so we show all days. */
  const days = useMemo(() => {
    const { from, to } = dateRange;
    const dayMap = aggregated.dayMap;
    let allDays = calendarDays(from, to);
    if (allDays.length <= 1 && dayMap.size > 0) {
      const keys = Array.from(dayMap.keys()).filter((k) => k !== '(not set)' && k != null);
      if (keys.length > 0) {
        keys.sort();
        const min = keys[0];
        const max = keys[keys.length - 1];
        allDays = calendarDays(min, max);
      }
    }
    const out = [];
    for (let i = 0; i < allDays.length; i++) {
      const d = allDays[i];
      const row = dayMap.get(d);
      if (row) {
        out.push(row);
      } else {
        out.push({
          key: d,
          name: d,
          impressions: 0,
          reach: 0,
          clicks: 0,
          cost: 0,
          purchases: 0,
          revenue: 0,
          ctr: 0,
          cpc: 0,
          cpm: 0,
        });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [aggregated.dayMap, dateRange]);

  const campaigns = aggregated.campaigns;
  const adSets = aggregated.adSets;
  const placements = aggregated.placements;
  const ads = aggregated.ads;
  const platforms = aggregated.platforms;
  const platformDevices = aggregated.platformDevices;
  const countries = aggregated.countries;
  const products = aggregated.products;
  const shows = aggregated.shows;

  const kpis = useMemo(() => {
    if (!campaigns.length) return null;
    const k = { impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 };
    for (let i = 0; i < campaigns.length; i++) {
      const c = campaigns[i];
      k.impressions += c.impressions;
      k.reach += c.reach;
      k.clicks += c.clicks;
      k.cost += c.cost;
      k.purchases += c.purchases;
      k.revenue += c.revenue;
    }
    k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
    k.cpc = k.clicks ? k.cost / k.clicks : 0;
    k.cpm = k.impressions ? (k.cost / (k.impressions / 1000)) : 0;
    k.cpa = k.purchases ? k.cost / k.purchases : 0;
    k.roas = k.cost ? k.revenue / k.cost : 0;
    k.conv_rate = k.clicks ? (k.purchases / k.clicks) * 100 : 0;
    k.campaign_count = campaigns.length;
    return k;
  }, [campaigns]);

  const filterOptions = useMemo(() => {
    const accountSet = new Set();
    const statusSet = new Set();
    const typeSet = new Set();
    rawRows.forEach((r) => {
      if (r.account_id != null && r.account_id !== '') accountSet.add(String(r.account_id));
      if (r.delivery_status != null && r.delivery_status !== '') statusSet.add(String(r.delivery_status));
    });
    (campaignRef || []).forEach((r) => {
      if (r.product_type != null && r.product_type !== '') typeSet.add(String(r.product_type));
    });
    const customers = [{ id: 'ALL', name: 'All Customers' }, ...[...accountSet].sort().map((id) => ({ id, name: id }))];
    const productTypes = [{ id: 'all', name: 'All Types' }, ...[...typeSet].sort().map((t) => ({ id: t, name: t }))];
    const deliveryStatuses = [{ id: 'all', name: 'All' }, ...[...statusSet].sort().map((s) => ({ id: s, name: s }))];
    return { customers, productTypes, deliveryStatuses };
  }, [rawRows, campaignRef]);

  return {
    filters,
    updateFilter,
    batchUpdateFilters,
    fetchData,
    loading,
    error,
    filterOptions,
    campaigns,
    adSets,
    placements,
    days,
    ads,
    platforms,
    platformDevices,
    countries,
    products,
    shows,
    kpis,
  };
}
