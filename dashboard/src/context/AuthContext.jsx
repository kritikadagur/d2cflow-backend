import { createContext, useContext, useState, useEffect } from 'react';
import { supabase, nukeLocalSupabaseSession } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If signOut just ran this session, don't let getSession() rehydrate a stale token.
    // Consume the flag once so a subsequent successful sign-in isn't broken.
    const wasSignedOut = localStorage.getItem('d2c_signed_out') === '1';
    if (wasSignedOut) {
      nukeLocalSupabaseSession();
      localStorage.removeItem('d2c_signed_out');
      setSession(null);
      setUser(null);
      setLoading(false);
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session) localStorage.setItem('d2c_session', JSON.stringify(session));
        setLoading(false);
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        localStorage.setItem('d2c_session', JSON.stringify(session));
        localStorage.removeItem('d2c_signed_out');
      } else {
        localStorage.removeItem('d2c_session');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async ({ email, password, brandName, phone }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { brand_name: brandName, phone } },
    });
    return { data, error };
  };

  const signIn = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  };

  const signInWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    console.log('[Google OAuth] data:', data, 'error:', error);
    if (error) return { data, error };
    if (!data?.url) return { data, error: { message: 'Google OAuth not configured in Supabase. Go to Supabase → Authentication → Providers → Google and enable it.' } };
    return { data, error };
  };

  const signInWithMagicLink = async (email) => {
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return { data, error };
  };

  const signOut = async () => {
    // Set the flag FIRST so if anything below races, next reload still respects it
    localStorage.setItem('d2c_signed_out', '1');

    // Nuke supabase-js token storage BEFORE calling signOut() — signOut()'s
    // network round-trip can hang or 401, but we still want the client-side
    // session gone unconditionally.
    nukeLocalSupabaseSession();

    // Clear our app's own cached state so a re-login starts fresh
    localStorage.removeItem('d2c_session');
    localStorage.removeItem('d2cflow_integrations');
    localStorage.removeItem('d2cflow_orders');
    localStorage.removeItem('d2cflow_products');
    localStorage.removeItem('d2cflow_crm_contacts');

    // Fire supabase.auth.signOut() but don't block on it
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise(res => setTimeout(res, 1500)),
      ]);
    } catch {}

    // Hard reload to home — location.replace prevents back-button restoring the app state
    window.location.replace('/');
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signInWithGoogle, signInWithMagicLink, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
