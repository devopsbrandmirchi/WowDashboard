import React, { useState, useEffect, useCallback } from 'react';
import { useSubscriberIntelligenceData } from '../hooks/useSubscriberIntelligenceData';

const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const fP = (n) => Number(n || 0).toFixed(2) + '%';

const EMAIL_COLS = [
  { key: 'vimeo_email', label: 'Email', get: (r) => r.vimeo_email || r.email || '—' },
  { key: 'first_name', label: 'First Name', get: (r) => r.first_name || '—' },
  { key: 'last_name', label: 'Last Name', get: (r) => r.last_name || '—' },
  { key: 'current_plan', label: 'Plan', get: (r) => r.current_plan || '—' },
  { key: 'frequency', label: 'Frequency', get: (r) => r.frequency || '—' },
  { key: 'platform', label: 'Platform', get: (r) => r.platform || '—' },
  { key: 'country', label: 'Country', get: (r) => r.country || '—' },
  { key: 'status', label: 'Status', get: (r) => r.status || '—' },
  { key: 'date_became_enabled', label: 'Date Became Enabled', get: (r) => r.date_became_enabled ? new Date(r.date_became_enabled).toLocaleDateString() : '—' },
];

function exportCSV(rows, filename) {
  const header = EMAIL_COLS.map((c) => `"${c.label}"`).join(',');
  const body = rows.map((r) => EMAIL_COLS.map((c) => `"${String(c.get(r) || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function SortTh({ label, col, sort, onSort, align }) {
  const arrow = sort?.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return <th className={`gads-sortable ${align === 'r' ? 'text-right' : ''}`} onClick={() => onSort(col)}>{label}{arrow}</th>;
}

function num(v) { return Number(v) || 0; }

export function SubscriberIntelligencePage() {
  const {
    loading, error, fetchData, emailListLoading,
    kpis, lastUpdated,
    byCountry, byPlatform, trialsMonthly, byStatus,
    fetchEmailList,
  } = useSubscriberIntelligenceData();

  const [activeTab, setActiveTab] = useState('country');
  const [sort, setSort] = useState({ country: { col: 'active', dir: 'desc' }, platform: { col: 'active', dir: 'desc' }, trials: { col: 'month', dir: 'desc' }, status: { col: 'total', dir: 'desc' } });
  const [expanded, setExpanded] = useState({});
  const [expandedRowData, setExpandedRowData] = useState({});

  const handleSort = useCallback((tab, col) => {
    setSort((prev) => {
      const s = prev[tab] || { col: 'active', dir: 'desc' };
      const dir = s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc';
      return { ...prev, [tab]: { col, dir } };
    });
  }, []);

  const toggleExpand = useCallback((key) => {
    setExpanded((prev) => { const n = { ...prev }; if (n[key]) delete n[key]; else n[key] = true; return n; });
  }, []);

  useEffect(() => {
    const keys = Object.keys(expanded).filter((k) => expanded[k]);
    keys.forEach((expandKey) => {
      if (expandedRowData[expandKey]) return;
      const m = expandKey.match(/^(country|platform|status)_(.+)$/);
      const m2 = expandKey.match(/^trials_(.+)$/);
      setExpandedRowData((prev) => ({ ...prev, [expandKey]: { loading: true, rows: [] } }));
      if (m) {
        const [, type, filterKey] = m;
        const metricKey = type === 'country' ? 'country' : type === 'platform' ? 'platform' : 'status';
        fetchEmailList(metricKey, filterKey).then((rows) => {
          setExpandedRowData((prev) => ({ ...prev, [expandKey]: { loading: false, rows } }));
        });
      } else if (m2) {
        const monthKey = m2[1];
        fetchEmailList('trials', null, monthKey).then((rows) => {
          setExpandedRowData((prev) => ({ ...prev, [expandKey]: { loading: false, rows } }));
        });
      }
    });
  }, [expanded, fetchEmailList]);

  const countryData = React.useMemo(() => {
    const total = byCountry.reduce((s, x) => s + num(x.active), 0);
    return byCountry.map((r) => ({
      ...r,
      active: num(r.active),
      monthly: num(r.monthly),
      yearly: num(r.yearly),
      pctOfTotal: total > 0 ? (num(r.active) / total) * 100 : 0,
    }));
  }, [byCountry]);

  const platformData = React.useMemo(() => {
    const total = byPlatform.reduce((s, x) => s + num(x.active), 0);
    return byPlatform.map((r) => ({
      ...r,
      active: num(r.active),
      monthly: num(r.monthly),
      yearly: num(r.yearly),
      pctOfTotal: total > 0 ? (num(r.active) / total) * 100 : 0,
    }));
  }, [byPlatform]);

  const statusData = React.useMemo(() => {
    const total = byStatus.reduce((s, x) => s + num(x.total), 0);
    return byStatus.map((r) => ({
      ...r,
      total: num(r.total),
      pctOfTotal: total > 0 ? (num(r.total) / total) * 100 : 0,
    }));
  }, [byStatus]);

  const trialsData = React.useMemo(() => trialsMonthly.map((r) => {
    const m = r.month || '';
    const monthLabel = m.length >= 7 ? new Date(m + '-01').toLocaleString('en-US', { month: 'short', year: 'numeric' }) : m || '—';
    return {
      month: r.month || '—',
      monthLabel,
      trialsStarted: num(r.trials_started),
      converted: num(r.converted),
      stillOnTrial: num(r.still_on_trial),
      nowActive: num(r.now_active),
    };
  }), [trialsMonthly]);

  function sortRows(rows, col, dir) {
    return [...rows].sort((a, b) => {
      const va = a[col], vb = b[col], d = dir === 'asc' ? 1 : -1;
      if (typeof va === 'string') return d * (va || '').localeCompare(vb || '');
      return d * ((num(va) || 0) - (num(vb) || 0));
    });
  }

  const subRowContent = (expandKey) => {
    const data = expandedRowData[expandKey];
    const rows = data?.rows || [];
    const loading = data?.loading;
    if (loading) return <tr className="gads-sub-wrap"><td colSpan={12} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}><div className="gads-spinner" style={{ display: 'inline-block', marginRight: 8 }} /> Loading...</td></tr>;
    return (
      <tr className="gads-sub-wrap"><td colSpan={12} style={{ padding: 0, border: 'none', verticalAlign: 'top' }}>
        <div className="gads-sub-table-wrap" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => exportCSV(rows, 'subscribers.csv')}>↓ Export CSV</button>
          </div>
          <table className="data-table gads-table gads-sub-table">
            <thead><tr>{EMAIL_COLS.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="gads-sub-row">
                  {EMAIL_COLS.map((c) => <td key={c.key}>{c.get(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !loading && <p style={{ padding: 12, color: 'var(--text-muted)' }}>No subscribers found.</p>}
        </div>
      </td></tr>
    );
  };

  const TABS = [
    { id: 'country', label: 'By Country', data: countryData, cols: [
      { col: 'country', label: 'Country', cell: (r) => r.country },
      { col: 'active', label: 'Active', align: 'r', cell: (r) => fI(r.active) },
      { col: 'monthly', label: 'Monthly', align: 'r', cell: (r) => fI(r.monthly) },
      { col: 'yearly', label: 'Yearly', align: 'r', cell: (r) => fI(r.yearly) },
      { col: 'pctOfTotal', label: '% of Total', align: 'r', cell: (r) => fP(r.pctOfTotal) },
    ], rowKey: (r) => r.country, expandKey: (r) => 'country_' + (r.country || '') },
    { id: 'platform', label: 'By Platform', data: platformData, cols: [
      { col: 'platform', label: 'Platform', cell: (r) => r.platform },
      { col: 'active', label: 'Active', align: 'r', cell: (r) => fI(r.active) },
      { col: 'monthly', label: 'Monthly', align: 'r', cell: (r) => fI(r.monthly) },
      { col: 'yearly', label: 'Yearly', align: 'r', cell: (r) => fI(r.yearly) },
      { col: 'pctOfTotal', label: '% of Total', align: 'r', cell: (r) => fP(r.pctOfTotal) },
    ], rowKey: (r) => r.platform, expandKey: (r) => 'platform_' + (r.platform || '') },
    { id: 'trials', label: 'Trials', data: trialsData, cols: [
      { col: 'month', label: 'Month', cell: (r) => r.monthLabel || r.month },
      { col: 'trialsStarted', label: 'Trials Started', align: 'r', cell: (r) => fI(r.trialsStarted) },
      { col: 'converted', label: 'Converted', align: 'r', cell: (r) => fI(r.converted) },
      { col: 'stillOnTrial', label: 'Still on Trial', align: 'r', cell: (r) => fI(r.stillOnTrial) },
      { col: 'nowActive', label: 'Now Active', align: 'r', cell: (r) => fI(r.nowActive) },
    ], rowKey: (r) => r.month, expandKey: (r) => 'trials_' + (r.month || '') },
    { id: 'status', label: 'Status Breakdown', data: statusData, cols: [
      { col: 'status', label: 'Status', cell: (r) => r.status },
      { col: 'total', label: 'Total', align: 'r', cell: (r) => fI(r.total) },
      { col: 'pctOfTotal', label: '% of Total', align: 'r', cell: (r) => fP(r.pctOfTotal) },
    ], rowKey: (r) => r.status, expandKey: (r) => 'status_' + (r.status || '') },
  ];

  const tab = TABS.find((t) => t.id === activeTab);
  const s = sort[activeTab] || { col: 'active', dir: 'desc' };
  const sortedData = tab ? sortRows(tab.data, s.col, s.dir) : [];

  return (
    <div className="page-section active" id="page-subscriber-intelligence">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: '#8B3F8E', color: 'white', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>H</span>
              HubSpot Subscriber Intelligence
            </h2>
            <p>Subscriber breakdown by country, platform, trials & status</p>
            {lastUpdated && !loading && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Last updated: {lastUpdated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>
        </div>

        {error && (
          <div style={{ padding: 16, background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={fetchData}>Retry</button>
          </div>
        )}

        {loading && <div className="gads-loading"><div className="gads-spinner" /> Loading...</div>}

        {!loading && (
          <>
            <div className="kpi-grid-6 gads-kpi-section" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', marginBottom: 24, gap: 16 }}>
              <div className="rkpi-card">
                <div className="rkpi-header"><span className="rkpi-label">TOTAL ACTIVE SUBSCRIBERS</span></div>
                <div className="rkpi-value">{fI(kpis.totalActive)}</div>
              </div>
              <div className="rkpi-card">
                <div className="rkpi-header"><span className="rkpi-label">STANDARD TIER</span></div>
                <div className="rkpi-value">{fI(kpis.standardTier)}</div>
              </div>
              <div className="rkpi-card">
                <div className="rkpi-header"><span className="rkpi-label">ALL ACCESS TIER</span></div>
                <div className="rkpi-value">{fI(kpis.allAccessTier)}</div>
              </div>
              <div className="rkpi-card">
                <div className="rkpi-header"><span className="rkpi-label">MONTHLY SUBS</span></div>
                <div className="rkpi-value">{fI(kpis.monthly)}</div>
              </div>
              <div className="rkpi-card">
                <div className="rkpi-header"><span className="rkpi-label">YEARLY SUBS</span></div>
                <div className="rkpi-value">{fI(kpis.yearly)}</div>
              </div>
              <div className="rkpi-card">
                <div className="rkpi-header"><span className="rkpi-label">ACTIVE TRIALS</span></div>
                <div className="rkpi-value">{fI(kpis.activeTrials)}</div>
              </div>
            </div>

            <div className="gads-tabs-container" style={{ marginBottom: 16 }}>
              <div className="gads-tabs">
                {TABS.map((t) => (
                  <button key={t.id} type="button" className={`gads-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
                    {t.label} ({t.data.length})
                  </button>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>{tab?.label}</h3></div>
              <div className="panel-body no-padding">
                <div className="table-wrapper">
                  <table className="data-table gads-table">
                    <thead>
                      <tr>
                        {tab?.cols.map((c) => (
                          <SortTh key={c.col} label={c.label} col={c.col} sort={s} onSort={(col) => handleSort(activeTab, col)} align={c.align} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tab && sortedData.length > 0 && (activeTab === 'country' || activeTab === 'platform') && (
                        <tr className="gads-total-row-top">
                          <td><strong>Total</strong></td>
                          {tab.cols.slice(1).map((c) => (
                            <td key={c.col} className={c.align === 'r' ? 'text-right' : ''}>
                              <strong>{c.col === 'pctOfTotal' ? '100%' : fI(sortedData.reduce((sum, r) => sum + num(r[c.col]), 0))}</strong>
                            </td>
                          ))}
                        </tr>
                      )}
                      {tab && sortedData.length > 0 && activeTab === 'trials' && (
                        <tr className="gads-total-row-top">
                          <td><strong>Total</strong></td>
                          <td className="text-right"><strong>{fI(sortedData.reduce((s, r) => s + num(r.trialsStarted), 0))}</strong></td>
                          <td className="text-right"><strong>{fI(sortedData.reduce((s, r) => s + num(r.converted), 0))}</strong></td>
                          <td className="text-right"><strong>{fI(sortedData.reduce((s, r) => s + num(r.stillOnTrial), 0))}</strong></td>
                          <td className="text-right"><strong>{fI(sortedData.reduce((s, r) => s + num(r.nowActive), 0))}</strong></td>
                        </tr>
                      )}
                      {tab && activeTab === 'status' && sortedData.length > 0 && (
                        <tr className="gads-total-row-top">
                          <td><strong>Total</strong></td>
                          <td className="text-right"><strong>{fI(sortedData.reduce((s, r) => s + num(r.total), 0))}</strong></td>
                          <td className="text-right"><strong>100%</strong></td>
                        </tr>
                      )}
                      {sortedData.map((r, i) => {
                        const expandKey = tab?.expandKey(r);
                        const isExpanded = expandKey && expanded[expandKey];
                        return (
                          <React.Fragment key={tab?.rowKey(r) || i}>
                            <tr className="gads-row-click" onClick={() => expandKey && toggleExpand(expandKey)}>
                              {tab?.cols.map((c) => (
                                <td key={c.col} className={c.align === 'r' ? 'text-right' : ''}>
                                  {c === tab.cols[0] && expandKey ? <><span className="gads-expand-arrow">{isExpanded ? '▼' : '▶'}</span> {c.cell(r)}</> : c.cell(r)}
                                </td>
                              ))}
                            </tr>
                            {isExpanded && subRowContent(expandKey)}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
