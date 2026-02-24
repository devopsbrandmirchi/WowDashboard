import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const isAuthenticated = !!session;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email).trim(),
      password: String(password),
    });
    if (error) {
      return { success: false, error: error.message };
    }
    setSession(data.session);
    setUser(data.user);
    return { success: true };
  }, []);

  const signup = useCallback(async (email, password, fullName = '') => {
    const { data, error } = await supabase.auth.signUp({
      email: String(email).trim(),
      password: String(password),
      options: {
        data: {
          full_name: fullName ? String(fullName).trim() : null,
        },
      },
    });
    if (error) {
      return { success: false, error: error.message };
    }
    setSession(data.session);
    setUser(data.user);
    return { success: true };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
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
