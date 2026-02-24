export function PlaceholderPage({ title, subtitle = 'Coming soon' }) {
  return (
    <div className="page-section active">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="insight-banner info">
          <span className="icon">🚧</span>
          <div>This page is being loaded. Please refer to the complete dashboard.</div>
        </div>
      </div>
    </div>
  );
}
