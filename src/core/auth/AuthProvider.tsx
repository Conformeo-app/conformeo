import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AppRole,
  MfaEnrollment,
  SessionAuditEntry,
  UserProfile,
  auth as securityAuth,
  identity,
  mfa,
  rbac,
  sessions
} from '../identity-security';
import { mapMemberRoleToAppRole, resolveMembership, toErrorMessage } from '../identity-security/utils';
import { appEnv } from '../env';
import { getSupabaseClient } from '../supabase/client';
import { flags } from '../../data/feature-flags';
import { quotas } from '../../data/quotas-limits';
import { share } from '../../data/external-sharing';
import { audit } from '../../data/audit-compliance';
import { governance } from '../../data/data-governance';
import { rules } from '../../data/rules-engine';
import { geo } from '../../data/geo-context';
import { projects } from '../../data/projects';

type AuthContextValue = {
  isConfigured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  activeOrgId: string | null;
  hasMembership: boolean | null;
  role: AppRole | null;
  permissions: string[];
  profile: UserProfile | null;
  requiresMfaEnrollment: boolean;
  pendingMfaEnrollment: MfaEnrollment | null;
  signInWithPassword: (input: { email: string; password: string }) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signUpWithPassword: (
    input: { email: string; password: string }
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<Session | null>;
  bootstrapOrganization: (orgName: string) => Promise<void>;
  refreshMembership: () => Promise<void>;
  refreshAuthorization: () => Promise<void>;
  enrollAdminMfa: () => Promise<MfaEnrollment>;
  verifyAdminMfa: (code: string) => Promise<void>;
  disableMfa: () => Promise<void>;
  listSessions: () => Promise<SessionAuditEntry[]>;
  revokeSession: (sessionId: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [hasMembership, setHasMembership] = useState<boolean | null>(null);
  const [memberRole, setMemberRole] = useState<string | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [requiresMfaEnrollment, setRequiresMfaEnrollment] = useState(false);
  const [pendingMfaEnrollment, setPendingMfaEnrollment] = useState<MfaEnrollment | null>(null);

  const resetSecurityState = useCallback(() => {
    rbac.clearCache();
    flags.setContext({ org_id: undefined, user_id: undefined });
    quotas.setContext({ org_id: undefined, user_id: undefined });
    share.setContext({ org_id: undefined, user_id: undefined });
    audit.setContext({ org_id: undefined, user_id: undefined });
    governance.setContext({ org_id: undefined, user_id: undefined });
    rules.setContext({ org_id: undefined, user_id: undefined });
    geo.setContext({ org_id: undefined, user_id: undefined });
    projects.setContext({ org_id: undefined });
    setRole(null);
    setPermissions([]);
    setProfile(null);
    setRequiresMfaEnrollment(false);
    setPendingMfaEnrollment(null);
  }, []);

  const refreshAuthorizationForMembership = useCallback(
    async (input: { user: User; orgId: string; memberRole: string | null }) => {
      const fallbackRole = mapMemberRoleToAppRole(input.memberRole);

      const nextProfile = await identity.ensureProfileForOrg({
        user: input.user,
        orgId: input.orgId,
        role: fallbackRole
      });

      setProfile(nextProfile);

      const nextRole = nextProfile.role ?? fallbackRole;
      setRole(nextRole);

      rbac.clearCache();
      const nextPermissions = await rbac.listPermissions({ orgId: input.orgId });
      setPermissions(nextPermissions);

      if (nextRole === 'ADMIN') {
        const hasVerifiedTotp = await mfa.hasVerifiedTotp();
        setRequiresMfaEnrollment(!hasVerifiedTotp);
      } else {
        setRequiresMfaEnrollment(false);
      }

      await sessions.touchCurrent();
    },
    []
  );

  const syncFromSession = useCallback(
    async (nextSession: Session | null) => {
      setSession(nextSession);

      if (!nextSession?.user) {
        setActiveOrgId(null);
        setHasMembership(false);
        setMemberRole(null);
        resetSecurityState();
        setLoading(false);
        return;
      }

      try {
        const client = getSupabaseClient();
        if (client) {
          const { error: inviteAcceptError } = await client.rpc('accept_pending_org_invites');
          const acceptErrorMessage = inviteAcceptError ? toErrorMessage(inviteAcceptError).toLowerCase() : '';
          if (inviteAcceptError && !acceptErrorMessage.includes('does not exist') && __DEV__) {
            console.warn('accept_pending_org_invites failed:', toErrorMessage(inviteAcceptError));
          }
        }

        const membership = await resolveMembership(nextSession.user.id);
        setActiveOrgId(membership.orgId);
        setHasMembership(Boolean(membership.orgId));
        setMemberRole(membership.memberRole);

        flags.setContext({
          org_id: membership.orgId ?? undefined,
          user_id: nextSession.user.id
        });

        quotas.setContext({
          org_id: membership.orgId ?? undefined,
          user_id: nextSession.user.id
        });

        share.setContext({
          org_id: membership.orgId ?? undefined,
          user_id: nextSession.user.id
        });

        audit.setContext({
          org_id: membership.orgId ?? undefined,
          user_id: nextSession.user.id
        });

        governance.setContext({
          org_id: membership.orgId ?? undefined,
          user_id: nextSession.user.id
        });

        rules.setContext({
          org_id: membership.orgId ?? undefined,
          user_id: nextSession.user.id
        });

        geo.setContext({
          org_id: membership.orgId ?? undefined,
          user_id: nextSession.user.id
        });

        projects.setContext({
          org_id: membership.orgId ?? undefined
        });

        if (membership.orgId) {
          try {
            await flags.listAll(membership.orgId);
          } catch {
            // Keep defaults when cache is unavailable.
          }

          void flags.refresh(membership.orgId).catch((flagsError) => {
            if (__DEV__) {
              console.warn('feature flags refresh failed:', toErrorMessage(flagsError));
            }
          });
        }

        if (!membership.orgId) {
          resetSecurityState();
          setLoading(false);
          return;
        }

        await refreshAuthorizationForMembership({
          user: nextSession.user,
          orgId: membership.orgId,
          memberRole: membership.memberRole
        });
      } catch (error) {
        resetSecurityState();
        if (__DEV__) {
          console.warn('syncFromSession failed:', toErrorMessage(error));
        }
      } finally {
        setLoading(false);
      }
    },
    [refreshAuthorizationForMembership, resetSecurityState]
  );

  const refreshMembership = useCallback(async () => {
    if (!session?.user) {
      setActiveOrgId(null);
      setHasMembership(false);
      setMemberRole(null);
      resetSecurityState();
      return;
    }

    const membership = await resolveMembership(session.user.id);
    setActiveOrgId(membership.orgId);
    setHasMembership(Boolean(membership.orgId));
    setMemberRole(membership.memberRole);

    flags.setContext({
      org_id: membership.orgId ?? undefined,
      user_id: session.user.id
    });

    quotas.setContext({
      org_id: membership.orgId ?? undefined,
      user_id: session.user.id
    });

    share.setContext({
      org_id: membership.orgId ?? undefined,
      user_id: session.user.id
    });

    audit.setContext({
      org_id: membership.orgId ?? undefined,
      user_id: session.user.id
    });

    governance.setContext({
      org_id: membership.orgId ?? undefined,
      user_id: session.user.id
    });

    rules.setContext({
      org_id: membership.orgId ?? undefined,
      user_id: session.user.id
    });

    geo.setContext({
      org_id: membership.orgId ?? undefined,
      user_id: session.user.id
    });

    if (membership.orgId) {
      try {
        await flags.listAll(membership.orgId);
      } catch {
        // Keep defaults when cache is unavailable.
      }

      void flags.refresh(membership.orgId).catch((flagsError) => {
        if (__DEV__) {
          console.warn('feature flags refresh failed:', toErrorMessage(flagsError));
        }
      });
    }

    if (!membership.orgId) {
      resetSecurityState();
      return;
    }

    await refreshAuthorizationForMembership({
      user: session.user,
      orgId: membership.orgId,
      memberRole: membership.memberRole
    });
  }, [refreshAuthorizationForMembership, resetSecurityState, session]);

  const refreshAuthorization = useCallback(async () => {
    if (!session?.user || !activeOrgId) {
      resetSecurityState();
      return;
    }

    await refreshAuthorizationForMembership({
      user: session.user,
      orgId: activeOrgId,
      memberRole
    });
  }, [activeOrgId, memberRole, refreshAuthorizationForMembership, resetSecurityState, session]);

  useEffect(() => {
    const client = getSupabaseClient();

    if (!client) {
      setLoading(false);
      setSession(null);
      setActiveOrgId(null);
      setHasMembership(null);
      setMemberRole(null);
      resetSecurityState();
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
  }, [resetSecurityState, syncFromSession]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let alive = true;

    const tick = async () => {
      try {
        await sessions.touchCurrent();
        const revoked = await sessions.isCurrentRevoked();

        if (revoked && alive) {
          await securityAuth.signOut();
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('session heartbeat failed:', toErrorMessage(error));
        }
      }
    };

    void tick();
    const intervalId = setInterval(() => {
      void tick();
    }, 45_000);

    return () => {
      alive = false;
      clearInterval(intervalId);
    };
  }, [session]);

  const signInWithPassword = useCallback(async (input: { email: string; password: string }) => {
    await securityAuth.signIn(input.email, input.password);
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    await securityAuth.signInWithMagicLink(email);
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

      return { needsEmailConfirmation: !data.session };
    },
    []
  );

  const signOut = useCallback(async () => {
    await securityAuth.signOut();
    setPendingMfaEnrollment(null);
  }, []);

  const refreshSession = useCallback(async () => {
    const nextSession = await securityAuth.refreshSession();
    await syncFromSession(nextSession);
    return nextSession;
  }, [syncFromSession]);

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
        throw new Error("Nom d'organisation trop court.");
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

  const enrollAdminMfa = useCallback(async () => {
    const enrollment = await mfa.enrollTOTP();
    setPendingMfaEnrollment(enrollment);
    return enrollment;
  }, []);

  const verifyAdminMfa = useCallback(
    async (code: string) => {
      await mfa.verify(code);
      setPendingMfaEnrollment(null);
      await refreshAuthorization();
    },
    [refreshAuthorization]
  );

  const disableMfa = useCallback(async () => {
    await mfa.disable();
    setPendingMfaEnrollment(null);
    await refreshAuthorization();
  }, [refreshAuthorization]);

  const listSessions = useCallback(async () => {
    return sessions.list();
  }, []);

  const revokeSession = useCallback(
    async (sessionId: string) => {
      await sessions.revoke(sessionId);
      const currentSessionId = await sessions.getCurrentSessionId();
      if (currentSessionId && currentSessionId === sessionId) {
        await signOut();
      }
    },
    [signOut]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: appEnv.isSupabaseConfigured,
      loading,
      session,
      user: session?.user ?? null,
      activeOrgId,
      hasMembership,
      role,
      permissions,
      profile,
      requiresMfaEnrollment,
      pendingMfaEnrollment,
      signInWithPassword,
      signInWithMagicLink,
      signUpWithPassword,
      signOut,
      refreshSession,
      bootstrapOrganization,
      refreshMembership,
      refreshAuthorization,
      enrollAdminMfa,
      verifyAdminMfa,
      disableMfa,
      listSessions,
      revokeSession
    }),
    [
      activeOrgId,
      bootstrapOrganization,
      disableMfa,
      enrollAdminMfa,
      hasMembership,
      listSessions,
      loading,
      pendingMfaEnrollment,
      permissions,
      profile,
      refreshAuthorization,
      refreshMembership,
      refreshSession,
      requiresMfaEnrollment,
      revokeSession,
      role,
      session,
      signInWithMagicLink,
      signInWithPassword,
      signOut,
      signUpWithPassword,
      verifyAdminMfa
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
