import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

/** Inline input style for table cells */
const cellInputStyle = {
  width: '100%',
  minWidth: 80,
  padding: '0.35rem 0.5rem',
  borderRadius: 4,
  border: '1px solid var(--border, #ddd)',
  fontSize: '0.9rem',
  background: 'var(--bg, #fff)',
};

export function GoogleCampaignsReferencePage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  /** Per-row edits: { [id]: { country?, product_type?, showname? } } */
  const [edits, setEdits] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [message, setMessage] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: rows, error: err } = await supabase
        .from('google_campaigns_reference_data')
        .select('id, campaign_name, country, product_type, showname')
        .order('id', { ascending: true });
      if (err) {
        setError(err.message);
        setData([]);
      } else {
        setData(Array.isArray(rows) ? rows : []);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getCellValue = useCallback((row, field) => {
    if (edits[row.id] && edits[row.id][field] !== undefined) return edits[row.id][field];
    return row[field] ?? '';
  }, [edits]);

  const setCellEdit = useCallback((id, field, value) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  }, []);

  const handleSaveRow = useCallback(async (row) => {
    const id = row.id;
    const country = (edits[id]?.country !== undefined ? edits[id].country : row.country) ?? '';
    const product_type = (edits[id]?.product_type !== undefined ? edits[id].product_type : row.product_type) ?? '';
    const showname = (edits[id]?.showname !== undefined ? edits[id].showname : row.showname) ?? '';
    setSavingId(id);
    setError(null);
    setMessage(null);
    try {
      const { error: err } = await supabase
        .from('google_campaigns_reference_data')
        .update({
          country: country || null,
          product_type: product_type || null,
          showname: showname || null,
        })
        .eq('id', id);
      if (err) {
        setError(err.message);
      } else {
        setData((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, country: country || null, product_type: product_type || null, showname: showname || null } : r
          )
        );
        setEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setMessage('Row updated.');
        setTimeout(() => setMessage(null), 3000);
      }
    } catch (e) {
      setError(e?.message || 'Failed to update');
    } finally {
      setSavingId(null);
    }
  }, [edits]);

  const searchLower = (searchQuery || '').trim().toLowerCase();
  const filtered =
    !searchLower
      ? data
      : data.filter(
          (r) =>
            (r.campaign_name ?? '').toLowerCase().includes(searchLower) ||
            (r.country ?? '').toLowerCase().includes(searchLower) ||
            (r.product_type ?? '').toLowerCase().includes(searchLower) ||
            (r.showname ?? '').toLowerCase().includes(searchLower)
        );

  return (
    <div className="page-section active" id="page-google-campaigns-reference">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Google Campaigns Reference Data</h2>
          <p>Reference data for Google Ads campaigns (campaign name, country, product type, show name)</p>
        </div>

        {message && (
          <div className="help-text" style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>
            {message}
          </div>
        )}
        {error && (
          <div className="help-text" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {loading ? (
          <p className="help-text">Loading…</p>
        ) : data.length === 0 && !error ? (
          <p className="help-text">No reference data yet. Data is populated when Google Ads sync runs.</p>
        ) : (
          <div className="settings-section">
            <div style={{ marginBottom: '1rem' }}>
              <input
                type="search"
                className="search-input"
                placeholder="Search by campaign name, country, product type or show name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search reference data"
                style={{
                  width: '100%',
                  maxWidth: 400,
                  padding: '0.5rem 0.75rem',
                  borderRadius: 6,
                  border: '1px solid var(--border, #ddd)',
                  fontSize: '0.95rem',
                }}
              />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="users-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>#</th>
                    <th>Campaign Name</th>
                    <th>Country</th>
                    <th>Product Type</th>
                    <th>Show Name</th>
                    <th style={{ width: 100 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.campaign_name ?? '—'}</td>
                      <td>
                        <input
                          type="text"
                          value={getCellValue(r, 'country')}
                          onChange={(e) => setCellEdit(r.id, 'country', e.target.value)}
                          placeholder="Country"
                          aria-label="Country"
                          style={cellInputStyle}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={getCellValue(r, 'product_type')}
                          onChange={(e) => setCellEdit(r.id, 'product_type', e.target.value)}
                          placeholder="Product type"
                          aria-label="Product type"
                          style={cellInputStyle}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={getCellValue(r, 'showname')}
                          onChange={(e) => setCellEdit(r.id, 'showname', e.target.value)}
                          placeholder="Show name"
                          aria-label="Show name"
                          style={cellInputStyle}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={savingId === r.id}
                          onClick={() => handleSaveRow(r)}
                        >
                          {savingId === r.id ? 'Saving…' : 'Update'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && data.length > 0 && (
              <p className="help-text" style={{ marginTop: '0.75rem' }}>
                No rows match your search.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
