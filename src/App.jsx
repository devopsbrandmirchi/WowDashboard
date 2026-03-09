import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useApp } from './context/AppContext';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { NotificationContainer } from './components/Notification';
import { DashboardPage } from './pages/DashboardPage';
import { GoogleAdsPage } from './pages/GoogleAdsPage';
import { MetaReportPage } from './pages/MetaReportPage';
import { TiktokReportPage } from './pages/TiktokReportPage';
import { RedditReportPage } from './pages/RedditReportPage';
import { CombinedReportPage } from './pages/CombinedReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { VimeoAnalyticsPage } from './pages/VimeoAnalyticsPage';
import { SubscriberIntelligencePage } from './pages/SubscriberIntelligencePage';

const PLACEHOLDER_PAGES = {
  'bing-ads':     { title: 'Bing Ads', subtitle: 'Microsoft Advertising Performance' },
};

const PATH_TO_PAGE = {
  '/': 'dashboard',
  '/subscriptions/analytics': 'subscriptions-analytics',
  '/subscriptions/subscribers': 'subscriptions-subscribers',
  '/combined-reporting': 'combined-reporting',
  '/google-ads': 'google-ads',
  '/meta-ads': 'meta-ads',
  '/bing-ads': 'bing-ads',
  '/tiktok-ads': 'tiktok-ads',
  '/reddit-ads': 'reddit-ads',
  '/settings': 'settings',
};

function CurrentPage({ forcePage }) {
  const { currentPage, setCurrentPage } = useApp();
  const location = useLocation();

  useEffect(() => {
    const pageFromPath = PATH_TO_PAGE[location.pathname];
    if (pageFromPath) setCurrentPage(pageFromPath);
  }, [location.pathname, setCurrentPage]);

  const page = forcePage || currentPage;

  if (page === 'dashboard') return <DashboardPage />;
  if (page === 'google-ads') return <GoogleAdsPage />;
  if (page === 'meta-ads') return <MetaReportPage />;
  if (page === 'tiktok-ads') return <TiktokReportPage />;
  if (page === 'reddit-ads') return <RedditReportPage />;
  if (page === 'combined-reporting') return <CombinedReportPage />;
  if (page === 'settings') return <SettingsPage />;
  if (page === 'subscriptions-analytics') return <VimeoAnalyticsPage />;
  if (page === 'subscriptions-subscribers') return <SubscriberIntelligencePage />;

  const config = PLACEHOLDER_PAGES[page];
  if (config) {
    return <PlaceholderPage title={config.title} subtitle={config.subtitle} />;
  }

  return <DashboardPage />;
}

function AppContent({ forcePage }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Header />
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
    if (isAuthenticated) {
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

  return (
    <>
      <Routes>
        <Route path="/subscriptions/analytics" element={<AppContent forcePage="subscriptions-analytics" />} />
        <Route path="/subscriptions/subscribers" element={<AppContent forcePage="subscriptions-subscribers" />} />
        <Route path="*" element={<AppContent />} />
      </Routes>
    </>
  );
}
