import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVimeoAnalyticsData } from '../hooks/useVimeoAnalyticsData';
import { DateRangePicker } from '../components/DatePicker';
import Chart from 'chart.js/auto';

const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const num = (v) => Number(v) || 0;

const TABS = [
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'trials', label: 'Trials' },
  { id: 'spt', label: 'Subscriptions + Trials' },
];

function KpiCard({ label, value, prev, fmt = fI, inverse }) {
  const pct = prev != null && prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null;
  const isGood = inverse ? (pct != null && pct <= 0) : (pct != null && pct >= 0);
  return (
    <div className="rkpi-card" style={{ minWidth: 120 }}>
      <div className="rkpi-header"><span className="rkpi-label">{label}</span></div>
      <div className="rkpi-value">{typeof fmt === 'function' ? fmt(value) : value}</div>
      {pct != null && (
        <div className={`kpi-compare ${isGood ? 'kpi-compare-good' : 'kpi-compare-bad'}`}>
          <span className="kpi-prev">{fmt(prev)}</span>
          <span className="kpi-compare-arrow">{pct >= 0 ? '▲' : '▼'}</span>
          <span className="kpi-compare-pct">{Math.abs(pct).toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

function SortTh({ label, col, sort, onSort, align }) {
  const arrow = sort?.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th className={`gads-sortable ${align === 'r' ? 'text-right' : ''}`} onClick={() => onSort(col)}>
      {label}{arrow}
    </th>
  );
}

function monthInRange(monthKey, dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return true;
  const first = `${monthKey}-01`;
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0);
  const lastStr = `${monthKey}-${String(last.getDate()).padStart(2, '0')}`;
  return first <= dateTo && lastStr >= dateFrom;
}

export function VimeoAnalyticsPage() {
  const {
    dateFrom, dateTo, compareFrom, compareTo, updateDateRange,
    loading, error, fetchData, kpis, compareKpis, monthlySummary, countryByMonth, monthByCountry, dailyData, dailyCompareData,
  } = useVimeoAnalyticsData();

  const [activeTab, setActiveTab] = useState('subscriptions');
  const [viewMode, setViewMode] = useState('month');
  const [expandedKey, setExpandedKey] = useState(null);
  const [monthSort, setMonthSort] = useState({ col: 'month', dir: 'asc' });
  const [countrySort, setCountrySort] = useState({ col: 'active', dir: 'desc' });
  const [datePreset, setDatePreset] = useState('custom');
  const [compareOn, setCompareOn] = useState(false);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const toggleExpand = (key) => setExpandedKey((prev) => (prev === key ? null : key));

  const handleMonthSort = (col) => setMonthSort((s) => ({ col, dir: s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'asc' }));
  const handleCountrySort = (col) => setCountrySort((s) => ({ col, dir: s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }));

  const handleDateApply = useCallback(({ preset: p, dateFrom: from, dateTo: to, compareOn: co, compareFrom: cf, compareTo: ct }) => {
    setDatePreset(p || 'custom');
    setCompareOn(co ?? true);
    updateDateRange(from, to, cf, ct);
  }, [updateDateRange]);

  const filteredMonthly = useMemo(() => {
    return monthlySummary.filter((r) => monthInRange(r.month, dateFrom, dateTo));
  }, [monthlySummary, dateFrom, dateTo]);

  const totalRow = useMemo(() => {
    if (!filteredMonthly.length) return null;
    const tG = filteredMonthly.reduce((s, r) => s + (r.gained || 0), 0);
    const tL = filteredMonthly.reduce((s, r) => s + (r.lost || 0), 0);
    const tT = filteredMonthly.reduce((s, r) => s + (r.trials || 0), 0);
    const tTL = filteredMonthly.reduce((s, r) => s + (r.trialsLost || 0), 0);
    const tPG = filteredMonthly.reduce((s, r) => s + (r.plusGained || 0), 0);
    const tPL = filteredMonthly.reduce((s, r) => s + (r.plusLost || 0), 0);
    const last = filteredMonthly[filteredMonthly.length - 1];
    return {
      month: '_total',
      monthLabel: 'Total',
      gained: tG,
      lost: tL,
      netGrowth: tG - tL,
      active: last?.active ?? 0,
      trials: tT,
      trialsLost: tTL,
      trialsNet: tT - tTL,
      trialsActive: last?.trialsActive ?? 0,
      plusGained: tPG,
      plusLost: tPL,
      plusNet: tPG - tPL,
      sptActive: last?.sptActive ?? 0,
    };
  }, [filteredMonthly]);

  const sortedMonthly = useMemo(() => {
    const data = [...filteredMonthly];
    if (monthSort.col !== 'month') {
      data.sort((a, b) => {
        const va = a[monthSort.col], vb = b[monthSort.col];
        const d = monthSort.dir === 'asc' ? 1 : -1;
        return d * ((num(va) || 0) - (num(vb) || 0));
      });
    } else {
      data.sort((a, b) => {
        const d = monthSort.dir === 'asc' ? 1 : -1;
        return d * (a.month.localeCompare(b.month));
      });
    }
    return totalRow ? [totalRow, ...data] : data;
  }, [filteredMonthly, totalRow, monthSort]);

  const countryList = useMemo(() => {
    const seen = new Set();
    Object.keys(monthByCountry).forEach((c) => seen.add(c));
    return Array.from(seen);
  }, [monthByCountry]);

  const countryAggregated = useMemo(() => {
    return countryList.map((country) => {
      const rows = (monthByCountry[country] || []).filter((r) => monthInRange(r.month, dateFrom, dateTo));
      const last = rows[rows.length - 1];
      return {
        country,
        gained: rows.reduce((s, r) => s + (r.gained || 0), 0),
        lost: rows.reduce((s, r) => s + (r.lost || 0), 0),
        trials: rows.reduce((s, r) => s + (r.trials || 0), 0),
        trialsLost: rows.reduce((s, r) => s + (r.trialsLost || 0), 0),
        plusGained: rows.reduce((s, r) => s + (r.plusGained || 0), 0),
        plusLost: rows.reduce((s, r) => s + (r.plusLost || 0), 0),
        active: last?.active ?? 0,
        trialsActive: last?.trialsActive ?? 0,
        sptActive: last?.sptActive ?? 0,
      };
    }).map((r) => ({
      ...r,
      net: r.gained - r.lost,
      trialsNet: r.trials - r.trialsLost,
      plusNet: r.plusGained - r.plusLost,
    }));
  }, [countryList, monthByCountry, dateFrom, dateTo]);

  const sortedCountry = useMemo(() => {
    const col = activeTab === 'trials' ? 'trialsActive' : activeTab === 'spt' ? 'sptActive' : 'active';
    return [...countryAggregated].sort((a, b) => {
      const va = a[countrySort.col] ?? a[col], vb = b[countrySort.col] ?? b[col];
      const d = countrySort.dir === 'asc' ? 1 : -1;
      if (typeof va === 'string') return d * (va || '').localeCompare(vb || '');
      return d * ((num(va) || 0) - (num(vb) || 0));
    });
  }, [countryAggregated, activeTab, countrySort]);

  const countryRows = (monthKey) => {
    const rows = countryByMonth[monthKey] || [];
    if (activeTab === 'trials') return [...rows].sort((a, b) => (b.trialsActive || 0) - (a.trialsActive || 0)).slice(0, 50);
    if (activeTab === 'spt') return [...rows].sort((a, b) => (b.sptActive || 0) - (a.sptActive || 0)).slice(0, 50);
    return rows.slice(0, 50);
  };

  const monthRowsForCountry = (country) => {
    return (monthByCountry[country] || []).filter((r) => monthInRange(r.month, dateFrom, dateTo));
  };

  const chartData = useMemo(() => {
    if (!dailyData?.length) return null;
    const labels = dailyData.map((d) => (d.date || '').slice(5, 10).replace('-', '/'));
    const comp = dailyCompareData || [];
    const pad = (arr, len) => [...arr, ...Array(Math.max(0, len - arr.length)).fill(null)];
    const compGained = pad(comp.map((d) => d.gained), labels.length);
    const compLost = pad(comp.map((d) => d.lost), labels.length);
    const compNet = pad(comp.map((d) => d.netGrowth), labels.length);
    const compTrials = pad(comp.map((d) => d.trials), labels.length);
    const compTrialsLost = pad(comp.map((d) => d.trialsLost), labels.length);
    const compTrialsNet = pad(comp.map((d) => d.trialsNet), labels.length);
    const compPlusGained = pad(comp.map((d) => d.plusGained), labels.length);
    const compPlusLost = pad(comp.map((d) => d.plusLost), labels.length);
    const compPlusNet = pad(comp.map((d) => d.plusNet), labels.length);
    const dash = [6, 4];
    if (activeTab === 'subscriptions') {
      const sets = [
        { label: 'Gained', data: dailyData.map((d) => d.gained), borderColor: '#2E9E40', tension: 0.35, fill: false },
        { label: 'Lost', data: dailyData.map((d) => d.lost), borderColor: '#ED1C24', tension: 0.35, fill: false },
        { label: 'Net Growth', data: dailyData.map((d) => d.netGrowth), borderColor: '#1AB7EA', tension: 0.35, fill: false },
      ];
      if (compareOn && comp.length) {
        sets.push({ label: 'Gained (prev)', data: compGained, borderColor: '#2E9E40', borderDash: dash, tension: 0.35, fill: false });
        sets.push({ label: 'Lost (prev)', data: compLost, borderColor: '#ED1C24', borderDash: dash, tension: 0.35, fill: false });
        sets.push({ label: 'Net (prev)', data: compNet, borderColor: '#1AB7EA', borderDash: dash, tension: 0.35, fill: false });
      }
      return { labels, datasets: sets };
    }
    if (activeTab === 'trials') {
      const sets = [
        { label: 'Trials Gained', data: dailyData.map((d) => d.trials), borderColor: '#2E9E40', tension: 0.35, fill: false },
        { label: 'Trials Lost', data: dailyData.map((d) => d.trialsLost), borderColor: '#ED1C24', tension: 0.35, fill: false },
        { label: 'Trials Net', data: dailyData.map((d) => d.trialsNet), borderColor: '#F5A623', tension: 0.35, fill: false },
      ];
      if (compareOn && comp.length) {
        sets.push({ label: 'Trials Gained (prev)', data: compTrials, borderColor: '#2E9E40', borderDash: dash, tension: 0.35, fill: false });
        sets.push({ label: 'Trials Lost (prev)', data: compTrialsLost, borderColor: '#ED1C24', borderDash: dash, tension: 0.35, fill: false });
        sets.push({ label: 'Trials Net (prev)', data: compTrialsNet, borderColor: '#F5A623', borderDash: dash, tension: 0.35, fill: false });
      }
      return { labels, datasets: sets };
    }
    const sets = [
      { label: 'S+T Gained', data: dailyData.map((d) => d.plusGained), borderColor: '#2E9E40', tension: 0.35, fill: false },
      { label: 'S+T Lost', data: dailyData.map((d) => d.plusLost), borderColor: '#ED1C24', tension: 0.35, fill: false },
      { label: 'S+T Net', data: dailyData.map((d) => d.plusNet), borderColor: '#1AB7EA', tension: 0.35, fill: false },
    ];
    if (compareOn && comp.length) {
      sets.push({ label: 'S+T Gained (prev)', data: compPlusGained, borderColor: '#2E9E40', borderDash: dash, tension: 0.35, fill: false });
      sets.push({ label: 'S+T Lost (prev)', data: compPlusLost, borderColor: '#ED1C24', borderDash: dash, tension: 0.35, fill: false });
      sets.push({ label: 'S+T Net (prev)', data: compPlusNet, borderColor: '#1AB7EA', borderDash: dash, tension: 0.35, fill: false });
    }
    return { labels, datasets: sets };
  }, [dailyData, dailyCompareData, activeTab, compareOn]);

  useEffect(() => {
    if (!chartRef.current || !chartData) return;
    if (chartInstance.current) chartInstance.current.destroy();
    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { mode: 'index', intersect: false } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
      },
    });
    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [chartData]);

  const netCell = (val) => (
    <span style={{ color: val >= 0 ? '#2E9E40' : '#ED1C24' }}>{(val >= 0 ? '+' : '') + fI(val)}</span>
  );

  const renderByMonthTable = () => {
    const cols = activeTab === 'subscriptions' ? [
      { col: 'month', label: 'Month' },
      { col: 'gained', label: 'Gained', align: 'r' },
      { col: 'lost', label: 'Lost', align: 'r' },
      { col: 'netGrowth', label: 'Net Growth', align: 'r', net: true },
      { col: 'active', label: 'Active (EOM)', align: 'r' },
    ] : activeTab === 'trials' ? [
      { col: 'month', label: 'Month' },
      { col: 'trials', label: 'Gained', align: 'r' },
      { col: 'trialsLost', label: 'Lost', align: 'r' },
      { col: 'trialsNet', label: 'Net', align: 'r', net: true },
      { col: 'trialsActive', label: 'Active (EOM)', align: 'r' },
    ] : [
      { col: 'month', label: 'Month' },
      { col: 'plusGained', label: 'S+T Gained', align: 'r' },
      { col: 'plusLost', label: 'S+T Lost', align: 'r' },
      { col: 'plusNet', label: 'S+T Net', align: 'r', net: true },
      { col: 'sptActive', label: 'S+T Active (EOM)', align: 'r' },
    ];
    const drillCols = activeTab === 'subscriptions' ? [
      { key: 'gained', label: 'Gained' },
      { key: 'lost', label: 'Lost' },
      { key: 'net', label: 'Net', net: true },
      { key: 'active', label: 'Active (EOM)' },
    ] : activeTab === 'trials' ? [
      { key: 'trials', label: 'Gained' },
      { key: 'trialsLost', label: 'Lost' },
      { key: 'trialsNet', label: 'Net', net: true },
      { key: 'trialsActive', label: 'Active (EOM)' },
    ] : [
      { key: 'plusGained', label: 'S+T Gained' },
      { key: 'plusLost', label: 'S+T Lost' },
      { key: 'plusNet', label: 'S+T Net', net: true },
      { key: 'sptActive', label: 'S+T Active (EOM)' },
    ];
    return (
      <table className="data-table gads-table">
        <thead>
          <tr>
            {cols.map((c) => <SortTh key={c.col} label={c.label} col={c.col} sort={monthSort} onSort={handleMonthSort} align={c.align} />)}
          </tr>
        </thead>
        <tbody>
          {sortedMonthly.map((r) => (
            <React.Fragment key={r.month}>
              <tr
                className={`gads-row-click ${r.month === '_total' ? 'gads-total-row-top' : ''}`}
                onClick={() => r.month !== '_total' && toggleExpand('m_' + r.month)}
              >
                <td>
                  {r.month !== '_total' ? (
                    <span className="gads-expand-arrow">{expandedKey === 'm_' + r.month ? '▼' : '▶'}</span>
                  ) : (
                    <span style={{ display: 'inline-block', width: 16, marginRight: 4 }} />
                  )}
                  <strong>{r.monthLabel}</strong>
                </td>
                {cols.slice(1).map((c) => (
                  <td key={c.col} className="text-right">
                    {c.net ? netCell(r[c.col]) : fI(r[c.col])}
                  </td>
                ))}
              </tr>
              {expandedKey === 'm_' + r.month && countryByMonth[r.month] && (
                <tr className="gads-sub-wrap">
                  <td colSpan={cols.length} style={{ padding: 0, border: 'none', verticalAlign: 'top' }}>
                    <div style={{ padding: 12, background: 'var(--bg-tertiary)' }}>
                      <table className="data-table gads-table gads-sub-table">
                        <thead>
                          <tr>
                            <th>Country</th>
                            {drillCols.map((d) => <th key={d.key} className="text-right">{d.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {countryRows(r.month).map((row) => (
                            <tr key={row.country} className="gads-sub-row">
                              <td><span className="gads-sub-indicator">↳</span> {row.country}</td>
                              {drillCols.map((d) => (
                                <td key={d.key} className="text-right">
                                  {d.net ? netCell(row[d.key]) : fI(row[d.key])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    );
  };

  const renderByCountryTable = () => {
    const cols = activeTab === 'subscriptions' ? [
      { col: 'country', label: 'Country' },
      { col: 'gained', label: 'Gained', align: 'r' },
      { col: 'lost', label: 'Lost', align: 'r' },
      { col: 'net', label: 'Net', align: 'r', net: true },
      { col: 'active', label: 'Active (EOM)', align: 'r' },
    ] : activeTab === 'trials' ? [
      { col: 'country', label: 'Country' },
      { col: 'trials', label: 'Gained', align: 'r' },
      { col: 'trialsLost', label: 'Lost', align: 'r' },
      { col: 'trialsNet', label: 'Net', align: 'r', net: true },
      { col: 'trialsActive', label: 'Active (EOM)', align: 'r' },
    ] : [
      { col: 'country', label: 'Country' },
      { col: 'plusGained', label: 'S+T Gained', align: 'r' },
      { col: 'plusLost', label: 'S+T Lost', align: 'r' },
      { col: 'plusNet', label: 'S+T Net', align: 'r', net: true },
      { col: 'sptActive', label: 'S+T Active (EOM)', align: 'r' },
    ];
    return (
      <table className="data-table gads-table">
        <thead>
          <tr>
            {cols.map((c) => <SortTh key={c.col} label={c.label} col={c.col} sort={countrySort} onSort={handleCountrySort} align={c.align} />)}
          </tr>
        </thead>
        <tbody>
          {totalRow && (
            <tr className="gads-total-row-top">
              <td><strong>Total</strong></td>
              {cols.slice(1).map((c) => (
                <td key={c.col} className="text-right"><strong>{c.net ? netCell(totalRow[c.col]) : fI(totalRow[c.col])}</strong></td>
              ))}
            </tr>
          )}
          {sortedCountry.map((r) => (
            <React.Fragment key={r.country}>
              <tr
                className="gads-row-click"
                onClick={() => toggleExpand('c_' + r.country)}
              >
                <td>
                  <span className="gads-expand-arrow">{expandedKey === 'c_' + r.country ? '▼' : '▶'}</span>
                  <strong>{r.country}</strong>
                </td>
                {cols.slice(1).map((c) => (
                  <td key={c.col} className="text-right">
                    {c.net ? netCell(r[c.col]) : fI(r[c.col])}
                  </td>
                ))}
              </tr>
              {expandedKey === 'c_' + r.country && (
                <tr className="gads-sub-wrap">
                  <td colSpan={cols.length} style={{ padding: 0, border: 'none', verticalAlign: 'top' }}>
                    <div style={{ padding: 12, background: 'var(--bg-tertiary)' }}>
                      <table className="data-table gads-table gads-sub-table">
                        <thead>
                          <tr>
                            <th>Month</th>
                            {cols.slice(1).map((c) => <th key={c.col} className="text-right">{c.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {monthRowsForCountry(r.country).map((row) => (
                            <tr key={row.month} className="gads-sub-row">
                              <td><span className="gads-sub-indicator">↳</span> {row.monthLabel}</td>
                              {cols.slice(1).map((c) => (
                                <td key={c.col} className="text-right">
                                  {c.net ? netCell(row[c.col]) : fI(row[c.col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="page-section active" id="page-vimeo-analytics">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: '#1AB7EA', color: 'white', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>V</span>
              Vimeo Subscription Analytics
            </h2>
            <p>Aggregated subscription metrics (December 2025)</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <DateRangePicker
              preset={datePreset}
              dateFrom={dateFrom}
              dateTo={dateTo}
              compareOn={false}
              compareFrom={compareFrom}
              compareTo={compareTo}
              onApply={handleDateApply}
            />
          </div>
        </div>

        {error && (
          <div style={{ padding: 16, background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={fetchData}>Retry</button>
          </div>
        )}

        <div className="gads-tabs-container" style={{ marginBottom: 16 }}>
              <div className="gads-tabs-row">
                <div className="gads-tabs">
                  {TABS.map((tab) => (
                    <button key={tab.id} type="button" className={`gads-tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" className={`btn btn-sm ${viewMode === 'month' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('month')}>By Month</button>
                  <button type="button" className={`btn btn-sm ${viewMode === 'country' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('country')}>By Country</button>
                </div>
              </div>
            </div>

        {loading ? (
          <div className="gads-loading" style={{ padding: 48, textAlign: 'center' }}>
            <div className="gads-spinner" style={{ marginBottom: 12 }} />
            <div>Loading subscription data...</div>
          </div>
        ) : (
          <>
            {activeTab === 'subscriptions' && (
              <>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <KpiCard label="Gained" value={kpis.gained} prev={compareKpis?.gained} />
                  <KpiCard label="Lost" value={kpis.lost} prev={compareKpis?.lost} inverse />
                  <KpiCard label="Net Growth" value={kpis.netGrowth} prev={compareKpis?.netGrowth} fmt={(v) => (v >= 0 ? '+' : '') + fI(v)} />
                  <KpiCard label="Active (EOM)" value={kpis.active} prev={compareKpis?.active} />
                </div>
                <div className="panel" style={{ marginBottom: 24 }}>
                  <div className="panel-header"><h3>Daily Trends</h3></div>
                  <div className="panel-body">
                    <div style={{ height: 240 }}><canvas ref={chartRef} /></div>
                  </div>
                </div>
                <div className="panel" style={{ marginBottom: 24 }}>
                  <div className="panel-body no-padding">
                    <div className="table-wrapper">{viewMode === 'month' ? renderByMonthTable() : renderByCountryTable()}</div>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'trials' && (
              <>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <KpiCard label="Trials Gained" value={kpis.trials} prev={compareKpis?.trials} />
                  <KpiCard label="Trials Lost" value={kpis.trialsLost} prev={compareKpis?.trialsLost} inverse />
                  <KpiCard label="Trials Net" value={kpis.trialsNet} prev={compareKpis?.trialsNet} fmt={(v) => (v >= 0 ? '+' : '') + fI(v)} />
                  <KpiCard label="Trials Active (EOM)" value={kpis.trialsActive} prev={compareKpis?.trialsActive} />
                </div>
                <div className="panel" style={{ marginBottom: 24 }}>
                  <div className="panel-header"><h3>Daily Trends</h3></div>
                  <div className="panel-body">
                    <div style={{ height: 240 }}><canvas ref={chartRef} /></div>
                  </div>
                </div>
                <div className="panel" style={{ marginBottom: 24 }}>
                  <div className="panel-body no-padding">
                    <div className="table-wrapper">{viewMode === 'month' ? renderByMonthTable() : renderByCountryTable()}</div>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'spt' && (
              <>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <KpiCard label="S+T Gained" value={kpis.plusGained} prev={compareKpis?.plusGained} />
                  <KpiCard label="S+T Lost" value={kpis.plusLost} prev={compareKpis?.plusLost} inverse />
                  <KpiCard label="S+T Net Growth" value={kpis.plusNet} prev={compareKpis?.plusNet} fmt={(v) => (v >= 0 ? '+' : '') + fI(v)} />
                  <KpiCard label="S+T Active (EOM)" value={kpis.sptActive} prev={compareKpis?.sptActive} />
                </div>
                <div className="panel" style={{ marginBottom: 24 }}>
                  <div className="panel-header"><h3>Daily Trends</h3></div>
                  <div className="panel-body">
                    <div style={{ height: 240 }}><canvas ref={chartRef} /></div>
                  </div>
                </div>
                <div className="panel" style={{ marginBottom: 24 }}>
                  <div className="panel-body no-padding">
                    <div className="table-wrapper">{viewMode === 'month' ? renderByMonthTable() : renderByCountryTable()}</div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
