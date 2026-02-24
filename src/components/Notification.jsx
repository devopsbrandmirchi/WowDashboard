import { useApp } from '../context/AppContext';

const containerStyle = {
  position: 'fixed',
  top: 80,
  right: 20,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const itemStyle = {
  background: 'var(--primary)',
  color: 'white',
  padding: '12px 20px',
  borderRadius: 8,
  boxShadow: 'var(--shadow-lg)',
  fontSize: 13,
  fontWeight: 500,
  minWidth: 250,
  animation: 'slideIn 0.3s ease',
};

export function NotificationContainer() {
  const { notifications = [] } = useApp();
  if (!notifications.length) return null;
  return (
    <div style={containerStyle} aria-live="polite">
      {notifications.map((n) => (
        <div key={n.id} style={itemStyle} role="status">
          {n.message}
        </div>
      ))}
    </div>
  );
}
