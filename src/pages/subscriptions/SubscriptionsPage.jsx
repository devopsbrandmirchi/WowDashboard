import { useState, useMemo } from 'react';
import { useVimeoSubscriptionsData } from '../../hooks/useVimeoSubscriptionsData';
import { formatCurrency2, formatNumber } from '../../utils/format';

const PG = 50;

function exportCSV(rows, cols) {
  const header = cols.map((c) => `"${c.label}"`).join(',');
  const body = rows.map((r) =>
    cols.map((c) => {
      const v = c.fmt ? c.fmt(r[c.key]) : r[c.key];
      return typeof v === 'number' ? v : `"${String(v || '').replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

const COLS = [
  { key: 'vimeo_email', label: 'Email' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'country', label: 'Country' },
  { key: 'current_plan', label: 'Plan' },
  { key: 'status', label: 'Status' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'platform', label: 'Platform' },
  { key: 'subscription_price', label: 'Price', fmt: (v) => formatCurrency2(v) },
  { key: 'lifetime_value', label: 'LTV', fmt: (v) => formatCurrency2(v) },
  { key: 'date_became_enabled', label: 'Date Enabled', fmt: (v) => (v ? new Date(v).toLocaleDateString() : '') },
  { key: 'health_score_status', label: 'Health' },
];

export function SubscriptionsPage() {
  const { loading, error, rawData } = useVimeoSubscriptionsData();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    country: '',
    plan: '',
    frequency: '',
    platform: '',
    dateFrom: '',
    dateTo: '',
  });
  const [sortCol, setSortCol] = useState('date_became_enabled');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let rows = [...rawData];
    if (search.trim()) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.vimeo_email || r.email || '').toLowerCase().includes(s) ||
          (r.first_name || '').toLowerCase().includes(s) ||
          (r.last_name || '').toLowerCase().includes(s)
      );
    }
    if (filters.status) rows = rows.filter((r) => (r.status || '').toLowerCase() === filters.status.toLowerCase());
    if (filters.country) rows = rows.filter((r) => (r.country || '').toLowerCase() === filters.country.toLowerCase());
    if (filters.plan) rows = rows.filter((r) => (r.current_plan || '').toLowerCase().includes(filters.plan.toLowerCase()));
    if (filters.frequency) rows = rows.filter((r) => (r.frequency || '').toLowerCase() === filters.frequency.toLowerCase());
    if (filters.platform) rows = rows.filter((r) => (r.platform || '').toLowerCase() === filters.platform.toLowerCase());
    if (filters.dateFrom) {
      rows = rows.filter((r) => r.date_became_enabled && r.date_became_enabled >= filters.dateFrom);
    }
    if (filters.dateTo) {
      rows = rows.filter((r) => r.date_became_enabled && r.date_became_enabled.slice(0, 10) <= filters.dateTo);
    }
    rows.sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      const d = sortDir === 'asc' ? 1 : -1;
      if (typeof va === 'string' && typeof vb === 'string') return d * va.localeCompare(vb);
      return d * ((+(va || 0)) - (+(vb || 0)));
    });
    return rows;
  }, [rawData, search, filters, sortCol, sortDir]);

  const options = useMemo(() => {
    const statuses = [...new Set(rawData.map((r) => (r.status || '').toLowerCase()).filter(Boolean))];
    const countries = [...new Set(rawData.map((r) => r.country).filter(Boolean))].sort();
    const plans = [...new Set(rawData.map((r) => r.current_plan).filter(Boolean))].sort();
    const freqs = [...new Set(rawData.map((r) => (r.frequency || '').toLowerCase()).filter(Boolean))];
    const platforms = [...new Set(rawData.map((r) => (r.platform || '').toLowerCase()).filter(Boolean))];
    return { statuses, countries, plans, freqs, platforms };
  }, [rawData]);

  const total = filtered.length;
  const pages = Math.ceil(total / PG) || 1;
  const start = (page - 1) * PG;
  const paginated = filtered.slice(start, start + PG);

  if (loading) {
    return (
      <div className="page-section active">
        <div className="page-content">
          <p className="sub-loading">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-section active">
        <div className="page-content">
          <p className="sub-error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-section active" id="page-subscriptions">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Subscriptions</h2>
          <p>Filterable table of all subscribers</p>
        </div>

        <div className="panel sub-filters-panel">
          <div className="panel-body">
            <div className="sub-filters">
              <input
                type="text"
                placeholder="Search email or name..."
                className="sub-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="">All Status</option>
                {options.statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select value={filters.country} onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value }))}>
                <option value="">All Countries</option>
                {options.countries.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select value={filters.plan} onChange={(e) => setFilters((f) => ({ ...f, plan: e.target.value }))}>
                <option value="">All Plans</option>
                {options.plans.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select value={filters.frequency} onChange={(e) => setFilters((f) => ({ ...f, frequency: e.target.value }))}>
                <option value="">All Frequency</option>
                {options.freqs.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <select value={filters.platform} onChange={(e) => setFilters((f) => ({ ...f, platform: e.target.value }))}>
                <option value="">All Platform</option>
                {options.platforms.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
              <input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => exportCSV(filtered, COLS)}>
                Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-body no-padding">
            <div className="sub-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {COLS.map((c) => (
                      <th
                        key={c.key}
                        className={c.fmt ? 'text-right' : ''}
                        onClick={() => {
                          setSortCol(c.key);
                          setSortDir((d) => (sortCol === c.key ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {c.label} {sortCol === c.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((r) => (
                    <tr key={r.record_id || r.vimeo_email || Math.random()}>
                      {COLS.map((c) => (
                        <td key={c.key} className={c.fmt ? 'text-right' : ''}>
                          {c.fmt ? c.fmt(r[c.key]) : r[c.key] ?? r.email ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="sub-pagination">
                <span>Showing {start + 1}–{Math.min(start + PG, total)} of {formatNumber(total)}</span>
                <div className="sub-pg-btns">
                  <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                  <span>Page {page} of {pages}</span>
                  <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
