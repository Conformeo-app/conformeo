import * as SQLite from 'expo-sqlite';
import { MediaAsset, media } from '../media';
import { offlineDB } from '../offline/outbox';
import { evaluateKeywordRules } from './rules';
import {
  Task,
  TaskComment,
  TaskCreateInput,
  TaskFilters,
  TaskMediaContext,
  TaskPriority,
  TaskStatus,
  TaskSuggestion,
  TaskUpdatePatch
} from './types';

const DB_NAME = 'conformeo.db';
const TASKS_TABLE = 'tasks';
const COMMENTS_TABLE = 'task_comments';
const MAX_TASKS_PER_ORG = 5000;
const DEFAULT_PAGE_SIZE = 25;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;
let actorUserId: string | null = null;

type TaskRow = {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee_user_id: string | null;
  created_by: string;
  tags_json: string;
  suggestions_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  last_transcript: string | null;
};

type CommentRow = {
  id: string;
  task_id: string;
  text: string;
  created_by: string;
  created_at: string;
};

function nowIso() {
  return new Date().toISOString();
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

function normalizeText(value: string | undefined | null) {
  return typeof value === 'string' ? value.trim() : '';
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

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    due_date: row.due_date ?? undefined,
    assignee_user_id: row.assignee_user_id ?? undefined,
    created_by: row.created_by,
    tags: parseJsonArray<string>(row.tags_json, []),
    suggestions: parseJsonArray<TaskSuggestion>(row.suggestions_json, []),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
    last_transcript: row.last_transcript ?? undefined
  };
}

function mapCommentRow(row: CommentRow): TaskComment {
  return {
    id: row.id,
    task_id: row.task_id,
    text: row.text,
    created_by: row.created_by,
    created_at: row.created_at
  };
}

function validateStatus(status: string): status is TaskStatus {
  return status === 'TODO' || status === 'DOING' || status === 'DONE' || status === 'BLOCKED';
}

function validatePriority(priority: string): priority is TaskPriority {
  return priority === 'LOW' || priority === 'MEDIUM' || priority === 'HIGH';
}

function normalizeTags(tags: string[] | undefined) {
  if (!tags) {
    return [] as string[];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const cleaned = normalizeText(tag).toLowerCase();
    if (cleaned.length === 0 || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    normalized.push(cleaned);
  }

  return normalized;
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }

  return dbPromise;
}

async function setupSchema() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS ${TASKS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL CHECK (status IN ('TODO', 'DOING', 'DONE', 'BLOCKED')),
      priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
      due_date TEXT,
      assignee_user_id TEXT,
      created_by TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      suggestions_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      last_transcript TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_org_project_updated
      ON ${TASKS_TABLE}(org_id, project_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_tasks_project_status_updated
      ON ${TASKS_TABLE}(project_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at
      ON ${TASKS_TABLE}(deleted_at);

    CREATE TABLE IF NOT EXISTS ${COMMENTS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_comments_task_created
      ON ${COMMENTS_TABLE}(task_id, created_at DESC);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }
  return setupPromise;
}

async function getTaskRowById(id: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<TaskRow>(
    `
      SELECT *
      FROM ${TASKS_TABLE}
      WHERE id = ?
        AND (? = 1 OR deleted_at IS NULL)
      LIMIT 1
    `,
    id,
    includeDeleted ? 1 : 0
  );

  return row ?? null;
}

async function saveTask(task: Task) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${TASKS_TABLE}
      (
        id, org_id, project_id, title, description,
        status, priority, due_date, assignee_user_id, created_by,
        tags_json, suggestions_json,
        created_at, updated_at, deleted_at, last_transcript
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    task.id,
    task.org_id,
    task.project_id,
    task.title,
    task.description ?? null,
    task.status,
    task.priority,
    task.due_date ?? null,
    task.assignee_user_id ?? null,
    task.created_by,
    JSON.stringify(task.tags),
    JSON.stringify(task.suggestions),
    task.created_at,
    task.updated_at,
    task.deleted_at ?? null,
    task.last_transcript ?? null
  );

  return task;
}

async function countActiveTasksByOrg(orgId: string) {
  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM ${TASKS_TABLE}
      WHERE org_id = ?
        AND deleted_at IS NULL
    `,
    orgId
  );

  return row?.count ?? 0;
}

function ensureTaskTitle(title: string) {
  const cleaned = normalizeText(title);
  if (cleaned.length < 2) {
    throw new Error('Le titre de tâche doit contenir au moins 2 caractères.');
  }
  return cleaned;
}

async function enqueueTaskOperation(task: Task, type: 'CREATE' | 'UPDATE' | 'DELETE', payload: Record<string, unknown>) {
  await offlineDB.enqueueOperation({
    entity: 'tasks',
    entity_id: task.id,
    type,
    payload: {
      ...payload,
      id: task.id,
      org_id: task.org_id,
      orgId: task.org_id,
      project_id: task.project_id,
      updated_at: task.updated_at
    }
  });
}

async function ensureTaskExists(taskId: string) {
  const row = await getTaskRowById(taskId);
  if (!row) {
    throw new Error('Tâche introuvable.');
  }
  return mapTaskRow(row);
}

function mergeTaskPatch(task: Task, patch: TaskUpdatePatch): Task {
  const nextTitle = patch.title !== undefined ? ensureTaskTitle(patch.title) : task.title;
  const nextStatus = patch.status ?? task.status;
  const nextPriority = patch.priority ?? task.priority;

  if (!validateStatus(nextStatus)) {
    throw new Error(`Statut invalide: ${nextStatus}`);
  }

  if (!validatePriority(nextPriority)) {
    throw new Error(`Priorité invalide: ${nextPriority}`);
  }

  return {
    ...task,
    title: nextTitle,
    description: patch.description !== undefined ? normalizeText(patch.description) || undefined : task.description,
    status: nextStatus,
    priority: nextPriority,
    due_date: patch.due_date !== undefined ? normalizeText(patch.due_date) || undefined : task.due_date,
    assignee_user_id:
      patch.assignee_user_id !== undefined
        ? normalizeText(patch.assignee_user_id) || undefined
        : task.assignee_user_id,
    tags: patch.tags ? normalizeTags(patch.tags) : task.tags,
    suggestions: patch.suggestions ?? task.suggestions,
    deleted_at: patch.deleted_at !== undefined ? patch.deleted_at : task.deleted_at,
    last_transcript: patch.last_transcript !== undefined ? patch.last_transcript : task.last_transcript,
    updated_at: nowIso()
  };
}

function applyKeywordRules(task: Task) {
  const outcome = evaluateKeywordRules(task);

  return {
    ...task,
    tags: outcome.tags,
    suggestions: outcome.suggestions,
    updated_at: nowIso()
  };
}

export const tasks = {
  async create(data: TaskCreateInput): Promise<Task> {
    await ensureSetup();

    const orgId = normalizeText(data.org_id);
    const projectId = normalizeText(data.project_id);
    const createdBy = normalizeText(data.created_by);

    if (orgId.length === 0) {
      throw new Error('org_id est requis.');
    }

    if (projectId.length === 0) {
      throw new Error('project_id est requis.');
    }

    if (createdBy.length === 0) {
      throw new Error('created_by est requis.');
    }

    const count = await countActiveTasksByOrg(orgId);
    if (count >= MAX_TASKS_PER_ORG) {
      throw new Error('Limite atteinte: 5000 tâches hors ligne pour cette organisation.');
    }

    const createdAt = nowIso();

    const baseTask: Task = {
      id: normalizeText(data.id) || createUuid(),
      org_id: orgId,
      project_id: projectId,
      title: ensureTaskTitle(data.title),
      description: normalizeText(data.description) || undefined,
      status: data.status ?? 'TODO',
      priority: data.priority ?? 'MEDIUM',
      due_date: normalizeText(data.due_date) || undefined,
      assignee_user_id: normalizeText(data.assignee_user_id) || undefined,
      created_by: createdBy,
      tags: normalizeTags(data.tags),
      suggestions: data.suggestions ?? [],
      created_at: createdAt,
      updated_at: createdAt,
      last_transcript: normalizeText(data.last_transcript) || undefined
    };

    if (!validateStatus(baseTask.status)) {
      throw new Error(`Statut invalide: ${baseTask.status}`);
    }

    if (!validatePriority(baseTask.priority)) {
      throw new Error(`Priorité invalide: ${baseTask.priority}`);
    }

    const finalTask = applyKeywordRules(baseTask);
    await saveTask(finalTask);

    await enqueueTaskOperation(finalTask, 'CREATE', {
      data: finalTask
    });

    return finalTask;
  },

  async update(id: string, patch: TaskUpdatePatch): Promise<Task> {
    const current = await ensureTaskExists(id);
    const merged = mergeTaskPatch(current, patch);
    const finalTask = applyKeywordRules(merged);

    await saveTask(finalTask);

    await enqueueTaskOperation(finalTask, 'UPDATE', {
      patch,
      data: finalTask
    });

    return finalTask;
  },

  async setStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.update(id, { status });
  },

  async softDelete(id: string): Promise<void> {
    const current = await ensureTaskExists(id);

    if (current.deleted_at) {
      return;
    }

    const next: Task = {
      ...current,
      deleted_at: nowIso(),
      updated_at: nowIso()
    };

    await saveTask(next);

    await enqueueTaskOperation(next, 'UPDATE', {
      patch: { deleted_at: next.deleted_at },
      data: next
    });
  },

  async getById(id: string): Promise<Task | null> {
    const row = await getTaskRowById(id);
    return row ? mapTaskRow(row) : null;
  },

  async listByProject(projectId: string, filters: TaskFilters = {}): Promise<Task[]> {
    await ensureSetup();
    const db = await getDb();

    const limit = Math.max(1, Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, 200));
    const offset = Math.max(0, filters.offset ?? 0);

    const where: string[] = ['project_id = ?'];
    const params: Array<string | number> = [projectId];

    if (filters.org_id) {
      where.push('org_id = ?');
      params.push(filters.org_id);
    }

    if (!filters.include_deleted) {
      where.push('deleted_at IS NULL');
    }

    if (filters.status && filters.status !== 'ALL') {
      where.push('status = ?');
      params.push(filters.status);
    }

    if (filters.assignee_user_id) {
      where.push('assignee_user_id = ?');
      params.push(filters.assignee_user_id);
    }

    if (!filters.tags || filters.tags.length === 0) {
      const rows = await db.getAllAsync<TaskRow>(
        `
          SELECT *
          FROM ${TASKS_TABLE}
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?
        `,
        ...params,
        limit,
        offset
      );

      return rows.map(mapTaskRow);
    }

    const rows = await db.getAllAsync<TaskRow>(
      `
        SELECT *
        FROM ${TASKS_TABLE}
        WHERE ${where.join(' AND ')}
        ORDER BY updated_at DESC
      `,
      ...params
    );

    const expectedTags = normalizeTags(filters.tags);

    const filtered = rows
      .map(mapTaskRow)
      .filter((task) => expectedTags.every((tag) => task.tags.includes(tag)));

    return filtered.slice(offset, offset + limit);
  },

  async addMedia(taskId: string, mediaContext: TaskMediaContext): Promise<MediaAsset> {
    const task = await ensureTaskExists(taskId);

    const context = {
      org_id: task.org_id,
      project_id: task.project_id,
      task_id: task.id,
      tag: mediaContext.tag ?? 'task-proof'
    };

    if (mediaContext.source === 'import') {
      const imported = await media.importFiles(context);
      const first = imported[0];
      if (!first) {
        throw new Error('Aucun fichier importé.');
      }
      return first;
    }

    return media.capturePhoto(context);
  },

  async listMedia(taskId: string): Promise<MediaAsset[]> {
    return media.listByTask(taskId);
  },

  async addComment(taskId: string, text: string): Promise<TaskComment> {
    const task = await ensureTaskExists(taskId);
    const commentText = normalizeText(text);

    if (commentText.length === 0) {
      throw new Error('Le commentaire est vide.');
    }

    await ensureSetup();
    const db = await getDb();

    const comment: TaskComment = {
      id: createUuid(),
      task_id: taskId,
      text: commentText,
      created_by: actorUserId ?? task.assignee_user_id ?? task.created_by,
      created_at: nowIso()
    };

    await db.runAsync(
      `
        INSERT INTO ${COMMENTS_TABLE}
        (id, task_id, text, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      comment.id,
      comment.task_id,
      comment.text,
      comment.created_by,
      comment.created_at
    );

    await db.runAsync(
      `
        UPDATE ${TASKS_TABLE}
        SET updated_at = ?
        WHERE id = ?
      `,
      nowIso(),
      taskId
    );

    await offlineDB.enqueueOperation({
      entity: 'task_comments',
      entity_id: comment.id,
      type: 'CREATE',
      payload: {
        ...comment,
        org_id: task.org_id,
        orgId: task.org_id,
        task_id: task.id,
        project_id: task.project_id
      }
    });

    return comment;
  },

  async listComments(taskId: string): Promise<TaskComment[]> {
    await ensureSetup();
    const db = await getDb();

    const rows = await db.getAllAsync<CommentRow>(
      `
        SELECT *
        FROM ${COMMENTS_TABLE}
        WHERE task_id = ?
        ORDER BY created_at DESC
      `,
      taskId
    );

    return rows.map(mapCommentRow);
  },

  async runKeywordRules(task: Task): Promise<Task> {
    const current = await ensureTaskExists(task.id);
    const next = applyKeywordRules({ ...current, ...task, id: current.id, updated_at: nowIso() });

    const hasChanges =
      JSON.stringify(current.tags) !== JSON.stringify(next.tags) ||
      JSON.stringify(current.suggestions) !== JSON.stringify(next.suggestions);

    if (!hasChanges) {
      return current;
    }

    await saveTask(next);

    await enqueueTaskOperation(next, 'UPDATE', {
      patch: { tags: next.tags, suggestions: next.suggestions },
      data: next
    });

    return next;
  },

  async countByOrg(orgId: string) {
    return countActiveTasksByOrg(orgId);
  },

  setActor(userId: string | null) {
    actorUserId = userId && userId.trim().length > 0 ? userId : null;
  }
};
