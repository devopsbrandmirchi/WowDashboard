import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { ROLES, ALL_PERMISSION_KEYS, ROLE_IDS } from '../constants/roles.js';
import { useUserPermissions } from '../hooks/useUserPermissions.js';

/** Turn permission key into a short friendly label (e.g. report:google-ads:campaigns → Campaigns) */
function permissionKeyToLabel(key) {
  const part = key.split(':').pop() || key;
  const special = {
    campaigntypes: 'Campaign types',
    adgroups: 'Ad groups',
    searchterms: 'Search terms',
    adsets: 'Ad sets',
    platformdevice: 'Platform device',
    'combined-reporting': 'Combined reporting',
    'roles-permissions': 'Roles & permissions',
    'subscriptions-analytics': 'Subscription analytics',
    'subscriptions-subscribers': 'Subscriber intelligence',
    'admin:manage_roles': 'Manage roles',
    'admin:manage_users': 'Manage users',
    // Table columns (report toggle columns)
    'column:type': 'Campaign Type',
    'column:campaign_count': '# Campaigns',
    'column:impressions': 'Impr.',
    'column:clicks': 'Clicks',
    'column:ctr': 'CTR',
    'column:cpc': 'Avg CPC',
    'column:cost': 'Cost',
    'column:conversions': 'Conv.',
    'column:conv_rate': 'Conv. Rate',
    'column:cpa': 'CPA',
    'column:spend_pct': '% Spend',
  };
  if (special[key]) return special[key];
  if (special[part]) return special[part];
  return part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ');
}

export function RolesPermissionsPage() {
  const { canEditRolesPermissions, loading: permissionsLoading } = useUserPermissions();
  const [selectedRoleId, setSelectedRoleId] = useState(ROLE_IDS.ADMIN);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [allRolePermissions, setAllRolePermissions] = useState(null);
  const [loadingAll, setLoadingAll] = useState(false);

  const loadPermissions = useCallback(async (roleId) => {
    if (!roleId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('get_role_permissions', { p_role_id: roleId });
    setLoading(false);
    if (err) {
      setError(err.message);
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => {
    loadPermissions(selectedRoleId);
  }, [selectedRoleId, loadPermissions]);

  const loadAllRolesPermissions = useCallback(async () => {
    setLoadingAll(true);
    setError(null);
    const map = {};
    for (const r of ROLES) {
      const { data, error: err } = await supabase.rpc('get_role_permissions', { p_role_id: r.id });
      if (err) {
        setError(err.message);
        setLoadingAll(false);
        return;
      }
      map[r.id] = Array.isArray(data) ? data : [];
    }
    setAllRolePermissions(map);
    setLoadingAll(false);
  }, []);

  useEffect(() => {
    if (!canEditRolesPermissions && !permissionsLoading) {
      loadAllRolesPermissions();
    }
  }, [canEditRolesPermissions, permissionsLoading, loadAllRolesPermissions]);

  const toggleKey = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllInGroup = (keys) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const clearGroup = (keys) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    const keysArray = Array.from(selectedKeys);
    const { error: err } = await supabase.rpc('set_role_permissions', {
      p_role_id: selectedRoleId,
      p_permission_keys: keysArray,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setMessage('Permissions saved. Only Super Admin can change these.');
  };

  const selectedRole = ROLES.find((r) => r.id === selectedRoleId);

  const roleHierarchySection = (
    <div className="settings-section">
      <h3>Role hierarchy</h3>
      <p className="help-text" style={{ marginBottom: '1rem' }}>
        Super Admin → Admin → Editor → Employee → Viewer. Assign roles in Supabase <code>profiles.role_id</code> or via your admin API.
      </p>
      <ul className="roles-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {ROLES.slice()
          .sort((a, b) => b.rank - a.rank)
          .map((role) => (
            <li
              key={role.id}
              style={{
                padding: '1rem 1.25rem',
                marginBottom: '0.5rem',
                borderRadius: '8px',
                background: 'var(--surface-elevated, rgba(255,255,255,0.06))',
                border: '1px solid var(--border, rgba(255,255,255,0.08))',
              }}
            >
              <strong>{role.label}</strong>
              <span style={{ opacity: 0.75, marginLeft: '0.5rem' }}>(<code>{role.slug}</code>)</span>
              <div className="help-text" style={{ marginTop: '0.35rem' }}>
                {role.description}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );

  if (permissionsLoading) {
    return (
      <div className="page-section active" id="page-roles-permissions">
        <div className="page-content">
          <div className="page-title-bar">
            <h2>Roles & Permissions</h2>
            <p>Manage role hierarchy and which features each role can access</p>
          </div>
          <p className="help-text">Loading…</p>
        </div>
      </div>
    );
  }

  if (!canEditRolesPermissions) {
    return (
      <div className="page-section active" id="page-roles-permissions">
        <div className="page-content">
          <div className="page-title-bar">
            <h2>Roles & Permissions</h2>
            <p>View-only: see which features each role can access. Only Super Admin can make changes.</p>
          </div>
          {error && (
            <div className="help-text" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
              {error}
            </div>
          )}
          {loadingAll ? (
            <p className="help-text">Loading all roles and permissions…</p>
          ) : allRolePermissions ? (
            <div className="settings-section permissions-assign">
              <h3>Permissions by role</h3>
              <p className="help-text" style={{ marginBottom: '1.25rem' }}>
                Below are the permissions currently assigned to each role. You cannot edit these.
              </p>
              {ROLES.slice()
                .sort((a, b) => b.rank - a.rank)
                .map((role) => {
                  const keys = allRolePermissions[role.id] || [];
                  return (
                    <div
                      key={role.id}
                      className="permission-group-card"
                      style={{ marginBottom: '1.5rem' }}
                    >
                      <h4 className="permission-group-title" style={{ marginBottom: '0.75rem' }}>
                        {role.label} <span style={{ opacity: 0.7, fontWeight: 'normal' }}>({role.slug})</span>
                      </h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {keys.length === 0 ? (
                          <span className="help-text">No permissions assigned</span>
                        ) : (
                          keys.map((key) => (
                            <span
                              key={key}
                              style={{
                                padding: '0.25rem 0.5rem',
                                borderRadius: '6px',
                                background: 'var(--surface-elevated, rgba(255,255,255,0.06))',
                                fontSize: '0.85rem',
                              }}
                              title={key}
                            >
                              {permissionKeyToLabel(key)}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : null}
          {roleHierarchySection}
        </div>
      </div>
    );
  }

  return (
    <div className="page-section active" id="page-roles-permissions">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Roles & Permissions</h2>
          <p>Manage role hierarchy and which features each role can access</p>
        </div>

        <div className="settings-section permissions-assign">
          <h3>Assign permissions to a role</h3>
          <p className="help-text" style={{ marginBottom: '1.25rem' }}>
            Only <strong>Super Admin</strong> can change which role can access which page or feature. Select a role, tick the permissions, then Save.
          </p>
          {error && (
            <div className="help-text" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
              {error}
              {(error.includes('function') || error.includes('relation')) && (
                <> Run <code>supabase/run_all_migrations.sql</code> and <code>supabase/rpc_role_permissions.sql</code> in SQL Editor.</>
              )}
            </div>
          )}
          {message && (
            <div className="help-text" style={{ color: 'var(--accent)', marginBottom: '1rem' }}>
              {message}
            </div>
          )}

          <div className="role-selector-bar">
            <label htmlFor="perm-role-select">Role</label>
            <select
              id="perm-role-select"
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            {selectedRole && (
              <span className="editing-badge">Editing: {selectedRole.label}</span>
            )}
          </div>

          {loading ? (
            <p className="help-text">Loading permissions…</p>
          ) : (
            <>
              {[
                { label: 'Sidebar (pages)', keys: ALL_PERMISSION_KEYS.sidebar },
                { label: 'Report tabs: Google Ads', keys: ALL_PERMISSION_KEYS.reportGoogleAds },
                { label: 'Report tabs: Meta Ads', keys: ALL_PERMISSION_KEYS.reportMetaAds },
                { label: 'Report tabs: Bing / Microsoft Ads', keys: ALL_PERMISSION_KEYS.reportBingAds },
                { label: 'Report tabs: TikTok Ads', keys: ALL_PERMISSION_KEYS.reportTiktokAds },
                { label: 'Report tabs: Reddit Ads', keys: ALL_PERMISSION_KEYS.reportRedditAds },
                { label: 'Table columns (toggle columns in reports)', keys: ALL_PERMISSION_KEYS.tableColumns },
                { label: 'Admin (manage roles & users)', keys: ALL_PERMISSION_KEYS.admin },
              ].map(({ label, keys }) => (
                <div key={label} className="permission-group-card">
                  <div className="permission-group-header">
                    <h4 className="permission-group-title">{label}</h4>
                    <div className="permission-group-actions">
                      <button type="button" onClick={() => selectAllInGroup(keys)}>
                        Select all
                      </button>
                      <button type="button" onClick={() => clearGroup(keys)}>
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="permission-grid">
                    {keys.map((key) => (
                      <div key={key} className="permission-item">
                        <input
                          type="checkbox"
                          id={`perm-${key}`}
                          checked={selectedKeys.has(key)}
                          onChange={() => toggleKey(key)}
                        />
                        <label htmlFor={`perm-${key}`}>
                          <span className="perm-label">{permissionKeyToLabel(key)}</span>
                          <span className="perm-key">{key}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="permission-save-bar">
                <button
                  type="button"
                  className="btn-save-permissions"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save permissions for ' + (selectedRole?.label ?? 'role')}
                </button>
                <span className="save-hint">Only Super Admin can save. Changes apply immediately.</span>
              </div>
            </>
          )}
        </div>

        {roleHierarchySection}
      </div>
    </div>
  );
}
