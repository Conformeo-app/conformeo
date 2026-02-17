import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import JSZip from 'jszip';
import { z } from 'zod';
import {
  BackupExportOptions,
  BackupImportMode,
  BackupImportOptions,
  BackupManifest,
  BackupManifestFile,
  BackupRecord,
  BackupStatus,
  BackupType
} from './types';

const DB_NAME = 'conformeo.db';
const BACKUPS_TABLE = 'backups';
const BACKUP_FORMAT_VERSION = 1 as const;

const BACKUP_ROOT_DIR = 'conformeo_backups';

const MAX_BACKUP_TOTAL_BYTES_WITH_MEDIA = 350 * 1024 * 1024; // safety guard

type SchemaDump = {
  tables: Array<{ name: string; sql: string }>;
  indexes: Array<{ name: string; sql: string }>;
  triggers: Array<{ name: string; sql: string }>;
};

type SqliteMasterRow = {
  name: string;
  type: 'table' | 'index' | 'trigger' | 'view';
  sql: string | null;
};

const ManifestSchema = z.object({
  format_version: z.literal(1),
  backup_id: z.string().min(8),
  org_id: z.string().min(8),
  created_at: z.string().min(10),
  created_by: z.string().optional(),
  include_media: z.boolean(),
  app: z.object({
    name: z.literal('conformeo'),
    version: z.string().optional()
  }),
  db: z.object({
    tables: z
      .array(
        z.object({
          name: z.string().min(1),
          row_count: z.number().int().nonnegative()
        })
      )
      .default([])
  }),
  files: z
    .object({
      total_count: z.number().int().nonnegative(),
      total_bytes: z.number().int().nonnegative(),
      entries: z.array(
        z.object({
          path: z.string().min(1),
          size_bytes: z.number().int().nonnegative(),
          sha256: z.string().optional()
        })
      )
    })
    .optional()
});

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

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

function requireDocumentDirectory() {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    throw new Error('FileSystem documentDirectory indisponible.');
  }
  return directory;
}

function backupsDir() {
  return `${requireDocumentDirectory()}${BACKUP_ROOT_DIR}/`;
}

function sanitizeFileStem(input: string) {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  return normalized.length > 0 ? normalized : 'backup';
}

function ensureNonEmpty(value: string, label: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} manquant.`);
  }
}

function requireContext() {
  if (!contextOrgId) {
    throw new Error('Contexte backup manquant: org_id non defini.');
  }
  return { org_id: contextOrgId, user_id: contextUserId };
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

async function setupSchema() {
  const db = await getDb();

  await FileSystem.makeDirectoryAsync(backupsDir(), { intermediates: true });

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS ${BACKUPS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('LOCAL_EXPORT', 'SERVER_SNAPSHOT')),
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
      created_at TEXT NOT NULL,
      path TEXT,
      size_bytes INTEGER,
      include_media INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_backups_org_created
      ON ${BACKUPS_TABLE}(org_id, created_at DESC);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }
  return setupPromise;
}

function mapBackupRow(row: any): BackupRecord {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    type: row.type as BackupType,
    status: row.status as BackupStatus,
    created_at: String(row.created_at),
    path: typeof row.path === 'string' && row.path.length > 0 ? row.path : undefined,
    size_bytes: typeof row.size_bytes === 'number' ? row.size_bytes : undefined,
    include_media: row.include_media === 1 || row.include_media === true,
    last_error: typeof row.last_error === 'string' && row.last_error.length > 0 ? row.last_error : undefined
  };
}

async function upsertBackup(record: BackupRecord) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${BACKUPS_TABLE}
      (id, org_id, type, status, created_at, path, size_bytes, include_media, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    record.id,
    record.org_id,
    record.type,
    record.status,
    record.created_at,
    record.path ?? null,
    record.size_bytes ?? null,
    record.include_media ? 1 : 0,
    record.last_error ?? null
  );
}

async function patchBackup(id: string, patch: Partial<BackupRecord>) {
  const current = (await backup.getById(id)) ?? null;
  if (!current) {
    throw new Error(`Backup introuvable: ${id}`);
  }

  await upsertBackup({ ...current, ...patch });
}

async function readFileSize(path: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists || info.isDirectory) {
    return 0;
  }
  return typeof info.size === 'number' ? info.size : 0;
}

function toRelativeDocumentPath(absolutePath: string) {
  const docDir = requireDocumentDirectory();

  if (absolutePath.startsWith(docDir)) {
    return absolutePath.slice(docDir.length);
  }

  const token = '/media_pipeline/';
  const tokenIndex = absolutePath.indexOf(token);
  if (tokenIndex >= 0) {
    return absolutePath.slice(tokenIndex + 1);
  }

  const token2 = '/exports_doe/';
  const token2Index = absolutePath.indexOf(token2);
  if (token2Index >= 0) {
    return absolutePath.slice(token2Index + 1);
  }

  return null;
}

function toAbsoluteDocumentPath(relativePath: string) {
  const cleaned = relativePath.replace(/^\/+/, '');
  return `${requireDocumentDirectory()}${cleaned}`;
}

function assertSafeRelativePath(path: string) {
  if (path.includes('..')) {
    throw new Error(`Chemin invalide (path traversal): ${path}`);
  }

  const cleaned = path.replace(/^\/+/, '');
  if (cleaned.length === 0) {
    throw new Error('Chemin vide.');
  }

  if (cleaned.startsWith('file:')) {
    throw new Error(`Chemin invalide: ${path}`);
  }

  return cleaned;
}

async function listSqliteObjects(): Promise<SqliteMasterRow[]> {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<SqliteMasterRow>(
    `
      SELECT name, type, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type ASC, name ASC
    `
  );

  return (rows ?? []).filter(Boolean);
}

async function tableExists(tableName: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
      LIMIT 1
    `,
    tableName
  );

  return (row?.count ?? 0) > 0;
}

async function listTableColumns(tableName: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${JSON.stringify(tableName)})`);
  return (rows ?? []).map((row) => String(row.name));
}

function hasColumn(columns: string[], columnName: string) {
  return columns.some((col) => col.toLowerCase() === columnName.toLowerCase());
}

function buildTableSelect(tableName: string, columns: string[], orgId: string | null) {
  if (!orgId) {
    return { sql: `SELECT * FROM ${JSON.stringify(tableName)}`, params: [] as Array<string> };
  }

  if (hasColumn(columns, 'org_id')) {
    return { sql: `SELECT * FROM ${JSON.stringify(tableName)} WHERE org_id = ?`, params: [orgId] };
  }

  if (tableName === 'operations_queue' && hasColumn(columns, 'payload')) {
    return {
      sql: `SELECT * FROM ${JSON.stringify(
        tableName
      )} WHERE payload LIKE ? OR payload LIKE ?`,
      params: [`%\"orgId\":\"${orgId}%`, `%\"org_id\":\"${orgId}%`]
    };
  }

  if (tableName === 'local_entities' && hasColumn(columns, 'data')) {
    return {
      sql: `SELECT * FROM ${JSON.stringify(
        tableName
      )} WHERE data LIKE ? OR data LIKE ?`,
      params: [`%\"orgId\":\"${orgId}%`, `%\"org_id\":\"${orgId}%`]
    };
  }

  return { sql: `SELECT * FROM ${JSON.stringify(tableName)}`, params: [] as Array<string> };
}

async function dumpSchema(): Promise<SchemaDump> {
  const rows = await listSqliteObjects();

  const schema: SchemaDump = { tables: [], indexes: [], triggers: [] };

  for (const row of rows) {
    if (!row.sql) {
      continue;
    }

    if (row.name === BACKUPS_TABLE) {
      continue;
    }

    if (row.type === 'table') {
      schema.tables.push({ name: row.name, sql: row.sql });
    } else if (row.type === 'index') {
      schema.indexes.push({ name: row.name, sql: row.sql });
    } else if (row.type === 'trigger') {
      schema.triggers.push({ name: row.name, sql: row.sql });
    }
  }

  return schema;
}

async function dumpTableData(orgId: string | null) {
  const db = await getDb();
  const objects = await listSqliteObjects();
  const tables = objects.filter((row) => row.type === 'table' && row.name !== BACKUPS_TABLE).map((row) => row.name);

  const result: Record<string, unknown[]> = {};

  for (const tableName of tables) {
    const columns = await listTableColumns(tableName);
    const { sql, params } = buildTableSelect(tableName, columns, orgId);
    const rows = await db.getAllAsync<any>(sql, ...params);
    result[tableName] = rows ?? [];
  }

  return result;
}

async function zipAddFileBase64(zip: JSZip, zipPath: string, absolutePath: string) {
  const base64 = await FileSystem.readAsStringAsync(absolutePath, { encoding: FileSystem.EncodingType.Base64 });
  zip.file(zipPath, base64, { base64: true });
}

async function collectMediaFiles(orgId: string) {
  const db = await getDb();

  const paths = new Set<string>();

  if (await tableExists('media_assets')) {
    const mediaRows = await db.getAllAsync<any>(
      `
        SELECT local_original_path, local_path, local_thumb_path
        FROM media_assets
        WHERE org_id = ?
      `,
      orgId
    );

    for (const row of mediaRows ?? []) {
      const candidates = [row.local_original_path, row.local_path, row.local_thumb_path].filter(
        (value) => typeof value === 'string' && value.length > 0
      ) as string[];

      for (const path of candidates) {
        paths.add(path);
      }
    }
  }

  if (await tableExists('export_jobs')) {
    const exportRows = await db.getAllAsync<any>(
      `
        SELECT local_path
        FROM export_jobs
        WHERE org_id = ?
          AND local_path IS NOT NULL
          AND local_path != ''
      `,
      orgId
    );

    for (const row of exportRows ?? []) {
      if (typeof row.local_path === 'string' && row.local_path.length > 0) {
        paths.add(row.local_path);
      }
    }
  }

  return [...paths.values()];
}

async function ensureDirForFile(relativePath: string) {
  const cleaned = assertSafeRelativePath(relativePath);
  const parts = cleaned.split('/').slice(0, -1);
  if (parts.length === 0) {
    return;
  }
  const dir = `${requireDocumentDirectory()}${parts.join('/')}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

async function normalizeImportedPaths(orgId: string) {
  const db = await getDb();

  // media_assets
  if (await tableExists('media_assets')) {
    const mediaRows = await db.getAllAsync<any>(
      `
        SELECT id, local_original_path, local_path, local_thumb_path
        FROM media_assets
        WHERE org_id = ?
      `,
      orgId
    );

    for (const row of mediaRows ?? []) {
      const patch: Record<string, unknown> = {};
      for (const key of ['local_original_path', 'local_path', 'local_thumb_path'] as const) {
        const value = typeof row[key] === 'string' ? (row[key] as string) : '';
        if (!value) continue;
        const rel = toRelativeDocumentPath(value);
        if (!rel) continue;
        patch[key] = toAbsoluteDocumentPath(rel);
      }

      if (Object.keys(patch).length === 0) {
        continue;
      }

      await db.runAsync(
        `
          UPDATE media_assets
          SET local_original_path = COALESCE(?, local_original_path),
              local_path = COALESCE(?, local_path),
              local_thumb_path = COALESCE(?, local_thumb_path)
          WHERE id = ?
        `,
        (patch.local_original_path as string | undefined) ?? null,
        (patch.local_path as string | undefined) ?? null,
        (patch.local_thumb_path as string | undefined) ?? null,
        String(row.id)
      );
    }
  }

  // export_jobs
  if (await tableExists('export_jobs')) {
    const exportRows = await db.getAllAsync<any>(
      `
        SELECT id, local_path
        FROM export_jobs
        WHERE org_id = ?
          AND local_path IS NOT NULL
          AND local_path != ''
      `,
      orgId
    );

    for (const row of exportRows ?? []) {
      const value = typeof row.local_path === 'string' ? row.local_path : '';
      if (!value) continue;
      const rel = toRelativeDocumentPath(value);
      if (!rel) continue;
      await db.runAsync(
        `
          UPDATE export_jobs
          SET local_path = ?
          WHERE id = ?
        `,
        toAbsoluteDocumentPath(rel),
        String(row.id)
      );
    }
  }
}

async function clearOrgDataForReplace(orgId: string) {
  const db = await getDb();
  const objects = await listSqliteObjects();
  const tables = objects.filter((row) => row.type === 'table').map((row) => row.name);

  // avoid wiping backups + keep SQLite internal tables already excluded by listSqliteObjects()
  const ordered = tables.filter((name) => name !== BACKUPS_TABLE);

  await db.execAsync('PRAGMA foreign_keys = OFF;');

  for (const tableName of ordered) {
    const columns = await listTableColumns(tableName);
    if (hasColumn(columns, 'org_id')) {
      await db.runAsync(`DELETE FROM ${JSON.stringify(tableName)} WHERE org_id = ?`, orgId);
      continue;
    }

    if (tableName === 'operations_queue') {
      await db.runAsync(
        `DELETE FROM ${JSON.stringify(tableName)} WHERE payload LIKE ? OR payload LIKE ?`,
        `%\"orgId\":\"${orgId}%`,
        `%\"org_id\":\"${orgId}%`
      );
      continue;
    }

    if (tableName === 'local_entities') {
      await db.runAsync(
        `DELETE FROM ${JSON.stringify(tableName)} WHERE data LIKE ? OR data LIKE ?`,
        `%\"orgId\":\"${orgId}%`,
        `%\"org_id\":\"${orgId}%`
      );
      continue;
    }
  }

  await db.execAsync('PRAGMA foreign_keys = ON;');
}

async function ensureSchemaFromDump(schema: SchemaDump) {
  const db = await getDb();

  const statements = [...schema.tables, ...schema.indexes, ...schema.triggers]
    .map((item) => item.sql)
    .filter((sql) => typeof sql === 'string' && sql.trim().length > 0);

  for (const sql of statements) {
    try {
      await db.execAsync(sql);
    } catch {
      // best-effort (table/index may already exist)
    }
  }
}

async function insertRows(tableName: string, rows: unknown[]) {
  const db = await getDb();

  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  for (const rawRow of rows) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      continue;
    }

    const row = rawRow as Record<string, unknown>;
    const columns = Object.keys(row);
    if (columns.length === 0) {
      continue;
    }

    const placeholders = columns.map(() => '?').join(', ');
    const quotedCols = columns.map((col) => `"${col.replace(/\"/g, '""')}"`).join(', ');
    const sql = `INSERT OR REPLACE INTO ${JSON.stringify(tableName)} (${quotedCols}) VALUES (${placeholders})`;

    const values = columns.map((col) => row[col] ?? null);
    await db.runAsync(sql, ...(values as any[]));
  }
}

export const backup = {
  setContext(input: { org_id?: string; user_id?: string } | null) {
    contextOrgId = input?.org_id?.trim() ? input.org_id.trim() : null;
    contextUserId = input?.user_id?.trim() ? input.user_id.trim() : null;
  },

  async getById(id: string): Promise<BackupRecord | null> {
    await ensureSetup();
    const db = await getDb();
    const row = await db.getFirstAsync<any>(
      `
        SELECT *
        FROM ${BACKUPS_TABLE}
        WHERE id = ?
        LIMIT 1
      `,
      id
    );

    return row ? mapBackupRow(row) : null;
  },

  async exportAll(opts: BackupExportOptions): Promise<BackupRecord> {
    await ensureSetup();

    const { org_id, user_id } = requireContext();
    ensureNonEmpty(org_id, 'org_id');

    const backupId = createUuid();
    const createdAt = nowIso();

    const record: BackupRecord = {
      id: backupId,
      org_id,
      type: 'LOCAL_EXPORT',
      status: 'RUNNING',
      created_at: createdAt,
      include_media: Boolean(opts.includeMedia)
    };

    await upsertBackup(record);

    try {
      const schema = await dumpSchema();
      const dataByTable = await dumpTableData(org_id);

      const zip = new JSZip();

      const tableEntries = Object.entries(dataByTable);
      const dbTablesManifest = tableEntries.map(([name, rows]) => ({ name, row_count: rows.length }));

      zip.file('manifest.json', JSON.stringify({
        format_version: BACKUP_FORMAT_VERSION,
        backup_id: backupId,
        org_id,
        created_at: createdAt,
        created_by: user_id ?? undefined,
        include_media: Boolean(opts.includeMedia),
        app: { name: 'conformeo' },
        db: { tables: dbTablesManifest }
      } satisfies BackupManifest, null, 2));

      zip.file('db/schema.json', JSON.stringify(schema, null, 2));

      for (const [tableName, rows] of tableEntries) {
        zip.file(`db/data/${tableName}.json`, JSON.stringify(rows, null, 2));
      }

      let filesManifest: BackupManifest['files'] | undefined;

      if (opts.includeMedia) {
        const mediaPaths = await collectMediaFiles(org_id);
        const entries: BackupManifestFile[] = [];
        let totalBytes = 0;

        for (const absolutePath of mediaPaths) {
          const relative = toRelativeDocumentPath(absolutePath);
          if (!relative) {
            continue;
          }

          const safeRelative = assertSafeRelativePath(relative);
          const absolute = toAbsoluteDocumentPath(safeRelative);
          const size = await readFileSize(absolute);
          if (size <= 0) {
            continue;
          }

          totalBytes += size;
          if (totalBytes > MAX_BACKUP_TOTAL_BYTES_WITH_MEDIA) {
            throw new Error(
              `Backup trop lourd (~${Math.round(totalBytes / 1024 / 1024)}MB). Refaire sans medias, ou purger.`
            );
          }

          await zipAddFileBase64(zip, `files/${safeRelative}`, absolute);
          entries.push({ path: safeRelative, size_bytes: size });
        }

        filesManifest = {
          total_count: entries.length,
          total_bytes: totalBytes,
          entries
        };

        const manifestRaw = zip.file('manifest.json');
        if (manifestRaw) {
          const parsed = ManifestSchema.parse(
            JSON.parse(await manifestRaw.async('text')) as unknown
          ) as BackupManifest;
          zip.file(
            'manifest.json',
            JSON.stringify(
              { ...parsed, files: filesManifest } satisfies BackupManifest,
              null,
              2
            )
          );
        }
      }

      const zipBase64 = await zip.generateAsync({
        type: 'base64',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      const datePart = createdAt.slice(0, 10).replace(/-/g, '');
      const filename = `BACKUP_${sanitizeFileStem(org_id)}_${datePart}_${backupId}.zip`;
      const finalPath = `${backupsDir()}${filename}`;

      await FileSystem.writeAsStringAsync(finalPath, zipBase64, {
        encoding: FileSystem.EncodingType.Base64
      });

      const sizeBytes = await readFileSize(finalPath);

      const done: BackupRecord = {
        ...record,
        status: 'DONE',
        path: finalPath,
        size_bytes: sizeBytes
      };

      await upsertBackup(done);
      return done;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup export error';
      await patchBackup(backupId, { status: 'FAILED', last_error: message });
      throw new Error(message);
    }
  },

  async import(filePath: string, options: BackupImportOptions = {}): Promise<void> {
    await ensureSetup();

    const { org_id } = requireContext();
    ensureNonEmpty(org_id, 'org_id');

    const mode: BackupImportMode = options.mode ?? 'MERGE';

    const base64 = await FileSystem.readAsStringAsync(filePath, { encoding: FileSystem.EncodingType.Base64 });
    const zip = await JSZip.loadAsync(base64, { base64: true });

    const manifestText = await zip.file('manifest.json')?.async('text');
    if (!manifestText) {
      throw new Error('Backup invalide: manifest.json manquant.');
    }

    const manifest = ManifestSchema.parse(JSON.parse(manifestText) as unknown) as BackupManifest;

    if (manifest.format_version !== BACKUP_FORMAT_VERSION) {
      throw new Error(`Backup incompatible (format_version=${manifest.format_version}).`);
    }

    if (manifest.org_id !== org_id) {
      throw new Error(`Backup interdit: org_id mismatch (${manifest.org_id} != ${org_id}).`);
    }

    const schemaText = await zip.file('db/schema.json')?.async('text');
    if (!schemaText) {
      throw new Error('Backup invalide: db/schema.json manquant.');
    }

    const schema = JSON.parse(schemaText) as SchemaDump;
    await ensureSchemaFromDump(schema);

    if (mode === 'REPLACE') {
      await clearOrgDataForReplace(org_id);
    }

    const db = await getDb();
    await db.execAsync('BEGIN;');

    try {
      for (const table of manifest.db.tables) {
        const file = zip.file(`db/data/${table.name}.json`);
        if (!file) {
          continue;
        }

        const text = await file.async('text');
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error(`Backup invalide: ${table.name}.json n'est pas un tableau.`);
        }

        await insertRows(table.name, parsed);
      }

      await db.execAsync('COMMIT;');
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }

    if (manifest.include_media && manifest.files?.entries?.length) {
      for (const entry of manifest.files.entries) {
        const safeRelative = assertSafeRelativePath(entry.path);
        const file = zip.file(`files/${safeRelative}`);
        if (!file) {
          continue;
        }

        await ensureDirForFile(safeRelative);
        const payloadBase64 = await file.async('base64');
        await FileSystem.writeAsStringAsync(toAbsoluteDocumentPath(safeRelative), payloadBase64, {
          encoding: FileSystem.EncodingType.Base64
        });
      }
    }

    await normalizeImportedPaths(org_id);
  },

  async list(): Promise<BackupRecord[]> {
    await ensureSetup();
    const { org_id } = requireContext();

    const db = await getDb();
    const rows = await db.getAllAsync<any>(
      `
        SELECT *
        FROM ${BACKUPS_TABLE}
        WHERE org_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `,
      org_id
    );

    return (rows ?? []).map(mapBackupRow);
  },

  async delete(id: string): Promise<void> {
    await ensureSetup();

    const record = await backup.getById(id);
    if (!record) {
      return;
    }

    if (record.path) {
      await FileSystem.deleteAsync(record.path, { idempotent: true });
    }

    const db = await getDb();
    await db.runAsync(`DELETE FROM ${BACKUPS_TABLE} WHERE id = ?`, id);
  }
};

export const snapshot = {
  async createServerSnapshot() {
    throw new Error('Snapshots serveur: v1 (non implemente).');
  },

  async restore() {
    throw new Error('Restore serveur: v1 (non implemente).');
  }
};
