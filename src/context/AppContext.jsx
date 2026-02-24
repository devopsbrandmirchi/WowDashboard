import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { PAGE_TITLES, CLIENTS } from '../data/staticData';

const STORAGE_KEYS = {
  agencyName: 'agencyName',
  agencyLogo: 'agencyLogo',
  primaryColor: 'primaryColor',
  accentColor: 'accentColor',
  warningColor: 'warningColor',
  dangerColor: 'dangerColor',
};

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentClient, setCurrentClient] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [branding, setBranding] = useState(() => ({
    agencyName: localStorage.getItem(STORAGE_KEYS.agencyName) || 'AgencyName',
    agencyLogo: localStorage.getItem(STORAGE_KEYS.agencyLogo) || 'A',
  }));
  const [colors, setColors] = useState(() => {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    const primary = localStorage.getItem(STORAGE_KEYS.primaryColor) || '#ff0000';
    const accent = localStorage.getItem(STORAGE_KEYS.accentColor) || '#10B981';
    const warning = localStorage.getItem(STORAGE_KEYS.warningColor) || '#F59E0B';
    const danger = localStorage.getItem(STORAGE_KEYS.dangerColor) || '#EF4444';
    if (root) {
      root.style.setProperty('--primary', primary);
      root.style.setProperty('--accent', accent);
      root.style.setProperty('--warning', warning);
      root.style.setProperty('--danger', danger);
    }
    return { primary, accent, warning, danger };
  });

  const headerTitle = PAGE_TITLES[currentPage] || 'Executive Dashboard';

  const showPage = useCallback((pageId) => {
    setCurrentPage(pageId);
    if (window.innerWidth <= 768) setSidebarOpen(false);
    window.scrollTo(0, 0);
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const collapseSidebar = useCallback(() => setSidebarCollapsed((c) => !c), []);

  const handleClientChange = useCallback((value) => {
    setCurrentClient(value === 'Select Client...' ? null : value);
    if (value && value !== 'Select Client...') {
      showNotification('Client switched to: ' + value);
    }
  }, []);

  const showNotification = useCallback((message, duration = 3000) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message, duration }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, duration);
  }, []);

  const updateBranding = useCallback((agencyName, agencyLogo) => {
    setBranding({ agencyName: agencyName || branding.agencyName, agencyLogo: agencyLogo ?? branding.agencyLogo });
    localStorage.setItem(STORAGE_KEYS.agencyName, agencyName || branding.agencyName);
    localStorage.setItem(STORAGE_KEYS.agencyLogo, agencyLogo ?? branding.agencyLogo);
    showNotification('Branding updated!');
  }, [branding.agencyName, branding.agencyLogo, showNotification]);

  const updateColors = useCallback((primary, accent, warning, danger) => {
    const root = document.documentElement;
    if (primary) {
      root.style.setProperty('--primary', primary);
      localStorage.setItem(STORAGE_KEYS.primaryColor, primary);
    }
    if (accent) {
      root.style.setProperty('--accent', accent);
      localStorage.setItem(STORAGE_KEYS.accentColor, accent);
    }
    if (warning) {
      root.style.setProperty('--warning', warning);
      localStorage.setItem(STORAGE_KEYS.warningColor, warning);
    }
    if (danger) {
      root.style.setProperty('--danger', danger);
      localStorage.setItem(STORAGE_KEYS.dangerColor, danger);
    }
    setColors((c) => ({
      primary: primary || c.primary,
      accent: accent || c.accent,
      warning: warning || c.warning,
      danger: danger || c.danger,
    }));
    showNotification('Colors updated!');
  }, [showNotification]);

  const resetSettings = useCallback(() => {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    setBranding({ agencyName: 'AgencyName', agencyLogo: 'A' });
    setColors({
      primary: '#ff0000',
      accent: '#10B981',
      warning: '#F59E0B',
      danger: '#EF4444',
    });
    document.documentElement.style.setProperty('--primary', '#ff0000');
    document.documentElement.style.setProperty('--accent', '#10B981');
    document.documentElement.style.setProperty('--warning', '#F59E0B');
    document.documentElement.style.setProperty('--danger', '#EF4444');
    showNotification('Settings reset.');
    setTimeout(() => window.location.reload(), 500);
  }, [showNotification]);

  useEffect(() => {
    const name = localStorage.getItem(STORAGE_KEYS.agencyName);
    const logo = localStorage.getItem(STORAGE_KEYS.agencyLogo);
    if (name) setBranding((b) => ({ ...b, agencyName: name }));
    if (logo) setBranding((b) => ({ ...b, agencyLogo: logo }));
  }, []);

  const value = {
    currentPage,
    setCurrentPage,
    showPage,
    headerTitle,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    sidebarCollapsed,
    collapseSidebar,
    currentClient,
    handleClientChange,
    showNotification,
    branding,
    updateBranding,
    colors,
    updateColors,
    resetSettings,
    clients: ['Select Client...', ...CLIENTS],
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
