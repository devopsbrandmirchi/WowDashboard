import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useApp } from './context/AppContext';
import { useUserPermissions } from './hooks/useUserPermissions';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { NotificationContainer } from './components/Notification';
import { DashboardPage } from './pages/DashboardPage';
import { GoogleAdsPage } from './pages/GoogleAdsPage';
import { GoogleAdsCountryPage } from './pages/GoogleAdsCountryPage';
import { MetaReportPage } from './pages/MetaReportPage';
import { MetaAdsCountryPage } from './pages/MetaAdsCountryPage';
import { TiktokReportPage } from './pages/TiktokReportPage';
import { RedditReportPage } from './pages/RedditReportPage';
import { RedditAdsCountryPage } from './pages/RedditAdsCountryPage';
import { MicrosoftAdsReportPage } from './pages/MicrosoftAdsReportPage';
import { MicrosoftAdsCountryPage } from './pages/MicrosoftAdsCountryPage';
import { TiktokAdsCountryPage } from './pages/TiktokAdsCountryPage';
import { CombinedReportPage } from './pages/CombinedReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { RolesPermissionsPage } from './pages/RolesPermissionsPage';
import { UsersPage } from './pages/UsersPage';
import { GoogleCampaignsReferencePage } from './pages/GoogleCampaignsReferencePage';
import { RedditCampaignsReferencePage } from './pages/RedditCampaignsReferencePage';
import { TiktokCampaignsReferencePage } from './pages/TiktokCampaignsReferencePage';
import { FacebookCampaignsReferencePage } from './pages/FacebookCampaignsReferencePage';
import { FacebookAdsetReferencePage } from './pages/FacebookAdsetReferencePage';
import { MicrosoftCampaignsReferencePage } from './pages/MicrosoftCampaignsReferencePage';
import { ProfilePage } from './pages/ProfilePage';
import { VimeoAnalyticsPage } from './pages/VimeoAnalyticsPage';
import { SubscriberIntelligencePage } from './pages/SubscriberIntelligencePage';
import { DatingAppSubscriptionDataPage } from './pages/DatingAppSubscriptionDataPage';
import { HubspotEmailMarketingPage } from './pages/subscriptions/HubspotEmailMarketingPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { invokeEdgeFunction } from './lib/supabase.js';
import { getFacebookOAuthRedirectUri } from './lib/facebookOAuth.js';
import { MAINTENANCE_ONLY_MODE } from './config/maintenance.js';

const PATH_TO_PAGE = {
  '/': 'dashboard',
  '/subscriptions/analytics': 'subscriptions-analytics',
  '/subscriptions/subscribers': 'subscriptions-subscribers',
  '/subscriptions/dating-apps': 'subscriptions-dating-apps',
  '/subscriptions/hubspot-email': 'subscriptions-hubspot-email',
  '/combined-reporting': 'combined-reporting',
  '/google-ads': 'google-ads',
  '/google-ads-country': 'google-ads-country',
  '/meta-ads': 'meta-ads',
  '/meta-ads-country': 'meta-ads-country',
  '/bing-ads': 'bing-ads',
  '/bing-ads-country': 'bing-ads-country',
  '/tiktok-ads': 'tiktok-ads',
  '/tiktok-ads-country': 'tiktok-ads-country',
  '/reddit-ads': 'reddit-ads',
  '/reddit-ads-country': 'reddit-ads-country',
  '/settings': 'settings',
  '/settings/roles-permissions': 'roles-permissions',
  '/settings/users': 'users',
  '/settings/google-campaigns-reference': 'google-campaigns-reference',
  '/settings/reddit-campaigns-reference': 'reddit-campaigns-reference',
  '/settings/tiktok-campaigns-reference': 'tiktok-campaigns-reference',
  '/settings/facebook-campaigns-reference': 'facebook-campaigns-reference',
  '/settings/facebook-adset-reference': 'facebook-adset-reference',
  '/settings/microsoft-campaigns-reference': 'microsoft-campaigns-reference',
  '/maintenance': 'maintenance',
  '/profile': 'profile',
};

const PAGE_TITLES = {
  'dashboard': 'Executive Dashboard',
  'combined-reporting': 'Combined Reporting',
  'google-ads': 'Google Ads',
  'google-ads-country': 'Google Ads Country',
  'meta-ads': 'Meta Ads',
  'meta-ads-country': 'Meta Ads Country',
  'bing-ads': 'Microsoft Ads',
  'bing-ads-country': 'Microsoft Ads Country',
  'tiktok-ads': 'TikTok Ads',
  'tiktok-ads-country': 'TikTok Ads Country',
  'reddit-ads': 'Reddit Ads',
  'reddit-ads-country': 'Reddit Ads Country',
  'settings': 'White-Label Settings',
  'roles-permissions': 'Roles & Permissions',
  'users': 'Users',
  'google-campaigns-reference': 'Google Campaigns Reference',
  'reddit-campaigns-reference': 'Reddit Campaigns Reference',
  'tiktok-campaigns-reference': 'TikTok Campaigns Reference',
  'facebook-campaigns-reference': 'Facebook Campaigns Reference',
  'facebook-adset-reference': 'Facebook Adset Reference',
  'microsoft-campaigns-reference': 'Microsoft Campaigns Reference',
  'maintenance': 'System Maintenance',
  'profile': 'Profile',
  'subscriptions-analytics': 'Subscription Analytics',
  'subscriptions-subscribers': 'Subscriber Intelligence',
  'subscriptions-dating-apps': 'Dating app subscription data',
  'subscriptions-hubspot-email': 'HubSpot email marketing',
};

function CurrentPage({ forcePage }) {
  const { currentPage, setCurrentPage, branding } = useApp();
  const location = useLocation();

  useEffect(() => {
    const pageFromPath = PATH_TO_PAGE[location.pathname];
    if (pageFromPath) setCurrentPage(pageFromPath);
  }, [location.pathname, setCurrentPage]);

  const page = forcePage || currentPage;

  useEffect(() => {
    const pageTitle = PAGE_TITLES[page] || 'Dashboard';
    const appName = branding?.agencyName || 'Digital Analytics Dashboard';
    document.title = `${pageTitle} — ${appName}`;
  }, [page, branding?.agencyName]);

  if (page === 'dashboard') return <DashboardPage />;
  if (page === 'google-ads') return <GoogleAdsPage />;
  if (page === 'google-ads-country') return <GoogleAdsCountryPage />;
  if (page === 'meta-ads') return <MetaReportPage />;
  if (page === 'meta-ads-country') return <MetaAdsCountryPage />;
  if (page === 'tiktok-ads') return <TiktokReportPage />;
  if (page === 'tiktok-ads-country') return <TiktokAdsCountryPage />;
  if (page === 'reddit-ads') return <RedditReportPage />;
  if (page === 'reddit-ads-country') return <RedditAdsCountryPage />;
  if (page === 'bing-ads') return <MicrosoftAdsReportPage />;
  if (page === 'bing-ads-country') return <MicrosoftAdsCountryPage />;
  if (page === 'combined-reporting') return <CombinedReportPage />;
  if (page === 'settings') return <SettingsPage />;
  if (page === 'roles-permissions') return <RolesPermissionsPage />;
  if (page === 'users') return <UsersPage />;
  if (page === 'google-campaigns-reference') return <GoogleCampaignsReferencePage />;
  if (page === 'reddit-campaigns-reference') return <RedditCampaignsReferencePage />;
  if (page === 'tiktok-campaigns-reference') return <TiktokCampaignsReferencePage />;
  if (page === 'facebook-campaigns-reference') return <FacebookCampaignsReferencePage />;
  if (page === 'facebook-adset-reference') return <FacebookAdsetReferencePage />;
  if (page === 'microsoft-campaigns-reference') return <MicrosoftCampaignsReferencePage />;
  if (page === 'profile') return <ProfilePage />;
  if (page === 'subscriptions-analytics') return <VimeoAnalyticsPage />;
  if (page === 'subscriptions-subscribers') return <SubscriberIntelligencePage />;
  if (page === 'subscriptions-dating-apps') return <DatingAppSubscriptionDataPage />;
  if (page === 'subscriptions-hubspot-email') return <HubspotEmailMarketingPage />;
  if (page === 'maintenance') return <MaintenancePage />;

  return <DashboardPage />;
}

function MaintenanceOnlyShell() {
  const location = useLocation();
  const { branding } = useApp();

  useEffect(() => {
    const appName = branding?.agencyName || 'Digital Analytics Dashboard';
    document.title = `System Maintenance — ${appName}`;
  }, [branding?.agencyName]);

  if (location.pathname !== '/') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="maintenance-landing-shell">
      <MaintenancePage />
      <NotificationContainer />
    </div>
  );
}

function AppContent({ forcePage }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isSettingsRoot = location.pathname === '/settings';
  const { canAccessSidebar, loading: permissionsLoading } = useUserPermissions();
  const { showNotification } = useApp();

  /** Facebook OAuth returns ?code=&state= on the document URL (before #). Exchange once and open Settings → Meta. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error');
    const oauthDesc = params.get('error_description');

    if (oauthError) {
      const msg = oauthDesc
        ? decodeURIComponent(oauthDesc.replace(/\+/g, ' '))
        : oauthError;
      showNotification(`Meta login cancelled or failed: ${msg}`);
      const u = new URL(window.location.href);
      u.search = '';
      window.history.replaceState(null, document.title, u.href);
      return;
    }

    if (!code || !state) return;

    const expected = sessionStorage.getItem('fb_oauth_state');
    if (!expected || state !== expected) return;

    const startedKey = `fb_oauth_started_${state}`;
    if (sessionStorage.getItem(startedKey)) return;
    sessionStorage.setItem(startedKey, '1');

    (async () => {
      try {
        const redirectUri = getFacebookOAuthRedirectUri();
        const { data, error } = await invokeEdgeFunction('exchange-facebook-oauth-code', {
          code,
          redirect_uri: redirectUri,
        });
        if (error) throw error;
        if (data?.error) {
          throw new Error(typeof data.message === 'string' ? data.message : String(data.error));
        }

        sessionStorage.removeItem('fb_oauth_state');
        sessionStorage.setItem('wow_settings_nav_after_oauth', 'meta');
        showNotification(typeof data?.message === 'string' ? data.message : 'Meta connected.');

        const u = new URL(window.location.href);
        u.search = '';
        u.hash = '#/settings';
        window.history.replaceState(null, document.title, u.href);
        navigate('/settings', { replace: true, state: { openMetaOAuth: true } });
      } catch (e) {
        sessionStorage.removeItem(startedKey);
        showNotification(e?.message || String(e) || 'Meta OAuth failed.');
        const u = new URL(window.location.href);
        u.search = '';
        window.history.replaceState(null, document.title, u.href);
      }
    })();
  }, [navigate, showNotification]);

  useEffect(() => {
    if (permissionsLoading) return;
    const path = location.pathname;
    if (path === '/settings/users' && !canAccessSidebar('users')) {
      navigate('/', { replace: true });
    } else if (path === '/settings/roles-permissions' && !canAccessSidebar('roles-permissions')) {
      navigate('/', { replace: true });
    } else if (path === '/settings' && !canAccessSidebar('settings')) {
      navigate('/', { replace: true });
    } else if (path === '/settings/google-campaigns-reference' && !canAccessSidebar('google-campaigns-reference')) {
      navigate('/', { replace: true });
    } else if (path === '/settings/reddit-campaigns-reference' && !canAccessSidebar('reddit-campaigns-reference')) {
      navigate('/', { replace: true });
    } else if (path === '/settings/tiktok-campaigns-reference' && !canAccessSidebar('tiktok-campaigns-reference')) {
      navigate('/', { replace: true });
    } else if (path === '/settings/facebook-campaigns-reference' && !canAccessSidebar('facebook-campaigns-reference')) {
      navigate('/', { replace: true });
    } else if (path === '/settings/facebook-adset-reference' && !canAccessSidebar('facebook-adset-reference')) {
      navigate('/', { replace: true });
    } else if (path === '/settings/microsoft-campaigns-reference' && !canAccessSidebar('microsoft-campaigns-reference')) {
      navigate('/', { replace: true });
    } else if (path === '/maintenance' && !canAccessSidebar('maintenance')) {
      navigate('/', { replace: true });
    }
  }, [location.pathname, canAccessSidebar, navigate, permissionsLoading]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className={`main-content${isSettingsRoot ? ' main-content--settings' : ''}`}>
        {!isSettingsRoot && <Header />}
        <CurrentPage forcePage={forcePage} />
      </main>
      <NotificationContainer />
    </div>
  );
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();
  const { showNotification } = useApp();
  const [authView, setAuthView] = useState('login'); // 'login' | 'signup'

  useEffect(() => {
    if (isAuthenticated && !MAINTENANCE_ONLY_MODE) {
      showNotification('Welcome to your Agency Dashboard!');
    }
  }, [isAuthenticated, showNotification]);

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-subtitle">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (authView === 'signup') {
      return (
        <SignupPage onSwitchToLogin={() => setAuthView('login')} />
      );
    }
    return (
      <LoginPage onSwitchToSignup={() => setAuthView('signup')} />
    );
  }

  if (MAINTENANCE_ONLY_MODE) {
    return (
      <Routes>
        <Route path="/" element={<MaintenanceOnlyShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/subscriptions/analytics" element={<AppContent forcePage="subscriptions-analytics" />} />
        <Route path="/subscriptions/dating-apps" element={<AppContent forcePage="subscriptions-dating-apps" />} />
        <Route path="/subscriptions/hubspot-email" element={<AppContent forcePage="subscriptions-hubspot-email" />} />
        <Route path="/settings/roles-permissions" element={<AppContent forcePage="roles-permissions" />} />
        <Route path="/settings/users" element={<AppContent forcePage="users" />} />
        <Route path="/settings/google-campaigns-reference" element={<AppContent forcePage="google-campaigns-reference" />} />
        <Route path="/settings/reddit-campaigns-reference" element={<AppContent forcePage="reddit-campaigns-reference" />} />
        <Route path="/settings/tiktok-campaigns-reference" element={<AppContent forcePage="tiktok-campaigns-reference" />} />
        <Route path="/settings/facebook-campaigns-reference" element={<AppContent forcePage="facebook-campaigns-reference" />} />
        <Route path="/settings/facebook-adset-reference" element={<AppContent forcePage="facebook-adset-reference" />} />
        <Route path="/settings/microsoft-campaigns-reference" element={<AppContent forcePage="microsoft-campaigns-reference" />} />
        <Route path="/settings" element={<AppContent forcePage="settings" />} />
        <Route path="/maintenance" element={<AppContent forcePage="maintenance" />} />
        <Route path="*" element={<AppContent />} />
      </Routes>
    </>
  );
}
