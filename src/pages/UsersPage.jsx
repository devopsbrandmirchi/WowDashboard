import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { ROLES } from '../constants/roles.js';

const roleLabel = (slug) => ROLES.find((r) => r.slug === slug)?.label ?? slug ?? '—';

export function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rpcData, error: rpcErr } = await supabase.rpc('list_profiles_for_admin');
    if (!rpcErr && rpcData != null) {
      const arr = Array.isArray(rpcData) ? rpcData : rpcData?.rows ?? [];
      setUsers(Array.isArray(arr) ? arr : []);
    } else if (rpcErr && !rpcErr.message?.includes('does not exist')) {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, role, is_active, last_sign_in_at, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (err) setError(err.message);
      else setUsers(data ?? []);
    } else {
      setUsers([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleEditSave = async (payload) => {
    if (!payload?.id) return;
    setError(null);
    const { error: err } = await supabase.rpc('update_profile_for_admin', {
      p_id: payload.id,
      p_full_name: payload.full_name || null,
      p_role: payload.role || null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setMessage('User updated.');
    setEditUser(null);
    loadUsers();
  };

  const handleDeactivate = async (id, isActive) => {
    setError(null);
    const { error: err } = await supabase.rpc('set_profile_active_for_admin', {
      p_id: id,
      p_is_active: isActive,
    });
    if (err) {
      setError(err.message);
      setDeleteConfirm(null);
      return;
    }
    setMessage(isActive ? 'User reactivated.' : 'User deactivated.');
    setDeleteConfirm(null);
    loadUsers();
  };

  const searchLower = (searchQuery || '').trim().toLowerCase();
  const filteredUsers =
    !searchLower
      ? users
      : users.filter(
          (u) =>
            (u.full_name ?? '').toLowerCase().includes(searchLower) ||
            (u.email ?? '').toLowerCase().includes(searchLower) ||
            roleLabel(u.role).toLowerCase().includes(searchLower)
        );

  return (
    <div className="page-section active" id="page-users">
      <div className="page-content">
        <div className="page-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2>Users</h2>
            <p>View and manage user accounts (from profiles)</p>
          </div>
          <button
            type="button"
            className="btn-add-user"
            onClick={() => setAddModalOpen(true)}
          >
            + Add user
          </button>
        </div>

        {message && (
          <div className="help-text" style={{ color: 'var(--accent)', marginBottom: '0.75rem' }}>
            {message}
          </div>
        )}
        {error && (
          <div className="help-text" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
            {error}
            {error.includes('recursion') || error.includes('policy') ? (
              <> Run <code>supabase/rls_super_admin_list_profiles.sql</code> in SQL Editor.</>
            ) : null}
          </div>
        )}

        {loading ? (
          <p className="help-text">Loading users…</p>
        ) : users.length === 0 && !error ? (
          <p className="help-text">No users in profiles. Add a user below or use Supabase Dashboard.</p>
        ) : (
          <div className="settings-section">
            <div style={{ marginBottom: '1rem' }}>
              <input
                type="search"
                className="search-input"
                placeholder="Search by name, email or role…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search users"
                style={{
                  width: '100%',
                  maxWidth: 320,
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
                    <th style={{ width: 60 }}>Sl No</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Active</th>
                    <th>Last sign-in</th>
                    <th style={{ width: 140 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u, index) => (
                    <tr key={u.id}>
                      <td>{index + 1}</td>
                      <td>{u.full_name ?? '—'}</td>
                      <td>{u.email ?? '—'}</td>
                      <td>{roleLabel(u.role)}</td>
                      <td>{u.is_active == null ? '—' : u.is_active ? 'Yes' : 'No'}</td>
                      <td style={{ fontSize: '0.9em' }}>
                        {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : '—'}
                      </td>
                      <td>
                        <div className="users-row-actions">
                          <button
                            type="button"
                            className="btn-edit-user"
                            onClick={() => setEditUser({ ...u })}
                          >
                            Edit
                          </button>
                          {u.is_active === false ? (
                            <button
                              type="button"
                              className="btn-reactivate-user"
                              onClick={() => handleDeactivate(u.id, true)}
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-delete-user"
                              onClick={() => setDeleteConfirm(u)}
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredUsers.length === 0 && users.length > 0 && (
              <p className="help-text" style={{ marginTop: '0.75rem' }}>
                No users match your search.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Add user modal */}
      {addModalOpen && (
        <div className="modal-overlay" onClick={() => setAddModalOpen(false)}>
          <div className="modal-card users-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add user</h3>
            <p className="help-text" style={{ marginBottom: '1rem' }}>
              To create a new user from this app, use one of these options:
            </p>
            <ul style={{ marginBottom: '1rem', paddingLeft: '1.25rem' }}>
              <li>Supabase Dashboard → Authentication → Users → Add user</li>
              <li>Run <code>npm run seed:super-admin</code> for a default Super Admin</li>
            </ul>
            <p className="help-text">Then refresh this page and set the user’s role via <strong>Edit</strong>.</p>
            <div className="modal-actions">
              <button type="button" className="btn-close-modal" onClick={() => setAddModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <EditUserModal
          user={editUser}
          onSave={handleEditSave}
          onClose={() => setEditUser(null)}
        />
      )}

      {/* Delete (deactivate) confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-card users-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Deactivate user?</h3>
            <p className="help-text">
              <strong>{deleteConfirm.full_name || deleteConfirm.email}</strong> will be marked inactive and can be reactivated later.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-close-modal" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-delete-confirm"
                onClick={() => handleDeactivate(deleteConfirm.id, false)}
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditUserModal({ user, onSave, onClose }) {
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [role, setRole] = useState(user?.role ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave({ id: user.id, full_name: fullName.trim() || null, role: role || null });
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card users-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit user</h3>
        <form onSubmit={handleSubmit}>
          <div className="settings-form-group">
            <label>Email</label>
            <input type="text" value={user?.email ?? ''} readOnly disabled style={{ opacity: 0.8 }} />
          </div>
          <div className="settings-form-group">
            <label>Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div className="settings-form-group">
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">—</option>
              {ROLES.map((r) => (
                <option key={r.id} value={r.slug}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-close-modal" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-save-user" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
