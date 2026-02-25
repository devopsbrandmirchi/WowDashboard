import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGoogleAdsData } from '../hooks/useGoogleAdsData';
import { formatCurrency2, formatNumber, formatDec } from '../utils/format';
import Chart from 'chart.js/auto';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';

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
  { key: 'cost', label: 'Cost', fmt: fU, color: '#ff0000' },
  { key: 'impressions', label: 'Impressions', fmt: fI, color: '#10b981' },
  { key: 'clicks', label: 'Clicks', fmt: fI, color: '#f59e0b' },
  { key: 'ctr', label: 'CTR', fmt: fP, color: '#8b5cf6' },
  { key: 'cpc', label: 'CPC', fmt: fU, color: '#3b82f6' },
  { key: 'conversions', label: 'Conv.', fmt: fI, color: '#ec4899' },
  { key: 'conv_rate', label: 'Conv. Rate', fmt: fP, color: '#14b8a6' },
  { key: 'cpa', label: 'CPA', fmt: fU, color: '#f97316' },
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
  const { filters, updateFilter, fetchData, loading, error, customers, channelTypes, kpis, compareKpis, campaignTypes, campaigns, adGroups, keywords, geoData, conversionsData, dailyTrends, compareDailyTrends } = useGoogleAdsData();

  const [activeTab, setActiveTab] = useState('campaigntypes');
  const [kpiCollapsed, setKpiCollapsed] = useState(false);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartActiveMetrics, setChartActiveMetrics] = useState(['cost', 'clicks', 'conversions']);
  const [sort, setSort] = useState({ campaigntypes: { col: 'cost', dir: 'desc' }, campaigns: { col: 'cost', dir: 'desc' }, adgroups: { col: 'cost', dir: 'desc' }, keywords: { col: 'cost', dir: 'desc' }, searchterms: { col: 'cost', dir: 'desc' }, geo: { col: 'cost', dir: 'desc' }, conversions: { col: 'conversions', dir: 'desc' } });
  const [pg, setPg] = useState({ campaigntypes: 1, campaigns: 1, adgroups: 1, keywords: 1, searchterms: 1, geo: 1, conversions: 1 });
  const [expanded, setExpanded] = useState({});
  const [matchFilter, setMatchFilter] = useState('');

  const chartRef = useRef(null);
  const chartInstance = useRef(null);

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

  /* ── Chart.js ── */
  useEffect(() => {
    if (chartCollapsed || !chartRef.current || !dailyTrends.length) return;
    if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; }
    const labels = dailyTrends.map((d) => { const p = d.date.split('-'); return parseInt(p[1]) + '/' + parseInt(p[2]); });
    const datasets = [];
    const hasCompare = compareDailyTrends.length > 0;
    CHART_METRICS.forEach((m) => {
      if (!chartActiveMetrics.includes(m.key)) return;
      datasets.push({ label: m.label, data: dailyTrends.map((d) => +(d[m.key] || 0)), borderColor: m.color, backgroundColor: m.color + '18', tension: 0.35, fill: false, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: m.color });
      if (hasCompare) {
        const compData = compareDailyTrends.map((d) => +(d[m.key] || 0));
        while (compData.length < labels.length) compData.push(null);
        datasets.push({
          label: m.label + ' (prev)',
          data: compData.slice(0, labels.length),
          borderColor: m.color + '80',
          backgroundColor: 'transparent',
          tension: 0.35, fill: false,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 2,
          pointHoverRadius: 4,
          pointBackgroundColor: m.color + '80',
        });
      }
    });
    chartInstance.current = new Chart(chartRef.current, {
      type: 'line', data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11 }, callback: (v) => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v } } },
      },
    });
    return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; } };
  }, [dailyTrends, compareDailyTrends, chartActiveMetrics, chartCollapsed]);

  const toggleChartMetric = (key) => setChartActiveMetrics((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  /* ── Chart metric totals ── */
  const chartTotals = {};
  const chartCompareTotals = {};
  if (dailyTrends.length) {
    CHART_METRICS.forEach((m) => { chartTotals[m.key] = dailyTrends.reduce((s, d) => s + (d[m.key] || 0), 0); });
  }
  if (compareDailyTrends.length) {
    CHART_METRICS.forEach((m) => { chartCompareTotals[m.key] = compareDailyTrends.reduce((s, d) => s + (d[m.key] || 0), 0); });
  }

  /* ── Helpers for current tab ── */
  const s = sort[activeTab] || { col: 'cost', dir: 'desc' };

  function renderTable(tab, data, columns, opts = {}) {
    const sorted = sortRows(data, s.col, s.dir);
    const info = paginate(sorted, pg[tab] || 1);
    const totals = computeTotals(data);
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
                    {isExpanded && opts.subRows && opts.subRows(r)}
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
    { col: 'type', label: 'Campaign Type', cell: (r) => <span className="badge badge-blue">{r.type}</span>, total: () => 'Total' },
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
    { col: 'campaign_name', label: 'Campaign Name', clamp: true, cell: (r) => r.campaign_name, total: () => 'Total' },
    { col: 'channel_type', label: 'Type', cell: (r) => <span className="badge badge-blue">{r.channel_type}</span>, total: () => '' },
    { col: 'campaign_status', label: 'Status', cell: (r) => <span className={`badge ${statusBadge(r.campaign_status)}`}>{statusLabel(r.campaign_status)}</span>, total: () => '' },
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
    { col: 'campaign_name', label: 'Campaign', clamp: true, cell: (r) => r.campaign_name, total: () => 'Total' },
    { col: 'ad_group_name', label: 'Ad Group', clamp: true, cell: (r) => r.ad_group_name, total: () => '' },
    { col: 'ad_group_status', label: 'Status', cell: (r) => <span className={`badge ${statusBadge(r.ad_group_status)}`}>{statusLabel(r.ad_group_status)}</span>, total: () => '' },
    { col: 'impressions', label: 'Impr.', align: 'r', cell: (r) => fI(r.impressions), total: (t) => fI(t.impressions) },
    { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => fI(t.clicks) },
    { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => fP(t.ctr) },
    { col: 'cpc', label: 'Avg CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => fU(t.cpc) },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
  ];

  /* ── Keyword Columns ── */
  const keywordCols = [
    { col: 'keyword_text', label: 'Keyword', cell: (r) => r.keyword_text, total: () => 'Total' },
    { col: 'keyword_match_type', label: 'Match Type', cell: (r) => <span className="badge badge-blue">{r.keyword_match_type}</span>, total: () => '' },
    { col: 'impressions', label: 'Impr.', align: 'r', cell: (r) => fI(r.impressions), total: (t) => fI(t.impressions) },
    { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => fI(t.clicks) },
    { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => fP(t.ctr) },
    { col: 'cpc', label: 'Avg CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => fU(t.cpc) },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
  ];

  /* ── Geo Columns ── */
  const geoCols = [
    { col: 'location', label: 'Location', cell: (r) => r.location, total: () => 'Total' },
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
    { col: 'campaign_name', label: 'Campaign', clamp: true, cell: (r) => r.campaign_name, total: () => 'Total' },
    { col: 'channel_type', label: 'Type', cell: (r) => <span className="badge badge-blue">{r.channel_type}</span>, total: () => '' },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'allConversions', label: 'All Conv.', align: 'r', cell: (r) => fI(r.allConversions), total: (t) => fI(t.allConversions) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
  ];

  /* ── Filtered keywords for match type ── */
  const filteredKeywords = matchFilter ? keywords.filter((k) => k.keyword_match_type === matchFilter) : keywords;

  /* ── CSV handler ── */
  const handleCSV = () => {
    const map = { campaigntypes: [campaignTypes, campaignTypeCols], campaigns: [campaigns, campaignCols], adgroups: [adGroups, adGroupCols], keywords: [filteredKeywords, keywordCols], geo: [geoData, geoCols], conversions: [conversionsData, conversionCols] };
    const entry = map[activeTab];
    if (!entry) return;
    const csvCols = entry[1].map((c) => ({ label: c.label, value: (r) => { const v = c.cell(r); return typeof v === 'object' ? (r[c.col] ?? '') : v; } }));
    exportCSV(csvCols, entry[0], `google-ads-${activeTab}.csv`);
  };

  /* ── Campaign expand: sub-rows = ad groups for that campaign ── */
  const campaignSubRows = (campaign) => {
    const subAgs = adGroups.filter((ag) => String(ag.campaign_id) === String(campaign.campaign_id));
    if (!subAgs.length) return <tr className="gads-sub-wrap"><td colSpan={campaignCols.length} className="gads-empty-cell">No ad groups found</td></tr>;
    return (
      <tr className="gads-sub-wrap"><td colSpan={campaignCols.length} style={{ padding: 0 }}>
        <table className="data-table gads-sub-table"><thead><tr>
          <th style={{ paddingLeft: 32 }}>Ad Group</th><th className="text-right">Impr.</th><th className="text-right">Clicks</th>
          <th className="text-right">CTR</th><th className="text-right">CPC</th><th className="text-right">Cost</th>
        </tr></thead><tbody>
          {subAgs.map((ag) => (
            <tr key={ag.ad_group_id} className="gads-sub-row">
              <td style={{ paddingLeft: 32 }}>{ag.ad_group_name}</td>
              <td className="text-right">{fI(ag.impressions)}</td><td className="text-right">{fI(ag.clicks)}</td>
              <td className="text-right">{fP(ag.ctr)}</td><td className="text-right">{fU(ag.cpc)}</td><td className="text-right">{fU(ag.cost)}</td>
            </tr>
          ))}
        </tbody></table>
      </td></tr>
    );
  };

  /* ── Ad Group expand: sub-rows = keywords for that ad group ── */
  const adGroupSubRows = (ag) => {
    const subKws = keywords.filter((k) => String(k.ad_group_id) === String(ag.ad_group_id));
    if (!subKws.length) return <tr className="gads-sub-wrap"><td colSpan={adGroupCols.length} className="gads-empty-cell">No keywords found</td></tr>;
    return (
      <tr className="gads-sub-wrap"><td colSpan={adGroupCols.length} style={{ padding: 0 }}>
        <table className="data-table gads-sub-table"><thead><tr>
          <th style={{ paddingLeft: 32 }}>Keyword</th><th>Match</th><th className="text-right">Impr.</th>
          <th className="text-right">Clicks</th><th className="text-right">CTR</th><th className="text-right">CPC</th><th className="text-right">Cost</th>
        </tr></thead><tbody>
          {subKws.map((kw) => (
            <tr key={kw.criterion_id} className="gads-sub-row">
              <td style={{ paddingLeft: 32 }}>{kw.keyword_text}</td>
              <td><span className="badge badge-blue">{kw.keyword_match_type}</span></td>
              <td className="text-right">{fI(kw.impressions)}</td><td className="text-right">{fI(kw.clicks)}</td>
              <td className="text-right">{fP(kw.ctr)}</td><td className="text-right">{fU(kw.cpc)}</td><td className="text-right">{fU(kw.cost)}</td>
            </tr>
          ))}
        </tbody></table>
      </td></tr>
    );
  };

  const kpiDelta = (current, previous, invertColor) => {
    if (!compareKpis || previous == null || previous === 0) return null;
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    const up = pct > 0;
    const isGood = invertColor ? !up : up;
    return { pct, up, isGood };
  };

  const kpiCards = kpis ? [
    { l: 'Total Spend', v: fU(kpis.cost), k: 'cost', invert: true },
    { l: 'Impressions', v: fI(kpis.impressions), k: 'impressions' },
    { l: 'Clicks', v: fI(kpis.clicks), k: 'clicks' },
    { l: 'CTR', v: fP(kpis.ctr), k: 'ctr' },
    { l: 'Avg CPC', v: fU(kpis.cpc), k: 'cpc', invert: true },
    { l: 'Conversions', v: fI(kpis.conversions), k: 'conversions' },
    { l: 'Conv. Rate', v: fP(kpis.conv_rate), k: 'conv_rate' },
    { l: 'CPA', v: fU(kpis.cpa), k: 'cpa', invert: true },
    { l: 'All Conv.', v: fI(kpis.allConversions), k: 'allConversions' },
    { l: 'Phone Calls', v: fI(kpis.phoneCalls), k: 'phoneCalls' },
  ] : [];

  return (
    <div className="page-section active" id="page-google-ads">
      <div className="page-content">
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
            <div className={`gads-filter-group ${filters.datePreset === 'custom' ? 'gads-fg-date-custom' : 'gads-fg-sm'}`}>
              <label>Date Range</label>
              <div className="gads-date-wrap">
                <select value={filters.datePreset} onChange={(e) => updateFilter('datePreset', e.target.value)}>
                  <option value="all">All Data</option><option value="today">Today</option><option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 Days</option><option value="last14">Last 14 Days</option><option value="last30">Last 30 Days</option>
                  <option value="this_month">This Month</option><option value="last_month">Last Month</option><option value="custom">Custom</option>
                </select>
                {filters.datePreset === 'custom' && (
                  <div className="gads-custom-dates">
                    <input type="date" value={filters.dateFrom} onChange={(e) => updateFilter('dateFrom', e.target.value)} />
                    <span>–</span>
                    <input type="date" value={filters.dateTo} onChange={(e) => updateFilter('dateTo', e.target.value)} />
                  </div>
                )}
              </div>
            </div>
            <div className="gads-filter-group gads-fg-compare">
              <label className="gads-compare-toggle-label">
                <span className="gads-toggle-switch"><input type="checkbox" checked={filters.compareOn} onChange={(e) => updateFilter('compareOn', e.target.checked)} /><span className="gads-toggle-slider" /></span> Compare
              </label>
              {filters.compareOn && (
                <div className="gads-compare-inline">
                  <input type="date" className="gads-comp-date-input" value={filters.compareFrom} onChange={(e) => updateFilter('compareFrom', e.target.value)} />
                  <span>–</span>
                  <input type="date" className="gads-comp-date-input" value={filters.compareTo} onChange={(e) => updateFilter('compareTo', e.target.value)} />
                </div>
              )}
            </div>
            <div className="gads-filter-group gads-filter-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={handleApply} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
            </div>
            <div className="gads-filter-group gads-filter-badge">
              <span style={{ color: loading ? '#f59e0b' : error ? '#ef4444' : '#10b981', fontWeight: 600, fontSize: 11 }}>{loading ? 'Loading…' : error ? 'Error' : 'Live'}</span>
            </div>
          </div>
          <div className="gads-filter-row">
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
              <input type="text" placeholder="Contains..." className="gads-search-input" value={filters.campaignSearch} onChange={(e) => updateFilter('campaignSearch', e.target.value)} />
            </div>
            <div className="gads-filter-group gads-fg-sm"><label>Ad Group</label>
              <input type="text" placeholder="Contains..." className="gads-search-input" value={filters.adGroupSearch} onChange={(e) => updateFilter('adGroupSearch', e.target.value)} />
            </div>
            <div className="gads-filter-group gads-fg-sm"><label>Keyword</label>
              <input type="text" placeholder="Contains..." className="gads-search-input" value={filters.keywordSearch} onChange={(e) => updateFilter('keywordSearch', e.target.value)} />
            </div>
          </div>
        </div>

        {error && (
          <div style={{ padding: '16px 20px', background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', margin: '0 0 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleApply}>Retry</button>
          </div>
        )}

        {/* ── KPI Section ── */}
        <div className="gads-kpi-section">
          <div className="gads-kpi-toolbar">
            <button className="btn btn-outline btn-sm" onClick={() => setKpiCollapsed(!kpiCollapsed)}>{kpiCollapsed ? 'Show KPIs ▼' : 'Hide KPIs ▲'}</button>
          </div>
          {!kpiCollapsed && (
            <div className="kpi-grid" id="gads-kpi-grid">
              {kpiCards.map((c) => {
                const d = compareKpis ? kpiDelta(kpis[c.k], compareKpis[c.k], c.invert) : null;
                return (
                  <div className="kpi-card" key={c.l}>
                    <div className="kpi-header"><span className="kpi-label">{c.l}</span></div>
                    <div className="kpi-value">{c.v}</div>
                    {d && (
                      <div className={`kpi-compare ${d.isGood ? 'kpi-compare-good' : 'kpi-compare-bad'}`}>
                        <span className="kpi-compare-arrow">{d.up ? '▲' : '▼'}</span>
                        <span className="kpi-compare-pct">{Math.abs(d.pct).toFixed(1)}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {!kpis && <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading…</div>}
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
          <div className="gads-tabs">
            {TABS.map((tab) => {
              const countMap = { campaigntypes: campaignTypes.length, campaigns: campaigns.length, adgroups: adGroups.length, keywords: keywords.length, geo: geoData.length, conversions: conversionsData.length };
              const count = countMap[tab.id];
              return <button key={tab.id} type="button" className={`gads-tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>{tab.label}{count != null && !loading ? ` (${count})` : ''}</button>;
            })}
            <div className="gads-tabs-spacer" />
            <button type="button" className="gads-col-btn" title="Download CSV" onClick={handleCSV}>↓ CSV</button>
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
            rowKey: (r) => r.criterion_id,
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
