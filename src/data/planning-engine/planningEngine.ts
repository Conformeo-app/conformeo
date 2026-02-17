import * as SQLite from 'expo-sqlite';
import { offlineDB } from '../offline/outbox';
import { geo } from '../geo-context';
import { PlanningCreateInput, PlanningItem, PlanningListFilters, PlanningOverlap, PlanningUpdatePatch } from './types';

const DB_NAME = 'conformeo.db';
const TABLE_NAME = 'planning_items';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type PlanningRow = {
  id: string;
  org_id: string;
  project_id: string;
  task_id: string;
  title_snapshot: string;
  start_at: string;
  end_at: string;
  assignee_user_id: string | null;
  team_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

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

function createUuid() {
  const randomUUID = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const next = char === 'x' ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
}

function parseIsoMs(value: string) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function ensureValidRange(startAt: string, endAt: string) {
  const startMs = parseIsoMs(startAt);
  const endMs = parseIsoMs(endAt);
  if (startMs === null || endMs === null) {
    throw new Error('Dates invalides (start_at/end_at).');
  }
  if (endMs <= startMs) {
    throw new Error('end_at doit être après start_at.');
  }
  return { startMs, endMs };
}

function mapRow(row: PlanningRow): PlanningItem {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    task_id: row.task_id,
    title_snapshot: row.title_snapshot,
    start_at: row.start_at,
    end_at: row.end_at,
    assignee_user_id: toOptional(row.assignee_user_id),
    team_id: toOptional(row.team_id),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
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

        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          title_snapshot TEXT NOT NULL,
          start_at TEXT NOT NULL,
          end_at TEXT NOT NULL,
          assignee_user_id TEXT,
          team_id TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_planning_org_project_start
          ON ${TABLE_NAME}(org_id, project_id, start_at ASC);

        CREATE INDEX IF NOT EXISTS idx_planning_org_assignee_start
          ON ${TABLE_NAME}(org_id, assignee_user_id, start_at ASC);

        CREATE INDEX IF NOT EXISTS idx_planning_task
          ON ${TABLE_NAME}(task_id, start_at ASC);

        CREATE INDEX IF NOT EXISTS idx_planning_deleted
          ON ${TABLE_NAME}(deleted_at);
      `);
    })();
  }

  return setupPromise;
}

async function upsert(item: PlanningItem) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${TABLE_NAME}
      (
        id, org_id, project_id, task_id, title_snapshot,
        start_at, end_at,
        assignee_user_id, team_id,
        created_by, created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    item.id,
    item.org_id,
    item.project_id,
    item.task_id,
    item.title_snapshot,
    item.start_at,
    item.end_at,
    item.assignee_user_id ?? null,
    item.team_id ?? null,
    item.created_by,
    item.created_at,
    item.updated_at,
    item.deleted_at ?? null
  );

  return item;
}

async function getRowById(id: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<PlanningRow>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE id = ?
        AND (? = 1 OR deleted_at IS NULL)
      LIMIT 1
    `,
    id,
    includeDeleted ? 1 : 0
  );

  return row ?? null;
}

async function enqueueOperation(item: PlanningItem, type: 'CREATE' | 'UPDATE' | 'DELETE', payload: Record<string, unknown>) {
  await offlineDB.enqueueOperation({
    entity: 'planning_items',
    entity_id: item.id,
    type,
    payload: {
      ...payload,
      id: item.id,
      org_id: item.org_id,
      orgId: item.org_id,
      project_id: item.project_id,
      updated_at: item.updated_at
    }
  });
}

function resourceKey(item: PlanningItem) {
  if (item.assignee_user_id) return `user:${item.assignee_user_id}`;
  if (item.team_id) return `team:${item.team_id}`;
  return null;
}

export const planning = {
  async create(input: PlanningCreateInput): Promise<PlanningItem> {
    await ensureSetup();

    const orgId = normalizeText(input.org_id);
    const projectId = normalizeText(input.project_id);
    const taskId = normalizeText(input.task_id);
    const title = normalizeText(input.title_snapshot);
    const createdBy = normalizeText(input.created_by);
    const startAt = normalizeText(input.start_at);
    const endAt = normalizeText(input.end_at);

    if (!orgId) throw new Error('org_id requis.');
    if (!projectId) throw new Error('project_id requis.');
    if (!taskId) throw new Error('task_id requis.');
    if (title.length < 2) throw new Error('title_snapshot trop court.');
    if (!createdBy) throw new Error('created_by requis.');

    ensureValidRange(startAt, endAt);

    const createdAt = nowIso();
    const item: PlanningItem = {
      id: normalizeText(input.id) || createUuid(),
      org_id: orgId,
      project_id: projectId,
      task_id: taskId,
      title_snapshot: title,
      start_at: startAt,
      end_at: endAt,
      assignee_user_id: toOptional(input.assignee_user_id),
      team_id: toOptional(input.team_id),
      created_by: createdBy,
      created_at: createdAt,
      updated_at: createdAt
    };

    await upsert(item);
    await enqueueOperation(item, 'CREATE', { data: item });

    void geo.capture({
      entity: 'PLANNING_ITEM',
      entity_id: item.id,
      org_id: item.org_id,
      user_id: item.created_by,
      project_id: item.project_id
    });

    return item;
  },

  async update(id: string, patch: PlanningUpdatePatch): Promise<PlanningItem> {
    const row = await getRowById(id, true);
    if (!row) {
      throw new Error('Planning introuvable.');
    }

    const current = mapRow(row);
    if (current.deleted_at) {
      throw new Error('Planning supprimé.');
    }

    const nextStart = patch.start_at !== undefined ? normalizeText(patch.start_at) : current.start_at;
    const nextEnd = patch.end_at !== undefined ? normalizeText(patch.end_at) : current.end_at;
    ensureValidRange(nextStart, nextEnd);

    const next: PlanningItem = {
      ...current,
      title_snapshot: patch.title_snapshot !== undefined ? normalizeText(patch.title_snapshot) : current.title_snapshot,
      start_at: nextStart,
      end_at: nextEnd,
      assignee_user_id: patch.assignee_user_id !== undefined ? toOptional(patch.assignee_user_id) : current.assignee_user_id,
      team_id: patch.team_id !== undefined ? toOptional(patch.team_id) : current.team_id,
      deleted_at: patch.deleted_at !== undefined ? toOptional(patch.deleted_at) : current.deleted_at,
      updated_at: nowIso()
    };

    if (next.title_snapshot.length < 2) {
      throw new Error('title_snapshot trop court.');
    }

    await upsert(next);
    await enqueueOperation(next, 'UPDATE', { patch, data: next });
    return next;
  },

  async softDelete(id: string) {
    const row = await getRowById(id, true);
    if (!row) {
      return;
    }

    const current = mapRow(row);
    if (current.deleted_at) {
      return;
    }

    const next: PlanningItem = {
      ...current,
      deleted_at: nowIso(),
      updated_at: nowIso()
    };

    await upsert(next);
    await enqueueOperation(next, 'UPDATE', { patch: { deleted_at: next.deleted_at }, data: next });
  },

  async getById(id: string) {
    const row = await getRowById(id, false);
    return row ? mapRow(row) : null;
  },

  async listByProject(projectId: string, filters: PlanningListFilters): Promise<PlanningItem[]> {
    await ensureSetup();
    const orgId = normalizeText(filters.org_id);
    const pid = normalizeText(projectId);
    if (!orgId || !pid) {
      return [];
    }

    const limitRaw = typeof filters.limit === 'number' ? Math.floor(filters.limit) : DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(limitRaw, MAX_LIMIT));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));

    const where: string[] = ['org_id = ?', 'project_id = ?', 'deleted_at IS NULL'];
    const params: Array<string | number> = [orgId, pid];

    if (filters.assignee_user_id) {
      where.push('assignee_user_id = ?');
      params.push(filters.assignee_user_id);
    }

    if (filters.team_id) {
      where.push('team_id = ?');
      params.push(filters.team_id);
    }

    if (filters.start_from) {
      where.push('start_at >= ?');
      params.push(filters.start_from);
    }

    if (filters.start_to) {
      where.push('start_at <= ?');
      params.push(filters.start_to);
    }

    const db = await getDb();
    const rows = await db.getAllAsync<PlanningRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE ${where.join(' AND ')}
        ORDER BY start_at ASC
        LIMIT ? OFFSET ?
      `,
      ...params,
      limit,
      offset
    );

    return rows.map(mapRow);
  },

  computeOverlaps(items: PlanningItem[]): PlanningOverlap[] {
    const byResource = new Map<string, PlanningItem[]>();

    for (const item of items) {
      const key = resourceKey(item);
      if (!key) {
        continue;
      }

      const startMs = parseIsoMs(item.start_at);
      const endMs = parseIsoMs(item.end_at);
      if (startMs === null || endMs === null) {
        continue;
      }

      const list = byResource.get(key) ?? [];
      list.push(item);
      byResource.set(key, list);
    }

    const overlaps: PlanningOverlap[] = [];

    for (const [key, list] of byResource.entries()) {
      const sorted = [...list].sort((a, b) => {
        const aMs = parseIsoMs(a.start_at) ?? 0;
        const bMs = parseIsoMs(b.start_at) ?? 0;
        return aMs - bMs;
      });

      for (let i = 0; i < sorted.length - 1; i += 1) {
        const first = sorted[i];
        const second = sorted[i + 1];

        const firstEnd = parseIsoMs(first.end_at);
        const secondStart = parseIsoMs(second.start_at);
        const secondEnd = parseIsoMs(second.end_at);

        if (firstEnd === null || secondStart === null || secondEnd === null) {
          continue;
        }

        if (secondStart < firstEnd) {
          const overlapMs = Math.min(firstEnd, secondEnd) - secondStart;
          overlaps.push({
            resource_key: key,
            first,
            second,
            overlap_minutes: Math.max(1, Math.round(overlapMs / 60000))
          });
        }
      }
    }

    return overlaps;
  }
};

