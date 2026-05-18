import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { DateRangePicker } from '../components/DatePicker';
import { supabase } from '../lib/supabase';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';
const KPI_CATALOG = [
  { key: 'cost', label: 'Total Spend', icon: '💰', fmt: fU, category: 'General Performance' },
  { key: 'impressions', label: 'Impressions', icon: '👁', fmt: fI, category: 'General Performance' },
  { key: 'clicks', label: 'Clicks', icon: '👆', fmt: fI, category: 'General Performance' },
  { key: 'ctr', label: 'CTR', icon: '📊', fmt: fP, category: 'General Performance' },
  { key: 'cpc', label: 'Avg CPC', icon: '💵', fmt: fU, category: 'General Performance' },
  { key: 'cpm', label: 'CPM', icon: '💳', fmt: fU, category: 'General Performance' },
  { key: 'conversions', label: 'Conversions', icon: '🎯', fmt: fI, category: 'Conversions' },
  { key: 'convRate', label: 'Conv. Rate', icon: '📈', fmt: fP, category: 'Conversions' },
  { key: 'cpa', label: 'CPA', icon: '🏷', fmt: fU, category: 'Conversions' },
];
const KPI_DEFAULTS = ['cost', 'impressions', 'clicks', 'conversions', 'convRate', 'cpa'];
const CHART_METRICS = [
  { key: 'cost', label: 'Cost', fmt: fU, color: '#ED1C24' },
  { key: 'impressions', label: 'Impressions', fmt: fI, color: '#2E9E40' },
  { key: 'clicks', label: 'Clicks', fmt: fI, color: '#F5A623' },
  { key: 'ctr', label: 'CTR', fmt: fP, color: '#8b5cf6' },
  { key: 'cpc', label: 'CPC', fmt: fU, color: '#3b82f6' },
  { key: 'conversions', label: 'Conv.', fmt: fI, color: '#ec4899' },
  { key: 'convRate', label: 'Conv. Rate', fmt: fP, color: '#14b8a6' },
  { key: 'cpa', label: 'CPA', fmt: fU, color: '#f97316' },
];

const TABS = [
  { id: 'campaign-types', label: 'Campaign Types' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'ad-groups', label: 'Ad Groups' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'country', label: 'Country' },
  { id: 'product', label: 'Product' },
  { id: 'titles', label: 'Titles' },
  { id: 'day', label: 'Day' },
];

function fmtLocal(d) {
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
    case 'last_month': return { from: fmtLocal(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: fmtLocal(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case 'custom': return { from: customFrom || null, to: customTo || null };
    default: return { from: null, to: null };
  }
}

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function normalizeKeyPart(v) {
  return (v || '').toString().trim().toLowerCase();
}
function makeAdGroupLinkKey(campaignName, adGroupName, adGroupId) {
  if (adGroupId !== undefined && adGroupId !== null && String(adGroupId).trim()) return `id:${String(adGroupId).trim()}`;
  return `name:${normalizeKeyPart(campaignName)}|||${normalizeKeyPart(adGroupName)}`;
}
function toDayKey(v) {
  if (!v) return '';
  if (typeof v === 'string' && v.length >= 10 && v[4] === '-' && v[7] === '-') return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return fmtLocal(d);
}
function formatDayDisplay(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return dateStr || '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${String(d).padStart(2, '0')}, ${y}`;
}

async function fetchAllRows(queryFactory) {
  const out = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFactory().range(offset, offset + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

function addMetrics(r) {
  const ctr = r.impressions ? (r.clicks / r.impressions) * 100 : 0;
  const cpc = r.clicks ? r.cost / r.clicks : 0;
  const cpm = r.impressions ? (r.cost / r.impressions) * 1000 : 0;
  const convRate = r.clicks ? (r.conversions / r.clicks) * 100 : 0;
  const cpa = r.conversions ? r.cost / r.conversions : 0;
  return { ...r, ctr, cpc, cpm, convRate, cpa };
}

const statusBadge = (s) => (s === 'ENABLED' ? 'badge-green' : s === 'PAUSED' ? 'badge-yellow' : 'badge-red');
const statusLabel = (s) => (s === 'ENABLED' ? 'Enabled' : s === 'PAUSED' ? 'Paused' : s || 'Unknown');

export function GoogleAdsCountryPage() {
  const [filters, setFilters] = useState({
    datePreset: 'this_month',
    dateFrom: '',
    dateTo: '',
    channelType: 'all',
    status: 'all',
    campaignSearch: '',
    adGroupSearch: '',
    keywordSearch: '',
  });
  const [activeTab, setActiveTab] = useState('campaign-types');
  const [keywordMatchFilter, setKeywordMatchFilter] = useState('all');
  const [expandedCampaigns, setExpandedCampaigns] = useState({});
  const [expandedAdGroups, setExpandedAdGroups] = useState({});
  const [campaignRows, setCampaignRows] = useState([]);
  const [adGroupRows, setAdGroupRows] = useState([]);
  const [keywordRows, setKeywordRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [daily, setDaily] = useState([]);
  const [kpiSelected, setKpiSelected] = useState(() => {
    try {
      const saved = localStorage.getItem('google_country_kpi_selection');
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length === 6) return arr;
      }
    } catch {}
    return KPI_DEFAULTS.slice();
  });
  const [kpiDropdownOpen, setKpiDropdownOpen] = useState(-1);
  const [kpiSearchTerm, setKpiSearchTerm] = useState('');
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartActiveMetrics, setChartActiveMetrics] = useState(['cost', 'clicks', 'conversions']);
  const chartRef = useRef(null);
  const chartInst = useRef(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const f = filtersRef.current;
      const { from, to } = computeDateRange(f.datePreset, f.dateFrom, f.dateTo);
      const [campaignRaw, adGroupRaw, keywordRaw, refRows] = await Promise.all([
        fetchAllRows(() => {
          let q = supabase.from('google_campaigns_data_country').select('*');
          if (from) q = q.gte('segment_date', from);
          if (to) q = q.lte('segment_date', to);
          if (f.channelType !== 'all') q = q.eq('channel_type', f.channelType);
          if (f.status !== 'all') q = q.eq('campaign_status', f.status);
          if (f.campaignSearch) q = q.ilike('campaign_name', `%${f.campaignSearch}%`);
          return q;
        }),
        fetchAllRows(() => {
          let q = supabase.from('google_ad_groups_data_country').select('*');
          if (from) q = q.gte('segment_date', from);
          if (to) q = q.lte('segment_date', to);
          if (f.campaignSearch) q = q.ilike('campaign_name', `%${f.campaignSearch}%`);
          if (f.adGroupSearch) q = q.ilike('ad_group_name', `%${f.adGroupSearch}%`);
          return q;
        }),
        fetchAllRows(() => {
          let q = supabase.from('google_keywords_data_country').select('*');
          if (from) q = q.gte('segment_date', from);
          if (to) q = q.lte('segment_date', to);
          if (f.campaignSearch) q = q.ilike('campaign_name', `%${f.campaignSearch}%`);
          if (f.adGroupSearch) q = q.ilike('ad_group_name', `%${f.adGroupSearch}%`);
          if (f.keywordSearch) q = q.ilike('keyword_text', `%${f.keywordSearch}%`);
          return q;
        }),
        fetchAllRows(() => supabase.from('google_campaigns_reference_data').select('campaign_name, country, product_type, showname')).catch(() => []),
      ]);

      const refMap = new Map();
      for (const r of refRows || []) {
        const key = (r.campaign_name || '').trim();
        if (!key || refMap.has(key)) continue;
        refMap.set(key, {
          country: r.country || '',
          productType: r.product_type || '',
          showName: r.showname || '',
        });
      }
      setCampaignRows(campaignRaw.map((r) => {
        const ref = refMap.get((r.campaign_name || '').trim());
        return ({
        campaignType: r.channel_type || 'Unknown',
        campaignName: r.campaign_name || 'Unknown',
        campaignStatus: r.campaign_status || 'Unknown',
        adGroupName: r.ad_group_name || 'Unknown',
        keywordText: r.keyword_text || 'Unknown',
        country: r.country || ref?.country || 'Unknown',
        product: ref?.productType || 'Undefined',
        title: ref?.showName || 'Undefined',
        day: toDayKey(r.segment_date),
        campaignId: r.campaign_id,
        cost: toNum(r.cost_micros) / 1000000,
        impressions: toNum(r.impressions),
        clicks: toNum(r.clicks),
        conversions: toNum(r.conversions),
      });
      }));

      setAdGroupRows(adGroupRaw.map((r) => {
        const ref = refMap.get((r.campaign_name || '').trim());
        return ({
        campaignType: r.channel_type || 'Unknown',
        campaignName: r.campaign_name || 'Unknown',
        campaignStatus: r.ad_group_status || r.campaign_status || 'Unknown',
        adGroupName: r.ad_group_name || 'Unknown',
        keywordText: '',
        country: r.country || ref?.country || 'Unknown',
        product: ref?.productType || 'Undefined',
        title: ref?.showName || 'Undefined',
        day: toDayKey(r.segment_date),
        campaignId: r.campaign_id,
        adGroupId: r.ad_group_id,
        cost: toNum(r.cost_micros) / 1000000,
        impressions: toNum(r.impressions),
        clicks: toNum(r.clicks),
        conversions: toNum(r.conversions),
      });
      }));

      setKeywordRows(keywordRaw.map((r) => {
        const ref = refMap.get((r.campaign_name || '').trim());
        return ({
        campaignType: '',
        campaignName: r.campaign_name || 'Unknown',
        campaignStatus: '',
        adGroupName: r.ad_group_name || 'Unknown',
        keywordText: r.keyword_text || 'Unknown',
        keywordMatchType: r.keyword_match_type || 'Unknown',
        country: r.country || ref?.country || 'Unknown',
        product: ref?.productType || 'Undefined',
        title: ref?.showName || 'Undefined',
        day: toDayKey(r.segment_date),
        campaignId: r.campaign_id,
        adGroupId: r.ad_group_id,
        cost: toNum(r.cost_micros) / 1000000,
        impressions: toNum(r.impressions),
        clicks: toNum(r.clicks),
        conversions: toNum(r.conversions),
      });
      }));
    } catch (e) {
      setCampaignRows([]);
      setAdGroupRows([]);
      setKeywordRows([]);
      setError(e?.message || 'Failed to fetch Google country data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData, filters.datePreset, filters.dateFrom, filters.dateTo]);

  const chartSeries = useMemo(() => {
    const m = new Map();
    for (const r of campaignRows) {
      if (!r.day) continue;
      if (!m.has(r.day)) m.set(r.day, { day: r.day, cost: 0, impressions: 0, clicks: 0, conversions: 0 });
      const d = m.get(r.day);
      d.cost += r.cost;
      d.impressions += r.impressions;
      d.clicks += r.clicks;
      d.conversions += r.conversions;
    }
    return [...m.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => addMetrics(d));
  }, [campaignRows]);

  useEffect(() => {
    if (chartInst.current) {
      chartInst.current.destroy();
      chartInst.current = null;
    }
    if (chartCollapsed || !chartRef.current || !chartSeries.length) return;
    const datasets = CHART_METRICS
      .filter((metric) => chartActiveMetrics.includes(metric.key))
      .map((metric) => ({
        label: metric.label,
        data: chartSeries.map((d) => d[metric.key] || 0),
        borderColor: metric.color,
        backgroundColor: metric.color,
        pointBackgroundColor: metric.color,
        pointBorderColor: metric.color,
        tension: 0.35,
      }));
    if (!datasets.length) return;
    chartInst.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: chartSeries.map((d) => `${Number(d.day.split('-')[1])}/${Number(d.day.split('-')[2])}`),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
        },
      },
    });
  }, [chartSeries, chartActiveMetrics, chartCollapsed]);

  const groupedByTab = useMemo(() => {
    const keyMap = {
      'campaign-types': 'campaignType',
      campaigns: 'campaignName',
      'ad-groups': 'adGroupName',
      keywords: 'keywordText',
      country: 'country',
      product: 'product',
      titles: 'title',
      day: 'day',
    };
    const result = {};
    const sourceByTab = {
      'campaign-types': campaignRows,
      campaigns: campaignRows,
      'ad-groups': adGroupRows,
      keywords: keywordRows,
      country: campaignRows,
      product: campaignRows,
      titles: campaignRows,
      day: campaignRows,
    };
    Object.entries(keyMap).forEach(([tabId, key]) => {
      const sourceRows = sourceByTab[tabId] || campaignRows;
      const m = new Map();
      for (const r of sourceRows) {
        const rawName = (r[key] || 'Unknown').toString();
        const rowKey = tabId === 'ad-groups'
          ? makeAdGroupLinkKey(r.campaignName || 'Unknown', rawName, r.adGroupId)
          : rawName;
        if (!m.has(rowKey)) {
          m.set(rowKey, {
            rowKey,
            name: rawName,
            cost: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            campaignIds: new Set(),
            sampleType: r.campaignType,
            sampleStatus: r.campaignStatus,
            sampleCampaign: r.campaignName,
            sampleMatchType: r.keywordMatchType,
          });
        }
        const a = m.get(rowKey);
        a.cost += r.cost;
        a.impressions += r.impressions;
        a.clicks += r.clicks;
        a.conversions += r.conversions;
        if (r.campaignId) a.campaignIds.add(String(r.campaignId));
      }
      const out = [...m.values()].map((r) => {
        const withMetrics = addMetrics(r);
        return { ...withMetrics, campaignCount: r.campaignIds.size };
      });
      const sorted = tabId === 'day'
        ? out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
        : out.sort((a, b) => b.cost - a.cost);
      const totalCost = sorted.reduce((s, r) => s + r.cost, 0);
      result[tabId] = sorted.map((r) => ({ ...r, spendPct: totalCost ? (r.cost / totalCost) * 100 : 0 }));
    });
    return result;
  }, [adGroupRows, campaignRows, keywordRows]);

  const groupedRows = groupedByTab[activeTab] || [];
  const keywordMatchTypes = useMemo(() => {
    const preferred = ['BROAD', 'PHRASE', 'EXACT'];
    const dynamic = [...new Set(keywordRows.map((r) => (r.keywordMatchType || '').toString().trim().toUpperCase()).filter(Boolean))];
    const merged = [...preferred, ...dynamic.filter((t) => !preferred.includes(t))];
    return merged;
  }, [keywordRows]);
  const filteredGroupedRows = useMemo(() => {
    if (activeTab !== 'keywords' || keywordMatchFilter === 'all') return groupedRows;
    return groupedRows.filter((r) => (r.sampleMatchType || '').toString().trim().toUpperCase() === keywordMatchFilter);
  }, [activeTab, groupedRows, keywordMatchFilter]);
  const activeColumnCount = useMemo(() => {
    let count = 9;
    if (activeTab === 'campaign-types') count += 2;
    if (activeTab === 'campaigns') count += 2;
    if (activeTab === 'ad-groups') count += 2;
    if (activeTab === 'keywords') count += 2;
    return count;
  }, [activeTab]);

  const campaignSubRowsMap = useMemo(() => {
    const m = new Map();
    if (activeTab !== 'campaigns') return m;
    for (const r of adGroupRows) {
      const key = (r.campaignName || 'Unknown').toString();
      if (!m.has(key)) m.set(key, new Map());
      const sub = m.get(key);
      const adg = (r.adGroupName || 'Unknown').toString();
      if (!sub.has(adg)) sub.set(adg, { name: adg, cost: 0, impressions: 0, clicks: 0, conversions: 0 });
      const s = sub.get(adg);
      s.cost += r.cost;
      s.impressions += r.impressions;
      s.clicks += r.clicks;
      s.conversions += r.conversions;
    }
    for (const [k, sub] of m.entries()) {
      m.set(k, [...sub.values()].map((r) => addMetrics(r)).sort((a, b) => b.cost - a.cost));
    }
    return m;
  }, [activeTab, adGroupRows]);

  const adGroupKeywordRowsMap = useMemo(() => {
    const m = new Map();
    for (const r of keywordRows) {
      const rowKey = makeAdGroupLinkKey(r.campaignName || 'Unknown', r.adGroupName || 'Unknown', r.adGroupId);
      if (!m.has(rowKey)) m.set(rowKey, new Map());
      const kws = m.get(rowKey);
      const kwKey = `${(r.keywordText || 'Unknown').toString()}|||${(r.keywordMatchType || 'Unknown').toString()}`;
      if (!kws.has(kwKey)) {
        kws.set(kwKey, {
          name: (r.keywordText || 'Unknown').toString(),
          sampleMatchType: (r.keywordMatchType || 'Unknown').toString(),
          cost: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
        });
      }
      const kw = kws.get(kwKey);
      kw.cost += r.cost;
      kw.impressions += r.impressions;
      kw.clicks += r.clicks;
      kw.conversions += r.conversions;
    }
    for (const [k, kws] of m.entries()) {
      m.set(k, [...kws.values()].map((r) => addMetrics(r)).sort((a, b) => b.cost - a.cost));
    }
    return m;
  }, [keywordRows]);

  const totals = useMemo(() => {
    const t = filteredGroupedRows.reduce((acc, r) => ({ ...acc, cost: acc.cost + r.cost, impressions: acc.impressions + r.impressions, clicks: acc.clicks + r.clicks, conversions: acc.conversions + r.conversions, campaignCount: acc.campaignCount + (r.campaignCount || 0) }), { cost: 0, impressions: 0, clicks: 0, conversions: 0, campaignCount: 0 });
    return addMetrics(t);
  }, [filteredGroupedRows]);

  const channelTypes = useMemo(() => [...new Set(campaignRows.map((r) => r.campaignType).filter(Boolean))].sort(), [campaignRows]);
  const chartTotals = useMemo(() => {
    return chartSeries.reduce((acc, d) => {
      CHART_METRICS.forEach((metric) => {
        acc[metric.key] = (acc[metric.key] || 0) + (d[metric.key] || 0);
      });
      return acc;
    }, {});
  }, [chartSeries]);

  const handleKpiToggleDD = useCallback((idx) => {
    setKpiDropdownOpen((prev) => (prev === idx ? -1 : idx));
    setKpiSearchTerm('');
  }, []);

  const handleKpiSelect = useCallback((slotIdx, newKey) => {
    setKpiSelected((prev) => {
      const next = prev.slice();
      const existingIdx = next.indexOf(newKey);
      if (existingIdx >= 0 && existingIdx !== slotIdx) next[existingIdx] = next[slotIdx];
      next[slotIdx] = newKey;
      try { localStorage.setItem('google_country_kpi_selection', JSON.stringify(next)); } catch {}
      return next;
    });
    setKpiDropdownOpen(-1);
  }, []);

  useEffect(() => {
    const handleClickOutsideKpi = (e) => {
      if (kpiDropdownOpen >= 0 && !e.target.closest('.rkpi-card')) setKpiDropdownOpen(-1);
    };
    document.addEventListener('click', handleClickOutsideKpi);
    return () => document.removeEventListener('click', handleClickOutsideKpi);
  }, [kpiDropdownOpen]);

  const toggleChartMetric = useCallback((key) => {
    setChartActiveMetrics((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev;
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  }, []);
  const handleCSV = useCallback(() => {
    const baseHeaders = ['Dimension', 'Cost', 'Impressions', 'Clicks', 'CTR', 'Avg CPC', 'CPM', 'Conv.', 'Conv. Rate', 'CPA'];
    const headers = [...baseHeaders];
    if (activeTab === 'campaign-types') headers.splice(1, 0, '# Campaigns');
    if (activeTab === 'campaign-types') headers.push('% Spend');
    if (activeTab === 'campaigns') headers.splice(1, 0, 'Type', 'Status');
    if (activeTab === 'ad-groups') headers.splice(1, 0, 'Ad Group', 'Status');
    if (activeTab === 'keywords') headers.splice(1, 0, 'Campaign', 'Match Type');

    const rows = filteredGroupedRows.map((r) => {
      const cols = [];
      cols.push(activeTab === 'day' ? formatDayDisplay(r.name) : (r.name || ''));
      if (activeTab === 'campaign-types') cols.push(String(r.campaignCount || 0));
      if (activeTab === 'campaigns') cols.push(r.sampleType || '', statusLabel(r.sampleStatus));
      if (activeTab === 'ad-groups') cols.push(r.name || '', statusLabel(r.sampleStatus));
      if (activeTab === 'keywords') cols.push(r.sampleCampaign || '', r.sampleMatchType || '');
      cols.push(
        fU(r.cost),
        fI(r.impressions),
        fI(r.clicks),
        fP(r.ctr),
        fU(r.cpc),
        fU(r.cpm),
        fI(r.conversions),
        fP(r.convRate),
        fU(r.cpa),
      );
      if (activeTab === 'campaign-types') cols.push(fP(r.spendPct));
      return cols;
    });

    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `google-ads-country-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeTab, filteredGroupedRows]);

  return (
    <div className="page-section active" id="page-google-ads-country">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div><h2>Google Ads</h2><p>Country sync data from dedicated Google country tables</p></div>
          <DateRangePicker
            preset={filters.datePreset}
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            compareOn={false}
            compareFrom=""
            compareTo=""
            onApply={({ preset, dateFrom, dateTo }) => setFilters((prev) => ({ ...prev, datePreset: preset, dateFrom: dateFrom || '', dateTo: dateTo || '' }))}
          />
        </div>

        <div className="gads-filter-bar">
          <div className="gads-filter-row">
            <div className="gads-filter-group gads-fg-sm"><label>Type</label><select value={filters.channelType} onChange={(e) => setFilters((p) => ({ ...p, channelType: e.target.value }))}><option value="all">All Types</option>{channelTypes.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="gads-filter-group gads-fg-sm"><label>Status</label><select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}><option value="all">All</option><option value="ENABLED">Enabled</option><option value="PAUSED">Paused</option><option value="REMOVED">Removed</option></select></div>
            <div className="gads-filter-group gads-fg-sm"><label>Campaign</label><input type="text" className="gads-search-input" value={filters.campaignSearch} onChange={(e) => setFilters((p) => ({ ...p, campaignSearch: e.target.value }))} placeholder="Search campaigns..." /></div>
            <div className="gads-filter-group gads-fg-sm"><label>Ad Group</label><input type="text" className="gads-search-input" value={filters.adGroupSearch} onChange={(e) => setFilters((p) => ({ ...p, adGroupSearch: e.target.value }))} placeholder="Search ad groups..." /></div>
            <div className="gads-filter-group gads-fg-sm"><label>Keyword</label><input type="text" className="gads-search-input" value={filters.keywordSearch} onChange={(e) => setFilters((p) => ({ ...p, keywordSearch: e.target.value }))} placeholder="Search keywords..." /></div>
            <div className="gads-filter-group gads-filter-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-navy btn-sm" onClick={fetchData} disabled={loading} style={{ padding: '6px 20px' }}>{loading ? 'Loading…' : 'Apply'}</button>
              <span style={{ color: loading ? 'var(--warning)' : error ? 'var(--danger)' : 'var(--accent)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{loading ? 'Loading…' : error ? 'Error' : 'Live'}</span>
            </div>
          </div>
        </div>

        <div className="gads-kpi-section">
          <div className="gads-kpi-toolbar">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Click metric name to customize</span>
          </div>
          <div className="kpi-grid-6">
            {kpiSelected.map((metricKey, slotIdx) => {
              const metric = KPI_CATALOG.find((m) => m.key === metricKey) || KPI_CATALOG[0];
              const isOpen = kpiDropdownOpen === slotIdx;
              const categories = {};
              KPI_CATALOG.forEach((m) => {
                if (!categories[m.category]) categories[m.category] = [];
                categories[m.category].push(m);
              });
              return (
                <div className={`rkpi-card${isOpen ? ' rkpi-open' : ''}`} key={`${metric.key}-${slotIdx}`}>
                  <div className="rkpi-header" onClick={() => handleKpiToggleDD(slotIdx)}>
                    <span className="rkpi-icon">{metric.icon}</span>
                    <span className="rkpi-label">{metric.label}</span>
                    <svg className="rkpi-caret" width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 3.5L5 6.5L7.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
                  </div>
                  <div className="rkpi-value">{metric.fmt(totals[metric.key])}</div>
                  {isOpen && (
                    <div className="rkpi-dropdown" onClick={(e) => e.stopPropagation()}>
                      <div className="rkpi-dd-search">
                        <input type="text" placeholder="Search metrics..." className="rkpi-dd-input" value={kpiSearchTerm} onChange={(e) => setKpiSearchTerm(e.target.value)} autoFocus />
                      </div>
                      {Object.keys(categories).map((cat) => {
                        const items = categories[cat].filter((m) => !kpiSearchTerm || m.label.toLowerCase().includes(kpiSearchTerm.toLowerCase()));
                        if (!items.length) return null;
                        return (
                          <div className="rkpi-dd-group" key={cat}>
                            <div className="rkpi-dd-cat">{cat}</div>
                            {items.map((m) => {
                              const isCurrent = m.key === metric.key;
                              const inUse = kpiSelected.includes(m.key) && !isCurrent;
                              return (
                                <div key={m.key} className={`rkpi-dd-item${isCurrent ? ' selected' : ''}${inUse ? ' in-use' : ''}`} onClick={() => handleKpiSelect(slotIdx, m.key)}>
                                  <span className="rkpi-dd-icon">{m.icon}</span>
                                  <span className="rkpi-dd-name">{m.label}</span>
                                  {isCurrent && <span className="rkpi-dd-check">✓</span>}
                                  {inUse && <span className="rkpi-dd-used">in use</span>}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="gads-chart-section">
          <div className="gads-chart-toolbar">
            <span className="gads-chart-title">Daily Trends</span>
            <button className="btn btn-outline btn-sm" onClick={() => setChartCollapsed((v) => !v)}>{chartCollapsed ? 'Show Chart ▼' : 'Hide Chart ▲'}</button>
          </div>
          {!chartCollapsed && (
            <>
              <div className="gads-chart-metrics">
                {CHART_METRICS.map((m) => {
                  const active = chartActiveMetrics.includes(m.key);
                  return (
                    <div key={m.key} className={`gads-metric-card${active ? ' active' : ''}`} onClick={() => toggleChartMetric(m.key)}>
                      <span className="gads-metric-dot" style={{ background: active ? m.color : 'var(--border)' }} />
                      <div className="gads-metric-info">
                        <span className="gads-metric-name">{m.label}</span>
                        <span className="gads-metric-val">{m.fmt(chartTotals[m.key] || 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="gads-chart-wrap"><canvas ref={chartRef} style={{ height: 300 }} /></div>
            </>
          )}
        </div>

        <div className="gads-tabs-container">
          <div className="gads-tabs-row">
            <div className="gads-tabs">
              {TABS.map((t) => <button key={t.id} type="button" className={`gads-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => { setActiveTab(t.id); if (t.id !== 'keywords') setKeywordMatchFilter('all'); }}>{t.label} ({groupedByTab[t.id]?.length || 0})</button>)}
            </div>
            <div className="gads-tabs-actions">
              <button type="button" className="gads-col-btn" title="Visible columns count">
                {activeColumnCount} Columns
              </button>
              <button type="button" className="gads-col-btn" title="Download CSV" onClick={handleCSV}>
                ↓ CSV
              </button>
            </div>
          </div>
        </div>
        {activeTab === 'keywords' && (
          <div className="gads-sub-filters">
            <span className="gads-sf-label">Match Type:</span>
            <button type="button" className={`btn btn-sm ${keywordMatchFilter === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setKeywordMatchFilter('all')}>All</button>
              {keywordMatchTypes.map((mt) => (
                <button key={mt} type="button" className={`btn btn-sm ${keywordMatchFilter === mt ? 'btn-primary' : 'btn-outline'}`} onClick={() => setKeywordMatchFilter(mt)}>
                  {mt}
                </button>
              ))}
          </div>
        )}

        {loading && <div className="gads-loading"><div className="gads-spinner" /> Loading data...</div>}
        <div className="panel">
          <div className="panel-body no-padding">
            <div className="table-wrapper">
              <table className="data-table gads-table">
                <thead>
                  <tr>
                    {activeTab === 'ad-groups' ? <th>Campaign</th> : <th>{TABS.find((t) => t.id === activeTab)?.label || 'Dimension'}</th>}
                    {activeTab === 'campaign-types' && <th className="text-right"># Campaigns</th>}
                    {activeTab === 'campaigns' && <th>Type</th>}
                    {activeTab === 'campaigns' && <th>Status</th>}
                    {activeTab === 'ad-groups' && <th>Ad Group</th>}
                    {activeTab === 'ad-groups' && <th>Status</th>}
                    {activeTab === 'keywords' && <th>Campaign</th>}
                    {activeTab === 'keywords' && <th>Match Type</th>}
                    <th className="text-right">Cost</th>
                    <th className="text-right">Impressions</th>
                    <th className="text-right">Clicks</th>
                    <th className="text-right">CTR</th>
                    <th className="text-right">Avg CPC</th>
                    <th className="text-right">CPM</th>
                    <th className="text-right">Conv.</th>
                    <th className="text-right">Conv. Rate</th>
                    <th className="text-right">CPA</th>
                    {activeTab === 'campaign-types' && <th className="text-right">% Spend</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredGroupedRows.length === 0 && !loading && <tr><td colSpan={activeTab === 'campaign-types' ? 12 : activeTab === 'campaigns' ? 12 : activeTab === 'ad-groups' ? 12 : activeTab === 'keywords' ? 12 : 10} className="gads-empty-cell">No data found.</td></tr>}
                  {filteredGroupedRows.length > 0 && (
                    <tr className="gads-total-row-top">
                      <td><strong>Total</strong></td>
                      {activeTab === 'campaign-types' && <td className="text-right"><strong>{fI(totals.campaignCount)}</strong></td>}
                      {activeTab === 'campaigns' && <td />}
                      {activeTab === 'campaigns' && <td />}
                      {activeTab === 'ad-groups' && <td />}
                      {activeTab === 'ad-groups' && <td />}
                      {activeTab === 'keywords' && <td />}
                      {activeTab === 'keywords' && <td />}
                      <td className="text-right"><strong>{fU(totals.cost)}</strong></td>
                      <td className="text-right"><strong>{fI(totals.impressions)}</strong></td>
                      <td className="text-right"><strong>{fI(totals.clicks)}</strong></td>
                      <td className="text-right"><strong>{fP(totals.ctr)}</strong></td>
                      <td className="text-right"><strong>{fU(totals.cpc)}</strong></td>
                      <td className="text-right"><strong>{fU(totals.cpm)}</strong></td>
                      <td className="text-right"><strong>{fI(totals.conversions)}</strong></td>
                      <td className="text-right"><strong>{fP(totals.convRate)}</strong></td>
                      <td className="text-right"><strong>{fU(totals.cpa)}</strong></td>
                      {activeTab === 'campaign-types' && <td className="text-right"><strong>100.00%</strong></td>}
                    </tr>
                  )}
                  {filteredGroupedRows.map((r) => {
                    const rowKey = r.rowKey || r.name;
                    return (
                    <Fragment key={rowKey}>
                      <tr
                        className={activeTab === 'campaigns' || activeTab === 'ad-groups' ? 'gads-row-click' : ''}
                        onClick={activeTab === 'campaigns'
                          ? () => setExpandedCampaigns((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))
                          : activeTab === 'ad-groups'
                            ? () => setExpandedAdGroups((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))
                            : undefined}
                      >
                        <td>
                          {activeTab === 'campaigns' && <span style={{ marginRight: 8 }}>{expandedCampaigns[rowKey] ? '▼' : '▶'}</span>}
                          {activeTab === 'ad-groups' && <span style={{ marginRight: 8 }}>{expandedAdGroups[rowKey] ? '▼' : '▶'}</span>}
                          {activeTab === 'ad-groups'
                            ? (r.sampleCampaign || 'Unknown')
                            : activeTab === 'day'
                              ? formatDayDisplay(r.name)
                              : r.name}
                        </td>
                        {activeTab === 'campaign-types' && <td className="text-right">{fI(r.campaignCount)}</td>}
                        {activeTab === 'campaigns' && <td><span className="badge badge-blue">{r.sampleType || 'Unknown'}</span></td>}
                        {activeTab === 'campaigns' && <td><span className={`badge ${statusBadge(r.sampleStatus)}`}>{statusLabel(r.sampleStatus)}</span></td>}
                        {activeTab === 'ad-groups' && <td>{r.name}</td>}
                        {activeTab === 'ad-groups' && <td><span className={`badge ${statusBadge(r.sampleStatus)}`}>{statusLabel(r.sampleStatus)}</span></td>}
                        {activeTab === 'keywords' && <td>{r.sampleCampaign || 'Unknown'}</td>}
                        {activeTab === 'keywords' && <td><span className="badge badge-blue">{r.sampleMatchType || 'Unknown'}</span></td>}
                        <td className="text-right">{fU(r.cost)}</td>
                        <td className="text-right">{fI(r.impressions)}</td>
                        <td className="text-right">{fI(r.clicks)}</td>
                        <td className="text-right">{fP(r.ctr)}</td>
                        <td className="text-right">{fU(r.cpc)}</td>
                        <td className="text-right">{fU(r.cpm)}</td>
                        <td className="text-right">{fI(r.conversions)}</td>
                        <td className="text-right">{fP(r.convRate)}</td>
                        <td className="text-right">{fU(r.cpa)}</td>
                        {activeTab === 'campaign-types' && <td className="text-right">{fP(r.spendPct)}</td>}
                      </tr>
                      {activeTab === 'campaigns' && expandedCampaigns[rowKey] && (campaignSubRowsMap.get(r.name) || []).map((s) => (
                        <tr key={`${rowKey}-${s.name}`} className="gads-sub-row">
                          <td style={{ paddingLeft: 28 }}>↳ {s.name}</td>
                          <td />
                          <td />
                          <td className="text-right">{fU(s.cost)}</td>
                          <td className="text-right">{fI(s.impressions)}</td>
                          <td className="text-right">{fI(s.clicks)}</td>
                          <td className="text-right">{fP(s.ctr)}</td>
                          <td className="text-right">{fU(s.cpc)}</td>
                          <td className="text-right">{fU(s.cpm)}</td>
                          <td className="text-right">{fI(s.conversions)}</td>
                          <td className="text-right">{fP(s.convRate)}</td>
                          <td className="text-right">{fU(s.cpa)}</td>
                        </tr>
                      ))}
                      {activeTab === 'ad-groups' && expandedAdGroups[rowKey] && (adGroupKeywordRowsMap.get(rowKey) || []).map((s) => (
                        <tr key={`${rowKey}-${s.name}-${s.sampleMatchType}`} className="gads-sub-row">
                          <td style={{ paddingLeft: 28 }}>↳ {s.name}</td>
                          <td />
                          <td><span className="badge badge-blue">{s.sampleMatchType || 'Unknown'}</span></td>
                          <td className="text-right">{fU(s.cost)}</td>
                          <td className="text-right">{fI(s.impressions)}</td>
                          <td className="text-right">{fI(s.clicks)}</td>
                          <td className="text-right">{fP(s.ctr)}</td>
                          <td className="text-right">{fU(s.cpc)}</td>
                          <td className="text-right">{fU(s.cpm)}</td>
                          <td className="text-right">{fI(s.conversions)}</td>
                          <td className="text-right">{fP(s.convRate)}</td>
                          <td className="text-right">{fU(s.cpa)}</td>
                        </tr>
                      ))}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
