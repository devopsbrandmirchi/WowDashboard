import { useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useApp } from './context/AppContext';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { NotificationContainer } from './components/Notification';
import { DashboardPage } from './pages/DashboardPage';
import { GoogleAdsPage } from './pages/GoogleAdsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

const PLACEHOLDER_PAGES = {
  'meta-ads':     { title: 'Meta Ads Performance', subtitle: 'Coming soon - Full Meta Ads analytics' },
  'bing-ads':     { title: 'Bing Ads', subtitle: 'Microsoft Advertising Performance' },
  'tiktok-ads':   { title: 'TikTok Ads', subtitle: 'TikTok Campaign Performance' },
  'reddit-ads':   { title: 'Reddit Ads', subtitle: 'Reddit Campaign Performance' },
  'amazon-ads':   { title: 'Amazon Ads', subtitle: 'Amazon Advertising Performance' },
  'dsp':          { title: 'DSP / Programmatic', subtitle: 'The Trade Desk & DV360 Performance' },
  'dating-apps':  { title: 'Dating Apps', subtitle: 'Direct Buy Performance' },
  'ctv':          { title: 'CTV Campaigns', subtitle: 'Connected TV Performance' },
  'ga4':          { title: 'GA4 / Web Analytics', subtitle: 'Website Performance Data' },
  'email':        { title: 'Email Marketing', subtitle: 'Email Campaign Performance' },
  'ghl':          { title: 'GoHighLevel', subtitle: 'CRM Performance Metrics' },
  'ott':          { title: 'OTT / Vimeo', subtitle: 'Video Streaming Performance' },
  'seo':          { title: 'SEO Performance', subtitle: 'Organic Search Rankings' },
  'geo':          { title: 'Geographic View', subtitle: 'Performance by Location' },
  'creatives':    { title: 'Creative Analysis', subtitle: 'Ad Creative Performance' },
  'events':       { title: 'Events / Special', subtitle: 'Special Campaign Performance' },
};

function CurrentPage() {
  const { currentPage } = useApp();

  if (currentPage === 'dashboard') return <DashboardPage />;
  if (currentPage === 'google-ads') return <GoogleAdsPage />;
  if (currentPage === 'settings') return <SettingsPage />;

  const config = PLACEHOLDER_PAGES[currentPage];
  if (config) {
    return <PlaceholderPage title={config.title} subtitle={config.subtitle} />;
  }

  return <DashboardPage />;
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
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Header />
        <CurrentPage />
      </main>
      <NotificationContainer />
    </div>
  );
}
