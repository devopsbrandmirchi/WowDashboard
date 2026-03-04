import { useEffect, useMemo } from 'react';
import { useVimeoSubscriptionsData } from '../../hooks/useVimeoSubscriptionsData';
import { formatCurrency2, formatNumber } from '../../utils/format';
import Chart from 'chart.js/auto';

function num(v) {
  return Number(v) || 0;
}

export function RevenuePage() {
  const { loading, error, rawData } = useVimeoSubscriptionsData();

  const revenueData = useMemo(() => {
    const active = rawData.filter((r) => (r.status || '').toLowerCase() === 'enabled');
    let mrr = 0;
    active.forEach((r) => {
      const price = num(r.subscription_price) || num(r.vimeo_subscription_price_usd) || 0;
      const freq = (r.frequency || '').toLowerCase();
      if (freq === 'yearly') mrr += price / 12;
      else mrr += price;
    });
    const arr = mrr * 12;
    const arpu = active.length > 0 ? mrr / active.length : 0;
    const totalLtv = rawData.reduce((s, r) => s + num(r.lifetime_value), 0);

    const now = new Date();
    const mrrTrend = [];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      let monthMrr = 0;
      rawData.forEach((r) => {
        const enabled = new Date(r.date_became_enabled || 0);
        const canceled = r.date_last_canceled ? new Date(r.date_last_canceled) : null;
        const inMonth = enabled <= mEnd && (!canceled || canceled > m);
        if (!inMonth) return;
        if ((r.status || '').toLowerCase() === 'enabled' || (canceled && canceled > m)) {
          const price = num(r.subscription_price) || num(r.vimeo_subscription_price_usd) || 0;
          const freq = (r.frequency || '').toLowerCase();
          monthMrr += freq === 'yearly' ? price / 12 : price;
        }
      });
      mrrTrend.push({ month: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, mrr: monthMrr });
    }

    const byCountry = {};
    active.forEach((r) => {
      const c = r.country || 'Unknown';
      if (!byCountry[c]) byCountry[c] = 0;
      const price = num(r.subscription_price) || num(r.vimeo_subscription_price_usd) || 0;
      const freq = (r.frequency || '').toLowerCase();
      byCountry[c] += freq === 'yearly' ? price / 12 : price;
    });
    const revenueByCountry = Object.entries(byCountry)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, value]) => ({ name, value }));

    const byFreq = { monthly: 0, yearly: 0 };
    active.forEach((r) => {
      const price = num(r.subscription_price) || num(r.vimeo_subscription_price_usd) || 0;
      const freq = (r.frequency || '').toLowerCase();
      if (freq === 'yearly') byFreq.yearly += price / 12;
      else byFreq.monthly += price;
    });

    const byPlan = {};
    active.forEach((r) => {
      const p = r.current_plan || 'Unknown';
      if (!byPlan[p]) byPlan[p] = 0;
      const price = num(r.subscription_price) || num(r.vimeo_subscription_price_usd) || 0;
      const freq = (r.frequency || '').toLowerCase();
      byPlan[p] += freq === 'yearly' ? price / 12 : price;
    });
    const revenueByPlan = Object.entries(byPlan).map(([name, value]) => ({ name, value }));

    return {
      mrr,
      arr,
      arpu,
      totalLtv,
      mrrTrend,
      revenueByCountry,
      byFreq,
      revenueByPlan,
    };
  }, [rawData]);

  useEffect(() => {
    if (!revenueData.mrrTrend?.length || loading) return;
    const ctx = document.getElementById('chart-rev-trend');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'line',
      data: {
        labels: revenueData.mrrTrend.map((d) => d.month),
        datasets: [{
          label: 'MRR',
          data: revenueData.mrrTrend.map((d) => d.mrr),
          borderColor: '#2E9E40',
          backgroundColor: 'rgba(46, 158, 64, 0.1)',
          tension: 0.4,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } },
        },
      },
    });
    return () => ch.destroy();
  }, [revenueData.mrrTrend, loading]);

  useEffect(() => {
    if (!revenueData.revenueByCountry?.length || loading) return;
    const ctx = document.getElementById('chart-rev-country');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: revenueData.revenueByCountry.map((d) => d.name),
        datasets: [{ label: 'MRR', data: revenueData.revenueByCountry.map((d) => d.value), backgroundColor: '#1AB7EA' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } },
        },
      },
    });
    return () => ch.destroy();
  }, [revenueData.revenueByCountry, loading]);

  useEffect(() => {
    if (!revenueData.byFreq || loading) return;
    const ctx = document.getElementById('chart-rev-freq');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Monthly', 'Yearly (MRR)'],
        datasets: [{
          data: [revenueData.byFreq.monthly, revenueData.byFreq.yearly],
          backgroundColor: ['#1AB7EA', '#8B3F8E'],
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
    return () => ch.destroy();
  }, [revenueData.byFreq, loading]);

  useEffect(() => {
    if (!revenueData.revenueByPlan?.length || loading) return;
    const ctx = document.getElementById('chart-rev-plan');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: revenueData.revenueByPlan.map((d) => d.name),
        datasets: [{
          data: revenueData.revenueByPlan.map((d) => d.value),
          backgroundColor: ['#1AB7EA', '#2E9E40', '#8B3F8E', '#F5A623', '#ED1C24'],
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
    return () => ch.destroy();
  }, [revenueData.revenueByPlan, loading]);

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
    <div className="page-section active" id="page-revenue">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Revenue</h2>
          <p>MRR, ARR, and revenue breakdowns</p>
        </div>

        <div className="sub-kpi-grid sub-kpi-grid-4">
          <div className="sub-kpi-card sub-kpi-green">
            <div className="sub-kpi-label">MRR</div>
            <div className="sub-kpi-value">{formatCurrency2(revenueData.mrr)}</div>
          </div>
          <div className="sub-kpi-card sub-kpi-green">
            <div className="sub-kpi-label">ARR</div>
            <div className="sub-kpi-value">{formatCurrency2(revenueData.arr)}</div>
          </div>
          <div className="sub-kpi-card sub-kpi-blue">
            <div className="sub-kpi-label">Avg Revenue Per User</div>
            <div className="sub-kpi-value">{formatCurrency2(revenueData.arpu)}</div>
          </div>
          <div className="sub-kpi-card sub-kpi-blue">
            <div className="sub-kpi-label">Total Lifetime Value</div>
            <div className="sub-kpi-value">{formatCurrency2(revenueData.totalLtv)}</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h3>MRR Trend (Last 12 Months)</h3></div>
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
            <div className="panel-header"><h3>Revenue by Frequency</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-rev-freq" />
              </div>
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
    </div>
  );
}
