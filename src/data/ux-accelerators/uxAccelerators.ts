import * as SQLite from 'expo-sqlite';
import { AppRole } from '../../core/identity-security';
import { controlMode } from '../control-mode';
import { ExportType, exportsDoe } from '../exports';
import { media } from '../media';
import { TaskPriority, TaskStatus, tasks } from '../tasks';
import {
  FavoriteRecord,
  QuickAction,
  QuickActionKey,
  RecentRecord,
  TemplateApplyResult,
  TemplatePayload,
  TemplateRecord,
  TemplateType,
  TemplatesApi,
  UxApi,
  UxContext,
  UxEntity
} from './types';

const DB_NAME = 'conformeo.db';

const FAVORITES_TABLE = 'user_favorites';
const RECENTS_TABLE = 'user_recents';
const TEMPLATES_TABLE = 'templates';

const TASKS_TABLE = 'tasks';
const DOCUMENTS_TABLE = 'documents';
const MEDIA_TABLE = 'media_assets';
const EXPORTS_TABLE = 'export_jobs';

const DEFAULT_RECENTS_LIMIT = 20;
const MAX_RECENTS_LIMIT = 100;
const DEFAULT_PROJECT_ID = 'chantier-conformeo-demo';

const ENTITY_VALUES: UxEntity[] = ['PROJECT', 'TASK', 'DOCUMENT', 'MEDIA', 'EXPORT', 'CHECKLIST', 'TEMPLATE'];
const TEMPLATE_TYPES: TemplateType[] = ['TASK', 'CHECKLIST', 'EXPORT'];
const TASK_STATUSES: TaskStatus[] = ['TODO', 'DOING', 'DONE', 'BLOCKED'];
const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];
const EXPORT_TYPES: ExportType[] = ['REPORT_PDF', 'CONTROL_PACK', 'DOE_ZIP'];

const QUICK_ACTION_CATALOG: Record<QuickActionKey, QuickAction> = {
  NEW_TASK: {
    key: 'NEW_TASK',
    label: 'Nouvelle tâche',
    hint: 'Créer une tâche terrain en 1 tap.',
    module: 'tasks',
    requires_project: true,
    max_taps: 3,
    order: 10
  },
  ADD_PROOF: {
    key: 'ADD_PROOF',
    label: 'Photo preuve',
    hint: 'Capture optimisée + offline.',
    module: 'media',
    requires_project: true,
    max_taps: 3,
    order: 20
  },
  GENERATE_REPORT: {
    key: 'GENERATE_REPORT',
    label: 'Rapport chantier',
    hint: 'Lancer export PDF local.',
    module: 'exports',
    requires_project: true,
    max_taps: 3,
    order: 30
  },
  GENERATE_CONTROL_PACK: {
    key: 'GENERATE_CONTROL_PACK',
    label: 'Pack contrôle',
    hint: 'Exporter un pack inspection.',
    module: 'control',
    requires_project: true,
    max_taps: 3,
    order: 40
  },
  CREATE_CHECKLIST: {
    key: 'CREATE_CHECKLIST',
    label: 'Checklist inspection',
    hint: 'Créer une checklist contrôle.',
    module: 'control',
    requires_project: true,
    max_taps: 3,
    order: 50
  }
};

const QUICK_ACTIONS_BY_ROLE: Record<AppRole, QuickActionKey[]> = {
  ADMIN: ['NEW_TASK', 'ADD_PROOF', 'GENERATE_REPORT', 'GENERATE_CONTROL_PACK', 'CREATE_CHECKLIST'],
  MANAGER: ['NEW_TASK', 'ADD_PROOF', 'GENERATE_REPORT', 'GENERATE_CONTROL_PACK', 'CREATE_CHECKLIST'],
  FIELD: ['NEW_TASK', 'ADD_PROOF', 'GENERATE_REPORT', 'CREATE_CHECKLIST']
};

type FavoriteRow = {
  user_id: string;
  org_id: string;
  entity: UxEntity;
  entity_id: string;
  created_at: string;
};

type RecentRow = {
  user_id: string;
  org_id: string;
  entity: UxEntity;
  entity_id: string;
  last_opened_at: string;
};

type TemplateRow = {
  id: string;
  org_id: string;
  type: TemplateType;
  template_key: string;
  version: number;
  name: string;
  payload_json: string;
  created_by: string;
  created_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;
let contextProjectId: string | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSlug(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    return {} as Record<string, unknown>;
  }

  return {} as Record<string, unknown>;
}

function ensureTemplatePayload(payload: TemplatePayload) {
  if (!isRecord(payload)) {
    throw new Error('payload template invalide.');
  }

  return payload;
}

function isUxEntity(value: string): value is UxEntity {
  return ENTITY_VALUES.includes(value as UxEntity);
}

function ensureEntity(entity: UxEntity) {
  if (!isUxEntity(entity)) {
    throw new Error(`Entité UX invalide: ${entity}`);
  }

  return entity;
}

function isTemplateType(value: string): value is TemplateType {
  return TEMPLATE_TYPES.includes(value as TemplateType);
}

function ensureTemplateType(type: string): TemplateType {
  if (!isTemplateType(type)) {
    throw new Error(`Type de template invalide: ${type}`);
  }

  return type;
}

function normalizeRole(role?: AppRole | null): AppRole {
  if (!role) {
    return 'FIELD';
  }

  return role;
}

function ensureTaskStatus(value: unknown): TaskStatus {
  if (typeof value !== 'string') {
    return 'TODO';
  }

  return TASK_STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : 'TODO';
}

function ensureTaskPriority(value: unknown): TaskPriority {
  if (typeof value !== 'string') {
    return 'MEDIUM';
  }

  return TASK_PRIORITIES.includes(value as TaskPriority) ? (value as TaskPriority) : 'MEDIUM';
}

function ensureExportType(value: unknown): ExportType {
  if (typeof value !== 'string') {
    return 'REPORT_PDF';
  }

  return EXPORT_TYPES.includes(value as ExportType) ? (value as ExportType) : 'REPORT_PDF';
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function parseCommentsMap(value: unknown) {
  if (!isRecord(value)) {
    return {} as Record<string, string>;
  }

  const entries = Object.entries(value)
    .map(([key, val]) => [normalizeText(key), normalizeText(typeof val === 'string' ? val : '')] as const)
    .filter(([key, val]) => key.length > 0 && val.length > 0);

  return Object.fromEntries(entries);
}

function resolveProjectId(projectIdCandidate?: string) {
  const direct = normalizeText(projectIdCandidate);
  if (direct.length > 0) {
    return direct;
  }

  const fromContext = normalizeText(contextProjectId);
  if (fromContext.length > 0) {
    return fromContext;
  }

  return DEFAULT_PROJECT_ID;
}

function requireContext() {
  const org_id = normalizeText(contextOrgId);
  const user_id = normalizeText(contextUserId);

  if (org_id.length === 0) {
    throw new Error('Contexte manquant: org_id.');
  }

  if (user_id.length === 0) {
    throw new Error('Contexte manquant: user_id.');
  }

  return {
    org_id,
    user_id,
    project_id: normalizeText(contextProjectId) || undefined
  } satisfies UxContext;
}

function mapFavoriteRow(row: FavoriteRow): FavoriteRecord {
  return {
    user_id: row.user_id,
    org_id: row.org_id,
    entity: row.entity,
    entity_id: row.entity_id,
    created_at: row.created_at
  };
}

function mapRecentRow(row: RecentRow): RecentRecord {
  return {
    user_id: row.user_id,
    org_id: row.org_id,
    entity: row.entity,
    entity_id: row.entity_id,
    last_opened_at: row.last_opened_at
  };
}

function mapTemplateRow(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    type: row.type,
    template_key: row.template_key,
    version: row.version,
    name: row.name,
    payload_json: parseJsonObject(row.payload_json),
    created_by: row.created_by,
    created_at: row.created_at
  };
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

    CREATE TABLE IF NOT EXISTS ${FAVORITES_TABLE} (
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      entity TEXT NOT NULL CHECK (entity IN ('PROJECT', 'TASK', 'DOCUMENT', 'MEDIA', 'EXPORT', 'CHECKLIST', 'TEMPLATE')),
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, org_id, entity, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_favorites_org_created
      ON ${FAVORITES_TABLE}(org_id, user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${RECENTS_TABLE} (
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      entity TEXT NOT NULL CHECK (entity IN ('PROJECT', 'TASK', 'DOCUMENT', 'MEDIA', 'EXPORT', 'CHECKLIST', 'TEMPLATE')),
      entity_id TEXT NOT NULL,
      last_opened_at TEXT NOT NULL,
      PRIMARY KEY (user_id, org_id, entity, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_recents_org_seen
      ON ${RECENTS_TABLE}(org_id, user_id, last_opened_at DESC);

    CREATE TABLE IF NOT EXISTS ${TEMPLATES_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('TASK', 'CHECKLIST', 'EXPORT')),
      template_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(org_id, type, template_key, version)
    );

    CREATE INDEX IF NOT EXISTS idx_templates_org_type_created
      ON ${TEMPLATES_TABLE}(org_id, type, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_templates_org_type_key_version
      ON ${TEMPLATES_TABLE}(org_id, type, template_key, version DESC);
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

async function trackRecentInternal(entity: UxEntity, id: string): Promise<RecentRecord> {
  await ensureSetup();
  const context = requireContext();

  const safeEntity = ensureEntity(entity);
  const entityId = normalizeText(id);
  if (entityId.length === 0) {
    throw new Error('entity_id requis.');
  }

  const lastOpenedAt = nowIso();

  const db = await getDb();
  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${RECENTS_TABLE}
      (user_id, org_id, entity, entity_id, last_opened_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    context.user_id,
    context.org_id,
    safeEntity,
    entityId,
    lastOpenedAt
  );

  return {
    user_id: context.user_id,
    org_id: context.org_id,
    entity: safeEntity,
    entity_id: entityId,
    last_opened_at: lastOpenedAt
  };
}

async function getTemplateById(type: TemplateType, templateId: string) {
  await ensureSetup();
  const context = requireContext();
  const db = await getDb();

  const row = await db.getFirstAsync<TemplateRow>(
    `
      SELECT id, org_id, type, template_key, version, name, payload_json, created_by, created_at
      FROM ${TEMPLATES_TABLE}
      WHERE id = ?
        AND org_id = ?
        AND type = ?
      LIMIT 1
    `,
    templateId,
    context.org_id,
    type
  );

  if (!row) {
    throw new Error('Template introuvable.');
  }

  return mapTemplateRow(row);
}

async function applyTaskTemplate(template: TemplateRecord): Promise<TemplateApplyResult> {
  const context = requireContext();
  const payload = ensureTemplatePayload(template.payload_json) as Record<string, unknown>;

  const projectId = resolveProjectId(typeof payload['project_id'] === 'string' ? payload['project_id'] : undefined);
  const title = normalizeText(typeof payload['title'] === 'string' ? payload['title'] : template.name) || template.name;

  tasks.setActor(context.user_id);

  const created = await tasks.create({
    org_id: context.org_id,
    project_id: projectId,
    title,
    description: normalizeText(typeof payload['description'] === 'string' ? payload['description'] : ''),
    status: ensureTaskStatus(payload['status']),
    priority: ensureTaskPriority(payload['priority']),
    tags: parseStringArray(payload['tags']),
    created_by: context.user_id
  });

  if (payload['with_photo'] === true) {
    try {
      await tasks.addMedia(created.id, {
        org_id: context.org_id,
        project_id: projectId,
        source: 'capture',
        tag: normalizeText(typeof payload['media_tag'] === 'string' ? payload['media_tag'] : '') || 'preuve_template'
      });
    } catch {
      // Non bloquant: la tâche reste créée même si l'utilisateur annule la capture.
    }
  }

  await trackRecentInternal('TASK', created.id);

  return {
    type: 'TASK',
    template_id: template.id,
    template_version: template.version,
    created_entity: 'TASK',
    entity_id: created.id,
    message: 'Tâche créée à partir du template.'
  };
}

async function applyChecklistTemplate(template: TemplateRecord): Promise<TemplateApplyResult> {
  const context = requireContext();
  const payload = ensureTemplatePayload(template.payload_json) as Record<string, unknown>;

  const projectId = resolveProjectId(typeof payload['project_id'] === 'string' ? payload['project_id'] : undefined);

  controlMode.setContext({
    org_id: context.org_id,
    user_id: context.user_id
  });

  const checklist = await controlMode.createChecklist(projectId);

  const checkedKeys = new Set(parseStringArray(payload['checked_keys']));
  const commentsByKey = parseCommentsMap(payload['comments_by_key']);

  if (checkedKeys.size > 0 || Object.keys(commentsByKey).length > 0) {
    const latest = await controlMode.getLatestChecklist(projectId);

    if (latest.checklist.id === checklist.id) {
      for (const item of latest.items) {
        if (checkedKeys.has(item.key) && !item.checked) {
          await controlMode.toggleItem(item.id, true);
        }

        const comment = commentsByKey[item.key];
        if (comment) {
          await controlMode.setComment(item.id, comment);
        }
      }
    }
  }

  await trackRecentInternal('CHECKLIST', checklist.id);

  return {
    type: 'CHECKLIST',
    template_id: template.id,
    template_version: template.version,
    created_entity: 'CHECKLIST',
    entity_id: checklist.id,
    message: 'Checklist inspection créée à partir du template.'
  };
}

async function applyExportTemplate(template: TemplateRecord): Promise<TemplateApplyResult> {
  const context = requireContext();
  const payload = ensureTemplatePayload(template.payload_json) as Record<string, unknown>;

  const projectId = resolveProjectId(typeof payload['project_id'] === 'string' ? payload['project_id'] : undefined);
  const exportType = ensureExportType(payload.export_type);

  exportsDoe.setContext({
    org_id: context.org_id,
    user_id: context.user_id
  });

  const job = await exportsDoe.createJob(projectId, exportType);
  void exportsDoe.run(job.id);

  await trackRecentInternal('EXPORT', job.id);

  return {
    type: 'EXPORT',
    template_id: template.id,
    template_version: template.version,
    created_entity: 'EXPORT_JOB',
    entity_id: job.id,
    message: 'Export lancé à partir du template.'
  };
}

export const ux: UxApi = {
  setContext(context: Partial<UxContext>) {
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

  async listProjects() {
    await ensureSetup();
    const context = requireContext();
    const db = await getDb();

    const [taskProjects, documentProjects, mediaProjects, exportProjects] = await Promise.all([
      listProjectsFromTable(db, TASKS_TABLE, context.org_id),
      listProjectsFromTable(db, DOCUMENTS_TABLE, context.org_id),
      listProjectsFromTable(db, MEDIA_TABLE, context.org_id),
      listProjectsFromTable(db, EXPORTS_TABLE, context.org_id)
    ]);

    return Array.from(new Set([...taskProjects, ...documentProjects, ...mediaProjects, ...exportProjects])).sort((left, right) =>
      left.localeCompare(right)
    );
  },

  async getQuickActions(role?: AppRole | null) {
    const normalizedRole = normalizeRole(role);
    const keys = QUICK_ACTIONS_BY_ROLE[normalizedRole] ?? QUICK_ACTIONS_BY_ROLE.FIELD;

    return keys
      .map((key) => QUICK_ACTION_CATALOG[key])
      .filter((item): item is QuickAction => Boolean(item))
      .sort((left, right) => left.order - right.order);
  },

  async addFavorite(entity: UxEntity, id: string) {
    await ensureSetup();
    const context = requireContext();

    const safeEntity = ensureEntity(entity);
    const entityId = normalizeText(id);
    if (entityId.length === 0) {
      throw new Error('entity_id requis.');
    }

    const createdAt = nowIso();

    const db = await getDb();
    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${FAVORITES_TABLE}
        (user_id, org_id, entity, entity_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      context.user_id,
      context.org_id,
      safeEntity,
      entityId,
      createdAt
    );

    return {
      user_id: context.user_id,
      org_id: context.org_id,
      entity: safeEntity,
      entity_id: entityId,
      created_at: createdAt
    };
  },

  async removeFavorite(entity: UxEntity, id: string) {
    await ensureSetup();
    const context = requireContext();

    const safeEntity = ensureEntity(entity);
    const entityId = normalizeText(id);
    if (entityId.length === 0) {
      return;
    }

    const db = await getDb();
    await db.runAsync(
      `
        DELETE FROM ${FAVORITES_TABLE}
        WHERE user_id = ?
          AND org_id = ?
          AND entity = ?
          AND entity_id = ?
      `,
      context.user_id,
      context.org_id,
      safeEntity,
      entityId
    );
  },

  async listFavorites() {
    await ensureSetup();
    const context = requireContext();
    const db = await getDb();

    const rows = await db.getAllAsync<FavoriteRow>(
      `
        SELECT user_id, org_id, entity, entity_id, created_at
        FROM ${FAVORITES_TABLE}
        WHERE user_id = ?
          AND org_id = ?
        ORDER BY created_at DESC
        LIMIT 200
      `,
      context.user_id,
      context.org_id
    );

    return rows.map(mapFavoriteRow);
  },

  async trackRecent(entity: UxEntity, id: string) {
    return trackRecentInternal(entity, id);
  },

  async listRecents(limit = DEFAULT_RECENTS_LIMIT) {
    await ensureSetup();
    const context = requireContext();
    const db = await getDb();

    const safeLimit = Math.max(1, Math.min(MAX_RECENTS_LIMIT, Math.floor(limit)));

    const rows = await db.getAllAsync<RecentRow>(
      `
        SELECT user_id, org_id, entity, entity_id, last_opened_at
        FROM ${RECENTS_TABLE}
        WHERE user_id = ?
          AND org_id = ?
        ORDER BY last_opened_at DESC
        LIMIT ?
      `,
      context.user_id,
      context.org_id,
      safeLimit
    );

    return rows.map(mapRecentRow);
  }
};

export const templates: TemplatesApi = {
  async create(type: TemplateType, payload: TemplatePayload) {
    await ensureSetup();

    const context = requireContext();
    const safeType = ensureTemplateType(type);
    const safePayload = ensureTemplatePayload(payload);

    const name = normalizeText(typeof safePayload.name === 'string' ? safePayload.name : '') || `${safeType} template`;

    const rawTemplateKey = normalizeText(typeof safePayload.template_key === 'string' ? safePayload.template_key : '');
    const baseTemplateKey = rawTemplateKey.length > 0 ? rawTemplateKey : normalizeSlug(name);
    const templateKey = baseTemplateKey.length > 0 ? baseTemplateKey : `${safeType.toLowerCase()}-template`;

    const db = await getDb();

    const row = await db.getFirstAsync<{ max_version: number | null }>(
      `
        SELECT MAX(version) AS max_version
        FROM ${TEMPLATES_TABLE}
        WHERE org_id = ?
          AND type = ?
          AND template_key = ?
      `,
      context.org_id,
      safeType,
      templateKey
    );

    const nextVersion = (row?.max_version ?? 0) + 1;
    const createdAt = nowIso();

    const record: TemplateRecord = {
      id: createUuid(),
      org_id: context.org_id,
      type: safeType,
      template_key: templateKey,
      version: nextVersion,
      name,
      payload_json: safePayload,
      created_by: context.user_id,
      created_at: createdAt
    };

    await db.runAsync(
      `
        INSERT INTO ${TEMPLATES_TABLE}
        (id, org_id, type, template_key, version, name, payload_json, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      record.id,
      record.org_id,
      record.type,
      record.template_key,
      record.version,
      record.name,
      JSON.stringify(record.payload_json),
      record.created_by,
      record.created_at
    );

    await trackRecentInternal('TEMPLATE', record.id);

    return record;
  },

  async list(type?: TemplateType) {
    await ensureSetup();
    const context = requireContext();
    const db = await getDb();

    const whereParts = ['org_id = ?'];
    const params: Array<string> = [context.org_id];

    if (type) {
      const safeType = ensureTemplateType(type);
      whereParts.push('type = ?');
      params.push(safeType);
    }

    const rows = await db.getAllAsync<TemplateRow>(
      `
        SELECT id, org_id, type, template_key, version, name, payload_json, created_by, created_at
        FROM ${TEMPLATES_TABLE}
        WHERE ${whereParts.join(' AND ')}
        ORDER BY created_at DESC
      `,
      ...params
    );

    return rows.map(mapTemplateRow);
  },

  async apply(type: TemplateType, templateId: string) {
    const safeType = ensureTemplateType(type);
    const cleanTemplateId = normalizeText(templateId);
    if (cleanTemplateId.length === 0) {
      throw new Error('templateId requis.');
    }

    const template = await getTemplateById(safeType, cleanTemplateId);

    if (safeType === 'TASK') {
      return applyTaskTemplate(template);
    }

    if (safeType === 'CHECKLIST') {
      return applyChecklistTemplate(template);
    }

    return applyExportTemplate(template);
  }
};

export async function applyQuickAction(
  actionKey: QuickActionKey,
  options: {
    projectId?: string;
    taskTitle?: string;
    proofTag?: string;
  } = {}
) {
  const context = requireContext();
  const projectId = resolveProjectId(options.projectId);

  tasks.setActor(context.user_id);
  exportsDoe.setContext({ org_id: context.org_id, user_id: context.user_id });
  controlMode.setContext({ org_id: context.org_id, user_id: context.user_id });

  if (actionKey === 'NEW_TASK') {
    const title = normalizeText(options.taskTitle) || `Action rapide ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

    const created = await tasks.create({
      org_id: context.org_id,
      project_id: projectId,
      title,
      created_by: context.user_id,
      status: 'TODO',
      priority: 'MEDIUM',
      tags: ['quick_action']
    });

    await trackRecentInternal('TASK', created.id);
    return { entity: 'TASK' as const, id: created.id, message: 'Tâche rapide créée.' };
  }

  if (actionKey === 'ADD_PROOF') {
    const asset = await media.capturePhoto({
      org_id: context.org_id,
      project_id: projectId,
      tag: normalizeText(options.proofTag) || 'preuve_rapide'
    });

    await trackRecentInternal('MEDIA', asset.id);
    return { entity: 'MEDIA' as const, id: asset.id, message: 'Preuve ajoutée.' };
  }

  if (actionKey === 'GENERATE_CONTROL_PACK') {
    const job = await exportsDoe.createJob(projectId, 'CONTROL_PACK');
    void exportsDoe.run(job.id);
    await trackRecentInternal('EXPORT', job.id);
    return { entity: 'EXPORT' as const, id: job.id, message: 'Pack contrôle lancé.' };
  }

  if (actionKey === 'CREATE_CHECKLIST') {
    const checklist = await controlMode.createChecklist(projectId);
    await trackRecentInternal('CHECKLIST', checklist.id);
    return { entity: 'CHECKLIST' as const, id: checklist.id, message: 'Checklist inspection créée.' };
  }

  const job = await exportsDoe.createJob(projectId, 'REPORT_PDF');
  void exportsDoe.run(job.id);
  await trackRecentInternal('EXPORT', job.id);
  return { entity: 'EXPORT' as const, id: job.id, message: 'Rapport chantier lancé.' };
}
