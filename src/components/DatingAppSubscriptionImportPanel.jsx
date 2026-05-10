import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase.js';
import appBySampleCsvUrl from '../../samples/app_by_sample.csv?url';
import countryBySampleCsvUrl from '../../samples/country_by_sample.csv?url';

const fU = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[\s_/-]+/g, '');
}

function parseNumberValue(v) {
  const cleaned = String(v ?? '')
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseIntegerValue(v) {
  const n = parseNumberValue(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseMetricsCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const nameHeaderCandidates = ['rowlabel', 'apps', 'app', 'country', 'countryregion', 'region', 'name'];
  const rowLabelIdx = nameHeaderCandidates
    .map((k) => headers.indexOf(k))
    .find((i) => i != null && i >= 0);
  const idx = {
    row_label: rowLabelIdx ?? -1,
    spend: headers.indexOf('spend'),
    impressions: headers.indexOf('impressions'),
    clicks: headers.indexOf('clicks'),
    cpm: headers.indexOf('cpm'),
    cpc: headers.indexOf('cpc'),
  };
  if (idx.row_label < 0 || idx.spend < 0 || idx.impressions < 0 || idx.clicks < 0 || idx.cpm < 0 || idx.cpc < 0) {
    throw new Error('CSV must include a name column (Apps/Country/row_label) plus: Spend, Impressions, Clicks, CPM, CPC');
  }
  return lines
    .slice(1)
    .map((line) => {
      const cols = parseCsvLine(line);
      const rowLabel = String(cols[idx.row_label] || '').trim();
      if (!rowLabel) return null;
      return {
        row_label: rowLabel,
        is_total: rowLabel.toUpperCase() === 'TOTAL',
        spend: parseNumberValue(cols[idx.spend]),
        impressions: parseIntegerValue(cols[idx.impressions]),
        clicks: parseIntegerValue(cols[idx.clicks]),
        cpm: parseNumberValue(cols[idx.cpm]),
        cpc: parseNumberValue(cols[idx.cpc]),
      };
    })
    .filter(Boolean);
}

/**
 * Excel import for dating app subscription campaign data (WOW-style sheets).
 * Used from White-Label Settings; Subscriptions page is view-only.
 */
export function DatingAppSubscriptionImportPanel({ showNotification }) {
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const now = new Date();
  const monthOptions = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
  ];
  const yearOptions = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 3 + i);

  const [uploads, setUploads] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);

  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fileParsing, setFileParsing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedExcelMode, setSelectedExcelMode] = useState('');
  const [hasDownloadedSample, setHasDownloadedSample] = useState(false);

  const downloadSampleCsv = useCallback((mode) => {
    const isApp = mode === 'app';
    const href = isApp ? appBySampleCsvUrl : countryBySampleCsvUrl;
    const a = document.createElement('a');
    a.href = href;
    a.download = isApp ? 'app_by_sample.csv' : 'country_by_sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setSelectedExcelMode(mode);
    setHasDownloadedSample(true);
    showNotification?.(`Downloaded ${isApp ? 'By App' : 'By Country'} sample CSV. You can upload now.`);
  }, [showNotification]);

  useEffect(() => {
    setSelectedExcelMode('');
    setHasDownloadedSample(false);
    setPreview(null);
  }, [selectedMonth, selectedYear]);

  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    try {
      const { data, error } = await supabase
        .from('dating_app_subscription_uploads')
        .select('id, report_title, source_filename, report_year, report_month, uploaded_by, uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setUploads(data || []);
    } catch (e) {
      console.error(e);
      showNotification?.('Failed to load uploads: ' + (e.message || String(e)));
      setUploads([]);
    } finally {
      setUploadsLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPreview(null);
    setFileParsing(true);
    try {
      if (!String(file.name || '').toLowerCase().endsWith('.csv')) {
        throw new Error('Please upload CSV only.');
      }
      if (!selectedExcelMode) {
        throw new Error('Please download and choose CSV mode first.');
      }
      const text = await file.text();
      const parsedRows = parseMetricsCsv(text);
      const byApp = selectedExcelMode === 'app' ? parsedRows : [];
      const byCountry = selectedExcelMode === 'country' ? parsedRows : [];
      setPreview({
        sheets: [{ sheetName: 'CSV Upload', byApp, byCountry, warnings: [] }],
        workbookWarnings: [],
        sourceFilename: file.name,
      });
      const n = parsedRows.length;
      const parts = [];
      if (n > 0) parts.push(`${n} row(s) ready to save`);
      if (parts.length) showNotification?.(parts.join(' · '));
    } catch (err) {
      console.error(err);
      showNotification?.(err.message || 'Could not read CSV file');
    } finally {
      setFileParsing(false);
    }
  };

  const saveToSupabase = async () => {
    if (!preview || !user?.id) return;
    if (!selectedMonth || !selectedYear || !selectedExcelMode) {
      showNotification?.('Please select month, year, and one Excel option first.');
      return;
    }
    const { sheets, sourceFilename } = preview;
    const toSave = (sheets || []).filter((s) => s.byApp?.length > 0 || s.byCountry?.length > 0);
    if (toSave.length === 0) {
      showNotification?.('Nothing to save — no sheets with WOW-style tables.');
      return;
    }

    setSaving(true);
    let createdUploadId = null;
    try {
      const monthLabel = monthOptions.find((m) => String(m.value) === String(selectedMonth))?.label || selectedMonth;
      const modeLabel = selectedExcelMode === 'app' ? 'By App' : 'By Country';
      const reportTitle = `Display Ads ${modeLabel} - ${monthLabel} ${selectedYear}`;
      const saveYear = Number(selectedYear);
      const saveMonth = Number(selectedMonth);
      const breakdownValue = selectedExcelMode === 'app' ? 'by_app' : 'by_country';

      const { data: existingUpload, error: existingErr } = await supabase
        .from('dating_app_subscription_uploads')
        .select('id')
        .eq('uploaded_by', user.id)
        .eq('report_year', saveYear)
        .eq('report_month', saveMonth)
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingErr) throw existingErr;

      let uploadId = existingUpload?.id || null;
      if (!uploadId) {
        const { data: uploadRow, error: upErr } = await supabase
          .from('dating_app_subscription_uploads')
          .insert({
            report_title: `Display Ads - ${monthLabel} ${selectedYear}`,
            report_year: saveYear,
            report_month: saveMonth,
            source_filename: sourceFilename || 'upload.csv',
            uploaded_by: user.id,
          })
          .select('id')
          .single();
        if (upErr) throw upErr;
        uploadId = uploadRow.id;
        createdUploadId = uploadId;
      }

      const metricRows = toSave
        .flatMap((sheet) => {
          const sourceRows = selectedExcelMode === 'app' ? (sheet.byApp || []) : (sheet.byCountry || []);
          return sourceRows.map((r) => ({
            upload_id: uploadId,
            breakdown: breakdownValue,
            row_label: String(r.row_label || '').trim(),
            is_total: !!r.is_total,
            spend: parseNumberValue(r.spend),
            impressions: parseIntegerValue(r.impressions),
            clicks: parseIntegerValue(r.clicks),
            cpm: parseNumberValue(r.cpm),
            cpc: parseNumberValue(r.cpc),
          }));
        })
        .filter((r) => r.row_label);

      if (metricRows.length === 0) {
        throw new Error('No valid rows found to save for selected upload mode.');
      }

      const { error: deleteBreakdownErr } = await supabase
        .from('dating_app_subscription_metrics')
        .delete()
        .eq('upload_id', uploadId)
        .eq('breakdown', breakdownValue);
      if (deleteBreakdownErr) throw deleteBreakdownErr;

      const { error: mErr } = await supabase.from('dating_app_subscription_metrics').insert(metricRows);
      if (mErr) throw mErr;

      await supabase
        .from('dating_app_subscription_uploads')
        .update({
          report_title: reportTitle,
          source_filename: sourceFilename || 'upload.csv',
        })
        .eq('id', uploadId);

      setPreview(null);
      setSelectedExcelMode('');
      setHasDownloadedSample(false);
      await loadUploads();
      showNotification?.(
        `Saved ${metricRows.length} ${modeLabel} row(s) for ${monthLabel} ${selectedYear}.`
      );
    } catch (err) {
      console.error(err);
      if (createdUploadId) {
        await supabase.from('dating_app_subscription_uploads').delete().eq('id', createdUploadId);
      }
      showNotification?.(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteUpload = async (id, ownerId) => {
    if (!user?.id || user.id !== ownerId) return;
    if (!window.confirm('Delete this upload and all its rows?')) return;
    try {
      const { error } = await supabase.from('dating_app_subscription_uploads').delete().eq('id', id);
      if (error) throw error;
      setPreview(null);
      showNotification?.('Upload deleted.');
      loadUploads();
    } catch (e) {
      console.error(e);
      showNotification?.(e.message || 'Delete failed');
    }
  };

  return (
    <div className="wl-settings-card">
      <h2 className="wl-settings-subtitle">Dating app subscription data</h2>
      <p className="wl-settings-desc" style={{ marginTop: 8, marginBottom: 20 }}>
        Upload WOW-style Excel workbooks. Every tab that contains the standard tables (by app and by country) is
        imported as its own report — for example <strong>WOW JAN 2026</strong>, <strong>WOW FEB 2026</strong>, and{' '}
        <strong>WOW MARCH 2026</strong> in one file become three saved reports. View them under{' '}
        <strong>Subscriptions → Dating app data</strong>.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="gads-filter-row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div className="gads-filter-group">
            <label htmlFor="wl-dating-month-select">Month</label>
            <select
              id="wl-dating-month-select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={fileParsing || saving}
              style={{ minWidth: 160 }}
            >
              <option value="">Select month</option>
              {monthOptions.map((m) => (
                <option key={m.value} value={String(m.value)}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="gads-filter-group">
            <label htmlFor="wl-dating-year-select">Year</label>
            <select
              id="wl-dating-year-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              disabled={fileParsing || saving}
              style={{ minWidth: 120 }}
            >
              <option value="">Select year</option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          {selectedMonth && selectedYear && (
            <div className="gads-filter-group">
              <label>Excel buttons (download sample CSV)</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={fileParsing || saving}
                  onClick={() => downloadSampleCsv('app')}
                >
                  Download By App Sample CSV
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={fileParsing || saving}
                  onClick={() => downloadSampleCsv('country')}
                >
                  Download By Country Sample CSV
                </button>
              </div>
            </div>
          )}
          {selectedMonth && selectedYear && hasDownloadedSample && selectedExcelMode && (
            <div className="gads-filter-group">
            <label htmlFor="wl-dating-xlsx-input">CSV file (.csv)</label>
            <input
              ref={fileInputRef}
              id="wl-dating-xlsx-input"
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              disabled={fileParsing || saving}
              style={{ maxWidth: 320 }}
            />
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              Uploading mode: <strong>{selectedExcelMode === 'app' ? 'By App' : 'By Country'}</strong>
            </div>
          </div>
          )}
          {preview && (
            <div className="gads-filter-group" style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || fileParsing}
                onClick={saveToSupabase}
              >
                {saving ? 'Saving…' : 'Save to database'}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ marginLeft: 8 }}
                disabled={saving || fileParsing}
                onClick={() => setPreview(null)}
              >
                Clear preview
              </button>
            </div>
          )}
        </div>

        {(fileParsing || saving) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginTop: 14,
              padding: '12px 0',
              color: 'var(--text-muted)',
              fontSize: 14,
              fontWeight: 500,
            }}
            role="status"
            aria-live="polite"
          >
            <div className="gads-spinner" />
            {saving ? 'Saving reports to the database…' : 'Reading workbook and parsing sheets…'}
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>{preview.sourceFilename}</p>
            {preview.workbookWarnings?.length > 0 && (
              <p style={{ color: 'var(--warning-color, #b45309)', fontSize: 13, marginBottom: 12 }}>
                {preview.workbookWarnings.join(' ')}
              </p>
            )}
            {(preview.sheets || []).length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No tabs contained recognizable tables.</p>
            )}
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {(preview.sheets || []).map((s) => (
                <li key={s.sheetName} style={{ marginBottom: 10 }}>
                  <strong>{s.sheetName}</strong> — {s.byApp.length} app row(s), {s.byCountry.length} country row(s)
                  {s.warnings?.length > 0 && (
                    <span style={{ color: 'var(--warning-color, #b45309)', display: 'block', fontSize: 12 }}>
                      {s.warnings.join(' ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {(preview.sheets || []).some((s) => s.byApp.length || s.byCountry.length) && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>Preview sample rows (first sheet)</summary>
                <div style={{ marginTop: 8, overflowX: 'auto' }}>
                  {(() => {
                    const first = preview.sheets?.find((s) => s.byApp.length || s.byCountry.length);
                    if (!first) return null;
                    return (
                      <>
                        <div style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-muted)' }}>{first.sheetName}</div>
                        {first.byApp.slice(0, 4).map((r, i) => (
                          <div key={`a${i}`} style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 4 }}>
                            {r.row_label}: {fU(r.spend)} | {fI(r.impressions)} impr.
                          </div>
                        ))}
                        {first.byCountry.slice(0, 4).map((r, i) => (
                          <div key={`c${i}`} style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 4 }}>
                            {r.row_label}: {fU(r.spend)} | {fI(r.impressions)} impr.
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Imports on file</h3>
        {uploadsLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--text-muted)',
              fontSize: 14,
              padding: '8px 0',
            }}
            role="status"
          >
            <div className="gads-spinner" />
            Loading imports…
          </div>
        ) : uploads.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No uploads yet.</p>
        ) : (
          <div className="gads-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="data-table gads-table">
              <thead>
                <tr>
                  <th>File / title</th>
                  <th>Uploaded</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id}>
                    <td>{u.report_title || u.source_filename}</td>
                    <td>{new Date(u.uploaded_at).toLocaleString()}</td>
                    <td className="text-right">
                      {user?.id === u.uploaded_by && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => deleteUpload(u.id, u.uploaded_by)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
