import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { useGoogleAdsData } from '../hooks/useGoogleAdsData';
import { useMetaCampaignsData } from '../hooks/useMetaCampaignsData';
import { useRedditReportData } from '../hooks/useRedditReportData';
import { useMicrosoftAdsReportData } from '../hooks/useMicrosoftAdsReportData';
import { useTiktokReportData } from '../hooks/useTiktokReportData';
import { DateRangePicker } from '../components/DatePicker';
import { exportReportPdf, getDateRangeLabel } from '../utils/exportReportPdf';
import { calculateRoas, calculateWeightedRoas } from '../utils/roas';
import { useApp } from '../context/AppContext';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';
const fR = (n) => Number(n || 0).toFixed(2) + 'x';

const VIEW_TABS = [
  { id: 'combined', label: 'Platform' },
  { id: 'country', label: 'Country' },
  { id: 'show', label: 'Titles' },
  { id: 'product', label: 'Product' },
];

const PLATFORM_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'google', label: 'Google Ads' },
  { id: 'meta', label: 'Meta Ads' },
  { id: 'reddit', label: 'Reddit Ads' },
  { id: 'microsoft', label: 'Bing / Microsoft Ads' },
  { id: 'tiktok', label: 'TikTok Ads' },
];

const CHART_METRICS = [
  { key: 'cost', label: 'Cost', fmt: fU, color: '#ED1C24', axis: 'left' },
  { key: 'impressions', label: 'Impressions', fmt: fI, color: '#2E9E40', axis: 'left' },
  { key: 'clicks', label: 'Clicks', fmt: fI, color: '#F5A623', axis: 'left' },
  { key: 'ctr', label: 'CTR', fmt: fP, color: '#8b5cf6', axis: 'right' },
  { key: 'cpc', label: 'CPC', fmt: fU, color: '#3b82f6', axis: 'right' },
  { key: 'conversions', label: 'Conv.', fmt: fI, color: '#ec4899', axis: 'left' },
  { key: 'conv_rate', label: 'Conv. Rate', fmt: fP, color: '#14b8a6', axis: 'right' },
  { key: 'cpa', label: 'CPA', fmt: fU, color: '#f97316', axis: 'right' },
];

const CHART_TYPE_TABS = [
  { id: 'line', label: 'Line' },
  { id: 'bar', label: 'Bar' },
];

function exportCSV(columns, rows, filename) {
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const body = rows.map((r) => columns.map((c) => {
    const v = typeof c.cell === 'function' ? c.cell(r) : r[c.col];
    return typeof v === 'number' ? v : `"${String(v || '').replace(/"/g, '""')}"`;
  }).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function mergeDailyTrends(googleTrends, metaDays, redditTrends, microsoftTrends, tiktokTrends) {
  const map = new Map();
  const add = (arr, dateKey, getVal) => {
    if (!arr || !arr.length) return;
    arr.forEach((d) => {
      const date = dateKey(d);
      if (!date) return;
      if (!map.has(date)) map.set(date, { date, cost: 0, impressions: 0, clicks: 0, conversions: 0 });
      const a = map.get(date);
      const v = getVal(d);
      a.cost += v.cost || 0;
      a.impressions += v.impressions || 0;
      a.clicks += v.clicks || 0;
      a.conversions += v.conversions || v.purchases || 0;
    });
  };
  add(googleTrends, (d) => d.date, (d) => ({ cost: d.cost, impressions: d.impressions, clicks: d.clicks, conversions: d.conversions }));
  add(metaDays, (d) => (d.name || d.key || '').toString().slice(0, 10), (d) => ({ cost: d.cost, impressions: d.impressions, clicks: d.clicks, conversions: d.purchases }));
  add(redditTrends, (d) => (d.date || d.name || '').toString().slice(0, 10), (d) => ({ cost: d.cost, impressions: d.impressions, clicks: d.clicks, conversions: d.conversions }));
  add(microsoftTrends, (d) => (d.date || d.name || '').toString().slice(0, 10), (d) => ({ cost: d.cost, impressions: d.impressions, clicks: d.clicks, conversions: d.conversions }));
  add(tiktokTrends, (d) => (d.date || d.name || '').toString().slice(0, 10), (d) => ({ cost: d.cost, impressions: d.impressions, clicks: d.clicks, conversions: d.conversions }));
  return [...map.values()]
    .map((d) => ({
      ...d,
      ctr: d.impressions ? (d.clicks / d.impressions) * 100 : 0,
      cpc: d.clicks ? d.cost / d.clicks : 0,
      conv_rate: d.clicks ? (d.conversions / d.clicks) * 100 : 0,
      cpa: d.conversions ? d.cost / d.conversions : 0,
    }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function useCombinedSummary() {
  const google = useGoogleAdsData();
  const meta = useMetaCampaignsData();
  const reddit = useRedditReportData();
  const microsoft = useMicrosoftAdsReportData();
  const tiktok = useTiktokReportData();

  const loading = google.loading || meta.loading || reddit.loading || microsoft.loading || tiktok.loading;
  const errors = [google.error, meta.error, reddit.error, microsoft.error, tiktok.error].filter(Boolean);

  const getConv = (k) => (k && (Number(k.conversions ?? k.purchases ?? 0)));
  const getCost = (k) => (k && Number(k.cost ?? 0));
  const getClicks = (k) => (k && Number(k.clicks ?? 0));
  const getImpr = (k) => (k && Number(k.impressions ?? 0));
  const getCpa = (k) => (k && Number(k.cpa ?? 0));
  const getRoas = (k) => (k && Number(k.roas ?? 0));

  const rows = [
    {
      id: 'google',
      label: 'Google Ads',
      color: '#4285F4',
      cost: getCost(google.kpis),
      impressions: getImpr(google.kpis),
      clicks: getClicks(google.kpis),
      conversions: getConv(google.kpis),
      cpa: getCpa(google.kpis),
      roas: getRoas(google.kpis),
    },
    {
      id: 'meta',
      label: 'Meta Ads',
      color: '#1877F2',
      cost: getCost(meta.kpis),
      impressions: getImpr(meta.kpis),
      clicks: getClicks(meta.kpis),
      conversions: getConv(meta.kpis),
      cpa: getCpa(meta.kpis),
      roas: getRoas(meta.kpis),
    },
    {
      id: 'reddit',
      label: 'Reddit Ads',
      color: '#FF4500',
      cost: getCost(reddit.kpis),
      impressions: getImpr(reddit.kpis),
      clicks: getClicks(reddit.kpis),
      conversions: getConv(reddit.kpis),
      cpa: getCpa(reddit.kpis),
      roas: getRoas(reddit.kpis),
    },
    {
      id: 'microsoft',
      label: 'Bing / Microsoft Ads',
      color: '#00809D',
      cost: getCost(microsoft.kpis),
      impressions: getImpr(microsoft.kpis),
      clicks: getClicks(microsoft.kpis),
      conversions: getConv(microsoft.kpis),
      cpa: getCpa(microsoft.kpis),
      roas: getRoas(microsoft.kpis),
    },
    {
      id: 'tiktok',
      label: 'TikTok Ads',
      color: '#25F4EE',
      cost: getCost(tiktok.kpis),
      impressions: getImpr(tiktok.kpis),
      clicks: getClicks(tiktok.kpis),
      conversions: getConv(tiktok.kpis),
      cpa: getCpa(tiktok.kpis),
      roas: getRoas(tiktok.kpis),
    },
  ];

  const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const totalImpressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
  const totalClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
  const totalConversions = rows.reduce((s, r) => s + (r.conversions || 0), 0);
  const totalRow = {
    id: 'total',
    label: 'Total (all platforms)',
    color: 'var(--navy)',
    cost: totalCost,
    impressions: totalImpressions,
    clicks: totalClicks,
    conversions: totalConversions,
    cpa: totalConversions ? totalCost / totalConversions : 0,
    roas: calculateWeightedRoas(rows.map((r) => ({ cost: r.cost, roas: r.roas }))),
  };

  const combinedDailyTrends = useMemo(
    () =>
      mergeDailyTrends(
        google.dailyTrends || [],
        meta.days || [],
        reddit.dailyTrends || [],
        microsoft.dailyTrends || [],
        tiktok.dailyTrends || [],
      ),
    [google.dailyTrends, meta.days, reddit.dailyTrends, microsoft.dailyTrends, tiktok.dailyTrends]
  );

  return {
    loading,
    errors,
    rows,
    totalRow,
    combinedDailyTrends,
    countryData: {
      google: google.countryData || [],
      meta: meta.countries || [],
      reddit: reddit.countryData || [],
      microsoft: microsoft.countryData || [],
      tiktok: tiktok.countries || [],
    },
    showData: {
      google: google.showsData || [],
      meta: meta.shows || [],
      reddit: reddit.showsData || [],
      microsoft: microsoft.showsData || [],
      tiktok: tiktok.shows || [],
    },
    productData: {
      google: google.productData || [],
      meta: meta.products || [],
      reddit: reddit.productData || [],
      microsoft: microsoft.productData || [],
      tiktok: tiktok.products || [],
    },
    refetch: useCallback(() => {
      google.fetchData();
      meta.fetchData();
      reddit.fetchData();
      microsoft.fetchData();
      tiktok.fetchData();
    }, [google.fetchData, meta.fetchData, reddit.fetchData, microsoft.fetchData, tiktok.fetchData]),
    batchUpdateDate: useCallback(
      ({ preset, dateFrom, dateTo }) => {
        const updates = { datePreset: preset, dateFrom: dateFrom || '', dateTo: dateTo || '' };
        google.batchUpdateFilters(updates);
        meta.batchUpdateFilters(updates);
        reddit.batchUpdateFilters(updates);
        microsoft.batchUpdateFilters(updates);
        tiktok.batchUpdateFilters(updates);
      },
      [google.batchUpdateFilters, meta.batchUpdateFilters, reddit.batchUpdateFilters, microsoft.batchUpdateFilters, tiktok.batchUpdateFilters]
    ),
    filters: google.filters,
  };
}

function computeChartTotals(trends) {
  if (!trends || !trends.length) return { cost: 0, impressions: 0, clicks: 0, conversions: 0, ctr: 0, cpc: 0, conv_rate: 0, cpa: 0 };
  const s = { cost: 0, impressions: 0, clicks: 0, conversions: 0 };
  trends.forEach((d) => {
    s.cost += d.cost || 0;
    s.impressions += d.impressions || 0;
    s.clicks += d.clicks || 0;
    s.conversions += d.conversions || 0;
  });
  return {
    ...s,
    ctr: s.impressions ? (s.clicks / s.impressions) * 100 : 0,
    cpc: s.clicks ? s.cost / s.clicks : 0,
    conv_rate: s.clicks ? (s.conversions / s.clicks) * 100 : 0,
    cpa: s.conversions ? s.cost / s.conversions : 0,
  };
}

/** Normalize country/show row from any platform to { name, cost, impressions, clicks, conversions, revenue, cpa, roas, platform } */
function normalizeDimRow(item, platformId, platformLabel) {
  const name = item.name ?? item.key ?? '—';
  const cost = Number(item.cost) || 0;
  const impressions = Number(item.impressions) || 0;
  const clicks = Number(item.clicks) || 0;
  const conversions = Number(item.conversions ?? item.purchases) || 0;
  const revenue = Number(item.revenue ?? item.conversions_value) || 0;
  const cpa = conversions ? cost / conversions : 0;
  const roas = calculateRoas(cost, revenue);
  return { name, cost, impressions, clicks, conversions, revenue, cpa, roas, platform: platformId, platformLabel };
}

export function CombinedReportPage() {
  const { branding, registerExportPdf } = useApp();
  const { loading, errors, rows, totalRow, combinedDailyTrends, countryData, showData, productData, refetch, batchUpdateDate, filters } = useCombinedSummary();
  const exportPdfRef = useRef(null);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartActiveMetrics, setChartActiveMetrics] = useState(['cost', 'clicks', 'conversions']);
  const [chartType, setChartType] = useState('line'); // 'line' | 'bar'
  const [viewTab, setViewTab] = useState('combined');
  // const [platformFilter, setPlatformFilter] = useState('all'); // Removed - always showing all platforms
  const platformFilter = 'all'; // Always show all platforms
  const [colEditorOpen, setColEditorOpen] = useState(false);
  const colEditorRef = useRef(null);

  const handleDatePickerApply = useCallback(
    ({ preset, dateFrom, dateTo }) => {
      batchUpdateDate({ preset, dateFrom, dateTo });
      setTimeout(() => refetch(), 50);
    },
    [batchUpdateDate, refetch]
  );

  const summaryRows = [...rows, totalRow];
  const chartTotals = useMemo(() => computeChartTotals(combinedDailyTrends), [combinedDailyTrends]);

  const platformLabels = {
    google: 'Google Ads',
    meta: 'Meta Ads',
    reddit: 'Reddit Ads',
    microsoft: 'Bing / Microsoft Ads',
    tiktok: 'TikTok Ads',
  };

  const countryRows = useMemo(() => {
    const platforms = platformFilter === 'all' ? ['google', 'meta', 'reddit', 'microsoft', 'tiktok'] : [platformFilter];
    const out = [];
    platforms.forEach((pid) => {
      const arr = countryData[pid] || [];
      arr.forEach((item) => out.push(normalizeDimRow(item, pid, platformLabels[pid])));
    });
    // Aggregate duplicate countries into one row
    const aggregated = new Map();
    out.forEach((row) => {
      const key = row.name.toLowerCase().trim();
      if (aggregated.has(key)) {
        const existing = aggregated.get(key);
        existing.cost += row.cost || 0;
        existing.impressions += row.impressions || 0;
        existing.clicks += row.clicks || 0;
        existing.conversions += row.conversions || 0;
        existing.revenue += row.revenue || 0;
        existing.cpa = existing.conversions ? existing.cost / existing.conversions : 0;
        existing.roas = calculateRoas(existing.cost, existing.revenue);
      } else {
        aggregated.set(key, { ...row });
      }
    });
    return Array.from(aggregated.values()).sort((a, b) => (b.cost || 0) - (a.cost || 0));
  }, [countryData, platformFilter]);

  const showRows = useMemo(() => {
    const platforms = platformFilter === 'all' ? ['google', 'meta', 'reddit', 'microsoft', 'tiktok'] : [platformFilter];
    const out = [];
    platforms.forEach((pid) => {
      const arr = showData[pid] || [];
      arr.forEach((item) => out.push(normalizeDimRow(item, pid, platformLabels[pid])));
    });
    // Aggregate duplicate shows/titles into one row
    const aggregated = new Map();
    out.forEach((row) => {
      const key = row.name.toLowerCase().trim();
      if (aggregated.has(key)) {
        const existing = aggregated.get(key);
        existing.cost += row.cost || 0;
        existing.impressions += row.impressions || 0;
        existing.clicks += row.clicks || 0;
        existing.conversions += row.conversions || 0;
        existing.revenue += row.revenue || 0;
        existing.cpa = existing.conversions ? existing.cost / existing.conversions : 0;
        existing.roas = calculateRoas(existing.cost, existing.revenue);
      } else {
        aggregated.set(key, { ...row });
      }
    });
    return Array.from(aggregated.values()).sort((a, b) => (b.cost || 0) - (a.cost || 0));
  }, [showData, platformFilter]);

  const productRows = useMemo(() => {
    const platforms = platformFilter === 'all' ? ['google', 'meta', 'reddit', 'microsoft', 'tiktok'] : [platformFilter];
    const out = [];
    platforms.forEach((pid) => {
      const arr = productData[pid] || [];
      arr.forEach((item) => out.push(normalizeDimRow(item, pid, platformLabels[pid])));
    });
    // Aggregate duplicate products into one row
    const aggregated = new Map();
    out.forEach((row) => {
      const key = row.name.toLowerCase().trim();
      if (aggregated.has(key)) {
        const existing = aggregated.get(key);
        existing.cost += row.cost || 0;
        existing.impressions += row.impressions || 0;
        existing.clicks += row.clicks || 0;
        existing.conversions += row.conversions || 0;
        existing.revenue += row.revenue || 0;
        existing.cpa = existing.conversions ? existing.cost / existing.conversions : 0;
        existing.roas = calculateRoas(existing.cost, existing.revenue);
      } else {
        aggregated.set(key, { ...row });
      }
    });
    return Array.from(aggregated.values()).sort((a, b) => (b.cost || 0) - (a.cost || 0));
  }, [productData, platformFilter]);

  // const showPlatformColumn = platformFilter === 'all' && (viewTab === 'country' || viewTab === 'show' || viewTab === 'product');
  const showPlatformColumn = false; // Commented out - Platform column disabled

  const handleCSV = useCallback(() => {
    if (viewTab === 'combined') {
      const cols = [
        { label: 'Platform', cell: (r) => r.label },
        { label: 'Cost', cell: (r) => fU(r.cost) },
        { label: 'Impressions', cell: (r) => fI(r.impressions) },
        { label: 'Clicks', cell: (r) => fI(r.clicks) },
        { label: 'Conversions', cell: (r) => fI(r.conversions ?? r.purchases) },
        { label: 'CPA', cell: (r) => fU(r.cpa) },
      ];
      exportCSV(cols, summaryRows, 'combined-report-platform.csv');
    } else if (viewTab === 'country') {
      const cols = [
        ...(showPlatformColumn ? [{ label: 'Platform', cell: (r) => r.platformLabel }] : []),
        { label: 'Country', cell: (r) => r.name },
        { label: 'Cost', cell: (r) => fU(r.cost) },
        { label: 'Impressions', cell: (r) => fI(r.impressions) },
        { label: 'Clicks', cell: (r) => fI(r.clicks) },
        { label: 'Conversions', cell: (r) => fI(r.conversions) },
        { label: 'CPA', cell: (r) => fU(r.cpa) },
      ];
      exportCSV(cols, countryRows, 'combined-report-country.csv');
    } else if (viewTab === 'show') {
      const cols = [
        ...(showPlatformColumn ? [{ label: 'Platform', cell: (r) => r.platformLabel }] : []),
        { label: 'Title', cell: (r) => r.name },
        { label: 'Cost', cell: (r) => fU(r.cost) },
        { label: 'Impressions', cell: (r) => fI(r.impressions) },
        { label: 'Clicks', cell: (r) => fI(r.clicks) },
        { label: 'Conversions', cell: (r) => fI(r.conversions) },
        { label: 'CPA', cell: (r) => fU(r.cpa) },
      ];
      exportCSV(cols, showRows, 'combined-report-show.csv');
    } else {
      const cols = [
        ...(showPlatformColumn ? [{ label: 'Platform', cell: (r) => r.platformLabel }] : []),
        { label: 'Product', cell: (r) => r.name },
        { label: 'Cost', cell: (r) => fU(r.cost) },
        { label: 'Impressions', cell: (r) => fI(r.impressions) },
        { label: 'Clicks', cell: (r) => fI(r.clicks) },
        { label: 'Conversions', cell: (r) => fI(r.conversions) },
        { label: 'CPA', cell: (r) => fU(r.cpa) },
      ];
      exportCSV(cols, productRows, 'combined-report-product.csv');
    }
  }, [viewTab, summaryRows, countryRows, showRows, productRows, showPlatformColumn]);

  const toggleChartMetric = useCallback((key) => {
    setChartActiveMetrics((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (colEditorOpen && colEditorRef.current && !colEditorRef.current.contains(e.target)) setColEditorOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [colEditorOpen]);

  // Main trend chart (line or bar)
  useEffect(() => {
    if (chartCollapsed || !chartRef.current || !combinedDailyTrends.length) return;
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }
    const labels = combinedDailyTrends.map((d) => {
      const p = (d.date || '').toString().split('-');
      return p.length >= 3 ? parseInt(p[1], 10) + '/' + parseInt(p[2], 10) : d.date;
    });
    const datasets = [];
    let needsLeft = false;
    let needsRight = false;
    const isBar = chartType === 'bar';
    CHART_METRICS.forEach((m) => {
      if (!chartActiveMetrics.includes(m.key)) return;
      const yAxisID = m.axis === 'right' ? 'y1' : 'y';
      if (m.axis === 'right') needsRight = true;
      else needsLeft = true;
      datasets.push({
        label: m.label,
        data: combinedDailyTrends.map((d) => +(d[m.key] || 0)),
        borderColor: m.color,
        backgroundColor: isBar ? m.color + '99' : m.color + '18',
        tension: isBar ? 0 : 0.35,
        fill: isBar,
        borderWidth: isBar ? 1.5 : 2.5,
        pointRadius: isBar ? 0 : 3,
        pointHoverRadius: isBar ? 4 : 5,
        pointBackgroundColor: m.color,
        yAxisID,
      });
    });
    const fmtTick = (v) =>
      Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v;
    const scales = {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, maxTicksLimit: 31, maxRotation: 45 },
      },
    };
    if (needsLeft)
      scales.y = {
        type: 'linear',
        position: 'left',
        beginAtZero: true,
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { font: { size: 11 }, callback: fmtTick },
      };
    if (needsRight) {
      scales.y1 = {
        type: 'linear',
        position: 'right',
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        ticks: { font: { size: 11 }, callback: fmtTick },
      };
      if (!needsLeft) scales.y1.grid = { drawOnChartArea: true, color: 'rgba(0,0,0,0.05)' };
    }
    chartInstance.current = new Chart(chartRef.current, {
      type: chartType,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } },
        },
        scales,
      },
    });
    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [combinedDailyTrends, chartActiveMetrics, chartCollapsed, chartType]);

  exportPdfRef.current = () => {
    const dateRangeText = getDateRangeLabel(filters?.datePreset, filters?.dateFrom, filters?.dateTo);
    const kpis = [
      { label: 'Total Spend', value: fU(totalRow.cost) },
      { label: 'Impressions', value: fI(totalRow.impressions) },
      { label: 'Clicks', value: fI(totalRow.clicks) },
      { label: 'Conversions', value: fI(totalRow.conversions) },
      { label: 'CPA', value: fU(totalRow.cpa) },
    ];
    const headers = ['Platform', 'Cost', 'Impressions', 'Clicks', 'Conversions', 'CPA'];
    const tableRows = summaryRows.map((r) => [
      r.label,
      fU(r.cost),
      fI(r.impressions),
      fI(r.clicks),
      fI(r.conversions),
      fU(r.cpa),
    ]);
    exportReportPdf({
      reportTitle: 'Combined Reporting',
      dateRangeText,
      kpis,
      tableHeaders: headers,
      tableRows,
      branding,
      filename: 'combined-report',
    });
  };

  useEffect(() => {
    registerExportPdf(() => exportPdfRef.current?.());
    return () => registerExportPdf(null);
  }, [registerExportPdf]);

  return (
    <div className="page-section active" id="page-combined-report">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  background: 'linear-gradient(135deg, #4285F4 0%, #1877F2 25%, #FF4500 50%, #25F4EE 100%)',
                  color: 'white',
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                ∑
              </span>
              Combined Reporting
            </h2>
            <p>Summary of Google Ads, Meta, Reddit, Bing / Microsoft Ads &amp; TikTok performance in one view</p>
          </div>
          <DateRangePicker
            preset={filters?.datePreset}
            dateFrom={filters?.dateFrom}
            dateTo={filters?.dateTo}
            compareOn={false}
            compareFrom=""
            compareTo=""
            onApply={handleDatePickerApply}
          />
        </div>

        {errors.length > 0 && (
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {errors.join(' ')}
            <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 12 }} onClick={refetch}>
              Retry
            </button>
          </div>
        )}

        {/* Combined KPIs (above graph) */}
        <div className="gads-kpi-section">
          <div className="gads-kpi-toolbar">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>All platforms total</span>
          </div>
          <div className="kpi-grid-6" id="combined-kpi-grid">
            <div className="rkpi-card">
              <div className="rkpi-header">
                <span className="rkpi-icon">💰</span>
                <span className="rkpi-label">Total Spend</span>
              </div>
              <div className="rkpi-value">{loading ? '…' : fU(totalRow.cost)}</div>
            </div>
            <div className="rkpi-card">
              <div className="rkpi-header">
                <span className="rkpi-icon">👁</span>
                <span className="rkpi-label">Impressions</span>
              </div>
              <div className="rkpi-value">{loading ? '…' : fI(totalRow.impressions)}</div>
            </div>
            <div className="rkpi-card">
              <div className="rkpi-header">
                <span className="rkpi-icon">👆</span>
                <span className="rkpi-label">Clicks</span>
              </div>
              <div className="rkpi-value">{loading ? '…' : fI(totalRow.clicks)}</div>
            </div>
            <div className="rkpi-card">
              <div className="rkpi-header">
                <span className="rkpi-icon">🎯</span>
                <span className="rkpi-label">Conversions</span>
              </div>
              <div className="rkpi-value">{loading ? '…' : fI(totalRow.conversions)}</div>
            </div>
            <div className="rkpi-card">
              <div className="rkpi-header">
                <span className="rkpi-icon">🏷</span>
                <span className="rkpi-label">CPA</span>
              </div>
              <div className="rkpi-value">{loading ? '…' : fU(totalRow.cpa)}</div>
            </div>
          </div>
        </div>

        {/* Daily Trends Chart — Line / Bar tabs + metric toggles */}
        <div className="gads-chart-section" style={{ minWidth: 0, overflow: 'hidden' }}>
          <div className="gads-chart-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="gads-chart-title">Daily trends (all platforms combined)</span>
              <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                {CHART_TYPE_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`btn btn-sm ${chartType === tab.id ? 'btn-primary' : 'btn-outline'}`}
                    style={{
                      margin: 0,
                      borderRadius: 0,
                      borderLeft: tab.id === 'bar' ? '1px solid var(--border)' : 'none',
                    }}
                    onClick={() => setChartType(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setChartCollapsed(!chartCollapsed)}
            >
              {chartCollapsed ? 'Show chart ▼' : 'Hide chart ▲'}
            </button>
          </div>
          {!chartCollapsed && (
            <>
              <div className="gads-chart-metrics">
                {CHART_METRICS.map((m) => {
                  const active = chartActiveMetrics.includes(m.key);
                  return (
                    <div
                      key={m.key}
                      className={`gads-metric-card${active ? ' active' : ''}`}
                      onClick={() => toggleChartMetric(m.key)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && toggleChartMetric(m.key)}
                    >
                      <span
                        className="gads-metric-dot"
                        style={{ background: active ? m.color : 'var(--border)' }}
                      />
                      <div className="gads-metric-info">
                        <span className="gads-metric-name">{m.label}</span>
                        <span className="gads-metric-val">{m.fmt(chartTotals[m.key] ?? 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="gads-chart-wrap" style={{ minWidth: 0, maxWidth: '100%' }}>
                <canvas ref={chartRef} style={{ height: 300 }} />
              </div>
            </>
          )}
        </div>

        {/* ── Tabs (below graph) ── */}
        <div className="gads-tabs-container gads-tabs-pill" style={{ marginTop: 24 }}>
          <div className="gads-tabs-row">
            <div className="gads-tabs">
              {VIEW_TABS.map((tab) => {
                const displayCount = tab.id === 'combined' ? 1 : tab.id === 'country' ? countryRows.length : tab.id === 'show' ? showRows.length : productRows.length;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`gads-tab ${viewTab === tab.id ? 'active' : ''}`}
                    onClick={() => setViewTab(tab.id)}
                  >
                    {tab.label}{displayCount != null ? ` (${displayCount})` : ''}
                  </button>
                );
              })}
            </div>
            <div className="gads-tabs-actions">
              {/* Platform dropdown removed - always showing all platforms */}
              <div style={{ position: 'relative' }} ref={colEditorRef}>
                <button type="button" className={`gads-col-btn${colEditorOpen ? ' active' : ''}`} title="Show/hide columns" onClick={() => setColEditorOpen((v) => !v)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ verticalAlign: '-2px', marginRight: 4 }}><rect x="1" y="1" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="1" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="8" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
                  Columns
                </button>
                {colEditorOpen && (
                  <div className="gads-col-dropdown">
                    <div className="gads-col-dropdown-header">Toggle Columns</div>
                    <div className="gads-col-dropdown-item" style={{ fontSize: 12, color: 'var(--text-muted)' }}>All columns visible</div>
                  </div>
                )}
              </div>
              <button type="button" className="gads-col-btn" title="Download CSV" onClick={handleCSV}>↓ CSV</button>
            </div>
          </div>
        </div>

        {/* ── Tab Content ── */}
        <div id="gads-tab-content">
        {viewTab === 'combined' && (
          <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-body">
              <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>Summary by platform</h3>
              {loading && (
                <div className="gads-loading">
                  <div className="gads-spinner" /> Loading all platforms…
                </div>
              )}
              {!loading && (
                <div className="table-wrapper">
                  <table className="data-table gads-table">
                    <thead>
                      <tr>
                        <th>Platform</th>
                        <th className="text-right">Cost</th>
                        <th className="text-right">Impressions</th>
                        <th className="text-right">Clicks</th>
                        <th className="text-right">Conversions</th>
                        <th className="text-right">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.map((r) => (
                        <tr key={r.id} className={r.id === 'total' ? 'gads-total-row-top' : ''}>
                          <td>
                            {r.id !== 'total' ? (
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 10,
                                  height: 10,
                                  borderRadius: 2,
                                  backgroundColor: r.color,
                                  marginRight: 8,
                                  verticalAlign: 'middle',
                                }}
                              />
                            ) : null}
                            <strong>{r.label}</strong>
                          </td>
                          <td className="text-right">{fU(r.cost)}</td>
                          <td className="text-right">{fI(r.impressions)}</td>
                          <td className="text-right">{fI(r.clicks)}</td>
                          <td className="text-right">{fI(r.conversions)}</td>
                          <td className="text-right">{fU(r.cpa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {viewTab === 'country' && (
          <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-body">
              <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>Report by country</h3>
              {loading && (
                <div className="gads-loading">
                  <div className="gads-spinner" /> Loading…
                </div>
              )}
              {!loading && (
                <div className="table-wrapper">
                  <table className="data-table gads-table">
                    <thead>
                      <tr>
                        {/* {showPlatformColumn && <th>Platform</th>} */} {/* Commented out - Platform column disabled */}
                        <th>Country</th>
                        <th className="text-right">Cost</th>
                        <th className="text-right">Impressions</th>
                        <th className="text-right">Clicks</th>
                        <th className="text-right">Conversions</th>
                        <th className="text-right">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {countryRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="gads-empty-cell">
                            No country data for the selected platform(s).
                          </td>
                        </tr>
                      )}
                      {countryRows.map((r, i) => (
                        <tr key={`${r.name}-${i}`}>
                          {/* {showPlatformColumn && (
                            <td>
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  backgroundColor: rows.find((p) => p.id === r.platform)?.color || '#999',
                                  marginRight: 6,
                                  verticalAlign: 'middle',
                                }}
                              />
                              {r.platformLabel}
                            </td>
                          )} */} {/* Commented out - Platform column disabled */}
                          <td><strong>{r.name}</strong></td>
                          <td className="text-right">{fU(r.cost)}</td>
                          <td className="text-right">{fI(r.impressions)}</td>
                          <td className="text-right">{fI(r.clicks)}</td>
                          <td className="text-right">{fI(r.conversions)}</td>
                          <td className="text-right">{fU(r.cpa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {viewTab === 'show' && (
          <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-body">
              <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>Report by show</h3>
              {loading && (
                <div className="gads-loading">
                  <div className="gads-spinner" /> Loading…
                </div>
              )}
              {!loading && (
                <div className="table-wrapper">
                  <table className="data-table gads-table">
                    <thead>
                      <tr>
                        {/* {showPlatformColumn && <th>Platform</th>} */} {/* Commented out - Platform column disabled */}
                        <th>Title</th>
                        <th className="text-right">Cost</th>
                        <th className="text-right">Impressions</th>
                        <th className="text-right">Clicks</th>
                        <th className="text-right">Conversions</th>
                        <th className="text-right">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {showRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="gads-empty-cell">
                            No show data for the selected platform(s).
                          </td>
                        </tr>
                      )}
                      {showRows.map((r, i) => (
                        <tr key={`${r.name}-${i}`}>
                          {/* {showPlatformColumn && (
                            <td>
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  backgroundColor: rows.find((p) => p.id === r.platform)?.color || '#999',
                                  marginRight: 6,
                                  verticalAlign: 'middle',
                                }}
                              />
                              {r.platformLabel}
                            </td>
                          )} */} {/* Commented out - Platform column disabled */}
                          <td><strong>{r.name}</strong></td>
                          <td className="text-right">{fU(r.cost)}</td>
                          <td className="text-right">{fI(r.impressions)}</td>
                          <td className="text-right">{fI(r.clicks)}</td>
                          <td className="text-right">{fI(r.conversions)}</td>
                          <td className="text-right">{fU(r.cpa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {viewTab === 'product' && (
          <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-body">
              <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>Report by product</h3>
              {loading && (
                <div className="gads-loading">
                  <div className="gads-spinner" /> Loading…
                </div>
              )}
              {!loading && (
                <div className="table-wrapper">
                  <table className="data-table gads-table">
                    <thead>
                      <tr>
                        {/* {showPlatformColumn && <th>Platform</th>} */} {/* Commented out - Platform column disabled */}
                        <th>Product</th>
                        <th className="text-right">Cost</th>
                        <th className="text-right">Impressions</th>
                        <th className="text-right">Clicks</th>
                        <th className="text-right">Conversions</th>
                        <th className="text-right">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="gads-empty-cell">
                            No product data for the selected platform(s).
                          </td>
                        </tr>
                      )}
                      {productRows.map((r, i) => (
                        <tr key={`${r.name}-${i}`}>
                          {/* {showPlatformColumn && (
                            <td>
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  backgroundColor: rows.find((p) => p.id === r.platform)?.color || '#999',
                                  marginRight: 6,
                                  verticalAlign: 'middle',
                                }}
                              />
                              {r.platformLabel}
                            </td>
                          )} */} {/* Commented out - Platform column disabled */}
                          <td><strong>{r.name}</strong></td>
                          <td className="text-right">{fU(r.cost)}</td>
                          <td className="text-right">{fI(r.impressions)}</td>
                          <td className="text-right">{fI(r.clicks)}</td>
                          <td className="text-right">{fI(r.conversions)}</td>
                          <td className="text-right">{fU(r.cpa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
