import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { STATIC_CREDENTIALS, AUTH_STORAGE_KEY } from '../config/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try {
      return localStorage.getItem(AUTH_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      if (isAuthenticated) {
        localStorage.setItem(AUTH_STORAGE_KEY, 'true');
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (_) {}
  }, [isAuthenticated]);

  const login = useCallback((username, password) => {
    const ok =
      String(username).trim() === STATIC_CREDENTIALS.username &&
      String(password) === STATIC_CREDENTIALS.password;
    if (ok) {
      setIsAuthenticated(true);
      return { success: true };
    }
    return { success: false, error: 'Invalid username or password' };
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  const value = { isAuthenticated, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
