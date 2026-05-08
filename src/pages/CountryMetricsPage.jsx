import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { DateRangePicker } from '../components/DatePicker';
import { supabase } from '../lib/supabase';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';
const PG = 50;
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

/** Same metric keys/colors as MetaReportPage Daily Trends */
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
const clamp = { maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function fmtLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeDateRange(preset, customFrom, customTo) {
  const today = new Date();
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  switch (preset) {
    case 'today': return { from: fmtLocal(today), to: fmtLocal(today) };
    case 'yesterday': return { from: fmtLocal(daysAgo(1)), to: fmtLocal(daysAgo(1)) };
    case 'last7': return { from: fmtLocal(daysAgo(6)), to: fmtLocal(today) };
    case 'last14': return { from: fmtLocal(daysAgo(13)), to: fmtLocal(today) };
    case 'last30': return { from: fmtLocal(daysAgo(29)), to: fmtLocal(today) };
    case 'this_month': return { from: fmtLocal(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmtLocal(today) };
    case 'last_month': return { from: fmtLocal(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: fmtLocal(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case 'custom': return { from: customFrom || null, to: customTo || null };
    case '2025': return { from: '2025-01-01', to: '2025-12-31' };
    default: return { from: null, to: null };
  }
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDayKey(v) {
  if (!v) return null;
  if (typeof v === 'string' && v.length >= 10 && v[4] === '-' && v[7] === '-') return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return fmtLocal(d);
}

function normalizeMatchKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
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

function sortRows(rows, col, dir) {
  return [...rows].sort((a, b) => {
    const d = dir === 'asc' ? 1 : -1;
    const va = col === 'name' ? a.name : a[col];
    const vb = col === 'name' ? b.name : b[col];
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
        Showing {(info.page - 1) * PG + 1}-{Math.min(info.page * PG, info.total)} of {fI(info.total)}
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

async function fetchAllRows(queryFactory) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFactory().range(offset, offset + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return rows;
}

export function CountryMetricsPage({
  title,
  subtitle = '',
  pageId,
  tableName,
  dateColumn,
  mapRow,
  tabs,
  showSearchFilters = false,
  typeField = 'product',
  statusField = '',
  referenceTableName = '',
  referenceSelect = '*',
  sourceMatchField = '',
  referenceMatchField = '',
  metaTitleBar = false,
}) {
  const [filters, setFilters] = useState({ datePreset: 'this_month', dateFrom: '', dateTo: '' });
  const [uiFilters, setUiFilters] = useState({
    type: 'all',
    status: 'all',
    campaignSearch: '',
    adGroupSearch: '',
    keywordSearch: '',
  });
  const [appliedUiFilters, setAppliedUiFilters] = useState({
    type: 'all',
    status: 'all',
    campaignSearch: '',
    adGroupSearch: '',
    keywordSearch: '',
  });
  const [normalizedRows, setNormalizedRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState((tabs && tabs[0] && tabs[0].id) || 'country');
  const [kpiSelected, setKpiSelected] = useState(() => {
    try {
      const saved = localStorage.getItem(`country_kpi_selection_${pageId || 'default'}`);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length === 6) return arr;
      }
    } catch {}
    return KPI_DEFAULTS.slice();
  });
  const [kpiDropdownOpen, setKpiDropdownOpen] = useState(-1);
  const [kpiSearchTerm, setKpiSearchTerm] = useState('');
  const [kpiCollapsed, setKpiCollapsed] = useState(false);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [chartActiveMetrics, setChartActiveMetrics] = useState(['cost', 'clicks', 'purchases']);
  const [sort, setSort] = useState({ col: 'cost', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [hiddenCols, setHiddenCols] = useState({});
  const [colEditorOpen, setColEditorOpen] = useState(false);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const colEditorRef = useRef(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { datePreset, dateFrom, dateTo } = filtersRef.current;
      const { from, to } = computeDateRange(datePreset, dateFrom, dateTo);
      const raw = await fetchAllRows(() => {
        let q = supabase.from(tableName).select('*');
        if (from) q = q.gte(dateColumn, from);
        if (to) q = q.lte(dateColumn, to);
        return q;
      });

      let referenceMap = null;
      if (referenceTableName && sourceMatchField && referenceMatchField) {
        const referenceRows = await fetchAllRows(() => supabase.from(referenceTableName).select(referenceSelect));
        referenceMap = new Map();
        for (const ref of referenceRows) {
          const key = normalizeMatchKey(ref[referenceMatchField]);
          if (key && !referenceMap.has(key)) referenceMap.set(key, ref);
        }
      }

      const normalized = raw.map((r) => ({
        ...mapRow(
          r,
          referenceMap ? referenceMap.get(normalizeMatchKey(r[sourceMatchField])) : undefined
        ),
        day: toDayKey(r[dateColumn]),
      }));

      setNormalizedRows(normalized);
    } catch (e) {
      setNormalizedRows([]);
      setError(e?.message || 'Failed to fetch country data');
    } finally {
      setLoading(false);
    }
  }, [dateColumn, mapRow, referenceMatchField, referenceSelect, referenceTableName, sourceMatchField, tableName]);

  useEffect(() => { fetchData(); }, [fetchData, filters]);

  const tabDefs = useMemo(() => {
    if (!tabs || tabs.length === 0) return [{ id: 'country', label: 'Country', field: 'country' }];
    return tabs.map((t) => (typeof t === 'string'
      ? { id: t.toLowerCase().replace(/\s+/g, '-'), label: t, field: t.toLowerCase() === 'country' ? 'country' : t.toLowerCase() }
      : t));
  }, [tabs]);

  useEffect(() => {
    if (!tabDefs.find((t) => t.id === activeTab)) setActiveTab(tabDefs[0]?.id || 'country');
  }, [activeTab, tabDefs]);

  const activeDef = tabDefs.find((t) => t.id === activeTab) || tabDefs[0];
  const tabCounts = useMemo(() => {
    const counts = {};
    for (const def of tabDefs) {
      const keyField = def.field || 'country';
      const values = new Set();
      for (const row of normalizedRows) {
        const keyVal = (row[keyField] ?? '').toString().trim() || 'Unknown';
        values.add(keyVal);
      }
      counts[def.id] = values.size;
    }
    return counts;
  }, [normalizedRows, tabDefs]);

  const filteredRows = useMemo(() => {
    if (!showSearchFilters) return normalizedRows;
    const cSearch = appliedUiFilters.campaignSearch.trim().toLowerCase();
    const aSearch = appliedUiFilters.adGroupSearch.trim().toLowerCase();
    const kSearch = appliedUiFilters.keywordSearch.trim().toLowerCase();
    return normalizedRows.filter((r) => {
      if (appliedUiFilters.type !== 'all' && String(r[typeField] || '').toLowerCase() !== appliedUiFilters.type.toLowerCase()) return false;
      if (statusField && appliedUiFilters.status !== 'all' && String(r[statusField] || '').toLowerCase() !== appliedUiFilters.status.toLowerCase()) return false;
      if (cSearch && !String(r.campaignName || '').toLowerCase().includes(cSearch)) return false;
      if (aSearch && !String(r.adGroupName || r.adSetName || '').toLowerCase().includes(aSearch)) return false;
      if (kSearch) {
        const keywordFields = [r.adName, r.title, r.placement, r.keyword, r.keywordText].map((v) => String(v || '').toLowerCase());
        if (!keywordFields.some((v) => v.includes(kSearch))) return false;
      }
      return true;
    });
  }, [appliedUiFilters, normalizedRows, showSearchFilters, statusField, typeField]);

  const rows = useMemo(() => {
    const keyField = activeDef?.field || 'country';
    const map = new Map();
    for (const r of filteredRows) {
      const keyVal = (r[keyField] ?? '').toString().trim() || 'Unknown';
      if (!map.has(keyVal)) map.set(keyVal, { name: keyVal, cost: 0, impressions: 0, clicks: 0, conversions: 0 });
      const acc = map.get(keyVal);
      acc.cost += toNum(r.cost);
      acc.impressions += toNum(r.impressions);
      acc.clicks += toNum(r.clicks);
      acc.conversions += toNum(r.conversions);
    }
    const grouped = [...map.values()].map((r) => {
      const ctr = r.impressions ? (r.clicks / r.impressions) * 100 : 0;
      const cpc = r.clicks ? r.cost / r.clicks : 0;
      const cpm = r.impressions ? (r.cost / r.impressions) * 1000 : 0;
      const convRate = r.clicks ? (r.conversions / r.clicks) * 100 : 0;
      const cpa = r.conversions ? r.cost / r.conversions : 0;
      return { ...r, ctr, cpc, cpm, convRate, cpa };
    });
    if (activeDef?.field === 'day') return grouped.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return grouped.sort((a, b) => b.cost - a.cost);
  }, [activeDef, filteredRows]);

  useEffect(() => {
    setSort(activeDef?.field === 'day' ? { col: 'name', dir: 'asc' } : { col: 'cost', dir: 'desc' });
    setPage(1);
  }, [activeDef?.field]);

  /** Daily series aligned with MetaReportPage chart keys (purchases = conversions). */
  const dailySeries = useMemo(() => {
    const map = new Map();
    for (const r of filteredRows) {
      if (!r.day) continue;
      if (!map.has(r.day)) map.set(r.day, { day: r.day, cost: 0, impressions: 0, clicks: 0, conversions: 0 });
      const d = map.get(r.day);
      d.cost += toNum(r.cost);
      d.impressions += toNum(r.impressions);
      d.clicks += toNum(r.clicks);
      d.conversions += toNum(r.conversions);
    }
    const sorted = [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
    return sorted.map((row) => {
      const purchases = row.conversions;
      const ctr = row.impressions ? (row.clicks / row.impressions) * 100 : 0;
      const cpc = row.clicks ? row.cost / row.clicks : 0;
      const conv_rate = row.clicks ? (purchases / row.clicks) * 100 : 0;
      const cpa = purchases ? row.cost / purchases : 0;
      return {
        name: row.day,
        cost: row.cost,
        impressions: row.impressions,
        clicks: row.clicks,
        purchases,
        ctr,
        cpc,
        conv_rate,
        cpa,
      };
    });
  }, [filteredRows]);

  const chartTotalsVal = useMemo(() => {
    if (!dailySeries.length) return {};
    const s = { cost: 0, impressions: 0, clicks: 0, purchases: 0 };
    dailySeries.forEach((d) => {
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
  }, [dailySeries]);

  const toggleChartMetric = useCallback((key) => {
    setChartActiveMetrics((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev;
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  }, []);

  const totals = useMemo(() => {
    const t = rows.reduce((acc, r) => {
      acc.cost += r.cost;
      acc.impressions += r.impressions;
      acc.clicks += r.clicks;
      acc.conversions += r.conversions;
      return acc;
    }, { cost: 0, impressions: 0, clicks: 0, conversions: 0 });
    t.ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
    t.cpc = t.clicks ? t.cost / t.clicks : 0;
    t.cpm = t.impressions ? (t.cost / t.impressions) * 1000 : 0;
    t.convRate = t.clicks ? (t.conversions / t.clicks) * 100 : 0;
    t.cpa = t.conversions ? t.cost / t.conversions : 0;
    return t;
  }, [rows]);

  const handleSort = useCallback((col) => {
    setSort((prev) => ({
      col,
      dir: prev.col === col ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'desc',
    }));
    setPage(1);
  }, []);

  const tableCols = useMemo(() => ([
    { col: 'name', label: activeDef?.label || 'Dimension', align: '', clamp: true, cell: (r) => (activeDef?.field === 'day' ? formatDayDisplay(r.name) : r.name), total: () => 'Total' },
    { col: 'cost', label: 'Cost', align: 'r', cell: (r) => fU(r.cost), total: (t) => fU(t.cost) },
    { col: 'impressions', label: 'Impressions', align: 'r', cell: (r) => fI(r.impressions), total: (t) => fI(t.impressions) },
    { col: 'clicks', label: 'Clicks', align: 'r', cell: (r) => fI(r.clicks), total: (t) => fI(t.clicks) },
    { col: 'ctr', label: 'CTR', align: 'r', cell: (r) => fP(r.ctr), total: (t) => fP(t.ctr) },
    { col: 'cpc', label: 'Avg CPC', align: 'r', cell: (r) => fU(r.cpc), total: (t) => fU(t.cpc) },
    { col: 'cpm', label: 'CPM', align: 'r', cell: (r) => fU(r.cpm), total: (t) => fU(t.cpm) },
    { col: 'conversions', label: 'Conv.', align: 'r', cell: (r) => fI(r.conversions), total: (t) => fI(t.conversions) },
    { col: 'convRate', label: 'Conv. Rate', align: 'r', cell: (r) => fP(r.convRate), total: (t) => fP(t.convRate) },
    { col: 'cpa', label: 'CPA', align: 'r', cell: (r) => fU(r.cpa), total: (t) => fU(t.cpa) },
  ]), [activeDef?.field, activeDef?.label]);

  const visibleTableCols = useMemo(() => tableCols.filter((c) => !hiddenCols[c.col]), [tableCols, hiddenCols]);
  const sortedRows = useMemo(() => sortRows(rows, sort.col, sort.dir), [rows, sort.col, sort.dir]);
  const pageInfo = useMemo(() => paginate(sortedRows, page), [sortedRows, page]);

  const toggleColVisibility = useCallback((colKey) => {
    setHiddenCols((prev) => {
      const next = { ...prev };
      if (next[colKey]) delete next[colKey];
      else next[colKey] = true;
      return next;
    });
  }, []);

  const handleCSV = useCallback(() => {
    const csvCols = visibleTableCols.map((c) => ({ label: c.label, cell: c.cell }));
    exportCSV(csvCols, sortedRows, `${pageId || 'country'}-${activeDef?.id || 'tab'}.csv`);
  }, [activeDef?.id, pageId, sortedRows, visibleTableCols]);

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
      try {
        localStorage.setItem(`country_kpi_selection_${pageId || 'default'}`, JSON.stringify(next));
      } catch {}
      return next;
    });
    setKpiDropdownOpen(-1);
  }, [pageId]);

  useEffect(() => {
    const handleClickOutsideKpi = (e) => {
      if (kpiDropdownOpen >= 0 && !e.target.closest('.rkpi-card')) setKpiDropdownOpen(-1);
    };
    document.addEventListener('click', handleClickOutsideKpi);
    return () => document.removeEventListener('click', handleClickOutsideKpi);
  }, [kpiDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (colEditorOpen && colEditorRef.current && !colEditorRef.current.contains(e.target)) setColEditorOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [colEditorOpen]);

  const typeOptions = useMemo(() => {
    const values = [...new Set(normalizedRows.map((r) => String(r[typeField] || '').trim()).filter(Boolean))].sort();
    return values;
  }, [normalizedRows, typeField]);

  const statusOptions = useMemo(() => {
    if (!statusField) return [];
    return [...new Set(normalizedRows.map((r) => String(r[statusField] || '').trim()).filter(Boolean))].sort();
  }, [normalizedRows, statusField]);

  useEffect(() => {
    if (chartCollapsed || !chartRef.current || !dailySeries.length) {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
      return;
    }
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }
    const labels = dailySeries.map((d) => {
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
        data: dailySeries.map((d) => +(d[m.key] ?? 0)),
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
        ticks: { font: { size: 11 }, maxTicksLimit: Math.max(31, dailySeries.length || 0), maxRotation: 45 },
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
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } },
          },
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
  }, [dailySeries, chartActiveMetrics, chartCollapsed]);

  return (
    <div className="page-section active" id={pageId}>
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            {metaTitleBar ? (
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: '#1877F2', color: 'white', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>
                  <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z" fill="currentColor" /></svg>
                </span>
                {title}
              </h2>
            ) : (
              <h2>{title}</h2>
            )}
            {subtitle && (
              <p style={metaTitleBar ? { marginTop: 4, fontSize: 13, color: 'var(--text-muted)' } : undefined}>{subtitle}</p>
            )}
          </div>
          <DateRangePicker
            preset={filters.datePreset}
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            compareOn={false}
            compareFrom=""
            compareTo=""
            onApply={({ preset, dateFrom, dateTo }) => {
              setFilters({ datePreset: preset, dateFrom: dateFrom || '', dateTo: dateTo || '' });
            }}
          />
        </div>

        <div className="gads-filter-bar">
          <div className="gads-filter-row">
            {showSearchFilters && (
              <>
                <div className="gads-filter-group gads-fg-sm">
                  <label>Type</label>
                  <select value={uiFilters.type} onChange={(e) => setUiFilters((p) => ({ ...p, type: e.target.value }))}>
                    <option value="all">All Types</option>
                    {typeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div className="gads-filter-group gads-fg-sm">
                  <label>Status</label>
                  <select value={uiFilters.status} onChange={(e) => setUiFilters((p) => ({ ...p, status: e.target.value }))} disabled={!statusField}>
                    <option value="all">All</option>
                    {statusOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div className="gads-filter-group gads-fg-sm">
                  <label>Campaign</label>
                  <input type="text" className="gads-search-input" placeholder="Search campaigns..." value={uiFilters.campaignSearch} onChange={(e) => setUiFilters((p) => ({ ...p, campaignSearch: e.target.value }))} />
                </div>
                <div className="gads-filter-group gads-fg-sm">
                  <label>Ad Group</label>
                  <input type="text" className="gads-search-input" placeholder="Search ad groups..." value={uiFilters.adGroupSearch} onChange={(e) => setUiFilters((p) => ({ ...p, adGroupSearch: e.target.value }))} />
                </div>
                <div className="gads-filter-group gads-fg-sm">
                  <label>Keyword</label>
                  <input type="text" className="gads-search-input" placeholder="Search keywords..." value={uiFilters.keywordSearch} onChange={(e) => setUiFilters((p) => ({ ...p, keywordSearch: e.target.value }))} />
                </div>
              </>
            )}
            <div className="gads-filter-group gads-filter-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn btn-navy btn-sm"
                onClick={() => {
                  setAppliedUiFilters(uiFilters);
                  setPage(1);
                  fetchData();
                }}
                disabled={loading}
                style={{ padding: '6px 20px' }}
              >
                {loading ? 'Loading…' : 'Apply'}
              </button>
              <span style={{ color: loading ? 'var(--warning)' : error ? 'var(--danger)' : 'var(--accent)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                {loading ? 'Loading…' : error ? 'Error' : 'Live'}
              </span>
            </div>
          </div>
        </div>

        <div className="gads-kpi-section">
          <div className="gads-kpi-toolbar">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Click metric name to customize</span>
            <button className="btn btn-outline btn-sm" onClick={() => setKpiCollapsed((v) => !v)}>{kpiCollapsed ? 'Show KPIs ▼' : 'Hide KPIs ▲'}</button>
          </div>
          {!kpiCollapsed && <div className="kpi-grid-6">
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
          </div>}
        </div>

        <div className="gads-chart-section" style={{ minWidth: 0, overflow: 'hidden' }}>
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
                        <span className="gads-metric-val">{m.fmt(chartTotalsVal[m.key] ?? 0)}</span>
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

        <div className="gads-tabs-container">
          <div className="gads-tabs-row">
            <div className="gads-tabs">
              {tabDefs.map((t) => (
                <button
                  key={t.id}
                  className={`gads-tab ${activeTab === t.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label} ({tabCounts[t.id] || 0})
                </button>
              ))}
            </div>
            <div className="gads-tabs-spacer" />
            <div className="gads-tabs-actions">
              <div style={{ position: 'relative' }} ref={colEditorRef}>
                <button type="button" className={`gads-col-btn${colEditorOpen ? ' active' : ''}`} title="Show/hide columns" onClick={() => setColEditorOpen((v) => !v)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ verticalAlign: '-2px', marginRight: 4 }}><rect x="1" y="1" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="1" y="8" width="4" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="7" y="1" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="7" y="8" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>
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

        {loading && <div className="gads-loading"><div className="gads-spinner" /> Loading data...</div>}
        {!loading && (
          <>
            {error && <p className="wl-sync-log-error">{error}</p>}
            <div className="panel">
              <div className="panel-body no-padding">
                <div className="table-wrapper">
                  <table className="data-table gads-table">
                    <thead>
                      <tr>
                        {visibleTableCols.map((c) => (
                          <SortTh key={c.col} label={c.label} col={c.col} sort={sort} onSort={handleSort} align={c.align} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="gads-total-row-top">
                        {visibleTableCols.map((c) => (
                          <td key={c.col} className={c.align === 'r' ? 'text-right' : ''}>
                            <strong>{c.total ? c.total(totals) : ''}</strong>
                          </td>
                        ))}
                      </tr>
                      {pageInfo.rows.length === 0 && (
                        <tr>
                          <td colSpan={visibleTableCols.length} className="gads-empty-cell">No data found for the selected filters.</td>
                        </tr>
                      )}
                      {pageInfo.rows.map((r) => (
                        <tr key={r.name}>
                          {visibleTableCols.map((c) => (
                            <td key={c.col} className={c.align === 'r' ? 'text-right' : ''} style={c.clamp ? clamp : undefined} title={c.clamp ? c.cell(r) : undefined}>
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
            <Pagination info={pageInfo} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
