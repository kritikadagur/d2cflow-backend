import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder';

// Fixed storage key so we can nuke the session ourselves on signOut
const STORAGE_KEY = 'd2c_sb_auth';

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: STORAGE_KEY,
  },
});

// Called by signOut() to guarantee the session token is gone even if
// supabase.auth.signOut() network call is slow or blocked.
export function nukeLocalSupabaseSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // Belt-and-suspenders: strip anything supabase-js may have written
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-') || k.includes('supabase'))
      .forEach(k => localStorage.removeItem(k));
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('sb-') || k === STORAGE_KEY || k.includes('supabase'))
      .forEach(k => sessionStorage.removeItem(k));
  } catch {}
}
