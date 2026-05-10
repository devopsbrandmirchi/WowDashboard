import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase.js';
import { partitionDatingAppCountryMetrics } from '../lib/parseDatingAppSubscriptionXlsx.js';

const fU = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');

const MONTH_FULL = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** "MARCH" / "Mar" / "march" → "March" */
function monthLongFromToken(token) {
  if (!token) return null;
  const t = String(token).toLowerCase().replace(/\./g, '');
  for (let i = 0; i < 12; i++) {
    const full = MONTH_FULL[i];
    if (t === full) return full.charAt(0).toUpperCase() + full.slice(1);
    if (full.startsWith(t) && t.length >= 3) return full.charAt(0).toUpperCase() + full.slice(1);
  }
  return null;
}

/** Dropdown / heading: show only calendar month + year when parsable from WOW-style titles. */
function formatReportMonthYear(u) {
  if (!u) return '';
  if (u.report_year != null && u.report_month != null) {
    const y = Number(u.report_year);
    const m = Number(u.report_month);
    if (Number.isFinite(y) && m >= 1 && m <= 12) {
      const d = new Date(y, m - 1, 1);
      return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
  }
  const blob = [u.report_title, u.source_filename].filter(Boolean).join(' ');

  const wow = blob.match(/\bWOW\s+([A-Za-z]+)\s+(\d{4})\b/i);
  if (wow) {
    const long = monthLongFromToken(wow[1]);
    if (long) return `${long} ${wow[2]}`;
  }

  const my = blob.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s*['']?\s*(\d{4}|\d{2})\b/i
  );
  if (my) {
    let y = parseInt(my[2], 10);
    if (y >= 0 && y < 100) y += 2000;
    const long = monthLongFromToken(my[1]);
    if (long) return `${long} ${y}`;
  }

  try {
    const d = new Date(u.uploaded_at);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
  } catch {
    /* ignore */
  }
  return u.report_title || u.source_filename || 'Report';
}

function reportSelectLabel(u, allUploads) {
  const base = formatReportMonthYear(u);
  const samePeriod = allUploads.filter((x) => formatReportMonthYear(x) === base);
  if (samePeriod.length <= 1) return base;
  return `${base} · ${new Date(u.uploaded_at).toLocaleDateString()}`;
}

function toPeriodKey(u) {
  const y = Number(u?.report_year);
  const m = Number(u?.report_month);
  if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  return `label:${formatReportMonthYear(u)}`;
}

/** Prefer latest calendar month/year; otherwise most recent upload (first in uploaded_at desc list). */
function pickDefaultUploadId(uploads) {
  if (!uploads?.length) return null;
  const withPeriod = uploads.filter((u) => {
    const y = Number(u.report_year);
    const m = Number(u.report_month);
    return (
      u.report_year != null &&
      u.report_month != null &&
      Number.isFinite(y) &&
      Number.isFinite(m) &&
      m >= 1 &&
      m <= 12
    );
  });
  if (withPeriod.length === 0) return uploads[0].id;
  let best = withPeriod[0];
  let bestY = Number(best.report_year);
  let bestM = Number(best.report_month);
  for (let i = 1; i < withPeriod.length; i++) {
    const u = withPeriod[i];
    const y = Number(u.report_year);
    const m = Number(u.report_month);
    if (y > bestY || (y === bestY && m > bestM)) {
      best = u;
      bestY = y;
      bestM = m;
    }
  }
  return best.id;
}

function MetricTable({ rows, nameColumnLabel }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="gads-table-wrap" style={{ overflowX: 'auto' }}>
        <table className="data-table gads-table">
          <thead>
            <tr>
              <th style={{ textTransform: 'uppercase' }}>{nameColumnLabel}</th>
              <th className="text-right">Spend</th>
              <th className="text-right">Impressions</th>
              <th className="text-right">Clicks</th>
              <th className="text-right">CPM</th>
              <th className="text-right">CPC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: r.is_total ? 700 : 400, textTransform: 'uppercase' }}>{r.row_label}</td>
                <td className="text-right">{fU(r.spend)}</td>
                <td className="text-right">{fI(r.impressions)}</td>
                <td className="text-right">{fI(r.clicks)}</td>
                <td className="text-right">{fU(r.cpm)}</td>
                <td className="text-right">{fU(r.cpc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function useSpendBarChart(canvasRef, rows) {
  const chartRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rows?.length) {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      return;
    }
    const labels = rows.map((r) => String(r.row_label ?? '').toUpperCase());
    const values = rows.map((r) => Number(r.spend) || 0);
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Spend',
            data: values,
            backgroundColor: 'rgba(237, 28, 36, 0.75)',
            borderColor: 'rgba(237, 28, 36, 1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => fU(ctx.raw),
            },
          },
        },
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 0 } },
          y: {
            ticks: {
              callback: (v) => '$' + Number(v).toLocaleString('en-US'),
            },
          },
        },
      },
    });
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [canvasRef, rows]);
}

export function DatingAppSubscriptionDataPage() {
  const { showNotification } = useApp();

  const [uploads, setUploads] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [selectedUploadId, setSelectedUploadId] = useState(null);

  const [storedMetrics, setStoredMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const spendChartRef = useRef(null);
  const [activeTab, setActiveTab] = useState('app');

  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    try {
      const { data, error } = await supabase
        .from('dating_app_subscription_uploads')
        .select('id, report_title, source_filename, report_year, report_month, uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setUploads(data || []);
    } catch (e) {
      console.error(e);
      showNotification?.('Failed to load reports: ' + (e.message || String(e)));
      setUploads([]);
    } finally {
      setUploadsLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  const loadMetricsForUpload = useCallback(
    async (uploadId) => {
      if (!uploadId) {
        setStoredMetrics(null);
        return;
      }
      setMetricsLoading(true);
      setStoredMetrics(null);
      try {
        const { data, error } = await supabase
          .from('dating_app_subscription_metrics')
          .select('*')
          .eq('upload_id', uploadId)
          .order('breakdown', { ascending: true });
        if (error) throw error;
        const rows = data || [];
        const mapRow = (r) => ({
          row_label: r.row_label,
          is_total: r.is_total,
          spend: r.spend,
          impressions: r.impressions,
          clicks: r.clicks,
          cpm: r.cpm,
          cpc: r.cpc,
        });
        const rawApp = rows.filter((r) => r.breakdown === 'by_app').map(mapRow);
        const rawCountry = rows.filter((r) => r.breakdown === 'by_country').map(mapRow);
        const { byApp, byCountry } = partitionDatingAppCountryMetrics({
          byApp: rawApp,
          byCountry: rawCountry,
        });
        setStoredMetrics({ byApp, byCountry });
      } catch (e) {
        console.error(e);
        showNotification?.('Failed to load metrics: ' + (e.message || String(e)));
        setStoredMetrics(null);
      } finally {
        setMetricsLoading(false);
      }
    },
    [showNotification]
  );

  useEffect(() => {
    if (!selectedUploadId) {
      setStoredMetrics(null);
      return;
    }
    loadMetricsForUpload(selectedUploadId);
  }, [selectedUploadId, loadMetricsForUpload]);

  const uniqueUploads = useMemo(() => {
    const map = new Map();
    uploads.forEach((u) => {
      const key = toPeriodKey(u);
      if (!map.has(key)) map.set(key, u);
    });
    return Array.from(map.values());
  }, [uploads]);

  useEffect(() => {
    if (uploadsLoading) return;
    if (uniqueUploads.length === 0) {
      setSelectedUploadId(null);
      return;
    }
    const exists = selectedUploadId && uniqueUploads.some((u) => u.id === selectedUploadId);
    if (!exists) setSelectedUploadId(pickDefaultUploadId(uniqueUploads));
  }, [uniqueUploads, uploadsLoading, selectedUploadId]);

  useEffect(() => {
    setActiveTab('app');
  }, [selectedUploadId]);

  const displayByApp = storedMetrics?.byApp ?? [];
  const displayByCountry = storedMetrics?.byCountry ?? [];

  const chartAppRows = useMemo(
    () => displayByApp.filter((r) => !r.is_total),
    [displayByApp]
  );
  const chartCountryRows = useMemo(
    () => displayByCountry.filter((r) => !r.is_total),
    [displayByCountry]
  );

  const chartRowsForTab = activeTab === 'app' ? chartAppRows : chartCountryRows;
  useSpendBarChart(spendChartRef, chartRowsForTab);

  const selectedMeta = uniqueUploads.find((u) => u.id === selectedUploadId);
  const reportHeading = selectedMeta ? formatReportMonthYear(selectedMeta) : null;

  return (
    <div className="page-section active" id="page-dating-app-subscription-data">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  background: '#c026d3',
                  color: 'white',
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                ♥
              </span>
              Dating app subscription data
            </h2>
            {/* <p className="page-subtitle" style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 14 }}>
              View campaign metrics by app and by country. To add or remove Excel imports, open{' '}
              <Link to="/settings" state={{ openDatingAppImport: true }}>
                White-Label Settings → Dating app data
              </Link>
              .
            </p> */}
          </div>
        </div>

        <div className="gads-filter-bar" style={{ marginTop: 20, marginBottom: 20 }}>
          <div className="gads-filter-row">
            <div className="gads-filter-group">
              <label htmlFor="dating-report-select">Report</label>
              <select
                id="dating-report-select"
                style={{ minWidth: 280, maxWidth: '100%' }}
                value={selectedUploadId || ''}
                disabled={uploadsLoading || uniqueUploads.length === 0}
                onChange={(e) => setSelectedUploadId(e.target.value || null)}
              >
                {uniqueUploads.length === 0 && <option value="">—</option>}
                {uniqueUploads.map((u) => (
                  <option key={u.id} value={u.id}>
                    {formatReportMonthYear(u)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {uploadsLoading && <p style={{ color: 'var(--text-muted)' }}>Loading reports…</p>}

        {!uploadsLoading && uniqueUploads.length === 0 && (
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
            No saved reports yet. Upload a WOW.
            {/* <Link to="/settings" state={{ openDatingAppImport: true }}>
              White-Label Settings → Dating app data
            </Link> */}
            .
          </p>
        )}

        {metricsLoading && selectedUploadId && (
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Loading metrics…</p>
        )}

        {!metricsLoading && selectedUploadId && reportHeading && (
          <h3 style={{ fontSize: 17, marginBottom: 16 }}>{reportHeading}</h3>
        )}

        {!metricsLoading &&
          selectedUploadId &&
          (displayByApp.length > 0 || displayByCountry.length > 0) && (
            <>
              <div className="gads-tabs-container" style={{ marginBottom: 16 }}>
                <div className="gads-tabs">
                  <button
                    type="button"
                    className={`gads-tab ${activeTab === 'app' ? 'active' : ''}`}
                    onClick={() => setActiveTab('app')}
                  >
                    App ({displayByApp.length})
                  </button>
                  <button
                    type="button"
                    className={`gads-tab ${activeTab === 'country' ? 'active' : ''}`}
                    onClick={() => setActiveTab('country')}
                  >
                    Country ({displayByCountry.length})
                  </button>
                </div>
              </div>

              {activeTab === 'app' && (
                <>
                  {chartAppRows.length > 0 && (
                    <div className="card" style={{ minHeight: 280, marginBottom: 20 }}>
                      <h4 style={{ marginBottom: 12 }}>Spend by app</h4>
                      <div style={{ height: 220, position: 'relative' }}>
                        <canvas ref={spendChartRef} />
                      </div>
                    </div>
                  )}
                  {displayByApp.length > 0 ? (
                    <MetricTable rows={displayByApp} nameColumnLabel="APP" />
                  ) : (
                    <p style={{ color: 'var(--text-muted)' }}>No app-level rows for this report.</p>
                  )}
                </>
              )}

              {activeTab === 'country' && (
                <>
                  {chartCountryRows.length > 0 && (
                    <div className="card" style={{ minHeight: 280, marginBottom: 20 }}>
                      <h4 style={{ marginBottom: 12 }}>Spend by country / region</h4>
                      <div style={{ height: 220, position: 'relative' }}>
                        <canvas ref={spendChartRef} />
                      </div>
                    </div>
                  )}
                  {displayByCountry.length > 0 ? (
                    <MetricTable rows={displayByCountry} nameColumnLabel="COUNTRY / REGION" />
                  ) : (
                    <p style={{ color: 'var(--text-muted)' }}>No country-level rows for this report.</p>
                  )}
                </>
              )}
            </>
          )}
      </div>
    </div>
  );
}
