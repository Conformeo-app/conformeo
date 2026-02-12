import { requireSupabaseClient } from '../supabase/client';
import { AppRole, RbacContext } from './types';
import {
  getRequiredSession,
  isMissingTableError,
  mapAppRoleToRoleKey,
  mapMemberRoleToAppRole,
  resolveMembership
} from './utils';

type PermissionRow = {
  permission: string;
};

type ProfileRoleRow = {
  role: AppRole | null;
};

const DEFAULT_PERMISSIONS: Record<AppRole, string[]> = {
  ADMIN: ['*'],
  MANAGER: [
    'tasks:*',
    'media:*',
    'documents:*',
    'exports:*',
    'control:*',
    'offline:read',
    'security:read'
  ],
  FIELD: [
    'tasks:read',
    'tasks:write',
    'media:read',
    'media:write',
    'documents:read',
    'documents:write',
    'exports:read',
    'control:read',
    'offline:read'
  ]
};

const PERMISSION_CACHE_TTL_MS = 20_000;

const permissionCache = new Map<string, { permissions: string[]; expiresAt: number }>();

function cacheKey(orgId: string, role: AppRole) {
  return `${orgId}:${role}`;
}

function matchesPermission(permission: string, granted: string) {
  if (granted === '*') {
    return true;
  }

  if (granted === permission) {
    return true;
  }

  const wildcard = granted.endsWith(':*') ? granted.slice(0, -1) : null;
  if (wildcard) {
    return permission.startsWith(wildcard);
  }

  return false;
}

async function resolveRole(orgId?: string | null): Promise<{ role: AppRole; orgId: string }> {
  const client = requireSupabaseClient();
  const session = await getRequiredSession(client);
  const membership = await resolveMembership(session.user.id, orgId, client);

  if (!membership.orgId) {
    throw new Error('Aucune organisation active pour RBAC.');
  }

  const { data, error } = await client
    .from('profiles')
    .select('role')
    .eq('user_id', session.user.id)
    .eq('org_id', membership.orgId)
    .maybeSingle<ProfileRoleRow>();

  if (error && !error.message.toLowerCase().includes('column profiles.org_id does not exist')) {
    throw new Error(error.message);
  }

  const role = data?.role ?? mapMemberRoleToAppRole(membership.memberRole);

  return {
    role,
    orgId: membership.orgId
  };
}

async function fetchPermissionsFromDb(orgId: string, role: AppRole) {
  const client = requireSupabaseClient();
  const roleKey = mapAppRoleToRoleKey(role);

  const { data, error } = await client
    .from('role_permissions')
    .select('permission')
    .eq('org_id', orgId)
    .eq('role_key', roleKey)
    .order('permission', { ascending: true });

  if (error) {
    if (isMissingTableError(error, 'role_permissions')) {
      return null;
    }
    throw new Error(error.message);
  }

  const permissions = (data ?? [])
    .map((row) => (row as PermissionRow).permission)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (permissions.length === 0) {
    return null;
  }

  return permissions;
}

export const rbac = {
  clearCache() {
    permissionCache.clear();
  },

  async getRole(ctx?: RbacContext): Promise<AppRole> {
    const resolved = await resolveRole(ctx?.orgId);
    return resolved.role;
  },

  async listPermissions(ctx?: RbacContext): Promise<string[]> {
    const resolved = await resolveRole(ctx?.orgId);
    const key = cacheKey(resolved.orgId, resolved.role);
    const cached = permissionCache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return [...cached.permissions];
    }

    const fromDb = await fetchPermissionsFromDb(resolved.orgId, resolved.role);
    const permissions = fromDb ?? DEFAULT_PERMISSIONS[resolved.role];

    permissionCache.set(key, {
      permissions,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS
    });

    return [...permissions];
  },

  async hasPermission(permission: string, ctx?: RbacContext): Promise<boolean> {
    const cleanedPermission = permission.trim();
    if (cleanedPermission.length === 0) {
      return false;
    }

    const permissions = await this.listPermissions(ctx);
    return permissions.some((granted) => matchesPermission(cleanedPermission, granted));
  }
};
