import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

export function Header() {
  const { headerTitle, toggleSidebar, sidebarCollapsed, collapseSidebar, showNotification } = useApp();
  const { logout } = useAuth();

  const handleExportPDF = () => {
    showNotification('PDF export would be generated here. This feature requires server-side processing or a PDF library like jsPDF.');
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Agency Dashboard Report',
        text: 'Check out this marketing performance report!',
        url: window.location.href,
      }).catch(() => fallbackShare());
    } else {
      fallbackShare();
    }
  };

  const fallbackShare = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      showNotification('Report link copied to clipboard!');
    }).catch(() => {
      showNotification('Share URL: ' + window.location.href);
    });
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
          ◀
        </button>
        <h1 id="headerTitle">{headerTitle}</h1>
      </div>
      <div className="header-right">
        <div className="header-filters" id="headerFilters">
          <select id="sb-customer-select">
            <option value="ALL">All Customers</option>
          </select>
          <select id="sb-date-range-select">
            <option value="all" defaultValue>All Data</option>
            <option value="7">Last 7 Days</option>
            <option value="14">Last 14 Days</option>
            <option value="30">Last 30 Days</option>
          </select>
          <span id="sb-sync-badge" style={{ color: '#10b981', fontSize: 11, fontWeight: 600 }}>Live</span>
        </div>
        <button type="button" className="btn btn-outline" onClick={handleExportPDF}>↓ Export PDF</button>
        <button type="button" className="btn btn-primary" onClick={handleShare}>Share Report</button>
        <button type="button" className="btn btn-outline" onClick={logout} title="Sign out">Log out</button>
      </div>
    </header>
  );
}
