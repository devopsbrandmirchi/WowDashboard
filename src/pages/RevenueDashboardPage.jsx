import { useEffect, useCallback } from 'react';
import { useSubscriptionsData } from '../hooks/useSubscriptionsData';
import { formatCurrency2, formatNumber } from '../utils/format';
import { DateRangePicker } from '../components/DatePicker';
import Chart from 'chart.js/auto';

const fU = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RevenueDashboardPage() {
  const {
    filters, batchUpdateFilters, fetchData, loading, error,
    kpis, compareKpis,
    revenueMonthlyTrend, revenueByCountry, revenueByPlan, revenueByFreq, revenueByPlatform, totalLtv,
  } = useSubscriptionsData();

  const mrr = kpis?.mrr || 0;
  const arr = mrr * 12;
  const totalActive = kpis?.totalActive || 0;
  const arpu = totalActive > 0 ? mrr / totalActive : 0;
  const mrrPrev = compareKpis?.mrr;
  const mrrChange = mrrPrev != null && mrrPrev > 0 ? ((mrr - mrrPrev) / mrrPrev) * 100 : null;

  const handleDatePickerApply = useCallback(({ preset, dateFrom, dateTo, compareOn, compareFrom, compareTo }) => {
    batchUpdateFilters({ datePreset: preset, dateFrom: dateFrom || '', dateTo: dateTo || '', compareOn, compareFrom: compareFrom || '', compareTo: compareTo || '' });
  }, [batchUpdateFilters]);

  useEffect(() => {
    if (!revenueMonthlyTrend?.length || loading) return;
    const ctx = document.getElementById('chart-rev-trend');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'line',
      data: {
        labels: revenueMonthlyTrend.map((d) => d.month),
        datasets: [
          { label: 'MRR', data: revenueMonthlyTrend.map((d) => d.mrr), borderColor: '#2E9E40', backgroundColor: 'rgba(46, 158, 64, 0.1)', tension: 0.4, fill: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } },
      },
    });
    return () => ch.destroy();
  }, [revenueMonthlyTrend, loading]);

  useEffect(() => {
    if (!revenueByCountry?.length || loading) return;
    const ctx = document.getElementById('chart-rev-country');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: revenueByCountry.map((d) => d.name),
        datasets: [{ label: 'MRR', data: revenueByCountry.map((d) => d.value), backgroundColor: '#1AB7EA' }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } },
      },
    });
    return () => ch.destroy();
  }, [revenueByCountry, loading]);

  useEffect(() => {
    if (!revenueByPlan?.length || loading) return;
    const ctx = document.getElementById('chart-rev-plan');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: revenueByPlan.map((d) => d.name),
        datasets: [{ data: revenueByPlan.map((d) => d.value), backgroundColor: ['#1AB7EA', '#2E9E40', '#8B3F8E', '#F5A623', '#ED1C24'] }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
    return () => ch.destroy();
  }, [revenueByPlan, loading]);

  useEffect(() => {
    if (!revenueByFreq || loading) return;
    const ctx = document.getElementById('chart-rev-freq');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Monthly', 'Yearly (MRR)'],
        datasets: [{ data: [revenueByFreq.monthly, revenueByFreq.yearly], backgroundColor: ['#1AB7EA', '#8B3F8E'] }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
    return () => ch.destroy();
  }, [revenueByFreq, loading]);

  useEffect(() => {
    if (!revenueByPlatform?.length || loading) return;
    const ctx = document.getElementById('chart-rev-platform');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: revenueByPlatform.map((d) => d.name),
        datasets: [{ data: revenueByPlatform.map((d) => d.value), backgroundColor: ['#1AB7EA', '#34C759', '#3DD84F', '#8E8E93'] }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
    return () => ch.destroy();
  }, [revenueByPlatform, loading]);

  if (loading) {
    return (
      <div className="page-section active">
        <div className="page-content">
          <p className="sub-loading">Loading revenue data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-section active">
        <div className="page-content">
          <p className="sub-error">{error}</p>
          <button type="button" className="btn btn-outline" onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-section active" id="page-revenue-dashboard">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, background: '#2E9E40', color: 'white', borderRadius: 8, fontSize: 16, fontWeight: 700 }}>R</span>
              Revenue Dashboard
            </h2>
            <p>MRR, ARR, revenue by country, plan, frequency & platform</p>
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

        <div className="kpi-grid-6" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 24 }}>
          <div className="rkpi-card">
            <div className="rkpi-header"><span className="rkpi-label">MRR</span></div>
            <div className="rkpi-value">{fU(mrr)}</div>
            {mrrChange != null && (
              <div className={`kpi-compare ${mrrChange >= 0 ? 'kpi-compare-good' : 'kpi-compare-bad'}`}>
                <span className="kpi-prev">vs {fU(mrrPrev)}</span>
                <span className="kpi-compare-arrow">{mrrChange >= 0 ? '▲' : '▼'}</span>
                <span className="kpi-compare-pct">{Math.abs(mrrChange).toFixed(1)}%</span>
              </div>
            )}
          </div>
          <div className="rkpi-card">
            <div className="rkpi-header"><span className="rkpi-label">ARR</span></div>
            <div className="rkpi-value">{fU(arr)}</div>
          </div>
          <div className="rkpi-card">
            <div className="rkpi-header"><span className="rkpi-label">ARPU</span></div>
            <div className="rkpi-value">{fU(arpu)}</div>
          </div>
          <div className="rkpi-card">
            <div className="rkpi-header"><span className="rkpi-label">Total LTV</span></div>
            <div className="rkpi-value">{fU(totalLtv)}</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h3>Revenue Trend (Last 12 Months)</h3></div>
          <div className="panel-body">
            <div className="chart-container" style={{ height: 300 }}>
              <canvas id="chart-rev-trend" />
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header"><h3>Revenue by Country (Top 15)</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 350 }}>
                <canvas id="chart-rev-country" />
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h3>Revenue by Plan</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-rev-plan" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header"><h3>Revenue by Frequency</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-rev-freq" />
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h3>Revenue by Platform</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-rev-platform" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
