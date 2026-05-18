import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { supabase, invokeEdgeFunction } from '../lib/supabase.js';
import { getFacebookOAuthRedirectUri, FB_DIALOG_GRAPH_VERSION } from '../lib/facebookOAuth.js';
import { useUserPermissions } from '../hooks/useUserPermissions';
import { DatingAppSubscriptionImportPanel } from '../components/DatingAppSubscriptionImportPanel.jsx';
import { ROLE_IDS } from '../constants/roles.js';

const META_ADMIN_ROLE_IDS = [ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN];

/** Split YYYY-MM-DD range so each Meta sync HTTP request stays under the Edge gateway limit. */
function splitIsoDateRangeIntoChunks(dateFromStr, dateToStr, maxDaysPerChunk) {
  const out = [];
  let start = dateFromStr;
  while (start <= dateToStr) {
    const d0 = new Date(`${start}T12:00:00.000Z`);
    const d1 = new Date(d0);
    d1.setUTCDate(d1.getUTCDate() + maxDaysPerChunk - 1);
    let until = d1.toISOString().slice(0, 10);
    if (until > dateToStr) until = dateToStr;
    out.push({ date_from: start, date_to: until });
    if (until >= dateToStr) break;
    const next = new Date(`${until}T12:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    start = next.toISOString().slice(0, 10);
  }
  return out;
}

const META_EDGE_SYNC_CHUNK_DAYS = 10;

function formatSyncLogStats(platform, meta) {
  if (!meta || typeof meta !== 'object') return '—';
  if (platform === 'google_ads') {
    const c = meta.campaigns ?? meta.campaign;
    const ag = meta.ad_groups;
    const kw = meta.keywords;
    const parts = [];
    if (c != null) parts.push(`${c} campaigns`);
    if (ag != null) parts.push(`${ag} ad groups`);
    if (kw != null) parts.push(`${kw} keywords`);
    return parts.length ? parts.join(', ') : '—';
  }
  if (platform === 'google_ads_country') {
    const c = meta.campaigns ?? meta.campaign;
    const ag = meta.ad_groups;
    const kw = meta.keywords;
    const countries = Array.isArray(meta.countries) && meta.countries.length
      ? ` | ${meta.countries.join(', ')}`
      : '';
    const parts = [];
    if (c != null) parts.push(`${c} campaigns`);
    if (ag != null) parts.push(`${ag} ad groups`);
    if (kw != null) parts.push(`${kw} keywords`);
    return (parts.length ? parts.join(', ') : '—') + countries;
  }
  if (platform === 'reddit_ads') {
    const a = meta.ad_group_rows;
    const p = meta.placement_rows;
    if (a != null || p != null) return `${a ?? 0} ad grp / ${p ?? 0} placement`;
    return '—';
  }
  if (platform === 'reddit_ads_country') {
    const a = meta.ad_group_rows;
    const p = meta.placement_rows;
    const countries = Array.isArray(meta.countries) && meta.countries.length
      ? ` | ${meta.countries.join(', ')}`
      : '';
    if (a != null || p != null) return `${a ?? 0} ad grp / ${p ?? 0} placement${countries}`;
    return '—';
  }
  if (platform === 'facebook_ads') {
    const n = meta.insight_rows;
    return n != null ? `${n} ads` : '—';
  }
  if (platform === 'facebook_ads_country') {
    const n = meta.insight_rows;
    const countries = Array.isArray(meta.countries) && meta.countries.length
      ? ` | ${meta.countries.join(', ')}`
      : '';
    return (n != null ? `${n} ads` : '—') + countries;
  }
  if (platform === 'tiktok_ads') {
    const n = meta.report_rows;
    return n != null ? `${n} rows` : '—';
  }
  if (platform === 'tiktok_ads_country') {
    const n = meta.report_rows;
    const countries = Array.isArray(meta.countries) && meta.countries.length
      ? ` | ${meta.countries.join(', ')}`
      : '';
    return (n != null ? `${n} rows` : '—') + countries;
  }
  if (platform === 'microsoft_ads') {
    const a = meta.ad_group_rows;
    const p = meta.placement_rows;
    if (a != null || p != null) return `${a ?? 0} ad grp / ${p ?? 0} placement`;
    return '—';
  }
  if (platform === 'microsoft_ads_country') {
    const a = meta.ad_group_rows;
    const p = meta.placement_rows;
    const countries = Array.isArray(meta.countries) && meta.countries.length
      ? ` | ${meta.countries.join(', ')}`
      : '';
    if (a != null || p != null) return `${a ?? 0} ad grp / ${p ?? 0} placement${countries}`;
    return '—';
  }
  return '—';
}

function fmtSyncAt(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Group raw ads_sync_by_date_log rows by (run_id, account_id). Each invocation of an
 * upsert edge function writes one row per segment_date sharing the same synced_at,
 * date_range_start/end, and metadata, so the table is much more readable when those
 * rows are collapsed into one expandable parent row.
 */
function groupSyncLogRows(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    const fallback = `${row.synced_at}|${row.date_range_start}|${row.date_range_end}`;
    const key = `${row.run_id ?? fallback}::${row.account_id}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        syncedAt: row.synced_at,
        accountId: row.account_id,
        dateRangeStart: row.date_range_start,
        dateRangeEnd: row.date_range_end,
        metadata: row.metadata,
        segmentDates: [],
      };
      map.set(key, group);
    }
    if (row.segment_date) group.segmentDates.push(row.segment_date);
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.segmentDates.sort();
  groups.sort((a, b) => (a.syncedAt < b.syncedAt ? 1 : a.syncedAt > b.syncedAt ? -1 : 0));
  return groups;
}

/**
 * Shared sync-log table used by every settings panel that surfaces ads_sync_by_date_log.
 * Rows are grouped by sync run so the user sees one summary row per invocation; clicking
 * the row expands it to reveal the individual report dates that were synced.
 */
function SyncLogTable({ rows, loading, error, onRefresh, platform, emptyMessage }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const groups = useMemo(() => groupSyncLogRows(rows), [rows]);

  const toggle = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="wl-sync-log-section">
      <div className="wl-sync-log-header">
        <h3 className="wl-sync-log-title">Sync log</h3>
        <button
          type="button"
          className="wl-btn wl-btn--outline wl-btn--sm"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error && <p className="wl-sync-log-error">{error}</p>}
      {!error && groups.length === 0 && !loading && (
        <p className="wl-settings-desc">{emptyMessage}</p>
      )}
      {(groups.length > 0 || loading) && !error && (
        <div className="wl-table-wrap wl-sync-log-table-wrap">
          <table className="wl-settings-table wl-sync-log-table">
            <thead>
              <tr>
                <th className="wl-sync-log-expand-col" aria-label="Expand" />
                <th>Synced</th>
                <th>Account</th>
                <th>Report dates</th>
                <th>Range synced</th>
                <th>Rows / stats</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const isOpen = expanded.has(group.key);
                const dateCount = group.segmentDates.length;
                const dateSummary = dateCount === 0
                  ? '—'
                  : dateCount === 1
                    ? group.segmentDates[0]
                    : `${group.segmentDates[0]} → ${group.segmentDates[dateCount - 1]} (${dateCount} dates)`;
                return (
                  <Fragment key={group.key}>
                    <tr
                      className="wl-sync-log-group-row"
                      onClick={() => toggle(group.key)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(group.key);
                        }
                      }}
                    >
                      <td className="wl-sync-log-expand-cell">
                        <span className={`wl-sync-log-caret${isOpen ? ' wl-sync-log-caret--open' : ''}`} aria-hidden="true">▶</span>
                      </td>
                      <td className="wl-td-mono">{fmtSyncAt(group.syncedAt)}</td>
                      <td className="wl-td-mono">{group.accountId}</td>
                      <td>{dateSummary}</td>
                      <td className="wl-td-muted">
                        {group.dateRangeStart && group.dateRangeEnd
                          ? `${group.dateRangeStart} → ${group.dateRangeEnd}`
                          : '—'}
                      </td>
                      <td className="wl-td-muted">{formatSyncLogStats(platform, group.metadata)}</td>
                    </tr>
                    {isOpen && group.segmentDates.map((segDate) => (
                      <tr key={`${group.key}::${segDate}`} className="wl-sync-log-child-row">
                        <td />
                        <td />
                        <td />
                        <td>{segDate}</td>
                        <td />
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDurationMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${s}s`;
}

/**
 * Pick out the most useful fields from an edge-function response payload for the
 * given platform. Returns an ordered list of { label, value } pairs that the
 * SyncResultModal renders above the raw JSON dump.
 */
function buildSyncSummaryItems(platform, response) {
  const items = [];
  if (response == null) return items;
  // Meta and any future chunked sync return an array (one entry per chunk).
  const responses = Array.isArray(response) ? response : [response];

  const sumNumber = (key) => {
    let total = 0;
    let found = false;
    for (const r of responses) {
      const v = r?.[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        total += v;
        found = true;
      }
    }
    return found ? total : null;
  };
  const sumNested = (parent, key) => {
    let total = 0;
    let found = false;
    for (const r of responses) {
      const v = r?.[parent]?.[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        total += v;
        found = true;
      }
    }
    return found ? total : null;
  };
  const collectIds = (...keys) => {
    const set = new Set();
    for (const r of responses) {
      for (const k of keys) {
        const v = r?.[k];
        if (Array.isArray(v)) v.forEach((x) => set.add(String(x)));
      }
    }
    return set.size ? Array.from(set).join(', ') : null;
  };
  const push = (label, value) => {
    if (value == null || value === '') return;
    items.push({ label, value });
  };

  if (platform === 'google_ads' || platform === 'google_ads_country') {
    push('Customers synced', sumNumber('customers_synced'));
    push('Customer IDs', collectIds('customer_ids'));
    push('Campaigns', sumNested('upserted', 'campaigns') ?? sumNumber('campaigns'));
    push('Ad groups', sumNested('upserted', 'ad_groups') ?? sumNumber('ad_groups'));
    push('Keywords', sumNested('upserted', 'keywords') ?? sumNumber('keywords'));
    push('Sync history rows', sumNumber('sync_history_rows'));
  } else if (platform === 'reddit_ads' || platform === 'reddit_ads_country') {
    push('Ad group rows', sumNumber('ad_group_rows'));
    push('Placement rows', sumNumber('placement_rows'));
    push('Accounts', collectIds('account_ids'));
  } else if (platform === 'facebook_ads' || platform === 'facebook_ads_country') {
    if (responses.length > 1) push('Chunks processed', responses.length);
    push('Insight rows', sumNumber('insight_rows'));
    push('Accounts', collectIds('account_ids', 'accounts'));
  } else if (platform === 'tiktok_ads' || platform === 'tiktok_ads_country') {
    push('Report rows', sumNumber('report_rows'));
    push('Advertiser IDs', collectIds('advertiser_ids'));
  } else if (platform === 'microsoft_ads' || platform === 'microsoft_ads_country') {
    push('Ad group rows', sumNumber('ad_group_rows'));
    push('Placement rows', sumNumber('placement_rows'));
    push('Accounts', collectIds('account_ids', 'customer_ids'));
  }

  if (items.length === 0) {
    for (const r of responses) {
      if (!r || typeof r !== 'object') continue;
      for (const [k, v] of Object.entries(r)) {
        if (v == null) continue;
        if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
          push(k, String(v));
        }
      }
    }
  }
  return items;
}

function SyncResultModal({ title, platform, result, onClose }) {
  if (!result) return null;
  const { success, dateFrom, dateTo, durationMs, response, error } = result;
  const summary = buildSyncSummaryItems(platform, response);
  let rawJson;
  try {
    rawJson = response === undefined ? '' : JSON.stringify(response, null, 2);
  } catch {
    rawJson = String(response);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card wl-sync-result-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} sync result`}
      >
        <div className="wl-sync-result-modal__header">
          <span className={`wl-sync-result-modal__badge wl-sync-result-modal__badge--${success ? 'success' : 'error'}`}>
            {success ? 'Success' : 'Failed'}
          </span>
          <h3 className="wl-sync-result-modal__title">{title} sync</h3>
        </div>

        <div className="wl-sync-result-modal__meta">
          <div>
            <span className="wl-sync-result-modal__meta-label">Range</span>
            <span className="wl-sync-result-modal__meta-value">{dateFrom} → {dateTo}</span>
          </div>
          <div>
            <span className="wl-sync-result-modal__meta-label">Duration</span>
            <span className="wl-sync-result-modal__meta-value">{formatDurationMs(durationMs)}</span>
          </div>
        </div>

        {!success && error && (
          <p className="wl-sync-result-modal__error">{error}</p>
        )}

        {summary.length > 0 && (
          <dl className="wl-sync-result-modal__summary">
            {summary.map((item) => (
              <div key={item.label} className="wl-sync-result-modal__summary-row">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {rawJson && (
          <details className="wl-sync-result-modal__raw">
            <summary>Raw response</summary>
            <pre>{rawJson}</pre>
          </details>
        )}

        <div className="modal-actions wl-sync-result-modal__actions">
          <button type="button" className="btn-close-modal" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const SETTINGS_NAV_BASE = [
  { id: 'google-ads', label: 'Google Ads' },
  // { id: 'google-ads-country', label: 'Google Ads Country' },
  { id: 'reddit', label: 'Reddit Ads' },
  // { id: 'reddit-country', label: 'Reddit Ads Country' },
  { id: 'meta', label: 'Facebook / Meta Ads' },
  // { id: 'meta-country', label: 'Facebook Ads Country' },
  { id: 'tiktok', label: 'TikTok Ads' },
  // { id: 'tiktok-country', label: 'TikTok Ads Country' },
  { id: 'bing', label: 'Bing / Microsoft Ads' },
  // { id: 'bing-country', label: 'Bing Ads Country' },
  { id: 'dating-app-data', label: 'Dating app data' },
  { id: 'branding', label: 'White Label & Branding' },
];

const META_TOKEN_DOCS_URL =
  'https://developers.facebook.com/docs/facebook-login/guides/access-tokens#getting-long-lived-user-access-tokens';

function MetaFacebookConnectPanel({ showNotification, canAdminMeta, permissionsLoading }) {
  const [metaConnected, setMetaConnected] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [showAppCredentials, setShowAppCredentials] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [metaAppId, setMetaAppId] = useState('');
  const [metaAppSecret, setMetaAppSecret] = useState('');
  const [hasAppSecret, setHasAppSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingApp, setSavingApp] = useState(false);

  const oauthRedirectDisplay = getFacebookOAuthRedirectUri();

  const loadMetaStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction('save-facebook-meta-token', {}, { method: 'GET' });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.message || String(data.error));
      setMetaConnected(!!data?.connected);
      setMetaAppId(typeof data?.fb_app_id === 'string' ? data.fb_app_id : '');
      setHasAppSecret(!!data?.has_app_secret);
    } catch {
      setMetaConnected(false);
      setMetaAppId('');
      setHasAppSecret(false);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMetaStatus();
  }, [loadMetaStatus]);

  const handleSaveToken = async () => {
    const t = tokenInput.trim();
    if (t.length < 20) {
      showNotification('Paste a valid Meta access token (at least 20 characters).');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await invokeEdgeFunction('save-facebook-meta-token', {
        access_token: t,
      });
      if (error) throw new Error(error.message || 'Request failed');
      if (data?.error) throw new Error(data.message || String(data.error));
      showNotification(typeof data?.message === 'string' ? data.message : 'Meta access token saved.');
      setTokenInput('');
      setShowTokenForm(false);
      loadMetaStatus();
    } catch (e) {
      showNotification(e?.message || String(e) || 'Could not save token.');
    } finally {
      setSaving(false);
    }
  };

  const startFacebookOAuth = () => {
    if (!canAdminMeta) {
      showNotification('Only Super Admin or Admin can connect Meta.');
      return;
    }
    const appId = metaAppId.trim();
    if (!appId) {
      showNotification('Save Meta App ID first (Set app ID & secret), then use Connect.');
      setShowAppCredentials(true);
      return;
    }
    const state = crypto.randomUUID();
    sessionStorage.setItem('fb_oauth_state', state);
    const redirectUri = getFacebookOAuthRedirectUri();
    const scope = encodeURIComponent('ads_read');
    const authUrl =
      `https://www.facebook.com/${FB_DIALOG_GRAPH_VERSION}/dialog/oauth` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      '&response_type=code' +
      `&scope=${scope}`;
    window.location.assign(authUrl);
  };

  const handleSaveAppCredentials = async () => {
    const id = metaAppId.trim();
    const secret = metaAppSecret.trim();
    if (!id && !secret) {
      showNotification('Enter Meta App ID and/or a new App Secret to save.');
      return;
    }
    setSavingApp(true);
    try {
      const payload = { fb_app_id: id };
      if (secret) payload.fb_app_secret = secret;
      const { data, error } = await invokeEdgeFunction('save-facebook-meta-token', payload);
      if (error) throw new Error(error.message || 'Request failed');
      if (data?.error) throw new Error(data.message || String(data.error));
      showNotification(typeof data?.message === 'string' ? data.message : 'Meta app credentials saved.');
      setMetaAppSecret('');
      setShowAppCredentials(false);
      loadMetaStatus();
    } catch (e) {
      showNotification(e?.message || String(e) || 'Could not save app credentials.');
    } finally {
      setSavingApp(false);
    }
  };

  return (
    <>
      {/* <div className="wl-settings-status-row wl-settings-status-row--bar">
        <span className="wl-settings-status-label">Facebook / Meta Ads</span>
        <span
          className={`wl-badge ${metaConnected ? 'wl-badge--connected' : 'wl-badge--pending'}`}
          aria-live="polite"
        >
          {statusLoading ? 'Checking…' : metaConnected ? 'Connected' : 'Not connected'}
        </span>
        <span className="wl-meta-connect-spacer" aria-hidden="true" />
        <button
          type="button"
          className="wl-btn wl-btn--primary"
          onClick={startFacebookOAuth}
          disabled={statusLoading || permissionsLoading || !canAdminMeta}
          title={!canAdminMeta ? 'Only Super Admin or Admin can connect Meta.' : undefined}
        >
          {metaConnected ? 'Reconnect Facebook / Meta' : 'Connect Facebook / Meta'}
        </button>
         <button
          type="button"
          className="wl-btn wl-btn--outline"
          onClick={() => setShowAppCredentials((v) => !v)}
          disabled={statusLoading}
        >
          {showAppCredentials ? 'Hide app ID & secret' : 'Set app ID & secret'}
        </button> 
      </div>
       <p className="wl-settings-desc wl-settings-desc--below-bar">
        <strong>Connect</strong> signs in with Facebook and saves a long-lived token for sync. In the Meta developer app,
        add this exact redirect URI under Facebook Login → Settings → <strong>Valid OAuth Redirect URIs</strong>:{' '}
        <span className="wl-td-mono">{oauthRedirectDisplay || 'https://your-domain.com/'}</span>{' '}
        (include the trailing slash if your site uses it). App ID and secret are read from saved settings before Edge
        secrets. See also the{' '}
        <a href={META_TOKEN_DOCS_URL} target="_blank" rel="noopener noreferrer">
          Meta token guide
        </a>
        .
      </p> 
      <p className="wl-settings-desc" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="wl-btn wl-btn--outline wl-btn--sm"
          onClick={() => setShowTokenForm((v) => !v)}
          disabled={statusLoading}
        >
          {showTokenForm ? 'Hide manual token' : 'Paste access token instead'}
        </button>
      </p> */}
      {showAppCredentials && (
        <div className="wl-form-row" style={{ marginTop: 16, maxWidth: 560 }}>
          <label htmlFor="wl-meta-app-id">Meta App ID</label>
          <input
            id="wl-meta-app-id"
            type="text"
            autoComplete="off"
            placeholder="e.g. 1234567890123456"
            value={metaAppId}
            onChange={(e) => setMetaAppId(e.target.value)}
            disabled={statusLoading || savingApp}
          />
          <label htmlFor="wl-meta-app-secret" style={{ marginTop: 12 }}>
            Meta App Secret
          </label>
          <input
            id="wl-meta-app-secret"
            type="password"
            autoComplete="new-password"
            placeholder={hasAppSecret ? 'Leave blank to keep current secret; enter new value to replace' : 'App secret from Meta developer dashboard'}
            value={metaAppSecret}
            onChange={(e) => setMetaAppSecret(e.target.value)}
            disabled={statusLoading || savingApp}
          />
          <span className="wl-form-hint">Super Admin or Admin only.</span>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="wl-btn wl-btn--primary" onClick={handleSaveAppCredentials} disabled={savingApp || statusLoading}>
              {savingApp ? 'Saving…' : 'Save app ID & secret'}
            </button>
          </div>
        </div>
      )}
      {showTokenForm && (
        <div className="wl-form-row" style={{ marginTop: 16, maxWidth: 560 }}>
          <label htmlFor="wl-meta-access-token">Access token</label>
          <input
            id="wl-meta-access-token"
            type="password"
            autoComplete="off"
            placeholder="Paste long-lived user or system user token (ads_read)"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <span className="wl-form-hint">Super Admin or Admin only. Sync prefers this token over the FB_ACCESS_TOKEN Edge secret.</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
            <button type="button" className="wl-btn wl-btn--primary" onClick={handleSaveToken} disabled={saving}>
              {saving ? 'Saving…' : 'Save access token'}
            </button>
            <button type="button" className="wl-btn wl-btn--outline" onClick={() => { setShowTokenForm(false); setTokenInput(''); }} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Same UX for Google, Reddit, Meta, TikTok, Microsoft: Connect → date range + Sync; optional ads_sync_by_date_log table */
function AdsPlatformPanel({ showNotification, title, connectDescription, onSync, syncLogPlatform, connectionSlot = null }) {
  const [connected, setConnected] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [logRows, setLogRows] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  const loadSyncLog = useCallback(async () => {
    if (!syncLogPlatform) return;
    setLogLoading(true);
    setLogError(null);
    const { data, error } = await supabase
      .from('ads_sync_by_date_log')
      .select('account_id, segment_date, synced_at, date_range_start, date_range_end, run_id, metadata')
      .eq('platform', syncLogPlatform)
      .order('synced_at', { ascending: false })
      .limit(120);
    setLogLoading(false);
    if (error) {
      setLogError(error.message || 'Could not load sync log.');
      setLogRows([]);
      return;
    }
    setLogRows(data ?? []);
  }, [syncLogPlatform]);

  useEffect(() => {
    loadSyncLog();
  }, [loadSyncLog]);

  const handleSync = async () => {
    if (!startDate || !endDate) {
      showNotification('Select a start and end date.');
      return;
    }
    if (startDate > endDate) {
      showNotification('End date must be on or after start date.');
      return;
    }
    if (onSync) {
      setSyncing(true);
      const startedAt = Date.now();
      try {
        const response = await onSync(startDate, endDate);
        const durationMs = Date.now() - startedAt;
        showNotification(`${title} sync completed.`);
        setSyncResult({ success: true, dateFrom: startDate, dateTo: endDate, durationMs, response });
        loadSyncLog();
      } catch (e) {
        const durationMs = Date.now() - startedAt;
        const message = e?.message || String(e) || 'Sync failed.';
        showNotification(message);
        setSyncResult({ success: false, dateFrom: startDate, dateTo: endDate, durationMs, response: e?.cause ?? null, error: message });
      } finally {
        setSyncing(false);
      }
      return;
    }
    showNotification(`${title} sync queued for ${startDate} → ${endDate}.`);
  };

  if (!connected) {
    return (
      <div className="wl-settings-card">
        <h2 className="wl-settings-subtitle">{title}</h2>
        <p className="wl-settings-desc" style={{ marginTop: 8 }}>{connectDescription}</p>
        <button type="button" className="wl-btn wl-btn--blue wl-btn--sm" style={{ marginTop: 16 }} onClick={() => setConnected(true)}>
          Connect
        </button>
      </div>
    );
  }

  return (
    <div className="wl-settings-card">
      <h2 className="wl-settings-subtitle">{title}</h2>
      {connectionSlot}
      <p className="wl-settings-desc" style={{ marginTop: connectionSlot ? 16 : 8 }}>
        Choose a date range and run a sync for your linked accounts.
      </p>
      <div className="wl-ads-date-sync">
        <div className="wl-date-range-inputs wl-date-range-inputs--lg">
          <input
            type="date"
            className="wl-input-date"
            aria-label="Start date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span className="wl-date-to">to</span>
          <input
            type="date"
            className="wl-input-date"
            aria-label="End date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <button type="button" className="wl-btn wl-btn--primary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      {syncLogPlatform && (
        <SyncLogTable
          rows={logRows}
          loading={logLoading}
          error={logError}
          onRefresh={loadSyncLog}
          platform={syncLogPlatform}
          emptyMessage="No sync runs logged yet. Run a sync above — logs appear after a successful upsert."
        />
      )}

      <SyncResultModal
        title={title}
        platform={syncLogPlatform}
        result={syncResult}
        onClose={() => setSyncResult(null)}
      />
    </div>
  );
}

function GoogleAdsCountryPanel({ showNotification }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [logRows, setLogRows] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  const loadSyncLog = useCallback(async () => {
    setLogLoading(true);
    setLogError(null);
    const { data, error } = await supabase
      .from('ads_sync_by_date_log')
      .select('account_id, segment_date, synced_at, date_range_start, date_range_end, run_id, metadata')
      .eq('platform', 'google_ads_country')
      .order('synced_at', { ascending: false })
      .limit(120);
    setLogLoading(false);
    if (error) {
      setLogError(error.message || 'Could not load country sync log.');
      setLogRows([]);
      return;
    }
    setLogRows(data ?? []);
  }, []);

  useEffect(() => {
    loadSyncLog();
  }, [loadSyncLog]);

  const handleSync = async () => {
    if (!startDate || !endDate) {
      showNotification('Select a start and end date.');
      return;
    }
    if (startDate > endDate) {
      showNotification('End date must be on or after start date.');
      return;
    }
    setSyncing(true);
    const startedAt = Date.now();
    try {
      const { data, error } = await invokeEdgeFunction('sync-google-ads-data-country', {
        date_from: startDate,
        date_to: endDate,
      });
      if (error) throw new Error(error.message || 'Edge function error');
      if (data?.error) throw new Error(data.message || data.error);
      const durationMs = Date.now() - startedAt;
      showNotification('Google Ads country sync completed.');
      setSyncResult({ success: true, dateFrom: startDate, dateTo: endDate, durationMs, response: data });
      loadSyncLog();
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      const message = e?.message || String(e) || 'Country sync failed.';
      showNotification(message);
      setSyncResult({ success: false, dateFrom: startDate, dateTo: endDate, durationMs, response: null, error: message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="wl-settings-card">
      <h2 className="wl-settings-subtitle">Google Ads Country</h2>
      <p className="wl-settings-desc" style={{ marginTop: 8 }}>
        Sync Google Ads data with country from campaign API and review latest rows by account, country, and report date.
      </p>
      <div className="wl-ads-date-sync">
        <div className="wl-date-range-inputs wl-date-range-inputs--lg">
          <input type="date" className="wl-input-date" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span className="wl-date-to">to</span>
          <input type="date" className="wl-input-date" aria-label="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button type="button" className="wl-btn wl-btn--primary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'SyncingΓÇª' : 'Sync'}
        </button>
      </div>

      <SyncLogTable
        rows={logRows}
        loading={logLoading}
        error={logError}
        onRefresh={loadSyncLog}
        platform="google_ads_country"
        emptyMessage="No country sync rows yet. Run a sync above."
      />

      <SyncResultModal
        title="Google Ads Country"
        platform="google_ads_country"
        result={syncResult}
        onClose={() => setSyncResult(null)}
      />
    </div>
  );
}

function MetaAdsCountryPanel({ showNotification }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [logRows, setLogRows] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  const loadSyncLog = useCallback(async () => {
    setLogLoading(true);
    setLogError(null);
    const { data, error } = await supabase
      .from('ads_sync_by_date_log')
      .select('account_id, segment_date, synced_at, date_range_start, date_range_end, run_id, metadata')
      .eq('platform', 'facebook_ads_country')
      .order('synced_at', { ascending: false })
      .limit(120);
    setLogLoading(false);
    if (error) {
      setLogError(error.message || 'Could not load Facebook country sync log.');
      setLogRows([]);
      return;
    }
    setLogRows(data ?? []);
  }, []);

  useEffect(() => {
    loadSyncLog();
  }, [loadSyncLog]);

  const handleSync = async () => {
    if (!startDate || !endDate) {
      showNotification('Select a start and end date.');
      return;
    }
    if (startDate > endDate) {
      showNotification('End date must be on or after start date.');
      return;
    }
    setSyncing(true);
    const startedAt = Date.now();
    try {
      const { data, error } = await invokeEdgeFunction('fetch-facebook-campaigns-upsert-country', {
        date_from: startDate,
        date_to: endDate,
      });
      if (error) throw new Error(error.message || 'Edge function error');
      if (data?.error) throw new Error(data.message || data.error);
      const durationMs = Date.now() - startedAt;
      showNotification('Facebook Ads country sync completed.');
      setSyncResult({ success: true, dateFrom: startDate, dateTo: endDate, durationMs, response: data });
      loadSyncLog();
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      const message = e?.message || String(e) || 'Country sync failed.';
      showNotification(message);
      setSyncResult({ success: false, dateFrom: startDate, dateTo: endDate, durationMs, response: null, error: message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="wl-settings-card">
      <h2 className="wl-settings-subtitle">Facebook Ads Country</h2>
      <p className="wl-settings-desc" style={{ marginTop: 8 }}>
        Sync Facebook Ads data with country breakdown into a separate country table.
      </p>
      <div className="wl-ads-date-sync">
        <div className="wl-date-range-inputs wl-date-range-inputs--lg">
          <input type="date" className="wl-input-date" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span className="wl-date-to">to</span>
          <input type="date" className="wl-input-date" aria-label="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button type="button" className="wl-btn wl-btn--primary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'SyncingΓÇª' : 'Sync'}
        </button>
      </div>

      <SyncLogTable
        rows={logRows}
        loading={logLoading}
        error={logError}
        onRefresh={loadSyncLog}
        platform="facebook_ads_country"
        emptyMessage="No Facebook country sync rows yet. Run a sync above."
      />

      <SyncResultModal
        title="Facebook Ads Country"
        platform="facebook_ads_country"
        result={syncResult}
        onClose={() => setSyncResult(null)}
      />
    </div>
  );
}

function RedditAdsCountryPanel({ showNotification }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [logRows, setLogRows] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  const loadSyncLog = useCallback(async () => {
    setLogLoading(true);
    setLogError(null);
    const { data, error } = await supabase
      .from('ads_sync_by_date_log')
      .select('account_id, segment_date, synced_at, date_range_start, date_range_end, run_id, metadata')
      .eq('platform', 'reddit_ads_country')
      .order('synced_at', { ascending: false })
      .limit(120);
    setLogLoading(false);
    if (error) {
      setLogError(error.message || 'Could not load Reddit country sync log.');
      setLogRows([]);
      return;
    }
    setLogRows(data ?? []);
  }, []);

  useEffect(() => {
    loadSyncLog();
  }, [loadSyncLog]);

  const handleSync = async () => {
    if (!startDate || !endDate) {
      showNotification('Select a start and end date.');
      return;
    }
    if (startDate > endDate) {
      showNotification('End date must be on or after start date.');
      return;
    }
    setSyncing(true);
    const startedAt = Date.now();
    try {
      const { data, error } = await invokeEdgeFunction('fetch-reddit-campaigns-upsert-country', {
        date_from: startDate,
        date_to: endDate,
      });
      if (error) throw new Error(error.message || 'Edge function error');
      if (data?.error) throw new Error(data.message || data.error);
      const durationMs = Date.now() - startedAt;
      showNotification('Reddit Ads country sync completed.');
      setSyncResult({ success: true, dateFrom: startDate, dateTo: endDate, durationMs, response: data });
      loadSyncLog();
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      const message = e?.message || String(e) || 'Country sync failed.';
      showNotification(message);
      setSyncResult({ success: false, dateFrom: startDate, dateTo: endDate, durationMs, response: null, error: message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="wl-settings-card">
      <h2 className="wl-settings-subtitle">Reddit Ads Country</h2>
      <p className="wl-settings-desc" style={{ marginTop: 8 }}>
        Sync Reddit Ads data with country breakdown into a separate country table without affecting the existing Reddit sync.
      </p>
      <div className="wl-ads-date-sync">
        <div className="wl-date-range-inputs wl-date-range-inputs--lg">
          <input type="date" className="wl-input-date" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span className="wl-date-to">to</span>
          <input type="date" className="wl-input-date" aria-label="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button type="button" className="wl-btn wl-btn--primary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'SyncingΓÇª' : 'Sync'}
        </button>
      </div>

      <SyncLogTable
        rows={logRows}
        loading={logLoading}
        error={logError}
        onRefresh={loadSyncLog}
        platform="reddit_ads_country"
        emptyMessage="No Reddit country sync rows yet. Run a sync above."
      />

      <SyncResultModal
        title="Reddit Ads Country"
        platform="reddit_ads_country"
        result={syncResult}
        onClose={() => setSyncResult(null)}
      />
    </div>
  );
}

function TikTokAdsCountryPanel({ showNotification }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [logRows, setLogRows] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  const loadSyncLog = useCallback(async () => {
    setLogLoading(true);
    setLogError(null);
    const { data, error } = await supabase
      .from('ads_sync_by_date_log')
      .select('account_id, segment_date, synced_at, date_range_start, date_range_end, run_id, metadata')
      .eq('platform', 'tiktok_ads_country')
      .order('synced_at', { ascending: false })
      .limit(120);
    setLogLoading(false);
    if (error) {
      setLogError(error.message || 'Could not load TikTok country sync log.');
      setLogRows([]);
      return;
    }
    setLogRows(data ?? []);
  }, []);

  useEffect(() => {
    loadSyncLog();
  }, [loadSyncLog]);

  const handleSync = async () => {
    if (!startDate || !endDate) {
      showNotification('Select a start and end date.');
      return;
    }
    if (startDate > endDate) {
      showNotification('End date must be on or after start date.');
      return;
    }
    setSyncing(true);
    const startedAt = Date.now();
    try {
      const { data, error } = await invokeEdgeFunction('fetch-tiktok-campaigns-upsert-country', {
        date_from: startDate,
        date_to: endDate,
      });
      if (error) throw new Error(error.message || 'Edge function error');
      if (data?.error) throw new Error(data.message || data.error);
      const durationMs = Date.now() - startedAt;
      showNotification('TikTok Ads country sync completed.');
      setSyncResult({ success: true, dateFrom: startDate, dateTo: endDate, durationMs, response: data });
      loadSyncLog();
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      const message = e?.message || String(e) || 'Country sync failed.';
      showNotification(message);
      setSyncResult({ success: false, dateFrom: startDate, dateTo: endDate, durationMs, response: null, error: message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="wl-settings-card">
      <h2 className="wl-settings-subtitle">TikTok Ads Country</h2>
      <p className="wl-settings-desc" style={{ marginTop: 8 }}>
        Sync TikTok Ads data with country breakdown into a separate country table without affecting the existing TikTok sync.
      </p>
      <div className="wl-ads-date-sync">
        <div className="wl-date-range-inputs wl-date-range-inputs--lg">
          <input type="date" className="wl-input-date" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span className="wl-date-to">to</span>
          <input type="date" className="wl-input-date" aria-label="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button type="button" className="wl-btn wl-btn--primary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'SyncingΓÇª' : 'Sync'}
        </button>
      </div>

      <SyncLogTable
        rows={logRows}
        loading={logLoading}
        error={logError}
        onRefresh={loadSyncLog}
        platform="tiktok_ads_country"
        emptyMessage="No TikTok country sync rows yet. Run a sync above."
      />

      <SyncResultModal
        title="TikTok Ads Country"
        platform="tiktok_ads_country"
        result={syncResult}
        onClose={() => setSyncResult(null)}
      />
    </div>
  );
}

function BrandingPanel({ branding, updateBranding, colors, updateColors, resetSettings, showNotification }) {
  const [agencyName, setAgencyName] = useState(branding.agencyName);
  const [agencyLogo, setAgencyLogo] = useState(branding.agencyLogo);
  const [primary, setPrimary] = useState(colors.primary);
  const [accent, setAccent] = useState(colors.accent);
  const [warning, setWarning] = useState(colors.warning);
  const [danger, setDanger] = useState(colors.danger);

  return (
    <div className="wl-settings-card">
      <h1 className="wl-settings-card-title">White Label &amp; Branding</h1>
      <p className="wl-settings-desc">Customize your agency dashboard branding.</p>

      <div className="wl-branding-sections">
        <section className="wl-branding-block">
          <h3 className="wl-branding-h3">Agency branding</h3>
          <div className="wl-form-row">
            <label htmlFor="wl-agency-name">Agency name</label>
            <input
              id="wl-agency-name"
              type="text"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              onBlur={() => updateBranding(agencyName, agencyLogo)}
            />
            <span className="wl-form-hint">Shown in the sidebar and reports</span>
          </div>
          <div className="wl-form-row">
            <label htmlFor="wl-agency-logo">Agency logo text</label>
            <input
              id="wl-agency-logo"
              type="text"
              value={agencyLogo}
              maxLength={2}
              onChange={(e) => setAgencyLogo(e.target.value)}
              onBlur={() => updateBranding(agencyName, agencyLogo)}
            />
            <span className="wl-form-hint">1–2 characters for the logo badge</span>
          </div>
        </section>

        <section className="wl-branding-block">
          <h3 className="wl-branding-h3">Color scheme</h3>
          <div className="color-swatches">
            <div className="color-swatch">
              <input type="color" value={primary} onChange={(e) => { setPrimary(e.target.value); updateColors(e.target.value, null, null, null); }} />
              <span>Primary</span>
            </div>
            <div className="color-swatch">
              <input type="color" value={accent} onChange={(e) => { setAccent(e.target.value); updateColors(null, e.target.value, null, null); }} />
              <span>Accent</span>
            </div>
            <div className="color-swatch">
              <input type="color" value={warning} onChange={(e) => { setWarning(e.target.value); updateColors(null, null, e.target.value, null); }} />
              <span>Warning</span>
            </div>
            <div className="color-swatch">
              <input type="color" value={danger} onChange={(e) => { setDanger(e.target.value); updateColors(null, null, null, e.target.value); }} />
              <span>Danger</span>
            </div>
          </div>
        </section>

        <section className="wl-branding-block">
          <h3 className="wl-branding-h3">Report defaults</h3>
          <div className="wl-form-row wl-form-row--inline">
            <div>
              <label>Default date range</label>
              <select defaultValue="30" className="wl-select">
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="ytd">Year to date</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label>Currency</label>
              <select defaultValue="USD" className="wl-select">
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CAD">CAD ($)</option>
              </select>
            </div>
          </div>
        </section>
      </div>

      <div className="wl-branding-actions">
        <button type="button" className="wl-btn wl-btn--primary" onClick={() => showNotification('Settings saved successfully!')}>
          Save settings
        </button>
        <button type="button" className="wl-btn wl-btn--outline" onClick={resetSettings}>
          Reset to default
        </button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const { branding, updateBranding, colors, updateColors, resetSettings, showNotification } = useApp();
  const { role, roleId, loading: permissionsLoading, canAccessSidebar } = useUserPermissions();
  const [profile, setProfile] = useState(null);
  const [activeNav, setActiveNav] = useState('google-ads');

  const settingsNavItems = useMemo(() => {
    const showDating = canAccessSidebar('subscriptions-dating-apps');
    return SETTINGS_NAV_BASE.filter((item) => item.id !== 'dating-app-data' || showDating);
  }, [canAccessSidebar]);

  const canAdminMeta =
    role === 'super_admin' ||
    role === 'admin' ||
    (roleId != null && META_ADMIN_ROLE_IDS.includes(roleId));

  useEffect(() => {
    const pending = sessionStorage.getItem('wow_settings_nav_after_oauth');
    if (pending === 'meta') {
      sessionStorage.removeItem('wow_settings_nav_after_oauth');
      setActiveNav('meta');
    }
  }, []);

  useEffect(() => {
    if (location.state?.openMetaOAuth) {
      setActiveNav('meta');
      navigate('.', { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  useEffect(() => {
    const nav = location.state?.settingsNav;
    if (!nav || permissionsLoading) return;
    const allowed = SETTINGS_NAV_BASE.some((item) => item.id === nav);
    if (allowed) setActiveNav(nav);
    navigate('.', { replace: true, state: {} });
  }, [location.state, navigate, permissionsLoading]);

  useEffect(() => {
    if (!location.state?.openDatingAppImport || permissionsLoading) return;
    if (canAccessSidebar('subscriptions-dating-apps')) {
      setActiveNav('dating-app-data');
    }
    navigate('.', { replace: true, state: {} });
  }, [location.state, navigate, canAccessSidebar, permissionsLoading]);

  useEffect(() => {
    if (activeNav === 'dating-app-data' && !canAccessSidebar('subscriptions-dating-apps')) {
      setActiveNav('google-ads');
    }
  }, [activeNav, canAccessSidebar]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!cancelled && !error) setProfile(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const displayName =
    profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';

  return (
    <div className="page-section active wl-settings-page" id="page-settings">
      <div className="wl-settings-root">
        <header className="wl-settings-topbar">
          <div className="wl-settings-topbar-left">
            <button type="button" className="wl-back-btn" onClick={() => navigate('/')} aria-label="Back to dashboard">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 className="wl-settings-page-title">White-Label Settings</h1>
          </div>
          <div className="wl-settings-topbar-right">
            <span className="wl-settings-user-name">{displayName}</span>
            <button type="button" className="wl-btn wl-btn--outline wl-btn--sm" onClick={() => logout()}>
              Log out
            </button>
          </div>
        </header>

        <div className="wl-settings-body">
          <aside className="wl-settings-sidebar">
            <div className="wl-settings-nav-label">Settings</div>
            <nav className="wl-settings-nav" aria-label="Settings sections">
              {settingsNavItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`wl-settings-nav-item ${activeNav === item.id ? 'wl-settings-nav-item--active' : ''}`}
                  onClick={() => setActiveNav(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <button type="button" className="wl-settings-signout" onClick={() => logout()}>
              Sign out
            </button>
          </aside>

          <div className="wl-settings-main">
            {activeNav === 'google-ads' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="Google Ads"
                connectDescription="Connect your Google Ads manager account to sync campaigns and metrics."
                syncLogPlatform="google_ads"
                onSync={async (dateFrom, dateTo) => {
                  const { data, error } = await invokeEdgeFunction('sync-google-ads-upsert', {
                    date_from: dateFrom,
                    date_to: dateTo,
                  });
                  if (error) throw new Error(error.message || 'Edge function error');
                  if (data?.error) throw new Error(data.message || data.error);
                  return data;
                }}
              />
            )}
            {activeNav === 'google-ads-country' && (
              <GoogleAdsCountryPanel showNotification={showNotification} />
            )}
            {activeNav === 'reddit' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="Reddit Ads"
                connectDescription="Connect your Reddit Ads account to pull spend and conversion data into reports."
                syncLogPlatform="reddit_ads"
                onSync={async (dateFrom, dateTo) => {
                  const { data, error } = await invokeEdgeFunction('fetch-reddit-campaigns-upsert', {
                    date_from: dateFrom,
                    date_to: dateTo,
                  });
                  if (error) throw new Error(error.message || 'Edge function error');
                  if (data?.error) throw new Error(data.message || data.error);
                  return data;
                }}
              />
            )}
            {activeNav === 'reddit-country' && (
              <RedditAdsCountryPanel showNotification={showNotification} />
            )}
            {activeNav === 'meta' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="Facebook / Meta Ads"
                connectDescription="Link Meta Business Manager to sync campaign performance across your client accounts."
                connectionSlot={
                  <MetaFacebookConnectPanel
                    showNotification={showNotification}
                    canAdminMeta={canAdminMeta}
                    permissionsLoading={permissionsLoading}
                  />
                }
                syncLogPlatform="facebook_ads"
                onSync={async (dateFrom, dateTo) => {
                  const ranges = splitIsoDateRangeIntoChunks(dateFrom, dateTo, META_EDGE_SYNC_CHUNK_DAYS);
                  const chunkResults = [];
                  for (const range of ranges) {
                    const { data, error } = await invokeEdgeFunction('fetch-facebook-campaigns-upsert', range);
                    if (error) throw new Error(error.message || 'Edge function error');
                    if (data?.error) throw new Error(data.message || data.error);
                    chunkResults.push({ ...range, ...(data ?? {}) });
                  }
                  return chunkResults;
                }}
              />
            )}
            {activeNav === 'meta-country' && (
              <MetaAdsCountryPanel showNotification={showNotification} />
            )}
            {activeNav === 'tiktok' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="TikTok Ads"
                connectDescription="Connect your TikTok For Business advertiser account to sync campaigns and performance into reports."
                syncLogPlatform="tiktok_ads"
                onSync={async (dateFrom, dateTo) => {
                  const { data, error } = await invokeEdgeFunction('fetch-tiktok-campaigns-upsert', {
                    date_from: dateFrom,
                    date_to: dateTo,
                  });
                  if (error) throw new Error(error.message || 'Edge function error');
                  if (data?.error) throw new Error(data.message || data.error);
                  return data;
                }}
              />
            )}
            {activeNav === 'tiktok-country' && (
              <TikTokAdsCountryPanel showNotification={showNotification} />
            )}
            {activeNav === 'bing' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="Bing / Microsoft Ads"
                connectDescription="Connect your Microsoft Advertising account to sync campaigns, placements, and metrics into reports."
                syncLogPlatform="microsoft_ads"
                onSync={async (dateFrom, dateTo) => {
                  const { data, error } = await invokeEdgeFunction('sync-microsoft-ads', {
                    date_from: dateFrom,
                    date_to: dateTo,
                  });
                  if (error) throw new Error(error.message || 'Edge function error');
                  if (data?.error) throw new Error(data.message || data.error);
                  return data;
                }}
              />
            )}
            {activeNav === 'bing-country' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="Bing Ads Country"
                connectDescription="Sync Microsoft Advertising data with country breakdown into dedicated country tables."
                syncLogPlatform="microsoft_ads_country"
                onSync={async (dateFrom, dateTo) => {
                  const { data, error } = await invokeEdgeFunction('sync-microsoft-ads-country', {
                    date_from: dateFrom,
                    date_to: dateTo,
                  });
                  if (error) throw new Error(error.message || 'Edge function error');
                  if (data?.error) throw new Error(data.message || data.error);
                  return data;
                }}
              />
            )}
            {activeNav === 'dating-app-data' && canAccessSidebar('subscriptions-dating-apps') && (
              <DatingAppSubscriptionImportPanel showNotification={showNotification} />
            )}
            {activeNav === 'branding' && (
              <BrandingPanel
                branding={branding}
                updateBranding={updateBranding}
                colors={colors}
                updateColors={updateColors}
                resetSettings={resetSettings}
                showNotification={showNotification}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
