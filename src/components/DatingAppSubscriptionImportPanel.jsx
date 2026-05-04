import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase.js';
import { parseDatingAppSubscriptionXlsx, extractReportYearMonth } from '../lib/parseDatingAppSubscriptionXlsx.js';

const fU = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fI = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');

/**
 * Excel import for dating app subscription campaign data (WOW-style sheets).
 * Used from White-Label Settings; Subscriptions page is view-only.
 */
export function DatingAppSubscriptionImportPanel({ showNotification }) {
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [uploads, setUploads] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);

  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fileParsing, setFileParsing] = useState(false);

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
      const buf = await file.arrayBuffer();
      const parsed = parseDatingAppSubscriptionXlsx(buf);
      setPreview({
        sheets: parsed.sheets || [],
        workbookWarnings: parsed.warnings || [],
        sourceFilename: file.name,
      });
      const n = parsed.sheets?.length ?? 0;
      const parts = [];
      if (n > 0) parts.push(`${n} sheet(s) ready to save`);
      if (parsed.warnings?.length) parts.push(parsed.warnings.join(' '));
      if (parts.length) showNotification?.(parts.join(' · '));
    } catch (err) {
      console.error(err);
      showNotification?.(err.message || 'Could not read Excel file');
    } finally {
      setFileParsing(false);
    }
  };

  const saveToSupabase = async () => {
    if (!preview || !user?.id) return;
    const { sheets, sourceFilename } = preview;
    const toSave = (sheets || []).filter((s) => s.byApp?.length > 0 || s.byCountry?.length > 0);
    if (toSave.length === 0) {
      showNotification?.('Nothing to save — no sheets with WOW-style tables.');
      return;
    }

    setSaving(true);
    const createdIds = [];
    let replacedPriorUploads = 0;
    try {
      for (const sheet of toSave) {
        const tab = String(sheet.sheetName || '').trim();
        const titleRow = sheet.reportTitle ? String(sheet.reportTitle).trim() : '';
        const reportTitle =
          tab && titleRow && titleRow.toLowerCase() !== tab.toLowerCase()
            ? `${tab} — ${titleRow}`
            : tab || titleRow || null;

        const period = extractReportYearMonth({
          sheetName: sheet.sheetName,
          reportTitle: sheet.reportTitle,
          sourceFilename: sourceFilename || '',
        });

        if (period?.year != null && period?.month != null) {
          const { data: removedRows, error: delErr } = await supabase
            .from('dating_app_subscription_uploads')
            .delete()
            .eq('uploaded_by', user.id)
            .eq('report_year', period.year)
            .eq('report_month', period.month)
            .select('id');
          if (delErr) throw delErr;
          replacedPriorUploads += removedRows?.length ?? 0;
        }

        const { data: uploadRow, error: upErr } = await supabase
          .from('dating_app_subscription_uploads')
          .insert({
            report_title: reportTitle,
            report_year: period?.year ?? null,
            report_month: period?.month ?? null,
            source_filename: `${sourceFilename || 'upload.xlsx'} (${sheet.sheetName})`,
            uploaded_by: user.id,
          })
          .select('id')
          .single();
        if (upErr) throw upErr;
        const uploadId = uploadRow.id;
        createdIds.push(uploadId);

        const metricRows = [
          ...sheet.byApp.map((r) => ({
            upload_id: uploadId,
            breakdown: 'by_app',
            row_label: r.row_label,
            is_total: r.is_total,
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            cpm: r.cpm,
            cpc: r.cpc,
          })),
          ...sheet.byCountry.map((r) => ({
            upload_id: uploadId,
            breakdown: 'by_country',
            row_label: r.row_label,
            is_total: r.is_total,
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            cpm: r.cpm,
            cpc: r.cpc,
          })),
        ];

        const { error: mErr } = await supabase.from('dating_app_subscription_metrics').insert(metricRows);
        if (mErr) throw mErr;
      }

      setPreview(null);
      await loadUploads();
      const replaceNote =
        replacedPriorUploads > 0
          ? ` Replaced ${replacedPriorUploads} earlier import(s) for the same month & year.`
          : '';
      showNotification?.(
        `Saved ${toSave.length} report(s).${replaceNote} View under Subscriptions → Dating app data.`
      );
    } catch (err) {
      console.error(err);
      for (const id of [...createdIds].reverse()) {
        await supabase.from('dating_app_subscription_uploads').delete().eq('id', id);
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
            <label htmlFor="wl-dating-xlsx-input">Excel file (.xlsx)</label>
            <input
              ref={fileInputRef}
              id="wl-dating-xlsx-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={onFile}
              disabled={fileParsing || saving}
              style={{ maxWidth: 320 }}
            />
          </div>
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
