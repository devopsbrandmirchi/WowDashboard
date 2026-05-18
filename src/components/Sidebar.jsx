import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useUserPermissions } from '../hooks/useUserPermissions';

/** Campaigns Reference submenu: child id(s) under the expandable "Campaigns Reference" menu */
const CAMPAIGNS_REFERENCE_SUBMENU_IDS = [
  'google-campaigns-reference',
  'reddit-campaigns-reference',
  'tiktok-campaigns-reference',
  'facebook-campaigns-reference',
  'facebook-adset-reference',
  'microsoft-campaigns-reference',
];

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Executive Dashboard', icon: '📊', section: 'Overview' },
  { id: 'combined-reporting', label: 'Combined Reporting', icon: '∑', section: 'Overview' },
  {
    id: 'google-ads', label: 'Google Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
  },
  // { id: 'google-ads-country', label: 'Google Ads Country', section: 'Ad Platforms' },
  {
    id: 'meta-ads', label: 'Meta Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z" fill="#1877F2"/></svg>,
  },
  // { id: 'meta-ads-country', label: 'Meta Ads Country', section: 'Ad Platforms' },
  {
    id: 'bing-ads', label: 'Bing / Microsoft Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 3v16.1l4.5 2.5 8-4.6v-4.3L10 8.5V1L5 3z" fill="#00809D"/><path d="M10 8.5v7.1l5.5 3.1 2-1.1v-4.3L10 8.5z" fill="#00B294" opacity=".8"/></svg>,
  },
  // { id: 'bing-ads-country', label: 'Bing / Microsoft Ads Country', section: 'Ad Platforms' },
  {
    id: 'tiktok-ads', label: 'TikTok Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-.88-.13 2.89 2.89 0 01-2-2.74 2.89 2.89 0 012.88-2.89c.3 0 .59.04.86.12V9.01a6.38 6.38 0 00-.86-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.48a8.24 8.24 0 004.76 1.5V7.53a4.83 4.83 0 01-1-.84z" fill="#25F4EE"/></svg>,
    logoStyle: { background: '#000', borderRadius: '3px' },
  },
  // { id: 'tiktok-ads-country', label: 'TikTok Ads Country', section: 'Ad Platforms' },
  {
    id: 'reddit-ads', label: 'Reddit Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#FF4500"/><path d="M16.67 13.38c.03.16.05.33.05.5 0 2.56-2.98 4.63-6.67 4.63-3.69 0-6.67-2.07-6.67-4.63 0-.17.02-.34.05-.5a1.5 1.5 0 01-.6-1.2 1.52 1.52 0 012.75-.88c1.2-.81 2.84-1.33 4.63-1.4l.87-4.1a.3.3 0 01.36-.24l2.9.62a1.07 1.07 0 112.02.18l-2.7-.58-.78 3.7c1.77.07 3.38.59 4.57 1.4a1.52 1.52 0 012.75.88c0 .47-.22.9-.57 1.18zM8.17 13.38a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5zm5.92 2.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5zm-.4 1.46c-.96.72-2.2 1.03-3.6 1.03-1.4 0-2.64-.31-3.6-1.03a.3.3 0 01.4-.44c.81.6 1.88.91 3.2.91s2.39-.31 3.2-.91a.3.3 0 01.4.44z" fill="#fff"/></svg>,
  },
  // { id: 'reddit-ads-country', label: 'Reddit Ads Country', section: 'Ad Platforms' },
  { id: 'subscriptions-analytics', label: 'Subscription Analytics', icon: '📈', section: 'Subscriptions' },
  { id: 'subscriptions-subscribers', label: 'Subscriber Intelligence', icon: '👥', section: 'Subscriptions' },
  { id: 'subscriptions-dating-apps', label: 'Display Ads', icon: '💜', section: 'Ad Platforms' },
  { id: 'subscriptions-hubspot-email', label: 'HubSpot email marketing', icon: '✉️', section: 'Subscriptions' },
  { id: 'maintenance', label: 'System Maintenance', icon: '🔧', section: 'System' },
  { id: 'settings',  label: 'White-Label Settings',  icon: '⚙️', section: 'System' },
  { id: 'roles-permissions', label: 'Roles & Permissions', icon: '🔐', section: 'System' },
  { id: 'users', label: 'Users', icon: '👤', section: 'System' },
  { id: 'google-campaigns-reference', label: 'Google Campaigns Reference', icon: '📋', section: 'System' },
  { id: 'reddit-campaigns-reference', label: 'Reddit Campaigns Reference', icon: '📋', section: 'System' },
  { id: 'tiktok-campaigns-reference', label: 'TikTok Campaigns Reference', icon: '📋', section: 'System' },
  { id: 'facebook-campaigns-reference', label: 'Facebook Campaigns Reference', icon: '📋', section: 'System' },
  { id: 'facebook-adset-reference', label: 'Facebook Adset Reference', icon: '📋', section: 'System' },
  { id: 'microsoft-campaigns-reference', label: 'Microsoft Campaigns Reference', icon: '📋', section: 'System' },
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
const navItemById = new Map(NAV_ITEMS.map((item) => [item.id, item]));

const PAGE_ROUTES = {
  'subscriptions-analytics': '/subscriptions/analytics',
  'subscriptions-subscribers': '/subscriptions/subscribers',
  'subscriptions-dating-apps': '/subscriptions/dating-apps',
  'subscriptions-hubspot-email': '/subscriptions/hubspot-email',
  'dashboard': '/',
  'combined-reporting': '/combined-reporting',
  'google-ads': '/google-ads',
  // 'google-ads-country': '/google-ads-country',
  'meta-ads': '/meta-ads',
  // 'meta-ads-country': '/meta-ads-country',
  'bing-ads': '/bing-ads',
  // 'bing-ads-country': '/bing-ads-country',
  'tiktok-ads': '/tiktok-ads',
  // 'tiktok-ads-country': '/tiktok-ads-country',
  'reddit-ads': '/reddit-ads',
  // 'reddit-ads-country': '/reddit-ads-country',
  'maintenance': '/maintenance',
  'settings': '/settings',
  'roles-permissions': '/settings/roles-permissions',
  'users': '/settings/users',
  'google-campaigns-reference': '/settings/google-campaigns-reference',
  'reddit-campaigns-reference': '/settings/reddit-campaigns-reference',
  'tiktok-campaigns-reference': '/settings/tiktok-campaigns-reference',
  'facebook-campaigns-reference': '/settings/facebook-campaigns-reference',
  'facebook-adset-reference': '/settings/facebook-adset-reference',
  'microsoft-campaigns-reference': '/settings/microsoft-campaigns-reference',
};

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentPage, showPage, sidebarOpen, sidebarCollapsed, branding } = useApp();
  const { canAccessSidebar } = useUserPermissions();
  const campaignsReferencePaths = CAMPAIGNS_REFERENCE_SUBMENU_IDS.map((id) => PAGE_ROUTES[id]).filter(Boolean);
  const isCampaignsReferencePath = campaignsReferencePaths.includes(location.pathname);
  const [campaignsReferenceOpen, setCampaignsReferenceOpen] = useState(isCampaignsReferencePath);
  useEffect(() => {
    if (isCampaignsReferencePath) setCampaignsReferenceOpen(true);
  }, [isCampaignsReferencePath]);

  const sidebarClass = ['sidebar', sidebarOpen && 'open', sidebarCollapsed && 'collapsed'].filter(Boolean).join(' ');

  const renderNavLink = (item) => {
    const path = PAGE_ROUTES[item.id];
    const isActive = currentPage === item.id || (path && location.pathname === path);
    return (
      <li key={item.id}>
        <a
          href={path || '#'}
          className={isActive ? 'active' : ''}
          onClick={(e) => {
            e.preventDefault();
            showPage(item.id);
            if (path) navigate(path);
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
    );
  };

  return (
    <aside className={sidebarClass} id="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo-text" id="brandLogo">
          <span className="brand-chipper">{branding.agencyName || 'chipper'}</span>
          <span className="brand-digital">{branding.agencyLogo || 'DIGITAL'}</span>
        </div>
      </div>

      {Array.from(sections.entries()).map(([sectionLabel, items]) => {
        if (sectionLabel === 'System') {
          const systemItems = items.filter((item) => !CAMPAIGNS_REFERENCE_SUBMENU_IDS.includes(item.id));
          const submenuItems = CAMPAIGNS_REFERENCE_SUBMENU_IDS.map((id) => navItemById.get(id)).filter(Boolean);
          const visibleSystem = systemItems.filter((item) => canAccessSidebar(item.id));
          const visibleSub = submenuItems.filter((item) => canAccessSidebar(item.id));
          if (visibleSystem.length === 0 && visibleSub.length === 0) return null;
          return (
            <div key={sectionLabel} className="sidebar-section sidebar-section-with-submenu">
              <div className="sidebar-section-label">{sectionLabel}</div>
              {visibleSub.length > 0 && (
                <div className="sidebar-submenu">
                  <button
                    type="button"
                    className={`sidebar-submenu-toggle ${campaignsReferenceOpen ? 'open' : ''}`}
                    onClick={() => setCampaignsReferenceOpen((o) => !o)}
                    aria-expanded={campaignsReferenceOpen}
                  >
                    <span className="nav-icon">📋</span>
                    <span>Campaigns Reference</span>
                    <span className="sidebar-submenu-chevron" aria-hidden>{campaignsReferenceOpen ? '▼' : '▶'}</span>
                  </button>
                  {campaignsReferenceOpen && (
                    <ul className="sidebar-nav sidebar-submenu-nav">
                      {visibleSub.map((item) => renderNavLink(item))}
                    </ul>
                  )}
                </div>
              )}
              <ul className="sidebar-nav">
                {visibleSystem.map((item) => renderNavLink(item))}
              </ul>
            </div>
          );
        }
        const visibleItems = items.filter((item) => canAccessSidebar(item.id));
        if (visibleItems.length === 0) return null;
        return (
          <div key={sectionLabel} className="sidebar-section">
            <div className="sidebar-section-label">{sectionLabel}</div>
            <ul className="sidebar-nav">
              {visibleItems.map((item) => renderNavLink(item))}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}
