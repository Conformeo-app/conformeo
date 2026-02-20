import * as SQLite from 'expo-sqlite';
import { ModuleKey, modules as appModules } from '../../core/modules';
import { getRequiredSession, resolveMembership, toErrorMessage } from '../../core/identity-security/utils';
import { requireSupabaseClient } from '../../core/supabase/client';
import {
  FeatureFlagAuditRecord,
  FeatureFlagAuditValue,
  FeatureFlagRecord,
  FeatureFlagSource,
  FeatureFlagsApi,
  FeatureFlagsListAuditOptions,
  FeatureFlagsPayloadOptions
} from './types';

const DB_NAME = 'conformeo.db';
const FLAGS_CACHE_TABLE = 'feature_flags_cache';
const FLAGS_AUDIT_CACHE_TABLE = 'feature_flags_audit_cache';
const ORGS_ADMIN_CACHE_TABLE = 'orgs_admin_cache';

const MODULE_KEY_SET = new Set<ModuleKey>(appModules.map((item) => item.key));
const ADMIN_ROLES = new Set(['owner', 'admin']);
const DEFAULT_DISABLED_MODULE_KEYS = new Set<ModuleKey>(['billing']);

const DEFAULT_AUDIT_LIMIT = 30;
const MAX_AUDIT_LIMIT = 200;

type MemberRole = 'owner' | 'admin' | 'manager' | 'inspector' | 'viewer';

type FeatureFlagRow = {
  key: string;
  enabled: boolean;
  payload: unknown;
  updated_at: string | null;
  updated_by?: string | null;
};

type FeatureFlagAuditRow = {
  id: string;
  org_id: string;
  key: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_at: string;
};

type CacheFlagRow = {
  org_id: string;
  key: string;
  enabled: number;
  payload_json: string;
  updated_at: string | null;
  updated_by: string | null;
  source: FeatureFlagSource;
};

type CacheAuditRow = {
  id: string;
  org_id: string;
  key: string;
  old_value_json: string;
  new_value_json: string;
  changed_by: string | null;
  changed_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

const flagsByOrgMemory = new Map<string, Map<string, FeatureFlagRecord>>();

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toOptional(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureObject(value: unknown) {
  if (isRecord(value)) {
    return value;
  }

  return {} as Record<string, unknown>;
}

function parseJsonObject(raw: string | null | undefined) {
  if (!raw) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return ensureObject(parsed);
  } catch {
    return {} as Record<string, unknown>;
  }
}

function normalizeMemberRole(value: string | null | undefined): MemberRole {
  const role = normalizeText(value).toLowerCase();
  if (role === 'owner' || role === 'admin' || role === 'manager' || role === 'inspector' || role === 'viewer') {
    return role;
  }

  return 'viewer';
}

function isModuleKey(key: string): key is ModuleKey {
  return MODULE_KEY_SET.has(key as ModuleKey);
}

function defaultEnabledForKey(key: string) {
  if (!isModuleKey(key)) {
    return false;
  }

  return !DEFAULT_DISABLED_MODULE_KEYS.has(key);
}

function isMissingColumnError(error: unknown, column: string) {
  const message = toErrorMessage(error, '').toLowerCase();
  return message.includes('column') && message.includes(column.toLowerCase()) && message.includes('does not exist');
}

function isMissingTableError(error: unknown, table: string) {
  const message = toErrorMessage(error, '').toLowerCase();
  return message.includes('relation') && message.includes(table.toLowerCase()) && message.includes('does not exist');
}

function normalizePayload(value: unknown) {
  return ensureObject(value);
}

function normalizeAuditValue(value: unknown): FeatureFlagAuditValue {
  const record = ensureObject(value);
  const normalized: FeatureFlagAuditValue = {};

  if (typeof record.enabled === 'boolean') {
    normalized.enabled = record.enabled;
  }

  if (isRecord(record.payload)) {
    normalized.payload = record.payload;
  }

  return normalized;
}

function toFlagRecord(
  orgId: string,
  key: string,
  enabled: boolean,
  payload: Record<string, unknown>,
  source: FeatureFlagSource,
  updatedAt?: string,
  updatedBy?: string
): FeatureFlagRecord {
  return {
    org_id: orgId,
    key,
    enabled,
    payload,
    source,
    updated_at: updatedAt,
    updated_by: updatedBy
  };
}

function sortFlags(rows: FeatureFlagRecord[]) {
  return [...rows].sort((left, right) => left.key.localeCompare(right.key));
}

function withModuleDefaults(orgId: string, rows: FeatureFlagRecord[]) {
  const map = new Map<string, FeatureFlagRecord>();

  for (const row of rows) {
    const cleanKey = normalizeText(row.key);
    if (!cleanKey) {
      continue;
    }

    map.set(cleanKey, {
      ...row,
      key: cleanKey,
      payload: ensureObject(row.payload)
    });
  }

  for (const moduleKey of MODULE_KEY_SET) {
    if (!map.has(moduleKey)) {
      map.set(
        moduleKey,
        toFlagRecord(orgId, moduleKey, defaultEnabledForKey(moduleKey), {}, 'DEFAULT', undefined, undefined)
      );
    }
  }

  return sortFlags(Array.from(map.values()));
}

function setMemory(orgId: string, rows: FeatureFlagRecord[]) {
  const map = new Map<string, FeatureFlagRecord>();
  for (const row of rows) {
    map.set(row.key, row);
  }
  flagsByOrgMemory.set(orgId, map);
}

function getMemoryList(orgId: string) {
  const map = flagsByOrgMemory.get(orgId);
  if (!map) {
    return [] as FeatureFlagRecord[];
  }

  return sortFlags(Array.from(map.values()));
}

function getMemoryFlag(orgId: string, key: string) {
  return flagsByOrgMemory.get(orgId)?.get(key) ?? null;
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

        CREATE TABLE IF NOT EXISTS ${FLAGS_CACHE_TABLE} (
          org_id TEXT NOT NULL,
          key TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          updated_at TEXT,
          updated_by TEXT,
          source TEXT NOT NULL,
          PRIMARY KEY (org_id, key)
        );

        CREATE INDEX IF NOT EXISTS idx_feature_flags_cache_org_updated
          ON ${FLAGS_CACHE_TABLE}(org_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS ${FLAGS_AUDIT_CACHE_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          key TEXT NOT NULL,
          old_value_json TEXT NOT NULL,
          new_value_json TEXT NOT NULL,
          changed_by TEXT,
          changed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_feature_flags_audit_cache_org_key_changed
          ON ${FLAGS_AUDIT_CACHE_TABLE}(org_id, key, changed_at DESC);

        CREATE TABLE IF NOT EXISTS ${ORGS_ADMIN_CACHE_TABLE} (
          cache_key TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    })();
  }

  return setupPromise;
}

async function readFlagsCache(orgId: string) {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<CacheFlagRow>(
    `
      SELECT org_id, key, enabled, payload_json, updated_at, updated_by, source
      FROM ${FLAGS_CACHE_TABLE}
      WHERE org_id = ?
      ORDER BY key ASC
    `,
    orgId
  );

  if (rows.length === 0) {
    return [] as FeatureFlagRecord[];
  }

  const mapped = rows.map((row) =>
    toFlagRecord(
      row.org_id,
      row.key,
      row.enabled === 1,
      parseJsonObject(row.payload_json),
      row.source ?? 'CACHE',
      toOptional(row.updated_at),
      toOptional(row.updated_by)
    )
  );

  return withModuleDefaults(orgId, mapped);
}

async function writeLegacyModulesCache(db: SQLite.SQLiteDatabase, orgId: string, flags: FeatureFlagRecord[]) {
  const modulesPayload = flags
    .filter((item) => isModuleKey(item.key))
    .map((item) => ({
      key: item.key,
      enabled: item.enabled,
      payload: item.payload,
      updated_at: item.updated_at
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  const key = `org:${orgId}:modules`;

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${ORGS_ADMIN_CACHE_TABLE} (cache_key, payload, updated_at)
      VALUES (?, ?, ?)
    `,
    key,
    JSON.stringify(modulesPayload),
    nowIso()
  );
}

async function writeFlagsCache(orgId: string, flags: FeatureFlagRecord[]) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      DELETE FROM ${FLAGS_CACHE_TABLE}
      WHERE org_id = ?
    `,
    orgId
  );

  for (const flag of flags) {
    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${FLAGS_CACHE_TABLE}
        (org_id, key, enabled, payload_json, updated_at, updated_by, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      orgId,
      flag.key,
      flag.enabled ? 1 : 0,
      JSON.stringify(flag.payload),
      flag.updated_at ?? null,
      flag.updated_by ?? null,
      flag.source
    );
  }

  await writeLegacyModulesCache(db, orgId, flags);
}

async function writeAuditCache(orgId: string, auditRows: FeatureFlagAuditRecord[], key?: string) {
  await ensureSetup();
  const db = await getDb();

  if (key) {
    await db.runAsync(
      `
        DELETE FROM ${FLAGS_AUDIT_CACHE_TABLE}
        WHERE org_id = ?
          AND key = ?
      `,
      orgId,
      key
    );
  } else {
    await db.runAsync(
      `
        DELETE FROM ${FLAGS_AUDIT_CACHE_TABLE}
        WHERE org_id = ?
      `,
      orgId
    );
  }

  for (const item of auditRows) {
    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${FLAGS_AUDIT_CACHE_TABLE}
        (id, org_id, key, old_value_json, new_value_json, changed_by, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      item.id,
      item.org_id,
      item.key,
      JSON.stringify(item.old_value),
      JSON.stringify(item.new_value),
      item.changed_by ?? null,
      item.changed_at
    );
  }
}

async function readAuditCache(orgId: string, options: FeatureFlagsListAuditOptions = {}) {
  await ensureSetup();
  const db = await getDb();

  const cleanKey = normalizeText(options.key);
  const limit = clamp(Math.floor(options.limit ?? DEFAULT_AUDIT_LIMIT), 1, MAX_AUDIT_LIMIT);

  const where = ['org_id = ?'];
  const params: Array<string | number> = [orgId];

  if (cleanKey) {
    where.push('key = ?');
    params.push(cleanKey);
  }

  const rows = await db.getAllAsync<CacheAuditRow>(
    `
      SELECT id, org_id, key, old_value_json, new_value_json, changed_by, changed_at
      FROM ${FLAGS_AUDIT_CACHE_TABLE}
      WHERE ${where.join(' AND ')}
      ORDER BY changed_at DESC
      LIMIT ?
    `,
    ...params,
    limit
  );

  return rows.map((row) => ({
    id: row.id,
    org_id: row.org_id,
    key: row.key,
    old_value: normalizeAuditValue(parseJsonObject(row.old_value_json)),
    new_value: normalizeAuditValue(parseJsonObject(row.new_value_json)),
    changed_by: toOptional(row.changed_by),
    changed_at: row.changed_at
  }));
}

async function resolveContext(preferredOrgId?: string | null, requireAdmin?: boolean) {
  const client = requireSupabaseClient();
  const session = await getRequiredSession(client);

  const preferred = normalizeText(preferredOrgId) || normalizeText(contextOrgId) || undefined;
  const membership = await resolveMembership(session.user.id, preferred, client);

  if (!membership.orgId) {
    throw new Error('Aucune organisation active.');
  }

  const memberRole = normalizeMemberRole(membership.memberRole);
  if (requireAdmin && !ADMIN_ROLES.has(memberRole)) {
    throw new Error('Accès refusé: rôle admin requis.');
  }

  return {
    client,
    orgId: membership.orgId,
    userId: session.user.id,
    memberRole
  };
}

async function resolveOrgIdForRead(preferredOrgId?: string | null) {
  const preferred = normalizeText(preferredOrgId);
  if (preferred) {
    return preferred;
  }

  if (contextOrgId) {
    return contextOrgId;
  }

  const context = await resolveContext(undefined, false);
  return context.orgId;
}

async function loadRemoteFlags(orgId: string) {
  const client = requireSupabaseClient();

  const primary = await client
    .from('feature_flags')
    .select('key, enabled, payload, updated_at, updated_by')
    .eq('org_id', orgId)
    .order('key', { ascending: true });

  if (primary.error && !isMissingColumnError(primary.error, 'updated_by')) {
    throw new Error(primary.error.message);
  }

  if (!primary.error) {
    return (primary.data ?? []) as FeatureFlagRow[];
  }

  const fallback = await client
    .from('feature_flags')
    .select('key, enabled, payload, updated_at')
    .eq('org_id', orgId)
    .order('key', { ascending: true });

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return ((fallback.data ?? []) as FeatureFlagRow[]).map((row) => ({
    ...row,
    updated_by: null
  }));
}

async function loadRemoteAudit(orgId: string, options: FeatureFlagsListAuditOptions = {}) {
  const client = requireSupabaseClient();

  const cleanKey = normalizeText(options.key);
  const limit = clamp(Math.floor(options.limit ?? DEFAULT_AUDIT_LIMIT), 1, MAX_AUDIT_LIMIT);

  let query = client
    .from('feature_flags_audit')
    .select('id, org_id, key, old_value, new_value, changed_by, changed_at')
    .eq('org_id', orgId)
    .order('changed_at', { ascending: false })
    .limit(limit);

  if (cleanKey) {
    query = query.eq('key', cleanKey);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error, 'feature_flags_audit')) {
      return [] as FeatureFlagAuditRecord[];
    }

    throw new Error(error.message);
  }

  return ((data ?? []) as FeatureFlagAuditRow[]).map((row) => ({
    id: row.id,
    org_id: row.org_id,
    key: row.key,
    old_value: normalizeAuditValue(row.old_value),
    new_value: normalizeAuditValue(row.new_value),
    changed_by: toOptional(row.changed_by),
    changed_at: row.changed_at
  }));
}

function findFlag(flags: FeatureFlagRecord[], key: string) {
  const cleanKey = normalizeText(key);
  return flags.find((item) => item.key === cleanKey) ?? null;
}

function fallbackRecord(orgId: string, key: string, enabled?: boolean, payload?: Record<string, unknown>) {
  return toFlagRecord(
    orgId,
    key,
    enabled ?? defaultEnabledForKey(key),
    payload ?? {},
    'DEFAULT',
    undefined,
    undefined
  );
}

export const flags: FeatureFlagsApi = {
  setContext(context) {
    contextOrgId = normalizeText(context.org_id) || null;
    contextUserId = normalizeText(context.user_id) || null;
  },

  setOrg(orgId) {
    contextOrgId = normalizeText(orgId) || null;
  },

  setActor(userId) {
    contextUserId = normalizeText(userId) || null;
  },

  async refresh(preferredOrgId) {
    const orgId = await resolveOrgIdForRead(preferredOrgId);

    try {
      const rows = await loadRemoteFlags(orgId);

      const normalized = withModuleDefaults(
        orgId,
        rows.map((row) =>
          toFlagRecord(
            orgId,
            row.key,
            Boolean(row.enabled),
            normalizePayload(row.payload),
            'REMOTE',
            toOptional(row.updated_at),
            toOptional(row.updated_by)
          )
        )
      );

      await writeFlagsCache(orgId, normalized);
      setMemory(orgId, normalized);

      return normalized;
    } catch (error) {
      const fallback = await readFlagsCache(orgId);
      if (fallback.length > 0) {
        setMemory(orgId, fallback);
        return fallback;
      }

      throw error;
    }
  },

  async listAll(preferredOrgId) {
    const orgId = await resolveOrgIdForRead(preferredOrgId);

    const fromMemory = getMemoryList(orgId);
    if (fromMemory.length > 0) {
      return fromMemory;
    }

    const fromCache = await readFlagsCache(orgId);
    if (fromCache.length > 0) {
      setMemory(orgId, fromCache);
      return fromCache;
    }

    return this.refresh(orgId);
  },

  isEnabled(key, options = {}) {
    const cleanKey = normalizeText(key);
    if (!cleanKey) {
      return false;
    }

    const orgId = normalizeText(options.orgId) || normalizeText(contextOrgId);
    const fallback =
      typeof options.fallback === 'boolean' ? options.fallback : defaultEnabledForKey(cleanKey);

    if (!orgId) {
      return fallback;
    }

    const record = getMemoryFlag(orgId, cleanKey);
    if (!record) {
      return fallback;
    }

    return record.enabled;
  },

  getPayload<T extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
    options: FeatureFlagsPayloadOptions = {}
  ) {
    const cleanKey = normalizeText(key);
    if (!cleanKey) {
      return null;
    }

    const orgId = normalizeText(options.orgId) || normalizeText(contextOrgId);
    if (!orgId) {
      return null;
    }

    const record = getMemoryFlag(orgId, cleanKey);
    if (!record) {
      return null;
    }

    return ensureObject(record.payload) as T;
  },

  async setEnabled(key, enabled, preferredOrgId) {
    const cleanKey = normalizeText(key);
    if (!cleanKey) {
      throw new Error('key feature flag requis.');
    }

    const context = await resolveContext(preferredOrgId, true);
    const current = findFlag(await this.listAll(context.orgId), cleanKey);

    const { error } = await context.client.rpc('set_feature_flag', {
      p_org_id: context.orgId,
      p_key: cleanKey,
      p_enabled: enabled,
      p_payload: current?.payload ?? {}
    });

    if (error) {
      throw new Error(error.message);
    }

    const refreshed = await this.refresh(context.orgId);
    return findFlag(refreshed, cleanKey) ?? fallbackRecord(context.orgId, cleanKey, enabled, current?.payload);
  },

  async setPayload(key, payload, preferredOrgId) {
    const cleanKey = normalizeText(key);
    if (!cleanKey) {
      throw new Error('key feature flag requis.');
    }

    const safePayload = ensureObject(payload);
    const context = await resolveContext(preferredOrgId, true);

    const current = findFlag(await this.listAll(context.orgId), cleanKey);
    const enabled = current?.enabled ?? defaultEnabledForKey(cleanKey);

    const { error } = await context.client.rpc('set_feature_flag', {
      p_org_id: context.orgId,
      p_key: cleanKey,
      p_enabled: enabled,
      p_payload: safePayload
    });

    if (error) {
      throw new Error(error.message);
    }

    const refreshed = await this.refresh(context.orgId);
    return findFlag(refreshed, cleanKey) ?? fallbackRecord(context.orgId, cleanKey, enabled, safePayload);
  },

  async listAudit(preferredOrgId, options = {}) {
    const orgId = await resolveOrgIdForRead(preferredOrgId);
    const cleanKey = normalizeText(options.key) || undefined;
    const safeOptions = {
      key: cleanKey,
      limit: clamp(Math.floor(options.limit ?? DEFAULT_AUDIT_LIMIT), 1, MAX_AUDIT_LIMIT)
    } satisfies FeatureFlagsListAuditOptions;

    try {
      const remote = await loadRemoteAudit(orgId, safeOptions);
      await writeAuditCache(orgId, remote, cleanKey);
      return remote;
    } catch (error) {
      const fallback = await readAuditCache(orgId, safeOptions);
      if (fallback.length > 0 || isMissingTableError(error, 'feature_flags_audit')) {
        return fallback;
      }

      throw error;
    }
  },

  async rollbackLastChange(key, preferredOrgId) {
    const cleanKey = normalizeText(key);
    if (!cleanKey) {
      throw new Error('key feature flag requis pour rollback.');
    }

    const context = await resolveContext(preferredOrgId, true);
    const latestAudit = await this.listAudit(context.orgId, { key: cleanKey, limit: 1 });

    if (latestAudit.length === 0) {
      throw new Error('Aucun audit trouvé pour ce flag.');
    }

    const last = latestAudit[0];
    const previousEnabled =
      typeof last.old_value.enabled === 'boolean' ? last.old_value.enabled : defaultEnabledForKey(cleanKey);
    const previousPayload =
      last.old_value.payload && isRecord(last.old_value.payload) ? last.old_value.payload : {};

    const { error } = await context.client.rpc('set_feature_flag', {
      p_org_id: context.orgId,
      p_key: cleanKey,
      p_enabled: previousEnabled,
      p_payload: previousPayload
    });

    if (error) {
      throw new Error(error.message);
    }

    const refreshed = await this.refresh(context.orgId);
    return findFlag(refreshed, cleanKey) ?? fallbackRecord(context.orgId, cleanKey, previousEnabled, previousPayload);
  }
};
