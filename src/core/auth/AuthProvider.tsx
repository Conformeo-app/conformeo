import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { appEnv } from '../env';
import { getSupabaseClient } from '../supabase/client';

type AuthContextValue = {
  isConfigured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  activeOrgId: string | null;
  hasMembership: boolean | null;
  signInWithPassword: (input: { email: string; password: string }) => Promise<void>;
  signUpWithPassword: (
    input: { email: string; password: string }
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  bootstrapOrganization: (orgName: string) => Promise<void>;
  refreshMembership: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function ensureProfile(user: User) {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  const fallbackDisplayName = user.email?.split('@')[0] ?? 'Utilisateur';
  const displayName =
    typeof user.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : fallbackDisplayName;

  const { error } = await client
    .from('profiles')
    .upsert({ user_id: user.id, display_name: displayName }, { onConflict: 'user_id' });

  if (error && __DEV__) {
    console.warn('Unable to upsert profile:', error.message);
  }
}

async function resolveMembership(userId: string) {
  const client = getSupabaseClient();
  if (!client) {
    return { activeOrgId: null, hasMembership: null as boolean | null };
  }

  const { data, error } = await client
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (__DEV__) {
      console.warn('Unable to resolve membership:', error.message);
    }
    return { activeOrgId: null, hasMembership: false };
  }

  return {
    activeOrgId: data?.org_id ?? null,
    hasMembership: Boolean(data?.org_id)
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [hasMembership, setHasMembership] = useState<boolean | null>(null);

  const syncFromSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);

    if (!nextSession?.user) {
      setActiveOrgId(null);
      setHasMembership(false);
      setLoading(false);
      return;
    }

    await ensureProfile(nextSession.user);
    const membership = await resolveMembership(nextSession.user.id);
    setActiveOrgId(membership.activeOrgId);
    setHasMembership(membership.hasMembership);
    setLoading(false);
  }, []);

  const refreshMembership = useCallback(async () => {
    if (!session?.user) {
      setActiveOrgId(null);
      setHasMembership(false);
      return;
    }

    const membership = await resolveMembership(session.user.id);
    setActiveOrgId(membership.activeOrgId);
    setHasMembership(membership.hasMembership);
  }, [session]);

  useEffect(() => {
    const client = getSupabaseClient();

    if (!client) {
      setLoading(false);
      setSession(null);
      setActiveOrgId(null);
      setHasMembership(null);
      return;
    }

    let alive = true;

    (async () => {
      const {
        data: { session: initialSession }
      } = await client.auth.getSession();

      if (!alive) {
        return;
      }

      await syncFromSession(initialSession);
    })();

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setLoading(true);
      void syncFromSession(nextSession);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [syncFromSession]);

  const signInWithPassword = useCallback(async (input: { email: string; password: string }) => {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase non configure.');
    }

    const { error } = await client.auth.signInWithPassword({
      email: input.email.trim(),
      password: input.password
    });

    if (error) {
      throw new Error(error.message);
    }
  }, []);

  const signUpWithPassword = useCallback(
    async (input: { email: string; password: string }) => {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error('Supabase non configure.');
      }

      const { data, error } = await client.auth.signUp({
        email: input.email.trim(),
        password: input.password
      });

      if (error) {
        throw new Error(error.message);
      }

      // If email confirmation is enabled, Supabase returns no session yet.
      return { needsEmailConfirmation: !data.session };
    },
    []
  );

  const signOut = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) {
      return;
    }

    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  }, []);

  const bootstrapOrganization = useCallback(
    async (orgName: string) => {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error('Supabase non configure.');
      }
      if (!session?.user) {
        throw new Error('Session utilisateur absente.');
      }

      const cleanName = orgName.trim();
      if (cleanName.length < 2) {
        throw new Error('Nom d\'organisation trop court.');
      }

      const { data: orgId, error: bootstrapError } = await client.rpc('bootstrap_organization', {
        org_name: cleanName
      });

      if (bootstrapError) {
        throw new Error(bootstrapError.message);
      }

      if (!orgId) {
        throw new Error('Bootstrap organization returned no org id.');
      }

      await refreshMembership();
    },
    [refreshMembership, session]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: appEnv.isSupabaseConfigured,
      loading,
      session,
      user: session?.user ?? null,
      activeOrgId,
      hasMembership,
      signInWithPassword,
      signUpWithPassword,
      signOut,
      bootstrapOrganization,
      refreshMembership
    }),
    [
      activeOrgId,
      bootstrapOrganization,
      hasMembership,
      loading,
      refreshMembership,
      session,
      signInWithPassword,
      signOut,
      signUpWithPassword
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
