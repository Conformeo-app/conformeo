import * as SQLite from 'expo-sqlite';
import { securityPolicies } from '../../core/security/policies';
import { quotas } from '../quotas-limits';
import { syncEngine } from '../sync/sync-engine';
import { projects } from './projects';
import type { ProjectIndicators, ProjectRiskLevel } from './types';

const DB_NAME = 'conformeo.db';

const TASKS_TABLE = 'tasks';
const DOCUMENTS_TABLE = 'documents';
const MEDIA_TABLE = 'media_assets';
const EXPORTS_TABLE = 'export_jobs';
const OPERATIONS_TABLE = 'operations_queue';
const PLAN_PINS_TABLE = 'plan_pins';

const DEFAULT_ACTIVITY_LIMIT = 10;
const EXPORT_STALE_DAYS = 7;

type OverviewTabKey = 'Tasks' | 'Plans' | 'Media' | 'Documents' | 'Control';

export type OverviewKpis = {
  openTasks: number;
  blockedTasks: number;
  mediaTotal: number;
  mediaPending: number;
  docsTotal: number;
  plansCount: number;
  exportsRecent: number;
};

export type OverviewAlert = {
  key: string;
  level: 'INFO' | 'WARN' | 'CRIT';
  title: string;
  ctaLabel: string;
  ctaRoute: { tab: OverviewTabKey; params?: any };
};

export type OverviewHealth = {
  riskLevel: ProjectRiskLevel;
  offline: boolean;
  pendingOps: number;
  conflictCount: number;
  failedUploads: number;
};

export type ActivityEventType =
  | 'TASK_CREATED'
  | 'TASK_DONE'
  | 'TASK_UPDATED'
  | 'MEDIA_ADDED'
  | 'DOC_ADDED'
  | 'DOC_UPDATED'
  | 'EXPORT_DONE'
  | 'EXPORT_CREATED'
  | 'PIN_CREATED'
  | 'PIN_UPDATED';

export type ActivityEvent = {
  id: string;
  type: ActivityEventType;
  entity: 'TASK' | 'MEDIA' | 'DOCUMENT' | 'EXPORT' | 'PIN';
  entity_id: string;
  label: string;
  created_at: string;
};

type TaskActivityRow = {
  id: string;
  title: string;
  status: 'TODO' | 'DOING' | 'DONE' | 'BLOCKED';
  created_at: string;
  updated_at: string;
};

type MediaActivityRow = {
  id: string;
  tag: string | null;
  mime: string;
  created_at: string;
  upload_status: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
};

type DocumentActivityRow = {
  id: string;
  title: string;
  doc_type: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type ExportActivityRow = {
  id: string;
  type: string;
  status: string;
  created_at: string;
  finished_at: string | null;
};

type PinActivityRow = {
  id: string;
  label: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type OperationRow = {
  id: string;
  payload: string;
  status: string;
  retry_count: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
const knownTables = new Set<string>();

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function extractField(payload: Record<string, unknown>, keys: string[], depth = 0): string | null {
  if (depth > 3) {
    return null;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  const data = payload.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const nested = extractField(data as Record<string, unknown>, keys, depth + 1);
    if (nested) return nested;
  }

  const patch = payload.patch;
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    const nested = extractField(patch as Record<string, unknown>, keys, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function extractProjectId(payload: Record<string, unknown>) {
  return extractField(payload, ['project_id', 'projectId']);
}

function extractOrgId(payload: Record<string, unknown>) {
  return extractField(payload, ['org_id', 'orgId']);
}

function compareDescIso(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

async function tableExists(db: SQLite.SQLiteDatabase, tableName: string) {
  if (knownTables.has(tableName)) {
    return true;
  }

  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
    `,
    tableName
  );

  const exists = (row?.count ?? 0) > 0;
  if (exists) {
    knownTables.add(tableName);
  }
  return exists;
}

async function countBySql(db: SQLite.SQLiteDatabase, sql: string, params: Array<string | number>) {
  const row = await db.getFirstAsync<{ count: number }>(sql, ...params);
  return Number(row?.count ?? 0) || 0;
}

async function resolveProjectOrg(projectId: string) {
  const project = await projects.getById(projectId);
  if (!project) {
    throw new Error('Chantier introuvable.');
  }
  return { project, orgId: project.org_id };
}

async function getProjectIndicator(orgId: string, projectId: string): Promise<ProjectIndicators | null> {
  const map = await projects.getIndicators(orgId, [projectId]);
  return map[projectId] ?? null;
}

async function countUnsyncedOpsForProject(input: { orgId: string; projectId: string }) {
  const db = await getDb();
  if (!(await tableExists(db, OPERATIONS_TABLE))) {
    return 0;
  }

  const max = securityPolicies.maxSyncAttempts;

  const rows = await db.getAllAsync<OperationRow>(
    `
      SELECT id, payload, status, retry_count
      FROM ${OPERATIONS_TABLE}
      WHERE status != 'SYNCED'
        AND retry_count < ?
      ORDER BY created_at ASC
      LIMIT 5000
    `,
    max
  );

  let count = 0;

  for (const row of rows) {
    const payload = parseJsonObject(row.payload);
    const opOrgId = extractOrgId(payload);
    const opProjectId = extractProjectId(payload);

    if (opOrgId !== input.orgId) {
      continue;
    }

    if (opProjectId !== input.projectId) {
      continue;
    }

    count += 1;
  }

  return count;
}

export const overview = {
  async getKpis(projectId: string): Promise<OverviewKpis> {
    const { orgId } = await resolveProjectOrg(projectId);

    const db = await getDb();

    const safeProjectId = normalizeText(projectId);

    const hasTasks = await tableExists(db, TASKS_TABLE);
    const hasMedia = await tableExists(db, MEDIA_TABLE);
    const hasDocs = await tableExists(db, DOCUMENTS_TABLE);
    const hasExports = await tableExists(db, EXPORTS_TABLE);

    const [openTasks, blockedTasks] = hasTasks
      ? await Promise.all([
          countBySql(
            db,
            `
              SELECT COUNT(*) AS count
              FROM ${TASKS_TABLE}
              WHERE org_id = ?
                AND project_id = ?
                AND deleted_at IS NULL
                AND status IN ('TODO', 'DOING')
            `,
            [orgId, safeProjectId]
          ),
          countBySql(
            db,
            `
              SELECT COUNT(*) AS count
              FROM ${TASKS_TABLE}
              WHERE org_id = ?
                AND project_id = ?
                AND deleted_at IS NULL
                AND status = 'BLOCKED'
            `,
            [orgId, safeProjectId]
          )
        ])
      : [0, 0];

    const [mediaTotal, mediaPending] = hasMedia
      ? await Promise.all([
          countBySql(
            db,
            `
              SELECT COUNT(*) AS count
              FROM ${MEDIA_TABLE}
              WHERE org_id = ?
                AND project_id = ?
            `,
            [orgId, safeProjectId]
          ),
          countBySql(
            db,
            `
              SELECT COUNT(*) AS count
              FROM ${MEDIA_TABLE}
              WHERE org_id = ?
                AND project_id = ?
                AND upload_status != 'UPLOADED'
            `,
            [orgId, safeProjectId]
          )
        ])
      : [0, 0];

    const [docsTotal, plansCount] = hasDocs
      ? await Promise.all([
          countBySql(
            db,
            `
              SELECT COUNT(*) AS count
              FROM ${DOCUMENTS_TABLE}
              WHERE org_id = ?
                AND project_id = ?
                AND deleted_at IS NULL
            `,
            [orgId, safeProjectId]
          ),
          countBySql(
            db,
            `
              SELECT COUNT(*) AS count
              FROM ${DOCUMENTS_TABLE}
              WHERE org_id = ?
                AND project_id = ?
                AND deleted_at IS NULL
                AND doc_type = 'PLAN'
            `,
            [orgId, safeProjectId]
          )
        ])
      : [0, 0];

    const exportsThreshold = daysAgoIso(EXPORT_STALE_DAYS);
    const exportsRecent = hasExports
      ? await countBySql(
          db,
          `
            SELECT COUNT(*) AS count
            FROM ${EXPORTS_TABLE}
            WHERE org_id = ?
              AND project_id = ?
              AND COALESCE(finished_at, created_at) >= ?
          `,
          [orgId, safeProjectId, exportsThreshold]
        )
      : 0;

    return {
      openTasks,
      blockedTasks,
      mediaTotal,
      mediaPending,
      docsTotal,
      plansCount,
      exportsRecent
    };
  },

  async getHealth(projectId: string): Promise<OverviewHealth> {
    const { project, orgId } = await resolveProjectOrg(projectId);
    const indicator = await getProjectIndicator(orgId, project.id);

    const offline = syncEngine.getStatus().state === 'OFFLINE';
    const pendingOps = await countUnsyncedOpsForProject({ orgId, projectId: project.id });

    return {
      riskLevel: indicator?.riskLevel ?? 'OK',
      offline,
      pendingOps: pendingOps + (indicator?.pendingUploads ?? 0),
      conflictCount: indicator?.openConflicts ?? 0,
      failedUploads: indicator?.failedUploads ?? 0
    };
  },

  async getAlerts(projectId: string): Promise<OverviewAlert[]> {
    const { project } = await resolveProjectOrg(projectId);
    const indicator = await getProjectIndicator(project.org_id, project.id);
    const [health, kpis, quotaRow, usageRow] = await Promise.all([
      this.getHealth(project.id),
      this.getKpis(project.id),
      quotas.get(),
      quotas.getUsage()
    ]);

    const alerts: OverviewAlert[] = [];

    const projectedUsed = Math.max(0, usageRow.storage_used_mb);
    const ratio = quotaRow.storage_mb > 0 ? projectedUsed / quotaRow.storage_mb : 0;

    if (ratio >= 0.95) {
      alerts.push({
        key: 'storage_quota_crit',
        level: 'CRIT',
        title: `Stockage presque plein (${Math.round(ratio * 100)}%)`,
        ctaLabel: 'Voir preuves',
        ctaRoute: { tab: 'Media' }
      });
    } else if (ratio >= 0.8) {
      alerts.push({
        key: 'storage_quota_warn',
        level: 'WARN',
        title: `Stockage élevé (${Math.round(ratio * 100)}%)`,
        ctaLabel: 'Voir preuves',
        ctaRoute: { tab: 'Media' }
      });
    }

    if ((health.conflictCount ?? 0) > 0) {
      alerts.push({
        key: 'sync_conflicts',
        level: 'CRIT',
        title: `Conflits de synchronisation (${health.conflictCount})`,
        ctaLabel: 'Inspecter',
        ctaRoute: { tab: 'Control' }
      });
    }

    if ((indicator?.safetyOpenTasks ?? 0) > 0) {
      alerts.push({
        key: 'safety_open_tasks',
        level: 'WARN',
        title: `Tâches sécurité ouvertes (${indicator?.safetyOpenTasks ?? 0})`,
        ctaLabel: 'Voir tâches',
        ctaRoute: { tab: 'Tasks' }
      });
    }

    if ((health.failedUploads ?? 0) > 0) {
      alerts.push({
        key: 'failed_uploads',
        level: 'CRIT',
        title: `Uploads médias en échec (${health.failedUploads})`,
        ctaLabel: 'Voir échecs',
        ctaRoute: { tab: 'Media', params: { uploadStatus: 'FAILED' } }
      });
    }

    if (kpis.exportsRecent === 0) {
      alerts.push({
        key: 'exports_missing',
        level: 'INFO',
        title: `Aucun export récent (>${EXPORT_STALE_DAYS}j)`,
        ctaLabel: 'Générer pack',
        ctaRoute: { tab: 'Control' }
      });
    }

    const rank: Record<OverviewAlert['level'], number> = { CRIT: 0, WARN: 1, INFO: 2 };
    return alerts.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 6);
  },

  async getActivity(projectId: string, limit = DEFAULT_ACTIVITY_LIMIT): Promise<ActivityEvent[]> {
    const { orgId } = await resolveProjectOrg(projectId);
    const db = await getDb();

    const safeLimit = Math.max(1, Math.min(limit, 50));
    const safeProjectId = normalizeText(projectId);

    const hasTasks = await tableExists(db, TASKS_TABLE);
    const hasMedia = await tableExists(db, MEDIA_TABLE);
    const hasDocs = await tableExists(db, DOCUMENTS_TABLE);
    const hasExports = await tableExists(db, EXPORTS_TABLE);
    const hasPins = await tableExists(db, PLAN_PINS_TABLE);

    const [tasksRows, mediaRows, docRows, exportRows, pinRows] = await Promise.all([
      hasTasks
        ? db.getAllAsync<TaskActivityRow>(
            `
              SELECT id, title, status, created_at, updated_at
              FROM ${TASKS_TABLE}
              WHERE org_id = ?
                AND project_id = ?
                AND deleted_at IS NULL
              ORDER BY updated_at DESC
              LIMIT ?
            `,
            orgId,
            safeProjectId,
            safeLimit
          )
        : ([] as TaskActivityRow[]),
      hasMedia
        ? db.getAllAsync<MediaActivityRow>(
            `
              SELECT id, tag, mime, created_at, upload_status
              FROM ${MEDIA_TABLE}
              WHERE org_id = ?
                AND project_id = ?
              ORDER BY created_at DESC
              LIMIT ?
            `,
            orgId,
            safeProjectId,
            safeLimit
          )
        : ([] as MediaActivityRow[]),
      hasDocs
        ? db.getAllAsync<DocumentActivityRow>(
            `
              SELECT id, title, doc_type, status, created_at, updated_at
              FROM ${DOCUMENTS_TABLE}
              WHERE org_id = ?
                AND project_id = ?
                AND deleted_at IS NULL
              ORDER BY updated_at DESC
              LIMIT ?
            `,
            orgId,
            safeProjectId,
            safeLimit
          )
        : ([] as DocumentActivityRow[]),
      hasExports
        ? db.getAllAsync<ExportActivityRow>(
            `
              SELECT id, type, status, created_at, finished_at
              FROM ${EXPORTS_TABLE}
              WHERE org_id = ?
                AND project_id = ?
              ORDER BY COALESCE(finished_at, created_at) DESC
              LIMIT ?
            `,
            orgId,
            safeProjectId,
            safeLimit
          )
        : ([] as ExportActivityRow[]),
      hasPins
        ? db.getAllAsync<PinActivityRow>(
            `
              SELECT id, label, status, created_at, updated_at
              FROM ${PLAN_PINS_TABLE}
              WHERE org_id = ?
                AND project_id = ?
              ORDER BY updated_at DESC
              LIMIT ?
            `,
            orgId,
            safeProjectId,
            safeLimit
          )
        : ([] as PinActivityRow[])
    ]);

    const events: ActivityEvent[] = [];

    for (const task of tasksRows) {
      const isCreated = task.created_at === task.updated_at;
      const isDone = task.status === 'DONE';
      const type: ActivityEventType = isDone ? 'TASK_DONE' : isCreated ? 'TASK_CREATED' : 'TASK_UPDATED';

      events.push({
        id: `task:${task.id}:${task.updated_at}`,
        type,
        entity: 'TASK',
        entity_id: task.id,
        label: isDone ? `Tâche terminée — ${task.title}` : isCreated ? `Tâche créée — ${task.title}` : `Tâche modifiée — ${task.title}`,
        created_at: task.updated_at
      });
    }

    for (const asset of mediaRows) {
      const tag = normalizeText(asset.tag) || 'preuve';
      events.push({
        id: `media:${asset.id}:${asset.created_at}`,
        type: 'MEDIA_ADDED',
        entity: 'MEDIA',
        entity_id: asset.id,
        label: `Preuve ajoutée — ${tag} (${asset.upload_status})`,
        created_at: asset.created_at
      });
    }

    for (const doc of docRows) {
      const isCreated = doc.created_at === doc.updated_at;
      events.push({
        id: `doc:${doc.id}:${doc.updated_at}`,
        type: isCreated ? 'DOC_ADDED' : 'DOC_UPDATED',
        entity: 'DOCUMENT',
        entity_id: doc.id,
        label: isCreated ? `Document ajouté — ${doc.title}` : `Document modifié — ${doc.title}`,
        created_at: doc.updated_at
      });
    }

    for (const job of exportRows) {
      const at = job.finished_at ?? job.created_at;
      const isDone = job.status === 'DONE';
      events.push({
        id: `export:${job.id}:${at}`,
        type: isDone ? 'EXPORT_DONE' : 'EXPORT_CREATED',
        entity: 'EXPORT',
        entity_id: job.id,
        label: isDone ? `Export terminé — ${job.type}` : `Export lancé — ${job.type} (${job.status})`,
        created_at: at
      });
    }

    for (const pin of pinRows) {
      const isCreated = pin.created_at === pin.updated_at;
      const label = normalizeText(pin.label) || 'Point plan';
      events.push({
        id: `pin:${pin.id}:${pin.updated_at}`,
        type: isCreated ? 'PIN_CREATED' : 'PIN_UPDATED',
        entity: 'PIN',
        entity_id: pin.id,
        label: isCreated ? `Pin ajouté — ${label}` : `Pin modifié — ${label}`,
        created_at: pin.updated_at
      });
    }

    events.sort((a, b) => compareDescIso(a.created_at, b.created_at));

    return events.slice(0, safeLimit);
  }
};
