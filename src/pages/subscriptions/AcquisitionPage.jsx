import { useEffect, useMemo } from 'react';
import { useVimeoSubscriptionsData } from '../../hooks/useVimeoSubscriptionsData';
import { formatCurrency2, formatNumber } from '../../utils/format';
import Chart from 'chart.js/auto';

function num(v) {
  return Number(v) || 0;
}

export function AcquisitionPage() {
  const { loading, error, rawData } = useVimeoSubscriptionsData();

  const acquisitionData = useMemo(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const newThisMonth = rawData.filter((r) => {
      const d = r.date_became_enabled;
      if (!d) return false;
      const dt = new Date(d);
      return dt >= thisMonthStart && dt <= thisMonthEnd;
    });

    const bySource = {};
    const byMedium = {};
    const byCampaign = {};
    const byPlatform = { web: 0, ios: 0, android: 0, other: 0 };

    newThisMonth.forEach((r) => {
      const src = r.utm_source || 'direct';
      bySource[src] = (bySource[src] || 0) + 1;
      const med = r.utm_medium || 'none';
      byMedium[med] = (byMedium[med] || 0) + 1;
      const camp = r.utm_campaign || 'none';
      byCampaign[camp] = (byCampaign[camp] || 0) + 1;
      const plat = (r.platform || '').toLowerCase();
      if (plat === 'web') byPlatform.web++;
      else if (plat === 'ios') byPlatform.ios++;
      else if (plat === 'android') byPlatform.android++;
      else byPlatform.other++;
    });

    const sourceTable = Object.entries(bySource).map(([name, count]) => {
      const subs = rawData.filter((r) => (r.utm_source || 'direct') === name);
      const ltvValues = subs.filter((r) => num(r.lifetime_value) > 0).map((r) => num(r.lifetime_value));
      const avgLtv = ltvValues.length > 0 ? ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length : 0;
      const total = rawData.filter((r) => (r.utm_source || 'direct') === name).length;
      const convRate = total > 0 ? (count / total) * 100 : 0;
      return { name, count, avgLtv, conversionRate: convRate };
    }).sort((a, b) => b.count - a.count);

    const mediumTable = Object.entries(byMedium).map(([name, count]) => {
      const subs = rawData.filter((r) => (r.utm_medium || 'none') === name);
      const ltvValues = subs.filter((r) => num(r.lifetime_value) > 0).map((r) => num(r.lifetime_value));
      const avgLtv = ltvValues.length > 0 ? ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length : 0;
      return { name, count, avgLtv };
    }).sort((a, b) => b.count - a.count);

    const campaignTable = Object.entries(byCampaign).map(([name, count]) => {
      const subs = rawData.filter((r) => (r.utm_campaign || 'none') === name);
      const ltvValues = subs.filter((r) => num(r.lifetime_value) > 0).map((r) => num(r.lifetime_value));
      const avgLtv = ltvValues.length > 0 ? ltvValues.reduce((a, b) => a + b, 0) / ltvValues.length : 0;
      return { name, count, avgLtv };
    }).sort((a, b) => b.count - a.count);

    return {
      bySource: Object.entries(bySource).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      byMedium: Object.entries(byMedium).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      byCampaign: Object.entries(byCampaign).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      byPlatform,
      sourceTable,
      mediumTable,
      campaignTable,
    };
  }, [rawData]);

  useEffect(() => {
    if (!acquisitionData.bySource?.length || loading) return;
    const ctx = document.getElementById('chart-acq-source');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: acquisitionData.bySource.map((d) => d.name),
        datasets: [{ label: 'New Subscribers', data: acquisitionData.bySource.map((d) => d.value), backgroundColor: '#1AB7EA' }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    });
    return () => ch.destroy();
  }, [acquisitionData.bySource, loading]);

  useEffect(() => {
    if (!acquisitionData.byMedium?.length || loading) return;
    const ctx = document.getElementById('chart-acq-medium');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: acquisitionData.byMedium.map((d) => d.name),
        datasets: [{ label: 'New Subscribers', data: acquisitionData.byMedium.map((d) => d.value), backgroundColor: '#2E9E40' }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    });
    return () => ch.destroy();
  }, [acquisitionData.byMedium, loading]);

  useEffect(() => {
    if (!acquisitionData.byCampaign?.length || loading) return;
    const ctx = document.getElementById('chart-acq-campaign');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: acquisitionData.byCampaign.slice(0, 10).map((d) => d.name),
        datasets: [{ label: 'New Subscribers', data: acquisitionData.byCampaign.slice(0, 10).map((d) => d.value), backgroundColor: '#8B3F8E' }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    });
    return () => ch.destroy();
  }, [acquisitionData.byCampaign, loading]);

  useEffect(() => {
    if (loading) return;
    const ctx = document.getElementById('chart-acq-platform');
    if (!ctx) return;
    const ch = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Web', 'iOS', 'Android', 'Other'],
        datasets: [{
          data: [
            acquisitionData.byPlatform?.web || 0,
            acquisitionData.byPlatform?.ios || 0,
            acquisitionData.byPlatform?.android || 0,
            acquisitionData.byPlatform?.other || 0,
          ],
          backgroundColor: ['#1AB7EA', '#34C759', '#3DD84F', '#8E8E93'],
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
    return () => ch.destroy();
  }, [acquisitionData.byPlatform, loading]);

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
    <div className="page-section active" id="page-acquisition">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Acquisition</h2>
          <p>New subscribers by UTM and platform</p>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header"><h3>By UTM Source</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-acq-source" />
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h3>By UTM Medium</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-acq-medium" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header"><h3>By UTM Campaign (Top 10)</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-acq-campaign" />
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h3>Platform Breakdown</h3></div>
            <div className="panel-body">
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="chart-acq-platform" />
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h3>Acquisition Table (Source / Medium / Campaign)</h3></div>
          <div className="panel-body no-padding">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th className="text-right">Subscriber Count</th>
                  <th className="text-right">Avg LTV</th>
                </tr>
              </thead>
              <tbody>
                {acquisitionData.sourceTable?.slice(0, 15).map((r) => (
                  <tr key={'src-' + r.name}>
                    <td>Source</td>
                    <td>{r.name}</td>
                    <td className="text-right">{formatNumber(r.count)}</td>
                    <td className="text-right">{formatCurrency2(r.avgLtv)}</td>
                  </tr>
                ))}
                {acquisitionData.mediumTable?.slice(0, 10).map((r) => (
                  <tr key={'med-' + r.name}>
                    <td>Medium</td>
                    <td>{r.name}</td>
                    <td className="text-right">{formatNumber(r.count)}</td>
                    <td className="text-right">{formatCurrency2(r.avgLtv)}</td>
                  </tr>
                ))}
                {acquisitionData.campaignTable?.slice(0, 10).map((r) => (
                  <tr key={'camp-' + r.name}>
                    <td>Campaign</td>
                    <td>{r.name}</td>
                    <td className="text-right">{formatNumber(r.count)}</td>
                    <td className="text-right">{formatCurrency2(r.avgLtv)}</td>
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
