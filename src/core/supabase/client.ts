import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSecureValue, removeSecureValue, setSecureValue } from '../security/secureStore';
import { appEnv } from '../env';

let supabaseClient: SupabaseClient | null = null;

const authStorage = {
  getItem: (key: string) => getSecureValue(key),
  setItem: (key: string, value: string) => setSecureValue(key, value),
  removeItem: (key: string) => removeSecureValue(key)
};

export function getSupabaseClient() {
  if (!appEnv.isSupabaseConfigured) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(appEnv.supabaseUrl!, appEnv.supabaseAnonKey!, {
      auth: {
        persistSession: true,
        storage: authStorage,
        storageKey: 'conformeo.auth.token',
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }

  return supabaseClient;
}

export function requireSupabaseClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase is not configured. Define EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }
  return client;
}
