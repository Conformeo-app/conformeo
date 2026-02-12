import * as SQLite from 'expo-sqlite';
import { OfflineOperationType, offlineDB } from '../offline/outbox';

const DB_NAME = 'conformeo.db';
const CONFLICTS_TABLE = 'sync_conflicts';
const POLICIES_TABLE = 'sync_conflict_policies';

const DEFAULT_POLICY: ConflictPolicy = 'LWW';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type JsonRecord = Record<string, unknown>;

type ConflictRow = {
  id: string;
  org_id: string;
  entity: string;
  entity_id: string;
  operation_id: string;
  operation_type: OfflineOperationType;
  local_payload: string;
  server_payload: string;
  policy: ConflictPolicy;
  status: ConflictStatus;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution_action: ConflictResolutionAction | null;
  merged_payload: string | null;
  resolver_user_id: string | null;
};

type PolicyRow = {
  org_id: string;
  entity: string;
  policy: ConflictPolicy;
  updated_at: string;
  updated_by: string | null;
};

export type ConflictPolicy = 'LWW' | 'SERVER_WINS' | 'MANUAL';

export type ConflictStatus = 'OPEN' | 'RESOLVED';

export type ConflictResolutionAction = 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGE';

export type SyncConflict = {
  id: string;
  org_id: string;
  entity: string;
  entity_id: string;
  operation_id: string;
  operation_type: OfflineOperationType;
  local_payload: JsonRecord;
  server_payload: JsonRecord;
  policy: ConflictPolicy;
  status: ConflictStatus;
  reason?: string;
  created_at: string;
  resolved_at?: string;
  resolution_action?: ConflictResolutionAction;
  merged_payload?: JsonRecord;
  resolver_user_id?: string;
};

export type ConflictPolicyRecord = {
  org_id: string;
  entity: string;
  policy: ConflictPolicy;
  updated_at: string;
  updated_by?: string;
};

export type ConflictContext = {
  org_id: string;
  user_id: string;
};

export type ConflictRecordInput = {
  org_id: string;
  entity: string;
  entity_id: string;
  operation_id: string;
  operation_type: OfflineOperationType;
  local_payload: JsonRecord;
  server_payload: JsonRecord;
  policy?: ConflictPolicy;
  reason?: string;
};

export type ConflictResolveOptions = {
  requeue?: boolean;
};

export type ConflictApi = {
  setContext: (context: Partial<ConflictContext>) => void;
  setOrg: (orgId: string | null) => void;
  setActor: (userId: string | null) => void;

  listOpen: (options?: { org_id?: string; entity?: string; limit?: number }) => Promise<SyncConflict[]>;
  getById: (id: string) => Promise<SyncConflict | null>;
  resolve: (
    id: string,
    action: ConflictResolutionAction,
    mergedPayload?: JsonRecord,
    options?: ConflictResolveOptions
  ) => Promise<SyncConflict>;
  setPolicy: (entity: string, policy: ConflictPolicy) => Promise<ConflictPolicyRecord>;

  getPolicy: (entity: string, orgId?: string) => Promise<ConflictPolicy>;
  listPolicies: (orgId?: string) => Promise<ConflictPolicyRecord[]>;
  getOpenCount: (orgId?: string) => Promise<number>;
  record: (input: ConflictRecordInput) => Promise<SyncConflict>;
  autoResolve: (id: string, action: ConflictResolutionAction) => Promise<SyncConflict>;
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

function parseJsonObject(raw: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
    return { value: parsed };
  } catch {
    return {};
  }
}

function ensureObject(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} doit être un objet.`);
  }

  return value as JsonRecord;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function ensurePolicy(policy: string): ConflictPolicy {
  if (policy === 'LWW' || policy === 'SERVER_WINS' || policy === 'MANUAL') {
    return policy;
  }

  throw new Error(`Policy conflit invalide: ${policy}`);
}

function ensureResolutionAction(action: string): ConflictResolutionAction {
  if (action === 'KEEP_LOCAL' || action === 'KEEP_SERVER' || action === 'MERGE') {
    return action;
  }

  throw new Error(`Action de résolution invalide: ${action}`);
}

function ensureOrgId(orgId?: string) {
  const resolved = normalizeText(orgId) || normalizeText(contextOrgId);
  if (!resolved) {
    throw new Error('org_id requis.');
  }

  return resolved;
}

function mapConflictRow(row: ConflictRow): SyncConflict {
  return {
    id: row.id,
    org_id: row.org_id,
    entity: row.entity,
    entity_id: row.entity_id,
    operation_id: row.operation_id,
    operation_type: row.operation_type,
    local_payload: parseJsonObject(row.local_payload),
    server_payload: parseJsonObject(row.server_payload),
    policy: row.policy,
    status: row.status,
    reason: row.reason ?? undefined,
    created_at: row.created_at,
    resolved_at: row.resolved_at ?? undefined,
    resolution_action: row.resolution_action ?? undefined,
    merged_payload: row.merged_payload ? parseJsonObject(row.merged_payload) : undefined,
    resolver_user_id: row.resolver_user_id ?? undefined
  };
}

function mapPolicyRow(row: PolicyRow): ConflictPolicyRecord {
  return {
    org_id: row.org_id,
    entity: row.entity,
    policy: row.policy,
    updated_at: row.updated_at,
    updated_by: row.updated_by ?? undefined
  };
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

        CREATE TABLE IF NOT EXISTS ${CONFLICTS_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          operation_type TEXT NOT NULL CHECK (operation_type IN ('CREATE', 'UPDATE', 'DELETE')),
          local_payload TEXT NOT NULL,
          server_payload TEXT NOT NULL,
          policy TEXT NOT NULL CHECK (policy IN ('LWW', 'SERVER_WINS', 'MANUAL')),
          status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
          reason TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolution_action TEXT CHECK (resolution_action IN ('KEEP_LOCAL', 'KEEP_SERVER', 'MERGE')),
          merged_payload TEXT,
          resolver_user_id TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sync_conflicts_org_status_created
          ON ${CONFLICTS_TABLE}(org_id, status, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity
          ON ${CONFLICTS_TABLE}(org_id, entity, entity_id, created_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_conflicts_open_operation
          ON ${CONFLICTS_TABLE}(operation_id)
          WHERE status = 'OPEN';

        CREATE TABLE IF NOT EXISTS ${POLICIES_TABLE} (
          org_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          policy TEXT NOT NULL CHECK (policy IN ('LWW', 'SERVER_WINS', 'MANUAL')),
          updated_at TEXT NOT NULL,
          updated_by TEXT,
          PRIMARY KEY (org_id, entity)
        );

        CREATE INDEX IF NOT EXISTS idx_sync_conflict_policies_org
          ON ${POLICIES_TABLE}(org_id, updated_at DESC);
      `);
    })();
  }

  return setupPromise;
}

async function findConflictById(id: string, orgId?: string): Promise<SyncConflict | null> {
  await ensureSetup();
  const db = await getDb();

  const cleanId = normalizeText(id);
  if (!cleanId) {
    return null;
  }

  const where = ['id = ?'];
  const params: Array<string> = [cleanId];

  const cleanOrg = normalizeText(orgId) || normalizeText(contextOrgId);
  if (cleanOrg) {
    where.push('org_id = ?');
    params.push(cleanOrg);
  }

  const row = await db.getFirstAsync<ConflictRow>(
    `
      SELECT *
      FROM ${CONFLICTS_TABLE}
      WHERE ${where.join(' AND ')}
      LIMIT 1
    `,
    ...params
  );

  if (!row) {
    return null;
  }

  return mapConflictRow(row);
}

async function markResolved(
  id: string,
  action: ConflictResolutionAction,
  mergedPayload?: JsonRecord,
  resolverUserId?: string
): Promise<SyncConflict> {
  await ensureSetup();
  const db = await getDb();

  const resolvedAt = nowIso();

  await db.runAsync(
    `
      UPDATE ${CONFLICTS_TABLE}
      SET status = 'RESOLVED',
          resolved_at = ?,
          resolution_action = ?,
          merged_payload = ?,
          resolver_user_id = ?
      WHERE id = ?
    `,
    resolvedAt,
    action,
    mergedPayload ? JSON.stringify(mergedPayload) : null,
    normalizeText(resolverUserId) || null,
    id
  );

  const updated = await findConflictById(id);
  if (!updated) {
    throw new Error('Conflit introuvable après résolution.');
  }

  return updated;
}

export const conflicts: ConflictApi = {
  setContext(context: Partial<ConflictContext>) {
    contextOrgId = normalizeText(context.org_id) || null;
    contextUserId = normalizeText(context.user_id) || null;
  },

  setOrg(orgId: string | null) {
    contextOrgId = normalizeText(orgId) || null;
  },

  setActor(userId: string | null) {
    contextUserId = normalizeText(userId) || null;
  },

  async listOpen(options = {}) {
    await ensureSetup();
    const db = await getDb();

    const orgId = ensureOrgId(options.org_id);
    const limit = clamp(Math.floor(options.limit ?? DEFAULT_LIMIT), 1, MAX_LIMIT);

    const where = ['org_id = ?', "status = 'OPEN'"];
    const params: Array<string | number> = [orgId];

    const entity = normalizeText(options.entity);
    if (entity.length > 0) {
      where.push('entity = ?');
      params.push(entity);
    }

    const rows = await db.getAllAsync<ConflictRow>(
      `
        SELECT *
        FROM ${CONFLICTS_TABLE}
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ?
      `,
      ...params,
      limit
    );

    return rows.map(mapConflictRow);
  },

  async getById(id: string) {
    return findConflictById(id);
  },

  async resolve(id, action, mergedPayload, options = {}) {
    const safeAction = ensureResolutionAction(action);
    const conflict = await findConflictById(id);

    if (!conflict) {
      throw new Error('Conflit introuvable.');
    }

    if (conflict.status === 'RESOLVED') {
      return conflict;
    }

    const shouldRequeue = options.requeue !== false;

    let payloadToQueue: JsonRecord | null = null;
    if (safeAction === 'KEEP_LOCAL') {
      payloadToQueue = conflict.local_payload;
    } else if (safeAction === 'MERGE') {
      payloadToQueue = ensureObject(mergedPayload, 'mergedPayload');
    }

    if (shouldRequeue && payloadToQueue) {
      const normalizedPayload: JsonRecord = {
        ...payloadToQueue,
        id:
          typeof payloadToQueue.id === 'string' && payloadToQueue.id.trim().length > 0
            ? payloadToQueue.id
            : conflict.entity_id,
        orgId:
          typeof payloadToQueue.orgId === 'string' && payloadToQueue.orgId.trim().length > 0
            ? payloadToQueue.orgId
            : conflict.org_id,
        org_id:
          typeof payloadToQueue.org_id === 'string' && payloadToQueue.org_id.trim().length > 0
            ? payloadToQueue.org_id
            : conflict.org_id
      };

      await offlineDB.enqueueOperation({
        entity: conflict.entity,
        entity_id: conflict.entity_id,
        type: conflict.operation_type,
        payload: normalizedPayload,
        status: 'PENDING'
      });
    }

    return markResolved(
      conflict.id,
      safeAction,
      safeAction === 'MERGE' ? ensureObject(mergedPayload, 'mergedPayload') : undefined,
      contextUserId ?? undefined
    );
  },

  async setPolicy(entity: string, policy: ConflictPolicy) {
    await ensureSetup();
    const db = await getDb();

    const orgId = ensureOrgId();
    const safeEntity = normalizeText(entity);
    if (!safeEntity) {
      throw new Error('entity requise pour setPolicy.');
    }

    const safePolicy = ensurePolicy(policy);
    const updatedAt = nowIso();

    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${POLICIES_TABLE}
        (org_id, entity, policy, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?)
      `,
      orgId,
      safeEntity,
      safePolicy,
      updatedAt,
      normalizeText(contextUserId) || null
    );

    return {
      org_id: orgId,
      entity: safeEntity,
      policy: safePolicy,
      updated_at: updatedAt,
      updated_by: normalizeText(contextUserId) || undefined
    } satisfies ConflictPolicyRecord;
  },

  async getPolicy(entity: string, orgId?: string) {
    await ensureSetup();
    const db = await getDb();

    const safeOrgId = ensureOrgId(orgId);
    const safeEntity = normalizeText(entity);
    if (!safeEntity) {
      return DEFAULT_POLICY;
    }

    const row = await db.getFirstAsync<PolicyRow>(
      `
        SELECT org_id, entity, policy, updated_at, updated_by
        FROM ${POLICIES_TABLE}
        WHERE org_id = ?
          AND entity = ?
        LIMIT 1
      `,
      safeOrgId,
      safeEntity
    );

    return row?.policy ?? DEFAULT_POLICY;
  },

  async listPolicies(orgId?: string) {
    await ensureSetup();
    const db = await getDb();

    const safeOrgId = ensureOrgId(orgId);

    const rows = await db.getAllAsync<PolicyRow>(
      `
        SELECT org_id, entity, policy, updated_at, updated_by
        FROM ${POLICIES_TABLE}
        WHERE org_id = ?
        ORDER BY entity ASC
      `,
      safeOrgId
    );

    return rows.map(mapPolicyRow);
  },

  async getOpenCount(orgId?: string) {
    await ensureSetup();
    const db = await getDb();

    const safeOrgId = ensureOrgId(orgId);

    const row = await db.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM ${CONFLICTS_TABLE}
        WHERE org_id = ?
          AND status = 'OPEN'
      `,
      safeOrgId
    );

    return row?.count ?? 0;
  },

  async record(input) {
    await ensureSetup();
    const db = await getDb();

    const orgId = normalizeText(input.org_id);
    const entity = normalizeText(input.entity);
    const entityId = normalizeText(input.entity_id);
    const operationId = normalizeText(input.operation_id);

    if (!orgId || !entity || !entityId || !operationId) {
      throw new Error('record conflit invalide: org/entity/entity_id/operation_id requis.');
    }

    const openExistingRow = await db.getFirstAsync<ConflictRow>(
      `
        SELECT *
        FROM ${CONFLICTS_TABLE}
        WHERE operation_id = ?
          AND status = 'OPEN'
        LIMIT 1
      `,
      operationId
    );

    if (openExistingRow) {
      return mapConflictRow(openExistingRow);
    }

    const policy = input.policy ?? (await conflicts.getPolicy(entity, orgId));
    const safePolicy = ensurePolicy(policy);

    const next: SyncConflict = {
      id: createUuid(),
      org_id: orgId,
      entity,
      entity_id: entityId,
      operation_id: operationId,
      operation_type: input.operation_type,
      local_payload: ensureObject(input.local_payload, 'local_payload'),
      server_payload: ensureObject(input.server_payload, 'server_payload'),
      policy: safePolicy,
      status: 'OPEN',
      reason: normalizeText(input.reason) || undefined,
      created_at: nowIso()
    };

    await db.runAsync(
      `
        INSERT INTO ${CONFLICTS_TABLE}
        (
          id, org_id, entity, entity_id,
          operation_id, operation_type,
          local_payload, server_payload,
          policy, status,
          reason, created_at,
          resolved_at, resolution_action,
          merged_payload, resolver_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
      `,
      next.id,
      next.org_id,
      next.entity,
      next.entity_id,
      next.operation_id,
      next.operation_type,
      JSON.stringify(next.local_payload),
      JSON.stringify(next.server_payload),
      next.policy,
      next.status,
      next.reason ?? null,
      next.created_at
    );

    return next;
  },

  async autoResolve(id, action) {
    const safeAction = ensureResolutionAction(action);
    const conflict = await findConflictById(id);

    if (!conflict) {
      throw new Error('Conflit introuvable.');
    }

    if (conflict.status === 'RESOLVED') {
      return conflict;
    }

    return markResolved(conflict.id, safeAction, undefined, normalizeText(contextUserId) || undefined);
  }
};
