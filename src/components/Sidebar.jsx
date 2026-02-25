import { useApp } from '../context/AppContext';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Executive Dashboard', icon: '📊', section: 'Overview' },
  {
    id: 'google-ads', label: 'Google Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
  },
  {
    id: 'meta-ads', label: 'Meta Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z" fill="#1877F2"/></svg>,
  },
  {
    id: 'bing-ads', label: 'Bing / Microsoft Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 3v16.1l4.5 2.5 8-4.6v-4.3L10 8.5V1L5 3z" fill="#00809D"/><path d="M10 8.5v7.1l5.5 3.1 2-1.1v-4.3L10 8.5z" fill="#00B294" opacity=".8"/></svg>,
  },
  {
    id: 'tiktok-ads', label: 'TikTok Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-.88-.13 2.89 2.89 0 01-2-2.74 2.89 2.89 0 012.88-2.89c.3 0 .59.04.86.12V9.01a6.38 6.38 0 00-.86-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.48a8.24 8.24 0 004.76 1.5V7.53a4.83 4.83 0 01-1-.84z" fill="#25F4EE"/></svg>,
    logoStyle: { background: '#000', borderRadius: '3px' },
  },
  {
    id: 'reddit-ads', label: 'Reddit Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#FF4500"/><path d="M16.67 13.38c.03.16.05.33.05.5 0 2.56-2.98 4.63-6.67 4.63-3.69 0-6.67-2.07-6.67-4.63 0-.17.02-.34.05-.5a1.5 1.5 0 01-.6-1.2 1.52 1.52 0 012.75-.88c1.2-.81 2.84-1.33 4.63-1.4l.87-4.1a.3.3 0 01.36-.24l2.9.62a1.07 1.07 0 112.02.18l-2.7-.58-.78 3.7c1.77.07 3.38.59 4.57 1.4a1.52 1.52 0 012.75.88c0 .47-.22.9-.57 1.18zM8.17 13.38a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5zm5.92 2.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5zm-.4 1.46c-.96.72-2.2 1.03-3.6 1.03-1.4 0-2.64-.31-3.6-1.03a.3.3 0 01.4-.44c.81.6 1.88.91 3.2.91s2.39-.31 3.2-.91a.3.3 0 01.4.44z" fill="#fff"/></svg>,
  },
  {
    id: 'amazon-ads', label: 'Amazon Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M14.43 16.7c-4.1 3.04-10.06 4.66-15.18 4.66C-.18 21.36.08 21.1.33 20.84c4.69-4 10.48-6.4 16.45-6.4 2.4 0 4.93.5 7.3 1.51.36.16.06.39-.19.37a23.16 23.16 0 00-9.46.38z" fill="#FF9900"/><path d="M6.5 12.07c0-1.04.08-1.87.24-2.51a5.06 5.06 0 01.74-1.72 3.19 3.19 0 011.28-1.02A4.22 4.22 0 0110.46 6.4c.64 0 1.2.06 1.68.19.48.13.94.33 1.38.62v-.61c0-.97-.2-1.65-.62-2.06-.41-.41-1.07-.61-1.97-.61-.44 0-.91.06-1.41.19a10.6 10.6 0 00-1.54.55l-.48-1.94c.58-.28 1.2-.5 1.86-.65.66-.16 1.3-.24 1.9-.24 1.61 0 2.78.4 3.52 1.19s1.1 2 1.1 3.62v7.1h-2.14l-.21-1.3h-.07a5.08 5.08 0 01-1.52 1.14c-.58.29-1.23.43-1.93.43-1.14 0-2.03-.35-2.67-1.06-.64-.7-.96-1.7-.96-2.99zm2.44-.18c0 .76.17 1.34.51 1.73.34.39.82.59 1.44.59.52 0 .99-.14 1.4-.43.41-.29.76-.65 1.04-1.1V10.2a3.97 3.97 0 00-1.22-.52 4.78 4.78 0 00-1.18-.15c-.72 0-1.26.26-1.63.77-.37.51-.55 1.14-.55 1.87l.19-.28z" fill="#fff"/></svg>,
  },
  {
    id: 'dsp', label: 'DSP (TTD / DV360)', section: 'Programmatic & CTV',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><rect width="24" height="24" rx="4" fill="#2BC4C4"/><path d="M6 8h4v8H6zm4-2h4v12h-4zm4 4h4v4h-4z" fill="#fff"/></svg>,
  },
  {
    id: 'dating-apps', label: 'Dating Apps / Direct', section: 'Programmatic & CTV',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><rect width="24" height="24" rx="4" fill="#E91E63"/><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#fff"/></svg>,
  },
  {
    id: 'ctv', label: 'CTV Campaigns', section: 'Programmatic & CTV',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><rect width="24" height="24" rx="4" fill="#8B3F8E"/><path d="M4 5h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm4 14h8m-4-2v2" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round"/><path d="M9 9l6 3-6 3V9z" fill="#fff"/></svg>,
  },
  {
    id: 'ga4', label: 'GA4 / Web Analytics', section: 'Analytics & CRM',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M3.14 16.5l4.94-8.57a2 2 0 013.46 0L16.47 16.5a2 2 0 01-1.73 3H4.87a2 2 0 01-1.73-3z" fill="#E37400"/><circle cx="18.5" cy="17" r="3" fill="#F9AB00"/><circle cx="18.5" cy="7" r="3" fill="#E37400"/></svg>,
  },
  {
    id: 'email', label: 'Email Marketing', section: 'Analytics & CRM',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><rect width="24" height="24" rx="4" fill="#FF7A59"/><path d="M4 7l8 5 8-5M4 7v10h16V7" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  {
    id: 'ghl', label: 'GoHighLevel', section: 'Analytics & CRM',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><rect width="24" height="24" rx="4" fill="#28A745"/><path d="M7 13l3 3 7-7" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  {
    id: 'ott', label: 'OTT / Vimeo', section: 'Analytics & CRM',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#1AB7EA"/><path d="M10 8l6 4-6 4V8z" fill="#fff"/></svg>,
  },
  { id: 'seo',       label: 'SEO Performance',      icon: '🔍', section: 'Insights' },
  { id: 'geo',       label: 'Geographic View',       icon: '🌍', section: 'Insights' },
  { id: 'creatives', label: 'Creative Analysis',     icon: '🎨', section: 'Insights' },
  { id: 'events',    label: 'Events / Special',      icon: '🎪', section: 'Insights' },
  { id: 'settings',  label: 'White-Label Settings',  icon: '⚙️', section: 'System' },
];

function groupBySection(items) {
  const map = new Map();
  items.forEach((item) => {
    if (!map.has(item.section)) map.set(item.section, []);
    map.get(item.section).push(item);
  });
  return map;
}

const sections = groupBySection(NAV_ITEMS);

export function Sidebar() {
  const { currentPage, showPage, sidebarOpen, sidebarCollapsed, branding, currentClient, handleClientChange, clients } = useApp();

  const sidebarClass = ['sidebar', sidebarOpen && 'open', sidebarCollapsed && 'collapsed'].filter(Boolean).join(' ');

  return (
    <aside className={sidebarClass} id="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo-text" id="brandLogo">
          <span className="brand-chipper">{branding.agencyName || 'chipper'}</span>
          <span className="brand-digital">{branding.agencyLogo || 'DIGITAL'}</span>
        </div>
      </div>

      {Array.from(sections.entries()).map(([sectionLabel, items]) => (
        <div key={sectionLabel} className="sidebar-section">
          <div className="sidebar-section-label">{sectionLabel}</div>
          <ul className="sidebar-nav">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href="#"
                  className={currentPage === item.id ? 'active' : ''}
                  data-tooltip={item.label}
                  onClick={(e) => {
                    e.preventDefault();
                    showPage(item.id);
                  }}
                >
                  {item.logo ? (
                    <span className="platform-logo" style={item.logoStyle}>{item.logo}</span>
                  ) : item.icon ? (
                    <span className="nav-icon">{item.icon}</span>
                  ) : null}
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="sidebar-footer">
        <select
          className="client-selector"
          value={currentClient || 'Select Client...'}
          onChange={(e) => handleClientChange(e.target.value)}
        >
          {clients.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
    </aside>
  );
}
