import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { geo } from '../geo-context';
import { offlineDB } from '../offline/outbox';
import { WasteCategory, WasteCreateInput, WasteCsvExportResult, WasteEntry, WasteListFilters, WasteTotals, WasteUpdatePatch } from './types';

const DB_NAME = 'conformeo.db';
const TABLE_NAME = 'waste_entries';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type WasteRow = {
  id: string;
  org_id: string;
  project_id: string;
  category: string;
  length_m: number;
  width_m: number;
  height_m: number;
  volume_m3: number;
  note: string | null;
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

function ensureFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ensurePositiveMeters(value: unknown, label: string) {
  if (!ensureFiniteNumber(value) || value <= 0) {
    throw new Error(`${label} invalide (doit etre > 0).`);
  }
  return value as number;
}

function computeVolumeM3(length_m: number, width_m: number, height_m: number) {
  const volume = length_m * width_m * height_m;
  // Round to 3 decimals for readability (still stored as number)
  return Math.max(0, Math.round(volume * 1000) / 1000);
}

function mapRow(row: WasteRow): WasteEntry {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    category: row.category,
    length_m: row.length_m,
    width_m: row.width_m,
    height_m: row.height_m,
    volume_m3: row.volume_m3,
    note: toOptional(row.note),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
  };
}

function defaultCategories(): WasteCategory[] {
  return ['GRAVATS', 'BOIS', 'METAUX', 'PLASTIQUES', 'PLATRE', 'DIB', 'DEEE', 'AUTRE'];
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

function wasteRootDir() {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error('FileSystem documentDirectory unavailable on this device.');
  }
  return `${base}waste_volume/`;
}

function exportsDir() {
  return `${wasteRootDir()}exports/`;
}

async function ensureDirectories() {
  await FileSystem.makeDirectoryAsync(wasteRootDir(), { intermediates: true });
  await FileSystem.makeDirectoryAsync(exportsDir(), { intermediates: true });
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      await ensureDirectories();
      const db = await getDb();
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          category TEXT NOT NULL,
          length_m REAL NOT NULL,
          width_m REAL NOT NULL,
          height_m REAL NOT NULL,
          volume_m3 REAL NOT NULL,
          note TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_waste_org_project_created
          ON ${TABLE_NAME}(org_id, project_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_waste_org_category_created
          ON ${TABLE_NAME}(org_id, category, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_waste_deleted
          ON ${TABLE_NAME}(deleted_at);
      `);
    })();
  }
  return setupPromise;
}

async function getRowById(id: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<WasteRow>(
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

async function upsert(entry: WasteEntry) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${TABLE_NAME}
      (
        id, org_id, project_id, category,
        length_m, width_m, height_m, volume_m3,
        note,
        created_by, created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    entry.id,
    entry.org_id,
    entry.project_id,
    String(entry.category),
    entry.length_m,
    entry.width_m,
    entry.height_m,
    entry.volume_m3,
    entry.note ?? null,
    entry.created_by,
    entry.created_at,
    entry.updated_at,
    entry.deleted_at ?? null
  );

  return entry;
}

async function enqueueOperation(entry: WasteEntry, type: 'CREATE' | 'UPDATE' | 'DELETE', payload: Record<string, unknown>) {
  await offlineDB.enqueueOperation({
    entity: 'waste_entries',
    entity_id: entry.id,
    type,
    payload: {
      ...payload,
      id: entry.id,
      org_id: entry.org_id,
      orgId: entry.org_id,
      project_id: entry.project_id,
      updated_at: entry.updated_at
    }
  });
}

function csvEscape(value: unknown, delimiter: string) {
  const raw = value === null || value === undefined ? '' : String(value);
  const needsQuotes = raw.includes(delimiter) || raw.includes('\n') || raw.includes('\r') || raw.includes('"');
  if (!needsQuotes) {
    return raw;
  }
  return `"${raw.replace(/\"/g, '""')}"`;
}

async function writeCsvFile(fileName: string, content: string) {
  const path = `${exportsDir()}${fileName}`;
  await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 });
  const info = await FileSystem.getInfoAsync(path);
  return { path, size_bytes: info.exists && typeof info.size === 'number' ? info.size : content.length };
}

export const waste = {
  categories: defaultCategories(),

  computeVolume(length_m: number, width_m: number, height_m: number) {
    return computeVolumeM3(length_m, width_m, height_m);
  },

  async create(input: WasteCreateInput): Promise<WasteEntry> {
    await ensureSetup();

    const orgId = normalizeText(input.org_id);
    const projectId = normalizeText(input.project_id);
    const createdBy = normalizeText(input.created_by);
    const category = normalizeText(String(input.category)) || 'AUTRE';

    if (!orgId) throw new Error('org_id requis.');
    if (!projectId) throw new Error('project_id requis.');
    if (!createdBy) throw new Error('created_by requis.');

    const length = ensurePositiveMeters(input.length_m, 'length_m');
    const width = ensurePositiveMeters(input.width_m, 'width_m');
    const height = ensurePositiveMeters(input.height_m, 'height_m');

    const createdAt = nowIso();
    const entry: WasteEntry = {
      id: normalizeText(input.id) || createUuid(),
      org_id: orgId,
      project_id: projectId,
      category,
      length_m: length,
      width_m: width,
      height_m: height,
      volume_m3: computeVolumeM3(length, width, height),
      note: toOptional(input.note),
      created_by: createdBy,
      created_at: createdAt,
      updated_at: createdAt
    };

    await upsert(entry);
    await enqueueOperation(entry, 'CREATE', { data: entry });

    void geo.capture({
      entity: 'WASTE_ENTRY',
      entity_id: entry.id,
      org_id: entry.org_id,
      user_id: entry.created_by,
      project_id: entry.project_id
    });

    return entry;
  },

  async update(id: string, patch: WasteUpdatePatch): Promise<WasteEntry> {
    const row = await getRowById(id, true);
    if (!row) {
      throw new Error('Entrée déchets introuvable.');
    }

    const current = mapRow(row);
    if (current.deleted_at) {
      throw new Error('Entrée supprimée.');
    }

    const nextCategory = patch.category !== undefined ? normalizeText(String(patch.category)) : String(current.category);
    const nextLength = patch.length_m !== undefined ? ensurePositiveMeters(patch.length_m, 'length_m') : current.length_m;
    const nextWidth = patch.width_m !== undefined ? ensurePositiveMeters(patch.width_m, 'width_m') : current.width_m;
    const nextHeight = patch.height_m !== undefined ? ensurePositiveMeters(patch.height_m, 'height_m') : current.height_m;

    const next: WasteEntry = {
      ...current,
      category: nextCategory || 'AUTRE',
      length_m: nextLength,
      width_m: nextWidth,
      height_m: nextHeight,
      volume_m3: computeVolumeM3(nextLength, nextWidth, nextHeight),
      note: patch.note !== undefined ? toOptional(patch.note) : current.note,
      deleted_at: patch.deleted_at !== undefined ? toOptional(patch.deleted_at) : current.deleted_at,
      updated_at: nowIso()
    };

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

    const next: WasteEntry = {
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

  async listByProject(projectId: string, filters: WasteListFilters): Promise<WasteEntry[]> {
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

    if (filters.category && filters.category !== 'ALL') {
      where.push('category = ?');
      params.push(String(filters.category));
    }

    if (filters.created_from) {
      where.push('created_at >= ?');
      params.push(filters.created_from);
    }

    if (filters.created_to) {
      where.push('created_at <= ?');
      params.push(filters.created_to);
    }

    const db = await getDb();
    const rows = await db.getAllAsync<WasteRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      ...params,
      limit,
      offset
    );

    return rows.map(mapRow);
  },

  async computeTotals(projectId: string, filters: WasteListFilters): Promise<WasteTotals> {
    const rows = await this.listByProject(projectId, { ...filters, limit: MAX_LIMIT, offset: 0 });
    const totals: WasteTotals = { total_m3: 0, by_category: {} };

    for (const row of rows) {
      totals.total_m3 += row.volume_m3;
      const key = String(row.category || 'AUTRE');
      totals.by_category[key] = (totals.by_category[key] ?? 0) + row.volume_m3;
    }

    totals.total_m3 = Math.round(totals.total_m3 * 1000) / 1000;
    for (const [key, value] of Object.entries(totals.by_category)) {
      totals.by_category[key] = Math.round(value * 1000) / 1000;
    }

    return totals;
  },

  async exportCsv(projectId: string, filters: WasteListFilters, opts?: { delimiter?: ';' | ',' }): Promise<WasteCsvExportResult> {
    await ensureSetup();

    const delimiter = opts?.delimiter ?? ';';
    const rows = await this.listByProject(projectId, { ...filters, limit: MAX_LIMIT, offset: 0 });

    const header = [
      'id',
      'org_id',
      'project_id',
      'category',
      'volume_m3',
      'length_m',
      'width_m',
      'height_m',
      'note',
      'created_by',
      'created_at'
    ].join(delimiter);

    const lines = rows.map((row) => {
      return [
        csvEscape(row.id, delimiter),
        csvEscape(row.org_id, delimiter),
        csvEscape(row.project_id, delimiter),
        csvEscape(row.category, delimiter),
        csvEscape(row.volume_m3, delimiter),
        csvEscape(row.length_m, delimiter),
        csvEscape(row.width_m, delimiter),
        csvEscape(row.height_m, delimiter),
        csvEscape(row.note ?? '', delimiter),
        csvEscape(row.created_by, delimiter),
        csvEscape(row.created_at, delimiter)
      ].join(delimiter);
    });

    const content = [header, ...lines].join('\n');
    const createdAt = nowIso();
    const fileName = `waste_${projectId}_${createdAt.slice(0, 10)}_${createUuid()}.csv`;
    const file = await writeCsvFile(fileName, content);

    return {
      path: file.path,
      size_bytes: file.size_bytes,
      created_at: createdAt,
      row_count: rows.length
    };
  }
};
