import * as SQLite from 'expo-sqlite';
import { ModuleKey } from '../../core/modules';
import { securityPolicies } from '../../core/security/policies';
import { exportsDoe } from '../exports';
import { media } from '../media';
import {
  DashboardActivity,
  DashboardActivityEntity,
  DashboardAlert,
  DashboardApi,
  DashboardContext,
  DashboardDocumentPreview,
  DashboardExportPreview,
  DashboardMediaPreview,
  DashboardScope,
  DashboardSummary,
  DashboardTaskPreview,
  DashboardWidgetConfigItem,
  DashboardWidgetKey,
  DashboardWidgetsConfig,
  DashboardWidgetsConfigInput
} from './types';

const DB_NAME = 'conformeo.db';

const DASHBOARD_PREFS_TABLE = 'dashboard_prefs';
const ORGS_ADMIN_CACHE_TABLE = 'orgs_admin_cache';
const FEATURE_FLAGS_CACHE_TABLE = 'feature_flags_cache';

const TASKS_TABLE = 'tasks';
const DOCUMENTS_TABLE = 'documents';
const MEDIA_TABLE = 'media_assets';
const EXPORTS_TABLE = 'export_jobs';
const OPERATIONS_TABLE = 'operations_queue';

const SAFETY_KEYWORDS = ['safety', 'securite', 'permis_feu', 'permis feu', 'epi', 'harnais', 'risque'];
const PREFS_VERSION = 1;

const ACTIVITY_MAX_LIMIT = 100;
const PREVIEW_LIMIT = 8;

type CountRow = { count: number };

type PrefsRow = {
  org_id: string;
  project_id: string;
  config_json: string;
  updated_at: string;
};

type CachedRow = {
  payload: string;
};

type TaskPreviewRow = {
  id: string;
  title: string;
  status: 'TODO' | 'DOING' | 'DONE' | 'BLOCKED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  updated_at: string;
  project_id: string;
  tags_json: string;
};

type MediaPreviewRow = {
  id: string;
  tag: string | null;
  mime: string;
  created_at: string;
  upload_status: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  local_thumb_path: string | null;
  project_id: string | null;
};

type DocumentPreviewRow = {
  id: string;
  title: string;
  doc_type: 'PLAN' | 'DOE' | 'PV' | 'REPORT' | 'INTERNAL' | 'OTHER';
  status: 'DRAFT' | 'FINAL' | 'SIGNED';
  updated_at: string;
  project_id: string | null;
};

type ExportPreviewRow = {
  id: string;
  type: 'REPORT_PDF' | 'CONTROL_PACK' | 'DOE_ZIP';
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  created_at: string;
  finished_at: string | null;
  project_id: string;
};

type SyncFailureRow = {
  id: string;
  entity: string;
  created_at: string;
  last_error: string | null;
};

type CachedModuleFlag = {
  key: string;
  enabled: boolean;
  updated_at?: string;
};

type FeatureFlagsCacheRow = {
  key: string;
  enabled: number;
  updated_at: string | null;
};

type WidgetTemplate = {
  key: DashboardWidgetKey;
  requiredModule?: ModuleKey;
};

const DEFAULT_WIDGETS: WidgetTemplate[] = [
  { key: 'open_tasks', requiredModule: 'tasks' },
  { key: 'blocked_tasks', requiredModule: 'tasks' },
  { key: 'proofs', requiredModule: 'media' },
  { key: 'documents', requiredModule: 'documents' },
  { key: 'exports_recent', requiredModule: 'exports' },
  { key: 'alerts', requiredModule: 'offline' },
  { key: 'activity' }
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextProjectId: string | null = null;
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

function parseJsonArray<T>(raw: string, fallback: T[]) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function startOfDayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function dateMs(iso: string) {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortByOrder(widgets: DashboardWidgetConfigItem[]) {
  return [...widgets].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.key.localeCompare(right.key);
  });
}

function normalizeWidgetList(input: DashboardWidgetConfigItem[]) {
  const deduped = new Map<DashboardWidgetKey, DashboardWidgetConfigItem>();

  for (const item of input) {
    deduped.set(item.key, {
      key: item.key,
      enabled: item.enabled,
      order: item.order,
      requiredModule: item.requiredModule
    });
  }

  const ordered = sortByOrder(Array.from(deduped.values()));

  return ordered.map((item, index) => ({
    ...item,
    order: index
  }));
}

function defaultWidgets() {
  return DEFAULT_WIDGETS.map((template, index) => ({
    key: template.key,
    enabled: true,
    order: index,
    requiredModule: template.requiredModule,
    lockedByFeatureFlag: false
  })) satisfies DashboardWidgetConfigItem[];
}

function resolveScope(scope?: Partial<DashboardScope>) {
  const orgId = normalizeText(scope?.orgId) || contextOrgId;
  if (!orgId) {
    throw new Error('orgId est requis pour le dashboard.');
  }

  const projectId = normalizeText(scope?.projectId) || contextProjectId || undefined;

  return {
    orgId,
    projectId
  } satisfies DashboardScope;
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

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      const db = await getDb();

      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS ${DASHBOARD_PREFS_TABLE} (
          org_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          config_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (org_id, project_id)
        );

        CREATE INDEX IF NOT EXISTS idx_dashboard_prefs_org_updated
          ON ${DASHBOARD_PREFS_TABLE}(org_id, updated_at DESC);
      `);
    })();
  }

  return setupPromise;
}

function projectScopeClause(scope: DashboardScope, alias?: string) {
  const projectColumn = alias ? `${alias}.project_id` : 'project_id';

  if (!scope.projectId) {
    return {
      clause: '',
      params: [] as Array<string | number>
    };
  }

  return {
    clause: ` AND ${projectColumn} = ?`,
    params: [scope.projectId] as Array<string | number>
  };
}

function mapTaskPreview(row: TaskPreviewRow): DashboardTaskPreview {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    updated_at: row.updated_at,
    project_id: row.project_id,
    tags: parseJsonArray<string>(row.tags_json, [])
  };
}

function mapMediaPreview(row: MediaPreviewRow): DashboardMediaPreview {
  return {
    id: row.id,
    tag: toOptional(row.tag),
    mime: row.mime,
    created_at: row.created_at,
    upload_status: row.upload_status,
    local_thumb_path: toOptional(row.local_thumb_path),
    project_id: toOptional(row.project_id)
  };
}

function mapDocumentPreview(row: DocumentPreviewRow): DashboardDocumentPreview {
  return {
    id: row.id,
    title: row.title,
    doc_type: row.doc_type,
    status: row.status,
    updated_at: row.updated_at,
    project_id: toOptional(row.project_id)
  };
}

function mapExportPreview(row: ExportPreviewRow): DashboardExportPreview {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    created_at: row.created_at,
    finished_at: toOptional(row.finished_at),
    project_id: row.project_id
  };
}

async function countOpenTasks(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, TASKS_TABLE))) {
    return 0;
  }

  const project = projectScopeClause(scope);

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${TASKS_TABLE}
      WHERE org_id = ?
        AND deleted_at IS NULL
        AND status != 'DONE'
        ${project.clause}
    `,
    scope.orgId,
    ...project.params
  );

  return row?.count ?? 0;
}

async function countBlockedTasks(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, TASKS_TABLE))) {
    return 0;
  }

  const project = projectScopeClause(scope);

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${TASKS_TABLE}
      WHERE org_id = ?
        AND deleted_at IS NULL
        AND status = 'BLOCKED'
        ${project.clause}
    `,
    scope.orgId,
    ...project.params
  );

  return row?.count ?? 0;
}

async function countSafetyOpenTasks(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, TASKS_TABLE))) {
    return 0;
  }

  const project = projectScopeClause(scope);

  const likeFragments: string[] = [];
  const likeParams: string[] = [];

  for (const keyword of SAFETY_KEYWORDS) {
    const pattern = `%${keyword}%`;
    likeFragments.push(`LOWER(COALESCE(title, '')) LIKE ?`);
    likeFragments.push(`LOWER(COALESCE(description, '')) LIKE ?`);
    likeFragments.push(`LOWER(COALESCE(tags_json, '')) LIKE ?`);
    likeParams.push(pattern, pattern, pattern);
  }

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${TASKS_TABLE}
      WHERE org_id = ?
        AND deleted_at IS NULL
        AND status != 'DONE'
        ${project.clause}
        AND (${likeFragments.join(' OR ')})
    `,
    scope.orgId,
    ...project.params,
    ...likeParams
  );

  return row?.count ?? 0;
}

async function countProofs(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, MEDIA_TABLE))) {
    return 0;
  }

  const project = projectScopeClause(scope);

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${MEDIA_TABLE}
      WHERE org_id = ?
        ${project.clause}
    `,
    scope.orgId,
    ...project.params
  );

  return row?.count ?? 0;
}

async function countDocuments(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, DOCUMENTS_TABLE))) {
    return 0;
  }

  const project = projectScopeClause(scope);

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${DOCUMENTS_TABLE}
      WHERE org_id = ?
        AND deleted_at IS NULL
        ${project.clause}
    `,
    scope.orgId,
    ...project.params
  );

  return row?.count ?? 0;
}

async function countRecentExports(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, EXPORTS_TABLE))) {
    return 0;
  }

  const sinceIso = daysAgoIso(7);
  const project = projectScopeClause(scope);

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${EXPORTS_TABLE}
      WHERE org_id = ?
        AND created_at >= ?
        ${project.clause}
    `,
    scope.orgId,
    sinceIso,
    ...project.params
  );

  return row?.count ?? 0;
}

async function countExportsToday(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, EXPORTS_TABLE))) {
    return 0;
  }

  const startIso = startOfDayIso();
  const project = projectScopeClause(scope);

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${EXPORTS_TABLE}
      WHERE org_id = ?
        AND created_at >= ?
        ${project.clause}
    `,
    scope.orgId,
    startIso,
    ...project.params
  );

  return row?.count ?? 0;
}

async function countSyncPending(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, OPERATIONS_TABLE))) {
    return 0;
  }

  const projectFilterA = scope.projectId ? `%"project_id":"${scope.projectId}"%` : null;
  const projectFilterB = scope.projectId ? `%"projectId":"${scope.projectId}"%` : null;

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${OPERATIONS_TABLE}
      WHERE status = 'PENDING'
        AND (
          entity = 'media_assets'
          OR entity = 'tasks'
          OR entity = 'documents'
          OR entity = 'document_versions'
          OR entity = 'export_jobs'
          OR entity = 'export_items'
        )
        AND (? IS NULL OR payload LIKE ? OR payload LIKE ?)
    `,
    projectFilterA,
    projectFilterA,
    projectFilterB
  );

  return row?.count ?? 0;
}

async function countSyncFailed(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, OPERATIONS_TABLE))) {
    return 0;
  }

  const projectFilterA = scope.projectId ? `%"project_id":"${scope.projectId}"%` : null;
  const projectFilterB = scope.projectId ? `%"projectId":"${scope.projectId}"%` : null;

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${OPERATIONS_TABLE}
      WHERE status = 'FAILED'
        AND (? IS NULL OR payload LIKE ? OR payload LIKE ?)
    `,
    projectFilterA,
    projectFilterA,
    projectFilterB
  );

  return row?.count ?? 0;
}

async function countUploadQueue(db: SQLite.SQLiteDatabase, scope: DashboardScope) {
  if (!(await tableExists(db, MEDIA_TABLE))) {
    return 0;
  }

  const project = projectScopeClause(scope);

  const row = await db.getFirstAsync<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM ${MEDIA_TABLE}
      WHERE org_id = ?
        ${project.clause}
        AND (
          upload_status = 'PENDING'
          OR upload_status = 'UPLOADING'
          OR (upload_status = 'FAILED' AND retry_count < ?)
        )
    `,
    scope.orgId,
    ...project.params,
    securityPolicies.maxSyncAttempts
  );

  return row?.count ?? 0;
}

async function listTaskPreviews(
  db: SQLite.SQLiteDatabase,
  scope: DashboardScope,
  statusClause: string,
  limit: number
) {
  if (!(await tableExists(db, TASKS_TABLE))) {
    return [] as DashboardTaskPreview[];
  }

  const project = projectScopeClause(scope);

  const rows = await db.getAllAsync<TaskPreviewRow>(
    `
      SELECT id, title, status, priority, updated_at, project_id, tags_json
      FROM ${TASKS_TABLE}
      WHERE org_id = ?
        AND deleted_at IS NULL
        AND ${statusClause}
        ${project.clause}
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    scope.orgId,
    ...project.params,
    limit
  );

  return rows.map(mapTaskPreview);
}

async function listLatestProofs(db: SQLite.SQLiteDatabase, scope: DashboardScope, limit: number) {
  if (!(await tableExists(db, MEDIA_TABLE))) {
    return [] as DashboardMediaPreview[];
  }

  const project = projectScopeClause(scope);

  const rows = await db.getAllAsync<MediaPreviewRow>(
    `
      SELECT id, tag, mime, created_at, upload_status, local_thumb_path, project_id
      FROM ${MEDIA_TABLE}
      WHERE org_id = ?
        ${project.clause}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    scope.orgId,
    ...project.params,
    limit
  );

  return rows.map(mapMediaPreview);
}

async function listLatestDocuments(db: SQLite.SQLiteDatabase, scope: DashboardScope, limit: number) {
  if (!(await tableExists(db, DOCUMENTS_TABLE))) {
    return [] as DashboardDocumentPreview[];
  }

  const project = projectScopeClause(scope);

  const rows = await db.getAllAsync<DocumentPreviewRow>(
    `
      SELECT id, title, doc_type, status, updated_at, project_id
      FROM ${DOCUMENTS_TABLE}
      WHERE org_id = ?
        AND deleted_at IS NULL
        ${project.clause}
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    scope.orgId,
    ...project.params,
    limit
  );

  return rows.map(mapDocumentPreview);
}

async function listLatestExports(db: SQLite.SQLiteDatabase, scope: DashboardScope, limit: number) {
  if (!(await tableExists(db, EXPORTS_TABLE))) {
    return [] as DashboardExportPreview[];
  }

  const project = projectScopeClause(scope);

  const rows = await db.getAllAsync<ExportPreviewRow>(
    `
      SELECT id, type, status, created_at, finished_at, project_id
      FROM ${EXPORTS_TABLE}
      WHERE org_id = ?
        ${project.clause}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    scope.orgId,
    ...project.params,
    limit
  );

  return rows.map(mapExportPreview);
}

async function listSyncFailures(db: SQLite.SQLiteDatabase, scope: DashboardScope, limit: number) {
  if (!(await tableExists(db, OPERATIONS_TABLE))) {
    return [] as SyncFailureRow[];
  }

  const projectFilterA = scope.projectId ? `%"project_id":"${scope.projectId}"%` : null;
  const projectFilterB = scope.projectId ? `%"projectId":"${scope.projectId}"%` : null;

  const rows = await db.getAllAsync<SyncFailureRow>(
    `
      SELECT id, entity, created_at, last_error
      FROM ${OPERATIONS_TABLE}
      WHERE status = 'FAILED'
        AND (? IS NULL OR payload LIKE ? OR payload LIKE ?)
      ORDER BY created_at DESC
      LIMIT ?
    `,
    projectFilterA,
    projectFilterA,
    projectFilterB,
    limit
  );

  return rows;
}

function buildAlerts(input: {
  syncFailedOps: number;
  safetyOpenTasks: number;
  uploadQueue: number;
  exportsToday: number;
}) {
  const alerts: DashboardAlert[] = [];

  if (input.syncFailedOps > 0) {
    alerts.push({
      code: 'SYNC_ERRORS',
      level: 'ERROR',
      value: input.syncFailedOps,
      message: `${input.syncFailedOps} operation(s) en erreur de synchronisation.`
    });
  }

  if (input.safetyOpenTasks > 0) {
    alerts.push({
      code: 'SAFETY_TASKS',
      level: 'WARN',
      value: input.safetyOpenTasks,
      message: `${input.safetyOpenTasks} tache(s) safety ouvertes a verifier.`
    });
  }

  const uploadWarnThreshold = Math.floor(media.config.maxPendingUploads * 0.8);
  if (input.uploadQueue >= uploadWarnThreshold && input.uploadQueue > 0) {
    alerts.push({
      code: 'UPLOAD_QUEUE_QUOTA',
      level: 'WARN',
      value: input.uploadQueue,
      message: `File upload chargee (${input.uploadQueue}/${media.config.maxPendingUploads}).`
    });
  }

  const exportsWarnThreshold = Math.floor(exportsDoe.config.maxExportsPerDay * 0.8);
  if (input.exportsToday >= exportsWarnThreshold && input.exportsToday > 0) {
    alerts.push({
      code: 'EXPORT_DAILY_QUOTA',
      level: 'WARN',
      value: input.exportsToday,
      message: `Quota exports proche (${input.exportsToday}/${exportsDoe.config.maxExportsPerDay} aujourd'hui).`
    });
  }

  return alerts;
}

function toActivity(entity: DashboardActivityEntity, id: string, at: string, title: string, subtitle?: string, projectId?: string) {
  return {
    id,
    entity,
    at,
    title,
    subtitle,
    project_id: projectId
  } satisfies DashboardActivity;
}

async function loadActivity(db: SQLite.SQLiteDatabase, scope: DashboardScope, limit: number) {
  const safeLimit = Math.max(1, Math.min(limit, ACTIVITY_MAX_LIMIT));

  const [tasksLatest, proofsLatest, documentsLatest, exportsLatest, syncFailures] = await Promise.all([
    listTaskPreviews(db, scope, `status IN ('TODO', 'DOING', 'DONE', 'BLOCKED')`, safeLimit),
    listLatestProofs(db, scope, safeLimit),
    listLatestDocuments(db, scope, safeLimit),
    listLatestExports(db, scope, safeLimit),
    listSyncFailures(db, scope, safeLimit)
  ]);

  const merged: DashboardActivity[] = [];

  for (const task of tasksLatest) {
    merged.push(
      toActivity(
        'TASK',
        `task-${task.id}`,
        task.updated_at,
        task.title,
        `Statut ${task.status} - Priorite ${task.priority}`,
        task.project_id
      )
    );
  }

  for (const proof of proofsLatest) {
    merged.push(
      toActivity(
        'MEDIA',
        `media-${proof.id}`,
        proof.created_at,
        `Preuve ${proof.tag ?? proof.mime}`,
        `Upload ${proof.upload_status}`,
        proof.project_id
      )
    );
  }

  for (const document of documentsLatest) {
    merged.push(
      toActivity(
        'DOCUMENT',
        `doc-${document.id}`,
        document.updated_at,
        document.title,
        `${document.doc_type} - ${document.status}`,
        document.project_id
      )
    );
  }

  for (const job of exportsLatest) {
    merged.push(
      toActivity(
        'EXPORT',
        `export-${job.id}`,
        job.finished_at ?? job.created_at,
        `Export ${job.type}`,
        `Statut ${job.status}`,
        job.project_id
      )
    );
  }

  for (const failure of syncFailures) {
    merged.push(
      toActivity(
        'SYNC',
        `sync-${failure.id}`,
        failure.created_at,
        `Erreur sync ${failure.entity}`,
        toOptional(failure.last_error)
      )
    );
  }

  return merged
    .sort((left, right) => dateMs(right.at) - dateMs(left.at))
    .slice(0, safeLimit);
}

function prefsProjectId(scope: DashboardScope) {
  return scope.projectId ?? '';
}

async function readStoredWidgets(
  db: SQLite.SQLiteDatabase,
  scope: DashboardScope
): Promise<DashboardWidgetConfigItem[] | null> {
  if (!(await tableExists(db, DASHBOARD_PREFS_TABLE))) {
    return null;
  }

  const row = await db.getFirstAsync<PrefsRow>(
    `
      SELECT org_id, project_id, config_json, updated_at
      FROM ${DASHBOARD_PREFS_TABLE}
      WHERE org_id = ?
        AND project_id = ?
      LIMIT 1
    `,
    scope.orgId,
    prefsProjectId(scope)
  );

  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.config_json) as {
      version?: number;
      widgets?: Array<{
        key: DashboardWidgetKey;
        enabled: boolean;
        order: number;
      }>;
    };

    if (parsed.version !== PREFS_VERSION || !Array.isArray(parsed.widgets)) {
      return null;
    }

    const defaultsByKey = new Map(defaultWidgets().map((item) => [item.key, item]));

    const normalized: DashboardWidgetConfigItem[] = [];

    for (const widget of parsed.widgets) {
      const template = defaultsByKey.get(widget.key);
      if (!template) {
        continue;
      }

      normalized.push({
        ...template,
        enabled: Boolean(widget.enabled),
        order: Number.isFinite(widget.order) ? Math.floor(widget.order) : template.order
      });
    }

    if (normalized.length === 0) {
      return null;
    }

    return normalizeWidgetList(normalized);
  } catch {
    return null;
  }
}

async function writeStoredWidgets(
  db: SQLite.SQLiteDatabase,
  scope: DashboardScope,
  widgets: DashboardWidgetConfigItem[]
) {
  const payload = JSON.stringify({
    version: PREFS_VERSION,
    widgets: widgets.map((item) => ({
      key: item.key,
      enabled: item.enabled,
      order: item.order
    }))
  });

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${DASHBOARD_PREFS_TABLE}
      (org_id, project_id, config_json, updated_at)
      VALUES (?, ?, ?, ?)
    `,
    scope.orgId,
    prefsProjectId(scope),
    payload,
    nowIso()
  );
}

async function loadCachedModuleFlags(db: SQLite.SQLiteDatabase, orgId: string) {
  if (await tableExists(db, FEATURE_FLAGS_CACHE_TABLE)) {
    const rows = await db.getAllAsync<FeatureFlagsCacheRow>(
      `
        SELECT key, enabled, updated_at
        FROM ${FEATURE_FLAGS_CACHE_TABLE}
        WHERE org_id = ?
        ORDER BY key ASC
      `,
      orgId
    );

    if (rows.length > 0) {
      const map = new Map<ModuleKey, CachedModuleFlag>();
      for (const row of rows) {
        const key = normalizeText(row.key) as ModuleKey;
        if (key.length === 0) {
          continue;
        }

        map.set(key, {
          key,
          enabled: row.enabled === 1,
          updated_at: toOptional(row.updated_at)
        });
      }

      return map;
    }
  }

  if (!(await tableExists(db, ORGS_ADMIN_CACHE_TABLE))) {
    return null;
  }

  const cacheKey = `org:${orgId}:modules`;

  const row = await db.getFirstAsync<CachedRow>(
    `
      SELECT payload
      FROM ${ORGS_ADMIN_CACHE_TABLE}
      WHERE cache_key = ?
      LIMIT 1
    `,
    cacheKey
  );

  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const map = new Map<ModuleKey, CachedModuleFlag>();

    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const candidate = item as CachedModuleFlag;
      const key = normalizeText(candidate.key) as ModuleKey;
      if (key.length === 0) {
        continue;
      }

      map.set(key, {
        key,
        enabled: Boolean(candidate.enabled),
        updated_at: toOptional(candidate.updated_at)
      });
    }

    return map;
  } catch {
    return null;
  }
}

function moduleEnabled(flags: Map<ModuleKey, CachedModuleFlag> | null, moduleKey: ModuleKey) {
  if (!flags) {
    return true;
  }

  const flag = flags.get(moduleKey);
  if (!flag) {
    return true;
  }

  if (!flag.updated_at) {
    return true;
  }

  return flag.enabled;
}

function applyFeatureLocks(
  widgets: DashboardWidgetConfigItem[],
  flags: Map<ModuleKey, CachedModuleFlag> | null
) {
  return widgets.map((widget) => {
    if (!widget.requiredModule) {
      return {
        ...widget,
        lockedByFeatureFlag: false
      };
    }

    const allowed = moduleEnabled(flags, widget.requiredModule);

    return {
      ...widget,
      enabled: allowed ? widget.enabled : false,
      lockedByFeatureFlag: !allowed
    } satisfies DashboardWidgetConfigItem;
  });
}

async function listProjectsFromTable(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  orgId: string,
  projectColumn: string = 'project_id'
) {
  if (!(await tableExists(db, tableName))) {
    return [] as string[];
  }

  const rows = await db.getAllAsync<{ project_id: string | null }>(
    `
      SELECT DISTINCT ${projectColumn} AS project_id
      FROM ${tableName}
      WHERE org_id = ?
        AND ${projectColumn} IS NOT NULL
        AND LENGTH(TRIM(${projectColumn})) > 0
    `,
    orgId
  );

  return rows
    .map((row) => normalizeText(row.project_id))
    .filter((value) => value.length > 0);
}

export const dashboard: DashboardApi = {
  setContext(context: Partial<DashboardContext>) {
    contextOrgId = normalizeText(context.org_id) || null;
    contextUserId = normalizeText(context.user_id) || null;
    contextProjectId = normalizeText(context.project_id) || null;
  },

  setOrg(orgId: string | null) {
    contextOrgId = normalizeText(orgId) || null;
  },

  setActor(userId: string | null) {
    contextUserId = normalizeText(userId) || null;
  },

  setProject(projectId: string | null) {
    contextProjectId = normalizeText(projectId) || null;
  },

  async listProjects(scope?: Partial<DashboardScope>) {
    await ensureSetup();
    const db = await getDb();

    const resolvedScope = resolveScope(scope);
    const projectSet = new Set<string>();

    const projectLists = await Promise.all([
      listProjectsFromTable(db, TASKS_TABLE, resolvedScope.orgId),
      listProjectsFromTable(db, DOCUMENTS_TABLE, resolvedScope.orgId),
      listProjectsFromTable(db, MEDIA_TABLE, resolvedScope.orgId),
      listProjectsFromTable(db, EXPORTS_TABLE, resolvedScope.orgId)
    ]);

    for (const list of projectLists) {
      for (const projectId of list) {
        projectSet.add(projectId);
      }
    }

    return Array.from(projectSet).sort((left, right) => left.localeCompare(right));
  },

  async getSummary(scope: DashboardScope): Promise<DashboardSummary> {
    await ensureSetup();
    const db = await getDb();

    const resolvedScope = resolveScope(scope);

    const [
      openTasks,
      blockedTasks,
      proofs,
      documentsCount,
      recentExports,
      syncPendingOps,
      syncFailedOps,
      safetyOpenTasks,
      uploadQueue,
      exportsToday,
      openTaskPreviews,
      blockedTaskPreviews,
      latestProofs,
      latestDocuments,
      latestExports,
      activity
    ] = await Promise.all([
      countOpenTasks(db, resolvedScope),
      countBlockedTasks(db, resolvedScope),
      countProofs(db, resolvedScope),
      countDocuments(db, resolvedScope),
      countRecentExports(db, resolvedScope),
      countSyncPending(db, resolvedScope),
      countSyncFailed(db, resolvedScope),
      countSafetyOpenTasks(db, resolvedScope),
      countUploadQueue(db, resolvedScope),
      countExportsToday(db, resolvedScope),
      listTaskPreviews(db, resolvedScope, `status != 'DONE'`, PREVIEW_LIMIT),
      listTaskPreviews(db, resolvedScope, `status = 'BLOCKED'`, PREVIEW_LIMIT),
      listLatestProofs(db, resolvedScope, PREVIEW_LIMIT),
      listLatestDocuments(db, resolvedScope, PREVIEW_LIMIT),
      listLatestExports(db, resolvedScope, PREVIEW_LIMIT),
      loadActivity(db, resolvedScope, 12)
    ]);

    return {
      scope: resolvedScope,
      generated_at: nowIso(),
      openTasks,
      blockedTasks,
      proofs,
      documents: documentsCount,
      recentExports,
      syncPendingOps,
      syncFailedOps,
      safetyOpenTasks,
      alerts: buildAlerts({
        syncFailedOps,
        safetyOpenTasks,
        uploadQueue,
        exportsToday
      }),
      openTaskPreviews,
      blockedTaskPreviews,
      latestProofs,
      latestDocuments,
      latestExports,
      activity
    };
  },

  async getWidgetsConfig(scope?: Partial<DashboardScope>) {
    await ensureSetup();
    const db = await getDb();

    const resolvedScope = resolveScope(scope);

    const stored = await readStoredWidgets(db, resolvedScope);
    const source: DashboardWidgetsConfig['source'] = stored ? 'LOCAL' : 'DEFAULT';

    const flags = await loadCachedModuleFlags(db, resolvedScope.orgId);

    const widgets = applyFeatureLocks(stored ?? defaultWidgets(), flags);

    return {
      scope: resolvedScope,
      widgets: normalizeWidgetList(widgets),
      updated_at: nowIso(),
      source
    } satisfies DashboardWidgetsConfig;
  },

  async setWidgetsConfig(config: DashboardWidgetsConfigInput, scope?: Partial<DashboardScope>) {
    await ensureSetup();
    const db = await getDb();

    const resolvedScope = resolveScope(scope);

    const current = (await readStoredWidgets(db, resolvedScope)) ?? defaultWidgets();
    const byKey = new Map(current.map((item) => [item.key, { ...item }]));

    for (const patch of config.widgets) {
      const currentWidget = byKey.get(patch.key);
      if (!currentWidget) {
        continue;
      }

      currentWidget.enabled = Boolean(patch.enabled);
      if (typeof patch.order === 'number' && Number.isFinite(patch.order)) {
        currentWidget.order = Math.max(0, Math.floor(patch.order));
      }

      byKey.set(patch.key, currentWidget);
    }

    const nextWidgets = normalizeWidgetList(Array.from(byKey.values()));
    await writeStoredWidgets(db, resolvedScope, nextWidgets);

    return this.getWidgetsConfig(resolvedScope);
  },

  async getActivityFeed(limit: number, scope?: Partial<DashboardScope>) {
    await ensureSetup();
    const db = await getDb();
    const resolvedScope = resolveScope(scope);

    return loadActivity(db, resolvedScope, limit);
  }
};
