import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { appEnv } from '../../core/env';
import { isMissingColumnError, isMissingTableError, toErrorMessage } from '../../core/identity-security/utils';
import { requireSupabaseClient } from '../../core/supabase/client';
import { audit } from '../audit-compliance';
import { exportsDoe } from '../exports';
import { admin } from '../super-admin';
import {
  AnonymizeUserResult,
  PortableDataExportResult,
  RetentionApplyItem,
  RetentionApplyResult,
  RetentionEntity,
  RetentionPolicy
} from './types';

const DB_NAME = 'conformeo.db';
const POLICIES_TABLE = 'retention_policies_cache';
const PORTABLE_EXPORT_DIR = 'portable_exports';

const MAX_RETENTION_DAYS = 3650;
const MIN_RETENTION_DAYS = 1;

const ENTITY_LIST: RetentionEntity[] = [
  'AUDIT_LOGS',
  'EXPORT_JOBS',
  'DELETED_TASKS',
  'DELETED_DOCUMENTS',
  'RECENTS',
  'OPERATIONS_SYNCED'
];

const DEFAULT_RETENTION_DAYS: Record<RetentionEntity, number> = {
  AUDIT_LOGS: 3650,
  EXPORT_JOBS: 365,
  DELETED_TASKS: 365,
  DELETED_DOCUMENTS: 365,
  RECENTS: 180,
  OPERATIONS_SYNCED: 30
};

type PolicyCacheRow = {
  org_id: string;
  entity: string;
  retention_days: number;
  updated_at: string;
  updated_by: string | null;
  source: 'REMOTE' | 'LOCAL' | 'DEFAULT';
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

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function ensureEntity(value: string): RetentionEntity {
  const normalized = normalizeText(value).toUpperCase();
  if (!ENTITY_LIST.includes(normalized as RetentionEntity)) {
    throw new Error(`Entité de retention invalide: ${value}`);
  }
  return normalized as RetentionEntity;
}

function clampDays(days: number) {
  const parsed = Math.floor(days);
  if (!Number.isFinite(parsed) || parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) {
    throw new Error(`retention_days invalide: ${days} (attendu ${MIN_RETENTION_DAYS}..${MAX_RETENTION_DAYS})`);
  }
  return parsed;
}

function isMissingFunctionError(error: unknown, functionName: string) {
  const message = toErrorMessage(error, '').toLowerCase();
  return message.includes('function') && message.includes(functionName.toLowerCase()) && message.includes('does not exist');
}

function tableNotReady(error: unknown, tableName: string) {
  return isMissingTableError(error, tableName) || isMissingColumnError(error, tableName);
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

async function tableExists(db: SQLite.SQLiteDatabase, tableName: string) {
  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
    `,
    tableName
  );

  return (row?.count ?? 0) > 0;
}

async function listTableColumns(db: SQLite.SQLiteDatabase, tableName: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(tableName)})`);
  return (rows ?? []).map((row) => String(row.name));
}

function hasColumn(columns: string[], columnName: string) {
  return columns.some((column) => column.toLowerCase() === columnName.toLowerCase());
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      const db = await getDb();
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS ${POLICIES_TABLE} (
          org_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          retention_days INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT,
          source TEXT NOT NULL CHECK (source IN ('REMOTE', 'LOCAL', 'DEFAULT')),
          PRIMARY KEY (org_id, entity)
        );

        CREATE INDEX IF NOT EXISTS idx_retention_policies_cache_org_entity
          ON ${POLICIES_TABLE}(org_id, entity);
      `);
    })();
  }

  return setupPromise;
}

function requireOrgId(preferred?: string) {
  const orgId = normalizeText(preferred ?? contextOrgId ?? undefined);
  if (!orgId) {
    throw new Error('org_id manquant (data-governance).');
  }
  return orgId;
}

function requireUserId() {
  const userId = normalizeText(contextUserId ?? undefined);
  if (!userId) {
    throw new Error('user_id manquant (data-governance).');
  }
  return userId;
}

function toPolicy(
  orgId: string,
  entity: RetentionEntity,
  retentionDays: number,
  source: 'REMOTE' | 'LOCAL' | 'DEFAULT',
  updatedBy?: string | null,
  updatedAt?: string
): RetentionPolicy {
  return {
    org_id: orgId,
    entity,
    retention_days: clampDays(retentionDays),
    updated_at: toOptional(updatedAt) ?? nowIso(),
    updated_by: toOptional(updatedBy ?? undefined) ?? null,
    source
  };
}

async function upsertPolicyCache(policy: RetentionPolicy) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${POLICIES_TABLE}
      (org_id, entity, retention_days, updated_at, updated_by, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    policy.org_id,
    policy.entity,
    policy.retention_days,
    policy.updated_at,
    policy.updated_by ?? null,
    policy.source
  );
}

async function readPoliciesCache(orgId: string): Promise<RetentionPolicy[]> {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<PolicyCacheRow>(
    `
      SELECT org_id, entity, retention_days, updated_at, updated_by, source
      FROM ${POLICIES_TABLE}
      WHERE org_id = ?
      ORDER BY entity ASC
    `,
    orgId
  );

  return (rows ?? [])
    .map((row) => {
      try {
        return toPolicy(orgId, ensureEntity(row.entity), row.retention_days, row.source, row.updated_by, row.updated_at);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as RetentionPolicy[];
}

function mergeWithDefaultPolicies(orgId: string, rows: RetentionPolicy[]) {
  const map = new Map<RetentionEntity, RetentionPolicy>();

  for (const row of rows) {
    map.set(row.entity, row);
  }

  for (const entity of ENTITY_LIST) {
    if (!map.has(entity)) {
      map.set(entity, toPolicy(orgId, entity, DEFAULT_RETENTION_DAYS[entity], 'DEFAULT', null, nowIso()));
    }
  }

  return [...map.values()].sort((left, right) => left.entity.localeCompare(right.entity));
}

async function loadRemotePolicies(orgId: string) {
  if (!appEnv.isSupabaseConfigured) {
    return null;
  }

  const client = requireSupabaseClient();
  const { data, error } = await client
    .from('retention_policies')
    .select('org_id, entity, retention_days, updated_at, updated_by')
    .eq('org_id', orgId)
    .order('entity', { ascending: true });

  if (error) {
    if (tableNotReady(error, 'retention_policies')) {
      return null;
    }
    throw new Error(error.message);
  }

  const mapped = (data ?? [])
    .map((row) => {
      try {
        return toPolicy(orgId, ensureEntity(String(row.entity)), Number(row.retention_days), 'REMOTE', row.updated_by, row.updated_at);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as RetentionPolicy[];

  return mapped;
}

async function saveRemotePolicy(orgId: string, entity: RetentionEntity, days: number, updatedBy: string) {
  if (!appEnv.isSupabaseConfigured) {
    return null;
  }

  const client = requireSupabaseClient();
  const updatedAt = nowIso();

  const { data: rpcData, error: rpcError } = await client.rpc('set_retention_policy', {
    p_org_id: orgId,
    p_entity: entity,
    p_retention_days: days
  });

  if (!rpcError && rpcData) {
    const row = rpcData as { org_id?: string; entity?: string; retention_days?: number; updated_at?: string; updated_by?: string | null };
    return toPolicy(
      orgId,
      ensureEntity(String(row.entity ?? entity)),
      Number(row.retention_days ?? days),
      'REMOTE',
      row.updated_by ?? updatedBy,
      row.updated_at ?? updatedAt
    );
  }

  if (rpcError && !isMissingFunctionError(rpcError, 'set_retention_policy') && !tableNotReady(rpcError, 'retention_policies')) {
    throw new Error(rpcError.message);
  }

  const { data, error } = await client
    .from('retention_policies')
    .upsert(
      {
        org_id: orgId,
        entity,
        retention_days: days,
        updated_at: updatedAt,
        updated_by: updatedBy
      },
      { onConflict: 'org_id,entity' }
    )
    .select('org_id, entity, retention_days, updated_at, updated_by')
    .single();

  if (error) {
    if (tableNotReady(error, 'retention_policies')) {
      return null;
    }
    throw new Error(error.message);
  }

  return toPolicy(orgId, ensureEntity(String(data.entity)), Number(data.retention_days), 'REMOTE', data.updated_by, data.updated_at);
}

async function deleteFiles(paths: string[]): Promise<number> {
  let deleted = 0;

  for (const rawPath of paths) {
    const path = normalizeText(rawPath);
    if (!path) {
      continue;
    }

    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
      deleted += 1;
    } catch {
      // no-op
    }
  }

  return deleted;
}

async function applyAuditRetention(db: SQLite.SQLiteDatabase, orgId: string, cutoffIso: string) {
  const tableName = 'audit_logs_cache';
  if (!(await tableExists(db, tableName))) {
    return { deleted_rows: 0, deleted_files: 0 };
  }

  const result = await db.runAsync(
    `
      DELETE FROM ${quoteIdent(tableName)}
      WHERE org_id = ?
        AND created_at < ?
    `,
    orgId,
    cutoffIso
  );

  return { deleted_rows: result.changes ?? 0, deleted_files: 0 };
}

async function applyRecentsRetention(db: SQLite.SQLiteDatabase, orgId: string, cutoffIso: string) {
  const tableName = 'user_recents';
  if (!(await tableExists(db, tableName))) {
    return { deleted_rows: 0, deleted_files: 0 };
  }

  const result = await db.runAsync(
    `
      DELETE FROM ${quoteIdent(tableName)}
      WHERE org_id = ?
        AND last_opened_at < ?
    `,
    orgId,
    cutoffIso
  );

  return { deleted_rows: result.changes ?? 0, deleted_files: 0 };
}

async function applyOperationsRetention(db: SQLite.SQLiteDatabase, cutoffIso: string) {
  const tableName = 'operations_queue';
  if (!(await tableExists(db, tableName))) {
    return { deleted_rows: 0, deleted_files: 0 };
  }

  const result = await db.runAsync(
    `
      DELETE FROM ${quoteIdent(tableName)}
      WHERE status = 'SYNCED'
        AND created_at < ?
    `,
    cutoffIso
  );

  return { deleted_rows: result.changes ?? 0, deleted_files: 0 };
}

async function applyDeletedTasksRetention(db: SQLite.SQLiteDatabase, orgId: string, cutoffIso: string) {
  const tasksTable = 'tasks';
  if (!(await tableExists(db, tasksTable))) {
    return { deleted_rows: 0, deleted_files: 0 };
  }

  const taskRows = await db.getAllAsync<{ id: string }>(
    `
      SELECT id
      FROM ${quoteIdent(tasksTable)}
      WHERE org_id = ?
        AND deleted_at IS NOT NULL
        AND deleted_at < ?
    `,
    orgId,
    cutoffIso
  );

  const taskIds = (taskRows ?? []).map((row) => row.id).filter((value) => normalizeText(value).length > 0);
  if (taskIds.length === 0) {
    return { deleted_rows: 0, deleted_files: 0 };
  }

  const placeholders = taskIds.map(() => '?').join(', ');
  let deletedComments = 0;

  if (await tableExists(db, 'task_comments')) {
    const deleteCommentsResult = await db.runAsync(
      `
        DELETE FROM task_comments
        WHERE task_id IN (${placeholders})
      `,
      ...taskIds
    );

    deletedComments = deleteCommentsResult.changes ?? 0;
  }

  const deleteTasksResult = await db.runAsync(
    `
      DELETE FROM ${quoteIdent(tasksTable)}
      WHERE id IN (${placeholders})
    `,
    ...taskIds
  );

  return { deleted_rows: (deleteTasksResult.changes ?? 0) + deletedComments, deleted_files: 0 };
}

async function applyDeletedDocumentsRetention(db: SQLite.SQLiteDatabase, orgId: string, cutoffIso: string) {
  const docsTable = 'documents';
  if (!(await tableExists(db, docsTable))) {
    return { deleted_rows: 0, deleted_files: 0 };
  }

  const docRows = await db.getAllAsync<{ id: string }>(
    `
      SELECT id
      FROM ${quoteIdent(docsTable)}
      WHERE org_id = ?
        AND deleted_at IS NOT NULL
        AND deleted_at < ?
    `,
    orgId,
    cutoffIso
  );

  const docIds = (docRows ?? []).map((row) => row.id).filter((value) => normalizeText(value).length > 0);
  if (docIds.length === 0) {
    return { deleted_rows: 0, deleted_files: 0 };
  }

  const placeholders = docIds.map(() => '?').join(', ');
  let deletedVersions = 0;
  let deletedLinks = 0;
  let deletedSignatures = 0;

  if (await tableExists(db, 'document_versions')) {
    const deleteVersionsResult = await db.runAsync(
      `
        DELETE FROM document_versions
        WHERE document_id IN (${placeholders})
      `,
      ...docIds
    );
    deletedVersions = deleteVersionsResult.changes ?? 0;
  }

  if (await tableExists(db, 'document_links')) {
    const deleteLinksResult = await db.runAsync(
      `
        DELETE FROM document_links
        WHERE document_id IN (${placeholders})
      `,
      ...docIds
    );
    deletedLinks = deleteLinksResult.changes ?? 0;
  }

  if (await tableExists(db, 'signatures')) {
    const deleteSignaturesResult = await db.runAsync(
      `
        DELETE FROM signatures
        WHERE document_id IN (${placeholders})
      `,
      ...docIds
    );
    deletedSignatures = deleteSignaturesResult.changes ?? 0;
  }

  const deleteDocsResult = await db.runAsync(
    `
      DELETE FROM ${quoteIdent(docsTable)}
      WHERE id IN (${placeholders})
    `,
    ...docIds
  );

  return {
    deleted_rows: (deleteDocsResult.changes ?? 0) + deletedVersions + deletedLinks + deletedSignatures,
    deleted_files: 0
  };
}

async function applyExportRetention(orgId: string, days: number) {
  exportsDoe.setContext({
    org_id: orgId,
    user_id: contextUserId ?? undefined
  });

  const removed = await exportsDoe.purgeOldExports(days);
  return { deleted_rows: removed, deleted_files: removed };
}

async function applySinglePolicy(db: SQLite.SQLiteDatabase, orgId: string, entity: RetentionEntity, retentionDays: number) {
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  if (entity === 'AUDIT_LOGS') {
    return applyAuditRetention(db, orgId, cutoffIso);
  }

  if (entity === 'RECENTS') {
    return applyRecentsRetention(db, orgId, cutoffIso);
  }

  if (entity === 'OPERATIONS_SYNCED') {
    return applyOperationsRetention(db, cutoffIso);
  }

  if (entity === 'DELETED_TASKS') {
    return applyDeletedTasksRetention(db, orgId, cutoffIso);
  }

  if (entity === 'DELETED_DOCUMENTS') {
    return applyDeletedDocumentsRetention(db, orgId, cutoffIso);
  }

  return applyExportRetention(orgId, retentionDays);
}

async function listPortableRowsByTable(db: SQLite.SQLiteDatabase, tableName: string, orgId: string) {
  const columns = await listTableColumns(db, tableName);
  const quoted = quoteIdent(tableName);

  if (columns.length === 0) {
    return [] as Record<string, unknown>[];
  }

  if (hasColumn(columns, 'org_id')) {
    return (await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${quoted} WHERE org_id = ?`, orgId)) ?? [];
  }

  if (tableName === 'task_comments' && (await tableExists(db, 'tasks'))) {
    return (
      (await db.getAllAsync<Record<string, unknown>>(
        `
          SELECT c.*
          FROM task_comments c
          INNER JOIN tasks t ON t.id = c.task_id
          WHERE t.org_id = ?
        `,
        orgId
      )) ?? []
    );
  }

  if ((tableName === 'document_versions' || tableName === 'document_links') && (await tableExists(db, 'documents'))) {
    return (
      (await db.getAllAsync<Record<string, unknown>>(
        `
          SELECT x.*
          FROM ${quoted} x
          INNER JOIN documents d ON d.id = x.document_id
          WHERE d.org_id = ?
        `,
        orgId
      )) ?? []
    );
  }

  if (tableName === 'export_items' && (await tableExists(db, 'export_jobs'))) {
    return (
      (await db.getAllAsync<Record<string, unknown>>(
        `
          SELECT i.*
          FROM export_items i
          INNER JOIN export_jobs e ON e.id = i.export_id
          WHERE e.org_id = ?
        `,
        orgId
      )) ?? []
    );
  }

  return [] as Record<string, unknown>[];
}

function requireDocumentDirectory() {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    throw new Error('FileSystem documentDirectory indisponible.');
  }
  return directory;
}

function portableDirectory() {
  return `${requireDocumentDirectory()}${PORTABLE_EXPORT_DIR}/`;
}

async function anonymizeLocalTables(db: SQLite.SQLiteDatabase, orgId: string, userId: string, alias: string) {
  const result: Record<string, number> = {};

  const run = async (label: string, sql: string, ...params: Array<string | number>) => {
    const queryResult = await db.runAsync(sql, ...params);
    result[label] = queryResult.changes ?? 0;
  };

  if (await tableExists(db, 'tasks')) {
    await run('tasks.created_by', `UPDATE tasks SET created_by = ? WHERE org_id = ? AND created_by = ?`, alias, orgId, userId);
    await run('tasks.assignee_user_id', `UPDATE tasks SET assignee_user_id = NULL WHERE org_id = ? AND assignee_user_id = ?`, orgId, userId);
  }

  if ((await tableExists(db, 'task_comments')) && (await tableExists(db, 'tasks'))) {
    await run(
      'task_comments.created_by',
      `
        UPDATE task_comments
        SET created_by = ?
        WHERE created_by = ?
          AND task_id IN (SELECT id FROM tasks WHERE org_id = ?)
      `,
      alias,
      userId,
      orgId
    );
  }

  if (await tableExists(db, 'documents')) {
    await run('documents.created_by', `UPDATE documents SET created_by = ? WHERE org_id = ? AND created_by = ?`, alias, orgId, userId);
  }

  if ((await tableExists(db, 'document_versions')) && (await tableExists(db, 'documents'))) {
    await run(
      'document_versions.created_by',
      `
        UPDATE document_versions
        SET created_by = ?
        WHERE created_by = ?
          AND document_id IN (SELECT id FROM documents WHERE org_id = ?)
      `,
      alias,
      userId,
      orgId
    );
  }

  if (await tableExists(db, 'export_jobs')) {
    await run('export_jobs.created_by', `UPDATE export_jobs SET created_by = ? WHERE org_id = ? AND created_by = ?`, alias, orgId, userId);
  }

  if (await tableExists(db, 'signatures')) {
    await run(
      'signatures.signer_user_id',
      `UPDATE signatures SET signer_user_id = ?, signer_display_name = ? WHERE org_id = ? AND signer_user_id = ?`,
      alias,
      'Utilisateur supprimé',
      orgId,
      userId
    );
  }

  if (await tableExists(db, 'audit_logs_cache')) {
    await run('audit_logs_cache.user_id', `UPDATE audit_logs_cache SET user_id = NULL WHERE org_id = ? AND user_id = ?`, orgId, userId);
  }

  if (await tableExists(db, 'user_favorites')) {
    await run('user_favorites.deleted', `DELETE FROM user_favorites WHERE org_id = ? AND user_id = ?`, orgId, userId);
  }

  if (await tableExists(db, 'user_recents')) {
    await run('user_recents.deleted', `DELETE FROM user_recents WHERE org_id = ? AND user_id = ?`, orgId, userId);
  }

  if (await tableExists(db, POLICIES_TABLE)) {
    await run(
      'retention_policies_cache.updated_by',
      `UPDATE ${POLICIES_TABLE} SET updated_by = ? WHERE org_id = ? AND updated_by = ?`,
      alias,
      orgId,
      userId
    );
  }

  return result;
}

async function anonymizeRemote(orgId: string, userId: string) {
  if (!appEnv.isSupabaseConfigured) {
    return { remote_applied: false, remote_error: 'Supabase non configuré' };
  }

  const client = requireSupabaseClient();
  const { error } = await client.rpc('anonymize_user_data', {
    p_org_id: orgId,
    p_user_id: userId
  });

  if (!error) {
    return { remote_applied: true as const };
  }

  if (isMissingFunctionError(error, 'anonymize_user_data') || tableNotReady(error, 'profiles')) {
    return { remote_applied: false as const, remote_error: 'RPC anonymize_user_data indisponible' };
  }

  return { remote_applied: false as const, remote_error: error.message };
}

export const governance = {
  entities: ENTITY_LIST,

  setContext(context: Partial<{ org_id: string; user_id: string }>) {
    if (context.org_id !== undefined) {
      contextOrgId = toOptional(context.org_id) ?? null;
    }

    if (context.user_id !== undefined) {
      contextUserId = toOptional(context.user_id) ?? null;
    }
  },

  setOrg(orgId: string | null) {
    contextOrgId = toOptional(orgId ?? undefined) ?? null;
  },

  setActor(userId: string | null) {
    contextUserId = toOptional(userId ?? undefined) ?? null;
  },

  async listPolicies(orgIdInput?: string): Promise<RetentionPolicy[]> {
    const orgId = requireOrgId(orgIdInput);

    try {
      const remote = await loadRemotePolicies(orgId);
      if (remote && remote.length > 0) {
        for (const policy of remote) {
          await upsertPolicyCache(policy);
        }
        return mergeWithDefaultPolicies(orgId, remote);
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[governance] remote policy load failed:', toErrorMessage(error));
      }
    }

    const local = await readPoliciesCache(orgId);
    if (local.length > 0) {
      return mergeWithDefaultPolicies(orgId, local);
    }

    const defaults = mergeWithDefaultPolicies(orgId, []);
    for (const policy of defaults) {
      await upsertPolicyCache(policy);
    }
    return defaults;
  },

  async setPolicy(entityInput: string, daysInput: number): Promise<RetentionPolicy> {
    const orgId = requireOrgId();
    const userId = requireUserId();
    const entity = ensureEntity(entityInput);
    const retentionDays = clampDays(daysInput);
    const now = nowIso();

    const localPolicy = toPolicy(orgId, entity, retentionDays, 'LOCAL', userId, now);
    await upsertPolicyCache(localPolicy);

    let saved = localPolicy;

    try {
      const remotePolicy = await saveRemotePolicy(orgId, entity, retentionDays, userId);
      if (remotePolicy) {
        saved = remotePolicy;
        await upsertPolicyCache(remotePolicy);
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[governance] save remote policy failed:', toErrorMessage(error));
      }
    }

    await audit.log('governance.set_policy', 'RETENTION_POLICY', `${orgId}:${entity}`, {
      retention_days: retentionDays
    });

    return saved;
  },

  async applyRetention(): Promise<RetentionApplyResult> {
    const orgId = requireOrgId();
    const policies = await this.listPolicies(orgId);
    const db = await getDb();

    const items: RetentionApplyItem[] = [];
    let totalDeletedRows = 0;
    let totalDeletedFiles = 0;

    for (const policy of policies) {
      const result = await applySinglePolicy(db, orgId, policy.entity, policy.retention_days);
      const item: RetentionApplyItem = {
        entity: policy.entity,
        retention_days: policy.retention_days,
        deleted_rows: result.deleted_rows,
        deleted_files: result.deleted_files
      };

      items.push(item);
      totalDeletedRows += item.deleted_rows;
      totalDeletedFiles += item.deleted_files;
    }

    const appliedAt = nowIso();
    await audit.log('governance.apply_retention', 'RETENTION_POLICY', orgId, {
      total_deleted_rows: totalDeletedRows,
      total_deleted_files: totalDeletedFiles,
      items
    });

    return {
      org_id: orgId,
      applied_at: appliedAt,
      items,
      total_deleted_rows: totalDeletedRows,
      total_deleted_files: totalDeletedFiles
    };
  },

  async exportPortableData(orgIdInput?: string): Promise<PortableDataExportResult> {
    const orgId = requireOrgId(orgIdInput);
    await ensureSetup();
    const db = await getDb();

    const tables = await db.getAllAsync<{ name: string }>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name ASC
      `
    );

    const payload: Record<string, unknown[]> = {};
    let tableCount = 0;
    let totalRows = 0;

    for (const table of tables ?? []) {
      const name = normalizeText(table.name);
      if (!name) {
        continue;
      }

      const rows = await listPortableRowsByTable(db, name, orgId);
      if (rows.length === 0) {
        continue;
      }

      payload[name] = rows;
      tableCount += 1;
      totalRows += rows.length;
    }

    const generatedAt = nowIso();
    const directory = portableDirectory();
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

    const suffix = generatedAt.replace(/[:.]/g, '-');
    const path = `${directory}portable_data_${orgId}_${suffix}.json`;

    const output = {
      app: 'conformeo',
      org_id: orgId,
      generated_at: generatedAt,
      tables: tableCount,
      rows: totalRows,
      data: payload
    };

    await FileSystem.writeAsStringAsync(path, JSON.stringify(output, null, 2), {
      encoding: FileSystem.EncodingType.UTF8
    });

    const info = await FileSystem.getInfoAsync(path);
    const sizeBytes = info.exists && typeof info.size === 'number' ? info.size : 0;

    await audit.log('governance.export_portable_data', 'PORTABLE_EXPORT', orgId, {
      tables: tableCount,
      rows: totalRows,
      size_bytes: sizeBytes
    });

    return {
      org_id: orgId,
      path,
      generated_at: generatedAt,
      tables: tableCount,
      rows: totalRows,
      size_bytes: sizeBytes
    };
  },

  async anonymizeDeletedUser(userIdInput: string): Promise<AnonymizeUserResult> {
    const orgId = requireOrgId();
    const userId = normalizeText(userIdInput);
    if (!userId) {
      throw new Error('user_id manquant.');
    }

    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, userId);
    const alias = `deleted_${hash.slice(0, 12)}`;
    const db = await getDb();

    const localUpdates = await anonymizeLocalTables(db, orgId, userId, alias);
    const remote = await anonymizeRemote(orgId, userId);

    const processedAt = nowIso();
    await audit.log('governance.anonymize_user', 'USER', userId, {
      alias,
      local_updates: localUpdates,
      remote_applied: remote.remote_applied,
      remote_error: remote.remote_error ?? null
    });

    return {
      org_id: orgId,
      user_id: userId,
      alias,
      local_updates: localUpdates,
      remote_applied: remote.remote_applied,
      remote_error: remote.remote_error,
      processed_at: processedAt
    };
  },

  async deleteOrganization(orgIdInput: string, confirmation: string) {
    const orgId = normalizeText(orgIdInput);
    if (!orgId) {
      throw new Error('org_id manquant.');
    }

    const expected = `DELETE ${orgId}`;
    if (normalizeText(confirmation) !== expected) {
      throw new Error(`Confirmation invalide. Saisis exactement: ${expected}`);
    }

    return admin.deleteOrg({
      org_id: orgId,
      confirmation: expected
    });
  }
};

