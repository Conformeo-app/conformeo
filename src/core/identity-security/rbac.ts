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

type PermissionRowV2 = {
  permission_key: string | null;
  permission: string | null;
};

type ProfileRoleRow = {
  role: AppRole | null;
};

const DEFAULT_PERMISSIONS: Record<AppRole, string[]> = {
  ADMIN: ['*'],
  MANAGER: [
    'projects:*',
    'tasks:*',
    'media:*',
    'documents:*',
    'exports:*',
    'control:*',
    'billing:*',
    'team:*',
    'org:read',
    'offline:read',
    'security:read'
  ],
  FIELD: [
    'projects:read',
    'tasks:read',
    'tasks:write',
    'media:read',
    'media:write',
    'documents:read',
    'documents:write',
    'exports:read',
    'control:read',
    'billing:read',
    'team:read',
    'org:read',
    'offline:read'
  ]
};

const PERMISSION_CACHE_TTL_MS = 20_000;

const permissionCache = new Map<string, { permissions: string[]; expiresAt: number }>();

function cacheKey(orgId: string, userId: string) {
  return `${orgId}:${userId}`;
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

async function resolveRole(orgId?: string | null): Promise<{ role: AppRole; orgId: string; userId: string }> {
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
    orgId: membership.orgId,
    userId: session.user.id
  };
}

async function fetchEffectiveRoleId(input: { orgId: string; userId: string; fallbackRoleKey: string }) {
  const client = requireSupabaseClient();

  const { data: customRole, error: customError } = await client
    .from('user_roles')
    .select('role_id')
    .eq('org_id', input.orgId)
    .eq('user_id', input.userId)
    .maybeSingle<{ role_id: string }>();

  if (customError) {
    if (isMissingTableError(customError, 'user_roles')) {
      return null;
    }
    // If the table exists but is restricted/misconfigured, fail loud.
    throw new Error(customError.message);
  }

  if (customRole?.role_id) {
    return customRole.role_id;
  }

  const { data: fallbackRole, error: fallbackError } = await client
    .from('roles')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('key', input.fallbackRoleKey)
    .maybeSingle<{ id: string }>();

  if (fallbackError) {
    if (isMissingTableError(fallbackError, 'roles')) {
      return null;
    }
    throw new Error(fallbackError.message);
  }

  return fallbackRole?.id ?? null;
}

async function fetchPermissionsFromDb(orgId: string, role: AppRole, userId: string) {
  const client = requireSupabaseClient();
  const roleKey = mapAppRoleToRoleKey(role);

  // v2 path (role_id + permission_key)
  const roleId = await fetchEffectiveRoleId({ orgId, userId, fallbackRoleKey: roleKey });
  if (roleId) {
    const { data, error } = await client
      .from('role_permissions')
      .select('permission_key, permission')
      .eq('role_id', roleId)
      .order('permission_key', { ascending: true });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('column') && message.includes('role_id') && message.includes('does not exist')) {
        // fall back to v0 query below
      } else if (isMissingTableError(error, 'role_permissions')) {
        return null;
      } else {
        throw new Error(error.message);
      }
    } else {
      const permissions = (data ?? [])
        .map((row) => {
          const candidate = row as PermissionRowV2;
          return (candidate.permission_key ?? candidate.permission ?? '').trim();
        })
        .filter((value) => value.length > 0);

      if (permissions.length > 0) {
        return permissions;
      }
    }
  }

  // v0 path (org_id + role_key + permission)
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
    const key = cacheKey(resolved.orgId, resolved.userId);
    const cached = permissionCache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return [...cached.permissions];
    }

    const fromDb = await fetchPermissionsFromDb(resolved.orgId, resolved.role, resolved.userId);
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
