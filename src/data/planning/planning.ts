import * as SQLite from 'expo-sqlite';
import { offlineDB } from '../offline/outbox';
import {
  PlanningEvent,
  PlanningEventCreateInput,
  PlanningEventKind,
  PlanningEventUpdatePatch,
  PlanningIndicators,
  PlanningListFilters
} from './types';

const DB_NAME = 'conformeo.db';
const TABLE_NAME = 'planning_events';
const LEGACY_TABLE_NAME = 'planning_items';

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 600;

type PlanningEventRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  kind: PlanningEventKind;
  start_at: string;
  end_at: string;
  assignee_user_id: string | null;
  team_id: string | null;
  related_task_id: string | null;
  related_document_id: string | null;
  is_urgent: number;
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

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function toOptional(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function toNullable(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : null;
}

function isIsoDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function assertValidRange(startAt: string, endAt: string) {
  if (!isIsoDate(startAt) || !isIsoDate(endAt)) {
    throw new Error('Dates invalides (start_at/end_at).');
  }

  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw new Error('La date de fin doit être après la date de début.');
  }
}

function assertKind(kind: string): asserts kind is PlanningEventKind {
  if (kind !== 'PROJECT' && kind !== 'TEAM' && kind !== 'CONTROL' && kind !== 'DOC' && kind !== 'TASK') {
    throw new Error('Type planning invalide.');
  }
}

function mapRow(row: PlanningEventRow): PlanningEvent {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: toOptional(row.project_id),
    title: row.title,
    description: toOptional(row.description),
    kind: row.kind,
    start_at: row.start_at,
    end_at: row.end_at,
    assignee_user_id: toOptional(row.assignee_user_id),
    team_id: toOptional(row.team_id),
    related_task_id: toOptional(row.related_task_id),
    related_document_id: toOptional(row.related_document_id),
    is_urgent: row.is_urgent === 1,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
  };
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfWeek(date: Date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeek(date: Date) {
  const d = endOfDay(startOfWeek(date));
  d.setDate(d.getDate() + 6);
  return d;
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
      WHERE type = 'table' AND name = ?
    `,
    tableName
  );

  return (row?.count ?? 0) > 0;
}

async function importLegacyRowsIfNeeded(db: SQLite.SQLiteDatabase) {
  const hasLegacy = await tableExists(db, LEGACY_TABLE_NAME);
  if (!hasLegacy) {
    return;
  }

  const destinationCount = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${TABLE_NAME}`);
  if ((destinationCount?.count ?? 0) > 0) {
    return;
  }

  await db.execAsync(`
    INSERT INTO ${TABLE_NAME} (
      id,
      org_id,
      project_id,
      title,
      description,
      kind,
      start_at,
      end_at,
      assignee_user_id,
      team_id,
      related_task_id,
      related_document_id,
      is_urgent,
      created_by,
      created_at,
      updated_at,
      deleted_at
    )
    SELECT
      id,
      org_id,
      project_id,
      title_snapshot,
      NULL,
      'TASK',
      start_at,
      end_at,
      assignee_user_id,
      team_id,
      task_id,
      NULL,
      0,
      created_by,
      created_at,
      updated_at,
      deleted_at
    FROM ${LEGACY_TABLE_NAME};
  `);
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
          project_id TEXT,
          title TEXT NOT NULL,
          description TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('PROJECT','TEAM','CONTROL','DOC','TASK')),
          start_at TEXT NOT NULL,
          end_at TEXT NOT NULL,
          assignee_user_id TEXT,
          team_id TEXT,
          related_task_id TEXT,
          related_document_id TEXT,
          is_urgent INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_planning_events_org_start
          ON ${TABLE_NAME}(org_id, start_at ASC);

        CREATE INDEX IF NOT EXISTS idx_planning_events_org_kind_start
          ON ${TABLE_NAME}(org_id, kind, start_at ASC);

        CREATE INDEX IF NOT EXISTS idx_planning_events_org_assignee_start
          ON ${TABLE_NAME}(org_id, assignee_user_id, start_at ASC);

        CREATE INDEX IF NOT EXISTS idx_planning_events_project
          ON ${TABLE_NAME}(org_id, project_id, start_at ASC);

        CREATE INDEX IF NOT EXISTS idx_planning_events_deleted
          ON ${TABLE_NAME}(deleted_at);
      `);

      await importLegacyRowsIfNeeded(db);
    })();
  }

  return setupPromise;
}

async function upsert(event: PlanningEvent) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${TABLE_NAME}
      (
        id,
        org_id,
        project_id,
        title,
        description,
        kind,
        start_at,
        end_at,
        assignee_user_id,
        team_id,
        related_task_id,
        related_document_id,
        is_urgent,
        created_by,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    event.id,
    event.org_id,
    event.project_id ?? null,
    event.title,
    event.description ?? null,
    event.kind,
    event.start_at,
    event.end_at,
    event.assignee_user_id ?? null,
    event.team_id ?? null,
    event.related_task_id ?? null,
    event.related_document_id ?? null,
    event.is_urgent ? 1 : 0,
    event.created_by,
    event.created_at,
    event.updated_at,
    event.deleted_at ?? null
  );

  return event;
}

async function getByIdInternal(id: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<PlanningEventRow>(
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

async function enqueueOperation(event: PlanningEvent, type: 'CREATE' | 'UPDATE' | 'DELETE', payload: Record<string, unknown>) {
  await offlineDB.enqueueOperation({
    entity: 'planning_events',
    entity_id: event.id,
    type,
    payload: {
      ...payload,
      id: event.id,
      org_id: event.org_id,
      orgId: event.org_id,
      updated_at: event.updated_at
    }
  });
}

function buildWhere(filters: PlanningListFilters) {
  const where: string[] = ['deleted_at IS NULL'];
  const params: Array<string | number> = [];

  if (filters.includeDeleted) {
    where.splice(0, 1);
  }

  if (filters.project_id) {
    where.push('project_id = ?');
    params.push(filters.project_id);
  }

  if (filters.assignee_user_id) {
    where.push('assignee_user_id = ?');
    params.push(filters.assignee_user_id);
  }

  if (filters.team_id) {
    where.push('team_id = ?');
    params.push(filters.team_id);
  }

  if (filters.onlyMineUserId) {
    where.push('assignee_user_id = ?');
    params.push(filters.onlyMineUserId);
  }

  if (filters.kinds && filters.kinds.length > 0) {
    const placeholders = filters.kinds.map(() => '?').join(', ');
    where.push(`kind IN (${placeholders})`);
    params.push(...filters.kinds);
  }

  const q = normalizeText(filters.q).toLowerCase();
  if (q.length > 0) {
    where.push("(LOWER(title) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  return { where, params };
}

export const planningEvents = {
  async listRange(org_id: string, start: string, end: string, filters: PlanningListFilters = {}): Promise<PlanningEvent[]> {
    await ensureSetup();

    const orgId = normalizeText(org_id);
    if (!orgId) {
      return [];
    }

    assertValidRange(start, end);

    const limitRaw = typeof filters.limit === 'number' ? Math.floor(filters.limit) : DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(limitRaw, MAX_LIMIT));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));

    const { where, params } = buildWhere(filters);
    where.unshift('org_id = ?', 'start_at < ?', 'end_at > ?');
    params.unshift(orgId, end, start);

    const db = await getDb();
    const rows = await db.getAllAsync<PlanningEventRow>(
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

  async create(input: PlanningEventCreateInput): Promise<PlanningEvent> {
    await ensureSetup();

    const orgId = normalizeText(input.org_id);
    const title = normalizeText(input.title).replace(/\s+/g, ' ');
    const createdBy = normalizeText(input.created_by);
    const kind = normalizeText(input.kind);
    const startAt = normalizeText(input.start_at);
    const endAt = normalizeText(input.end_at);

    if (!orgId) {
      throw new Error('Organisation manquante pour créer un événement.');
    }
    if (title.length < 2) {
      throw new Error('Le titre doit contenir au moins 2 caractères.');
    }
    if (!createdBy) {
      throw new Error('Utilisateur manquant pour créer un événement.');
    }

    assertKind(kind);
    assertValidRange(startAt, endAt);

    const now = nowIso();
    const event: PlanningEvent = {
      id: normalizeText(input.id) || createUuid(),
      org_id: orgId,
      project_id: toOptional(input.project_id),
      title,
      description: toOptional(input.description),
      kind,
      start_at: startAt,
      end_at: endAt,
      assignee_user_id: toOptional(input.assignee_user_id),
      team_id: toOptional(input.team_id),
      related_task_id: toOptional(input.related_task_id),
      related_document_id: toOptional(input.related_document_id),
      is_urgent: Boolean(input.is_urgent),
      created_by: createdBy,
      created_at: now,
      updated_at: now
    };

    await upsert(event);
    await enqueueOperation(event, 'CREATE', { data: event });
    return event;
  },

  async update(id: string, patch: PlanningEventUpdatePatch): Promise<PlanningEvent> {
    const row = await getByIdInternal(id, true);
    if (!row) {
      throw new Error('Événement introuvable.');
    }

    const current = mapRow(row);
    if (current.deleted_at) {
      throw new Error('Événement supprimé.');
    }

    const nextKind = patch.kind !== undefined ? normalizeText(patch.kind) : current.kind;
    assertKind(nextKind);

    const nextStart = patch.start_at !== undefined ? normalizeText(patch.start_at) : current.start_at;
    const nextEnd = patch.end_at !== undefined ? normalizeText(patch.end_at) : current.end_at;
    assertValidRange(nextStart, nextEnd);

    const nextTitle = patch.title !== undefined ? normalizeText(patch.title).replace(/\s+/g, ' ') : current.title;
    if (nextTitle.length < 2) {
      throw new Error('Le titre doit contenir au moins 2 caractères.');
    }

    const next: PlanningEvent = {
      ...current,
      project_id: patch.project_id !== undefined ? toOptional(patch.project_id) : current.project_id,
      title: nextTitle,
      description: patch.description !== undefined ? toOptional(patch.description) : current.description,
      kind: nextKind,
      start_at: nextStart,
      end_at: nextEnd,
      assignee_user_id: patch.assignee_user_id !== undefined ? toOptional(patch.assignee_user_id) : current.assignee_user_id,
      team_id: patch.team_id !== undefined ? toOptional(patch.team_id) : current.team_id,
      related_task_id: patch.related_task_id !== undefined ? toOptional(patch.related_task_id) : current.related_task_id,
      related_document_id:
        patch.related_document_id !== undefined ? toOptional(patch.related_document_id) : current.related_document_id,
      is_urgent: patch.is_urgent !== undefined ? Boolean(patch.is_urgent) : current.is_urgent,
      deleted_at: patch.deleted_at !== undefined ? toOptional(patch.deleted_at) : current.deleted_at,
      updated_at: nowIso()
    };

    await upsert(next);
    await enqueueOperation(next, 'UPDATE', { patch, data: next });
    return next;
  },

  async remove(id: string): Promise<void> {
    const row = await getByIdInternal(id, true);
    if (!row) {
      return;
    }

    const current = mapRow(row);
    if (current.deleted_at) {
      return;
    }

    const now = nowIso();
    const next: PlanningEvent = {
      ...current,
      deleted_at: now,
      updated_at: now
    };

    await upsert(next);
    await enqueueOperation(next, 'DELETE', { id: next.id, deleted_at: next.deleted_at });
  },

  async getById(id: string): Promise<PlanningEvent | null> {
    const row = await getByIdInternal(id, false);
    return row ? mapRow(row) : null;
  },

  async getIndicators(org_id: string, user_id?: string): Promise<PlanningIndicators> {
    await ensureSetup();

    const orgId = normalizeText(org_id);
    if (!orgId) {
      return {
        weekEventsCount: 0,
        urgentCount: 0,
        mineCount: 0,
        todayCount: 0,
        pendingOpsCount: 0
      };
    }

    const now = new Date();
    const weekStart = startOfWeek(now).toISOString();
    const weekEnd = endOfWeek(now).toISOString();
    const dayStart = startOfDay(now).toISOString();
    const dayEnd = endOfDay(now).toISOString();

    const db = await getDb();

    const [weekRow, urgentRow, mineRow, todayRow, pendingOps] = await Promise.all([
      db.getFirstAsync<{ count: number }>(
        `
          SELECT COUNT(*) AS count
          FROM ${TABLE_NAME}
          WHERE org_id = ?
            AND deleted_at IS NULL
            AND start_at < ?
            AND end_at > ?
        `,
        orgId,
        weekEnd,
        weekStart
      ),
      db.getFirstAsync<{ count: number }>(
        `
          SELECT COUNT(*) AS count
          FROM ${TABLE_NAME}
          WHERE org_id = ?
            AND deleted_at IS NULL
            AND (is_urgent = 1 OR kind = 'CONTROL')
            AND start_at < ?
            AND end_at > ?
        `,
        orgId,
        weekEnd,
        dayStart
      ),
      user_id
        ? db.getFirstAsync<{ count: number }>(
            `
              SELECT COUNT(*) AS count
              FROM ${TABLE_NAME}
              WHERE org_id = ?
                AND deleted_at IS NULL
                AND assignee_user_id = ?
                AND start_at < ?
                AND end_at > ?
            `,
            orgId,
            user_id,
            weekEnd,
            weekStart
          )
        : Promise.resolve<{ count: number } | null>({ count: 0 }),
      db.getFirstAsync<{ count: number }>(
        `
          SELECT COUNT(*) AS count
          FROM ${TABLE_NAME}
          WHERE org_id = ?
            AND deleted_at IS NULL
            AND start_at < ?
            AND end_at > ?
        `,
        orgId,
        dayEnd,
        dayStart
      ),
      offlineDB.getUnsyncedCount()
    ]);

    return {
      weekEventsCount: weekRow?.count ?? 0,
      urgentCount: urgentRow?.count ?? 0,
      mineCount: mineRow?.count ?? 0,
      todayCount: todayRow?.count ?? 0,
      pendingOpsCount: pendingOps
    };
  }
};

export function buildDayRange(baseDate: Date) {
  const start = startOfDay(baseDate).toISOString();
  const end = endOfDay(baseDate).toISOString();
  return { start, end };
}

export function buildWeekRange(baseDate: Date) {
  const start = startOfWeek(baseDate).toISOString();
  const end = endOfWeek(baseDate).toISOString();
  return { start, end };
}

export function clampEndFromStart(startIso: string, minutes = 60) {
  const date = new Date(startIso);
  if (!Number.isFinite(date.getTime())) {
    return startIso;
  }
  const end = new Date(date);
  end.setMinutes(end.getMinutes() + minutes);
  return end.toISOString();
}

export function toDayKey(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

export function formatHourMinute(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return '--:--';
  }
  return new Date(parsed).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateFr(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return iso;
  }
  return new Date(parsed).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function kindLabel(kind: PlanningEventKind) {
  switch (kind) {
    case 'PROJECT':
      return 'Chantier';
    case 'TEAM':
      return 'Équipe';
    case 'CONTROL':
      return 'Contrôle';
    case 'DOC':
      return 'Document';
    case 'TASK':
      return 'Tâche';
    default:
      return 'Événement';
  }
}

export function kindColor(kind: PlanningEventKind) {
  switch (kind) {
    case 'PROJECT':
      return '#0E7C86';
    case 'TEAM':
      return '#1976D2';
    case 'CONTROL':
      return '#D32F2F';
    case 'DOC':
      return '#ED6C02';
    case 'TASK':
      return '#2E7D32';
    default:
      return '#52606D';
  }
}

export function normalizeIsoInput(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function normalizeUserText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function toNullableInput(value: string) {
  return toNullable(value);
}
