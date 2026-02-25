import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGoogleAdsData } from '../hooks/useGoogleAdsData';
import { formatCurrency2, formatNumber, formatDec } from '../utils/format';
import { DateRangePicker } from '../components/DatePicker';
import Chart from 'chart.js/auto';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';
const fR = (n) => Number(n || 0).toFixed(2) + 'x';

const PG = 50;

const TABS = [
  { id: 'campaigntypes', label: 'Campaign Types' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adgroups', label: 'Ad Groups' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'searchterms', label: 'Search Terms' },
  { id: 'geo', label: 'Geo' },
  { id: 'conversions', label: 'Conversions' },
];

const CHART_METRICS = [
  { key: 'cost',        label: 'Cost',       fmt: fU, color: '#ED1C24', axis: 'left' },
  { key: 'impressions', label: 'Impressions',fmt: fI, color: '#2E9E40', axis: 'left' },
  { key: 'clicks',      label: 'Clicks',     fmt: fI, color: '#F5A623', axis: 'left' },
  { key: 'ctr',         label: 'CTR',        fmt: fP, color: '#8b5cf6', axis: 'right' },
  { key: 'cpc',         label: 'CPC',        fmt: fU, color: '#3b82f6', axis: 'right' },
  { key: 'conversions', label: 'Conv.',      fmt: fI, color: '#ec4899', axis: 'left' },
  { key: 'conv_rate',   label: 'Conv. Rate', fmt: fP, color: '#14b8a6', axis: 'right' },
  { key: 'cpa',         label: 'CPA',        fmt: fU, color: '#f97316', axis: 'right' },
];

const statusBadge = (s) => s === 'ENABLED' ? 'badge-green' : s === 'PAUSED' ? 'badge-yellow' : 'badge-red';
const statusLabel = (s) => s === 'ENABLED' ? 'Enabled' : s === 'PAUSED' ? 'Paused' : s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
const clamp = { maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function computeTotals(rows) {
  const t = { _isTotal: true, cost: 0, clicks: 0, impressions: 0, conversions: 0, allConversions: 0, campaign_count: 0, spend_pct: 100 };
  rows.forEach((r) => { t.cost += r.cost || 0; t.clicks += r.clicks || 0; t.impressions += r.impressions || 0; t.conversions += r.conversions || 0; t.allConversions += r.allConversions || 0; t.campaign_count += r.campaign_count || 0; });
  t.ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
  t.cpc = t.clicks ? t.cost / t.clicks : 0;
  t.conv_rate = t.clicks ? (t.conversions / t.clicks) * 100 : 0;
  t.cpa = t.conversions ? t.cost / t.conversions : 0;
  return t;
}

const SUM_FIELDS = ['cost', 'clicks', 'impressions', 'conversions', 'allConversions', 'conversions_value', 'campaign_count'];

function recalcDerived(o) {
  o.ctr = o.impressions ? (o.clicks / o.impressions) * 100 : 0;
  o.cpc = o.clicks ? o.cost / o.clicks : 0;
  o.conv_rate = o.clicks ? (o.conversions / o.clicks) * 100 : 0;
  o.cpa = o.conversions ? o.cost / o.conversions : 0;
  o.roas = o.cost ? (o.conversions_value || 0) / o.cost : 0;
  return o;
}

function pivotAggregate(rows, allColumns, visibleColumns) {
  const dimCols = allColumns.filter((c) => c.dim);
  const hiddenDims = dimCols.filter((c) => !visibleColumns.find((vc) => vc.col === c.col));
  if (!hiddenDims.length) return rows;

  const visibleDimKeys = dimCols
    .filter((c) => visibleColumns.find((vc) => vc.col === c.col))
    .map((c) => c.col);

  const map = new Map();
  rows.forEach((r) => {
    const groupKey = visibleDimKeys.length
      ? visibleDimKeys.map((k) => String(r[k] ?? '')).join('\x00')
      : '__all__';
    if (!map.has(groupKey)) {
      const seed = {};
      visibleDimKeys.forEach((k) => { seed[k] = r[k]; });
      SUM_FIELDS.forEach((k) => { seed[k] = 0; });
      seed._count = 0;
      map.set(groupKey, seed);
    }
    const agg = map.get(groupKey);
    SUM_FIELDS.forEach((k) => { agg[k] += (r[k] || 0); });
    agg._count++;
  });

  const result = [...map.values()].map(recalcDerived);
  const totalCost = result.reduce((s, r) => s + (r.cost || 0), 0);
  if (totalCost > 0) result.forEach((r) => { r.spend_pct = (r.cost / totalCost) * 100; });
  return result;
}

function sortRows(rows, col, dir) {
  return [...rows].sort((a, b) => {
    const va = a[col], vb = b[col], d = dir === 'asc' ? 1 : -1;
    if (typeof va === 'string' && typeof vb === 'string') return d * va.localeCompare(vb);
    return d * ((+(va || 0)) - (+(vb || 0)));
  });
}

function paginate(rows, page) {
  const start = (page - 1) * PG, end = start + PG;
  return { rows: rows.slice(start, end), total: rows.length, page, pages: Math.ceil(rows.length / PG) || 1 };
}

function exportCSV(columns, rows, filename) {
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const body = rows.map((r) => columns.map((c) => {
    const v = c.value(r); return typeof v === 'number' ? v : `"${String(v || '').replace(/"/g, '""')}"`;
  }).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ──────────────── Pagination Component ──────────────── */
function Pagination({ info, onPage }) {
  if (info.pages <= 1) return null;
  const s = Math.max(1, info.page - 2), e = Math.min(info.pages, info.page + 2);
  const pages = [];
  for (let i = s; i <= e; i++) pages.push(i);
  return (
    <div className="gads-pagination">
      <span className="gads-pg-info">Showing {(info.page - 1) * PG + 1}–{Math.min(info.page * PG, info.total)} of {fI(info.total)}</span>
      <div className="gads-pg-btns">
        <button className="btn btn-outline btn-sm" disabled={info.page <= 1} onClick={() => onPage(info.page - 1)}>← Prev</button>
        {pages.map((p) => <button key={p} className={`btn btn-sm ${p === info.page ? 'btn-primary' : 'btn-outline'}`} onClick={() => onPage(p)}>{p}</button>)}
        <button className="btn btn-outline btn-sm" disabled={info.page >= info.pages} onClick={() => onPage(info.page + 1)}>Next →</button>
      </div>
    </div>
  );
}

/* ──────────────── Sortable TH ──────────────── */
function SortTh({ label, col, sort, onSort, align }) {
  const arrow = sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return <th className={`${align === 'r' ? 'text-right' : ''} gads-sortable`} onClick={() => onSort(col)}>{label}{arrow}</th>;
}

/* ──────────────── MAIN COMPONENT ──────────────── */
export function GoogleAdsPage() {
  const { filters, updateFilter, batchUpdateFilters, fetchData, loading, error, customers, channelTypes, kpis, compareKpis, campaignTypes, campaigns, adGroups, keywords, geoData, conversionsData, dailyTrends, compareDailyTrends } = useGoogleAdsData();

  const [activeTab, setActiveTab] = useState('campaigntypes');
  const [kpiCollapsed, setKpiCollapsed] = useState(false);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartActiveMetrics, setChartActiveMetrics] = useState(['cost', 'clicks', 'conversions']);
  const [sort, setSort] = useState({ campaigntypes: { col: 'cost', dir: 'desc' }, campaigns: { col: 'cost', dir: 'desc' }, adgroups: { col: 'cost', dir: 'desc' }, keywords: { col: 'cost', dir: 'desc' }, searchterms: { col: 'cost', dir: 'desc' }, geo: { col: 'cost', dir: 'desc' }, conversions: { col: 'conversions', dir: 'desc' } });
  const [pg, setPg] = useState({ campaigntypes: 1, campaigns: 1, adgroups: 1, keywords: 1, searchterms: 1, geo: 1, conversions: 1 });
  const [expanded, setExpanded] = useState({});
  const [matchFilter, setMatchFilter] = useState('');
  const [hiddenCols, setHiddenCols] = useState({});
  const [colEditorOpen, setColEditorOpen] = useState(false);
  const colEditorRef = useRef(null);

  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    const handleClickOutsideColEditor = (e) => {
      if (colEditorOpen && colEditorRef.current && !colEditorRef.current.contains(e.target)) setColEditorOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutsideColEditor);
    return () => document.removeEventListener('mousedown', handleClickOutsideColEditor);
  }, [colEditorOpen]);

  const toggleColVisibility = useCallback((tabId, colKey) => {
    setHiddenCols((prev) => {
      const key = `${tabId}:${colKey}`;
      const next = { ...prev };
      if (next[key]) delete next[key]; else next[key] = true;
      return next;
    });
  }, []);

  const handleSort = useCallback((tab, col) => {
    setSort((prev) => {
      const s = prev[tab]; const dir = s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc';
      return { ...prev, [tab]: { col, dir } };
    });
    setPg((prev) => ({ ...prev, [tab]: 1 }));
  }, []);

  const handlePage = useCallback((tab, page) => setPg((prev) => ({ ...prev, [tab]: page })), []);

  const toggleExpand = useCallback((key) => {
    setExpanded((prev) => { const n = { ...prev }; if (n[key]) delete n[key]; else n[key] = true; return n; });
  }, []);

  const handleApply = () => { setPg({ campaigntypes: 1, campaigns: 1, adgroups: 1, keywords: 1, searchterms: 1, geo: 1, conversions: 1 }); setExpanded({}); fetchData(); };

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

  /* ── Chart.js with dual Y-axes ── */
  useEffect(() => {
    if (chartCollapsed || !chartRef.current || !dailyTrends.length) return;
    if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; }
    const labels = dailyTrends.map((d) => { const p = d.date.split('-'); return parseInt(p[1]) + '/' + parseInt(p[2]); });
    const datasets = [];
    const hasCompare = compareDailyTrends.length > 0;
    let needsLeftAxis = false, needsRightAxis = false;

    CHART_METRICS.forEach((m) => {
      if (!chartActiveMetrics.includes(m.key)) return;
      const yAxisID = m.axis === 'right' ? 'y1' : 'y';
      if (m.axis === 'right') needsRightAxis = true; else needsLeftAxis = true;
      datasets.push({ label: m.label, data: dailyTrends.map((d) => +(d[m.key] || 0)), borderColor: m.color, backgroundColor: m.color + '18', tension: 0.35, fill: false, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: m.color, yAxisID });
      if (hasCompare) {
        const compData = compareDailyTrends.map((d) => +(d[m.key] || 0));
        while (compData.length < labels.length) compData.push(null);
        datasets.push({
          label: m.label + ' (prev)', data: compData.slice(0, labels.length),
          borderColor: m.color + '80', backgroundColor: 'transparent',
          tension: 0.35, fill: false, borderWidth: 1.5, borderDash: [6, 4],
          pointRadius: 2, pointHoverRadius: 4, pointBackgroundColor: m.color + '80', yAxisID,
        });
      }
    });

    const fmtTick = (v) => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v;
    const scales = { x: { grid: { display: false }, ticks: { font: { size: 11 } } } };

    if (needsLeftAxis) {
      scales.y = { type: 'linear', position: 'left', beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11 }, callback: fmtTick } };
    }
    if (needsRightAxis) {
      scales.y1 = { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { font: { size: 11 }, callback: fmtTick } };
    }
    if (!needsLeftAxis && needsRightAxis) {
      scales.y1.grid.drawOnChartArea = true;
      scales.y1.grid.color = 'rgba(0,0,0,0.05)';
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line', data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } } },
        scales,
      },
    });
    return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; } };
  }, [dailyTrends, compareDailyTrends, chartActiveMetrics, chartCollapsed]);

  const toggleChartMetric = (key) => setChartActiveMetrics((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  /* ── Chart metric totals (ratio metrics recalculated from underlying sums) ── */
  const computeChartTotals = (trends) => {
    if (!trends.length) return {};
    const sums = { cost: 0, clicks: 0, impressions: 0, conversions: 0 };
    trends.forEach((d) => { sums.cost += d.cost || 0; sums.clicks += d.clicks || 0; sums.impressions += d.impressions || 0; sums.conversions += d.conversions || 0; });
    return {
      cost: sums.cost,
      impressions: sums.impressions,
      clicks: sums.clicks,
      conversions: sums.conversions,
      ctr: sums.impressions ? (sums.clicks / sums.impressions) * 100 : 0,
      cpc: sums.clicks ? sums.cost / sums.clicks : 0,
      conv_rate: sums.clicks ? (sums.conversions / sums.clicks) * 100 : 0,
      cpa: sums.conversions ? sums.cost / sums.conversions : 0,
    };
  };
  const chartTotals = computeChartTotals(dailyTrends);
  const chartCompareTotals = computeChartTotals(compareDailyTrends);

  /* ── Helpers for current tab ── */
  const s = sort[activeTab] || { col: 'cost', dir: 'desc' };

  function renderTable(tab, data, allColumns, opts = {}) {
    const columns = allColumns.filter((c) => !hiddenCols[`${tab}:${c.col}`]);
    const pivoted = pivotAggregate(data, allColumns, columns);
    const sorted = sortRows(pivoted, s.col, s.dir);
    const info = paginate(sorted, pg[tab] || 1);
    const totals = computeTotals(pivoted);
    return (
      <>
        {opts.prefix}
        <div className="panel"><div className="panel-body no-padding"><div className="table-wrapper">
          <table className="data-table gads-table">
            <thead><tr>{columns.map((c) => <SortTh key={c.col} label={c.label} col={c.col} sort={s} onSort={(col) => handleSort(tab, col)} align={c.align} />)}</tr></thead>
            <tbody>
              <tr className="gads-total-row-top">{columns.map((c) => <td key={c.col} className={c.align === 'r' ? 'text-right' : ''}><strong>{c.total ? c.total(totals) : ''}</strong></td>)}</tr>
              {info.rows.length === 0 && <tr><td colSpan={columns.length} className="gads-empty-cell">No data found for the selected filters.</td></tr>}
              {info.rows.map((r, i) => {
                const key = opts.rowKey ? opts.rowKey(r) : i;
                const expandKey = opts.expandKey ? opts.expandKey(r) : null;
                const isExpanded = expandKey && expanded[expandKey];
                return (
                  <React.Fragment key={key}>
                    <tr className={opts.expandKey ? 'gads-row-click' : ''} onClick={expandKey ? () => toggleExpand(expandKey) : undefined}>
                      {columns.map((c) => <td key={c.col} className={c.align === 'r' ? 'text-right' : ''} style={c.clamp ? clamp : undefined} title={c.clamp ? c.cell(r) : undefined}>{opts.expandKey && c === columns[0] ? <><span className="gads-expand-arrow">{isExpanded ? '▼' : '▶'}</span> {c.cell(r)}</> : c.cell(r)}</td>)}
                    </tr>
                    {isExpanded && opts.subRows && opts.subRows(r, columns)}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div></div></div>
        <Pagination info={info} onPage={(p) => handlePage(tab, p)} />
      </>
    );
  }

  /* ── Campaign Types Columns ── */
  const campaignTypeCols = [
    { col: 'type', label: 'Campaign Type', dim: true, cell: (r) => <span className="badge badge-blue">{r.type}</span>, total: () => 'Total' },
    { col: 'campaign_count', label: '# Campaigns', align: 'r', cell: (r) => fI(r.campaign_count), total: (t) => fI(t.campaign_count) },
    { col: 'impressions', label: 'Impr.', align: 'r', cell: (r) => fI(r.impressions), total: (t) => fI(t.impressions) },
    { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => fI(t.clicks) },
    { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => fP(t.ctr) },
    { col: 'cpc', label: 'Avg CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => fU(t.cpc) },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'conv_rate', label: 'Conv. Rate', align: 'r', cell: (r) => fP(r.conv_rate), total: (t) => fP(t.conv_rate) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
    { col: 'spend_pct', label: '% Spend', align: 'r', cell: (r) => <><span className="gads-pct-bar" style={{ width: Math.min(r.spend_pct || 0, 100) }} />{fP(r.spend_pct)}</>, total: () => '100.00%' },
  ];

  /* ── Campaigns Columns ── */
  const campaignCols = [
    { col: 'campaign_name', label: 'Campaign Name', dim: true, clamp: true, cell: (r) => r.campaign_name, total: () => 'Total' },
    { col: 'channel_type', label: 'Type', dim: true, cell: (r) => <span className="badge badge-blue">{r.channel_type}</span>, total: () => '' },
    { col: 'campaign_status', label: 'Status', dim: true, cell: (r) => <span className={`badge ${statusBadge(r.campaign_status)}`}>{statusLabel(r.campaign_status)}</span>, total: () => '' },
    { col: 'impressions', label: 'Impr.', align: 'r', cell: (r) => fI(r.impressions), total: (t) => fI(t.impressions) },
    { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => fI(t.clicks) },
    { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => fP(t.ctr) },
    { col: 'cpc', label: 'Avg CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => fU(t.cpc) },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'conv_rate', label: 'Conv. Rate', align: 'r', cell: (r) => fP(r.conv_rate), total: (t) => fP(t.conv_rate) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
  ];

  /* ── Ad Group Columns ── */
  const adGroupCols = [
    { col: 'campaign_name', label: 'Campaign', dim: true, clamp: true, cell: (r) => r.campaign_name, total: () => 'Total' },
    { col: 'ad_group_name', label: 'Ad Group', dim: true, clamp: true, cell: (r) => r.ad_group_name, total: () => '' },
    { col: 'ad_group_status', label: 'Status', dim: true, cell: (r) => <span className={`badge ${statusBadge(r.ad_group_status)}`}>{statusLabel(r.ad_group_status)}</span>, total: () => '' },
    { col: 'impressions', label: 'Impr.', align: 'r', cell: (r) => fI(r.impressions), total: (t) => fI(t.impressions) },
    { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => fI(t.clicks) },
    { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => fP(t.ctr) },
    { col: 'cpc', label: 'Avg CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => fU(t.cpc) },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'conv_rate', label: 'Conv. Rate', align: 'r', cell: (r) => fP(r.conv_rate), total: (t) => fP(t.conv_rate) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
  ];

  /* ── Keyword Columns ── */
  const keywordCols = [
    { col: 'keyword_text', label: 'Keyword', dim: true, clamp: true, cell: (r) => r.keyword_text, total: () => 'Total' },
    { col: 'campaign_name', label: 'Campaign', dim: true, clamp: true, cell: (r) => r.campaign_name || '', total: () => '' },
    { col: 'keyword_match_type', label: 'Match Type', dim: true, cell: (r) => <span className="badge badge-blue">{r.keyword_match_type}</span>, total: () => '' },
    { col: 'impressions', label: 'Impr.', align: 'r', cell: (r) => fI(r.impressions), total: (t) => fI(t.impressions) },
    { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => fI(t.clicks) },
    { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => fP(t.ctr) },
    { col: 'cpc', label: 'Avg CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => fU(t.cpc) },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'conv_rate', label: 'Conv. Rate', align: 'r', cell: (r) => fP(r.conv_rate), total: (t) => fP(t.conv_rate) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
  ];

  /* ── Geo Columns ── */
  const geoCols = [
    { col: 'location', label: 'Location', dim: true, cell: (r) => r.location, total: () => 'Total' },
    { col: 'impressions', label: 'Impr.', align: 'r', cell: (r) => fI(r.impressions), total: (t) => fI(t.impressions) },
    { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => fI(t.clicks) },
    { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => fP(t.ctr) },
    { col: 'cpc', label: 'Avg CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => fU(t.cpc) },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
  ];

  /* ── Conversions Columns ── */
  const conversionCols = [
    { col: 'campaign_name', label: 'Campaign', dim: true, clamp: true, cell: (r) => r.campaign_name, total: () => 'Total' },
    { col: 'channel_type', label: 'Type', dim: true, cell: (r) => <span className="badge badge-blue">{r.channel_type}</span>, total: () => '' },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'allConversions', label: 'All Conv.', align: 'r', cell: (r) => fI(r.allConversions), total: (t) => fI(t.allConversions) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
  ];

  /* ── Filtered keywords for match type ── */
  const filteredKeywords = matchFilter ? keywords.filter((k) => k.keyword_match_type === matchFilter) : keywords;

  /* ── CSV handler (exports what you see, including pivot aggregation) ── */
  const handleCSV = () => {
    const dataMap = { campaigntypes: campaignTypes, campaigns: campaigns, adgroups: adGroups, keywords: filteredKeywords, geo: geoData, conversions: conversionsData };
    const colMap = { campaigntypes: campaignTypeCols, campaigns: campaignCols, adgroups: adGroupCols, keywords: keywordCols, geo: geoCols, conversions: conversionCols };
    const rawData = dataMap[activeTab];
    const allCols = colMap[activeTab];
    if (!rawData || !allCols) return;
    const visCols = allCols.filter((c) => !hiddenCols[`${activeTab}:${c.col}`]);
    const pivoted = pivotAggregate(rawData, allCols, visCols);
    const csvCols = visCols.map((c) => ({ label: c.label, value: (r) => { const v = c.cell(r); return typeof v === 'object' ? (r[c.col] ?? '') : v; } }));
    exportCSV(csvCols, pivoted, `google-ads-${activeTab}.csv`);
  };

  /* ── Campaign expand: sub-rows = ad groups for that campaign, aligned to parent columns ── */
  const subRowCell = (cols, row, colKey) => {
    const c = cols.find((col) => col.col === colKey);
    return c ? c.cell(row) : '';
  };

  const campaignSubRows = (campaign, visibleCols) => {
    const subAgs = adGroups.filter((ag) => String(ag.campaign_id) === String(campaign.campaign_id));
    if (!subAgs.length) return <tr className="gads-sub-wrap"><td colSpan={visibleCols.length} className="gads-empty-cell">No ad groups found</td></tr>;
    const metricKeys = new Set(['impressions', 'clicks', 'ctr', 'cpc', 'cost', 'conversions', 'conv_rate', 'cpa', 'allConversions', 'spend_pct']);
    return subAgs.map((ag) => (
      <tr key={ag.ad_group_id} className="gads-sub-row">
        {visibleCols.map((c, ci) => (
          <td key={c.col} className={c.align === 'r' ? 'text-right' : ''} style={ci === 0 ? { paddingLeft: 32 } : undefined}>
            {ci === 0 ? <><span className="gads-sub-indicator">↳</span> {ag.ad_group_name}</> : metricKeys.has(c.col) ? subRowCell(adGroupCols, ag, c.col) : ''}
          </td>
        ))}
      </tr>
    ));
  };

  /* ── Ad Group expand: sub-rows = keywords, aligned to parent columns ── */
  const adGroupSubRows = (ag, visibleCols) => {
    const subKws = keywords.filter((k) => String(k.ad_group_id) === String(ag.ad_group_id));
    if (!subKws.length) return <tr className="gads-sub-wrap"><td colSpan={visibleCols.length} className="gads-empty-cell">No keywords found</td></tr>;
    const metricKeys = new Set(['impressions', 'clicks', 'ctr', 'cpc', 'cost', 'conversions', 'conv_rate', 'cpa']);
    return subKws.map((kw) => (
      <tr key={kw._key || kw.criterion_id} className="gads-sub-row">
        {visibleCols.map((c, ci) => (
          <td key={c.col} className={c.align === 'r' ? 'text-right' : ''} style={ci === 0 ? { paddingLeft: 32 } : undefined}>
            {ci === 0 ? <><span className="gads-sub-indicator">↳</span> {kw.keyword_text}</> : c.col === 'ad_group_status' ? <span className="badge badge-blue">{kw.keyword_match_type}</span> : metricKeys.has(c.col) ? subRowCell(keywordCols, kw, c.col) : ''}
          </td>
        ))}
      </tr>
    ));
  };

  /* ── Customizable KPI System ── */
  const KPI_CATALOG = [
    { key: 'cost',              label: 'Total Spend',  fmt: fU, icon: '💰', category: 'General Performance', inverse: true },
    { key: 'impressions',       label: 'Impressions',  fmt: fI, icon: '👁', category: 'General Performance', inverse: false },
    { key: 'clicks',            label: 'Clicks',       fmt: fI, icon: '👆', category: 'General Performance', inverse: false },
    { key: 'ctr',               label: 'CTR',          fmt: fP, icon: '📊', category: 'General Performance', inverse: false },
    { key: 'cpc',               label: 'Avg CPC',      fmt: fU, icon: '💵', category: 'General Performance', inverse: true },
    { key: 'conversions',       label: 'Conversions',  fmt: fI, icon: '🎯', category: 'Conversions', inverse: false },
    { key: 'conv_rate',         label: 'Conv. Rate',   fmt: fP, icon: '📈', category: 'Conversions', inverse: false },
    { key: 'conversions_value', label: 'Conv. Value',  fmt: fU, icon: '💎', category: 'Conversions', inverse: false },
    { key: 'cpa',               label: 'CPA',          fmt: fU, icon: '🏷', category: 'Conversions', inverse: true },
    { key: 'roas',              label: 'ROAS',         fmt: fR, icon: '🔥', category: 'Conversions', inverse: false },
  ];
  const KPI_DEFAULTS = ['cost', 'impressions', 'clicks', 'conversions', 'cpa', 'roas'];

  const [kpiSelected, setKpiSelected] = useState(() => {
    try {
      const saved = localStorage.getItem('gads_kpi_selection');
      if (saved) { const arr = JSON.parse(saved); if (Array.isArray(arr) && arr.length === 6) return arr; }
    } catch {}
    return KPI_DEFAULTS.slice();
  });
  const [kpiDropdownOpen, setKpiDropdownOpen] = useState(-1);
  const [kpiSearchTerm, setKpiSearchTerm] = useState('');

  const saveKpiSelection = useCallback((sel) => {
    setKpiSelected(sel);
    try { localStorage.setItem('gads_kpi_selection', JSON.stringify(sel)); } catch {}
  }, []);

  const handleKpiToggleDD = useCallback((idx) => {
    setKpiDropdownOpen((prev) => prev === idx ? -1 : idx);
    setKpiSearchTerm('');
  }, []);

  const handleKpiSelect = useCallback((slotIdx, newKey) => {
    setKpiSelected((prev) => {
      const next = prev.slice();
      const existingIdx = next.indexOf(newKey);
      if (existingIdx >= 0 && existingIdx !== slotIdx) {
        next[existingIdx] = next[slotIdx];
      }
      next[slotIdx] = newKey;
      try { localStorage.setItem('gads_kpi_selection', JSON.stringify(next)); } catch {}
      return next;
    });
    setKpiDropdownOpen(-1);
  }, []);

  useEffect(() => {
    const handleClickOutsideKpi = (e) => {
      if (kpiDropdownOpen >= 0 && !e.target.closest('.rkpi-card')) {
        setKpiDropdownOpen(-1);
      }
    };
    document.addEventListener('click', handleClickOutsideKpi);
    return () => document.removeEventListener('click', handleClickOutsideKpi);
  }, [kpiDropdownOpen]);

  const kpiDelta = (current, previous, inverse) => {
    if (!compareKpis || previous == null) return null;
    if (previous === 0 && current === 0) return null;
    const pct = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : (current > 0 ? 100 : 0);
    const up = pct >= 0;
    const isGood = inverse ? !up : up;
    return { pct, up, isGood };
  };

  return (
    <div className="page-section active" id="page-google-ads">
      <div className="page-content">
        {/* ── Page Title Bar with Date Picker ── */}
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: '#4285F4', color: 'white', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>G</span>
              Google Ads
            </h2>
            <p>Campaign performance across Search, PMax, Shopping, Display & more</p>
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

        {/* ── Filter Bar ── */}
        <div className="gads-filter-bar" id="gads-filter-bar">
          <div className="gads-filter-row">
            <div className="gads-filter-group gads-fg-sm">
              <label>Customer</label>
              <select value={filters.customerId} onChange={(e) => updateFilter('customerId', e.target.value)}>
                <option value="ALL">All Customers</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm"><label>Type</label>
              <select value={filters.channelType} onChange={(e) => updateFilter('channelType', e.target.value)}>
                <option value="all">All Types</option>{channelTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm"><label>Status</label>
              <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
                <option value="all">All</option><option value="ENABLED">Enabled</option><option value="PAUSED">Paused</option><option value="REMOVED">Removed</option>
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm"><label>Campaign</label>
              <input type="text" placeholder="Search campaigns..." className="gads-search-input" value={filters.campaignSearch} onChange={(e) => updateFilter('campaignSearch', e.target.value)} />
            </div>
            <div className="gads-filter-group gads-fg-sm"><label>Ad Group</label>
              <input type="text" placeholder="Search ad groups..." className="gads-search-input" value={filters.adGroupSearch} onChange={(e) => updateFilter('adGroupSearch', e.target.value)} />
            </div>
            <div className="gads-filter-group gads-fg-sm"><label>Keyword</label>
              <input type="text" placeholder="Search keywords..." className="gads-search-input" value={filters.keywordSearch} onChange={(e) => updateFilter('keywordSearch', e.target.value)} />
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
            <button type="button" className="btn btn-primary btn-sm" onClick={handleApply}>Retry</button>
          </div>
        )}

        {/* ── KPI Section (6-card customizable grid) ── */}
        <div className="gads-kpi-section">
          <div className="gads-kpi-toolbar">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Click metric name to customize</span>
            <button className="btn btn-outline btn-sm" onClick={() => setKpiCollapsed(!kpiCollapsed)}>{kpiCollapsed ? 'Show KPIs ▼' : 'Hide KPIs ▲'}</button>
          </div>
          {!kpiCollapsed && (
            <div className="kpi-grid-6" id="gads-kpi-grid">
              {kpiSelected.map((metricKey, slotIdx) => {
                const metric = KPI_CATALOG.find((m) => m.key === metricKey) || KPI_CATALOG[0];
                const val = kpis ? metric.fmt(kpis[metric.key] || 0) : '—';
                const d = kpis && compareKpis ? kpiDelta(kpis[metric.key] || 0, compareKpis[metric.key] || 0, metric.inverse) : null;
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
                    {d && (
                      <div className={`kpi-compare ${d.isGood ? 'kpi-compare-good' : 'kpi-compare-bad'}`}>
                        <span className="kpi-prev">vs {metric.fmt(compareKpis[metric.key] || 0)}</span>
                        <span className="kpi-compare-arrow">{d.up ? '▲' : '▼'}</span>
                        <span className="kpi-compare-pct">{Math.abs(d.pct).toFixed(1)}%</span>
                      </div>
                    )}
                    {isOpen && (
                      <div className="rkpi-dropdown" onClick={(e) => e.stopPropagation()}>
                        <div className="rkpi-dd-search">
                          <input
                            type="text"
                            placeholder="Search metrics..."
                            className="rkpi-dd-input"
                            value={kpiSearchTerm}
                            onChange={(e) => setKpiSearchTerm(e.target.value)}
                            autoFocus
                          />
                        </div>
                        {Object.keys(categories).map((cat) => {
                          const items = categories[cat].filter((m) =>
                            !kpiSearchTerm || m.label.toLowerCase().includes(kpiSearchTerm.toLowerCase())
                          );
                          if (!items.length) return null;
                          return (
                            <div className="rkpi-dd-group" key={cat}>
                              <div className="rkpi-dd-cat">{cat}</div>
                              {items.map((m) => {
                                const isCurrent = m.key === metricKey;
                                const inUse = kpiSelected.includes(m.key) && !isCurrent;
                                return (
                                  <div
                                    key={m.key}
                                    className={`rkpi-dd-item${isCurrent ? ' selected' : ''}${inUse ? ' in-use' : ''}`}
                                    onClick={() => handleKpiSelect(slotIdx, m.key)}
                                  >
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

        {/* ── Chart Section ── */}
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
                  const compVal = chartCompareTotals[m.key];
                  return (
                    <div key={m.key} className={`gads-metric-card${active ? ' active' : ''}`} onClick={() => toggleChartMetric(m.key)}>
                      <span className="gads-metric-dot" style={{ background: active ? m.color : 'var(--border)' }} />
                      <div className="gads-metric-info">
                        <span className="gads-metric-name">{m.label}</span>
                        <span className="gads-metric-val">{m.fmt(chartTotals[m.key] || 0)}</span>
                        {compVal != null && <span className="gads-metric-comp">vs {m.fmt(compVal)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="gads-chart-wrap"><canvas ref={chartRef} style={{ height: 300 }} /></div>
            </>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="gads-tabs-container">
          <div className="gads-tabs-row">
            <div className="gads-tabs">
              {TABS.map((tab) => {
                const countMap = { campaigntypes: campaignTypes.length, campaigns: campaigns.length, adgroups: adGroups.length, keywords: keywords.length, geo: geoData.length, conversions: conversionsData.length };
                const count = countMap[tab.id];
                return <button key={tab.id} type="button" className={`gads-tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>{tab.label}{count != null && !loading ? ` (${count})` : ''}</button>;
              })}
            </div>
            <div className="gads-tabs-actions">
              <div style={{ position: 'relative' }} ref={colEditorRef}>
                <button type="button" className={`gads-col-btn${colEditorOpen ? ' active' : ''}`} title="Show/hide columns" onClick={() => setColEditorOpen((v) => !v)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ verticalAlign: '-2px', marginRight: 4 }}><rect x="1" y="1" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="1" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="8" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
                  Columns
                </button>
                {colEditorOpen && (() => {
                  const allCols = { campaigntypes: campaignTypeCols, campaigns: campaignCols, adgroups: adGroupCols, keywords: keywordCols, geo: geoCols, conversions: conversionCols }[activeTab] || [];
                  return (
                    <div className="gads-col-dropdown">
                      <div className="gads-col-dropdown-header">Toggle Columns</div>
                      {allCols.map((c) => {
                        const key = `${activeTab}:${c.col}`;
                        const hidden = !!hiddenCols[key];
                        return (
                          <label key={c.col} className={`gads-col-dropdown-item${!hidden ? ' active' : ''}`}>
                            <input type="checkbox" checked={!hidden} onChange={() => toggleColVisibility(activeTab, c.col)} />
                            <span>{c.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              <button type="button" className="gads-col-btn" title="Download CSV" onClick={handleCSV}>↓ CSV</button>
            </div>
          </div>
        </div>

        {/* ── Tab Content ── */}
        <div id="gads-tab-content">
          {loading && <div className="gads-loading"><div className="gads-spinner" /> Loading data...</div>}

          {!loading && activeTab === 'campaigntypes' && renderTable('campaigntypes', campaignTypes, campaignTypeCols, { rowKey: (r) => r.type })}

          {!loading && activeTab === 'campaigns' && renderTable('campaigns', campaigns, campaignCols, {
            rowKey: (r) => r.campaign_id,
            expandKey: (r) => 'c_' + r.campaign_id,
            subRows: campaignSubRows,
          })}

          {!loading && activeTab === 'adgroups' && renderTable('adgroups', adGroups, adGroupCols, {
            rowKey: (r) => r.ad_group_id,
            expandKey: (r) => 'ag_' + r.ad_group_id,
            subRows: adGroupSubRows,
          })}

          {!loading && activeTab === 'keywords' && renderTable('keywords', filteredKeywords, keywordCols, {
            rowKey: (r) => r._key || r.criterion_id,
            prefix: (
              <div className="gads-sub-filters">
                <span className="gads-sf-label">Match Type:</span>
                {['', 'BROAD', 'PHRASE', 'EXACT'].map((mt) => (
                  <button key={mt} className={`btn btn-sm ${matchFilter === mt ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setMatchFilter(mt); setPg((p) => ({ ...p, keywords: 1 })); }}>{mt || 'All'}</button>
                ))}
              </div>
            ),
          })}

          {!loading && activeTab === 'searchterms' && <div className="gads-empty">Search terms data requires a <strong>google_search_terms_data</strong> table in Supabase.</div>}

          {!loading && activeTab === 'geo' && renderTable('geo', geoData, geoCols, { rowKey: (r) => r.location })}

          {!loading && activeTab === 'conversions' && renderTable('conversions', conversionsData, conversionCols, { rowKey: (r) => r.campaign_id })}
        </div>
      </div>
    </div>
  );
}
