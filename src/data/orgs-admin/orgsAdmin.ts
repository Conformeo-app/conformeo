import * as SQLite from 'expo-sqlite';
import { modules as appModules } from '../../core/modules';
import { getRequiredSession, resolveMembership, toErrorMessage } from '../../core/identity-security/utils';
import { requireSupabaseClient } from '../../core/supabase/client';
import {
  InviteResult,
  ModuleFlag,
  OrganizationMember,
  OrganizationRecord,
  OrgMemberRole,
  OrgSettingsPatch,
  TeamRecord
} from './types';
import { flags } from '../feature-flags';

const DB_NAME = 'conformeo.db';
const CACHE_TABLE = 'orgs_admin_cache';

const ROLE_OPTIONS: OrgMemberRole[] = ['owner', 'admin', 'manager', 'inspector', 'viewer'];
const ADMIN_ROLES: OrgMemberRole[] = ['owner', 'admin'];
const MODULE_KEYS = appModules.map((item) => item.key);

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

type CacheRow = {
  cache_key: string;
  payload: string;
  updated_at: string;
};

type OrgRowV2 = {
  id: string;
  name: string;
  siret: string | null;
  address: string | null;
  settings_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type OrgRowV1 = {
  id: string;
  name: string;
  created_at: string;
};

type MemberRpcRow = {
  user_id: string | null;
  email: string | null;
  role: string;
  status: string;
  invited_at: string;
  joined_at: string | null;
};

type OrgMemberRowFallback = {
  user_id: string;
  role: string;
  status: string | null;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
};

type TeamRow = {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type TeamMemberRow = {
  team_id: string;
  user_id: string;
};

type FeatureFlagRow = {
  key: string;
  enabled: boolean;
  payload: Record<string, unknown> | null;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(value: string | null | undefined): OrgMemberRole {
  const normalized = (value ?? '').toLowerCase();

  if (normalized === 'field' || normalized === 'inspector') {
    return 'inspector';
  }

  if (normalized === 'read_only' || normalized === 'readonly') {
    return 'viewer';
  }

  return ROLE_OPTIONS.includes(normalized as OrgMemberRole) ? (normalized as OrgMemberRole) : 'viewer';
}

function normalizeSettings(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {} as Record<string, unknown>;
}

function parseJson<T>(raw: string, fallback: T) {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isMissingFunctionError(error: unknown) {
  const message = toErrorMessage(error, '').toLowerCase();
  return message.includes('function') && message.includes('does not exist');
}

function isMissingColumnError(error: unknown, columnName: string) {
  const message = toErrorMessage(error, '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase()) && message.includes('does not exist');
}

function cacheKey(orgId: string, scope: string) {
  return `org:${orgId}:${scope}`;
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }

  return dbPromise;
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      const db = await getDb();
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (
          cache_key TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    })();
  }

  return setupPromise;
}

async function writeCache<T>(key: string, value: T) {
  await ensureSetup();
  const db = await getDb();
  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${CACHE_TABLE} (cache_key, payload, updated_at)
      VALUES (?, ?, ?)
    `,
    key,
    JSON.stringify(value),
    nowIso()
  );
}

async function readCache<T>(key: string): Promise<T | null> {
  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<CacheRow>(
    `
      SELECT cache_key, payload, updated_at
      FROM ${CACHE_TABLE}
      WHERE cache_key = ?
      LIMIT 1
    `,
    key
  );

  if (!row) {
    return null;
  }

  return parseJson<T | null>(row.payload, null);
}

async function resolveContext(preferredOrgId?: string | null) {
  const client = requireSupabaseClient();
  const session = await getRequiredSession(client);
  const membership = await resolveMembership(session.user.id, preferredOrgId, client);

  if (!membership.orgId) {
    throw new Error('Aucune organisation active.');
  }

  return {
    client,
    userId: session.user.id,
    orgId: membership.orgId,
    memberRole: normalizeRole(membership.memberRole)
  };
}

function assertAdminRole(memberRole: OrgMemberRole) {
  if (!ADMIN_ROLES.includes(memberRole)) {
    throw new Error('Acces refuse: role admin requis.');
  }
}

function mapOrganizationV2(row: OrgRowV2): OrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    siret: row.siret,
    address: row.address,
    settings_json: normalizeSettings(row.settings_json),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapOrganizationV1(row: OrgRowV1): OrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    siret: null,
    address: null,
    settings_json: {},
    created_at: row.created_at,
    updated_at: row.created_at
  };
}

function normalizeMemberRow(row: MemberRpcRow): OrganizationMember {
  const status = row.status === 'ACTIVE' ? 'ACTIVE' : 'INVITED';
  return {
    user_id: row.user_id,
    email: row.email,
    role: normalizeRole(row.role),
    status,
    invited_at: row.invited_at,
    joined_at: row.joined_at
  };
}

function mapFallbackMemberRow(row: OrgMemberRowFallback): OrganizationMember {
  const status = row.status === 'ACTIVE' ? 'ACTIVE' : 'INVITED';
  return {
    user_id: row.user_id,
    email: null,
    role: normalizeRole(row.role),
    status,
    invited_at: row.invited_at ?? row.created_at,
    joined_at: row.joined_at
  };
}

async function loadOrganizationRemote(orgId: string) {
  const client = requireSupabaseClient();

  const { data, error } = await client
    .from('organizations')
    .select('id, name, siret, address, settings_json, created_at, updated_at')
    .eq('id', orgId)
    .maybeSingle<OrgRowV2>();

  if (error) {
    if (isMissingColumnError(error, 'organizations.siret')) {
      const { data: legacyData, error: legacyError } = await client
        .from('organizations')
        .select('id, name, created_at')
        .eq('id', orgId)
        .maybeSingle<OrgRowV1>();

      if (legacyError) {
        throw new Error(legacyError.message);
      }

      if (!legacyData) {
        throw new Error('Organisation introuvable.');
      }

      return mapOrganizationV1(legacyData);
    }

    throw new Error(error.message);
  }

  if (!data) {
    throw new Error('Organisation introuvable.');
  }

  return mapOrganizationV2(data);
}

async function loadMembersRemote(orgId: string): Promise<OrganizationMember[]> {
  const client = requireSupabaseClient();
  const { data, error } = await client.rpc('list_org_members', {
    p_org_id: orgId
  });

  if (error) {
    if (!isMissingFunctionError(error)) {
      throw new Error(error.message);
    }

    // Legacy fallback: list only org_members without invite-email resolution.
    const fallback = await client
      .from('org_members')
      .select('user_id, role, status, invited_at, joined_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (fallback.error) {
      throw new Error(fallback.error.message);
    }

    return (fallback.data ?? []).map((row) => mapFallbackMemberRow(row as OrgMemberRowFallback));
  }

  return ((data ?? []) as MemberRpcRow[]).map((row: MemberRpcRow) => normalizeMemberRow(row));
}

async function loadTeamsRemote(orgId: string): Promise<TeamRecord[]> {
  const client = requireSupabaseClient();

  const { data: teamsData, error: teamsError } = await client
    .from('teams')
    .select('id, org_id, name, created_at, updated_at')
    .eq('org_id', orgId)
    .order('name', { ascending: true });

  if (teamsError) {
    throw new Error(teamsError.message);
  }

  const teamRows = (teamsData ?? []) as TeamRow[];
  if (teamRows.length === 0) {
    return [];
  }

  const teamIds = teamRows.map((row) => row.id);

  const { data: membersData, error: membersError } = await client
    .from('team_members')
    .select('team_id, user_id')
    .in('team_id', teamIds);

  if (membersError) {
    throw new Error(membersError.message);
  }

  const mapByTeam = new Map<string, string[]>();
  for (const row of (membersData ?? []) as TeamMemberRow[]) {
    const next = mapByTeam.get(row.team_id) ?? [];
    next.push(row.user_id);
    mapByTeam.set(row.team_id, next);
  }

  return teamRows.map((row) => ({
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    member_user_ids: mapByTeam.get(row.id) ?? []
  }));
}

async function loadModulesRemote(orgId: string): Promise<ModuleFlag[]> {
  const client = requireSupabaseClient();

  const { data, error } = await client
    .from('feature_flags')
    .select('key, enabled, payload, updated_at')
    .eq('org_id', orgId)
    .in('key', MODULE_KEYS)
    .order('key', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const byKey = new Map<string, ModuleFlag>();
  for (const row of (data ?? []) as FeatureFlagRow[]) {
    byKey.set(row.key, {
      key: row.key,
      enabled: Boolean(row.enabled),
      updated_at: row.updated_at,
      payload: normalizeSettings(row.payload)
    });
  }

  return MODULE_KEYS.map((key) =>
    byKey.get(key) ?? {
      key,
      enabled: false
    }
  );
}

export const org = {
  async getCurrent(preferredOrgId?: string | null): Promise<OrganizationRecord> {
    const context = await resolveContext(preferredOrgId);
    const key = cacheKey(context.orgId, 'current');

    try {
      const value = await loadOrganizationRemote(context.orgId);
      await writeCache(key, value);
      return value;
    } catch (error) {
      const fallback = await readCache<OrganizationRecord>(key);
      if (fallback) {
        return fallback;
      }
      throw error;
    }
  },

  async updateSettings(patch: OrgSettingsPatch, preferredOrgId?: string | null): Promise<OrganizationRecord> {
    const context = await resolveContext(preferredOrgId);
    assertAdminRole(context.memberRole);

    const cleanPatch: OrgSettingsPatch = {
      name: patch.name?.trim(),
      siret: patch.siret === undefined ? undefined : patch.siret?.trim() ?? null,
      address: patch.address === undefined ? undefined : patch.address?.trim() ?? null,
      settings_json: patch.settings_json
    };

    const { data, error } = await context.client.rpc('update_org_settings', {
      p_org_id: context.orgId,
      p_name: cleanPatch.name ?? null,
      p_siret: cleanPatch.siret ?? null,
      p_address: cleanPatch.address ?? null,
      p_settings_patch: cleanPatch.settings_json ?? {}
    });

    if (error) {
      throw new Error(error.message);
    }

    const row = (data as OrgRowV2[] | OrgRowV2 | null) ?? null;
    const first = Array.isArray(row) ? row[0] : row;

    const value = first
      ? mapOrganizationV2(first)
      : await loadOrganizationRemote(context.orgId);

    await writeCache(cacheKey(context.orgId, 'current'), value);
    return value;
  }
};

export const members = {
  async invite(
    email: string,
    role: OrgMemberRole,
    preferredOrgId?: string | null
  ): Promise<InviteResult> {
    const context = await resolveContext(preferredOrgId);
    assertAdminRole(context.memberRole);

    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail.length < 5 || !cleanEmail.includes('@')) {
      throw new Error('Email invalide.');
    }

    if (!ROLE_OPTIONS.includes(role)) {
      throw new Error('Role invalide.');
    }

    const { data, error } = await context.client.rpc('invite_org_member', {
      p_org_id: context.orgId,
      p_email: cleanEmail,
      p_role: role
    });

    if (error) {
      throw new Error(error.message);
    }

    const parsed = (data as { invited_user_id?: string | null } | null) ?? {};
    return {
      invited_user_id: parsed.invited_user_id ?? null,
      status: 'INVITED'
    };
  },

  async list(preferredOrgId?: string | null): Promise<OrganizationMember[]> {
    const context = await resolveContext(preferredOrgId);
    const key = cacheKey(context.orgId, 'members');

    try {
      const rows = await loadMembersRemote(context.orgId);
      await writeCache(key, rows);
      return rows;
    } catch (error) {
      const fallback = await readCache<OrganizationMember[]>(key);
      if (fallback) {
        return fallback;
      }

      throw error;
    }
  },

  async remove(userId: string, preferredOrgId?: string | null): Promise<void> {
    const context = await resolveContext(preferredOrgId);
    assertAdminRole(context.memberRole);

    const cleanUserId = userId.trim();
    if (cleanUserId.length === 0) {
      throw new Error('userId requis.');
    }

    const { error } = await context.client.rpc('remove_org_member', {
      p_org_id: context.orgId,
      p_user_id: cleanUserId
    });

    if (error) {
      throw new Error(error.message);
    }
  },

  async changeRole(userId: string, role: OrgMemberRole, preferredOrgId?: string | null): Promise<void> {
    const context = await resolveContext(preferredOrgId);
    assertAdminRole(context.memberRole);

    if (!ROLE_OPTIONS.includes(role)) {
      throw new Error('Role invalide.');
    }

    const cleanUserId = userId.trim();
    if (cleanUserId.length === 0) {
      throw new Error('userId requis.');
    }

    const { error } = await context.client.rpc('rbac_assign_role', {
      p_org_id: context.orgId,
      p_target_user_id: cleanUserId,
      p_role_key: role
    });

    if (error) {
      const message = toErrorMessage(error);
      const normalized = message.toLowerCase();

      if (normalized.includes('self_role_change_forbidden') || normalized.includes('owner cannot change own role')) {
        throw new Error('Vous ne pouvez pas modifier votre propre rôle.');
      }

      if (normalized.includes('owner_role_locked') || normalized.includes('owner role is locked')) {
        throw new Error('Le rôle Propriétaire est verrouillé.');
      }

      if (normalized.includes('last_admin_forbidden') || normalized.includes('cannot remove last admin')) {
        throw new Error('Impossible de retirer le dernier administrateur.');
      }

      if (normalized.includes('function') && normalized.includes('rbac_assign_role') && normalized.includes('does not exist')) {
        throw new Error("La RPC 'rbac_assign_role' est indisponible. Appliquez la migration RBAC lockdown.");
      }

      throw new Error(message);
    }
  }
};

export const teams = {
  async create(name: string, preferredOrgId?: string | null): Promise<TeamRecord> {
    const context = await resolveContext(preferredOrgId);
    assertAdminRole(context.memberRole);

    const cleanName = name.trim();
    if (cleanName.length < 2) {
      throw new Error('Nom equipe trop court.');
    }

    const { data, error } = await context.client.rpc('create_team', {
      p_org_id: context.orgId,
      p_name: cleanName
    });

    if (error) {
      throw new Error(error.message);
    }

    const teamId = String(data);
    const rows = await loadTeamsRemote(context.orgId);
    await writeCache(cacheKey(context.orgId, 'teams'), rows);
    const created = rows.find((row) => row.id === teamId);

    if (!created) {
      throw new Error('Equipe creee mais introuvable.');
    }

    return created;
  },

  async list(preferredOrgId?: string | null): Promise<TeamRecord[]> {
    const context = await resolveContext(preferredOrgId);
    const key = cacheKey(context.orgId, 'teams');

    try {
      const rows = await loadTeamsRemote(context.orgId);
      await writeCache(key, rows);
      return rows;
    } catch (error) {
      const fallback = await readCache<TeamRecord[]>(key);
      if (fallback) {
        return fallback;
      }

      throw error;
    }
  },

  async addMember(teamId: string, userId: string, preferredOrgId?: string | null): Promise<void> {
    const context = await resolveContext(preferredOrgId);
    assertAdminRole(context.memberRole);

    const cleanTeamId = teamId.trim();
    const cleanUserId = userId.trim();

    if (cleanTeamId.length === 0 || cleanUserId.length === 0) {
      throw new Error('teamId et userId requis.');
    }

    const { error } = await context.client.rpc('add_team_member', {
      p_team_id: cleanTeamId,
      p_user_id: cleanUserId
    });

    if (error) {
      throw new Error(error.message);
    }
  },

  async removeMember(teamId: string, userId: string, preferredOrgId?: string | null): Promise<void> {
    const context = await resolveContext(preferredOrgId);
    assertAdminRole(context.memberRole);

    const cleanTeamId = teamId.trim();
    const cleanUserId = userId.trim();

    if (cleanTeamId.length === 0 || cleanUserId.length === 0) {
      throw new Error('teamId et userId requis.');
    }

    const { error } = await context.client.rpc('remove_team_member', {
      p_team_id: cleanTeamId,
      p_user_id: cleanUserId
    });

    if (error) {
      throw new Error(error.message);
    }
  }
};

export const modules = {
  async listEnabled(preferredOrgId?: string | null): Promise<ModuleFlag[]> {
    let allFlags: Awaited<ReturnType<typeof flags.listAll>>;

    try {
      allFlags = await flags.refresh(preferredOrgId);
    } catch {
      allFlags = await flags.listAll(preferredOrgId);
    }

    return allFlags
      .filter((item) => MODULE_KEYS.includes(item.key as (typeof MODULE_KEYS)[number]))
      .map((item) => ({
        key: item.key,
        enabled: item.enabled,
        updated_at: item.updated_at,
        payload: item.payload,
        updated_by: item.updated_by ?? null,
        source: item.source
      }));
  },

  async setEnabled(moduleKey: string, enabled: boolean, preferredOrgId?: string | null): Promise<void> {
    const cleanKey = moduleKey.trim();
    if (cleanKey.length === 0) {
      throw new Error('module key requis.');
    }

    if (!MODULE_KEYS.includes(cleanKey as (typeof MODULE_KEYS)[number])) {
      throw new Error('module key inconnu.');
    }

    await flags.setEnabled(cleanKey, enabled, preferredOrgId);
  },

  async setPayload(
    moduleKey: string,
    payload: Record<string, unknown>,
    preferredOrgId?: string | null
  ): Promise<void> {
    const cleanKey = moduleKey.trim();
    if (cleanKey.length === 0) {
      throw new Error('module key requis.');
    }

    if (!MODULE_KEYS.includes(cleanKey as (typeof MODULE_KEYS)[number])) {
      throw new Error('module key inconnu.');
    }

    await flags.setPayload(cleanKey, payload, preferredOrgId);
  },

  async rollback(moduleKey: string, preferredOrgId?: string | null): Promise<void> {
    const cleanKey = moduleKey.trim();
    if (cleanKey.length === 0) {
      throw new Error('module key requis.');
    }

    if (!MODULE_KEYS.includes(cleanKey as (typeof MODULE_KEYS)[number])) {
      throw new Error('module key inconnu.');
    }

    await flags.rollbackLastChange(cleanKey, preferredOrgId);
  }
};


export const orgsAdmin = {
  org,
  members,
  teams,
  modules
};
