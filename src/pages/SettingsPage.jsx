import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

export function SettingsPage() {
  const { branding, updateBranding, colors, updateColors, resetSettings, showNotification } = useApp();
  const { logout } = useAuth();
  const [agencyName, setAgencyName] = useState(branding.agencyName);
  const [agencyLogo, setAgencyLogo] = useState(branding.agencyLogo);
  const [primary, setPrimary] = useState(colors.primary);
  const [accent, setAccent] = useState(colors.accent);
  const [warning, setWarning] = useState(colors.warning);
  const [danger, setDanger] = useState(colors.danger);

  const handleBrandingBlur = () => {
    updateBranding(agencyName, agencyLogo);
  };

  const handlePrimaryChange = (e) => {
    const v = e.target.value;
    setPrimary(v);
    updateColors(v, null, null, null);
  };
  const handleAccentChange = (e) => {
    const v = e.target.value;
    setAccent(v);
    updateColors(null, v, null, null);
  };
  const handleWarningChange = (e) => {
    const v = e.target.value;
    setWarning(v);
    updateColors(null, null, v, null);
  };
  const handleDangerChange = (e) => {
    const v = e.target.value;
    setDanger(v);
    updateColors(null, null, null, v);
  };

  return (
    <div className="page-section active" id="page-settings">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>White-Label Settings</h2>
          <p>Customize your agency dashboard branding</p>
        </div>

        <div className="settings-section">
          <h3>Agency Branding</h3>
          <div className="settings-form-group">
            <label>Agency Name</label>
            <input
              type="text"
              id="agencyName"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              onBlur={handleBrandingBlur}
            />
            <div className="help-text">This will appear in the sidebar and reports</div>
          </div>
          <div className="settings-form-group">
            <label>Agency Logo Text</label>
            <input
              type="text"
              id="agencyLogo"
              value={agencyLogo}
              maxLength={2}
              onChange={(e) => setAgencyLogo(e.target.value)}
              onBlur={handleBrandingBlur}
            />
            <div className="help-text">1-2 characters for logo badge</div>
          </div>
        </div>

        <div className="settings-section">
          <h3>Color Scheme</h3>
          <div className="color-swatches">
            <div className="color-swatch">
              <input type="color" id="primaryColor" value={primary} onChange={handlePrimaryChange} />
              <span>Primary</span>
            </div>
            <div className="color-swatch">
              <input type="color" id="accentColor" value={accent} onChange={handleAccentChange} />
              <span>Accent</span>
            </div>
            <div className="color-swatch">
              <input type="color" id="warningColor" value={warning} onChange={handleWarningChange} />
              <span>Warning</span>
            </div>
            <div className="color-swatch">
              <input type="color" id="dangerColor" value={danger} onChange={handleDangerChange} />
              <span>Danger</span>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>Report Settings</h3>
          <div className="settings-form-group">
            <label>Default Date Range</label>
            <select defaultValue="30">
              <option value="7">Last 7 Days</option>
              <option value="30">Last 30 Days</option>
              <option value="90">Last 90 Days</option>
              <option value="ytd">Year to Date</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="settings-form-group">
            <label>Currency Format</label>
            <select defaultValue="USD">
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="CAD">CAD ($)</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 32 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => showNotification('Settings saved successfully!')}
          >
            Save Settings
          </button>
          <button type="button" className="btn btn-outline" onClick={resetSettings}>
            Reset to Default
          </button>
          <button type="button" className="btn btn-outline" onClick={logout} style={{ marginLeft: 8 }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
