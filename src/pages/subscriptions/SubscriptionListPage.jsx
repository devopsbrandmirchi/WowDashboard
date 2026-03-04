import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useSubscriptionListData } from '../../hooks/useSubscriptionListData';
import { formatCurrency2, formatNumber } from '../../utils/format';

const METRIC_LABELS = {
  total_active_subscribers: 'Total Active Subscribers',
  new_subscribers_this_month: 'New Subscribers This Month',
  new_subscribers_last_month: 'New Subscribers Last Month',
  month_over_month_growth: 'Month-over-Month Growth',
  active_trials: 'Active Trials',
  trial_conversions_this_month: 'Trial Conversions This Month',
  cancellations_this_month: 'Cancellations This Month',
  churn_rate: 'Churn Rate',
  mrr: 'MRR',
  avg_lifetime_value: 'Average Lifetime Value',
};

const COLS = [
  { key: 'vimeo_email', label: 'Email' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'country', label: 'Country' },
  { key: 'state', label: 'State' },
  { key: 'current_plan', label: 'Plan' },
  { key: 'status', label: 'Status' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'subscription_price', label: 'Price', fmt: (v) => formatCurrency2(v) },
  { key: 'date_became_enabled', label: 'Date Enabled', fmt: (v) => (v ? new Date(v).toLocaleDateString() : '') },
  { key: 'customer_created_at', label: 'Customer Created', fmt: (v) => (v ? new Date(v).toLocaleDateString() : '') },
];

const PG = 50;

function exportCSV(data, filename) {
  const header = COLS.map((c) => `"${c.label}"`).join(',');
  const body = data.map((r) =>
    COLS.map((c) => {
      const v = c.fmt ? c.fmt(r[c.key]) : r[c.key];
      return typeof v === 'number' ? v : `"${String(v || '').replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

export function SubscriptionListPage() {
  const [searchParams] = useSearchParams();
  const metric = searchParams.get('metric') || 'total_active_subscribers';
  const { loading, error, data } = useSubscriptionListData(metric);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('vimeo_email');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let rows = [...data];
    if (search.trim()) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.vimeo_email || r.email || '').toLowerCase().includes(s) ||
          (r.first_name || '').toLowerCase().includes(s) ||
          (r.last_name || '').toLowerCase().includes(s)
      );
    }
    rows.sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      const d = sortDir === 'asc' ? 1 : -1;
      if (typeof va === 'string' && typeof vb === 'string') return d * va.localeCompare(vb);
      return d * ((+(va || 0)) - (+(vb || 0)));
    });
    return rows;
  }, [data, search, sortCol, sortDir]);

  const total = filtered.length;
  const pages = Math.ceil(total / PG) || 1;
  const start = (page - 1) * PG;
  const paginated = filtered.slice(start, start + PG);

  const handleSort = (col) => {
    setSortCol(col);
    setSortDir((d) => (sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
  };

  if (loading) {
    return (
      <div className="page-section active subscriptions-list-page">
        <div className="page-content">
          <p className="sub-loading">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-section active subscriptions-list-page">
        <div className="page-content">
          <p className="sub-error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-section active subscriptions-list-page subscriptions-list-full">
      <div className="page-content">
        <div className="page-title-bar sub-list-header">
          <div>
            <Link to="/" className="btn btn-outline btn-sm sub-back-btn">
              ← Back to Dashboard
            </Link>
            <h2>{METRIC_LABELS[metric] || metric}</h2>
            <p>{formatNumber(data.length)} records</p>
          </div>
          <div className="sub-list-actions">
            <input
              type="text"
              placeholder="Search email or name..."
              className="sub-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => exportCSV(filtered, `subscriptions-${metric}-${new Date().toISOString().slice(0, 10)}.csv`)}
            >
              Export CSV
            </button>
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
                        className={c.key === 'subscription_price' ? 'text-right' : ''}
                        onClick={() => handleSort(c.key)}
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
                        <td key={c.key} className={c.key === 'subscription_price' ? 'text-right' : ''}>
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
                <span>
                  Showing {start + 1}–{Math.min(start + PG, total)} of {formatNumber(total)}
                </span>
                <div className="sub-pg-btns">
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ← Prev
                  </button>
                  <span className="sub-pg-info">
                    Page {page} of {pages}
                  </span>
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
