import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const result = login(username, password);
    if (result.success) return;
    setError(result.error || 'Login failed');
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>WowDashboard</h1>
        <p className="login-subtitle">Sign in to your reporting suite</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="settings-form-group">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
            />
          </div>
          <div className="settings-form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-login">
            Sign in
          </button>
          {error && <div className="login-error" role="alert">{error}</div>}
        </form>
      </div>
    </div>
  );
}
