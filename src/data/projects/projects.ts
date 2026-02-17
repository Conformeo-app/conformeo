import * as SQLite from 'expo-sqlite';
import { assertProjectWritable } from '../control-mode/readOnly';
import { dashboard } from '../dashboard';
import { offlineDB } from '../offline/outbox';
import { conflicts } from '../sync/conflicts';
import type {
  Project,
  ProjectCreateInput,
  ProjectIndicators,
  ProjectListFilters,
  ProjectStatusManual,
  ProjectSyncState,
  ProjectRiskLevel,
  ProjectUpdatePatch,
} from './types';

const DB_NAME = 'conformeo.db';
const PROJECTS_TABLE = 'projects';
const TASKS_TABLE = 'tasks';
const DOCUMENTS_TABLE = 'documents';
const MEDIA_TABLE = 'media_assets';
const EXPORTS_TABLE = 'export_jobs';
const OPERATIONS_TABLE = 'operations_queue';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

const SAFETY_KEYWORDS = ['safety', 'securite', 'permis_feu', 'permis feu', 'epi', 'harnais', 'risque'];

type ProjectRow = {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  start_date: string | null;
  end_date: string | null;
  status_manual: ProjectStatusManual;
  team_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | undefined | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
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

async function ensureOpsIndex(db: SQLite.SQLiteDatabase) {
  if (!(await tableExists(db, OPERATIONS_TABLE))) {
    return;
  }

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_operations_entity_entityid_status
      ON ${OPERATIONS_TABLE}(entity, entity_id, status);
  `);
}

async function setupSchema() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      geo_lat REAL,
      geo_lng REAL,
      start_date TEXT,
      end_date TEXT,
      status_manual TEXT NOT NULL CHECK (status_manual IN ('ACTIVE', 'ARCHIVED')),
      team_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_org_status_updated
      ON ${PROJECTS_TABLE}(org_id, status_manual, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_projects_org_updated
      ON ${PROJECTS_TABLE}(org_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_projects_org_name
      ON ${PROJECTS_TABLE}(org_id, name);
  `);

  await ensureOpsIndex(db);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }
  return setupPromise;
}

function mapRow(row: ProjectRow): Project {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    address: optionalText(row.address),
    geo_lat: row.geo_lat ?? undefined,
    geo_lng: row.geo_lng ?? undefined,
    start_date: optionalText(row.start_date),
    end_date: optionalText(row.end_date),
    status_manual: row.status_manual,
    team_id: optionalText(row.team_id),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function ensureStatusManual(value: string | undefined | null): ProjectStatusManual {
  if (value === 'ARCHIVED') return 'ARCHIVED';
  return 'ACTIVE';
}

function ensureName(value: string) {
  const cleaned = normalizeText(value);
  if (cleaned.length < 2) {
    throw new Error('Le nom du chantier doit contenir au moins 2 caractères.');
  }
  return cleaned;
}

async function getRowById(id: string) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<ProjectRow>(
    `
      SELECT *
      FROM ${PROJECTS_TABLE}
      WHERE id = ?
      LIMIT 1
    `,
    id
  );

  return row ?? null;
}

async function saveProject(project: Project) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${PROJECTS_TABLE}
      (
        id, org_id, name, address,
        geo_lat, geo_lng,
        start_date, end_date,
        status_manual, team_id,
        created_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    project.id,
    project.org_id,
    project.name,
    project.address ?? null,
    project.geo_lat ?? null,
    project.geo_lng ?? null,
    project.start_date ?? null,
    project.end_date ?? null,
    project.status_manual,
    project.team_id ?? null,
    project.created_by,
    project.created_at,
    project.updated_at
  );

  return project;
}

async function enqueueProjectOperation(
  project: Project,
  type: 'CREATE' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>
) {
  await offlineDB.enqueueOperation({
    entity: 'projects',
    entity_id: project.id,
    type,
    payload: {
      ...payload,
      id: project.id,
      org_id: project.org_id,
      orgId: project.org_id,
      project_id: project.id,
      updated_at: project.updated_at
    }
  });
}

function normalizeCreateInput(input: ProjectCreateInput): Project {
  const orgId = normalizeText(input.org_id);
  const createdBy = normalizeText(input.created_by);

  if (!orgId) {
    throw new Error('org_id est requis.');
  }

  if (!createdBy) {
    throw new Error('created_by est requis.');
  }

  const now = nowIso();

  return {
    id: normalizeText(input.id) || createUuid(),
    org_id: orgId,
    name: ensureName(input.name),
    address: optionalText(input.address),
    geo_lat: Number.isFinite(input.geo_lat) ? input.geo_lat : undefined,
    geo_lng: Number.isFinite(input.geo_lng) ? input.geo_lng : undefined,
    start_date: optionalText(input.start_date),
    end_date: optionalText(input.end_date),
    status_manual: input.status_manual ?? 'ACTIVE',
    team_id: optionalText(input.team_id),
    created_by: createdBy,
    created_at: now,
    updated_at: now
  };
}

function mergePatch(project: Project, patch: ProjectUpdatePatch): Project {
  const name = patch.name !== undefined ? ensureName(patch.name) : project.name;
  const status = patch.status_manual !== undefined ? ensureStatusManual(patch.status_manual) : project.status_manual;

  return {
    ...project,
    name,
    address: patch.address !== undefined ? optionalText(patch.address) : project.address,
    geo_lat: patch.geo_lat !== undefined ? (patch.geo_lat ?? undefined) : project.geo_lat,
    geo_lng: patch.geo_lng !== undefined ? (patch.geo_lng ?? undefined) : project.geo_lng,
    start_date: patch.start_date !== undefined ? optionalText(patch.start_date) : project.start_date,
    end_date: patch.end_date !== undefined ? optionalText(patch.end_date) : project.end_date,
    status_manual: status,
    team_id: patch.team_id !== undefined ? optionalText(patch.team_id) : project.team_id,
    updated_at: nowIso()
  };
}

function extractProjectIdFromPayload(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) {
    return null;
  }

  const direct = payload.project_id ?? payload.projectId;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  const data = payload.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return extractProjectIdFromPayload(data as Record<string, unknown>);
  }

  const patch = payload.patch;
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    return extractProjectIdFromPayload(patch as Record<string, unknown>);
  }

  return null;
}

function computeRiskLevel(input: {
  blockedTasks: number;
  openTasks: number;
  safetyOpenTasks: number;
  openConflicts: number;
}): ProjectRiskLevel {
  if (input.blockedTasks > 0) return 'RISK';
  if (input.openTasks > 10) return 'WATCH';
  if (input.safetyOpenTasks > 0) return 'WATCH';
  if (input.openConflicts > 0) return 'WATCH';
  return 'OK';
}

function computeSyncState(input: {
  pendingOps: number;
  failedOps: number;
  pendingUploads: number;
  failedUploads: number;
}): ProjectSyncState {
  if (input.failedOps > 0 || input.failedUploads > 0) return 'ERROR';
  if (input.pendingOps > 0 || input.pendingUploads > 0) return 'PENDING';
  return 'SYNCED';
}

function clampLimit(value: number | undefined | null) {
  if (!value) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(value, MAX_PAGE_SIZE));
}

function normalizeProjectIds(input: string[]) {
  const set = new Set<string>();
  for (const value of input) {
    const cleaned = normalizeText(value);
    if (cleaned.length > 0) {
      set.add(cleaned);
    }
  }
  return Array.from(set);
}

async function getIndicatorsForProjects(orgId: string, projectIds: string[]): Promise<Record<string, ProjectIndicators>> {
  await ensureSetup();
  const db = await getDb();
  await ensureOpsIndex(db);

  const ids = normalizeProjectIds(projectIds);
  if (ids.length === 0) {
    return {};
  }

  const base = new Map<string, ProjectIndicators>();
  for (const id of ids) {
    base.set(id, {
      project_id: id,
      riskLevel: 'OK',
      syncState: 'SYNCED',
      openTasks: 0,
      blockedTasks: 0,
      safetyOpenTasks: 0,
      pendingOps: 0,
      failedOps: 0,
      pendingUploads: 0,
      failedUploads: 0,
      openConflicts: 0
    });
  }

  const placeholders = ids.map(() => '?').join(',');
  const idParams = ids;

  if (await tableExists(db, TASKS_TABLE)) {
    const rows = await db.getAllAsync<{
      project_id: string;
      open_tasks: number;
      blocked_tasks: number;
    }>(
      `
        SELECT project_id,
               SUM(CASE WHEN status IN ('TODO', 'DOING') AND deleted_at IS NULL THEN 1 ELSE 0 END) AS open_tasks,
               SUM(CASE WHEN status = 'BLOCKED' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS blocked_tasks
        FROM ${TASKS_TABLE}
        WHERE org_id = ?
          AND project_id IN (${placeholders})
        GROUP BY project_id
      `,
      orgId,
      ...idParams
    );

    for (const row of rows) {
      const record = base.get(row.project_id);
      if (!record) continue;
      record.openTasks = Number(row.open_tasks ?? 0) || 0;
      record.blockedTasks = Number(row.blocked_tasks ?? 0) || 0;
    }

    const likeFragments: string[] = [];
    const likeParams: string[] = [];

    for (const keyword of SAFETY_KEYWORDS) {
      const pattern = `%${keyword}%`;
      likeFragments.push(`LOWER(COALESCE(title, '')) LIKE ?`);
      likeFragments.push(`LOWER(COALESCE(description, '')) LIKE ?`);
      likeFragments.push(`LOWER(COALESCE(tags_json, '')) LIKE ?`);
      likeParams.push(pattern, pattern, pattern);
    }

    const safetyRows = await db.getAllAsync<{ project_id: string; count: number }>(
      `
        SELECT project_id, COUNT(*) AS count
        FROM ${TASKS_TABLE}
        WHERE org_id = ?
          AND deleted_at IS NULL
          AND status != 'DONE'
          AND project_id IN (${placeholders})
          AND (${likeFragments.join(' OR ')})
        GROUP BY project_id
      `,
      orgId,
      ...idParams,
      ...likeParams
    );

    for (const row of safetyRows) {
      const record = base.get(row.project_id);
      if (!record) continue;
      record.safetyOpenTasks = Number(row.count ?? 0) || 0;
    }
  }

  try {
    const open = await conflicts.listOpen({ org_id: orgId, limit: 500 });

    for (const item of open) {
      const fromLocal = extractProjectIdFromPayload(item.local_payload);
      const fromServer = extractProjectIdFromPayload(item.server_payload);
      const projectId = fromLocal ?? fromServer;
      if (!projectId) continue;
      const record = base.get(projectId);
      if (!record) continue;
      record.openConflicts += 1;
    }
  } catch {
    // Conflicts table is optional in early setups.
  }

  if (await tableExists(db, OPERATIONS_TABLE)) {
    const statusValues = ['PENDING', 'FAILED'] as const;

    const addOps = (projectId: string | null, status: string, count: number) => {
      if (!projectId) return;
      const record = base.get(projectId);
      if (!record) return;

      const safeCount = Number(count ?? 0) || 0;
      if (status === 'FAILED') {
        record.failedOps += safeCount;
      } else if (status === 'PENDING') {
        record.pendingOps += safeCount;
      }
    };

    if (await tableExists(db, TASKS_TABLE)) {
      const rows = await db.getAllAsync<{ project_id: string; status: string; count: number }>(
        `
          SELECT t.project_id AS project_id, oq.status AS status, COUNT(*) AS count
          FROM ${OPERATIONS_TABLE} oq
          JOIN ${TASKS_TABLE} t
            ON oq.entity = 'tasks'
           AND oq.entity_id = t.id
          WHERE oq.status IN (${statusValues.map(() => '?').join(',')})
            AND t.org_id = ?
            AND t.project_id IN (${placeholders})
          GROUP BY t.project_id, oq.status
        `,
        ...statusValues,
        orgId,
        ...idParams
      );

      for (const row of rows) {
        addOps(row.project_id, row.status, row.count);
      }
    }

    if (await tableExists(db, DOCUMENTS_TABLE)) {
      const rows = await db.getAllAsync<{ project_id: string; status: string; count: number }>(
        `
          SELECT d.project_id AS project_id, oq.status AS status, COUNT(*) AS count
          FROM ${OPERATIONS_TABLE} oq
          JOIN ${DOCUMENTS_TABLE} d
            ON oq.entity = 'documents'
           AND oq.entity_id = d.id
          WHERE oq.status IN (${statusValues.map(() => '?').join(',')})
            AND d.org_id = ?
            AND d.project_id IN (${placeholders})
          GROUP BY d.project_id, oq.status
        `,
        ...statusValues,
        orgId,
        ...idParams
      );

      for (const row of rows) {
        addOps(row.project_id, row.status, row.count);
      }
    }

    if (await tableExists(db, EXPORTS_TABLE)) {
      const rows = await db.getAllAsync<{ project_id: string; status: string; count: number }>(
        `
          SELECT e.project_id AS project_id, oq.status AS status, COUNT(*) AS count
          FROM ${OPERATIONS_TABLE} oq
          JOIN ${EXPORTS_TABLE} e
            ON oq.entity = 'export_jobs'
           AND oq.entity_id = e.id
          WHERE oq.status IN (${statusValues.map(() => '?').join(',')})
            AND e.org_id = ?
            AND e.project_id IN (${placeholders})
          GROUP BY e.project_id, oq.status
        `,
        ...statusValues,
        orgId,
        ...idParams
      );

      for (const row of rows) {
        addOps(row.project_id, row.status, row.count);
      }
    }

    const rows = await db.getAllAsync<{ project_id: string; status: string; count: number }>(
      `
        SELECT p.id AS project_id, oq.status AS status, COUNT(*) AS count
        FROM ${OPERATIONS_TABLE} oq
        JOIN ${PROJECTS_TABLE} p
          ON oq.entity = 'projects'
         AND oq.entity_id = p.id
        WHERE oq.status IN (${statusValues.map(() => '?').join(',')})
          AND p.org_id = ?
          AND p.id IN (${placeholders})
        GROUP BY p.id, oq.status
      `,
      ...statusValues,
      orgId,
      ...idParams
    );

    for (const row of rows) {
      addOps(row.project_id, row.status, row.count);
    }
  }

  if (await tableExists(db, MEDIA_TABLE)) {
    const rows = await db.getAllAsync<{ project_id: string | null; upload_status: string; count: number }>(
      `
        SELECT project_id, upload_status, COUNT(*) AS count
        FROM ${MEDIA_TABLE}
        WHERE org_id = ?
          AND project_id IN (${placeholders})
          AND upload_status != 'UPLOADED'
        GROUP BY project_id, upload_status
      `,
      orgId,
      ...idParams
    );

    for (const row of rows) {
      if (!row.project_id) continue;
      const record = base.get(row.project_id);
      if (!record) continue;
      const safeCount = Number(row.count ?? 0) || 0;
      if (row.upload_status === 'FAILED') {
        record.failedUploads += safeCount;
      } else {
        record.pendingUploads += safeCount;
      }
    }
  }

  for (const record of base.values()) {
    record.riskLevel = computeRiskLevel(record);
    record.syncState = computeSyncState(record);
  }

  return Object.fromEntries(Array.from(base.entries()));
}

export const projects = {
  setContext(context: { org_id?: string }) {
    contextOrgId = normalizeText(context.org_id) || null;
  },

  setOrg(orgId: string | null) {
    contextOrgId = normalizeText(orgId) || null;
  },

  async bootstrapFromDerivedProjects(input: { org_id: string; created_by: string }) {
    const orgId = normalizeText(input.org_id);
    const createdBy = normalizeText(input.created_by);

    if (!orgId || !createdBy) {
      return 0;
    }

    await ensureSetup();
    const db = await getDb();

    dashboard.setContext({ org_id: orgId, user_id: createdBy });
    const derived = await dashboard.listProjects({ orgId });

    let created = 0;

    for (const projectId of derived) {
      const existing = await getRowById(projectId);
      if (existing) continue;

      const now = nowIso();
      const project: Project = {
        id: projectId,
        org_id: orgId,
        name: projectId,
        status_manual: 'ACTIVE',
        created_by: createdBy,
        created_at: now,
        updated_at: now
      };

      await saveProject(project);
      await enqueueProjectOperation(project, 'CREATE', { data: project, bootstrap: true });
      created += 1;
    }

    // ensure recent queries see new rows
    void db;

    return created;
  },

  async create(data: ProjectCreateInput): Promise<Project> {
    const project = normalizeCreateInput(data);
    await saveProject(project);

    await enqueueProjectOperation(project, 'CREATE', { data: project });

    return project;
  },

  async update(id: string, patch: ProjectUpdatePatch): Promise<Project> {
    const existingRow = await getRowById(id);
    if (!existingRow) {
      throw new Error('Chantier introuvable.');
    }

    const current = mapRow(existingRow);
    await assertProjectWritable(current.org_id, current.id);
    const next = mergePatch(current, patch);
    await saveProject(next);

    await enqueueProjectOperation(next, 'UPDATE', { patch, data: next });

    return next;
  },

  async archive(id: string): Promise<Project> {
    return this.update(id, { status_manual: 'ARCHIVED' });
  },

  async getById(id: string): Promise<Project | null> {
    const row = await getRowById(id);
    return row ? mapRow(row) : null;
  },

  async list(filters: ProjectListFilters): Promise<Project[]> {
    await ensureSetup();
    const db = await getDb();

    const orgId = normalizeText(filters.org_id);
    if (!orgId) {
      throw new Error('org_id est requis.');
    }

    const limit = clampLimit(filters.limit);
    const offset = Math.max(0, filters.offset ?? 0);

    const where: string[] = ['org_id = ?'];
    const params: Array<string | number> = [orgId];

    if (!filters.include_archived) {
      where.push(`status_manual = 'ACTIVE'`);
    }

    const q = normalizeText(filters.query).toLowerCase();
    if (q) {
      where.push(`(LOWER(name) LIKE ? OR LOWER(COALESCE(address, '')) LIKE ?)`);
      const pattern = `%${q}%`;
      params.push(pattern, pattern);
    }

    const rows = await db.getAllAsync<ProjectRow>(
      `
        SELECT *
        FROM ${PROJECTS_TABLE}
        WHERE ${where.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
      ...params,
      limit,
      offset
    );

    return rows.map(mapRow);
  },

  async computeRiskLevel(projectId: string, orgId?: string): Promise<ProjectRiskLevel> {
    const resolvedOrgId = normalizeText(orgId) || contextOrgId;
    if (!resolvedOrgId) {
      throw new Error('org_id requis pour computeRiskLevel.');
    }

    const indicators = await getIndicatorsForProjects(resolvedOrgId, [projectId]);
    return indicators[projectId]?.riskLevel ?? 'OK';
  },

  async getSyncState(projectId: string, orgId?: string): Promise<ProjectSyncState> {
    const resolvedOrgId = normalizeText(orgId) || contextOrgId;
    if (!resolvedOrgId) {
      throw new Error('org_id requis pour getSyncState.');
    }

    const indicators = await getIndicatorsForProjects(resolvedOrgId, [projectId]);
    return indicators[projectId]?.syncState ?? 'SYNCED';
  },

  async getIndicators(orgId: string | null | undefined, projectIds: string[]) {
    const resolvedOrgId = normalizeText(orgId ?? undefined) || contextOrgId;
    if (!resolvedOrgId) {
      return {};
    }

    return getIndicatorsForProjects(resolvedOrgId, projectIds);
  }
};
