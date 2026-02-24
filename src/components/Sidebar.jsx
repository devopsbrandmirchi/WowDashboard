import { useApp } from '../context/AppContext';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Executive Dashboard', icon: '📊', section: 'Overview' },
  { id: 'google-ads',   label: 'Google Ads',        dot: 'var(--google)',   section: 'Ad Platforms' },
  { id: 'meta-ads',     label: 'Meta Ads',          dot: 'var(--meta)',     section: 'Ad Platforms' },
  { id: 'bing-ads',     label: 'Bing / Microsoft Ads', dot: 'var(--bing)',   section: 'Ad Platforms' },
  { id: 'tiktok-ads',   label: 'TikTok Ads',        dot: 'var(--tiktok)',   section: 'Ad Platforms' },
  { id: 'reddit-ads',   label: 'Reddit Ads',        dot: 'var(--reddit)',   section: 'Ad Platforms' },
  { id: 'amazon-ads',   label: 'Amazon Ads',        dot: 'var(--amazon)',   section: 'Ad Platforms' },
  { id: 'dsp',          label: 'DSP (TTD / DV360)', dot: 'var(--ttd)',     section: 'Programmatic & CTV' },
  { id: 'dating-apps',  label: 'Dating Apps / Direct', dot: '#E91E63',       section: 'Programmatic & CTV' },
  { id: 'ctv',          label: 'CTV Campaigns',     dot: '#9C27B0',         section: 'Programmatic & CTV' },
  { id: 'ga4',          label: 'GA4 / Web Analytics', dot: 'var(--ga4)',   section: 'Analytics & CRM' },
  { id: 'email',       label: 'Email Marketing',    dot: 'var(--hubspot)',  section: 'Analytics & CRM' },
  { id: 'ghl',         label: 'GoHighLevel',       dot: 'var(--ghl)',      section: 'Analytics & CRM' },
  { id: 'ott',         label: 'OTT / Vimeo',        dot: 'var(--vimeo)',    section: 'Analytics & CRM' },
  { id: 'seo',         label: 'SEO Performance',   icon: '🔍',             section: 'Insights' },
  { id: 'geo',         label: 'Geographic View',    icon: '🌍',             section: 'Insights' },
  { id: 'creatives',   label: 'Creative Analysis',  icon: '🎨',             section: 'Insights' },
  { id: 'events',      label: 'Events / Special',  icon: '🎪',             section: 'Insights' },
  { id: 'settings',    label: 'White-Label Settings', icon: '⚙️',          section: 'System' },
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
        <div className="brand-logo" id="brandLogo">{branding.agencyLogo}</div>
        <div className="brand-info">
          <h2 id="brandName">{branding.agencyName}</h2>
          <span>Reporting Suite</span>
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
                  onClick={(e) => {
                    e.preventDefault();
                    showPage(item.id);
                  }}
                >
                  {item.icon ? (
                    <span className="nav-icon">{item.icon}</span>
                  ) : (
                    <span className="platform-dot" style={{ background: item.dot }} />
                  )}
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
