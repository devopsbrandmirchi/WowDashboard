import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase.js';

export function Header() {
  const { headerTitle, toggleSidebar, sidebarCollapsed, collapseSidebar, showPage } = useApp();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

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
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const displayEmail = user?.email ?? '';

  const goToProfile = () => {
    setDropdownOpen(false);
    showPage?.('profile');
    navigate('/profile');
  };

  return (
    <header className="header">
      <div className="header-left">
        <button type="button" className="hamburger" onClick={toggleSidebar} aria-label="Toggle menu">☰</button>
        <button
          type="button"
          className={`sidebar-collapse-btn ${sidebarCollapsed ? 'collapsed' : ''}`}
          id="sidebarCollapseBtn"
          onClick={collapseSidebar}
          title="Toggle sidebar"
        >
          <svg className="collapse-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h1 id="headerTitle">{headerTitle}</h1>
      </div>
      <div className="header-right">
        <div className="header-filters" id="headerFilters">
          <span id="sb-sync-badge" style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>Live</span>
        </div>
        <div className="header-user-menu" ref={dropdownRef}>
          <button
            type="button"
            className="header-user-trigger"
            onClick={() => setDropdownOpen((o) => !o)}
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
          >
            <span className="header-user-avatar">{displayName.charAt(0).toUpperCase()}</span>
            <span className="header-user-info">
              <span className="header-user-name">{displayName}</span>
              {displayEmail && <span className="header-user-email">{displayEmail}</span>}
            </span>
            <svg className="header-user-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {dropdownOpen && (
            <div className="header-user-dropdown">
              <button type="button" className="header-dropdown-item" onClick={goToProfile}>
                Profile
              </button>
              <button type="button" className="header-dropdown-item header-dropdown-logout" onClick={() => { setDropdownOpen(false); logout(); }}>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
