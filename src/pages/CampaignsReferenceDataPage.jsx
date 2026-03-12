/**
 * Reusable campaigns reference data page: table with search and editable country, product_type, showname (or adset columns).
 * Used by Reddit, TikTok, Facebook campaigns and Facebook adset reference pages.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

const cellInputStyle = {
  width: '100%',
  minWidth: 80,
  padding: '0.35rem 0.5rem',
  borderRadius: 4,
  border: '1px solid var(--border, #ddd)',
  fontSize: '0.9rem',
  background: 'var(--bg, #fff)',
};

export function CampaignsReferenceDataPage({
  tableName,
  pageId,
  title,
  description,
  selectFields = ['id', 'campaign_name', 'country', 'product_type', 'showname'],
  editableFields = ['country', 'product_type', 'showname'],
  nameColumnLabel = 'Campaign Name',
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [edits, setEdits] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [message, setMessage] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const selectStr = selectFields.join(', ');
      const { data: rows, error: err } = await supabase
        .from(tableName)
        .select(selectStr)
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
  }, [tableName, selectFields]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getCellValue = useCallback((row, field) => {
    if (edits[row.id]?.[field] !== undefined) return edits[row.id][field];
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
    const payload = {};
    editableFields.forEach((field) => {
      const val = edits[id]?.[field] !== undefined ? edits[id][field] : row[field];
      payload[field] = (val ?? '') || null;
    });
    setSavingId(id);
    setError(null);
    setMessage(null);
    try {
      const { error: err } = await supabase.from(tableName).update(payload).eq('id', id);
      if (err) {
        setError(err.message);
      } else {
        setData((prev) =>
          prev.map((r) => (r.id === id ? { ...r, ...payload } : r))
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
  }, [tableName, editableFields, edits]);

  const searchLower = (searchQuery || '').trim().toLowerCase();
  const filtered = !searchLower
    ? data
    : data.filter((r) =>
        selectFields.some((f) => (String(r[f] ?? '')).toLowerCase().includes(searchLower))
      );

  const displayColumns = selectFields.filter((f) => f !== 'id');
  const columnLabels = {
    campaign_id: 'Campaign ID',
    campaign_name: nameColumnLabel,
    adset_name: 'Adset Name',
    country: 'Country',
    product_type: 'Product Type',
    showname: 'Show Name',
  };

  return (
    <div className="page-section active" id={pageId}>
      <div className="page-content">
        <div className="page-title-bar">
          <h2>{title}</h2>
          <p>{description}</p>
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
          <p className="help-text">No reference data yet.</p>
        ) : (
          <div className="settings-section">
            <div style={{ marginBottom: '1rem' }}>
              <input
                type="search"
                className="search-input"
                placeholder="Search…"
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
                    {displayColumns.map((f) => (
                      <th key={f}>{columnLabels[f] ?? f.replace(/_/g, ' ')}</th>
                    ))}
                    <th style={{ width: 100 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      {displayColumns.map((field) => (
                        <td key={field}>
                          {editableFields.includes(field) ? (
                            <input
                              type="text"
                              value={getCellValue(r, field)}
                              onChange={(e) => setCellEdit(r.id, field, e.target.value)}
                              placeholder={columnLabels[field] ?? field}
                              aria-label={field}
                              style={cellInputStyle}
                            />
                          ) : (
                            (r[field] ?? '—')
                          )}
                        </td>
                      ))}
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
