import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { requireSupabaseClient } from '../supabase/client';
import { AppRole } from './types';

type OrgMemberRow = {
  org_id: string;
  role: string;
};

const MEMBER_ROLE_TO_APP_ROLE: Record<string, AppRole> = {
  owner: 'ADMIN',
  admin: 'ADMIN',
  manager: 'MANAGER',
  inspector: 'FIELD',
  viewer: 'FIELD'
};

function getAtob() {
  const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
  if (typeof atobFn === 'function') {
    return atobFn;
  }

  const BufferCtor = (globalThis as { Buffer?: { from: (value: string, encoding: string) => { toString: (target: string) => string } } }).Buffer;
  if (BufferCtor) {
    return (value: string) => BufferCtor.from(value, 'base64').toString('utf-8');
  }

  return null;
}

function decodeBase64Url(input: string) {
  const decoder = getAtob();
  if (!decoder) {
    return null;
  }

  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  try {
    return decoder(padded);
  } catch {
    return null;
  }
}

export function toErrorMessage(error: unknown, fallback = 'Operation failed') {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function mapMemberRoleToAppRole(memberRole: string | null | undefined): AppRole {
  if (!memberRole) {
    return 'FIELD';
  }

  return MEMBER_ROLE_TO_APP_ROLE[memberRole] ?? 'FIELD';
}

export function mapAppRoleToRoleKey(role: AppRole): 'admin' | 'manager' | 'field' {
  if (role === 'ADMIN') {
    return 'admin';
  }
  if (role === 'MANAGER') {
    return 'manager';
  }
  return 'field';
}

export function deriveDisplayName(user: User) {
  const preferred =
    typeof user.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === 'string'
        ? user.user_metadata.name
        : null;

  if (preferred && preferred.trim().length > 0) {
    return preferred.trim();
  }

  return user.email?.split('@')[0] ?? 'Utilisateur';
}

export async function getRequiredSession(client: SupabaseClient = requireSupabaseClient()): Promise<Session> {
  const {
    data: { session },
    error
  } = await client.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  if (!session) {
    throw new Error('Session utilisateur absente.');
  }

  return session;
}

export async function resolveMembership(
  userId: string,
  preferredOrgId?: string | null,
  client: SupabaseClient = requireSupabaseClient()
): Promise<{ orgId: string | null; memberRole: string | null }> {
  const query = client
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (preferredOrgId) {
    query.eq('org_id', preferredOrgId);
  }

  const { data, error } = await query.maybeSingle<OrgMemberRow>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    orgId: data?.org_id ?? null,
    memberRole: data?.role ?? null
  };
}

export function extractSessionId(accessToken: string | null | undefined) {
  if (!accessToken) {
    return null;
  }

  const parts = accessToken.split('.');
  if (parts.length < 2) {
    return null;
  }

  const payloadRaw = decodeBase64Url(parts[1]);
  if (!payloadRaw) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    const sessionId = payload.session_id;
    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
      return sessionId;
    }
  } catch {
    return null;
  }

  return null;
}

export function isMissingTableError(error: unknown, tableName: string) {
  const message = toErrorMessage(error, '').toLowerCase();
  return message.includes('relation') && message.includes(tableName.toLowerCase()) && message.includes('does not exist');
}

export function isMissingColumnError(error: unknown, columnName: string) {
  const message = toErrorMessage(error, '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase()) && message.includes('does not exist');
}
