import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { supabase } from '../../lib/supabase.js';
import { formatNumber, formatDec } from '../../utils/format.js';
import { DateRangePicker } from '../../components/DatePicker';

const TABLE_NAME = import.meta.env.VITE_SUPABASE_HUBSPOT_EMAIL_TABLE || 'hubspot_marketing_emails';
const STATUS_ALL = 'all';
const PAGE_SIZE = 20;

async function fetchAllRows(buildQuery) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v, d = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${formatDec(n, d)}%`;
}

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return '—';
  }
}

function perfBadge(v) {
  if (!Number.isFinite(v)) return { label: '—', cls: '' };
  if (v >= 50) return { label: 'Strong', cls: 'bg' };
  if (v >= 30) return { label: 'Average', cls: 'ba' };
  return { label: 'Low', cls: 'br' };
}

function average(list, key) {
  const vals = list.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function toBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  if (['true', 't', 'yes', 'y', '1', 'automated', 'auto', 'workflow'].includes(s)) return true;
  if (['false', 'f', 'no', 'n', '0', 'regular', 'manual', 'broadcast'].includes(s)) return false;
  return null;
}

function normalizeRow(row) {
  const campaignName = row.campaign_name || row.campaign || row.workflow_name || 'Unknown campaign';
  const autoCandidateFields = [
    row.is_automated,
    row.automated,
    row.is_workflow,
    row.workflow_enabled,
    row.automation_enabled,
    row.email_is_automated,
  ];
  let isAutomated = null;
  for (const v of autoCandidateFields) {
    const b = toBooleanLike(v);
    if (b !== null) {
      isAutomated = b;
      break;
    }
  }

  const typeRaw = String(
    row.campaign_type ||
    row.email_type ||
    row.type ||
    row.category ||
    row.campaign_category ||
    row.email_category ||
    row.message_type ||
    '',
  ).toLowerCase();
  if (isAutomated === null) {
    isAutomated = (
      typeRaw.includes('automated') ||
      typeRaw.includes('workflow') ||
      typeRaw.includes('drip') ||
      typeRaw.includes('sequence')
    );
  }
  const status = row.status || row.campaign_status || 'ACTIVE';
  const publishSendAt = row.publish_send_at || row.sent_at || row.send_at || null;

  return {
    email_id: row.email_id || row.id || `${campaignName}-${row.email_name || row.subject || Math.random()}`,
    campaign_id: row.campaign_id || null,
    campaign_name: campaignName,
    is_automated: isAutomated,
    status,
    email_name: row.email_name || row.subject_line || row.subject || '—',
    publish_send_at: publishSendAt,
    delivered: toNum(row.delivered),
    sent: toNum(row.sent),
    opens: toNum(row.opens),
    clicks: toNum(row.clicks),
    bounces: toNum(row.bounces),
    unsubscribes: toNum(row.unsubscribes ?? row.unsubscribe_count),
    open_rate_pct: Number.isFinite(Number(row.open_rate_pct)) ? Number(row.open_rate_pct) : null,
    click_rate_pct: Number.isFinite(Number(row.click_rate_pct)) ? Number(row.click_rate_pct) : null,
  };
}

export function HubspotEmailMarketingPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('regular');
  const [filters, setFilters] = useState({
    datePreset: 'last30',
    dateFrom: '',
    dateTo: '',
    compareOn: false,
    compareFrom: '',
    compareTo: '',
  });
  const [status, setStatus] = useState(STATUS_ALL);
  const [pageRegular, setPageRegular] = useState(1);
  const [pageAutomated, setPageAutomated] = useState(1);
  const chartRefs = useRef({
    regDel: null,
    regRates: null,
    autoDel: null,
    autoRates: null,
    compare: null,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllRows(() => supabase.from(TABLE_NAME).select('*'));
      setRows((data || []).map(normalizeRow));
    } catch (e) {
      setError(e?.message || 'Failed to load data from Supabase.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const d = r.publish_send_at ? String(r.publish_send_at).slice(0, 10) : null;
      if (filters.dateFrom && d && d < filters.dateFrom) return false;
      if (filters.dateTo && d && d > filters.dateTo) return false;
      if (status !== STATUS_ALL && String(r.status).toUpperCase() !== status) return false;
      return true;
    });
  }, [rows, filters.dateFrom, filters.dateTo, status]);

  const handleDatePickerApply = useCallback((next) => {
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);

  const regularRows = useMemo(() => filtered.filter((r) => !r.is_automated), [filtered]);
  const automatedRows = useMemo(() => filtered.filter((r) => r.is_automated), [filtered]);

  useEffect(() => {
    setPageRegular(1);
    setPageAutomated(1);
  }, [filters.dateFrom, filters.dateTo, status]);

  const statusOptions = useMemo(() => {
    const all = new Set(rows.map((r) => String(r.status || '').toUpperCase()).filter(Boolean));
    return [STATUS_ALL, ...Array.from(all).sort()];
  }, [rows]);

  const metricData = useCallback((data) => {
    const totalDelivered = data.reduce((s, r) => s + toNum(r.delivered), 0);
    const totalOpens = data.reduce((s, r) => s + toNum(r.opens), 0);
    const totalClicks = data.reduce((s, r) => s + toNum(r.clicks), 0);
    return {
      emails: data.length,
      delivered: totalDelivered,
      avgOpen: average(data, 'open_rate_pct'),
      avgClick: average(data, 'click_rate_pct'),
      opens: totalOpens,
      clicks: totalClicks,
    };
  }, []);

  const compareByCampaign = useMemo(() => {
    const avgByCampaign = (data) => {
      const map = new Map();
      data.forEach((r) => {
        const key = r.campaign_name || 'Unknown';
        if (!map.has(key)) map.set(key, []);
        if (Number.isFinite(Number(r.open_rate_pct))) map.get(key).push(Number(r.open_rate_pct));
      });
      return Array.from(map.entries()).map(([name, vals]) => ({
        name: name.slice(0, 22),
        avg: vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : 0,
      }));
    };
    return { reg: avgByCampaign(regularRows), auto: avgByCampaign(automatedRows) };
  }, [regularRows, automatedRows]);

  const sortedBySendDate = useCallback(
    (data) => [...data].sort((a, b) => String(b.publish_send_at || '').localeCompare(String(a.publish_send_at || ''))),
    [],
  );

  useEffect(() => {
    const destroy = (k) => {
      if (chartRefs.current[k]) {
        chartRefs.current[k].destroy();
        chartRefs.current[k] = null;
      }
    };
    const labels = (data) => data.map((r) => String(r.email_name || '').slice(0, 20));

    if (tab === 'regular') {
      destroy('autoDel'); destroy('autoRates'); destroy('compare');
      const delCanvas = document.getElementById('hs-reg-del');
      const ratesCanvas = document.getElementById('hs-reg-rates');
      if (delCanvas) {
        destroy('regDel');
        chartRefs.current.regDel = new Chart(delCanvas, {
          type: 'bar',
          data: {
            labels: labels(regularRows),
            datasets: [{ label: 'Delivered', data: regularRows.map((r) => toNum(r.delivered)), backgroundColor: '#378ADD', borderRadius: 3 }],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
        });
      }
      if (ratesCanvas) {
        destroy('regRates');
        chartRefs.current.regRates = new Chart(ratesCanvas, {
          type: 'line',
          data: {
            labels: labels(regularRows),
            datasets: [
              { label: 'Open %', data: regularRows.map((r) => r.open_rate_pct), borderColor: '#1D9E75', tension: 0.3 },
              { label: 'Click %', data: regularRows.map((r) => r.click_rate_pct), borderColor: '#BA7517', tension: 0.3, borderDash: [4, 3] },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
        });
      }
    } else if (tab === 'automated') {
      destroy('regDel'); destroy('regRates'); destroy('compare');
      const delCanvas = document.getElementById('hs-auto-del');
      const ratesCanvas = document.getElementById('hs-auto-rates');
      if (delCanvas) {
        destroy('autoDel');
        chartRefs.current.autoDel = new Chart(delCanvas, {
          type: 'bar',
          data: {
            labels: labels(automatedRows),
            datasets: [{ label: 'Delivered', data: automatedRows.map((r) => toNum(r.delivered)), backgroundColor: '#7F77DD', borderRadius: 3 }],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
        });
      }
      if (ratesCanvas) {
        destroy('autoRates');
        chartRefs.current.autoRates = new Chart(ratesCanvas, {
          type: 'line',
          data: {
            labels: labels(automatedRows),
            datasets: [
              { label: 'Open %', data: automatedRows.map((r) => r.open_rate_pct), borderColor: '#1D9E75', tension: 0.3 },
              { label: 'Click %', data: automatedRows.map((r) => r.click_rate_pct), borderColor: '#BA7517', tension: 0.3, borderDash: [4, 3] },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
        });
      }
    } else {
      destroy('regDel'); destroy('regRates'); destroy('autoDel'); destroy('autoRates');
      const cmpCanvas = document.getElementById('hs-compare-open');
      if (cmpCanvas) {
        destroy('compare');
        const allNames = Array.from(new Set([...compareByCampaign.reg.map((x) => x.name), ...compareByCampaign.auto.map((x) => x.name)]));
        const regMap = Object.fromEntries(compareByCampaign.reg.map((x) => [x.name, x.avg]));
        const autoMap = Object.fromEntries(compareByCampaign.auto.map((x) => [x.name, x.avg]));
        chartRefs.current.compare = new Chart(cmpCanvas, {
          type: 'bar',
          data: {
            labels: allNames,
            datasets: [
              { label: 'Regular', data: allNames.map((n) => regMap[n] ?? null), backgroundColor: '#378ADD', borderRadius: 3 },
              { label: 'Automated', data: allNames.map((n) => autoMap[n] ?? null), backgroundColor: '#7F77DD', borderRadius: 3 },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
        });
      }
    }

    return () => {
      ['regDel', 'regRates', 'autoDel', 'autoRates', 'compare'].forEach((k) => destroy(k));
    };
  }, [tab, regularRows, automatedRows, compareByCampaign]);

  useEffect(() => {
    const regPages = Math.max(1, Math.ceil(regularRows.length / PAGE_SIZE));
    const autoPages = Math.max(1, Math.ceil(automatedRows.length / PAGE_SIZE));
    if (pageRegular > regPages) setPageRegular(regPages);
    if (pageAutomated > autoPages) setPageAutomated(autoPages);
  }, [regularRows.length, automatedRows.length, pageRegular, pageAutomated]);

  if (loading) {
    return (
      <div className="page-section active page-hs-email-marketing" id="page-hs-email-marketing">
        <div className="page-content">
          <p className="sub-loading">Loading…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-section active page-hs-email-marketing" id="page-hs-email-marketing">
        <div className="page-content">
          <div className="page-title-bar">
            <h2>HubSpot email marketing</h2>
          </div>
          <p className="sub-error">{error}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={loadData}>Retry</button>
        </div>
      </div>
    );
  }

  const regMetrics = metricData(regularRows);
  const autoMetrics = metricData(automatedRows);
  const compareMetrics = {
    reg: regMetrics,
    auto: autoMetrics,
  };

  const MetricGrid = ({ m }) => (
    <div className="hs-cmp-metric-grid">
      <div className="hs-cmp-metric"><p className="hs-cmp-ml">Emails</p><p className="hs-cmp-mv">{formatNumber(m.emails)}</p></div>
      <div className="hs-cmp-metric"><p className="hs-cmp-ml">Total delivered</p><p className="hs-cmp-mv">{formatNumber(m.delivered)}</p></div>
      <div className="hs-cmp-metric"><p className="hs-cmp-ml">Avg open rate</p><p className="hs-cmp-mv">{pct(m.avgOpen)}</p></div>
      <div className="hs-cmp-metric"><p className="hs-cmp-ml">Avg click rate</p><p className="hs-cmp-mv">{pct(m.avgClick)}</p></div>
      <div className="hs-cmp-metric"><p className="hs-cmp-ml">Total opens</p><p className="hs-cmp-mv">{formatNumber(m.opens)}</p></div>
      <div className="hs-cmp-metric"><p className="hs-cmp-ml">Total clicks</p><p className="hs-cmp-mv">{formatNumber(m.clicks)}</p></div>
    </div>
  );

  const DataTable = ({ data, page, onPage }) => {
    const sorted = sortedBySendDate(data);
    const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * PAGE_SIZE;
    const pageRows = sorted.slice(start, start + PAGE_SIZE);
    if (!sorted.length) return <p className="hs-cmp-empty">No data for selected filters</p>;
    return (
      <>
        <div className="hs-cmp-table-wrap">
          <table className="data-table hs-cmp-table">
            <thead>
              <tr>
                <th>Campaign</th><th>Email name</th><th>Sent date</th><th className="text-right">Delivered</th>
                <th className="text-right">Open %</th><th className="text-right">Click %</th><th className="text-right">Bounces</th>
                <th className="text-right">Unsubs</th><th>Performance</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const p = perfBadge(r.open_rate_pct);
                return (
                  <tr key={r.email_id}>
                    <td>{r.campaign_name || '—'}</td>
                    <td>{r.email_name || '—'}</td>
                    <td>{fmtDate(r.publish_send_at)}</td>
                    <td className="text-right">{formatNumber(toNum(r.delivered))}</td>
                    <td className="text-right">{pct(r.open_rate_pct)}</td>
                    <td className="text-right">{pct(r.click_rate_pct)}</td>
                    <td className="text-right">{formatNumber(toNum(r.bounces))}</td>
                    <td className="text-right">{formatNumber(toNum(r.unsubscribes))}</td>
                    <td>{p.cls ? <span className={`badge ${p.cls}`}>{p.label}</span> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="sub-pagination">
            <span>
              Showing {start + 1}-{Math.min(start + PAGE_SIZE, sorted.length)} of {formatNumber(sorted.length)}
            </span>
            <div className="sub-pg-btns">
              <button className="btn btn-outline btn-sm" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}>← Prev</button>
              <span>Page {safePage} of {pages}</span>
              <button className="btn btn-outline btn-sm" disabled={safePage >= pages} onClick={() => onPage(safePage + 1)}>Next →</button>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="page-section active page-hs-email-marketing" id="page-hs-email-marketing">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>HubSpot email marketing</h2>
          <p className="page-sub-head">Regular and automated campaign report</p>
        </div>

        <div className="panel hs-cmp-filter-panel">
          <div className="panel-body">
            <div className="hs-cmp-tab-row">
              <button type="button" className={`hs-cmp-tab ${tab === 'regular' ? 'active' : ''}`} onClick={() => setTab('regular')}>Regular campaigns</button>
              <button type="button" className={`hs-cmp-tab ${tab === 'automated' ? 'active' : ''}`} onClick={() => setTab('automated')}>Automated campaigns</button>
              <button type="button" className={`hs-cmp-tab ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>Regular vs Automated</button>
            </div>

            <div className="hs-cmp-filter-row">
              <label className="hs-cmp-filter-group">
                <span className="hs-cmp-fl">Campaign status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s === STATUS_ALL ? 'All statuses' : s}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setFilters({
                    datePreset: 'last30',
                    dateFrom: '',
                    dateTo: '',
                    compareOn: false,
                    compareFrom: '',
                    compareTo: '',
                  });
                  setStatus(STATUS_ALL);
                }}
              >
                Reset
              </button>
              <div className="hs-cmp-date-right">
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
            </div>
          </div>
        </div>

        {tab === 'regular' && (
          <>
            <MetricGrid m={regMetrics} />
            <div className="hs-cmp-chart-grid">
              <div className="panel"><div className="panel-body"><p className="hs-cmp-sec">Delivered per campaign</p><div className="hs-cmp-canvas-wrap"><canvas id="hs-reg-del" /></div></div></div>
              <div className="panel"><div className="panel-body"><p className="hs-cmp-sec">Open rate vs Click rate</p><div className="hs-cmp-canvas-wrap"><canvas id="hs-reg-rates" /></div></div></div>
            </div>
            <div className="panel"><div className="panel-body"><p className="hs-cmp-sec">Regular campaign email details</p><DataTable data={regularRows} page={pageRegular} onPage={setPageRegular} /></div></div>
          </>
        )}

        {tab === 'automated' && (
          <>
            <MetricGrid m={autoMetrics} />
            <div className="hs-cmp-chart-grid">
              <div className="panel"><div className="panel-body"><p className="hs-cmp-sec">Delivered per automated campaign</p><div className="hs-cmp-canvas-wrap"><canvas id="hs-auto-del" /></div></div></div>
              <div className="panel"><div className="panel-body"><p className="hs-cmp-sec">Open rate vs Click rate</p><div className="hs-cmp-canvas-wrap"><canvas id="hs-auto-rates" /></div></div></div>
            </div>
            <div className="panel"><div className="panel-body"><p className="hs-cmp-sec">Automated campaign email details</p><DataTable data={automatedRows} page={pageAutomated} onPage={setPageAutomated} /></div></div>
          </>
        )}

        {tab === 'compare' && (
          <>
            <div className="hs-cmp-compare-grid">
              <div className="panel"><div className="panel-body"><p className="hs-cmp-sec">Regular campaigns</p><MetricGrid m={compareMetrics.reg} /></div></div>
              <div className="panel"><div className="panel-body"><p className="hs-cmp-sec">Automated campaigns</p><MetricGrid m={compareMetrics.auto} /></div></div>
            </div>
            <div className="panel">
              <div className="panel-body">
                <p className="hs-cmp-sec">Regular vs Automated - Avg open rate</p>
                <div className="hs-cmp-canvas-wrap hs-cmp-canvas-wrap-lg"><canvas id="hs-compare-open" /></div>
              </div>
            </div>
          </>
        )}
        {filtered.length === 0 && (
          <div className="panel">
            <div className="panel-body">
              <p className="hs-cmp-empty">No data for selected filters.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
