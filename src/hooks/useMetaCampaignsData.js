import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

/** * OPTIMIZATION 1: Concurrent Pagination
 * Asks DB for total count, then fires all page requests simultaneously.
 * Passes columns and options back into the factory so .select() is called FIRST.
 */
async function fetchAllRowsConcurrently(queryFactory, columns = '*') {
  // 1. Ask DB exactly how many rows exist (head: true means don't return rows, just the count)
  const { count, error: countError } = await queryFactory(columns, { count: 'exact', head: true });
  if (countError) throw countError;
  if (!count || count === 0) return [];

  // 2. Generate all page requests in parallel
  const pages = Math.ceil(count / PAGE_SIZE);
  const promises = [];
  for (let i = 0; i < pages; i++) {
    const offset = i * PAGE_SIZE;
    promises.push(
      queryFactory(columns, {}).range(offset, offset + PAGE_SIZE - 1)
    );
  }

  // 3. Resolve all network requests at the exact same time
  const responses = await Promise.all(promises);
  return responses.flatMap(res => {
    if (res.error) throw res.error;
    return res.data || [];
  });
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

function toDayKey(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.length >= 10 && v[4] === '-' && v[7] === '-') return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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

const DATE_COL = 'day';

/**
 * facebook_campaigns_reference_data field mapping.
 * Common key with facebook_campaigns_data: campaign_name (used to fetch Country, Product, Shows).
 */
const CAMPAIGN_REFERENCE_FIELDS = 'id,campaign_id,campaign_name,country,product_type,showname';

/** Normalize campaign name for matching: trim, lowercase, collapse multiple spaces (reference vs performance may differ slightly). */
function normalizeCampaignKey(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
  return o;
}

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
    datePreset: 'this_month', dateFrom: '', dateTo: '',
    compareOn: false, compareFrom: '', compareTo: '',
    customerId: 'ALL', productType: 'all', deliveryStatus: 'all',
    campaignSearch: '', adGroupSearch: '', keywordSearch: '',
  });

  const [rawRows, setRawRows] = useState([]);
  const [dateRange, setDateRange] = useState({ from: null, to: null });
  
  // OPTIMIZATION 3: Cache reference data so we don't re-download it on every filter/date change
  const [campaignRef, setCampaignRef] = useState(null);
  const [adsetRef, setAdsetRef] = useState(null);
  
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

      // Accept columns and options so .select() executes before .gte()
      const buildDataQuery = (columns = '*', options = {}) => {
        let q = supabase
          .from('facebook_campaigns_data')
          .select(columns, options) // <--- Fix: .select() must be called before filters
          .gte(DATE_COL, from)
          .lte(DATE_COL, to);

        // Don't order if we are just doing a HEAD request for the count
        if (!options.head) {
          q = q.order(DATE_COL, { ascending: false });
        }

        if (f.customerId !== 'ALL') q = q.eq('account_id', f.customerId);
        if (f.deliveryStatus !== 'all') q = q.eq('delivery_status', f.deliveryStatus);
        if ((f.campaignSearch || '').trim()) q = q.ilike('campaign_name', `%${f.campaignSearch.trim()}%`);
        if ((f.adGroupSearch || '').trim()) q = q.ilike('adset_name', `%${f.adGroupSearch.trim()}%`);
        if ((f.keywordSearch || '').trim()) q = q.ilike('ad_name', `%${f.keywordSearch.trim()}%`);
        
        return q;
      };

      /** * OPTIMIZATION 2: Column Whitelisting
       * Prevents transferring bloated JSON configuration payloads native to Facebook APIs 
       */
      const DATA_COLUMNS = 'account_id, delivery_status, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, placement, day, platform, device_platform, impressions, reach, clicks_all, amount_spent_usd, purchases, meta_purchases, purchases_value, inapp_purchases_value, direct_website_purchases_value';

      const fetches = [
        fetchAllRowsConcurrently(buildDataQuery, DATA_COLUMNS)
      ];
      
      // Update reference fetchers to accept the new (columns, options) pattern
      if (!campaignRef) {
        fetches.push(fetchAllRowsConcurrently(
          (cols = '*', opts = {}) => supabase.from('facebook_campaigns_reference_data').select(cols, opts),
          CAMPAIGN_REFERENCE_FIELDS
        ));
      }
      if (!adsetRef) {
        fetches.push(fetchAllRowsConcurrently(
          (cols = '*', opts = {}) => supabase.from('facebook_adset_reference_data').select(cols, opts), 
          'adset_name,country,product_type'
        ));
      }

      const results = await Promise.all(fetches);
      const dataRows = results[0];
      
      if (!campaignRef && results[1]) setCampaignRef(results[1]);
      if (!adsetRef && results[2]) setAdsetRef(results[2]);

      const normalized = [];
      for (let i = 0; i < dataRows.length; i++) normalized.push(normalizeRow(dataRows[i]));
      setRawRows(normalized);
      
    } catch (err) {
      console.error('Meta fetch error:', err);
      const msg = err.message || 'Failed to fetch data';
      setError(msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
        ? 'Cannot reach Supabase. Check your network connection.' : msg);
    } finally {
      setLoading(false);
    }
  }, [campaignRef, adsetRef]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /**
   * Map from facebook_campaigns_reference_data keyed only by campaign_name (common key with facebook_campaigns_data).
   * Used to fetch Country, Product, and Shows by matching campaign_name between the two tables.
   */
  const campaignRefMap = useMemo(() => {
    const m = new Map();
    const arr = campaignRef || [];
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i];
      const nameKey = (r.campaign_name || '').trim();
      const normKey = normalizeCampaignKey(r.campaign_name);
      const refVal = {
        id: r.id,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        country: r.country ?? '',
        product_type: r.product_type ?? '',
        showname: (() => {
          const v = r.showname ?? r.show_name ?? '';
          return (v != null && String(v).trim() !== '') ? String(v).trim() : '';
        })(),
      };
      if (nameKey && !m.has(nameKey)) m.set(nameKey, refVal);
      if (normKey && !m.has(normKey)) m.set(normKey, refVal);
    }
    return m;
  }, [campaignRef]);

  /** OPTIMIZATION 4: Local filter only runs on Product Type; ref lookup by campaign_name (common key). */
  const filteredRows = useMemo(() => {
    if (filters.productType === 'all') return rawRows; 

    const out = [];
    const getRefByCampaignName = (campaignName) => {
      const nameKey = (campaignName || '').trim();
      const normKey = normalizeCampaignKey(campaignName);
      return (nameKey ? campaignRefMap.get(nameKey) : null) || (normKey ? campaignRefMap.get(normKey) : null);
    };
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const ref = getRefByCampaignName(r.campaign_name);
      const pt = (ref && ref.product_type) ? ref.product_type : '';
      if (pt === filters.productType) out.push(r);
    }
    return out;
  }, [rawRows, campaignRefMap, filters.productType]);

  /** Lookup reference by campaign_name only (common key between facebook_campaigns_data and facebook_campaigns_reference_data for Country, Product, Shows). */
  const getRef = useCallback((rowOrCampaignName) => {
    const campaignName = typeof rowOrCampaignName === 'string' ? rowOrCampaignName : (rowOrCampaignName && rowOrCampaignName.campaign_name);
    const nameKey = (campaignName || '').trim();
    const normKey = normalizeCampaignKey(campaignName);
    return (nameKey ? campaignRefMap.get(nameKey) : null) || (normKey ? campaignRefMap.get(normKey) : null);
  }, [campaignRefMap]);

  /** * OPTIMIZATION 5: Splitting Aggregations
   * Instead of one massive CPU-blocking function, split them into isolated useMemo blocks
   */
  const campaigns = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const cid = r.campaign_id != null ? String(r.campaign_id) : 'Undefined';
      const ref = getRef(r);
      const name = (ref && ref.campaign_name) ? ref.campaign_name : (r.campaign_name || cid);
      if (!map.has(cid)) map.set(cid, { key: cid, name, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(cid);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows, getRef]);

  const adSets = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const asid = r.adset_id != null ? String(r.adset_id) : (r.adset_name || 'Undefined');
      const asName = r.adset_name || asid;
      if (!map.has(asid)) map.set(asid, { key: asid, name: asName, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(asid);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows]);

  const placements = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const pkey = r.placement != null && r.placement !== '' ? String(r.placement) : 'Undefined';
      if (!map.has(pkey)) map.set(pkey, { key: pkey, name: pkey, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(pkey);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows]);

  const ads = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const adid = r.ad_id != null ? String(r.ad_id) : (r.ad_name || 'Undefined');
      const adName = r.ad_name || adid;
      if (!map.has(adid)) map.set(adid, { key: adid, name: adName, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(adid);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows]);

  const platforms = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const pplat = r.platform != null && r.platform !== '' ? String(r.platform) : 'Undefined';
      if (!map.has(pplat)) map.set(pplat, { key: pplat, name: pplat, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(pplat);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows]);

  const platformDevices = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const dev = r.device_platform != null && r.device_platform !== '' ? String(r.device_platform) : 'Undefined';
      if (!map.has(dev)) map.set(dev, { key: dev, name: dev, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(dev);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows]);

  /** Country aggregation: same logic as Reddit — reference by campaign_name, fallback "Unknown". */
  const countries = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const ref = getRef(r.campaign_name);
      const country = (ref && ref.country) ? ref.country : 'Unknown';
      if (!map.has(country)) map.set(country, { key: country, name: country, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(country);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows, getRef]);

  /** Product aggregation: same logic as Reddit — reference by campaign_name, fallback "Unknown". */
  const products = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const ref = getRef(r.campaign_name);
      const product = (ref && ref.product_type) ? ref.product_type : 'Unknown';
      if (!map.has(product)) map.set(product, { key: product, name: product, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(product);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows, getRef]);

  /** Shows aggregation: same logic as Reddit — reference by campaign_name, fallback "Unknown". */
  const shows = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const ref = getRef(r.campaign_name);
      const show = (ref && ref.showname) ? ref.showname : 'Unknown';
      if (!map.has(show)) map.set(show, { key: show, name: show, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 });
      const a = map.get(show);
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.cost += r.cost; a.purchases += r.purchases; a.revenue += r.revenue;
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [filteredRows, getRef]);

  const days = useMemo(() => {
    const dayMap = new Map();
    filteredRows.forEach(r => {
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
    const out = allDays.map(d => dayMap.get(d) || { key: d, name: d, impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0, ctr: 0, cpc: 0, cpm: 0 });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredRows, dateRange]);

  const kpis = useMemo(() => {
    if (!campaigns.length) return null;
    const k = { impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 };
    campaigns.forEach(c => {
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
    return { 
      customers: [{ id: 'ALL', name: 'All Customers' }, ...[...accountSet].sort().map((id) => ({ id, name: id }))], 
      productTypes: [{ id: 'all', name: 'All Types' }, ...[...typeSet].sort().map((t) => ({ id: t, name: t }))], 
      deliveryStatuses: [{ id: 'all', name: 'All' }, ...[...statusSet].sort().map((s) => ({ id: s, name: s }))] 
    };
  }, [rawRows, campaignRef]);

  return {
    filters, updateFilter, batchUpdateFilters, fetchData, loading, error, filterOptions,
    campaigns, adSets, placements, days, ads, platforms, platformDevices, countries, products, shows, kpis,
  };
}