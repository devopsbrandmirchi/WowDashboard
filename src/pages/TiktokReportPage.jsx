import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTiktokReportData } from '../hooks/useTiktokReportData';
import { DateRangePicker } from '../components/DatePicker';
import Chart from 'chart.js/auto';
import { exportReportPdf, getDateRangeLabel } from '../utils/exportReportPdf';
import { useApp } from '../context/AppContext';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';
const fR = (n) => Number(n || 0).toFixed(2) + 'x';

const PG = 50;

const TABS = [
  { id: 'campaigns', label: 'Campaigns', nameColLabel: 'Campaign Name', totalLabel: (n) => `All Campaigns (${n})` },
  { id: 'adsets', label: 'Ad Groups', nameColLabel: 'Ad Group Name', totalLabel: (n) => `All Ad Groups (${n})` },
  { id: 'ads', label: 'Ads', nameColLabel: 'Ad Name', totalLabel: (n) => `All Ads (${n})` },
  { id: 'placements', label: 'Placements', nameColLabel: 'Placement', totalLabel: (n) => `All Placements (${n})` },
  { id: 'country', label: 'Country', nameColLabel: 'Country', totalLabel: (n) => `All Countries (${n})` },
  { id: 'product', label: 'Product', nameColLabel: 'Product', totalLabel: (n) => `All Products (${n})` },
  { id: 'shows', label: 'Titles', nameColLabel: 'Title', totalLabel: (n) => `All Titles (${n})` },
  { id: 'day', label: 'Day', nameColLabel: 'Day', totalLabel: (n) => `All Days (${n})` },
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

const KPI_CATALOG = [
  { key: 'cost', label: 'Total Spend', fmt: fU, icon: '💰', category: 'General Performance', inverse: true },
  { key: 'impressions', label: 'Impressions', fmt: fI, icon: '👁', category: 'General Performance', inverse: false },
  { key: 'clicks', label: 'Clicks', fmt: fI, icon: '👆', category: 'General Performance', inverse: false },
  { key: 'ctr', label: 'CTR', fmt: fP, icon: '📊', category: 'General Performance', inverse: false },
  { key: 'cpc', label: 'Avg CPC', fmt: fU, icon: '💵', category: 'General Performance', inverse: true },
  { key: 'purchases', label: 'Conversions', fmt: fI, icon: '🎯', category: 'Conversions', inverse: false },
  { key: 'conv_rate', label: 'Conv. Rate', fmt: fP, icon: '📈', category: 'Conversions', inverse: false },
  { key: 'cpa', label: 'CPA', fmt: fU, icon: '🏷', category: 'Conversions', inverse: true },
  { key: 'roas', label: 'ROAS', fmt: fR, icon: '🔥', category: 'Conversions', inverse: false },
];
const KPI_DEFAULTS = ['cost', 'impressions', 'clicks', 'purchases', 'cpa', 'cpc'];

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

const clamp = { maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function computeTotals(rows) {
  const t = { impressions: 0, clicks: 0, cost: 0, purchases: 0, revenue: 0 };
  rows.forEach((r) => {
    t.impressions += r.impressions || 0;
    t.clicks += r.clicks || 0;
    t.cost += r.cost || 0;
    t.purchases += r.purchases || 0;
    t.revenue += r.revenue || 0;
  });
  t.ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
  t.cpc = t.clicks ? t.cost / t.clicks : 0;
  t.cpm = t.impressions ? (t.cost / (t.impressions / 1000)) : 0;
  t.cpa = t.purchases ? t.cost / t.purchases : 0;
  return t;
}

function sortRows(rows, col, dir) {
  return [...rows].sort((a, b) => {
    const sortCol = col === 'conversions' ? 'purchases' : col;
    const va = sortCol === 'name' ? a.name : a[sortCol];
    const vb = sortCol === 'name' ? b.name : b[sortCol];
    const d = dir === 'asc' ? 1 : -1;
    if (typeof va === 'string' && typeof vb === 'string') return d * va.localeCompare(vb);
    return d * ((+(va || 0)) - (+(vb || 0)));
  });
}

function paginate(rows, page) {
  const start = (page - 1) * PG;
  const end = start + PG;
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
  const s = Math.max(1, info.page - 2);
  const e = Math.min(info.pages, info.page + 2);
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

const METRIC_COLS = [
  { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => t ? fU(t.cost) : '' },
  { col: 'impressions', label: 'Impressions', align: 'r', cell: (r) => fI(r.impressions), total: (t) => t ? fI(t.impressions) : '' },
  { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => t ? fI(t.clicks) : '' },
  { col: 'conversions', label: 'Conversions', align: 'r', cell: (r) => fI(r.purchases), total: (t) => t ? fI(t.purchases) : '' },
  { col: 'purchases', label: 'Purchases', align: 'r', cell: (r) => fI(r.purchases), total: (t) => t ? fI(t.purchases) : '' },
  { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => t ? fU(t.cpa) : '' },
  { col: 'cpm', label: 'CPM', align: 'r', cell: (r) => fU(r.cpm), total: (t) => t ? fU(t.cpm) : '' },
  { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => t ? fP(t.ctr) : '' },
];

export function TiktokReportPage() {
  const { branding, registerExportPdf } = useApp();
  const { filters, batchUpdateFilters, fetchData, loading, error, campaigns, adSets, ads, placements, countries, products, shows, days, kpis, dailyTrends } = useTiktokReportData();

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
  const [kpiSelected, setKpiSelected] = useState(() => {
    try {
      const saved = localStorage.getItem('tiktok_kpi_selection');
      if (saved) { const arr = JSON.parse(saved); if (Array.isArray(arr) && arr.length === 6) return arr; }
    } catch {}
    return KPI_DEFAULTS.slice();
  });
  const [kpiDropdownOpen, setKpiDropdownOpen] = useState(-1);
  const [kpiSearchTerm, setKpiSearchTerm] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [adGroupSearch, setAdGroupSearch] = useState('');
  const [hiddenCols, setHiddenCols] = useState({});
  const [colEditorOpen, setColEditorOpen] = useState(false);
  const colEditorRef = useRef(null);
  const exportPdfRef = useRef(null);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const tabDataMap = {
    campaigns,
    adsets: adSets,
    ads,
    placements,
    country: countries,
    product: products,
    shows,
    day: days,
  };

  const handleApply = useCallback(() => {
    TABS.forEach((t) => setPg((prev) => ({ ...prev, [t.id]: 1 })));
    batchUpdateFilters({ campaignSearch, adGroupSearch });
    setTimeout(() => fetchData(), 0);
  }, [batchUpdateFilters, fetchData, campaignSearch, adGroupSearch]);

  const handleRetry = useCallback(() => fetchData(), [fetchData]);

  const handleDatePickerApply = useCallback(({ preset, dateFrom, dateTo }) => {
    batchUpdateFilters({
      datePreset: preset,
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
    });
    setTimeout(() => fetchData(), 30);
  }, [batchUpdateFilters, fetchData]);

  useEffect(() => {
    setCampaignSearch(filters.campaignSearch || '');
    setAdGroupSearch(filters.adGroupSearch || '');
  }, [filters.campaignSearch, filters.adGroupSearch]);

  const handleSort = useCallback((tab, col) => {
    setSort((prev) => {
      const s = prev[tab] || { col: 'cost', dir: 'desc' };
      const dir = s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc';
      return { ...prev, [tab]: { col, dir } };
    });
    setPg((prev) => ({ ...prev, [tab]: 1 }));
  }, []);

  const handlePage = useCallback((tab, page) => setPg((prev) => ({ ...prev, [tab]: page })), []);

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
      try { localStorage.setItem('tiktok_kpi_selection', JSON.stringify(next)); } catch {}
      return next;
    });
    setKpiDropdownOpen(-1);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (kpiDropdownOpen >= 0 && !e.target.closest('.rkpi-card')) setKpiDropdownOpen(-1);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [kpiDropdownOpen]);

  const toggleColVisibility = useCallback((colKey) => {
    setHiddenCols((prev) => {
      const next = { ...prev };
      if (next[colKey]) delete next[colKey];
      else next[colKey] = true;
      return next;
    });
  }, []);

  const handleCSV = useCallback(() => {
    const dataMap = { campaigns, adsets: adSets, ads, placements, country: countries, product: products, shows, day: days };
    const data = dataMap[activeTab] || [];
    const tabConfig = TABS.find((t) => t.id === activeTab) || TABS[0];
    const nameColForCsv = { col: 'name', label: tabConfig.nameColLabel, cell: (r) => r.name };
    const allCols = [nameColForCsv, ...METRIC_COLS];
    const visCols = allCols.filter((c) => !hiddenCols[c.col]);
    const csvCols = visCols.map((c) => ({ label: c.label, cell: c.cell }));
    exportCSV(csvCols, data, `tiktok-report-${activeTab}.csv`);
  }, [activeTab, hiddenCols, campaigns, adSets, ads, placements, countries, products, shows, days]);

  useEffect(() => {
    const handleClickOutsideCol = (e) => {
      if (colEditorOpen && colEditorRef.current && !colEditorRef.current.contains(e.target)) setColEditorOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutsideCol);
    return () => document.removeEventListener('mousedown', handleClickOutsideCol);
  }, [colEditorOpen]);

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
    total: () => (totals ? currentTabConfig.totalLabel(currentData.length) : ''),
  };
  const tableCols = [nameCol, ...METRIC_COLS];
  const visibleTableCols = tableCols.filter((c) => !hiddenCols[c.col]);

  exportPdfRef.current = () => {
    const dateRangeText = getDateRangeLabel(filters.datePreset, filters.dateFrom, filters.dateTo);
    const kpiList = (kpis && kpiSelected) ? kpiSelected.map((key) => {
      const metric = KPI_CATALOG.find((m) => m.key === key) || KPI_CATALOG[0];
      return { label: metric.label, value: metric.fmt(kpis[key] ?? 0) };
    }) : [];
    const headers = visibleTableCols.map((c) => c.label);
    const rows = currentData.map((r) => visibleTableCols.map((c) => {
      const v = c.cell(r);
      return typeof v === 'object' && v !== null ? String(r[c.col] ?? '') : v;
    }));
    exportReportPdf({
      reportTitle: 'TikTok Ads',
      dateRangeText,
      kpis: kpiList,
      tableHeaders: headers,
      tableRows: rows,
      branding,
      filename: `tiktok-report-${activeTab}`,
    });
  };

  useEffect(() => {
    registerExportPdf(() => exportPdfRef.current?.());
    return () => registerExportPdf(null);
  }, [registerExportPdf]);

  const chartTotals = dailyTrends.length
    ? dailyTrends.reduce(
        (acc, d) => ({
          cost: acc.cost + (d.cost || 0),
          impressions: acc.impressions + (d.impressions || 0),
          clicks: acc.clicks + (d.clicks || 0),
          conversions: acc.conversions + (d.conversions || 0),
        }),
        { cost: 0, impressions: 0, clicks: 0, conversions: 0 }
      )
    : {};
  if (chartTotals.impressions) chartTotals.ctr = (chartTotals.clicks / chartTotals.impressions) * 100;
  else chartTotals.ctr = 0;
  if (chartTotals.clicks) chartTotals.cpc = chartTotals.cost / chartTotals.clicks;
  else chartTotals.cpc = 0;
  if (chartTotals.conversions) chartTotals.conv_rate = (chartTotals.conversions / chartTotals.clicks) * 100;
  else chartTotals.conv_rate = 0;
  if (chartTotals.conversions) chartTotals.cpa = chartTotals.cost / chartTotals.conversions;
  else chartTotals.cpa = 0;

  useEffect(() => {
    if (chartCollapsed || !chartRef.current || !dailyTrends.length) return;
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }
    const labels = dailyTrends.map((d) => {
      const p = (d.date || '').split('-');
      return p.length >= 3 ? parseInt(p[1], 10) + '/' + parseInt(p[2], 10) : d.date;
    });
    const datasets = [];
    let needsLeft = false;
    let needsRight = false;
    CHART_METRICS.forEach((m) => {
      if (!chartActiveMetrics.includes(m.key)) return;
      const yAxisID = m.axis === 'right' ? 'y1' : 'y';
      if (m.axis === 'right') needsRight = true;
      else needsLeft = true;
      const dataKey = m.key === 'conversions' ? 'conversions' : m.key;
      datasets.push({
        label: m.label,
        data: dailyTrends.map((d) => +(d[dataKey] || 0)),
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
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
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
  }, [dailyTrends, chartActiveMetrics, chartCollapsed]);

  const toggleChartMetric = (key) => setChartActiveMetrics((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const countMap = { campaigns: campaigns.length, adsets: adSets.length, ads: ads.length, placements: placements.length, country: countries.length, product: products.length, shows: shows.length, day: days.length };

  return (
    <div className="page-section active" id="page-tiktok-report">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: '#000', color: '#25F4EE', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>
                <svg viewBox="0 0 24 24" width="18" height="18"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-.88-.13 2.89 2.89 0 01-2-2.74 2.89 2.89 0 012.88-2.89c.3 0 .59.04.86.12V9.01a6.38 6.38 0 00-.86-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.48a8.24 8.24 0 004.76 1.5V7.53a4.83 4.83 0 01-1-.84z" fill="currentColor"/></svg>
              </span>
              TikTok Ads
            </h2>
            <p>TikTok campaign performance</p>
          </div>
          <DateRangePicker
            preset={filters.datePreset}
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            compareOn={false}
            compareFrom=""
            compareTo=""
            onApply={handleDatePickerApply}
          />
        </div>

        <div className="gads-filter-bar" id="tiktok-filter-bar">
          <div className="gads-filter-row">
            <div className="gads-filter-group gads-fg-sm">
              <label>Campaign</label>
              <input type="text" placeholder="Search campaigns..." className="gads-search-input" value={campaignSearch} onChange={(e) => setCampaignSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleApply()} />
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Ad Group</label>
              <input type="text" placeholder="Search ad groups..." className="gads-search-input" value={adGroupSearch} onChange={(e) => setAdGroupSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleApply()} />
            </div>
            <div className="gads-filter-group gads-filter-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-navy btn-sm" onClick={handleApply} disabled={loading} style={{ padding: '6px 20px' }}>{loading ? 'Loading…' : 'Apply'}</button>
              <span style={{ color: loading ? 'var(--warning)' : error ? 'var(--danger)' : 'var(--accent)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{loading ? 'Loading…' : error ? 'Error' : 'Live'}</span>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ padding: '16px 20px', background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', margin: '0 0 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleRetry}>Retry</button>
          </div>
        )}

        {/* KPI Section - same as Google Ads */}
        <div className="gads-kpi-section">
          <div className="gads-kpi-toolbar">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Click metric name to customize</span>
            <button className="btn btn-outline btn-sm" onClick={() => setKpiCollapsed(!kpiCollapsed)}>{kpiCollapsed ? 'Show KPIs ▼' : 'Hide KPIs ▲'}</button>
          </div>
          {!kpiCollapsed && (
            <div className="kpi-grid-6" id="tiktok-kpi-grid">
              {kpiSelected.map((metricKey, slotIdx) => {
                const metric = KPI_CATALOG.find((m) => m.key === metricKey) || KPI_CATALOG[0];
                const val = kpis ? metric.fmt(kpis[metric.key] || 0) : '—';
                const isOpen = kpiDropdownOpen === slotIdx;
                const categories = {};
                KPI_CATALOG.forEach((m) => {
                  if (!categories[m.category]) categories[m.category] = [];
                  categories[m.category].push(m);
                });
                return (
                  <div className={`rkpi-card${isOpen ? ' rkpi-open' : ''}`} key={slotIdx}>
                    <div className="rkpi-header" onClick={() => handleKpiToggleDD(slotIdx)}>
                      <span className="rkpi-icon">{metric.icon}</span>
                      <span className="rkpi-label">{metric.label}</span>
                      <svg className="rkpi-caret" width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 3.5L5 6.5L7.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                    </div>
                    <div className="rkpi-value">{val}</div>
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
                                const isCurrent = m.key === metricKey;
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
          )}
        </div>

        {/* Daily Trends Chart - same as Google Ads */}
        <div className="gads-chart-section">
          <div className="gads-chart-toolbar">
            <span className="gads-chart-title">Daily Trends</span>
            <button className="btn btn-outline btn-sm" onClick={() => setChartCollapsed(!chartCollapsed)}>{chartCollapsed ? 'Show Chart ▼' : 'Hide Chart ▲'}</button>
          </div>
          {!chartCollapsed && (
            <>
              <div className="gads-chart-metrics">
                {CHART_METRICS.map((m) => {
                  const active = chartActiveMetrics.includes(m.key);
                  const dataKey = m.key === 'conversions' ? 'conversions' : m.key;
                  return (
                    <div key={m.key} className={`gads-metric-card${active ? ' active' : ''}`} onClick={() => toggleChartMetric(m.key)}>
                      <span className="gads-metric-dot" style={{ background: active ? m.color : 'var(--border)' }} />
                      <div className="gads-metric-info">
                        <span className="gads-metric-name">{m.label}</span>
                        <span className="gads-metric-val">{m.fmt(chartTotals[dataKey] || 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="gads-chart-wrap"><canvas ref={chartRef} style={{ height: 300 }} /></div>
            </>
          )}
        </div>

        {/* Tabs + Table */}
        <div className="gads-tabs-container">
          <div className="gads-tabs-row">
            <div className="gads-tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`gads-tab ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}{countMap[tab.id] != null && !loading ? ` (${countMap[tab.id]})` : ''}
                </button>
              ))}
            </div>
            <div className="gads-tabs-spacer" />
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

        <div id="tiktok-tab-content">
          {loading && <div className="gads-loading"><div className="gads-spinner" /> Loading data...</div>}

          {!loading && (
            <>
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
