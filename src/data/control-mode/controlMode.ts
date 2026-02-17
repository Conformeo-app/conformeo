import * as SQLite from 'expo-sqlite';
import checklistTemplateJson from './checklistTemplate.json';
import { documents } from '../documents';
import { exportsDoe, ExportJob } from '../exports';
import { media, MediaAsset } from '../media';
import { offlineDB } from '../offline/outbox';
import { plans } from '../plans-annotations';
import { Task, tasks } from '../tasks';
import {
  ChecklistTemplateConfig,
  ChecklistWithItems,
  ControlActivity,
  ControlModeApi,
  ControlModeContext,
  ControlModeState,
  ControlProofFilters,
  ControlSummary,
  InspectionScore,
  InspectionChecklist,
  InspectionItem,
  InspectionSummary,
  RiskLevel
} from './types';

const DB_NAME = 'conformeo.db';

const CONTROL_STATE_TABLE = 'control_mode_state';
const CHECKLISTS_TABLE = 'inspection_checklists';
const ITEMS_TABLE = 'inspection_items';

const TASKS_TABLE = 'tasks';
const DOCUMENTS_TABLE = 'documents';
const MEDIA_TABLE = 'media_assets';

const PAGE_SIZE = 200;
const WATCH_OPEN_TASK_THRESHOLD = 10;

const CRITICAL_KEYWORDS = [
  'safety',
  'securite',
  'securisee',
  'permis_feu',
  'permis feu',
  'epi',
  'harnais',
  'risque',
  'critical',
  'critique',
  'incendie'
];

type ControlModeStateRow = {
  project_id: string;
  org_id: string;
  enabled: number;
  updated_by: string | null;
  enabled_at: string | null;
  disabled_at: string | null;
  updated_at: string;
};

type ChecklistRow = {
  id: string;
  org_id: string;
  project_id: string;
  created_by: string;
  created_at: string;
};

type ItemRow = {
  id: string;
  checklist_id: string;
  key: string;
  label: string;
  checked: number;
  comment: string | null;
  updated_at: string;
  updated_by: string | null;
};

type ItemWithChecklistRow = ItemRow & {
  org_id: string;
  project_id: string;
};

type ChecklistTemplate = {
  items: Array<{ key: string; label: string }>;
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
  return value && value.length > 0 ? value : undefined;
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

function normalizeKeyword(value: string | undefined) {
  if (!value) {
    return '';
  }

  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function hasCriticalKeyword(value: string | undefined) {
  const normalized = normalizeKeyword(value);
  if (normalized.length === 0) {
    return false;
  }

  return CRITICAL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function parseDateToMs(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function compareDescByIso(leftIso: string, rightIso: string) {
  return Date.parse(rightIso) - Date.parse(leftIso);
}

function coerceNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function mapStateRow(row: ControlModeStateRow): ControlModeState {
  return {
    project_id: row.project_id,
    org_id: row.org_id,
    enabled: row.enabled === 1,
    updated_by: toOptional(row.updated_by),
    enabled_at: toOptional(row.enabled_at),
    disabled_at: toOptional(row.disabled_at),
    updated_at: row.updated_at
  };
}

function mapChecklistRow(row: ChecklistRow): InspectionChecklist {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    created_by: row.created_by,
    created_at: row.created_at
  };
}

function mapItemRow(row: ItemRow): InspectionItem {
  return {
    id: row.id,
    checklist_id: row.checklist_id,
    key: row.key,
    label: row.label,
    checked: row.checked === 1,
    comment: toOptional(row.comment),
    updated_at: row.updated_at,
    updated_by: toOptional(row.updated_by)
  };
}

function resolveTemplate(): ChecklistTemplateConfig {
  const parsed = checklistTemplateJson as ChecklistTemplate;

  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('Checklist template invalide.');
  }

  const items = parsed.items
    .map((item) => ({
      key: normalizeText(item.key),
      label: normalizeText(item.label)
    }))
    .filter((item) => item.key.length > 0 && item.label.length > 0);

  if (items.length === 0) {
    throw new Error('Checklist template vide.');
  }

  return { items };
}

const checklistTemplate = resolveTemplate();

function requireOrgId() {
  if (!contextOrgId) {
    throw new Error('Contexte manquant: org_id non defini.');
  }

  return contextOrgId;
}

function requireContext() {
  const org_id = requireOrgId();

  if (!contextUserId) {
    throw new Error('Contexte manquant: user_id non defini.');
  }

  return {
    org_id,
    user_id: contextUserId
  } satisfies ControlModeContext;
}

function ensureProjectId(projectId: string) {
  const cleaned = normalizeText(projectId);
  if (cleaned.length === 0) {
    throw new Error('projectId est requis.');
  }
  return cleaned;
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

async function setupSchema() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS ${CONTROL_STATE_TABLE} (
      project_id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      enabled_at TEXT,
      disabled_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_control_mode_state_org
      ON ${CONTROL_STATE_TABLE}(org_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${CHECKLISTS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_inspection_checklists_org_project
      ON ${CHECKLISTS_TABLE}(org_id, project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ITEMS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      checklist_id TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      UNIQUE(checklist_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_inspection_items_checklist
      ON ${ITEMS_TABLE}(checklist_id, updated_at DESC);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }

  return setupPromise;
}

async function listProjectsFromTable(db: SQLite.SQLiteDatabase, tableName: string, orgId: string) {
  const exists = await tableExists(db, tableName);
  if (!exists) {
    return [] as string[];
  }

  const rows = await db.getAllAsync<{ project_id: string | null }>(
    `
      SELECT DISTINCT project_id
      FROM ${tableName}
      WHERE org_id = ?
        AND project_id IS NOT NULL
        AND LENGTH(TRIM(project_id)) > 0
    `,
    orgId
  );

  return rows
    .map((row) => normalizeText(row.project_id))
    .filter((value) => value.length > 0);
}

async function listAllTasksByProject(projectId: string, orgId: string) {
  const all: Task[] = [];
  let offset = 0;

  while (true) {
    const batch = await tasks.listByProject(projectId, {
      org_id: orgId,
      include_deleted: false,
      limit: PAGE_SIZE,
      offset
    });

    all.push(...batch);

    if (batch.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
    await Promise.resolve();
  }

  return all;
}

async function listAllDocumentsByProject(projectId: string, orgId: string) {
  const all = [] as Awaited<ReturnType<typeof documents.list>>;
  let offset = 0;

  while (true) {
    const batch = await documents.list('PROJECT', projectId, {
      org_id: orgId,
      include_deleted: false,
      limit: PAGE_SIZE,
      offset
    });

    all.push(...batch);

    if (batch.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
    await Promise.resolve();
  }

  return all;
}

async function listAllMediaByProject(projectId: string, orgId: string) {
  const list = await media.listByProject(projectId);
  return list.filter((asset) => asset.org_id === orgId);
}

function taskIsCritical(task: Task) {
  if (hasCriticalKeyword(task.title) || hasCriticalKeyword(task.description)) {
    return true;
  }

  return task.tags.some((tag) => hasCriticalKeyword(tag));
}

function mediaIsCritical(asset: MediaAsset, taskById: Map<string, Task>, openPinIds: Set<string>) {
  if (hasCriticalKeyword(asset.tag)) {
    return true;
  }

  if (asset.plan_pin_id && openPinIds.has(asset.plan_pin_id)) {
    return true;
  }

  if (asset.task_id) {
    const linkedTask = taskById.get(asset.task_id);
    if (linkedTask && taskIsCritical(linkedTask)) {
      return true;
    }
  }

  return false;
}

function computeRiskLevel(taskList: Task[], openTasks: number, blockedTasks: number): RiskLevel {
  if (blockedTasks > 0) {
    return 'RISK';
  }

  if (openTasks > WATCH_OPEN_TASK_THRESHOLD) {
    return 'WATCH';
  }

  const hasOpenSafetyTask = taskList.some((task) => task.status !== 'DONE' && taskIsCritical(task));
  if (hasOpenSafetyTask) {
    return 'WATCH';
  }

  return 'OK';
}

function buildRecentActivity(
  taskList: Task[],
  mediaList: MediaAsset[],
  documentList: Array<{ id: string; title: string; updated_at: string }>,
  checklistItems: InspectionItem[]
) {
  const activities: ControlActivity[] = [];

  for (const task of taskList.slice(0, 8)) {
    activities.push({
      id: `task-${task.id}`,
      entity: 'TASK',
      title: task.title,
      subtitle: `Statut ${task.status}`,
      at: task.updated_at
    });
  }

  for (const asset of mediaList.slice(0, 8)) {
    activities.push({
      id: `media-${asset.id}`,
      entity: 'MEDIA',
      title: asset.tag ? `Preuve ${asset.tag}` : 'Preuve media',
      subtitle: asset.task_id ? `Tache ${asset.task_id}` : undefined,
      at: asset.created_at
    });
  }

  for (const document of documentList.slice(0, 8)) {
    activities.push({
      id: `document-${document.id}`,
      entity: 'DOCUMENT',
      title: document.title,
      subtitle: 'Document mis a jour',
      at: document.updated_at
    });
  }

  for (const item of checklistItems.slice(0, 8)) {
    activities.push({
      id: `checklist-${item.id}`,
      entity: 'CHECKLIST',
      title: item.label,
      subtitle: item.checked ? 'Checklist: coche' : 'Checklist: non coche',
      at: item.updated_at
    });
  }

  return activities.sort((left, right) => compareDescByIso(left.at, right.at));
}

async function getStateRow(projectId: string, orgId: string) {
  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<ControlModeStateRow>(
    `
      SELECT *
      FROM ${CONTROL_STATE_TABLE}
      WHERE project_id = ?
        AND org_id = ?
      LIMIT 1
    `,
    projectId,
    orgId
  );

  return row ?? null;
}

async function upsertStateRow(projectId: string, enabled: boolean, actorUserId: string, orgId: string) {
  await ensureSetup();
  const db = await getDb();

  const existing = await getStateRow(projectId, orgId);
  const timestamp = nowIso();

  const next: ControlModeStateRow = {
    project_id: projectId,
    org_id: orgId,
    enabled: enabled ? 1 : 0,
    updated_by: actorUserId,
    enabled_at: enabled ? timestamp : existing?.enabled_at ?? null,
    disabled_at: enabled ? existing?.disabled_at ?? null : timestamp,
    updated_at: timestamp
  };

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${CONTROL_STATE_TABLE}
      (project_id, org_id, enabled, updated_by, enabled_at, disabled_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    next.project_id,
    next.org_id,
    next.enabled,
    next.updated_by,
    next.enabled_at,
    next.disabled_at,
    next.updated_at
  );

  return {
    row: next,
    operationType: existing ? 'UPDATE' : 'CREATE'
  } as const;
}

async function getLatestChecklistRow(projectId: string, orgId: string) {
  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<ChecklistRow>(
    `
      SELECT *
      FROM ${CHECKLISTS_TABLE}
      WHERE org_id = ?
        AND project_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    orgId,
    projectId
  );

  return row ?? null;
}

async function listChecklistItems(checklistId: string) {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<ItemRow>(
    `
      SELECT *
      FROM ${ITEMS_TABLE}
      WHERE checklist_id = ?
      ORDER BY key ASC
    `,
    checklistId
  );

  return rows.map(mapItemRow);
}

async function listChecklistRows(projectId: string, orgId: string, limit: number, offset: number) {
  await ensureSetup();
  const db = await getDb();

  return db.getAllAsync<ChecklistRow>(
    `
      SELECT *
      FROM ${CHECKLISTS_TABLE}
      WHERE org_id = ?
        AND project_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    orgId,
    projectId,
    limit,
    offset
  );
}

async function computeChecklistScores(checklistIds: string[]) {
  if (checklistIds.length === 0) {
    return new Map<string, InspectionScore>();
  }

  await ensureSetup();
  const db = await getDb();

  const placeholders = checklistIds.map(() => '?').join(', ');

  const rows = await db.getAllAsync<{
    checklist_id: string;
    checked_count: number | string | null;
    total_count: number | string | null;
  }>(
    `
      SELECT
        checklist_id,
        SUM(checked) AS checked_count,
        COUNT(*) AS total_count
      FROM ${ITEMS_TABLE}
      WHERE checklist_id IN (${placeholders})
      GROUP BY checklist_id
    `,
    ...checklistIds
  );

  const map = new Map<string, InspectionScore>();

  for (const row of rows) {
    map.set(row.checklist_id, {
      score_checked: coerceNumber(row.checked_count),
      score_total: coerceNumber(row.total_count)
    });
  }

  return map;
}

async function getItemWithChecklist(itemId: string) {
  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<ItemWithChecklistRow>(
    `
      SELECT
        i.id,
        i.checklist_id,
        i.key,
        i.label,
        i.checked,
        i.comment,
        i.updated_at,
        i.updated_by,
        c.org_id,
        c.project_id
      FROM ${ITEMS_TABLE} i
      INNER JOIN ${CHECKLISTS_TABLE} c ON c.id = i.checklist_id
      WHERE i.id = ?
      LIMIT 1
    `,
    itemId
  );

  return row ?? null;
}

async function enqueueStateOperation(state: ControlModeStateRow, type: 'CREATE' | 'UPDATE') {
  await offlineDB.enqueueOperation({
    entity: 'control_mode_state',
    entity_id: state.project_id,
    type,
    payload: {
      id: state.project_id,
      project_id: state.project_id,
      org_id: state.org_id,
      orgId: state.org_id,
      enabled: state.enabled === 1,
      updated_by: state.updated_by,
      enabled_at: state.enabled_at,
      disabled_at: state.disabled_at,
      updated_at: state.updated_at
    }
  });
}

async function enqueueChecklistOperation(checklist: InspectionChecklist, type: 'CREATE' | 'UPDATE') {
  await offlineDB.enqueueOperation({
    entity: 'inspection_checklists',
    entity_id: checklist.id,
    type,
    payload: {
      ...checklist,
      org_id: checklist.org_id,
      orgId: checklist.org_id,
      project_id: checklist.project_id
    }
  });
}

async function enqueueChecklistItemOperation(
  item: InspectionItem,
  checklist: InspectionChecklist,
  type: 'CREATE' | 'UPDATE'
) {
  await offlineDB.enqueueOperation({
    entity: 'inspection_items',
    entity_id: item.id,
    type,
    payload: {
      ...item,
      org_id: checklist.org_id,
      orgId: checklist.org_id,
      project_id: checklist.project_id
    }
  });
}

export const controlMode: ControlModeApi = {
  setContext(context: Partial<ControlModeContext>) {
    contextOrgId = normalizeText(context.org_id) || null;
    contextUserId = normalizeText(context.user_id) || null;
  },

  setActor(userId: string | null) {
    contextUserId = normalizeText(userId) || null;
  },

  setOrg(orgId: string | null) {
    contextOrgId = normalizeText(orgId) || null;
  },

  async listProjects() {
    const orgId = requireOrgId();
    await ensureSetup();

    const db = await getDb();
    const projectSet = new Set<string>();

    const tables = [
      CONTROL_STATE_TABLE,
      CHECKLISTS_TABLE,
      TASKS_TABLE,
      DOCUMENTS_TABLE,
      MEDIA_TABLE
    ];

    for (const tableName of tables) {
      const ids = await listProjectsFromTable(db, tableName, orgId);
      ids.forEach((id) => projectSet.add(id));
    }

    return Array.from(projectSet).sort((left, right) => left.localeCompare(right));
  },

  async enable(projectId: string) {
    const context = requireContext();
    const safeProjectId = ensureProjectId(projectId);

    const { row, operationType } = await upsertStateRow(
      safeProjectId,
      true,
      context.user_id,
      context.org_id
    );

    await enqueueStateOperation(row, operationType);
  },

  async disable(projectId: string) {
    const context = requireContext();
    const safeProjectId = ensureProjectId(projectId);

    const { row, operationType } = await upsertStateRow(
      safeProjectId,
      false,
      context.user_id,
      context.org_id
    );

    await enqueueStateOperation(row, operationType);
  },

  async isEnabled(projectId: string) {
    const orgId = requireOrgId();
    const safeProjectId = ensureProjectId(projectId);

    const row = await getStateRow(safeProjectId, orgId);
    return row?.enabled === 1;
  },

  async getState(projectId: string) {
    const orgId = requireOrgId();
    const safeProjectId = ensureProjectId(projectId);
    const row = await getStateRow(safeProjectId, orgId);
    return row ? mapStateRow(row) : null;
  },

  async getSummary(projectId: string): Promise<ControlSummary> {
    const orgId = requireOrgId();
    const safeProjectId = ensureProjectId(projectId);

    const [taskList, mediaList, documentList] = await Promise.all([
      listAllTasksByProject(safeProjectId, orgId),
      listAllMediaByProject(safeProjectId, orgId),
      listAllDocumentsByProject(safeProjectId, orgId)
    ]);

    const openTasks = taskList.filter((task) => task.status === 'TODO' || task.status === 'DOING').length;
    const blockedTasks = taskList.filter((task) => task.status === 'BLOCKED').length;
    const openSafetyTasks = taskList.filter((task) => task.status !== 'DONE' && taskIsCritical(task)).length;

    const pendingUploads = mediaList.filter(
      (asset) => asset.upload_status === 'PENDING' || asset.upload_status === 'UPLOADING'
    ).length;
    const failedUploads = mediaList.filter((asset) => asset.upload_status === 'FAILED').length;

    return {
      blockedTasks,
      openSafetyTasks,
      failedUploads,
      pendingUploads,
      docsCount: documentList.length,
      riskLevel: computeRiskLevel(taskList, openTasks, blockedTasks)
    };
  },

  async listCriticalProofs(projectId: string, filters: ControlProofFilters = {}) {
    const orgId = requireOrgId();
    const safeProjectId = ensureProjectId(projectId);

    const [taskList, mediaList] = await Promise.all([
      listAllTasksByProject(safeProjectId, orgId),
      listAllMediaByProject(safeProjectId, orgId)
    ]);

    const taskById = new Map(taskList.map((task) => [task.id, task]));
    const openPinIds = new Set<string>();

    try {
      plans.setOrg(orgId);
      const pins = await plans.listPinsByProject(safeProjectId, { status: 'OPEN', limit: 1000, offset: 0 });
      for (const pin of pins) {
        openPinIds.add(pin.id);
      }
    } catch {
      // ignore: plans module/table not available
    }

    const safeTag = normalizeText(filters.tag).toLowerCase();
    const safeTaskId = normalizeText(filters.task_id);
    const fromMs = parseDateToMs(filters.from_date);
    const toMs = parseDateToMs(filters.to_date);
    const criticalOnly = filters.critical_only !== false;
    const limit = Math.max(1, Math.min(filters.limit ?? 120, 500));
    const offset = Math.max(0, filters.offset ?? 0);

    const filtered = mediaList.filter((asset) => {
      if (safeTaskId && asset.task_id !== safeTaskId) {
        return false;
      }

      if (safeTag.length > 0) {
        const assetTag = normalizeKeyword(asset.tag);
        if (!assetTag.includes(safeTag)) {
          return false;
        }
      }

      const createdAtMs = Date.parse(asset.created_at);
      if (Number.isFinite(createdAtMs)) {
        if (fromMs !== null && createdAtMs < fromMs) {
          return false;
        }

        if (toMs !== null && createdAtMs > toMs) {
          return false;
        }
      }

      if (!criticalOnly) {
        return true;
      }

      return mediaIsCritical(asset, taskById, openPinIds);
    });

    const sorted = filtered.sort((left, right) => compareDescByIso(left.created_at, right.created_at));
    return sorted.slice(offset, offset + limit);
  },

  async listOpenIssues(projectId: string) {
    const orgId = requireOrgId();
    const safeProjectId = ensureProjectId(projectId);

    const taskList = await listAllTasksByProject(safeProjectId, orgId);

    return taskList
      .filter((task) => task.status !== 'DONE')
      .sort((left, right) => {
        const leftRank = left.status === 'BLOCKED' ? 0 : 1;
        const rightRank = right.status === 'BLOCKED' ? 0 : 1;

        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return compareDescByIso(left.updated_at, right.updated_at);
      });
  },

  async getRecentActivity(projectId: string, limit = 8) {
    const orgId = requireOrgId();
    const safeProjectId = ensureProjectId(projectId);
    const safeLimit = Math.max(1, Math.min(limit, 50));

    const [taskList, mediaList, documentList] = await Promise.all([
      listAllTasksByProject(safeProjectId, orgId),
      listAllMediaByProject(safeProjectId, orgId),
      listAllDocumentsByProject(safeProjectId, orgId)
    ]);

    const latestChecklist = await this.getLatestChecklist(safeProjectId);
    const activities = buildRecentActivity(taskList, mediaList, documentList, latestChecklist.items);

    return activities.slice(0, safeLimit);
  },

  async createChecklist(projectId: string) {
    const context = requireContext();
    const safeProjectId = ensureProjectId(projectId);

    await ensureSetup();
    const db = await getDb();

    const checklist: InspectionChecklist = {
      id: createUuid(),
      org_id: context.org_id,
      project_id: safeProjectId,
      created_by: context.user_id,
      created_at: nowIso()
    };

    await db.runAsync(
      `
        INSERT INTO ${CHECKLISTS_TABLE}
        (id, org_id, project_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      checklist.id,
      checklist.org_id,
      checklist.project_id,
      checklist.created_by,
      checklist.created_at
    );

    const itemTimestamp = nowIso();

    for (const templateItem of checklistTemplate.items) {
      await db.runAsync(
        `
          INSERT INTO ${ITEMS_TABLE}
          (id, checklist_id, key, label, checked, comment, updated_at, updated_by)
          VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
        `,
        createUuid(),
        checklist.id,
        templateItem.key,
        templateItem.label,
        itemTimestamp,
        context.user_id
      );
    }

    await enqueueChecklistOperation(checklist, 'CREATE');

    const items = await listChecklistItems(checklist.id);
    for (const item of items) {
      await enqueueChecklistItemOperation(item, checklist, 'CREATE');
    }

    return checklist;
  },

  async getLatestChecklist(projectId: string): Promise<ChecklistWithItems> {
    const orgId = requireOrgId();
    const safeProjectId = ensureProjectId(projectId);

    let checklistRow = await getLatestChecklistRow(safeProjectId, orgId);
    if (!checklistRow) {
      await this.createChecklist(safeProjectId);
      checklistRow = await getLatestChecklistRow(safeProjectId, orgId);
    }

    if (!checklistRow) {
      throw new Error('Impossible de recuperer la checklist inspection.');
    }

    const checklist = mapChecklistRow(checklistRow);
    const items = await listChecklistItems(checklist.id);

    return {
      checklist,
      items
    };
  },

  async listInspections(projectId: string, options: { limit?: number; offset?: number } = {}) {
    const orgId = requireOrgId();
    const safeProjectId = ensureProjectId(projectId);

    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));

    const rows = await listChecklistRows(safeProjectId, orgId, limit, offset);
    if (rows.length === 0) {
      return [] as InspectionSummary[];
    }

    const ids = rows.map((row) => row.id);
    const scores = await computeChecklistScores(ids);

    return rows.map((row) => {
      const checklist = mapChecklistRow(row);
      const score = scores.get(checklist.id) ?? { score_checked: 0, score_total: 0 };
      return {
        ...checklist,
        score_checked: score.score_checked,
        score_total: score.score_total
      };
    });
  },

  async computeScore(checklistId: string) {
    const safeId = normalizeText(checklistId);
    if (safeId.length === 0) {
      throw new Error('checklistId est requis.');
    }

    const scores = await computeChecklistScores([safeId]);
    return scores.get(safeId) ?? { score_checked: 0, score_total: 0 };
  },

  async toggleItem(itemId: string, checked: boolean) {
    const context = requireContext();
    const safeItemId = normalizeText(itemId);
    if (safeItemId.length === 0) {
      throw new Error('itemId est requis.');
    }

    const currentRow = await getItemWithChecklist(safeItemId);
    if (!currentRow) {
      throw new Error('Checklist item introuvable.');
    }

    if (currentRow.org_id !== context.org_id) {
      throw new Error('Acces refuse: item hors organisation active.');
    }

    await ensureSetup();
    const db = await getDb();

    const updatedAt = nowIso();

    await db.runAsync(
      `
        UPDATE ${ITEMS_TABLE}
        SET checked = ?,
            updated_at = ?,
            updated_by = ?
        WHERE id = ?
      `,
      checked ? 1 : 0,
      updatedAt,
      context.user_id,
      safeItemId
    );

    const updatedRow = await getItemWithChecklist(safeItemId);
    if (!updatedRow) {
      throw new Error('Checklist item introuvable apres mise a jour.');
    }

    const checklist: InspectionChecklist = {
      id: updatedRow.checklist_id,
      org_id: updatedRow.org_id,
      project_id: updatedRow.project_id,
      created_by: context.user_id,
      created_at: updatedAt
    };

    await enqueueChecklistItemOperation(mapItemRow(updatedRow), checklist, 'UPDATE');
  },

  async setComment(itemId: string, text: string) {
    const context = requireContext();
    const safeItemId = normalizeText(itemId);
    if (safeItemId.length === 0) {
      throw new Error('itemId est requis.');
    }

    const currentRow = await getItemWithChecklist(safeItemId);
    if (!currentRow) {
      throw new Error('Checklist item introuvable.');
    }

    if (currentRow.org_id !== context.org_id) {
      throw new Error('Acces refuse: item hors organisation active.');
    }

    await ensureSetup();
    const db = await getDb();

    const updatedAt = nowIso();
    const comment = normalizeText(text);

    await db.runAsync(
      `
        UPDATE ${ITEMS_TABLE}
        SET comment = ?,
            updated_at = ?,
            updated_by = ?
        WHERE id = ?
      `,
      comment.length > 0 ? comment : null,
      updatedAt,
      context.user_id,
      safeItemId
    );

    const updatedRow = await getItemWithChecklist(safeItemId);
    if (!updatedRow) {
      throw new Error('Checklist item introuvable apres mise a jour.');
    }

    const checklist: InspectionChecklist = {
      id: updatedRow.checklist_id,
      org_id: updatedRow.org_id,
      project_id: updatedRow.project_id,
      created_by: context.user_id,
      created_at: updatedAt
    };

    await enqueueChecklistItemOperation(mapItemRow(updatedRow), checklist, 'UPDATE');
  },

  async getChecklistTemplate() {
    return checklistTemplate;
  },

  async generateControlPack(projectId: string): Promise<ExportJob> {
    const context = requireContext();
    const safeProjectId = ensureProjectId(projectId);

    exportsDoe.setContext(context);

    const job = await exportsDoe.createJob(safeProjectId, 'CONTROL_PACK');
    void exportsDoe.run(job.id);

    return job;
  },

  async createInspection(projectId: string) {
    return this.createChecklist(projectId);
  },

  async getLatestInspection(projectId: string) {
    return this.getLatestChecklist(projectId);
  }
};
