import { useState, useEffect, useMemo } from 'react';
import { useVimeoSubscriptionsData } from '../../hooks/useVimeoSubscriptionsData';
import { formatCurrency2, formatNumber } from '../../utils/format';
import Chart from 'chart.js/auto';

function num(v) {
  return Number(v) || 0;
}

export function GeographyPage() {
  const { loading, error, rawData } = useVimeoSubscriptionsData();
  const [selectedCountry, setSelectedCountry] = useState(null);

  const tableData = useMemo(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const byCountry = {};
    rawData.forEach((r) => {
      const c = r.country || 'Unknown';
      if (!byCountry[c]) {
        byCountry[c] = {
          country: c,
          active_subscribers: 0,
          new_this_month: 0,
          churned_this_month: 0,
          ltvSum: 0,
          ltvCount: 0,
          healthSum: 0,
          healthCount: 0,
        };
      }
      const rec = byCountry[c];
      if ((r.status || '').toLowerCase() === 'enabled') rec.active_subscribers++;
      if (r.date_became_enabled) {
        const d = new Date(r.date_became_enabled);
        if (d >= thisMonthStart && d <= thisMonthEnd) rec.new_this_month++;
      }
      if (r.date_last_canceled) {
        const d = new Date(r.date_last_canceled);
        if (d >= thisMonthStart && d <= thisMonthEnd) rec.churned_this_month++;
      }
      if (num(r.lifetime_value) > 0) {
        rec.ltvSum += num(r.lifetime_value);
        rec.ltvCount++;
      }
      if (num(r.health_score) > 0) {
        rec.healthSum += num(r.health_score);
        rec.healthCount++;
      }
    });

    return Object.values(byCountry).map((g) => ({
      ...g,
      avg_lifetime_value: g.ltvCount > 0 ? g.ltvSum / g.ltvCount : 0,
      avg_health_score: g.healthCount > 0 ? (g.healthSum / g.healthCount).toFixed(1) : '—',
    })).sort((a, b) => b.active_subscribers - a.active_subscribers);
  }, [rawData]);

  useEffect(() => {
    if (!tableData.length || loading) return;
    const ctx = document.getElementById('chart-geo');
    if (!ctx) return;
    const top15 = tableData.slice(0, 15);
    const ch = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top15.map((d) => d.country),
        datasets: [{ label: 'Subscribers', data: top15.map((d) => d.active_subscribers), backgroundColor: '#1AB7EA' }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } },
      },
    });
    return () => ch.destroy();
  }, [tableData, loading]);

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
    <div className="page-section active" id="page-geography">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Geography</h2>
          <p>Subscriber distribution by country</p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Subscribers by Country (Top 15)</h3>
          </div>
          <div className="panel-body">
            <div className="chart-container" style={{ height: 400 }}>
              <canvas id="chart-geo" />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Country Breakdown</h3>
            <p className="panel-subtitle">Click a country to filter data</p>
          </div>
          <div className="panel-body no-padding">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th className="text-right">Active</th>
                  <th className="text-right">New This Month</th>
                  <th className="text-right">Churned This Month</th>
                  <th className="text-right">Avg LTV</th>
                  <th className="text-right">Avg Health</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((r) => (
                  <tr
                    key={r.country}
                    className={selectedCountry === r.country ? 'selected' : ''}
                    onClick={() => setSelectedCountry(selectedCountry === r.country ? null : r.country)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td><strong>{r.country}</strong></td>
                    <td className="text-right">{formatNumber(r.active_subscribers)}</td>
                    <td className="text-right">{formatNumber(r.new_this_month)}</td>
                    <td className="text-right">{formatNumber(r.churned_this_month)}</td>
                    <td className="text-right">{formatCurrency2(r.avg_lifetime_value)}</td>
                    <td className="text-right">{r.avg_health_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
