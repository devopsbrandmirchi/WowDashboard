import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useMetaCampaignsData } from '../hooks/useMetaCampaignsData';
import { DateRangePicker } from '../components/DatePicker';
import Chart from 'chart.js/auto';
import { exportReportPdf, getDateRangeLabel } from '../utils/exportReportPdf';
import { useApp } from '../context/AppContext';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';
const fR = (n) => Number(n || 0).toFixed(2) + 'x';

const PG = 50;

const CHART_METRICS = [
  { key: 'cost', label: 'Cost', fmt: fU, color: '#ED1C24', axis: 'left' },
  { key: 'impressions', label: 'Impressions', fmt: fI, color: '#2E9E40', axis: 'left' },
  { key: 'clicks', label: 'Clicks', fmt: fI, color: '#F5A623', axis: 'left' },
  { key: 'ctr', label: 'CTR', fmt: fP, color: '#8b5cf6', axis: 'right' },
  { key: 'cpc', label: 'CPC', fmt: fU, color: '#3b82f6', axis: 'right' },
  { key: 'purchases', label: 'Conv.', fmt: fI, color: '#ec4899', axis: 'left' },
  { key: 'conv_rate', label: 'Conv. Rate', fmt: fP, color: '#14b8a6', axis: 'right' },
  { key: 'cpa', label: 'CPA', fmt: fU, color: '#f97316', axis: 'right' },
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

const TABS = [
  { id: 'campaigns', label: 'Campaigns', title: 'CAMPAIGNS STATISTICS', searchPlaceholder: 'Search by Campaign name...', nameColLabel: 'Campaign Name', totalLabel: (n) => `All Campaigns (${n})` },
  { id: 'adsets', label: 'Ad Sets', title: 'AD SETS STATISTICS', searchPlaceholder: 'Search by Ad Set name...', nameColLabel: 'Ad Set Name', totalLabel: (n) => `All Ad Sets (${n})` },
  { id: 'country', label: 'Country', title: 'COUNTRY STATISTICS', searchPlaceholder: 'Search by Country...', nameColLabel: 'Country', totalLabel: (n) => `All Countries (${n})` },
  { id: 'product', label: 'Product', title: 'PRODUCT STATISTICS', searchPlaceholder: 'Search by Product...', nameColLabel: 'Product', totalLabel: (n) => `All Products (${n})` },
  { id: 'shows', label: 'Show', title: 'SHOW STATISTICS', searchPlaceholder: 'Search by Show...', nameColLabel: 'Show', totalLabel: (n) => `All Shows (${n})` },
  { id: 'placements', label: 'Placements', title: 'PLACEMENTS STATISTICS', searchPlaceholder: 'Search by Placement...', nameColLabel: 'Placement', totalLabel: (n) => `All Placements (${n})` },
  { id: 'day', label: 'Day', title: 'DAY STATISTICS', searchPlaceholder: 'Search by Day...', nameColLabel: 'Day', totalLabel: (n) => `All Days (${n})` },
  { id: 'ads', label: 'Ads', title: 'ADS STATISTICS', searchPlaceholder: 'Search by Ad name...', nameColLabel: 'Ad Name', totalLabel: (n) => `All Ads (${n})` },
  { id: 'platform', label: 'Platform', title: 'PLATFORM STATISTICS', searchPlaceholder: 'Search by Platform...', nameColLabel: 'Platform', totalLabel: (n) => `All Platforms (${n})` },
  { id: 'platformdevice', label: 'Platform Device', title: 'PLATFORM DEVICE STATISTICS', searchPlaceholder: 'Search by Device...', nameColLabel: 'Device', totalLabel: (n) => `All Devices (${n})` },
];

function computeTotals(rows) {
  const t = { impressions: 0, reach: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 };
  rows.forEach((r) => {
    t.impressions += r.impressions || 0;
    t.reach += r.reach || 0;
    t.clicks += r.clicks || 0;
    t.cost += r.cost || 0;
    t.purchases += r.purchases || 0;
    t.revenue += r.revenue || 0;
  });
  t.ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
  t.cpc = t.clicks ? t.cost / t.clicks : 0;
  t.cpm = t.impressions ? (t.cost / (t.impressions / 1000)) : 0;
  return t;
}

function sortRows(rows, col, dir) {
  return [...rows].sort((a, b) => {
    const va = col === 'name' ? a.name : a[col], vb = col === 'name' ? b.name : b[col];
    const d = dir === 'asc' ? 1 : -1;
    if (typeof va === 'string' && typeof vb === 'string') return d * va.localeCompare(vb);
    return d * ((+(va || 0)) - (+(vb || 0)));
  });
}

function paginate(rows, page) {
  const start = (page - 1) * PG, end = start + PG;
  return { rows: rows.slice(start, end), total: rows.length, page, pages: Math.ceil(rows.length / PG) || 1 };
}

function SortTh({ label, col, sort, onSort, align }) {
  const arrow = sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th className={`${align === 'r' ? 'text-right' : ''} gads-sortable`} onClick={() => onSort(col)}>
      {label}{arrow}
    </th>
  );
}

function Pagination({ info, onPage }) {
  if (info.pages <= 1) return null;
  const s = Math.max(1, info.page - 2), e = Math.min(info.pages, info.page + 2);
  const pages = [];
  for (let i = s; i <= e; i++) pages.push(i);
  return (
    <div className="gads-pagination">
      <span className="gads-pg-info">
        Showing {(info.page - 1) * PG + 1}–{Math.min(info.page * PG, info.total)} of {fI(info.total)}
      </span>
      <div className="gads-pg-btns">
        <button className="btn btn-outline btn-sm" disabled={info.page <= 1} onClick={() => onPage(info.page - 1)}>← Prev</button>
        {pages.map((p) => (
          <button key={p} className={`btn btn-sm ${p === info.page ? 'btn-primary' : 'btn-outline'}`} onClick={() => onPage(p)}>{p}</button>
        ))}
        <button className="btn btn-outline btn-sm" disabled={info.page >= info.pages} onClick={() => onPage(info.page + 1)}>Next →</button>
      </div>
    </div>
  );
}

const clamp = { maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const METRIC_COLS = [
  { col: 'impressions', label: 'Impressions', align: 'r', cell: (r) => fI(r.impressions), total: (t) => t ? fI(t.impressions) : '' },
  { col: 'reach', label: 'Reach', align: 'r', cell: (r) => fI(r.reach), total: (t) => t ? fI(t.reach) : '' },
  { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => t ? fI(t.clicks) : '' },
  { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => t ? fU(t.cost) : '' },
  { col: 'purchases', label: 'Purchases', align: 'r', cell: (r) => fI(r.purchases), total: (t) => t ? fI(t.purchases) : '' },
  { col: 'revenue', label: 'Revenue', align: 'r', cell: (r) => fU(r.revenue), total: (t) => t ? fU(t.revenue) : '' },
  { col: 'cpc', label: 'CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => t ? fU(t.cpc) : '' },
  { col: 'cpm', label: 'CPM', align: 'r', cell: (r) => fU(r.cpm), total: (t) => t ? fU(t.cpm) : '' },
  { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => t ? fP(t.ctr) : '' },
];

const META_KPI_LABELS = [
  { key: 'cost', label: 'Total Spend', fmt: fU },
  { key: 'impressions', label: 'Impressions', fmt: fI },
  { key: 'clicks', label: 'Clicks', fmt: fI },
  { key: 'purchases', label: 'Conversions', fmt: fI },
  { key: 'cpa', label: 'CPA', fmt: fU },
  { key: 'roas', label: 'ROAS', fmt: fR },
];

export function MetaReportPage() {
  const { branding, registerExportPdf } = useApp();
  const {
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
  } = useMetaCampaignsData();

  const [activeTab, setActiveTab] = useState('campaigns');
  const [sort, setSort] = useState(() => {
    const o = {};
    TABS.forEach((t) => {
      o[t.id] = t.id === 'day' ? { col: 'name', dir: 'asc' } : { col: 'cost', dir: 'desc' };
    });
    return o;
  });
  const [pg, setPg] = useState(() => {
    const o = {};
    TABS.forEach((t) => { o[t.id] = 1; });
    return o;
  });
  const [kpiCollapsed, setKpiCollapsed] = useState(false);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartActiveMetrics, setChartActiveMetrics] = useState(['cost', 'clicks', 'purchases']);
  const [hiddenCols, setHiddenCols] = useState({});
  const [colEditorOpen, setColEditorOpen] = useState(false);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const colEditorRef = useRef(null);
  const exportPdfRef = useRef(null);
  const [customerId, setCustomerId] = useState('ALL');
  const [productType, setProductType] = useState('all');
  const [deliveryStatus, setDeliveryStatus] = useState('all');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [adGroupSearch, setAdGroupSearch] = useState('');
  const [keywordSearch, setKeywordSearch] = useState('');

  const handleSort = useCallback((tab, col) => {
    setSort((prev) => {
      const s = prev[tab] || { col: 'cost', dir: 'desc' };
      const dir = s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc';
      return { ...prev, [tab]: { col, dir } };
    });
    setPg((prev) => ({ ...prev, [tab]: 1 }));
  }, []);

  const handlePage = useCallback((tab, page) => setPg((prev) => ({ ...prev, [tab]: page })), []);

  const handleApply = useCallback(() => {
    TABS.forEach((t) => setPg((prev) => ({ ...prev, [t.id]: 1 })));
    batchUpdateFilters({
      customerId,
      productType,
      deliveryStatus,
      campaignSearch,
      adGroupSearch,
      keywordSearch,
    });
    setTimeout(() => fetchData(), 0);
  }, [batchUpdateFilters, fetchData, customerId, productType, deliveryStatus, campaignSearch, adGroupSearch, keywordSearch]);

  const handleRetry = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setCustomerId(filters.customerId || 'ALL');
    setProductType(filters.productType || 'all');
    setDeliveryStatus(filters.deliveryStatus || 'all');
    setCampaignSearch(filters.campaignSearch || '');
    setAdGroupSearch(filters.adGroupSearch || '');
    setKeywordSearch(filters.keywordSearch || '');
  }, [filters.customerId, filters.productType, filters.deliveryStatus, filters.campaignSearch, filters.adGroupSearch, filters.keywordSearch]);

  const handleDatePickerApply = useCallback(({ preset, dateFrom, dateTo, compareOn, compareFrom, compareTo }) => {
    batchUpdateFilters({
      datePreset: preset,
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
      compareOn,
      compareFrom: compareFrom || '',
      compareTo: compareTo || '',
    });
    setTimeout(() => fetchData(), 30);
  }, [batchUpdateFilters, fetchData]);

  const toggleColVisibility = useCallback((colKey) => {
    setHiddenCols((prev) => {
      const next = { ...prev };
      if (next[colKey]) delete next[colKey];
      else next[colKey] = true;
      return next;
    });
  }, []);

  const handleCSV = useCallback(() => {
    const dataMap = { campaigns, adsets: adSets, placements, day: days, ads, platform: platforms, platformdevice: platformDevices, country: countries, product: products, shows };
    const currentData = dataMap[activeTab] || [];
    const tabConfig = TABS.find((t) => t.id === activeTab) || TABS[0];
    const allCols = [{ col: 'name', label: tabConfig.nameColLabel, cell: (r) => r.name }, ...METRIC_COLS];
    const visCols = allCols.filter((c) => !hiddenCols[c.col]);
    const csvCols = visCols.map((c) => ({ label: c.label, cell: c.cell }));
    exportCSV(csvCols, currentData, `meta-report-${activeTab}.csv`);
  }, [activeTab, hiddenCols, campaigns, adSets, placements, days, ads, platforms, platformDevices, countries, products, shows]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (colEditorOpen && colEditorRef.current && !colEditorRef.current.contains(e.target)) setColEditorOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [colEditorOpen]);

  const chartTotals = useCallback(() => {
    if (!days.length) return {};
    const s = { cost: 0, impressions: 0, clicks: 0, purchases: 0 };
    days.forEach((d) => {
      s.cost += d.cost || 0;
      s.clicks += d.clicks || 0;
      s.impressions += d.impressions || 0;
      s.purchases += d.purchases || 0;
    });
    return {
      ...s,
      ctr: s.impressions ? (s.clicks / s.impressions) * 100 : 0,
      cpc: s.clicks ? s.cost / s.clicks : 0,
      conv_rate: s.clicks ? (s.purchases / s.clicks) * 100 : 0,
      cpa: s.purchases ? s.cost / s.purchases : 0,
    };
  }, [days]);
  const chartTotalsVal = chartTotals();

  useEffect(() => {
    if (chartCollapsed || !chartRef.current || !days.length) return;
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }
    const labels = days.map((d) => {
      const p = (d.name || '').split('-');
      return p.length >= 3 ? parseInt(p[1], 10) + '/' + parseInt(p[2], 10) : d.name;
    });
    const datasets = [];
    let needsLeft = false;
    let needsRight = false;
    CHART_METRICS.forEach((m) => {
      if (!chartActiveMetrics.includes(m.key)) return;
      const yAxisID = m.axis === 'right' ? 'y1' : 'y';
      if (m.axis === 'right') needsRight = true;
      else needsLeft = true;
      datasets.push({
        label: m.label,
        data: days.map((d) => +(d[m.key] || 0)),
        borderColor: m.color,
        backgroundColor: m.color + '18',
        tension: 0.35,
        fill: false,
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: m.color,
        yAxisID,
      });
    });
    const fmtTick = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v);
    const scales = {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, maxTicksLimit: Math.max(31, (days?.length || 0)), maxRotation: 45 },
      },
    };
    if (needsLeft) scales.y = { type: 'linear', position: 'left', beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11 }, callback: fmtTick } };
    if (needsRight) {
      scales.y1 = { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { font: { size: 11 }, callback: fmtTick } };
      if (!needsLeft) scales.y1.grid = { drawOnChartArea: true, color: 'rgba(0,0,0,0.05)' };
    }
    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: 0 },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } } },
        scales,
      },
    });
    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [days, chartActiveMetrics, chartCollapsed]);

  const toggleChartMetric = (key) => setChartActiveMetrics((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const tabDataMap = {
    campaigns,
    adsets: adSets,
    placements,
    day: days,
    ads,
    platform: platforms,
    platformdevice: platformDevices,
    country: countries,
    product: products,
    shows,
  };

  const currentTabConfig = TABS.find((t) => t.id === activeTab) || TABS[0];
  const currentData = tabDataMap[activeTab] || [];
  const totals = currentData.length ? computeTotals(currentData) : null;
  const defaultSort = activeTab === 'day' ? { col: 'name', dir: 'asc' } : { col: 'cost', dir: 'desc' };
  const s = sort[activeTab] || defaultSort;
  const sorted = sortRows(currentData, s.col, s.dir);
  const info = paginate(sorted, pg[activeTab] || 1);

  const nameCol = {
    col: 'name',
    label: currentTabConfig.nameColLabel,
    dim: true,
    clamp: true,
    cell: (r) => r.name,
    total: (t) => (totals ? currentTabConfig.totalLabel(currentData.length) : ''),
  };
  const tableCols = [nameCol, ...METRIC_COLS];
  const visibleTableCols = tableCols.filter((c) => !hiddenCols[c.col]);

  exportPdfRef.current = () => {
    const dateRangeText = getDateRangeLabel(filters.datePreset, filters.dateFrom, filters.dateTo);
    const kpiList = (kpis && META_KPI_LABELS) ? META_KPI_LABELS.map(({ key, label, fmt }) => ({ label, value: fmt(kpis[key]) })) : [];
    const headers = visibleTableCols.map((c) => c.label);
    const rows = currentData.map((r) => visibleTableCols.map((c) => {
      const v = c.cell(r);
      return typeof v === 'object' && v !== null ? String(r[c.col] ?? '') : v;
    }));
    exportReportPdf({
      reportTitle: 'Meta Performance',
      dateRangeText,
      kpis: kpiList,
      tableHeaders: headers,
      tableRows: rows,
      branding,
      filename: `meta-report-${activeTab}`,
    });
  };

  useEffect(() => {
    registerExportPdf(() => exportPdfRef.current?.());
    return () => registerExportPdf(null);
  }, [registerExportPdf]);

  return (
    <div className="page-section active" id="page-meta-report">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: '#1877F2', color: 'white', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>
                <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z" fill="currentColor"/></svg>
              </span>
              Meta Performance
            </h2>
          </div>
          <DateRangePicker
            preset={filters.datePreset}
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            compareOn={filters.compareOn}
            compareFrom={filters.compareFrom}
            compareTo={filters.compareTo}
            onApply={handleDatePickerApply}
          />
        </div>

        <div className="gads-filter-bar" id="meta-filter-bar">
          <div className="gads-filter-row">
            <div className="gads-filter-group gads-fg-sm">
              <label>Type</label>
              <select value={productType} onChange={(e) => setProductType(e.target.value)}>
                {(filterOptions?.productTypes || []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Status</label>
              <select value={deliveryStatus} onChange={(e) => setDeliveryStatus(e.target.value)}>
                {(filterOptions?.deliveryStatuses || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Campaign</label>
              <input
                type="text"
                placeholder="Search campaigns..."
                className="gads-search-input"
                value={campaignSearch}
                onChange={(e) => setCampaignSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApply()}
              />
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Ad Group</label>
              <input
                type="text"
                placeholder="Search ad groups..."
                className="gads-search-input"
                value={adGroupSearch}
                onChange={(e) => setAdGroupSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApply()}
              />
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Keyword</label>
              <input
                type="text"
                placeholder="Search keywords..."
                className="gads-search-input"
                value={keywordSearch}
                onChange={(e) => setKeywordSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApply()}
              />
            </div>
            <div className="gads-filter-group gads-filter-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-navy btn-sm" onClick={handleApply} disabled={loading} style={{ padding: '6px 20px' }}>
                {loading ? 'Loading…' : 'Apply'}
              </button>
              <span style={{ color: loading ? 'var(--warning)' : error ? 'var(--danger)' : 'var(--accent)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                {loading ? 'Loading…' : error ? 'Error' : 'Live'}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ padding: '16px 20px', background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', margin: '0 0 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleRetry}>Retry</button>
          </div>
        )}

        {/* KPI Section */}
        <div className="gads-kpi-section">
          <div className="gads-kpi-toolbar">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Click metric name to customize</span>
            <button className="btn btn-outline btn-sm" onClick={() => setKpiCollapsed(!kpiCollapsed)}>{kpiCollapsed ? 'Show KPIs ▼' : 'Hide KPIs ▲'}</button>
          </div>
          {!kpiCollapsed && kpis && (
            <div className="kpi-grid-6" id="meta-kpi-grid">
              <div className="rkpi-card"><div className="rkpi-header"><span className="rkpi-icon">💰</span><span className="rkpi-label">Total Spend</span></div><div className="rkpi-value">{fU(kpis.cost)}</div></div>
              <div className="rkpi-card"><div className="rkpi-header"><span className="rkpi-icon">👁</span><span className="rkpi-label">Impressions</span></div><div className="rkpi-value">{fI(kpis.impressions)}</div></div>
              <div className="rkpi-card"><div className="rkpi-header"><span className="rkpi-icon">👆</span><span className="rkpi-label">Clicks</span></div><div className="rkpi-value">{fI(kpis.clicks)}</div></div>
              <div className="rkpi-card"><div className="rkpi-header"><span className="rkpi-icon">🎯</span><span className="rkpi-label">Conversions</span></div><div className="rkpi-value">{fI(kpis.purchases)}</div></div>
              <div className="rkpi-card"><div className="rkpi-header"><span className="rkpi-icon">🏷</span><span className="rkpi-label">CPA</span></div><div className="rkpi-value">{fU(kpis.cpa)}</div></div>
              <div className="rkpi-card"><div className="rkpi-header"><span className="rkpi-icon">🔥</span><span className="rkpi-label">ROAS</span></div><div className="rkpi-value">{fR(kpis.roas)}</div></div>
            </div>
          )}
        </div>

        {/* Daily Trends Section */}
        <div className="gads-chart-section" style={{ minWidth: 0, overflow: 'hidden' }}>
          <div className="gads-chart-toolbar">
            <span className="gads-chart-title">Daily Trends</span>
            <button className="btn btn-outline btn-sm" onClick={() => setChartCollapsed(!chartCollapsed)}>{chartCollapsed ? 'Show Chart ▼' : 'Hide Chart ▲'}</button>
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
                        <span className="gads-metric-val">{m.fmt(chartTotalsVal[m.key] || 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="gads-chart-wrap" style={{ minWidth: 0, maxWidth: '100%' }}><canvas ref={chartRef} style={{ height: 300 }} /></div>
            </>
          )}
        </div>

        <div className="gads-tabs-container">
          <div className="gads-tabs-row">
            <div className="gads-tabs">
              {TABS.map((tab) => {
                const countMap = { campaigns: campaigns.length, adsets: adSets.length, placements: placements.length, day: days.length, ads: ads.length, platform: platforms.length, platformdevice: platformDevices.length, country: countries.length, product: products.length, shows: shows.length };
                const count = countMap[tab.id];
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`gads-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}{count != null ? ` (${count})` : ''}
                  </button>
                );
              })}
            </div>
            <div className="gads-tabs-actions">
              <div style={{ position: 'relative' }} ref={colEditorRef}>
                <button type="button" className={`gads-col-btn${colEditorOpen ? ' active' : ''}`} title="Show/hide columns" onClick={() => setColEditorOpen((v) => !v)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ verticalAlign: '-2px', marginRight: 4 }}><rect x="1" y="1" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="1" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="8" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
                  Columns
                </button>
                {colEditorOpen && (
                  <div className="gads-col-dropdown">
                    <div className="gads-col-dropdown-header">Toggle Columns</div>
                    {tableCols.map((c) => {
                      const hidden = !!hiddenCols[c.col];
                      return (
                        <label key={c.col} className={`gads-col-dropdown-item${!hidden ? ' active' : ''}`}>
                          <input type="checkbox" checked={!hidden} onChange={() => toggleColVisibility(c.col)} />
                          <span>{c.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <button type="button" className="gads-col-btn" title="Download CSV" onClick={handleCSV}>↓ CSV</button>
            </div>
          </div>
        </div>

        <div id="meta-tab-content">
          {loading && <div className="gads-loading"><div className="gads-spinner" /> Loading data...</div>}

          {!loading && (
            <>
              {['country', 'product', 'shows'].includes(activeTab) && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Source: <strong>facebook_campaigns_reference_data</strong> — {currentTabConfig.nameColLabel} matched by campaign name.
                </p>
              )}
              <div className="panel">
                <div className="panel-body no-padding">
                  <div className="table-wrapper">
                    <table className="data-table gads-table">
                      <thead>
                        <tr>
                          {visibleTableCols.map((c) => (
                            <SortTh key={c.col} label={c.label} col={c.col} sort={s} onSort={(col) => handleSort(activeTab, col)} align={c.align} />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="gads-total-row-top">
                          {visibleTableCols.map((c) => (
                            <td key={c.col} className={c.align === 'r' ? 'text-right' : ''}>
                              <strong>{totals && c.total ? c.total(totals) : ''}</strong>
                            </td>
                          ))}
                        </tr>
                        {info.rows.length === 0 && (
                          <tr>
                            <td colSpan={visibleTableCols.length} className="gads-empty-cell">No data found for the selected filters.</td>
                          </tr>
                        )}
                        {info.rows.map((r, i) => (
                          <tr key={r.key || i}>
                            {visibleTableCols.map((c) => (
                              <td
                                key={c.col}
                                className={c.align === 'r' ? 'text-right' : ''}
                                style={c.clamp ? clamp : undefined}
                                title={c.clamp ? c.cell(r) : undefined}
                              >
                                {c.cell(r)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <Pagination info={info} onPage={(p) => handlePage(activeTab, p)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
