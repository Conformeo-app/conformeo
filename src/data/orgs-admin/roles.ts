import { getRequiredSession, isMissingTableError, resolveMembership } from '../../core/identity-security/utils';
import { requireSupabaseClient } from '../../core/supabase/client';
import type { OrgRole, OrgUserRole } from './types';

type RoleRow = {
  id: string;
  org_id: string;
  key: string;
  name: string;
  is_system: boolean | null;
  created_at: string;
  updated_at?: string | null;
};

type RolePermissionRow = {
  permission_key?: string | null;
  permission?: string | null;
};

function normalizePermissions(rows: RolePermissionRow[]) {
  return rows
    .map((row) => String(row.permission_key ?? row.permission ?? '').trim())
    .filter((value) => value.length > 0);
}

function mapRole(row: RoleRow): OrgRole {
  return {
    id: row.id,
    org_id: row.org_id,
    key: row.key,
    name: row.name,
    is_system: Boolean(row.is_system),
    created_at: row.created_at,
    updated_at: row.updated_at ?? null
  };
}

async function resolveOrg(preferredOrgId?: string | null) {
  const client = requireSupabaseClient();
  const session = await getRequiredSession(client);
  const membership = await resolveMembership(session.user.id, preferredOrgId, client);

  if (!membership.orgId) {
    throw new Error('Aucune organisation active.');
  }

  return {
    client,
    userId: session.user.id,
    orgId: membership.orgId
  };
}

export const roles = {
  async list(preferredOrgId?: string | null): Promise<OrgRole[]> {
    const context = await resolveOrg(preferredOrgId);
    const { data, error } = await context.client
      .from('roles')
      .select('id, org_id, key, name, is_system, created_at, updated_at')
      .eq('org_id', context.orgId)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      if (isMissingTableError(error, 'roles')) {
        return [];
      }
      throw new Error(error.message);
    }

    return ((data ?? []) as RoleRow[]).map(mapRole);
  },

  async create(
    input: { name: string; basedOnRoleId?: string | null },
    preferredOrgId?: string | null
  ): Promise<string> {
    const context = await resolveOrg(preferredOrgId);
    const name = input.name.trim();
    if (name.length < 2) {
      throw new Error('Nom de rôle trop court.');
    }

    const { data, error } = await context.client.rpc('create_org_role', {
      p_org_id: context.orgId,
      p_name: name,
      p_based_on_role_id: input.basedOnRoleId ?? null
    });

    if (error) {
      throw new Error(error.message);
    }

    return String(data);
  },

  async update(roleId: string, patch: { name: string }): Promise<void> {
    const cleanRoleId = roleId.trim();
    if (!cleanRoleId) {
      throw new Error('roleId requis.');
    }

    const name = patch.name.trim();
    if (name.length < 2) {
      throw new Error('Nom de rôle trop court.');
    }

    const client = requireSupabaseClient();
    const { error } = await client.rpc('update_org_role', { p_role_id: cleanRoleId, p_name: name });
    if (error) {
      throw new Error(error.message);
    }
  },

  async getPermissions(roleId: string): Promise<string[]> {
    const cleanRoleId = roleId.trim();
    if (!cleanRoleId) {
      throw new Error('roleId requis.');
    }

    const client = requireSupabaseClient();
    const { data, error } = await client
      .from('role_permissions')
      .select('permission_key, permission')
      .eq('role_id', cleanRoleId)
      .order('permission_key', { ascending: true });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('column') && message.includes('role_id') && message.includes('does not exist')) {
        // Legacy schema: best-effort (no custom roles).
        return [];
      }
      if (isMissingTableError(error, 'role_permissions')) {
        return [];
      }
      throw new Error(error.message);
    }

    return normalizePermissions((data ?? []) as RolePermissionRow[]);
  },

  async setPermissions(roleId: string, permissionKeys: string[]): Promise<number> {
    const cleanRoleId = roleId.trim();
    if (!cleanRoleId) {
      throw new Error('roleId requis.');
    }

    const cleanKeys = permissionKeys.map((p) => p.trim()).filter((p) => p.length > 0);

    const client = requireSupabaseClient();
    const { data, error } = await client.rpc('set_org_role_permissions', {
      p_role_id: cleanRoleId,
      p_permissions: cleanKeys
    });

    if (error) {
      throw new Error(error.message);
    }

    return typeof data === 'number' ? data : Number(data) || 0;
  },

  async listUserRoles(preferredOrgId?: string | null): Promise<OrgUserRole[]> {
    const context = await resolveOrg(preferredOrgId);
    const { data, error } = await context.client
      .from('user_roles')
      .select('user_id, org_id, role_id, role:roles(id, org_id, key, name, is_system, created_at, updated_at)')
      .eq('org_id', context.orgId);

    if (error) {
      if (isMissingTableError(error, 'user_roles')) {
        return [];
      }
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => {
      const role = row.role ? mapRole(row.role as RoleRow) : null;
      return {
        user_id: String(row.user_id),
        org_id: String(row.org_id),
        role_id: String(row.role_id),
        role
      } satisfies OrgUserRole;
    });
  },

  async assignUser(input: { userId: string; roleId: string }, preferredOrgId?: string | null): Promise<void> {
    const context = await resolveOrg(preferredOrgId);
    const cleanUserId = input.userId.trim();
    const cleanRoleId = input.roleId.trim();

    if (!cleanUserId || !cleanRoleId) {
      throw new Error('userId et roleId requis.');
    }

    const { error } = await context.client.rpc('assign_org_user_role', {
      p_org_id: context.orgId,
      p_user_id: cleanUserId,
      p_role_id: cleanRoleId
    });

    if (error) {
      throw new Error(error.message);
    }
  },

  async clearUserRole(userId: string, preferredOrgId?: string | null): Promise<void> {
    const context = await resolveOrg(preferredOrgId);
    const cleanUserId = userId.trim();
    if (!cleanUserId) {
      throw new Error('userId requis.');
    }

    const { error } = await context.client.rpc('clear_org_user_role', {
      p_org_id: context.orgId,
      p_user_id: cleanUserId
    });

    if (error) {
      throw new Error(error.message);
    }
  }
};

