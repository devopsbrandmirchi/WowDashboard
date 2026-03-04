import { useState, useEffect, useMemo } from 'react';
import { useVimeoSubscriptionsData } from '../../hooks/useVimeoSubscriptionsData';
import { formatCurrency2, formatNumber, formatDec } from '../../utils/format';
import Chart from 'chart.js/auto';

function num(v) {
  return Number(v) || 0;
}

export function ChurnPage() {
  const { loading, error, rawData } = useVimeoSubscriptionsData();
  const [page, setPage] = useState(1);

  const kpis = useMemo(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const churnedThisMonth = rawData.filter((r) => {
      const d = r.date_last_canceled;
      if (!d) return false;
      const dt = new Date(d);
      return dt >= thisMonthStart && dt <= thisMonthEnd;
    });

    const active = rawData.filter((r) => (r.status || '').toLowerCase() === 'enabled');
    const activeAtStartApprox = active.length + churnedThisMonth.length;
    const churnRate = activeAtStartApprox > 0 ? (churnedThisMonth.length / activeAtStartApprox) * 100 : 0;

    const reasonCounts = {};
    churnedThisMonth.forEach((r) => {
      const cat = r.cancel_reason_category || 'Unknown';
      reasonCounts[cat] = (reasonCounts[cat] || 0) + 1;
    });
    const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    const ltvValues = churnedThisMonth.filter((r) => num(r.lifetime_value) > 0).map((r) => num(r.lifetime_value));
    const avgLtvBeforeChurn = ltvValues.length > 0 ? ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length : 0;

    const monthlyChurn = [];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      const count = rawData.filter((r) => {
        const d = r.date_last_canceled;
        if (!d) return false;
        const dt = new Date(d);
        return dt >= m && dt <= mEnd;
      }).length;
      monthlyChurn.push({ month: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, count });
    }

    return {
      churnedThisMonth: churnedThisMonth.length,
      churnRate,
      topReason,
      avgLtvBeforeChurn,
      reasonBreakdown: Object.entries(reasonCounts).map(([name, value]) => ({ name, value })),
      monthlyChurn,
      churnedRows: churnedThisMonth,
    };
  }, [rawData]);

  useEffect(() => {
    if (!kpis.reasonBreakdown?.length || loading) return;
    const ctx = document.getElementById('chart-churn-reason');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: kpis.reasonBreakdown.map((d) => d.name),
        datasets: [{ label: 'Count', data: kpis.reasonBreakdown.map((d) => d.value), backgroundColor: '#ED1C24' }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    });
    return () => ch.destroy();
  }, [kpis.reasonBreakdown, loading]);

  useEffect(() => {
    if (!kpis.monthlyChurn?.length || loading) return;
    const ctx = document.getElementById('chart-churn-trend');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'line',
      data: {
        labels: kpis.monthlyChurn.map((d) => d.month),
        datasets: [
          { label: 'Churned', data: kpis.monthlyChurn.map((d) => d.count), borderColor: '#ED1C24', tension: 0.4, fill: true, backgroundColor: 'rgba(237,28,36,0.1)' },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    });
    return () => ch.destroy();
  }, [kpis.monthlyChurn, loading]);

  const PG = 50;
  const total = kpis.churnedRows?.length || 0;
  const pages = Math.ceil(total / PG) || 1;
  const start = (page - 1) * PG;
  const paginated = (kpis.churnedRows || []).slice(start, start + PG);

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
    <div className="page-section active" id="page-churn">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Churn Analysis</h2>
          <p>Cancellation insights and trends</p>
        </div>

        <div className="sub-kpi-grid sub-kpi-grid-4">
          <div className="sub-kpi-card sub-kpi-red">
            <div className="sub-kpi-label">Total Churned This Month</div>
            <div className="sub-kpi-value">{formatNumber(kpis.churnedThisMonth)}</div>
          </div>
          <div className="sub-kpi-card sub-kpi-red">
            <div className="sub-kpi-label">Churn Rate</div>
            <div className="sub-kpi-value">{formatDec(kpis.churnRate, 2)}%</div>
          </div>
          <div className="sub-kpi-card sub-kpi-blue">
            <div className="sub-kpi-label">Top Cancel Reason</div>
            <div className="sub-kpi-value sub-kpi-value-sm">{kpis.topReason}</div>
          </div>
          <div className="sub-kpi-card sub-kpi-blue">
            <div className="sub-kpi-label">Avg Lifetime Before Churn</div>
            <div className="sub-kpi-value">{formatCurrency2(kpis.avgLtvBeforeChurn)}</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header">
              <h3>Cancel Reasons Breakdown</h3>
            </div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-churn-reason" />
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <h3>Monthly Churn Trend (Last 12 Months)</h3>
            </div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-churn-trend" />
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Churned Subscribers</h3>
          </div>
          <div className="panel-body no-padding">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Cancel Reason</th>
                  <th className="text-right">Lifetime Value</th>
                  <th>Customer Days</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => (
                  <tr key={r.record_id || r.vimeo_email || Math.random()}>
                    <td>{r.vimeo_email || r.email || '—'}</td>
                    <td>{r.cancel_reason_category || r.cancel_reason_long || '—'}</td>
                    <td className="text-right">{formatCurrency2(r.lifetime_value)}</td>
                    <td>{r.continues_customer_days ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
