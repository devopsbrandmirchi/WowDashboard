import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

const DEV_BYPASS = import.meta.env.DEV;
const AUTH_BYPASS = import.meta.env.VITE_AUTH_BYPASS === 'true' || import.meta.env.VITE_AUTH_BYPASS === '1';
const SUPABASE_TIMEOUT_MS = 5000;

const BYPASS_USER = { email: 'guest@localhost', user_metadata: { full_name: 'Guest' } };

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase connection timed out')), ms)),
  ]);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(AUTH_BYPASS ? BYPASS_USER : null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(!AUTH_BYPASS);
  const [devMode, setDevMode] = useState(AUTH_BYPASS);

  const isAuthenticated = !!session || devMode;

  useEffect(() => {
    if (AUTH_BYPASS) return;
    withTimeout(supabase.auth.getSession(), SUPABASE_TIMEOUT_MS)
      .then(({ data: { session: s } }) => {
        if (s) {
          setSession(s);
          setUser(s?.user ?? null);
        } else if (DEV_BYPASS) {
          console.info('Dev mode: no session found, bypassing auth');
          setDevMode(true);
          setUser({ email: 'dev@localhost', user_metadata: { full_name: 'Dev User' } });
        }
      })
      .catch((err) => {
        console.warn('Supabase unavailable:', err.message);
        if (DEV_BYPASS) {
          console.info('Dev mode: bypassing auth');
          setDevMode(true);
          setUser({ email: 'dev@localhost', user_metadata: { full_name: 'Dev User' } });
        }
      })
      .finally(() => setLoading(false));

    let subscription;
    try {
      const resp = supabase.auth.onAuthStateChange((_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        setLoading(false);
      });
      subscription = resp.data.subscription;
    } catch (err) {
      console.warn('Supabase onAuthStateChange failed:', err.message);
    }

    return () => subscription?.unsubscribe();
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: String(email).trim(),
          password: String(password),
        }),
        SUPABASE_TIMEOUT_MS,
      );
      if (error) {
        return { success: false, error: error.message };
      }
      setDevMode(false);
      setSession(data.session);
      setUser(data.user);
      return { success: true };
    } catch {
      if (DEV_BYPASS) {
        setDevMode(true);
        setUser({ email: String(email).trim(), user_metadata: { full_name: 'Dev User' } });
        return { success: true };
      }
      return { success: false, error: 'Cannot reach authentication server. Check your connection or Supabase project status.' };
    }
  }, []);

  const signup = useCallback(async (email, password, fullName = '') => {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: String(email).trim(),
          password: String(password),
          options: {
            data: {
              full_name: fullName ? String(fullName).trim() : null,
            },
          },
        }),
        SUPABASE_TIMEOUT_MS,
      );
      if (error) {
        return { success: false, error: error.message };
      }
      setDevMode(false);
      setSession(data.session);
      setUser(data.user);
      return { success: true };
    } catch {
      if (DEV_BYPASS) {
        setDevMode(true);
        setUser({ email: String(email).trim(), user_metadata: { full_name: fullName || 'Dev User' } });
        return { success: true };
      }
      return { success: false, error: 'Cannot reach authentication server. Check your connection or Supabase project status.' };
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut().catch(() => {});
    setSession(null);
    setUser(null);
    setDevMode(false);
  }, []);

  const value = {
    isAuthenticated,
    user,
    session,
    loading,
    login,
    signup,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
