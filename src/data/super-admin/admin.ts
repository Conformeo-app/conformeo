import { requireSupabaseClient } from '../../core/supabase/client';
import { appEnv } from '../../core/env';
import { AdminActionResult, AdminOrg, AdminOrgUser, AdminSelf, DeleteOrgResult, SupportSession } from './types';

const INVOKE_TIMEOUT_MS = 15_000;

function ensureObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    task.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

async function invokeEdge<T>(body: Record<string, unknown>): Promise<AdminActionResult<T>> {
  if (!appEnv.isSupabaseConfigured) {
    return { status: 'REJECTED', reason: 'Supabase non configuré (super-admin).' };
  }

  const client = requireSupabaseClient();
  const { data, error } = await withTimeout(client.functions.invoke('super-admin', { body }), INVOKE_TIMEOUT_MS, 'super-admin');

  if (error) {
    return { status: 'REJECTED', reason: error.message || 'Edge function error' };
  }

  const parsed = ensureObject(data);
  const status = parsed.status;
  if (status !== 'OK' && status !== 'REJECTED') {
    return { status: 'REJECTED', reason: 'Réponse super-admin invalide.' };
  }

  if (status === 'REJECTED') {
    const reason = typeof parsed.reason === 'string' ? parsed.reason : 'Action refusée';
    return { status: 'REJECTED', reason };
  }

  return { status: 'OK', data: parsed.data as T };
}

export const admin = {
  async self(): Promise<AdminSelf> {
    const res = await invokeEdge<AdminSelf>({ action: 'self' });
    if (res.status === 'REJECTED') {
      throw new Error(res.reason);
    }
    return res.data;
  },

  async listOrgs(opts: { limit?: number; offset?: number; query?: string } = {}): Promise<AdminOrg[]> {
    const res = await invokeEdge<AdminOrg[]>({
      action: 'list_orgs',
      limit: opts.limit,
      offset: opts.offset,
      query: opts.query
    });
    if (res.status === 'REJECTED') {
      throw new Error(res.reason);
    }
    return Array.isArray(res.data) ? res.data : [];
  },

  async listOrgUsers(orgId: string): Promise<AdminOrgUser[]> {
    const res = await invokeEdge<AdminOrgUser[]>({
      action: 'list_org_users',
      org_id: orgId
    });
    if (res.status === 'REJECTED') {
      throw new Error(res.reason);
    }
    return Array.isArray(res.data) ? res.data : [];
  },

  async startSupportSession(input: {
    org_id: string;
    target_user_id: string;
    reason: string;
    expires_in_minutes?: number;
  }): Promise<SupportSession> {
    const res = await invokeEdge<SupportSession>({
      action: 'start_support_session',
      ...input
    });
    if (res.status === 'REJECTED') {
      throw new Error(res.reason);
    }
    return res.data;
  },

  async stopSupportSession(sessionId: string): Promise<void> {
    const res = await invokeEdge<null>({
      action: 'stop_support_session',
      session_id: sessionId
    });
    if (res.status === 'REJECTED') {
      throw new Error(res.reason);
    }
  },

  async revokeUserSessions(input: { user_id: string; org_id?: string }): Promise<{ revoked: number }> {
    const res = await invokeEdge<{ revoked: number }>({
      action: 'revoke_user_sessions',
      ...input
    });
    if (res.status === 'REJECTED') {
      throw new Error(res.reason);
    }
    return res.data;
  },

  async resetUserMfa(userId: string): Promise<{ deleted: number }> {
    const res = await invokeEdge<{ deleted: number }>({
      action: 'reset_user_mfa',
      user_id: userId
    });
    if (res.status === 'REJECTED') {
      throw new Error(res.reason);
    }
    return res.data;
  },

  async deleteOrg(input: { org_id: string; confirmation: string }): Promise<DeleteOrgResult> {
    const res = await invokeEdge<DeleteOrgResult>({
      action: 'delete_org',
      ...input
    });
    if (res.status === 'REJECTED') {
      throw new Error(res.reason);
    }
    return res.data;
  }
};
