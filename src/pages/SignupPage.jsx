import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function SignupPage({ onSwitchToLogin }) {
  const { signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    setSuccess(false);
    try {
      const result = await signup(email, password, fullName);
      if (result.success) {
        setSuccess(true);
        return;
      }
      setError(result.error || 'Sign up failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>WowDashboard</h1>
          <p className="login-subtitle">Check your email</p>
          <p className="signup-success-msg">
            We&apos;ve sent a confirmation link to <strong>{email}</strong>.
            Click it to verify your account, then sign in below.
          </p>
          {onSwitchToLogin && (
            <button
              type="button"
              className="btn btn-primary btn-login"
              onClick={onSwitchToLogin}
            >
              Go to sign in
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>WowDashboard</h1>
        <p className="login-subtitle">Create your account</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="settings-form-group">
            <label htmlFor="signup-fullname">Full name</label>
            <input
              id="signup-fullname"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="settings-form-group">
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="settings-form-group">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-login"
            disabled={submitting}
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          {onSwitchToLogin && (
            <p className="auth-switch">
              Already have an account?{' '}
              <button
                type="button"
                className="auth-switch-link"
                onClick={onSwitchToLogin}
              >
                Sign in
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
