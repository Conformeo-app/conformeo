import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { appEnv } from '../../core/env';
import { isMissingColumnError, isMissingTableError, toErrorMessage } from '../../core/identity-security/utils';
import { requireSupabaseClient } from '../../core/supabase/client';
import { AuditExportResult, AuditListFilters, AuditLogEntry, AuditLogPayload, AuditSource } from './types';

const DB_NAME = 'conformeo.db';
const CACHE_TABLE = 'audit_logs_cache';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const FLUSH_BATCH_SIZE = 50;

type CacheRow = {
  id: string;
  remote_id: string | null;
  org_id: string;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  payload_json: string;
  created_at: string;
  source: AuditSource;
  pending_remote: number;
  updated_at: string;
};

type NormalizedAudit = {
  id?: string;
  remote_id?: string | null;
  org_id: string;
  user_id?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  payload_json: AuditLogPayload;
  created_at: string;
  source: AuditSource;
  pending_remote: boolean;
};

type RemoteRow = {
  id: number | string;
  org_id: string;
  user_id?: string | null;
  actor_user_id?: string | null;
  action: string;
  entity?: string | null;
  target_type?: string | null;
  entity_id?: string | null;
  target_id?: string | null;
  payload_json?: unknown;
  metadata?: unknown;
  created_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function toOptional(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function parseJsonObject(raw: string | null | undefined): AuditLogPayload {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AuditLogPayload;
    }
  } catch {
    return {};
  }

  return {};
}

function ensurePayload(value: unknown): AuditLogPayload {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as AuditLogPayload;
  }
  return {};
}

function createUuid() {
  const randomUUID = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function localKey(id: string) {
  return `local:${id}`;
}

function remoteKey(id: string) {
  return `remote:${id}`;
}

function exportEntryId(row: CacheRow) {
  if (row.remote_id) {
    return row.remote_id;
  }

  if (row.id.startsWith('local:')) {
    return row.id.slice('local:'.length);
  }

  if (row.id.startsWith('remote:')) {
    return row.id.slice('remote:'.length);
  }

  return row.id;
}

function mapCacheRow(row: CacheRow): AuditLogEntry {
  return {
    id: exportEntryId(row),
    org_id: row.org_id,
    user_id: row.user_id,
    action: row.action,
    entity: row.entity,
    entity_id: row.entity_id,
    payload_json: parseJsonObject(row.payload_json),
    created_at: row.created_at,
    source: row.source,
    pending_remote: row.pending_remote === 1
  };
}

function normalizeAudit(input: NormalizedAudit): NormalizedAudit {
  const action = normalizeText(input.action);
  const entity = normalizeText(input.entity);
  const orgId = normalizeText(input.org_id);

  if (!orgId) {
    throw new Error('org_id manquant (audit).');
  }

  if (!action) {
    throw new Error('action manquante (audit).');
  }

  if (!entity) {
    throw new Error('entity manquante (audit).');
  }

  return {
    ...input,
    id: input.id,
    remote_id: toOptional(input.remote_id ?? undefined) ?? null,
    org_id: orgId,
    user_id: toOptional(input.user_id ?? undefined) ?? null,
    action,
    entity,
    entity_id: toOptional(input.entity_id ?? undefined) ?? null,
    payload_json: ensurePayload(input.payload_json),
    created_at: toOptional(input.created_at) ?? nowIso(),
    source: input.source,
    pending_remote: Boolean(input.pending_remote)
  };
}

function mapRemoteRow(row: RemoteRow): NormalizedAudit {
  const remoteId = String(row.id);
  const userId = toOptional(row.user_id) ?? toOptional(row.actor_user_id) ?? null;
  const entity = toOptional(row.entity) ?? toOptional(row.target_type) ?? 'unknown';
  const entityId = toOptional(row.entity_id) ?? toOptional(row.target_id) ?? null;
  const payload = ensurePayload(row.payload_json ?? row.metadata ?? {});

  return normalizeAudit({
    id: remoteKey(remoteId),
    remote_id: remoteId,
    org_id: row.org_id,
    user_id: userId,
    action: row.action,
    entity,
    entity_id: entityId,
    payload_json: payload,
    created_at: row.created_at,
    source: 'REMOTE',
    pending_remote: false
  });
}

function normalizeLimitOffset(filters: AuditListFilters) {
  const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  return { limit, offset };
}

function shouldFallbackToLegacyColumns(error: unknown) {
  return (
    isMissingColumnError(error, 'audit_logs.user_id') ||
    isMissingColumnError(error, 'audit_logs.entity') ||
    isMissingColumnError(error, 'audit_logs.entity_id') ||
    isMissingColumnError(error, 'audit_logs.payload_json') ||
    isMissingColumnError(error, 'user_id') ||
    isMissingColumnError(error, 'entity') ||
    isMissingColumnError(error, 'entity_id') ||
    isMissingColumnError(error, 'payload_json')
  );
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
          id TEXT PRIMARY KEY NOT NULL,
          remote_id TEXT,
          org_id TEXT NOT NULL,
          user_id TEXT,
          action TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('REMOTE', 'LOCAL')),
          pending_remote INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_cache_remote_id
          ON ${CACHE_TABLE}(remote_id);

        CREATE INDEX IF NOT EXISTS idx_audit_logs_cache_org_created
          ON ${CACHE_TABLE}(org_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_audit_logs_cache_pending
          ON ${CACHE_TABLE}(org_id, pending_remote, created_at ASC);
      `);
    })();
  }

  return setupPromise;
}

async function upsertCache(entry: NormalizedAudit) {
  await ensureSetup();
  const db = await getDb();

  const normalized = normalizeAudit(entry);
  const cacheId =
    normalized.id ??
    (normalized.remote_id ? remoteKey(normalized.remote_id) : localKey(createUuid()));

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${CACHE_TABLE}
      (
        id, remote_id, org_id, user_id, action, entity, entity_id,
        payload_json, created_at, source, pending_remote, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    cacheId,
    normalized.remote_id ?? null,
    normalized.org_id,
    normalized.user_id ?? null,
    normalized.action,
    normalized.entity,
    normalized.entity_id ?? null,
    JSON.stringify(normalized.payload_json ?? {}),
    normalized.created_at,
    normalized.source,
    normalized.pending_remote ? 1 : 0,
    nowIso()
  );
}

async function removeCacheById(id: string) {
  await ensureSetup();
  const db = await getDb();
  await db.runAsync(`DELETE FROM ${CACHE_TABLE} WHERE id = ?`, id);
}

async function getPendingRows(orgId: string, limit = FLUSH_BATCH_SIZE): Promise<CacheRow[]> {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<CacheRow>(
    `
      SELECT id, remote_id, org_id, user_id, action, entity, entity_id, payload_json, created_at, source, pending_remote, updated_at
      FROM ${CACHE_TABLE}
      WHERE org_id = ?
        AND pending_remote = 1
      ORDER BY created_at ASC
      LIMIT ?
    `,
    orgId,
    Math.max(1, Math.min(limit, FLUSH_BATCH_SIZE))
  );

  return rows ?? [];
}

async function listCache(orgId: string, filters: AuditListFilters = {}) {
  await ensureSetup();
  const db = await getDb();

  const { limit, offset } = normalizeLimitOffset(filters);

  const where: string[] = ['org_id = ?'];
  const params: Array<string | number> = [orgId];

  const action = toOptional(filters.action);
  if (action) {
    where.push('LOWER(action) = LOWER(?)');
    params.push(action);
  }

  const entity = toOptional(filters.entity);
  if (entity) {
    where.push('LOWER(entity) = LOWER(?)');
    params.push(entity);
  }

  const userId = toOptional(filters.user_id);
  if (userId) {
    where.push('user_id = ?');
    params.push(userId);
  }

  const from = toOptional(filters.from);
  if (from) {
    where.push('created_at >= ?');
    params.push(from);
  }

  const to = toOptional(filters.to);
  if (to) {
    where.push('created_at <= ?');
    params.push(to);
  }

  const includePending = filters.include_pending !== false;
  if (!includePending) {
    where.push('pending_remote = 0');
  }

  params.push(limit, offset);

  const rows = await db.getAllAsync<CacheRow>(
    `
      SELECT id, remote_id, org_id, user_id, action, entity, entity_id, payload_json, created_at, source, pending_remote, updated_at
      FROM ${CACHE_TABLE}
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `,
    ...params
  );

  return (rows ?? []).map(mapCacheRow);
}

function canUseRemote() {
  return appEnv.isSupabaseConfigured;
}

function requireOrgId(preferred?: string) {
  const orgId = normalizeText(preferred ?? contextOrgId ?? undefined);
  if (!orgId) {
    throw new Error('org_id manquant (audit).');
  }
  return orgId;
}

function requireUserId(preferred?: string) {
  const userId = normalizeText(preferred ?? contextUserId ?? undefined);
  if (!userId) {
    throw new Error('user_id manquant (audit).');
  }
  return userId;
}

async function insertRemote(entry: NormalizedAudit) {
  const client = requireSupabaseClient();
  const normalized = normalizeAudit(entry);

  const payload = {
    org_id: normalized.org_id,
    user_id: normalized.user_id ?? null,
    actor_user_id: normalized.user_id ?? null,
    action: normalized.action,
    entity: normalized.entity,
    target_type: normalized.entity,
    entity_id: normalized.entity_id ?? null,
    target_id: normalized.entity_id ?? null,
    payload_json: normalized.payload_json,
    metadata: normalized.payload_json,
    created_at: normalized.created_at
  };

  const { data, error } = await client
    .from('audit_logs')
    .insert(payload)
    .select(
      'id, org_id, user_id, actor_user_id, action, entity, target_type, entity_id, target_id, payload_json, metadata, created_at'
    )
    .single<RemoteRow>();

  if (error) {
    if (!shouldFallbackToLegacyColumns(error)) {
      throw new Error(error.message);
    }

    const { data: legacyData, error: legacyError } = await client
      .from('audit_logs')
      .insert({
        org_id: normalized.org_id,
        actor_user_id: normalized.user_id ?? null,
        action: normalized.action,
        target_type: normalized.entity,
        target_id: normalized.entity_id ?? null,
        metadata: normalized.payload_json,
        created_at: normalized.created_at
      })
      .select('id, org_id, actor_user_id, action, target_type, target_id, metadata, created_at')
      .single<RemoteRow>();

    if (legacyError) {
      throw new Error(legacyError.message);
    }

    if (!legacyData) {
      throw new Error('Reponse audit distante invalide.');
    }

    return mapRemoteRow(legacyData);
  }

  if (!data) {
    throw new Error('Reponse audit distante vide.');
  }

  return mapRemoteRow(data);
}

async function fetchRemote(orgId: string, filters: AuditListFilters = {}) {
  const client = requireSupabaseClient();
  const { limit, offset } = normalizeLimitOffset(filters);

  const action = toOptional(filters.action);
  const entity = toOptional(filters.entity);
  const userId = toOptional(filters.user_id);
  const from = toOptional(filters.from);
  const to = toOptional(filters.to);

  let query = client
    .from('audit_logs')
    .select(
      'id, org_id, user_id, actor_user_id, action, entity, target_type, entity_id, target_id, payload_json, metadata, created_at'
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (action) {
    query = query.eq('action', action);
  }

  if (entity) {
    query = query.eq('entity', entity);
  }

  if (userId) {
    query = query.or(`user_id.eq.${userId},actor_user_id.eq.${userId}`);
  }

  if (from) {
    query = query.gte('created_at', from);
  }

  if (to) {
    query = query.lte('created_at', to);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error, 'audit_logs')) {
      return [] as NormalizedAudit[];
    }

    if (!shouldFallbackToLegacyColumns(error)) {
      throw new Error(error.message);
    }

    let legacyQuery = client
      .from('audit_logs')
      .select('id, org_id, actor_user_id, action, target_type, target_id, metadata, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (action) {
      legacyQuery = legacyQuery.eq('action', action);
    }

    if (entity) {
      legacyQuery = legacyQuery.eq('target_type', entity);
    }

    if (userId) {
      legacyQuery = legacyQuery.eq('actor_user_id', userId);
    }

    if (from) {
      legacyQuery = legacyQuery.gte('created_at', from);
    }

    if (to) {
      legacyQuery = legacyQuery.lte('created_at', to);
    }

    const { data: legacyData, error: legacyError } = await legacyQuery;
    if (legacyError) {
      if (isMissingTableError(legacyError, 'audit_logs')) {
        return [] as NormalizedAudit[];
      }
      throw new Error(legacyError.message);
    }

    return (legacyData ?? []).map((row) => mapRemoteRow(row as RemoteRow));
  }

  return (data ?? []).map((row) => mapRemoteRow(row as RemoteRow));
}

async function writeRemoteRowsToCache(rows: NormalizedAudit[]) {
  for (const row of rows) {
    await upsertCache({
      ...row,
      id: row.remote_id ? remoteKey(row.remote_id) : row.id
    });
  }
}

async function flushPending(orgId: string) {
  if (!canUseRemote()) {
    return;
  }

  const pending = await getPendingRows(orgId, FLUSH_BATCH_SIZE);
  if (pending.length === 0) {
    return;
  }

  for (const row of pending) {
    const payload = parseJsonObject(row.payload_json);
    try {
      const inserted = await insertRemote({
        org_id: row.org_id,
        user_id: row.user_id,
        action: row.action,
        entity: row.entity,
        entity_id: row.entity_id,
        payload_json: payload,
        created_at: row.created_at,
        source: 'LOCAL',
        pending_remote: false
      });

      await removeCacheById(row.id);
      await upsertCache(inserted);
    } catch (error) {
      if (__DEV__) {
        console.warn('[audit] flush pending failed:', toErrorMessage(error));
      }
    }
  }
}

async function writeLocalLog(entry: NormalizedAudit, pendingRemote: boolean) {
  const localId = localKey(createUuid());
  const next = normalizeAudit({
    ...entry,
    id: localId,
    remote_id: null,
    source: 'LOCAL',
    pending_remote: pendingRemote
  });
  await upsertCache(next);

  return mapCacheRow({
    id: next.id ?? localId,
    remote_id: null,
    org_id: next.org_id,
    user_id: next.user_id ?? null,
    action: next.action,
    entity: next.entity,
    entity_id: next.entity_id ?? null,
    payload_json: JSON.stringify(next.payload_json),
    created_at: next.created_at,
    source: next.source,
    pending_remote: next.pending_remote ? 1 : 0,
    updated_at: nowIso()
  });
}

function requireDocumentDirectory() {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    throw new Error('FileSystem documentDirectory indisponible.');
  }
  return directory;
}

function sanitizeFileToken(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return normalized.length > 0 ? normalized : 'org';
}

function exportDirectory() {
  return `${requireDocumentDirectory()}audit_exports/`;
}

export const audit = {
  setContext(context: Partial<{ org_id: string; user_id: string }>) {
    if (context.org_id !== undefined) {
      const orgId = toOptional(context.org_id);
      contextOrgId = orgId ?? null;
    }

    if (context.user_id !== undefined) {
      const userId = toOptional(context.user_id);
      contextUserId = userId ?? null;
    }
  },

  setOrg(orgId: string | null) {
    contextOrgId = toOptional(orgId ?? undefined) ?? null;
  },

  setActor(userId: string | null) {
    contextUserId = toOptional(userId ?? undefined) ?? null;
  },

  async log(action: string, entity: string, id: string, payload: AuditLogPayload = {}): Promise<AuditLogEntry> {
    const orgId = requireOrgId();
    const userId = requireUserId();
    await ensureSetup();

    const normalized = normalizeAudit({
      org_id: orgId,
      user_id: userId,
      action,
      entity,
      entity_id: id,
      payload_json: payload,
      created_at: nowIso(),
      source: 'LOCAL',
      pending_remote: false
    });

    if (canUseRemote()) {
      try {
        const inserted = await insertRemote(normalized);
        await upsertCache(inserted);

        return mapCacheRow({
          id: inserted.id ?? remoteKey(inserted.remote_id ?? createUuid()),
          remote_id: inserted.remote_id ?? null,
          org_id: inserted.org_id,
          user_id: inserted.user_id ?? null,
          action: inserted.action,
          entity: inserted.entity,
          entity_id: inserted.entity_id ?? null,
          payload_json: JSON.stringify(inserted.payload_json ?? {}),
          created_at: inserted.created_at,
          source: inserted.source,
          pending_remote: inserted.pending_remote ? 1 : 0,
          updated_at: nowIso()
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[audit] remote insert failed, fallback local pending:', toErrorMessage(error));
        }

        return writeLocalLog(normalized, true);
      }
    }

    return writeLocalLog(normalized, false);
  },

  async list(filters: AuditListFilters = {}): Promise<AuditLogEntry[]> {
    const orgId = requireOrgId(filters.org_id);
    await ensureSetup();

    if (canUseRemote()) {
      try {
        await flushPending(orgId);
      } catch (error) {
        if (__DEV__) {
          console.warn('[audit] flush pending failed:', toErrorMessage(error));
        }
      }

      try {
        const remoteRows = await fetchRemote(orgId, filters);
        await writeRemoteRowsToCache(remoteRows);
      } catch (error) {
        if (__DEV__) {
          console.warn('[audit] remote refresh failed:', toErrorMessage(error));
        }
      }
    }

    return listCache(orgId, filters);
  },

  async export(filters: AuditListFilters = {}): Promise<AuditExportResult> {
    const orgId = requireOrgId(filters.org_id);
    const rows = await this.list(filters);
    const exportedAt = nowIso();

    const directory = exportDirectory();
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

    const token = sanitizeFileToken(orgId).slice(0, 36);
    const stamp = exportedAt.replace(/[:.]/g, '-');
    const path = `${directory}audit_${token}_${stamp}.json`;

    const payload = {
      app: 'conformeo',
      org_id: orgId,
      exported_at: exportedAt,
      count: rows.length,
      filters: {
        action: toOptional(filters.action),
        entity: toOptional(filters.entity),
        user_id: toOptional(filters.user_id),
        from: toOptional(filters.from),
        to: toOptional(filters.to)
      },
      logs: rows
    };

    await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2), {
      encoding: FileSystem.EncodingType.UTF8
    });

    return {
      path,
      count: rows.length,
      exported_at: exportedAt
    };
  },

  async flushPending() {
    const orgId = requireOrgId();
    await flushPending(orgId);
  }
};
