import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Retrieve credentials from environment variables or localStorage with fallback
export function getStoredSupabaseConfig() {
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
  const localUrl = typeof window !== 'undefined' ? localStorage.getItem('AITRADER_SUPABASE_URL') : null;
  const localKey = typeof window !== 'undefined' ? localStorage.getItem('AITRADER_SUPABASE_KEY') : null;

  const url = envUrl || localUrl || 'https://xyzcompany.supabase.co';
  const key = envKey || localKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

  return { url, key };
}

let supabaseInstance: SupabaseClient | null = null;
let currentUrl: string = '';
let currentKey: string = '';

export function getSupabase(): SupabaseClient {
  const { url, key } = getStoredSupabaseConfig();
  if (!supabaseInstance || currentUrl !== url || currentKey !== key) {
    currentUrl = url;
    currentKey = key;
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return supabaseInstance;
}

export function isSupabaseConfigured(): boolean {
  const { url, key } = getStoredSupabaseConfig();
  return (
    Boolean(url) &&
    Boolean(key) &&
    !url.includes('xyzcompany.supabase.co') &&
    !url.includes('YOUR_PROJECT_ID') &&
    !url.includes('your-project.supabase.co') &&
    !key.includes('...')
  );
}

export function saveSupabaseConfig(url: string, key: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('AITRADER_SUPABASE_URL', url.trim());
    localStorage.setItem('AITRADER_SUPABASE_KEY', key.trim());
  }
  currentUrl = url.trim();
  currentKey = key.trim();
  supabaseInstance = createClient(currentUrl, currentKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return supabaseInstance;
}

export const supabase = getSupabase();
