import { useState } from 'react';
import { STATIC } from '../data/staticData';
import { formatCurrency, formatCurrency2, formatNumber, formatDec } from '../utils/format';

const TABS = [
  { id: 'campaigntypes', label: 'Campaign Types' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adgroups', label: 'Ad Groups' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'searchterms', label: 'Search Terms' },
  { id: 'geo', label: 'Geo' },
  { id: 'conversions', label: 'Conversions' },
];

export function GoogleAdsPage() {
  const [activeTab, setActiveTab] = useState('campaigntypes');
  const [compareOn, setCompareOn] = useState(false);
  const [customDatesVisible, setCustomDatesVisible] = useState(false);

  const d = STATIC.googleAds;
  const k = d.kpis;

  const totalCost = d.campaignTypes.reduce((s, c) => s + c.cost, 0);
  const totalConv = d.campaignTypes.reduce((s, c) => s + c.conversions, 0);
  const totalVal = d.campaignTypes.reduce((s, c) => s + c.conversions_value, 0);
  const totalCpa = totalConv > 0 ? totalCost / totalConv : 0;
  const totalRoas = totalCost > 0 ? totalVal / totalCost : 0;

  return (
    <div className="page-section active" id="page-google-ads">
      <div className="page-content">
        <div className="gads-filter-bar" id="gads-filter-bar">
          <div className="gads-filter-row">
            <div className="gads-filter-group gads-fg-sm">
              <label>Customer</label>
              <select id="gads-customer-select">
                <option value="ALL">All Customers</option>
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Date Range</label>
              <div className="gads-date-wrap">
                <select
                  id="gads-date-preset"
                  onChange={(e) => setCustomDatesVisible(e.target.value === 'custom')}
                >
                  <option value="all" defaultValue>All Data</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 Days</option>
                  <option value="last14">Last 14 Days</option>
                  <option value="last30">Last 30 Days</option>
                  <option value="this_month">This Month</option>
                  <option value="last_month">Last Month</option>
                  <option value="custom">Custom</option>
                </select>
                {customDatesVisible && (
                  <div className="gads-custom-dates">
                    <input type="date" id="gads-date-from" />
                    <span>–</span>
                    <input type="date" id="gads-date-to" />
                  </div>
                )}
              </div>
            </div>
            <div className="gads-filter-group gads-fg-compare">
              <label className="gads-compare-toggle-label">
                <span className="gads-toggle-switch">
                  <input
                    type="checkbox"
                    id="gads-compare-toggle"
                    checked={compareOn}
                    onChange={(e) => setCompareOn(e.target.checked)}
                  />
                  <span className="gads-toggle-slider" />
                </span>
                Compare
              </label>
              {compareOn && (
                <div className="gads-compare-inline">
                  <input type="date" id="gads-comp-date-from" className="gads-comp-date-input" title="Compare from" />
                  <span>–</span>
                  <input type="date" id="gads-comp-date-to" className="gads-comp-date-input" title="Compare to" />
                </div>
              )}
            </div>
            <div className="gads-filter-group gads-filter-actions">
              <button type="button" className="btn btn-primary btn-sm" id="gads-apply-btn">Apply</button>
            </div>
            <div className="gads-filter-group gads-filter-badge">
              <span id="gads-status-badge" style={{ color: '#10b981', fontWeight: 600, fontSize: 11 }}>Live</span>
            </div>
          </div>
          <div className="gads-filter-row">
            <div className="gads-filter-group gads-fg-sm">
              <label>Type</label>
              <select id="gads-ctype-select">
                <option value="all">All Types</option>
                <option value="SEARCH">Search</option>
                <option value="PERFORMANCE_MAX">Perf. Max</option>
                <option value="DISPLAY">Display</option>
                <option value="VIDEO">Video</option>
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Status</label>
              <select id="gads-status-filter">
                <option value="all">All</option>
                <option value="ENABLED">Enabled</option>
                <option value="PAUSED">Paused</option>
              </select>
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Campaign</label>
              <input type="text" id="gads-campaign-search" placeholder="Contains..." className="gads-search-input" />
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Ad Group</label>
              <input type="text" id="gads-adgroup-search" placeholder="Contains..." className="gads-search-input" />
            </div>
            <div className="gads-filter-group gads-fg-sm">
              <label>Keyword</label>
              <input type="text" id="gads-keyword-search" placeholder="Contains..." className="gads-search-input" />
            </div>
          </div>
        </div>

        <div className="gads-kpi-section">
          <div className="kpi-grid" id="gads-kpi-grid">
            <div className="kpi-card">
              <div className="kpi-header"><span className="kpi-label">Spend</span><span className="kpi-icon" style={{ background: 'var(--primary-bg)', color: 'var(--primary)' }}>$</span></div>
              <div className="kpi-value">{formatCurrency(k.spend)}</div>
              <span className="kpi-change neutral">{k.campaigns} campaigns</span>
            </div>
            <div className="kpi-card">
              <div className="kpi-header"><span className="kpi-label">Clicks</span><span className="kpi-icon" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>👆</span></div>
              <div className="kpi-value">{formatNumber(k.clicks)}</div>
              <span className="kpi-change neutral">CTR {formatDec(k.ctr, 2)}%</span>
            </div>
            <div className="kpi-card">
              <div className="kpi-header"><span className="kpi-label">Conversions</span><span className="kpi-icon" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>✓</span></div>
              <div className="kpi-value">{formatNumber(k.conversions)}</div>
              <span className="kpi-change neutral">Static data</span>
            </div>
            <div className="kpi-card">
              <div className="kpi-header"><span className="kpi-label">CPA</span><span className="kpi-icon" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>💰</span></div>
              <div className="kpi-value">{formatCurrency2(k.cpa)}</div>
              <span className="kpi-change neutral">Avg CPC {formatCurrency2(k.avgCpc)}</span>
            </div>
            <div className="kpi-card">
              <div className="kpi-header"><span className="kpi-label">ROAS</span><span className="kpi-icon" style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}>📈</span></div>
              <div className="kpi-value">{formatDec(k.roas, 2)}x</div>
              <span className="kpi-change neutral">{k.roas >= 1 ? 'Profitable' : 'Below 1x'}</span>
            </div>
            <div className="kpi-card">
              <div className="kpi-header"><span className="kpi-label">Revenue</span><span className="kpi-icon" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>💰</span></div>
              <div className="kpi-value">{formatCurrency(k.revenue)}</div>
              <span className="kpi-change neutral">Conv. value total</span>
            </div>
          </div>
        </div>

        <div className="gads-chart-section">
          <div className="gads-chart-toolbar">
            <span className="gads-chart-title">Daily Trends</span>
          </div>
          <div className="gads-chart-metrics">
            <div className="gads-metric-card active">
              <span className="gads-metric-dot" style={{ background: 'var(--primary)' }} />
              <div className="gads-metric-info">
                <span className="gads-metric-name">Spend</span>
                <span className="gads-metric-val">{formatCurrency(k.spend)}</span>
              </div>
            </div>
            <div className="gads-metric-card">
              <span className="gads-metric-dot" style={{ background: 'var(--accent)' }} />
              <div className="gads-metric-info">
                <span className="gads-metric-name">Revenue</span>
                <span className="gads-metric-val">{formatCurrency(k.revenue)}</span>
              </div>
            </div>
          </div>
          <div className="gads-chart-wrap">
            <div className="chart-area h-200">Chart: Connect API for trend data</div>
          </div>
        </div>

        <div className="gads-tabs-container">
          <div className="gads-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`gads-tab ${activeTab === tab.id ? 'active' : ''}`}
                data-tab={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            <div className="gads-tabs-spacer" />
            <button type="button" className="gads-col-btn" title="Download CSV">↓ CSV</button>
            <button type="button" className="gads-col-btn" title="Edit Columns">⚙ Columns</button>
          </div>
        </div>

        <div id="gads-tab-content">
          {activeTab === 'campaigntypes' && (
            <div className="table-wrapper">
              <table className="data-table gads-table">
                <thead>
                  <tr>
                    <th>Campaign Type</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">% Spend</th>
                    <th className="text-right">Conv.</th>
                    <th className="text-right">CPA</th>
                    <th className="text-right">ROAS</th>
                    <th className="text-right">Conv. Value</th>
                  </tr>
                </thead>
                <tbody>
                  {d.campaignTypes.map((c) => {
                    const pct = totalCost > 0 ? ((c.cost / totalCost) * 100).toFixed(1) : '0';
                    const cpa = c.conversions > 0 ? c.cost / c.conversions : 0;
                    const roas = c.cost > 0 ? c.conversions_value / c.cost : 0;
                    const roasClass = roas >= 2 ? 'badge-green' : roas >= 1 ? 'badge-yellow' : 'badge-red';
                    return (
                      <tr key={c.type}>
                        <td><span className="badge badge-blue">{c.type}</span></td>
                        <td className="text-right">{formatCurrency(c.cost)}</td>
                        <td className="text-right">{pct}%</td>
                        <td className="text-right">{formatNumber(c.conversions)}</td>
                        <td className="text-right">{formatCurrency2(cpa)}</td>
                        <td className="text-right"><span className={`badge ${roasClass}`}>{formatDec(roas, 2)}x</span></td>
                        <td className="text-right">{formatCurrency(c.conversions_value)}</td>
                      </tr>
                    );
                  })}
                  <tr className="total-row gads-type-total-row">
                    <td><strong>Total</strong></td>
                    <td className="text-right"><strong>{formatCurrency(totalCost)}</strong></td>
                    <td className="text-right">100%</td>
                    <td className="text-right"><strong>{formatNumber(totalConv)}</strong></td>
                    <td className="text-right"><strong>{formatCurrency2(totalCpa)}</strong></td>
                    <td className="text-right"><strong>{formatDec(totalRoas, 2)}x</strong></td>
                    <td className="text-right"><strong>{formatCurrency(totalVal)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'keywords' && (
            <div className="table-wrapper">
              <table className="data-table gads-table">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th className="text-right">Clicks</th>
                    <th className="text-right">Conv.</th>
                    <th className="text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {d.keywords.map((kw) => (
                    <tr key={kw.keyword}>
                      <td>{kw.keyword}</td>
                      <td className="text-right">{formatNumber(kw.clicks)}</td>
                      <td className="text-right">{formatNumber(kw.conv)}</td>
                      <td className="text-right">{formatCurrency(kw.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'geo' && (
            <div className="table-wrapper">
              <table className="data-table gads-table">
                <thead>
                  <tr>
                    <th>Country</th>
                    <th className="text-right">Spend</th>
                    <th className="text-right">Conv.</th>
                    <th className="text-right">CPA</th>
                    <th className="text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {d.geography.map((g) => {
                    const roasClass = g.roas >= 2 ? 'badge-green' : g.roas >= 1 ? 'badge-yellow' : 'badge-red';
                    return (
                      <tr key={g.country}>
                        <td>{g.country}</td>
                        <td className="text-right">{formatCurrency(g.spend)}</td>
                        <td className="text-right">{formatNumber(g.conv)}</td>
                        <td className="text-right">{formatCurrency2(g.cpa)}</td>
                        <td className="text-right"><span className={`badge ${roasClass}`}>{formatDec(g.roas, 2)}x</span></td>
                      </tr>
                    );
                  })}
                  {(() => {
                    const totSpend = d.geography.reduce((s, g) => s + g.spend, 0);
                    const totConv = d.geography.reduce((s, g) => s + g.conv, 0);
                    const totCpa = totConv > 0 ? totSpend / totConv : 0;
                    const totRoas = totSpend > 0 ? d.geography.reduce((s, g) => s + g.roas * g.spend, 0) / totSpend : 0;
                    return (
                      <tr className="total-row gads-type-total-row">
                        <td><strong>Total</strong></td>
                        <td className="text-right"><strong>{formatCurrency(totSpend)}</strong></td>
                        <td className="text-right"><strong>{formatNumber(totConv)}</strong></td>
                        <td className="text-right"><strong>{formatCurrency2(totCpa)}</strong></td>
                        <td className="text-right"><strong>{formatDec(totRoas, 2)}x</strong></td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}
          {['campaigns', 'adgroups', 'searchterms', 'conversions'].includes(activeTab) && (
            <div className="gads-empty">Select filters and apply to load {activeTab} data. Add endpoints in src/api for live data.</div>
          )}
        </div>
      </div>
    </div>
  );
}
