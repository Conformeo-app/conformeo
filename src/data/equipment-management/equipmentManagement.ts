import * as SQLite from 'expo-sqlite';
import { offlineDB } from '../offline/outbox';
import { geo } from '../geo-context';
import { tasks } from '../tasks';
import {
  Equipment,
  EquipmentListFilters,
  EquipmentMovement,
  EquipmentMoveInput,
  EquipmentStatus,
  EquipmentTaskLink
} from './types';

const DB_NAME = 'conformeo.db';
const EQUIPMENT_TABLE = 'equipment';
const MOVEMENTS_TABLE = 'equipment_movements';
const LINKS_TABLE = 'equipment_task_links';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

type EquipmentRow = {
  id: string;
  org_id: string;
  name: string;
  type: string;
  status: EquipmentStatus;
  location: string | null;
  current_project_id: string | null;
  photo_asset_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type MovementRow = {
  id: string;
  org_id: string;
  equipment_id: string;
  from_project_id: string | null;
  to_project_id: string | null;
  moved_at: string;
  note: string | null;
  created_at: string;
};

type LinkRow = {
  id: string;
  org_id: string;
  equipment_id: string;
  task_id: string;
  created_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | undefined | null) {
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

function validateStatus(status: string): status is EquipmentStatus {
  return status === 'AVAILABLE' || status === 'ASSIGNED' || status === 'MAINTENANCE' || status === 'OUT_OF_SERVICE';
}

function mapEquipmentRow(row: EquipmentRow): Equipment {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    type: row.type,
    status: row.status,
    location: toOptional(row.location),
    current_project_id: toOptional(row.current_project_id),
    photo_asset_id: toOptional(row.photo_asset_id),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
  };
}

function mapMovementRow(row: MovementRow): EquipmentMovement {
  return {
    id: row.id,
    org_id: row.org_id,
    equipment_id: row.equipment_id,
    from_project_id: toOptional(row.from_project_id),
    to_project_id: toOptional(row.to_project_id),
    moved_at: row.moved_at,
    note: toOptional(row.note),
    created_at: row.created_at
  };
}

function mapLinkRow(row: LinkRow): EquipmentTaskLink {
  return {
    id: row.id,
    org_id: row.org_id,
    equipment_id: row.equipment_id,
    task_id: row.task_id,
    created_at: row.created_at
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

        CREATE TABLE IF NOT EXISTS ${EQUIPMENT_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('AVAILABLE','ASSIGNED','MAINTENANCE','OUT_OF_SERVICE')),
          location TEXT,
          current_project_id TEXT,
          photo_asset_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_equipment_org_updated
          ON ${EQUIPMENT_TABLE}(org_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_equipment_org_status
          ON ${EQUIPMENT_TABLE}(org_id, status, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_equipment_project
          ON ${EQUIPMENT_TABLE}(current_project_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_equipment_deleted
          ON ${EQUIPMENT_TABLE}(deleted_at);

        CREATE TABLE IF NOT EXISTS ${MOVEMENTS_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          equipment_id TEXT NOT NULL,
          from_project_id TEXT,
          to_project_id TEXT,
          moved_at TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_equipment_movements_equipment
          ON ${MOVEMENTS_TABLE}(equipment_id, moved_at DESC);

        CREATE INDEX IF NOT EXISTS idx_equipment_movements_org
          ON ${MOVEMENTS_TABLE}(org_id, moved_at DESC);

        CREATE TABLE IF NOT EXISTS ${LINKS_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          equipment_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_task_unique
          ON ${LINKS_TABLE}(org_id, equipment_id, task_id);
      `);
    })();
  }

  return setupPromise;
}

async function getEquipmentRowById(id: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<EquipmentRow>(
    `
      SELECT *
      FROM ${EQUIPMENT_TABLE}
      WHERE id = ?
        AND (? = 1 OR deleted_at IS NULL)
      LIMIT 1
    `,
    id,
    includeDeleted ? 1 : 0
  );

  return row ?? null;
}

async function upsertEquipmentRow(equipment: Equipment) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${EQUIPMENT_TABLE}
      (
        id, org_id, name, type, status,
        location, current_project_id, photo_asset_id,
        created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    equipment.id,
    equipment.org_id,
    equipment.name,
    equipment.type,
    equipment.status,
    equipment.location ?? null,
    equipment.current_project_id ?? null,
    equipment.photo_asset_id ?? null,
    equipment.created_at,
    equipment.updated_at,
    equipment.deleted_at ?? null
  );

  return equipment;
}

async function enqueueEquipmentOperation(equipment: Equipment, type: 'CREATE' | 'UPDATE' | 'DELETE', payload: Record<string, unknown>) {
  await offlineDB.enqueueOperation({
    entity: 'equipment',
    entity_id: equipment.id,
    type,
    payload: {
      ...payload,
      id: equipment.id,
      org_id: equipment.org_id,
      orgId: equipment.org_id,
      updated_at: equipment.updated_at
    }
  });
}

async function enqueueMovementOperation(movement: EquipmentMovement) {
  await offlineDB.enqueueOperation({
    entity: 'equipment_movements',
    entity_id: movement.id,
    type: 'CREATE',
    payload: {
      ...movement,
      org_id: movement.org_id,
      orgId: movement.org_id
    }
  });
}

async function enqueueLinkOperation(link: EquipmentTaskLink, type: 'CREATE' | 'DELETE') {
  await offlineDB.enqueueOperation({
    entity: 'equipment_task_links',
    entity_id: link.id,
    type: type === 'CREATE' ? 'CREATE' : 'DELETE',
    payload: {
      ...link,
      org_id: link.org_id,
      orgId: link.org_id
    }
  });
}

function ensureName(name: string) {
  const cleaned = normalizeText(name).replace(/\s+/g, ' ');
  if (cleaned.length < 2) {
    throw new Error("Nom d'équipement trop court (min 2 caractères).");
  }
  return cleaned;
}

function ensureType(type: string) {
  const cleaned = normalizeText(type).replace(/\s+/g, ' ');
  if (cleaned.length < 2) {
    throw new Error("Type d'équipement trop court (min 2 caractères).");
  }
  return cleaned;
}

export const equipment = {
  async create(input: {
    id?: string;
    org_id: string;
    name: string;
    type: string;
    status?: EquipmentStatus;
    location?: string;
    current_project_id?: string;
    photo_asset_id?: string;
  }): Promise<Equipment> {
    await ensureSetup();

    const orgId = normalizeText(input.org_id);
    if (!orgId) {
      throw new Error('org_id est requis.');
    }

    const status = input.status ?? 'AVAILABLE';
    if (!validateStatus(status)) {
      throw new Error(`Statut invalide: ${status}`);
    }

    const createdAt = nowIso();
    const record: Equipment = {
      id: normalizeText(input.id) || createUuid(),
      org_id: orgId,
      name: ensureName(input.name),
      type: ensureType(input.type),
      status,
      location: toOptional(input.location),
      current_project_id: toOptional(input.current_project_id),
      photo_asset_id: toOptional(input.photo_asset_id),
      created_at: createdAt,
      updated_at: createdAt
    };

    await upsertEquipmentRow(record);

    await enqueueEquipmentOperation(record, 'CREATE', { data: record });

    void geo.capture({
      entity: 'EQUIPMENT',
      entity_id: record.id,
      org_id: record.org_id,
      project_id: record.current_project_id
    });

    return record;
  },

  async update(id: string, patch: Partial<Omit<Equipment, 'id' | 'org_id' | 'created_at'>>) {
    const existing = await getEquipmentRowById(id, true);
    if (!existing) {
      throw new Error('Équipement introuvable.');
    }

    const current = mapEquipmentRow(existing);
    if (current.deleted_at) {
      throw new Error('Équipement supprimé.');
    }

    const nextStatus = patch.status ?? current.status;
    if (!validateStatus(nextStatus)) {
      throw new Error(`Statut invalide: ${String(nextStatus)}`);
    }

    const next: Equipment = {
      ...current,
      name: patch.name !== undefined ? ensureName(patch.name) : current.name,
      type: patch.type !== undefined ? ensureType(patch.type) : current.type,
      status: nextStatus,
      location: patch.location !== undefined ? toOptional(patch.location) : current.location,
      current_project_id:
        patch.current_project_id !== undefined ? toOptional(patch.current_project_id) : current.current_project_id,
      photo_asset_id: patch.photo_asset_id !== undefined ? toOptional(patch.photo_asset_id) : current.photo_asset_id,
      updated_at: nowIso()
    };

    await upsertEquipmentRow(next);
    await enqueueEquipmentOperation(next, 'UPDATE', { patch, data: next });
    return next;
  },

  async softDelete(id: string) {
    const existing = await getEquipmentRowById(id, true);
    if (!existing) {
      return;
    }

    const current = mapEquipmentRow(existing);
    if (current.deleted_at) {
      return;
    }

    const next: Equipment = {
      ...current,
      deleted_at: nowIso(),
      updated_at: nowIso()
    };

    await upsertEquipmentRow(next);
    await enqueueEquipmentOperation(next, 'UPDATE', { patch: { deleted_at: next.deleted_at }, data: next });
  },

  async getById(id: string) {
    const row = await getEquipmentRowById(id, false);
    return row ? mapEquipmentRow(row) : null;
  },

  async list(filters: EquipmentListFilters): Promise<Equipment[]> {
    await ensureSetup();
    const orgId = normalizeText(filters.org_id);
    if (!orgId) {
      return [];
    }

    const status = filters.status ?? 'ALL';
    const projectId = toOptional(filters.project_id);
    const q = normalizeText(filters.q).toLowerCase();
    const limitRaw = typeof filters.limit === 'number' ? Math.floor(filters.limit) : DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(limitRaw, MAX_LIMIT));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));

    const db = await getDb();
    const rows = await db.getAllAsync<EquipmentRow>(
      `
        SELECT *
        FROM ${EQUIPMENT_TABLE}
        WHERE org_id = ?
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
      orgId,
      limit,
      offset
    );

    let mapped = rows.map(mapEquipmentRow);

    if (status !== 'ALL') {
      mapped = mapped.filter((item) => item.status === status);
    }

    if (projectId) {
      mapped = mapped.filter((item) => item.current_project_id === projectId);
    }

    if (q) {
      mapped = mapped.filter((item) => {
        return (
          item.name.toLowerCase().includes(q) ||
          item.type.toLowerCase().includes(q) ||
          (item.location ?? '').toLowerCase().includes(q)
        );
      });
    }

    return mapped;
  },

  async move(equipmentId: string, input: EquipmentMoveInput): Promise<{ equipment: Equipment; movement: EquipmentMovement }> {
    const existing = await getEquipmentRowById(equipmentId, true);
    if (!existing) {
      throw new Error('Équipement introuvable.');
    }

    const current = mapEquipmentRow(existing);
    if (current.deleted_at) {
      throw new Error('Équipement supprimé.');
    }

    const movedAt = toOptional(input.moved_at) ?? nowIso();
    const fromProject = toOptional(input.from_project_id) ?? current.current_project_id;
    const toProject = toOptional(input.to_project_id);

    const movement: EquipmentMovement = {
      id: createUuid(),
      org_id: current.org_id,
      equipment_id: current.id,
      from_project_id: fromProject,
      to_project_id: toProject,
      moved_at: movedAt,
      note: toOptional(input.note),
      created_at: nowIso()
    };

    await ensureSetup();
    const db = await getDb();
    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${MOVEMENTS_TABLE}
        (id, org_id, equipment_id, from_project_id, to_project_id, moved_at, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      movement.id,
      movement.org_id,
      movement.equipment_id,
      movement.from_project_id ?? null,
      movement.to_project_id ?? null,
      movement.moved_at,
      movement.note ?? null,
      movement.created_at
    );

    await enqueueMovementOperation(movement);

    const nextStatus: EquipmentStatus = toProject ? 'ASSIGNED' : current.status === 'ASSIGNED' ? 'AVAILABLE' : current.status;

    const next: Equipment = {
      ...current,
      current_project_id: toProject,
      status: nextStatus,
      updated_at: nowIso()
    };

    await upsertEquipmentRow(next);
    await enqueueEquipmentOperation(next, 'UPDATE', {
      patch: { current_project_id: next.current_project_id, status: next.status },
      data: next
    });

    void geo.capture({
      entity: 'EQUIPMENT_MOVEMENT',
      entity_id: movement.id,
      org_id: movement.org_id,
      project_id: movement.to_project_id ?? movement.from_project_id
    });

    return { equipment: next, movement };
  },

  async listMovements(equipmentId: string, opts?: { limit?: number }) {
    await ensureSetup();
    const limitRaw = typeof opts?.limit === 'number' ? Math.floor(opts.limit) : 25;
    const limit = Math.max(1, Math.min(limitRaw, 200));
    const db = await getDb();

    const rows = await db.getAllAsync<MovementRow>(
      `
        SELECT *
        FROM ${MOVEMENTS_TABLE}
        WHERE equipment_id = ?
        ORDER BY moved_at DESC
        LIMIT ?
      `,
      equipmentId,
      limit
    );

    return rows.map(mapMovementRow);
  },

  async linkTask(input: { org_id: string; equipment_id: string; task_id: string }): Promise<EquipmentTaskLink> {
    await ensureSetup();
    const orgId = normalizeText(input.org_id);
    const equipmentId = normalizeText(input.equipment_id);
    const taskId = normalizeText(input.task_id);

    if (!orgId || !equipmentId || !taskId) {
      throw new Error('org_id, equipment_id et task_id requis.');
    }

    const createdAt = nowIso();
    const link: EquipmentTaskLink = {
      id: createUuid(),
      org_id: orgId,
      equipment_id: equipmentId,
      task_id: taskId,
      created_at: createdAt
    };

    const db = await getDb();
    try {
      await db.runAsync(
        `
          INSERT INTO ${LINKS_TABLE}
          (id, org_id, equipment_id, task_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
        link.id,
        link.org_id,
        link.equipment_id,
        link.task_id,
        link.created_at
      );
    } catch {
      // Duplicate link -> return the existing one.
      const existing = await db.getFirstAsync<LinkRow>(
        `
          SELECT *
          FROM ${LINKS_TABLE}
          WHERE org_id = ?
            AND equipment_id = ?
            AND task_id = ?
          LIMIT 1
        `,
        orgId,
        equipmentId,
        taskId
      );

      if (existing) {
        return mapLinkRow(existing);
      }

      throw new Error('Impossible de lier la tâche (contrainte).');
    }

    await enqueueLinkOperation(link, 'CREATE');
    return link;
  },

  async unlinkTask(input: { org_id: string; equipment_id: string; task_id: string }) {
    await ensureSetup();
    const orgId = normalizeText(input.org_id);
    const equipmentId = normalizeText(input.equipment_id);
    const taskId = normalizeText(input.task_id);

    if (!orgId || !equipmentId || !taskId) {
      return;
    }

    const db = await getDb();
    const existing = await db.getFirstAsync<LinkRow>(
      `
        SELECT *
        FROM ${LINKS_TABLE}
        WHERE org_id = ?
          AND equipment_id = ?
          AND task_id = ?
        LIMIT 1
      `,
      orgId,
      equipmentId,
      taskId
    );

    if (!existing) {
      return;
    }

    await db.runAsync(
      `
        DELETE FROM ${LINKS_TABLE}
        WHERE id = ?
      `,
      existing.id
    );

    await enqueueLinkOperation(mapLinkRow(existing), 'DELETE');
  },

  async listTaskLinks(equipmentId: string, orgId: string) {
    await ensureSetup();
    const eId = normalizeText(equipmentId);
    const oId = normalizeText(orgId);
    if (!eId || !oId) {
      return [] as EquipmentTaskLink[];
    }

    const db = await getDb();
    const rows = await db.getAllAsync<LinkRow>(
      `
        SELECT *
        FROM ${LINKS_TABLE}
        WHERE org_id = ?
          AND equipment_id = ?
        ORDER BY created_at DESC
      `,
      oId,
      eId
    );

    return rows.map(mapLinkRow);
  },

  async listLinkedTasks(equipmentId: string, orgId: string) {
    const links = await this.listTaskLinks(equipmentId, orgId);
    const resolved = await Promise.all(links.map((link) => tasks.getById(link.task_id)));
    return resolved.filter((item): item is NonNullable<typeof item> => Boolean(item));
  }
};

