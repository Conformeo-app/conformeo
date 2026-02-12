import * as SQLite from 'expo-sqlite';
import { securityPolicies } from '../../core/security/policies';

const DB_NAME = 'conformeo.db';
const LOCAL_ENTITIES_TABLE = 'local_entities';
const OPERATIONS_TABLE = 'operations_queue';
const LEGACY_OUTBOX_TABLE = 'outbox_operations';
const DEAD_LETTER_TIMESTAMP = 32_503_680_000_000; // 3000-01-01T00:00:00.000Z

type JsonRecord = Record<string, unknown>;

type LocalEntityRow = {
  entity: string;
  id: string;
  data: string;
  deleted: number;
  created_at: string;
  updated_at: string;
};

type OperationRow = {
  id: string;
  entity: string;
  entity_id: string;
  type: OfflineOperationType;
  payload: string;
  status: OfflineOperationStatus;
  created_at: string;
  retry_count: number;
  next_attempt_at: number;
  last_error: string | null;
  synced_at: string | null;
};

type LegacyOperationRow = {
  operation_id: string;
  entity: string;
  action: OutboxAction;
  payload: string;
  created_at: number;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
};

export type OfflineOperationType = 'CREATE' | 'UPDATE' | 'DELETE';
export type OfflineOperationStatus = 'PENDING' | 'SYNCED' | 'FAILED';

export type OfflineOperation = {
  id: string;
  entity: string;
  entity_id: string;
  type: OfflineOperationType;
  payload: JsonRecord;
  status: OfflineOperationStatus;
  created_at: string;
  retry_count: number;
  next_attempt_at: number;
  last_error: string | null;
  synced_at: string | null;
};

export type OutboxAction = 'insert' | 'update' | 'delete';

export type OutboxOperation = {
  operationId: string;
  entity: string;
  action: OutboxAction;
  payload: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
};

type EnqueueOperationInput = {
  id?: string;
  entity: string;
  entity_id: string;
  type: OfflineOperationType;
  payload: JsonRecord;
  status?: OfflineOperationStatus;
  created_at?: string;
  retry_count?: number;
  next_attempt_at?: number;
  last_error?: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getNowIso() {
  return new Date().toISOString();
}

function randomToken(prefix: string) {
  const randomUUID = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `${prefix}_${randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJsonRecord(raw: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

function assertNonEmpty(value: string, label: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
}

function assertObject(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function actionToType(action: OutboxAction): OfflineOperationType {
  if (action === 'insert') return 'CREATE';
  if (action === 'update') return 'UPDATE';
  return 'DELETE';
}

function typeToAction(type: OfflineOperationType): OutboxAction {
  if (type === 'CREATE') return 'insert';
  if (type === 'UPDATE') return 'update';
  return 'delete';
}

function normalizePayloadEntityId(payload: JsonRecord, fallbackId: string) {
  const candidate =
    typeof payload.id === 'string'
      ? payload.id
      : typeof payload.entity_id === 'string'
        ? payload.entity_id
        : typeof payload.entityId === 'string'
          ? payload.entityId
          : typeof payload.externalId === 'string'
            ? payload.externalId
            : fallbackId;

  return candidate.trim().length > 0 ? candidate : fallbackId;
}

function mapOperationRow(row: OperationRow): OfflineOperation {
  return {
    id: row.id,
    entity: row.entity,
    entity_id: row.entity_id,
    type: row.type,
    payload: parseJsonRecord(row.payload),
    status: row.status,
    created_at: row.created_at,
    retry_count: row.retry_count,
    next_attempt_at: row.next_attempt_at,
    last_error: row.last_error,
    synced_at: row.synced_at
  };
}

function mapToLegacyOperation(operation: OfflineOperation): OutboxOperation {
  return {
    operationId: operation.id,
    entity: operation.entity,
    action: typeToAction(operation.type),
    payload: JSON.stringify(operation.payload),
    createdAt: Date.parse(operation.created_at),
    attempts: operation.retry_count,
    nextAttemptAt: operation.next_attempt_at,
    lastError: operation.last_error
  };
}

function matchesFilters(item: JsonRecord, filters: Record<string, unknown>) {
  const entries = Object.entries(filters);
  if (entries.length === 0) {
    return true;
  }

  for (const [key, expected] of entries) {
    const value = item[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(value)) {
        return false;
      }
      continue;
    }

    if (value !== expected) {
      return false;
    }
  }

  return true;
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

async function migrateLegacyOutboxIfNeeded(db: SQLite.SQLiteDatabase) {
  const hasLegacyTable = await tableExists(db, LEGACY_OUTBOX_TABLE);
  if (!hasLegacyTable) {
    return;
  }

  const queueState = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${OPERATIONS_TABLE}`
  );

  if ((queueState?.count ?? 0) > 0) {
    return;
  }

  const legacyRows = await db.getAllAsync<LegacyOperationRow>(
    `
      SELECT operation_id, entity, action, payload, created_at, attempts, next_attempt_at, last_error
      FROM ${LEGACY_OUTBOX_TABLE}
      ORDER BY created_at ASC
    `
  );

  for (const row of legacyRows) {
    const payload = parseJsonRecord(row.payload);
    const status: OfflineOperationStatus =
      row.attempts >= securityPolicies.maxSyncAttempts ? 'FAILED' : 'PENDING';
    const createdAt = new Date(row.created_at).toISOString();

    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${OPERATIONS_TABLE}
        (id, entity, entity_id, type, payload, status, created_at, retry_count, next_attempt_at, last_error, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      row.operation_id,
      row.entity,
      normalizePayloadEntityId(payload, row.operation_id),
      actionToType(row.action),
      JSON.stringify(payload),
      status,
      createdAt,
      row.attempts,
      row.next_attempt_at,
      row.last_error
    );
  }
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);

      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS ${LOCAL_ENTITIES_TABLE} (
          entity TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (entity, id)
        );

        CREATE INDEX IF NOT EXISTS idx_local_entities_entity_updated
          ON ${LOCAL_ENTITIES_TABLE}(entity, updated_at DESC);

        CREATE TABLE IF NOT EXISTS ${OPERATIONS_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('CREATE', 'UPDATE', 'DELETE')),
          payload TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('PENDING', 'SYNCED', 'FAILED')),
          created_at TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          last_error TEXT,
          synced_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_operations_status_created
          ON ${OPERATIONS_TABLE}(status, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_operations_next_attempt
          ON ${OPERATIONS_TABLE}(next_attempt_at ASC);
      `);

      await migrateLegacyOutboxIfNeeded(db);

      return db;
    })();
  }

  return dbPromise;
}

async function getLocalEntityRow(entity: string, id: string, includeDeleted = false) {
  const db = await getDb();
  const row = await db.getFirstAsync<LocalEntityRow>(
    `
      SELECT entity, id, data, deleted, created_at, updated_at
      FROM ${LOCAL_ENTITIES_TABLE}
      WHERE entity = ?
        AND id = ?
        AND (? = 1 OR deleted = 0)
      LIMIT 1
    `,
    entity,
    id,
    includeDeleted ? 1 : 0
  );

  return row ?? null;
}

async function upsertLocalEntity(input: {
  entity: string;
  id: string;
  data: JsonRecord;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}) {
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${LOCAL_ENTITIES_TABLE}
      (entity, id, data, deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    input.entity,
    input.id,
    JSON.stringify(input.data),
    input.deleted ? 1 : 0,
    input.createdAt,
    input.updatedAt
  );
}

export const offlineDB = {
  createOperationId(prefix = 'op') {
    return randomToken(prefix);
  },

  async create<T extends JsonRecord>(entity: string, data: T): Promise<T & { id: string }> {
    assertNonEmpty(entity, 'entity');
    assertObject(data, 'data');

    const existingId = typeof data.id === 'string' ? data.id.trim() : '';
    const id = existingId.length > 0 ? existingId : randomToken('local');

    const existing = await getLocalEntityRow(entity, id, true);
    const nowIso = getNowIso();
    const createdAt = existing?.created_at ?? nowIso;
    const payload = { ...data, id } as T & { id: string };

    await upsertLocalEntity({
      entity,
      id,
      data: payload,
      deleted: false,
      createdAt,
      updatedAt: nowIso
    });

    await offlineDB.enqueueOperation({
      entity,
      entity_id: id,
      type: 'CREATE',
      payload
    });

    return payload;
  },

  async update<T extends JsonRecord>(
    entity: string,
    id: string,
    patch: Partial<T>
  ): Promise<T & { id: string }> {
    assertNonEmpty(entity, 'entity');
    assertNonEmpty(id, 'id');
    assertObject(patch, 'patch');

    const existingRow = await getLocalEntityRow(entity, id, true);
    if (!existingRow) {
      throw new Error(`Local entity not found: ${entity}/${id}`);
    }

    const existingData = parseJsonRecord(existingRow.data) as T;
    const nextData = { ...existingData, ...patch, id } as T & { id: string };
    const nowIso = getNowIso();

    await upsertLocalEntity({
      entity,
      id,
      data: nextData,
      deleted: false,
      createdAt: existingRow.created_at,
      updatedAt: nowIso
    });

    await offlineDB.enqueueOperation({
      entity,
      entity_id: id,
      type: 'UPDATE',
      payload: { id, patch, data: nextData }
    });

    return nextData;
  },

  async delete(entity: string, id: string) {
    assertNonEmpty(entity, 'entity');
    assertNonEmpty(id, 'id');

    const existingRow = await getLocalEntityRow(entity, id, true);
    const existingData = existingRow ? parseJsonRecord(existingRow.data) : ({ id } as JsonRecord);
    const nowIso = getNowIso();

    await upsertLocalEntity({
      entity,
      id,
      data: { ...existingData, id },
      deleted: true,
      createdAt: existingRow?.created_at ?? nowIso,
      updatedAt: nowIso
    });

    await offlineDB.enqueueOperation({
      entity,
      entity_id: id,
      type: 'DELETE',
      payload: { id }
    });
  },

  async query<T extends JsonRecord>(
    entity: string,
    filters: Record<string, unknown> = {}
  ): Promise<Array<T & { id: string }>> {
    assertNonEmpty(entity, 'entity');

    const db = await getDb();
    const rows = await db.getAllAsync<LocalEntityRow>(
      `
        SELECT entity, id, data, deleted, created_at, updated_at
        FROM ${LOCAL_ENTITIES_TABLE}
        WHERE entity = ?
          AND deleted = 0
        ORDER BY updated_at DESC
      `,
      entity
    );

    const mapped = rows.map((row) => {
      const parsed = parseJsonRecord(row.data) as T;
      return { ...parsed, id: row.id } as T & { id: string };
    });

    return mapped.filter((item) => matchesFilters(item as JsonRecord, filters));
  },

  async getById<T extends JsonRecord>(entity: string, id: string): Promise<(T & { id: string }) | null> {
    assertNonEmpty(entity, 'entity');
    assertNonEmpty(id, 'id');

    const row = await getLocalEntityRow(entity, id, false);
    if (!row) {
      return null;
    }

    const parsed = parseJsonRecord(row.data) as T;
    return { ...parsed, id: row.id } as T & { id: string };
  },

  async enqueueOperation(input: EnqueueOperationInput) {
    assertNonEmpty(input.entity, 'entity');
    assertNonEmpty(input.entity_id, 'entity_id');

    const operationId = input.id ?? randomToken('op');
    const createdAt = input.created_at ?? getNowIso();
    const nextAttemptAt = input.next_attempt_at ?? Date.now();
    const status = input.status ?? 'PENDING';

    const db = await getDb();
    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${OPERATIONS_TABLE}
        (id, entity, entity_id, type, payload, status, created_at, retry_count, next_attempt_at, last_error, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      operationId,
      input.entity,
      input.entity_id,
      input.type,
      JSON.stringify(input.payload),
      status,
      createdAt,
      input.retry_count ?? 0,
      nextAttemptAt,
      input.last_error ?? null
    );

    return operationId;
  },

  async getPendingOperations(limit = 100, now = Date.now()) {
    const db = await getDb();
    const rows = await db.getAllAsync<OperationRow>(
      `
        SELECT id, entity, entity_id, type, payload, status, created_at, retry_count, next_attempt_at, last_error, synced_at
        FROM ${OPERATIONS_TABLE}
        WHERE status != 'SYNCED'
          AND retry_count < ?
          AND next_attempt_at <= ?
        ORDER BY created_at ASC
        LIMIT ?
      `,
      securityPolicies.maxSyncAttempts,
      now,
      Math.max(1, limit)
    );

    return rows.map(mapOperationRow);
  },

  async flushOutbox(limit = 100, now = Date.now()) {
    return offlineDB.getPendingOperations(limit, now);
  },

  async getFailedOperations(limit = 50, minRetryCount = 1) {
    const db = await getDb();
    const rows = await db.getAllAsync<OperationRow>(
      `
        SELECT id, entity, entity_id, type, payload, status, created_at, retry_count, next_attempt_at, last_error, synced_at
        FROM ${OPERATIONS_TABLE}
        WHERE status = 'FAILED'
          AND retry_count >= ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      minRetryCount,
      Math.max(1, limit)
    );

    return rows.map(mapOperationRow);
  },

  async markAsSynced(operationId: string) {
    const db = await getDb();
    await db.runAsync(
      `
        UPDATE ${OPERATIONS_TABLE}
        SET status = 'SYNCED',
            synced_at = ?,
            last_error = NULL
        WHERE id = ?
      `,
      getNowIso(),
      operationId
    );
  },

  async markAsFailed(operationId: string, lastError: string, nextAttemptAt = Date.now()) {
    const db = await getDb();
    await db.runAsync(
      `
        UPDATE ${OPERATIONS_TABLE}
        SET status = 'FAILED',
            retry_count = retry_count + 1,
            next_attempt_at = ?,
            last_error = ?,
            synced_at = NULL
        WHERE id = ?
      `,
      nextAttemptAt,
      lastError,
      operationId
    );
  },

  async markAsDead(operationId: string, lastError: string) {
    const db = await getDb();
    await db.runAsync(
      `
        UPDATE ${OPERATIONS_TABLE}
        SET status = 'FAILED',
            retry_count = ?,
            next_attempt_at = ?,
            last_error = ?,
            synced_at = NULL
        WHERE id = ?
      `,
      securityPolicies.maxSyncAttempts,
      DEAD_LETTER_TIMESTAMP,
      lastError,
      operationId
    );
  },

  async retryDeadOperation(operationId: string, now = Date.now()) {
    const db = await getDb();
    await db.runAsync(
      `
        UPDATE ${OPERATIONS_TABLE}
        SET status = 'PENDING',
            retry_count = 0,
            next_attempt_at = ?,
            last_error = NULL
        WHERE id = ?
      `,
      now,
      operationId
    );
  },

  async retryAllDeadOperations(now = Date.now()) {
    const db = await getDb();
    const result = await db.runAsync(
      `
        UPDATE ${OPERATIONS_TABLE}
        SET status = 'PENDING',
            retry_count = 0,
            next_attempt_at = ?,
            last_error = NULL
        WHERE status = 'FAILED'
          AND retry_count >= ?
      `,
      now,
      securityPolicies.maxSyncAttempts
    );

    return result.changes;
  },

  async getUnsyncedCount() {
    const db = await getDb();
    const row = await db.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM ${OPERATIONS_TABLE}
        WHERE status != 'SYNCED'
          AND retry_count < ?
      `,
      securityPolicies.maxSyncAttempts
    );

    return row?.count ?? 0;
  },

  async getDeadCount(minRetryCount = securityPolicies.maxSyncAttempts) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM ${OPERATIONS_TABLE}
        WHERE status = 'FAILED'
          AND retry_count >= ?
      `,
      minRetryCount
    );

    return row?.count ?? 0;
  }
};

export function createOperationId(prefix = 'op') {
  return offlineDB.createOperationId(prefix);
}

export async function enqueueOperation(input: {
  operationId?: string;
  entity: string;
  action: OutboxAction;
  payload: unknown;
  nextAttemptAt?: number;
}) {
  assertObject(input.payload, 'payload');
  const payload = input.payload as JsonRecord;
  const operationId = input.operationId ?? createOperationId();

  await offlineDB.enqueueOperation({
    id: operationId,
    entity: input.entity,
    entity_id: normalizePayloadEntityId(payload, operationId),
    type: actionToType(input.action),
    payload,
    status: 'PENDING',
    retry_count: 0,
    next_attempt_at: input.nextAttemptAt
  });

  return operationId;
}

export async function listReadyOperations(limit = 25, now = Date.now()) {
  const operations = await offlineDB.getPendingOperations(limit, now);
  return operations.map(mapToLegacyOperation);
}

export async function listDeadOperations(limit = 50) {
  const operations = await offlineDB.getFailedOperations(limit, securityPolicies.maxSyncAttempts);
  return operations.map(mapToLegacyOperation);
}

export async function markOperationSuccess(operationId: string) {
  await offlineDB.markAsSynced(operationId);
}

export async function markOperationRetry(
  operationId: string,
  nextAttemptAt: number,
  lastError: string
) {
  await offlineDB.markAsFailed(operationId, lastError, nextAttemptAt);
}

export async function markOperationDead(operationId: string, lastError: string) {
  await offlineDB.markAsDead(operationId, lastError);
}

export async function getOutboxQueueDepth() {
  return offlineDB.getUnsyncedCount();
}

export async function getDeadLetterCount() {
  return offlineDB.getDeadCount();
}

export async function retryDeadOperation(operationId: string, now = Date.now()) {
  await offlineDB.retryDeadOperation(operationId, now);
}

export async function retryAllDeadOperations(now = Date.now()) {
  return offlineDB.retryAllDeadOperations(now);
}
