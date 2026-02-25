import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

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

function computePreviousPeriod(fromStr, toStr) {
  if (!fromStr || !toStr) return { from: null, to: null };
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T00:00:00');
  const days = Math.round((to - from) / 86400000) + 1;
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days + 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}

function num(v) { return Number(v) || 0; }
function costFromMicros(v) { return num(v) / 1e6; }

function addMetrics(o) {
  o.ctr = o.impressions ? (o.clicks / o.impressions) * 100 : 0;
  o.cpc = o.clicks ? o.cost / o.clicks : 0;
  o.conv_rate = o.clicks ? (o.conversions / o.clicks) * 100 : 0;
  o.cpa = o.conversions ? o.cost / o.conversions : 0;
  return o;
}

export function useGoogleAdsData() {
  const [filters, setFilters] = useState({
    datePreset: 'all', dateFrom: '', dateTo: '',
    compareOn: false, compareFrom: '', compareTo: '',
    customerId: 'ALL', channelType: 'all', status: 'all',
    campaignSearch: '', adGroupSearch: '', keywordSearch: '',
  });

  const [rawCampaigns, setRawCampaigns] = useState([]);
  const [rawAdGroups, setRawAdGroups] = useState([]);
  const [rawKeywords, setRawKeywords] = useState([]);
  const [rawCompareCampaigns, setRawCompareCampaigns] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [channelTypes, setChannelTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const optionsLoaded = useRef(false);
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
      const { from, to } = computeDateRange(f.datePreset, f.dateFrom, f.dateTo);
      const hasCampaignFilters = f.customerId !== 'ALL' || f.channelType !== 'all' || f.status !== 'all' || f.campaignSearch;

      const buildCampaignQuery = (dateFrom, dateTo) => () => {
        let q = supabase.from('google_campaigns_data').select('*').order('segment_date', { ascending: false });
        if (dateFrom) q = q.gte('segment_date', dateFrom);
        if (dateTo) q = q.lte('segment_date', dateTo);
        if (f.customerId !== 'ALL') q = q.eq('customer_id', f.customerId);
        if (f.channelType !== 'all') q = q.eq('channel_type', f.channelType);
        if (f.status !== 'all') q = q.eq('campaign_status', f.status);
        if (f.campaignSearch) q = q.ilike('campaign_name', `%${f.campaignSearch}%`);
        return q;
      };

      let compFrom = null, compTo = null;
      if (f.compareOn) {
        if (f.compareFrom && f.compareTo) {
          compFrom = f.compareFrom;
          compTo = f.compareTo;
        } else {
          const prev = computePreviousPeriod(from, to);
          compFrom = prev.from;
          compTo = prev.to;
        }
      }

      const fetches = [
        fetchAllRows(buildCampaignQuery(from, to)),
        fetchAllRows(() => {
          let q = supabase.from('google_ad_groups_data').select('*').order('segment_date', { ascending: false });
          if (from) q = q.gte('segment_date', from);
          if (to) q = q.lte('segment_date', to);
          if (f.adGroupSearch) q = q.ilike('ad_group_name', `%${f.adGroupSearch}%`);
          return q;
        }),
        fetchAllRows(() => {
          let q = supabase.from('google_keywords_data').select('*').order('segment_date', { ascending: false });
          if (from) q = q.gte('segment_date', from);
          if (to) q = q.lte('segment_date', to);
          if (f.keywordSearch) q = q.ilike('keyword_text', `%${f.keywordSearch}%`);
          return q;
        }),
      ];

      if (f.compareOn && compFrom && compTo) {
        fetches.push(fetchAllRows(buildCampaignQuery(compFrom, compTo)));
      }

      const results = await Promise.all(fetches);
      const [campaignData, adGroupData, keywordData] = results;
      const compareCampaignData = results[3] || [];

      let filteredAdGroups = adGroupData;
      let filteredKeywords = keywordData;
      if (hasCampaignFilters) {
        const ids = new Set(campaignData.map((c) => String(c.campaign_id)));
        filteredAdGroups = adGroupData.filter((a) => ids.has(String(a.campaign_id)));
        filteredKeywords = keywordData.filter((k) => ids.has(String(k.campaign_id)));
      }

      setRawCampaigns(campaignData);
      setRawAdGroups(filteredAdGroups);
      setRawKeywords(filteredKeywords);
      setRawCompareCampaigns(f.compareOn ? compareCampaignData : []);

      if (!optionsLoaded.current && campaignData.length > 0) {
        const custMap = new Map();
        const types = new Set();
        campaignData.forEach((r) => {
          if (r.customer_id != null) custMap.set(String(r.customer_id), r.customer_name || String(r.customer_id));
          if (r.channel_type) types.add(r.channel_type);
        });
        setCustomers([...custMap.entries()].map(([id, name]) => ({ id, name })));
        setChannelTypes([...types].sort());
        optionsLoaded.current = true;
      }
    } catch (err) {
      console.error('Google Ads fetch error:', err);
      const msg = err.message || 'Failed to fetch data';
      setError(msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
        ? 'Cannot reach Supabase. Check your network connection or try a VPN/mobile hotspot.' : msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Aggregations ── */

  const kpis = useMemo(() => {
    if (!rawCampaigns.length) return null;
    const k = { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0, allConversions: 0, interactions: 0, phoneCalls: 0 };
    rawCampaigns.forEach((r) => {
      k.cost += costFromMicros(r.cost_micros);
      k.clicks += num(r.clicks);
      k.impressions += num(r.impressions);
      k.conversions += num(r.conversions);
      k.conversions_value += num(r.conversions_value);
      k.allConversions += num(r.all_conversions);
      k.interactions += num(r.interactions);
      k.phoneCalls += num(r.phone_calls);
    });
    k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
    k.cpc = k.clicks ? k.cost / k.clicks : 0;
    k.conv_rate = k.clicks ? (k.conversions / k.clicks) * 100 : 0;
    k.cpa = k.conversions ? k.cost / k.conversions : 0;
    k.roas = k.cost ? k.conversions_value / k.cost : 0;
    k.campaigns = new Set(rawCampaigns.map((r) => r.campaign_id)).size;
    return k;
  }, [rawCampaigns]);

  const campaignTypesAgg = useMemo(() => {
    const map = new Map();
    let totalCost = 0;
    rawCampaigns.forEach((r) => {
      const type = r.channel_type || 'Unknown';
      if (!map.has(type)) map.set(type, { type, campaign_ids: new Set(), cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      const a = map.get(type);
      a.campaign_ids.add(r.campaign_id);
      a.cost += costFromMicros(r.cost_micros);
      a.clicks += num(r.clicks); a.impressions += num(r.impressions); a.conversions += num(r.conversions);
      totalCost += costFromMicros(r.cost_micros);
    });
    return [...map.values()].map((o) => {
      o.campaign_count = o.campaign_ids.size; delete o.campaign_ids;
      o.spend_pct = totalCost ? (o.cost / totalCost) * 100 : 0;
      return addMetrics(o);
    }).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns]);

  const campaignsAgg = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const id = r.campaign_id;
      if (!map.has(id)) map.set(id, { campaign_id: id, campaign_name: r.campaign_name, campaign_status: r.campaign_status, channel_type: r.channel_type, customer_name: r.customer_name, location: r.location, cost: 0, clicks: 0, impressions: 0, conversions: 0, allConversions: 0 });
      const a = map.get(id);
      a.cost += costFromMicros(r.cost_micros); a.clicks += num(r.clicks); a.impressions += num(r.impressions); a.conversions += num(r.conversions); a.allConversions += num(r.all_conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns]);

  const adGroupsAgg = useMemo(() => {
    const campaignNameMap = new Map();
    rawCampaigns.forEach((r) => { if (r.campaign_id && r.campaign_name) campaignNameMap.set(String(r.campaign_id), r.campaign_name); });

    const map = new Map();
    rawAdGroups.forEach((r) => {
      const id = r.ad_group_id;
      if (!map.has(id)) map.set(id, {
        ad_group_id: id, ad_group_name: r.ad_group_name,
        campaign_name: r.campaign_name || campaignNameMap.get(String(r.campaign_id)) || '',
        campaign_id: r.campaign_id, ad_group_status: r.ad_group_status,
        cost: 0, clicks: 0, impressions: 0, conversions: 0,
      });
      const a = map.get(id);
      a.cost += costFromMicros(r.cost_micros); a.clicks += num(r.clicks); a.impressions += num(r.impressions); a.conversions += num(r.conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawAdGroups, rawCampaigns]);

  const keywordsAgg = useMemo(() => {
    const campaignNameMap = new Map();
    rawCampaigns.forEach((r) => { if (r.campaign_id && r.campaign_name) campaignNameMap.set(String(r.campaign_id), r.campaign_name); });

    const adGroupNameMap = new Map();
    rawAdGroups.forEach((r) => { if (r.ad_group_id && r.ad_group_name) adGroupNameMap.set(String(r.ad_group_id), r.ad_group_name); });

    const map = new Map();
    rawKeywords.forEach((r) => {
      const id = `${r.ad_group_id}_${r.criterion_id}`;
      if (!map.has(id)) map.set(id, {
        _key: id, criterion_id: r.criterion_id, keyword_text: r.keyword_text,
        keyword_match_type: r.keyword_match_type, criterion_status: r.criterion_status,
        campaign_id: r.campaign_id, ad_group_id: r.ad_group_id,
        campaign_name: campaignNameMap.get(String(r.campaign_id)) || '',
        ad_group_name: adGroupNameMap.get(String(r.ad_group_id)) || '',
        cost: 0, clicks: 0, impressions: 0, conversions: 0,
      });
      const a = map.get(id);
      a.cost += costFromMicros(r.cost_micros); a.clicks += num(r.clicks); a.impressions += num(r.impressions); a.conversions += num(r.conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawKeywords, rawCampaigns, rawAdGroups]);

  const geoAgg = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const loc = r.location || 'Unknown';
      if (!map.has(loc)) map.set(loc, { location: loc, cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      const a = map.get(loc);
      a.cost += costFromMicros(r.cost_micros); a.clicks += num(r.clicks); a.impressions += num(r.impressions); a.conversions += num(r.conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => b.cost - a.cost);
  }, [rawCampaigns]);

  const conversionsAgg = useMemo(() => {
    return campaignsAgg.filter((c) => c.conversions > 0 || c.allConversions > 0).sort((a, b) => b.conversions - a.conversions);
  }, [campaignsAgg]);

  const dailyTrends = useMemo(() => {
    const map = new Map();
    rawCampaigns.forEach((r) => {
      const d = r.segment_date; if (!d) return;
      if (!map.has(d)) map.set(d, { date: d, cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      const a = map.get(d);
      a.cost += costFromMicros(r.cost_micros); a.clicks += num(r.clicks); a.impressions += num(r.impressions); a.conversions += num(r.conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => a.date.localeCompare(b.date));
  }, [rawCampaigns]);

  const compareKpis = useMemo(() => {
    if (!rawCompareCampaigns.length) return null;
    const k = { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0, allConversions: 0, interactions: 0, phoneCalls: 0 };
    rawCompareCampaigns.forEach((r) => {
      k.cost += costFromMicros(r.cost_micros);
      k.clicks += num(r.clicks);
      k.impressions += num(r.impressions);
      k.conversions += num(r.conversions);
      k.conversions_value += num(r.conversions_value);
      k.allConversions += num(r.all_conversions);
      k.interactions += num(r.interactions);
      k.phoneCalls += num(r.phone_calls);
    });
    k.ctr = k.impressions ? (k.clicks / k.impressions) * 100 : 0;
    k.cpc = k.clicks ? k.cost / k.clicks : 0;
    k.conv_rate = k.clicks ? (k.conversions / k.clicks) * 100 : 0;
    k.cpa = k.conversions ? k.cost / k.conversions : 0;
    k.roas = k.cost ? k.conversions_value / k.cost : 0;
    k.campaigns = new Set(rawCompareCampaigns.map((r) => r.campaign_id)).size;
    return k;
  }, [rawCompareCampaigns]);

  const compareDailyTrends = useMemo(() => {
    if (!rawCompareCampaigns.length) return [];
    const map = new Map();
    rawCompareCampaigns.forEach((r) => {
      const d = r.segment_date; if (!d) return;
      if (!map.has(d)) map.set(d, { date: d, cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      const a = map.get(d);
      a.cost += costFromMicros(r.cost_micros); a.clicks += num(r.clicks); a.impressions += num(r.impressions); a.conversions += num(r.conversions);
    });
    return [...map.values()].map(addMetrics).sort((a, b) => a.date.localeCompare(b.date));
  }, [rawCompareCampaigns]);

  return {
    filters, updateFilter, batchUpdateFilters, fetchData,
    loading, error, customers, channelTypes,
    kpis, compareKpis, campaignTypes: campaignTypesAgg, campaigns: campaignsAgg,
    adGroups: adGroupsAgg, keywords: keywordsAgg,
    geoData: geoAgg, conversionsData: conversionsAgg, dailyTrends, compareDailyTrends,
    rowCounts: { campaigns: rawCampaigns.length, adGroups: rawAdGroups.length, keywords: rawKeywords.length },
  };
}
