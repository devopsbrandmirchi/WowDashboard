import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSubscriptionsData } from '../hooks/useSubscriptionsData';
import { formatCurrency2, formatNumber, formatDec } from '../utils/format';
import { DateRangePicker } from '../components/DatePicker';
import Chart from 'chart.js/auto';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';

const PG = 50;

const TABS = [
  { id: 'plans', label: 'Plans' },
  { id: 'countries', label: 'Countries' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'churn', label: 'Churn Reasons' },
];

const CHART_METRICS = [
  { key: 'newSubscribers', label: 'New Subscribers', fmt: fI, color: '#2E9E40', axis: 'left' },
  { key: 'cancellations', label: 'Cancellations', fmt: fI, color: '#ED1C24', axis: 'left' },
  { key: 'trialsStarted', label: 'Trials Started', fmt: fI, color: '#1AB7EA', axis: 'left' },
  { key: 'trialConversions', label: 'Trial Conv.', fmt: fI, color: '#8B3F8E', axis: 'left' },
  { key: 'revenue', label: 'Revenue', fmt: fU, color: '#F5A623', axis: 'right' },
];

const KPI_LIST = [
  { key: 'totalActive', label: 'TOTAL ACTIVE', fmt: fI, inverse: false },
  { key: 'newSubscribers', label: 'NEW SUBSCRIBERS', fmt: fI, inverse: false },
  { key: 'cancellations', label: 'CANCELLATIONS', fmt: fI, inverse: true },
  { key: 'netGrowth', label: 'NET GROWTH', fmt: (v) => (v >= 0 ? '+' : '') + fI(v), inverse: false },
  { key: 'mrr', label: 'MRR', fmt: fU, inverse: false },
  { key: 'trialsStarted', label: 'TRIALS STARTED', fmt: fI, inverse: false },
  { key: 'trialConversions', label: 'TRIAL CONVERSIONS', fmt: fI, inverse: false },
  { key: 'convRate', label: 'CONV. RATE', fmt: (v) => fP(v), inverse: false },
  { key: 'avgRevenue', label: 'AVG REVENUE', fmt: fU, inverse: false },
  { key: 'churnRate', label: 'CHURN RATE', fmt: (v) => fP(v), inverse: true },
];

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
    const v = c.value ? c.value(r) : r[c.col];
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

const SUB_EXPAND_COLS = [
  { key: 'vimeo_email', label: 'Email' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'country', label: 'Country' },
  { key: 'state', label: 'State' },
  { key: 'current_plan', label: 'Plan' },
  { key: 'status', label: 'Status' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'subscription_price', label: 'Price', fmt: (v) => formatCurrency2(v) },
  { key: 'date_became_enabled', label: 'Date Enabled', fmt: (v) => v ? new Date(v).toLocaleDateString() : '' },
  { key: 'customer_created_at', label: 'Customer Created', fmt: (v) => v ? new Date(v).toLocaleDateString() : '' },
];

function SubscriberListPanel({ rows, loading, onClose }) {
  if (loading) return <div className="sub-kpi-expand-panel"><div className="sub-kpi-expand-header"><span>Loading...</span><button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Close</button></div><div className="gads-loading"><div className="gads-spinner" /></div></div>;
  if (!rows || rows.length === 0) return (
    <div className="sub-kpi-expand-panel">
      <div className="sub-kpi-expand-header">
        <span>No records found</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
      </div>
    </div>
  );
  return (
    <div className="sub-kpi-expand-panel">
      <div className="sub-kpi-expand-header">
        <span>{formatNumber(rows.length)} subscribers</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
      </div>
      <div className="table-wrapper">
        <table className="data-table gads-table">
          <thead>
            <tr>
              {SUB_EXPAND_COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r, i) => (
              <tr key={r.record_id || i}>
                {SUB_EXPAND_COLS.map((c) => (
                  <td key={c.key}>
                    {c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? r.email ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 100 && <p className="sub-expand-more">Showing first 100 of {formatNumber(rows.length)}</p>}
    </div>
  );
}

function SortTh({ label, col, sort, onSort, align }) {
  const arrow = sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return <th className={`${align === 'r' ? 'text-right' : ''} gads-sortable`} onClick={() => onSort(col)}>{label}{arrow}</th>;
}

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

export function SubscriptionsPage() {
  const {
    filters, batchUpdateFilters, fetchData, loading, error,
    kpis, compareKpis, dailyTrends, compareDailyTrends,
    plansData, countriesData, platformsData, churnReasonsData,
    fetchEmailList, emailListLoading,
  } = useSubscriptionsData();

  const [activeTab, setActiveTab] = useState('plans');
  const [kpiCollapsed, setKpiCollapsed] = useState(false);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartActiveMetrics, setChartActiveMetrics] = useState(['newSubscribers', 'cancellations']);
  const [kpiExpanded, setKpiExpanded] = useState(null);
  const [kpiExpandedRows, setKpiExpandedRows] = useState([]);
  const kpiFetchKeyRef = useRef(null);
  const [sort, setSort] = useState({ plans: { col: 'subscribers', dir: 'desc' }, countries: { col: 'active', dir: 'desc' }, platforms: { col: 'active', dir: 'desc' }, churn: { col: 'count', dir: 'desc' } });
  const [pg, setPg] = useState({ plans: 1, countries: 1, platforms: 1, churn: 1 });
  const [expanded, setExpanded] = useState({});
  const [expandedRowData, setExpandedRowData] = useState({});
  const [hiddenCols, setHiddenCols] = useState({});
  const [colEditorOpen, setColEditorOpen] = useState(false);
  const colEditorRef = useRef(null);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const [viewFilter, setViewFilter] = useState('Total');
  const [typeFilter, setTypeFilter] = useState('Subscriptions & Trials');
  const [segmentFilter, setSegmentFilter] = useState('Choose segment');
  const [granularity, setGranularity] = useState('Daily');

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (colEditorOpen && colEditorRef.current && !colEditorRef.current.contains(e.target)) setColEditorOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      const s = prev[tab] || { col: 'subscribers', dir: 'desc' };
      const dir = s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc';
      return { ...prev, [tab]: { col, dir } };
    });
    setPg((prev) => ({ ...prev, [tab]: 1 }));
  }, []);

  const handlePage = useCallback((tab, page) => setPg((prev) => ({ ...prev, [tab]: page })), []);

  const toggleExpand = useCallback((key) => {
    setExpanded((prev) => { const n = { ...prev }; if (n[key]) delete n[key]; else n[key] = true; return n; });
  }, []);

  useEffect(() => {
    const keys = Object.keys(expanded).filter((k) => expanded[k]);
    keys.forEach((expandKey) => {
      if (expandedRowData[expandKey]) return;
      const m = expandKey.match(/^(plan|country|platform|churn)_(.+)$/);
      if (!m) return;
      const [, type, filterKey] = m;
      const metricKey = type === 'plan' ? 'by_plan' : type === 'country' ? 'by_country' : type === 'platform' ? 'by_platform' : 'by_churn_reason';
      setExpandedRowData((prev) => ({ ...prev, [expandKey]: { loading: true, rows: [] } }));
      fetchEmailList(metricKey, filterKey).then((rows) => {
        setExpandedRowData((prev) => ({ ...prev, [expandKey]: { loading: false, rows } }));
      });
    });
  }, [expanded, fetchEmailList]);

  const handleDatePickerApply = useCallback(({ preset, dateFrom, dateTo, compareOn, compareFrom, compareTo }) => {
    batchUpdateFilters({ datePreset: preset, dateFrom: dateFrom || '', dateTo: dateTo || '', compareOn, compareFrom: compareFrom || '', compareTo: compareTo || '' });
    setTimeout(() => fetchData(), 30);
  }, [batchUpdateFilters, fetchData]);

  const handleKpiClick = useCallback(async (key) => {
    const expandable = ['totalActive', 'cancellations', 'trialsStarted', 'trialConversions', 'mrr', 'avgRevenue', 'churnRate', 'newSubscribers'];
    if (!expandable.includes(key)) return;
    if (kpiExpanded === key) {
      setKpiExpanded(null);
      setKpiExpandedRows([]);
      return;
    }
    setKpiExpanded(key);
    setKpiExpandedRows([]);
    kpiFetchKeyRef.current = key;
    const metricKey = key === 'totalActive' ? 'totalActive' : key === 'newSubscribers' ? 'newSubscribers' : key === 'cancellations' ? 'cancellations' : key === 'trialsStarted' ? 'trialsStarted' : key === 'trialConversions' ? 'trialConversions' : key === 'mrr' || key === 'avgRevenue' ? 'totalActive' : key === 'churnRate' ? 'cancellations' : 'totalActive';
    const rows = await fetchEmailList(metricKey);
    if (kpiFetchKeyRef.current === key) setKpiExpandedRows(rows);
  }, [kpiExpanded, fetchEmailList]);

  const kpiDelta = (current, previous, inverse) => {
    if (!compareKpis || previous == null) return null;
    if (previous === 0 && current === 0) return null;
    const pct = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : (current > 0 ? 100 : 0);
    const up = pct >= 0;
    const isGood = inverse ? !up : up;
    return { pct, up, isGood };
  };

  useEffect(() => {
    if (chartCollapsed || !chartRef.current || !dailyTrends.length) return;
    if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; }
    const labels = dailyTrends.map((d) => { const p = d.date.split('-'); return parseInt(p[1]) + '/' + parseInt(p[2]); });
    const datasets = [];
    const hasCompare = compareDailyTrends.length > 0;

    CHART_METRICS.forEach((m) => {
      if (!chartActiveMetrics.includes(m.key)) return;
      const yAxisID = m.axis === 'right' ? 'y1' : 'y';
      datasets.push({ label: m.label, data: dailyTrends.map((d) => +(d[m.key] || 0)), borderColor: m.color, backgroundColor: m.color + '18', tension: 0.35, fill: false, borderWidth: 2.5, pointRadius: 3, yAxisID });
      if (hasCompare) {
        const compData = compareDailyTrends.map((d) => +(d[m.key] || 0));
        while (compData.length < labels.length) compData.push(null);
        datasets.push({ label: m.label + ' (prev)', data: compData.slice(0, labels.length), borderColor: m.color + '80', backgroundColor: 'transparent', tension: 0.35, fill: false, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 2, yAxisID });
      }
    });

    const fmtTick = (v) => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v;
    const scales = { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: fmtTick } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: fmtTick } } };

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line', data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, position: 'bottom' } }, scales },
    });
    return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; } };
  }, [dailyTrends, compareDailyTrends, chartActiveMetrics, chartCollapsed]);

  const chartTotals = React.useMemo(() => {
    if (!dailyTrends.length) return {};
    const sums = { newSubscribers: 0, cancellations: 0, trialsStarted: 0, trialConversions: 0, revenue: 0 };
    dailyTrends.forEach((d) => { sums.newSubscribers += d.newSubscribers || 0; sums.cancellations += d.cancellations || 0; sums.trialsStarted += d.trialsStarted || 0; sums.trialConversions += d.trialConversions || 0; sums.revenue += d.revenue || 0; });
    return sums;
  }, [dailyTrends]);

  const chartCompareTotals = React.useMemo(() => {
    if (!compareDailyTrends.length) return {};
    const sums = { newSubscribers: 0, cancellations: 0, trialsStarted: 0, trialConversions: 0, revenue: 0 };
    compareDailyTrends.forEach((d) => { sums.newSubscribers += d.newSubscribers || 0; sums.cancellations += d.cancellations || 0; sums.trialsStarted += d.trialsStarted || 0; sums.trialConversions += d.trialConversions || 0; sums.revenue += d.revenue || 0; });
    return sums;
  }, [compareDailyTrends]);

  const toggleChartMetric = (key) => setChartActiveMetrics((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  function renderTable(tab, data, allColumns, opts = {}) {
    const columns = allColumns.filter((c) => !hiddenCols[`${tab}:${c.col}`]);
    const s = sort[tab] || { col: columns[0]?.col, dir: 'desc' };
    const sorted = sortRows(data, s.col, s.dir);
    const info = paginate(sorted, pg[tab] || 1);
    const totalRow = opts.totalRow ? opts.totalRow(data) : null;

    return (
      <>
        <div className="panel"><div className="panel-body no-padding"><div className="table-wrapper">
          <table className="data-table gads-table">
            <thead><tr>{columns.map((c) => <SortTh key={c.col} label={c.label} col={c.col} sort={s} onSort={(col) => handleSort(tab, col)} align={c.align} />)}</tr></thead>
            <tbody>
              {totalRow && <tr className="gads-total-row-top">{columns.map((c) => <td key={c.col} className={c.align === 'r' ? 'text-right' : ''}><strong>{c.total ? c.total(totalRow) : ''}</strong></td>)}</tr>}
              {info.rows.length === 0 && <tr><td colSpan={columns.length} className="gads-empty-cell">No data found.</td></tr>}
              {info.rows.map((r, i) => {
                const key = opts.rowKey ? opts.rowKey(r) : i;
                const expandKey = opts.expandKey ? opts.expandKey(r) : null;
                const isExpanded = expandKey && expanded[expandKey];
                return (
                  <React.Fragment key={key}>
                    <tr className={opts.expandKey ? 'gads-row-click' : ''} onClick={expandKey ? () => toggleExpand(expandKey) : undefined}>
                      {columns.map((c) => (
                        <td key={c.col} className={c.align === 'r' ? 'text-right' : ''}>
                          {opts.expandKey && c === columns[0] ? <><span className="gads-expand-arrow">{isExpanded ? '▼' : '▶'}</span> {c.cell(r)}</> : c.cell(r)}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && opts.subRows && opts.subRows(expandKey)}
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

  const subRowContent = (expandKey) => {
    const data = expandedRowData[expandKey];
    const rows = data?.rows || [];
    const loading = data?.loading;
    if (loading) return <tr className="gads-sub-wrap"><td colSpan={20} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}><div className="gads-spinner" style={{ display: 'inline-block', marginRight: 8 }} /> Loading subscribers...</td></tr>;
    return (
    <tr className="gads-sub-wrap"><td colSpan={20} style={{ padding: 0, border: 'none', verticalAlign: 'top' }}>
      <div className="gads-sub-table-wrap">
        <table className="data-table gads-table gads-sub-table">
          <thead><tr>{SUB_EXPAND_COLS.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={r.record_id || r.id || i} className="gads-sub-row">
                {SUB_EXPAND_COLS.map((c) => (
                  <td key={c.key}>{c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? r.email ?? '—')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 50 && <p style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)' }}>Showing first 50 of {formatNumber(rows.length)}</p>}
        {rows.length === 0 && !loading && <p style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>No subscribers found.</p>}
      </div>
    </td></tr>
  );
  };

  const plansCols = [
    { col: 'planName', label: 'Plan Name', cell: (r) => r.planName, total: () => 'Total' },
    { col: 'subscribers', label: '# Subscribers', align: 'r', cell: (r) => fI(r.subscribers), total: (t) => t ? fI(t.subscribers) : '' },
    { col: 'new', label: 'New (period)', align: 'r', cell: (r) => fI(r.new), total: (t) => t ? fI(t.new) : '' },
    { col: 'cancelled', label: 'Cancelled (period)', align: 'r', cell: (r) => fI(r.cancelled), total: (t) => t ? fI(t.cancelled) : '' },
    { col: 'net', label: 'Net', align: 'r', cell: (r) => fI(r.net), total: () => '' },
    { col: 'avgPrice', label: 'Avg Price', align: 'r', cell: (r) => fU(r.avgPrice), total: () => '' },
    { col: 'totalRevenue', label: 'Total Revenue', align: 'r', cell: (r) => fU(r.totalRevenue), total: () => '' },
    { col: 'churnRate', label: 'Churn Rate', align: 'r', cell: (r) => fP(r.churnRate), total: () => '' },
    { col: 'pctOfTotal', label: '% of Total', align: 'r', cell: (r) => fP(r.pctOfTotal), total: () => '100%' },
  ];

  const countriesCols = [
    { col: 'country', label: 'Country', cell: (r) => r.country, total: () => 'Total' },
    { col: 'active', label: '# Active', align: 'r', cell: (r) => fI(r.active), total: (t) => t ? fI(t.active) : '' },
    { col: 'new', label: 'New (period)', align: 'r', cell: (r) => fI(r.new), total: (t) => t ? fI(t.new) : '' },
    { col: 'cancelled', label: 'Cancelled (period)', align: 'r', cell: (r) => fI(r.cancelled), total: (t) => t ? fI(t.cancelled) : '' },
    { col: 'net', label: 'Net', align: 'r', cell: (r) => fI(r.net), total: () => '' },
    { col: 'avgPrice', label: 'Avg Price', align: 'r', cell: (r) => fU(r.avgPrice), total: () => '' },
    { col: 'avgLifetimeValue', label: 'Avg LTV', align: 'r', cell: (r) => fU(r.avgLifetimeValue), total: () => '' },
    { col: 'churnRate', label: 'Churn Rate', align: 'r', cell: (r) => fP(r.churnRate), total: () => '' },
    { col: 'pctOfTotal', label: '% of Total', align: 'r', cell: (r) => fP(r.pctOfTotal), total: () => '100%' },
  ];

  const platformsCols = [
    { col: 'platform', label: 'Platform', cell: (r) => r.platform, total: () => 'Total' },
    { col: 'active', label: '# Active', align: 'r', cell: (r) => fI(r.active), total: (t) => t ? fI(t.active) : '' },
    { col: 'new', label: 'New (period)', align: 'r', cell: (r) => fI(r.new), total: (t) => t ? fI(t.new) : '' },
    { col: 'cancelled', label: 'Cancelled (period)', align: 'r', cell: (r) => fI(r.cancelled), total: (t) => t ? fI(t.cancelled) : '' },
    { col: 'monthly', label: 'Monthly', align: 'r', cell: (r) => fI(r.monthly), total: () => '' },
    { col: 'yearly', label: 'Yearly', align: 'r', cell: (r) => fI(r.yearly), total: () => '' },
    { col: 'avgPrice', label: 'Avg Price', align: 'r', cell: (r) => fU(r.avgPrice), total: () => '' },
    { col: 'pctOfTotal', label: '% of Total', align: 'r', cell: (r) => fP(r.pctOfTotal), total: () => '100%' },
  ];

  const churnCols = [
    { col: 'reason', label: 'Cancel Reason', cell: (r) => r.reason, total: () => 'Total' },
    { col: 'count', label: '# Cancelled', align: 'r', cell: (r) => fI(r.count), total: (t) => t ? fI(t.count) : '' },
    { col: 'avgLifetimeValue', label: 'Avg LTV', align: 'r', cell: (r) => fU(r.avgLifetimeValue), total: () => '' },
    { col: 'avgDaysSubscribed', label: 'Avg Days Subscribed', align: 'r', cell: (r) => formatDec(r.avgDaysSubscribed, 0), total: () => '' },
    { col: 'pctOfCancellations', label: '% of Cancellations', align: 'r', cell: (r) => fP(r.pctOfCancellations), total: () => '100%' },
  ];

  const dataMap = { plans: plansData, countries: countriesData, platforms: platformsData, churn: churnReasonsData };
  const colMap = { plans: plansCols, countries: countriesCols, platforms: platformsCols, churn: churnCols };

  const handleCSV = () => {
    const rawDataTab = dataMap[activeTab];
    const allCols = colMap[activeTab];
    if (!rawDataTab || !allCols) return;
    const visCols = allCols.filter((c) => !hiddenCols[`${activeTab}:${c.col}`]);
    const csvCols = visCols.map((c) => ({ label: c.label, value: (r) => { const v = c.cell(r); return typeof v === 'object' ? (r[c.col] ?? '') : v; } }));
    exportCSV(csvCols, rawDataTab, `subscriptions-${activeTab}.csv`);
  };

  const totalRowForPlans = (data) => data?.length ? { subscribers: data.reduce((s, x) => s + x.subscribers, 0), new: data.reduce((s, x) => s + x.new, 0), cancelled: data.reduce((s, x) => s + x.cancelled, 0), pctOfTotal: 100 } : null;
  const totalRowForCountries = (data) => data?.length ? { active: data.reduce((s, x) => s + x.active, 0), new: data.reduce((s, x) => s + x.new, 0), cancelled: data.reduce((s, x) => s + x.cancelled, 0), pctOfTotal: 100 } : null;
  const totalRowForPlatforms = (data) => data?.length ? { active: data.reduce((s, x) => s + x.active, 0), new: data.reduce((s, x) => s + x.new, 0), cancelled: data.reduce((s, x) => s + x.cancelled, 0), pctOfTotal: 100 } : null;
  const totalRowForChurn = (data) => data?.length ? { count: data.reduce((s, x) => s + x.count, 0), pctOfCancellations: 100 } : null;

  return (
    <div className="page-section active" id="page-subscriptions">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: '#1AB7EA', color: 'white', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>S</span>
              Subscriptions & Trials
            </h2>
            <p>Subscription performance, trials, churn & revenue analysis</p>
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

        {/* Segment dropdowns */}
        <div className="gads-filter-bar" style={{ marginBottom: 16 }}>
          <div className="gads-filter-row">
            <div className="gads-filter-group gads-fg-sm">
              <label>View</label>
              <select value={viewFilter} onChange={(e) => setViewFilter(e.target.value)}>
                <option value="Total">Total</option>
                <option value="Gained">Gained</option>
                <option value="Lost">Lost</option>
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Type</label>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="Subscriptions & Trials">Subscriptions & Trials</option>
                <option value="Subscriptions only">Subscriptions only</option>
                <option value="Trials only">Trials only</option>
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Segment</label>
              <select value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value)}>
                <option value="Choose segment">Choose segment</option>
                <option value="Platform">Platform</option>
                <option value="Country">Country</option>
                <option value="Billing Frequency">Billing Frequency</option>
                <option value="Plan">Plan</option>
                <option value="Health Status">Health Status</option>
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Granularity</label>
              <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ padding: '16px 20px', background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', margin: '0 0 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={fetchData}>Retry</button>
          </div>
        )}

        {/* KPI Section */}
        <div className="gads-kpi-section">
          <div className="gads-kpi-toolbar">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Click metric to expand subscriber list</span>
            <button className="btn btn-outline btn-sm" onClick={() => setKpiCollapsed(!kpiCollapsed)}>{kpiCollapsed ? 'Show KPIs ▼' : 'Hide KPIs ▲'}</button>
          </div>
          {!kpiCollapsed && (
            <div className="kpi-grid-6" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
              {KPI_LIST.map((k) => {
                const val = kpis ? kpis[k.key] : 0;
                const prev = compareKpis ? compareKpis[k.key] : null;
                const d = kpiDelta(val, prev, k.inverse);
                const hasExpand = !['netGrowth', 'convRate'].includes(k.key);
                const isExpanded = kpiExpanded === k.key;
                return (
                  <div key={k.key} className="rkpi-card" style={{ cursor: hasExpand ? 'pointer' : 'default' }}>
                    <div className="rkpi-header" style={{ cursor: 'default' }}>
                      <span className="rkpi-label">{k.label}</span>
                    </div>
                    <div
                      className="rkpi-value"
                      onClick={hasExpand ? () => handleKpiClick(k.key) : undefined}
                    >
                      {k.fmt(val)}
                    </div>
                    {d && (
                      <div className={`kpi-compare ${d.isGood ? 'kpi-compare-good' : 'kpi-compare-bad'}`}>
                        <span className="kpi-prev">vs {k.fmt(prev)}</span>
                        <span className="kpi-compare-arrow">{d.up ? '▲' : '▼'}</span>
                        <span className="kpi-compare-pct">{Math.abs(d.pct).toFixed(1)}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {kpiExpanded && (
            <SubscriberListPanel
              rows={kpiExpandedRows}
              loading={emailListLoading && kpiExpandedRows.length === 0}
              onClose={() => { setKpiExpanded(null); setKpiExpandedRows([]); }}
            />
          )}
        </div>

        {/* Chart Section */}
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

        {/* Tabs */}
        <div className="gads-tabs-container">
          <div className="gads-tabs-row">
            <div className="gads-tabs">
              {TABS.map((tab) => {
                const countMap = { plans: plansData.length, countries: countriesData.length, platforms: platformsData.length, churn: churnReasonsData.length };
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
                  const allCols = colMap[activeTab] || [];
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

        <div id="gads-tab-content">
          {loading && <div className="gads-loading"><div className="gads-spinner" /> Loading data...</div>}

          {!loading && activeTab === 'plans' && renderTable('plans', plansData, plansCols, { rowKey: (r) => r.planName, expandKey: (r) => 'plan_' + (r._filterKey || r.planName), subRows: (expandKey) => subRowContent(expandKey), totalRow: totalRowForPlans })}
          {!loading && activeTab === 'countries' && renderTable('countries', countriesData, countriesCols, { rowKey: (r) => r.country, expandKey: (r) => 'country_' + (r._filterKey || r.country), subRows: (expandKey) => subRowContent(expandKey), totalRow: totalRowForCountries })}
          {!loading && activeTab === 'platforms' && renderTable('platforms', platformsData, platformsCols, { rowKey: (r) => r.platform, expandKey: (r) => 'platform_' + (r._filterKey || r.platform), subRows: (expandKey) => subRowContent(expandKey), totalRow: totalRowForPlatforms })}
          {!loading && activeTab === 'churn' && renderTable('churn', churnReasonsData, churnCols, { rowKey: (r) => r.reason, expandKey: (r) => 'churn_' + (r._filterKey || r.reason), subRows: (expandKey) => subRowContent(expandKey), totalRow: totalRowForChurn })}
        </div>
      </div>
    </div>
  );
}
