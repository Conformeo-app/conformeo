import type { Session } from '@supabase/supabase-js';
import { requireSupabaseClient } from '../supabase/client';

export const auth = {
  async signIn(email: string, password: string): Promise<Session> {
    const client = requireSupabaseClient();

    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.session) {
      throw new Error('Aucune session reçue après connexion.');
    }

    return data.session;
  },

  async signInWithMagicLink(email: string): Promise<void> {
    const client = requireSupabaseClient();
    const { error } = await client.auth.signInWithOtp({
      email: email.trim()
    });

    if (error) {
      throw new Error(error.message);
    }
  },

  async signOut(): Promise<void> {
    const client = requireSupabaseClient();
    const { error } = await client.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }
  },

  async getSession(): Promise<Session | null> {
    const client = requireSupabaseClient();
    const {
      data: { session },
      error
    } = await client.auth.getSession();

    if (error) {
      throw new Error(error.message);
    }

    return session;
  },

  async refreshSession(): Promise<Session | null> {
    const client = requireSupabaseClient();
    const { data, error } = await client.auth.refreshSession();

    if (error) {
      throw new Error(error.message);
    }

    return data.session;
  }
};
