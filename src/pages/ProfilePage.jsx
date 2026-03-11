import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase.js';

export function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const loadProfile = async () => {
    if (!user?.id) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    return !error && data ? data : null;
  };

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const profileData = await loadProfile();
      if (!cancelled && profileData) {
        setProfile(profileData);
        setFullName(profileData.full_name ?? user?.user_metadata?.full_name ?? '');
        setEmail(profileData.email ?? user?.email ?? '');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const displayEmail = profile?.email ?? user?.email ?? '—';

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const nameTrim = fullName.trim();
      const emailTrim = email.trim();

      if (nameTrim) {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ full_name: nameTrim, updated_at: new Date().toISOString() })
          .eq('id', user.id);
        if (updateErr) throw updateErr;
      }

      if (emailTrim && emailTrim !== (user?.email ?? profile?.email)) {
        const { error: authErr } = await supabase.auth.updateUser({ email: emailTrim });
        if (authErr) throw authErr;
        const { error: profileErr } = await supabase
          .from('profiles')
          .update({ email: emailTrim, updated_at: new Date().toISOString() })
          .eq('id', user.id);
        if (profileErr) {
          // profiles may not have email column or RLS; non-fatal
        }
      }

      const updated = await loadProfile();
      if (updated) {
        setProfile(updated);
        setFullName(updated.full_name ?? nameTrim);
        setEmail(updated.email ?? emailTrim);
      }
      setMessage('Profile updated.');
      setEditing(false);
    } catch (err) {
      setError(err?.message ?? 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFullName(profile?.full_name ?? user?.user_metadata?.full_name ?? '');
    setEmail(profile?.email ?? user?.email ?? '');
    setError(null);
    setMessage(null);
    setEditing(false);
  };

  return (
    <div className="page-section active" id="page-profile">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Profile</h2>
          <p>Your account details</p>
        </div>

        {loading ? (
          <p className="help-text">Loading profile…</p>
        ) : (
          <div className="settings-section profile-card">
            <div className="profile-header">
              <div className="profile-avatar">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" />
                ) : (
                  <span className="profile-avatar-initial">{(fullName || displayName).charAt(0).toUpperCase() || '?'}</span>
                )}
              </div>
              <div className="profile-title">
                <h3>{editing ? (fullName || 'Your name') : displayName}</h3>
                <p className="help-text">{editing ? (email || 'your@email.com') : displayEmail}</p>
              </div>
            </div>

            {editing ? (
              <form className="profile-edit-form" onSubmit={handleSave}>
                {error && <p className="form-error">{error}</p>}
                {message && <p className="form-success">{message}</p>}
                <div className="form-group">
                  <label htmlFor="profile-full-name">Full name</label>
                  <input
                    id="profile-full-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="profile-email">Email</label>
                  <input
                    id="profile-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                  />
                </div>
                <p className="help-text" style={{ marginBottom: '12px' }}>
                  Changing email may require a new sign-in or confirmation.
                </p>
                <div className="profile-edit-actions">
                  <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                {message && <p className="form-success" style={{ marginBottom: '12px' }}>{message}</p>}
                <dl className="profile-details">
                  <dt>Full name</dt>
                  <dd>{profile?.full_name || user?.user_metadata?.full_name || '—'}</dd>
                  <dt>Email</dt>
                  <dd>{displayEmail}</dd>
                </dl>
                <div className="profile-edit-actions" style={{ marginTop: '20px' }}>
                  <button type="button" className="btn btn-primary" onClick={() => { setMessage(null); setError(null); setEditing(true); }}>
                    Edit profile
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
