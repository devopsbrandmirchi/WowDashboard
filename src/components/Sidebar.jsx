import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useUserPermissions } from '../hooks/useUserPermissions';

// Logo component that uses image assets
const PlatformLogo = ({ platform, color = '#FFFFFF' }) => {
  // Determine which image to use based on state
  // color: '#FFFFFF' = static (white), '#F40000' = hover (red), '#00286E' = active (dark blue)
  let imageSrc = '';
  
  if (platform === 'google') {
    if (color === '#00286E') {
      // Active state - use multi-colored Google logo
      imageSrc = '/dist/assets/Google.png';
    } else if (color === '#F40000') {
      // Hover state - use red version
      imageSrc = '/dist/assets/Google_RED.png';
    } else {
      // Static state - use white version
      imageSrc = '/dist/assets/Google_WHITE.png';
    }
  } else if (platform === 'reddit') {
    if (color === '#00286E') {
      // Active state - use dark blue version
      imageSrc = '/dist/assets/Reddit.png';
    } else if (color === '#F40000') {
      // Hover state - use red version
      imageSrc = '/dist/assets/Reddit_RED.png';
    } else {
      // Static state - use white version
      imageSrc = '/dist/assets/Reddit_WHITE.png';
    }
  } else if (platform === 'meta') {
    if (color === '#00286E') {
      imageSrc = '/dist/assets/Meta.png';
    } else if (color === '#F40000') {
      imageSrc = '/dist/assets/Meta_RED.png';
    } else {
      imageSrc = '/dist/assets/Meta_WHITE.png';
    }
  } else if (platform === 'tiktok') {
    if (color === '#00286E') {
      imageSrc = '/dist/assets/TikTok.png';
    } else if (color === '#F40000') {
      imageSrc = '/dist/assets/TikTok_RED.png';
    } else {
      imageSrc = '/dist/assets/TikTok_WHITE.png';
    }
  }
  
  return (
    <img 
      src={imageSrc} 
      alt={`${platform} logo`}
      style={{ width: '16px', height: '16px', display: 'block' }}
    />
  );
};

const NAV_ITEMS = [
  // { id: 'dashboard', label: 'Executive Dashboard', icon: '📊', section: 'Overview' },
  { id: 'combined-reporting', label: 'Combined Reporting', icon: '∑', section: 'Overview' },
  {
    id: 'google-ads', label: 'Google Ads', section: 'Ad Platforms',
    logoPlatform: 'google',
  },
  {
    id: 'meta-ads', label: 'Meta Ads', section: 'Ad Platforms',
    logoPlatform: 'meta',
  },
  {
    id: 'bing-ads', label: 'Bing / Microsoft Ads', section: 'Ad Platforms',
    logo: <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 3v16.1l4.5 2.5 8-4.6v-4.3L10 8.5V1L5 3z" fill="#00809D"/><path d="M10 8.5v7.1l5.5 3.1 2-1.1v-4.3L10 8.5z" fill="#00B294" opacity=".8"/></svg>,
  },
  {
    id: 'tiktok-ads', label: 'TikTok Ads', section: 'Ad Platforms',
    logoPlatform: 'tiktok',
  },
  {
    id: 'reddit-ads', label: 'Reddit Ads', section: 'Ad Platforms',
    logoPlatform: 'reddit',
  },
  { id: 'subscriptions-analytics', label: 'Subscription Analytics', icon: '📈', section: 'Subscriptions' },
  { id: 'subscriptions-subscribers', label: 'Subscriber Intelligence', icon: '👥', section: 'Subscriptions' },
  { id: 'settings',  label: 'Settings',  icon: '⚙️', section: 'System' },
  { id: 'roles-permissions', label: 'Roles & Permissions', icon: '🔐', section: 'System' },
  { id: 'users', label: 'Users', icon: '👤', section: 'System' },
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

const PAGE_ROUTES = {
  'subscriptions-analytics': '/subscriptions/analytics',
  'subscriptions-subscribers': '/subscriptions/subscribers',
  // 'dashboard': '/',
  'combined-reporting': '/combined-reporting',
  'google-ads': '/google-ads',
  'meta-ads': '/meta-ads',
  'bing-ads': '/bing-ads',
  'tiktok-ads': '/tiktok-ads',
  'reddit-ads': '/reddit-ads',
  'settings': '/settings',
  'roles-permissions': '/settings/roles-permissions',
  'users': '/settings/users',
};

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentPage, showPage, sidebarOpen, sidebarCollapsed, branding } = useApp();
  const { canAccessSidebar } = useUserPermissions();
  const [hoveredItem, setHoveredItem] = useState(null);

  const sidebarClass = ['sidebar', sidebarOpen && 'open', sidebarCollapsed && 'collapsed'].filter(Boolean).join(' ');

  return (
    <aside className={sidebarClass} id="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo-text" id="brandLogo">
          <span className="brand-chipper">{branding.agencyName || 'chipper'}</span>
          <span className="brand-digital">{branding.agencyLogo || 'DIGITAL'}</span>
        </div>
      </div>

      {Array.from(sections.entries()).map(([sectionLabel, items]) => {
        const visibleItems = items.filter((item) => canAccessSidebar(item.id));
        if (visibleItems.length === 0) return null;
        return (
        <div key={sectionLabel} className="sidebar-section">
          <div className="sidebar-section-label">{sectionLabel}</div>
          <ul className="sidebar-nav">
            {visibleItems.map((item) => {
              const isActive = currentPage === item.id || (PAGE_ROUTES[item.id] && location.pathname === PAGE_ROUTES[item.id]);
              const isHovered = hoveredItem === item.id && !isActive;
              
              // Determine colors based on state
              let logoColor = '#FFFFFF'; // Default: white for static
              let textColor = '#FFFFFF'; // White text for static
              
              if (isActive) {
                logoColor = '#00286E'; // Dark blue for active
                textColor = '#00286E'; // Dark blue text for active (matches icon)
              } else if (isHovered) {
                logoColor = '#F40000'; // Red for hover
                textColor = '#F40000'; // Red text for hover
              }
              
              return (
                <li key={item.id}>
                  <a
                    href={PAGE_ROUTES[item.id] || '#'}
                    className={isActive ? 'active' : ''}
                    onClick={(e) => {
                      e.preventDefault();
                      showPage(item.id);
                      const path = PAGE_ROUTES[item.id];
                      if (path) navigate(path);
                    }}
                    style={{
                      color: textColor,
                    }}
                    onMouseEnter={() => setHoveredItem(item.id)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    {item.logoPlatform ? (
                      <span className="platform-logo" style={item.logoStyle}>
                        <PlatformLogo platform={item.logoPlatform} color={logoColor} />
                      </span>
                    ) : item.logo ? (
                      <span className="platform-logo" style={item.logoStyle}>{item.logo}</span>
                    ) : item.icon ? (
                      <span className="nav-icon">{item.icon}</span>
                    ) : null}
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </aside>
  );
}
