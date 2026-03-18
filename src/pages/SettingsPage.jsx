import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase.js';

const SETTINGS_NAV = [
  { id: 'google-ads', label: 'Google Ads' },
  { id: 'reddit', label: 'Reddit Ads' },
  { id: 'meta', label: 'Facebook / Meta Ads' },
  { id: 'tiktok', label: 'TikTok Ads' },
  { id: 'branding', label: 'White Label & Branding' },
];

/** Same UX for Google, Reddit, Meta, TikTok: Connect → date range + Sync */
function AdsPlatformPanel({ showNotification, title, connectDescription, onSync }) {
  const [connected, setConnected] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [syncing, setSyncing] = useState(false);

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
      try {
        await onSync(startDate, endDate);
        showNotification(`${title} sync completed.`);
      } catch (e) {
        showNotification(e?.message || String(e) || 'Sync failed.');
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
      <p className="wl-settings-desc" style={{ marginTop: 8 }}>
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
  const { logout, user } = useAuth();
  const { branding, updateBranding, colors, updateColors, resetSettings, showNotification } = useApp();
  const [profile, setProfile] = useState(null);
  const [activeNav, setActiveNav] = useState('google-ads');

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
              {SETTINGS_NAV.map((item) => (
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
                onSync={async (dateFrom, dateTo) => {
                  const { data, error } = await supabase.functions.invoke('sync-google-ads-upsert', {
                    body: { date_from: dateFrom, date_to: dateTo },
                  });
                  if (error) throw new Error(error.message || 'Edge function error');
                  if (data?.error) throw new Error(data.message || data.error);
                }}
              />
            )}
            {activeNav === 'reddit' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="Reddit Ads"
                connectDescription="Connect your Reddit Ads account to pull spend and conversion data into reports."
              />
            )}
            {activeNav === 'meta' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="Facebook / Meta Ads"
                connectDescription="Link Meta Business Manager to sync campaign performance across your client accounts."
              />
            )}
            {activeNav === 'tiktok' && (
              <AdsPlatformPanel
                showNotification={showNotification}
                title="TikTok Ads"
                connectDescription="Connect your TikTok For Business advertiser account to sync campaigns and performance into reports."
              />
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
