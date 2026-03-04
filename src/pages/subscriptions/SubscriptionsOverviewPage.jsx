import { useEffect, useRef } from 'react';
import { useVimeoSubscriptionsData } from '../../hooks/useVimeoSubscriptionsData';
import { formatCurrency2, formatNumber, formatDec } from '../../utils/format';
import Chart from 'chart.js/auto';

const KPI_CONFIG = [
  {
    key: 'totalActiveSubscribers',
    label: 'Total Active Subscribers',
    metric: 'total_active_subscribers',
    color: 'green',
    format: (v) => formatNumber(v),
  },
  {
    key: 'newSubscribersThisMonth',
    label: 'New Subscribers This Month',
    metric: 'new_subscribers_this_month',
    color: 'green',
    format: (v) => formatNumber(v),
  },
  {
    key: 'newSubscribersLastMonth',
    label: 'New Subscribers Last Month',
    metric: 'new_subscribers_last_month',
    color: 'blue',
    format: (v) => formatNumber(v),
  },
  {
    key: 'momGrowth',
    label: 'Month-over-Month Growth %',
    metric: 'month_over_month_growth',
    color: 'blue',
    format: (v) => formatDec(v, 1) + '%',
  },
  {
    key: 'activeTrials',
    label: 'Active Trials',
    metric: 'active_trials',
    color: 'blue',
    format: (v) => formatNumber(v),
  },
  {
    key: 'trialConversionsThisMonth',
    label: 'Trial Conversions This Month',
    metric: 'trial_conversions_this_month',
    color: 'green',
    format: (v) => formatNumber(v),
  },
  {
    key: 'cancellationsThisMonth',
    label: 'Cancellations This Month',
    metric: 'cancellations_this_month',
    color: 'red',
    format: (v) => formatNumber(v),
  },
  {
    key: 'churnRate',
    label: 'Churn Rate',
    metric: 'churn_rate',
    color: 'red',
    format: (v) => formatDec(v, 2) + '%',
  },
  {
    key: 'mrr',
    label: 'MRR',
    metric: 'mrr',
    color: 'blue',
    format: (v) => formatCurrency2(v),
  },
  {
    key: 'avgLifetimeValue',
    label: 'Average Lifetime Value',
    metric: 'avg_lifetime_value',
    color: 'green',
    format: (v) => formatCurrency2(v),
  },
];

function openListInNewTab(metric) {
  const base = window.location.origin + (window.location.pathname || '/');
  const path = base.endsWith('/') ? base.slice(0, -1) : base;
  const url = `${path}/subscriptions/list?metric=${encodeURIComponent(metric)}`;
  window.open(url, '_blank');
}

export function SubscriptionsOverviewPage() {
  const { loading, error, kpis, chartData, refetch } = useVimeoSubscriptionsData();
  const chartRefs = useRef({});
  const chartInstances = useRef({});

  useEffect(() => {
    if (!chartData.subscriptionsByPlan?.length) return;
    const ctx = document.getElementById('chart-plan');
    if (!ctx) return;
    if (chartInstances.current.plan) chartInstances.current.plan.destroy();
    chartInstances.current.plan = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: chartData.subscriptionsByPlan.map((d) => d.name),
        datasets: [
          {
            data: chartData.subscriptionsByPlan.map((d) => d.value),
            backgroundColor: ['#1AB7EA', '#2E9E40', '#8B3F8E', '#F5A623', '#ED1C24', '#4A4E78'],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } },
      },
    });
    return () => {
      if (chartInstances.current.plan) chartInstances.current.plan.destroy();
    };
  }, [chartData.subscriptionsByPlan]);

  useEffect(() => {
    if (!chartData.subscribersByCountry?.length) return;
    const ctx = document.getElementById('chart-country');
    if (!ctx) return;
    if (chartInstances.current.country) chartInstances.current.country.destroy();
    chartInstances.current.country = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartData.subscribersByCountry.map((d) => d.name),
        datasets: [
          {
            label: 'Subscribers',
            data: chartData.subscribersByCountry.map((d) => d.value),
            backgroundColor: 'rgba(26, 183, 234, 0.7)',
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true },
        },
      },
    });
    return () => {
      if (chartInstances.current.country) chartInstances.current.country.destroy();
    };
  }, [chartData.subscribersByCountry]);

  useEffect(() => {
    if (!chartData.healthDistribution?.length) return;
    const ctx = document.getElementById('chart-health');
    if (!ctx) return;
    if (chartInstances.current.health) chartInstances.current.health.destroy();
    chartInstances.current.health = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: chartData.healthDistribution.map((d) => d.name),
        datasets: [
          {
            data: chartData.healthDistribution.map((d) => d.value),
            backgroundColor: ['#2E9E40', '#F5A623', '#ED1C24'],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } },
      },
    });
    return () => {
      if (chartInstances.current.health) chartInstances.current.health.destroy();
    };
  }, [chartData.healthDistribution]);

  useEffect(() => {
    if (!chartData.newSubsThisVsLast?.length) return;
    const ctx = document.getElementById('chart-new-vs-last');
    if (!ctx) return;
    if (chartInstances.current.newVsLast) chartInstances.current.newVsLast.destroy();
    chartInstances.current.newVsLast = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartData.newSubsThisVsLast.map((d) => d.week),
        datasets: [
          { label: 'This Month', data: chartData.newSubsThisVsLast.map((d) => d.thisMonth), backgroundColor: '#1AB7EA' },
          { label: 'Last Month', data: chartData.newSubsThisVsLast.map((d) => d.lastMonth), backgroundColor: '#4A4E78' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true } },
      },
    });
    return () => {
      if (chartInstances.current.newVsLast) chartInstances.current.newVsLast.destroy();
    };
  }, [chartData.newSubsThisVsLast]);

  useEffect(() => {
    if (!chartData.monthlyTrend?.length) return;
    const ctx = document.getElementById('chart-trend');
    if (!ctx) return;
    if (chartInstances.current.trend) chartInstances.current.trend.destroy();
    chartInstances.current.trend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.monthlyTrend.map((d) => d.month),
        datasets: [
          {
            label: 'New Subscriptions',
            data: chartData.monthlyTrend.map((d) => d.count),
            borderColor: '#1AB7EA',
            backgroundColor: 'rgba(26, 183, 234, 0.1)',
            tension: 0.4,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true } },
      },
    });
    return () => {
      if (chartInstances.current.trend) chartInstances.current.trend.destroy();
    };
  }, [chartData.monthlyTrend]);

  if (loading) {
    return (
      <div className="page-section active">
        <div className="page-content">
          <p className="sub-loading">Loading subscriptions data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-section active">
        <div className="page-content">
          <p className="sub-error">{error}</p>
          <button type="button" className="btn btn-outline" onClick={refetch}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const lastMonthVal = (key) => {
    const prev = {
      newSubscribersThisMonth: kpis.newSubscribersLastMonth,
      newSubscribersLastMonth: kpis.newSubscribersThisMonth,
      momGrowth: 0,
    };
    return prev[key];
  };

  return (
    <div className="page-section active" id="page-subscriptions-overview">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Subscriptions & Trials Overview</h2>
          <p>Vimeo subscription analytics dashboard</p>
        </div>

        <div className="sub-kpi-grid">
          {KPI_CONFIG.map((cfg) => {
            const val = kpis[cfg.key] ?? 0;
            const prev = lastMonthVal(cfg.key);
            const change = prev != null && prev > 0 ? ((val - prev) / prev) * 100 : null;
            return (
              <div
                key={cfg.key}
                className={`sub-kpi-card sub-kpi-${cfg.color}`}
                onClick={() => openListInNewTab(cfg.metric)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && openListInNewTab(cfg.metric)}
              >
                <div className="sub-kpi-label">{cfg.label}</div>
                <div className="sub-kpi-value">{cfg.format(val)}</div>
                {change != null && cfg.key !== 'momGrowth' && (
                  <span className={`sub-kpi-change ${change >= 0 ? 'positive' : 'negative'}`}>
                    {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}% vs last month
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header">
              <h3>New Subscriptions: This Month vs Last Month</h3>
            </div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-new-vs-last" />
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <h3>Subscriptions by Plan</h3>
            </div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-plan" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header">
              <h3>Subscribers by Country (Top 15)</h3>
            </div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 350 }}>
                <canvas id="chart-country" />
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <h3>Health Score Distribution</h3>
            </div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-health" />
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Subscription Trend (Last 12 Months)</h3>
          </div>
          <div className="panel-body">
            <div className="chart-container" style={{ height: 300 }}>
              <canvas id="chart-trend" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
