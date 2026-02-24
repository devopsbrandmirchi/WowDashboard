import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function LoginPage({ onSwitchToSignup }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.success) return;
      setError(result.error || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>WowDashboard</h1>
        <p className="login-subtitle">Sign in to your reporting suite</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="settings-form-group">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
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
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-login"
            disabled={submitting}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          {onSwitchToSignup && (
            <p className="auth-switch">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="auth-switch-link"
                onClick={onSwitchToSignup}
              >
                Create account
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
