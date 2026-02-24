import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { STATIC } from '../data/staticData';
import { formatCurrency, formatCurrency2, formatNumber, formatDec, formatShort } from '../utils/format';

const KPI_KEYS = ['totalSpend', 'totalConversions', 'blendedCPA', 'websiteRevenue', 'blendedROAS', 'totalImpressions'];

export function DashboardPage() {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const d = STATIC.exec;

  useEffect(() => {
    if (!chartRef.current) return;
    const { labels, revenue, spend } = d.chartRevenueTrend;
    if (chartInstance.current) chartInstance.current.destroy();
    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Revenue',  data: revenue, borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.4, fill: true },
          { label: 'Ad Spend', data: spend,   borderColor: '#ff0000', backgroundColor: 'rgba(255, 0, 0, 0.1)',  tension: 0.4, fill: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          y: {
            beginAtZero: false,
            ticks: { callback: (v) => '$' + Number(v).toLocaleString() },
          },
        },
      },
    });
    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, []);

  const totalSpend = d.spendByPlatform.reduce((s, p) => s + p.spend, 0);
  const effTotal = d.platformEfficiency.reduce((a, p) => ({ spend: a.spend + p.spend, conv: a.conv + p.conv }), { spend: 0, conv: 0 });
  const blendedCpa = effTotal.conv > 0 ? effTotal.spend / effTotal.conv : 0;
  const geoTotal = d.geoDistribution.reduce((a, g) => ({ spend: a.spend + g.spend, conv: a.conv + g.conv }), { spend: 0, conv: 0 });
  const geoCpa = geoTotal.conv > 0 ? geoTotal.spend / geoTotal.conv : 0;

  return (
    <div className="page-section active" id="page-dashboard">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Executive Dashboard</h2>
          <p>Cross-platform performance summary · All channels combined</p>
        </div>

        <div className="insight-banner success" id="exec-insight">
          <span className="icon">💡</span>
          <div><strong>Key Insight:</strong> <span dangerouslySetInnerHTML={{ __html: d.insight }} /></div>
        </div>

        <div className="kpi-grid" id="exec-kpi-grid">
          {KPI_KEYS.map((k) => {
            const kpi = d.kpis[k];
            let val;
            if (kpi.isRoas) val = formatDec(kpi.value, 2) + 'x';
            else if (kpi.isShort) val = formatShort(kpi.value);
            else if (kpi.isCurrency) val = formatCurrency2(kpi.value);
            else val = (k === 'totalSpend' || k === 'websiteRevenue') ? formatCurrency(kpi.value) : formatNumber(kpi.value);
            return (
              <div key={k} className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-label">{kpi.label}</span>
                  <span className="kpi-icon" style={{ background: kpi.iconBg, color: kpi.iconColor }}>{kpi.icon}</span>
                </div>
                <div className="kpi-value">{val}</div>
                <span className={`kpi-change ${kpi.subClass}`}>{kpi.sub}</span>
              </div>
            );
          })}
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>Spend by Platform</h3>
                <div className="panel-subtitle">Budget allocation</div>
              </div>
            </div>
            <div className="panel-body" id="exec-spend-bars">
              {d.spendByPlatform.map((p) => {
                const pct = totalSpend > 0 ? ((p.spend / totalSpend) * 100).toFixed(1) : '0.0';
                return (
                  <div key={p.name} className="spend-bar-container">
                    <div className="spend-bar-label">
                      <div className="label-left">
                        <span className="platform-dot" style={{ background: p.color }} />
                        <span className="platform-name">{p.name}</span>
                      </div>
                      <div>
                        <span className="spend-amount">{formatCurrency(p.spend)}</span>
                        <span className="spend-pct">{pct}%</span>
                      </div>
                    </div>
                    <div className="spend-bar-track">
                      <div className="spend-bar-fill" style={{ width: pct + '%', background: p.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>Platform Efficiency Comparison</h3>
                <div className="panel-subtitle">CPA & ROAS side-by-side</div>
              </div>
            </div>
            <div className="panel-body no-padding">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th className="text-right">Spend</th>
                    <th className="text-right">Conv.</th>
                    <th className="text-right">CPA</th>
                    <th className="text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody id="exec-efficiency-tbody">
                  {d.platformEfficiency.map((p) => (
                    <tr key={p.name}>
                      <td>
                        <span className="platform-badge">
                          <span className="dot" style={{ background: p.dotColor }} />
                          {p.name}
                        </span>
                      </td>
                      <td className="text-right">{formatCurrency(p.spend)}</td>
                      <td className="text-right">{formatNumber(p.conv)}</td>
                      <td className="text-right"><strong>{formatCurrency2(p.cpa)}</strong></td>
                      <td className="text-right"><span className={`badge ${p.roasBadge}`}>{formatDec(p.roas, 2)}x</span></td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td><strong>Total</strong></td>
                    <td className="text-right"><strong>{formatCurrency(effTotal.spend)}</strong></td>
                    <td className="text-right"><strong>{formatNumber(effTotal.conv)}</strong></td>
                    <td className="text-right"><strong>{formatCurrency2(blendedCpa)}</strong></td>
                    <td className="text-right">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Subscription / Conversion Funnel</h3>
              <div className="panel-subtitle">Full journey: Trials → Paid → Revenue → LTV</div>
            </div>
          </div>
          <div className="panel-body">
            <div className="subscription-funnel" id="exec-funnel">
              <div className="sub-funnel-step">
                <div className="step-value" style={{ color: 'var(--primary)' }}>{formatNumber(d.funnel.trials)}</div>
                <div className="step-label">Trials Gained</div>
              </div>
              <div className="sub-funnel-arrow">→</div>
              <div className="sub-funnel-step">
                <div className="step-value" style={{ color: 'var(--accent)' }}>{formatDec(d.funnel.conversionRate, 1)}%</div>
                <div className="step-label">Conversion Rate</div>
              </div>
              <div className="sub-funnel-arrow">→</div>
              <div className="sub-funnel-step">
                <div className="step-value" style={{ color: 'var(--primary)' }}>{formatNumber(d.funnel.paidSubs)}</div>
                <div className="step-label">Est. Paid Subs</div>
              </div>
              <div className="sub-funnel-arrow">→</div>
              <div className="sub-funnel-step">
                <div className="step-value" style={{ color: 'var(--accent)' }}>{formatCurrency(d.funnel.revenue)}</div>
                <div className="step-label">Website Revenue</div>
              </div>
              <div className="sub-funnel-arrow">→</div>
              <div className="sub-funnel-step">
                <div className="step-value" style={{ color: 'var(--purple)' }}>{formatCurrency(d.funnel.projectedLTV)}</div>
                <div className="step-label">Projected LTV</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-header">
              <h3>Revenue & Spend Trend</h3>
              <div className="panel-actions">
                <button type="button" className="btn btn-outline btn-sm">7D</button>
                <button type="button" className="btn btn-outline btn-sm">30D</button>
                <button type="button" className="btn btn-outline btn-sm">90D</button>
              </div>
            </div>
            <div className="panel-body">
              <canvas ref={chartRef} style={{ height: 300 }} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h3>Geographic Spend Distribution</h3></div>
            <div className="panel-body no-padding">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th className="text-right">Spend</th>
                    <th className="text-right">Conv.</th>
                    <th className="text-right">CPA</th>
                    <th className="text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {d.geoDistribution.map((g) => (
                    <tr key={g.region}>
                      <td>{g.region}</td>
                      <td className="text-right">{formatCurrency(g.spend)}</td>
                      <td className="text-right">{formatNumber(g.conv)}</td>
                      <td className="text-right">{formatCurrency2(g.cpa)}</td>
                      <td className="text-right">{formatDec(g.share, 1)}%</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td><strong>Total</strong></td>
                    <td className="text-right"><strong>{formatCurrency(geoTotal.spend)}</strong></td>
                    <td className="text-right"><strong>{formatNumber(geoTotal.conv)}</strong></td>
                    <td className="text-right"><strong>{formatCurrency2(geoCpa)}</strong></td>
                    <td className="text-right"><strong>100%</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Lead Performance by Location</h3>
              <div className="panel-subtitle">Calls + Forms by market (lead-gen clients)</div>
            </div>
          </div>
          <div className="panel-body no-padding">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th className="text-right">Ad Spend</th>
                  <th className="text-right">Clicks</th>
                  <th className="text-right">Calls</th>
                  <th className="text-right">Forms</th>
                  <th className="text-right">Total Leads</th>
                  <th className="text-right">CPC</th>
                  <th className="text-right">CPL</th>
                  <th className="text-right">MoM Δ</th>
                </tr>
              </thead>
              <tbody>
                {d.leadPerformance.map((l) => (
                  <tr key={l.location}>
                    <td>{l.location}</td>
                    <td className="text-right">{formatCurrency(l.spend)}</td>
                    <td className="text-right">{formatNumber(l.clicks)}</td>
                    <td className="text-right">{formatNumber(l.calls)}</td>
                    <td className="text-right">{formatNumber(l.forms)}</td>
                    <td className="text-right"><strong>{formatNumber(l.leads)}</strong></td>
                    <td className="text-right">{formatCurrency2(l.cpc)}</td>
                    <td className="text-right">{formatCurrency2(l.cpl)}</td>
                    <td className="text-right"><span className={`badge ${l.momBadge}`}>{l.mom}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Next Month Budget Allocation</h3>
              <div className="panel-subtitle">Planned spend</div>
            </div>
          </div>
          <div className="panel-body no-padding">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="text-right">Allocation</th>
                  <th className="text-right">Notes</th>
                </tr>
              </thead>
              <tbody>
                {d.budgetAllocation.map((b) => (
                  <tr key={b.channel}>
                    <td>{b.channel}</td>
                    <td className="text-right">{b.allocation}</td>
                    <td className="text-right">{b.notes}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td><strong>Total Cap</strong></td>
                  <td className="text-right"><strong>$12,000</strong></td>
                  <td className="text-right">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
