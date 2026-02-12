import * as SQLite from 'expo-sqlite';
import {
  SearchApi,
  SearchContext,
  SearchEntity,
  SearchGroup,
  SearchQueryOptions,
  SearchQueryResponse,
  SearchResult,
  SearchScope,
  SearchSuggestionOptions
} from './types';

const DB_NAME = 'conformeo.db';

const SEARCH_INDEX_TABLE = 'search_index';
const TASKS_TABLE = 'tasks';
const DOCUMENTS_TABLE = 'documents';
const MEDIA_TABLE = 'media_assets';
const EXPORTS_TABLE = 'export_jobs';

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const DEFAULT_SUGGESTIONS_LIMIT = 8;
const MAX_SUGGESTIONS_LIMIT = 20;

const ALLOWED_ENTITIES: SearchEntity[] = ['TASK', 'DOCUMENT', 'MEDIA', 'EXPORT'];

const RESULT_GROUP_ORDER: SearchEntity[] = ['TASK', 'DOCUMENT', 'MEDIA', 'EXPORT'];

type CountRow = { count: number };

type SearchIndexRow = {
  id: string;
  org_id: string;
  entity: SearchEntity;
  entity_id: string;
  project_id: string | null;
  title: string;
  body: string;
  tags_json: string;
  updated_at: string;
  title_norm: string;
  body_norm: string;
  tags_norm: string;
  score: number;
};

type SearchEntry = {
  id: string;
  org_id: string;
  entity: SearchEntity;
  entity_id: string;
  project_id: string | null;
  title: string;
  body: string;
  tags: string[];
  updated_at: string;
};

type TaskRow = {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  tags_json: string;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
};

type DocumentRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  doc_type: string;
  status: string;
  tags_json: string;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
};

type MediaRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  task_id: string | null;
  tag: string | null;
  mime: string;
  upload_status: string;
  created_at: string;
};

type ExportRow = {
  id: string;
  org_id: string;
  project_id: string;
  type: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  last_error: string | null;
};

type SuggestRow = {
  title: string;
  tags_json: string;
  updated_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;
let bootstrapPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextProjectId: string | null = null;
let contextUserId: string | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function toOptional(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function parseJsonArray(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
    }
  } catch {
    return [] as string[];
  }

  return [] as string[];
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function tokenizeQuery(q: string) {
  return unique(
    normalizeLower(q)
      .split(/\s+/)
      .filter((token) => token.length >= 2)
      .slice(0, 8)
  );
}

function escapeLike(input: string) {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyHighlights(input: string, tokens: string[]) {
  let output = input;

  const orderedTokens = [...tokens].sort((left, right) => right.length - left.length);
  for (const token of orderedTokens) {
    const regex = new RegExp(escapeRegExp(token), 'gi');
    output = output.replace(regex, (match) => `[[${match}]]`);
  }

  return output;
}

function snippet(input: string, tokens: string[], maxLength = 180) {
  const text = normalizeText(input);
  if (text.length <= maxLength) {
    return text;
  }

  const lowered = text.toLowerCase();
  let firstMatch = -1;

  for (const token of tokens) {
    const index = lowered.indexOf(token.toLowerCase());
    if (index >= 0 && (firstMatch === -1 || index < firstMatch)) {
      firstMatch = index;
    }
  }

  if (firstMatch === -1) {
    return `${text.slice(0, maxLength - 1)}…`;
  }

  const start = Math.max(0, firstMatch - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);

  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';

  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function buildSearchId(entity: SearchEntity, entityId: string) {
  return `${entity}:${entityId}`;
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const cleaned = normalizeLower(tag);
    if (cleaned.length === 0 || seen.has(cleaned)) {
      continue;
    }

    seen.add(cleaned);
    normalized.push(cleaned);
  }

  return normalized;
}

function resolveScope(scope?: Partial<SearchScope>) {
  const orgId = normalizeText(scope?.orgId) || contextOrgId;
  if (!orgId) {
    throw new Error('orgId est requis pour search.');
  }

  const projectId = normalizeText(scope?.projectId) || contextProjectId || undefined;

  return {
    orgId,
    projectId
  } satisfies SearchScope;
}

function sanitizeEntities(entities?: SearchEntity[]) {
  if (!entities || entities.length === 0) {
    return [] as SearchEntity[];
  }

  return unique(entities).filter((entity): entity is SearchEntity => ALLOWED_ENTITIES.includes(entity));
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }

  return dbPromise;
}

async function tableExists(db: SQLite.SQLiteDatabase, tableName: string) {
  const row = await db.getFirstAsync<CountRow>(
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

        CREATE TABLE IF NOT EXISTS ${SEARCH_INDEX_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          project_id TEXT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          title_norm TEXT NOT NULL,
          body_norm TEXT NOT NULL,
          tags_norm TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_search_index_entity_id
          ON ${SEARCH_INDEX_TABLE}(entity, entity_id);

        CREATE INDEX IF NOT EXISTS idx_search_index_org_entity_updated
          ON ${SEARCH_INDEX_TABLE}(org_id, entity, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_search_index_org_project_updated
          ON ${SEARCH_INDEX_TABLE}(org_id, project_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_search_index_org_title_norm
          ON ${SEARCH_INDEX_TABLE}(org_id, title_norm);

        CREATE INDEX IF NOT EXISTS idx_search_index_org_body_norm
          ON ${SEARCH_INDEX_TABLE}(org_id, body_norm);

        CREATE INDEX IF NOT EXISTS idx_search_index_org_tags_norm
          ON ${SEARCH_INDEX_TABLE}(org_id, tags_norm);
      `);
    })();
  }

  return setupPromise;
}

async function installTaskTriggers(db: SQLite.SQLiteDatabase) {
  if (!(await tableExists(db, TASKS_TABLE))) {
    return;
  }

  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS trg_search_tasks_insert
    AFTER INSERT ON ${TASKS_TABLE}
    WHEN NEW.deleted_at IS NULL
    BEGIN
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES
      (
        'TASK:' || NEW.id,
        NEW.org_id,
        'TASK',
        NEW.id,
        NEW.project_id,
        COALESCE(NEW.title, ''),
        TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.priority, '')),
        COALESCE(NEW.tags_json, '[]'),
        COALESCE(NEW.updated_at, NEW.created_at, datetime('now')),
        LOWER(COALESCE(NEW.title, '')),
        LOWER(TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.priority, ''))),
        LOWER(COALESCE(NEW.tags_json, '[]'))
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_tasks_update_upsert
    AFTER UPDATE ON ${TASKS_TABLE}
    WHEN NEW.deleted_at IS NULL
    BEGIN
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES
      (
        'TASK:' || NEW.id,
        NEW.org_id,
        'TASK',
        NEW.id,
        NEW.project_id,
        COALESCE(NEW.title, ''),
        TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.priority, '')),
        COALESCE(NEW.tags_json, '[]'),
        COALESCE(NEW.updated_at, NEW.created_at, datetime('now')),
        LOWER(COALESCE(NEW.title, '')),
        LOWER(TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.priority, ''))),
        LOWER(COALESCE(NEW.tags_json, '[]'))
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_tasks_update_delete
    AFTER UPDATE ON ${TASKS_TABLE}
    WHEN NEW.deleted_at IS NOT NULL
    BEGIN
      DELETE FROM ${SEARCH_INDEX_TABLE} WHERE id = 'TASK:' || NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_tasks_delete
    AFTER DELETE ON ${TASKS_TABLE}
    BEGIN
      DELETE FROM ${SEARCH_INDEX_TABLE} WHERE id = 'TASK:' || OLD.id;
    END;
  `);
}

async function installDocumentTriggers(db: SQLite.SQLiteDatabase) {
  if (!(await tableExists(db, DOCUMENTS_TABLE))) {
    return;
  }

  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS trg_search_documents_insert
    AFTER INSERT ON ${DOCUMENTS_TABLE}
    WHEN NEW.deleted_at IS NULL
    BEGIN
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES
      (
        'DOCUMENT:' || NEW.id,
        NEW.org_id,
        'DOCUMENT',
        NEW.id,
        NEW.project_id,
        COALESCE(NEW.title, ''),
        TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.doc_type, '') || ' ' || COALESCE(NEW.status, '')),
        COALESCE(NEW.tags_json, '[]'),
        COALESCE(NEW.updated_at, NEW.created_at, datetime('now')),
        LOWER(COALESCE(NEW.title, '')),
        LOWER(TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.doc_type, '') || ' ' || COALESCE(NEW.status, ''))),
        LOWER(COALESCE(NEW.tags_json, '[]'))
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_documents_update_upsert
    AFTER UPDATE ON ${DOCUMENTS_TABLE}
    WHEN NEW.deleted_at IS NULL
    BEGIN
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES
      (
        'DOCUMENT:' || NEW.id,
        NEW.org_id,
        'DOCUMENT',
        NEW.id,
        NEW.project_id,
        COALESCE(NEW.title, ''),
        TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.doc_type, '') || ' ' || COALESCE(NEW.status, '')),
        COALESCE(NEW.tags_json, '[]'),
        COALESCE(NEW.updated_at, NEW.created_at, datetime('now')),
        LOWER(COALESCE(NEW.title, '')),
        LOWER(TRIM(COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.doc_type, '') || ' ' || COALESCE(NEW.status, ''))),
        LOWER(COALESCE(NEW.tags_json, '[]'))
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_documents_update_delete
    AFTER UPDATE ON ${DOCUMENTS_TABLE}
    WHEN NEW.deleted_at IS NOT NULL
    BEGIN
      DELETE FROM ${SEARCH_INDEX_TABLE} WHERE id = 'DOCUMENT:' || NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_documents_delete
    AFTER DELETE ON ${DOCUMENTS_TABLE}
    BEGIN
      DELETE FROM ${SEARCH_INDEX_TABLE} WHERE id = 'DOCUMENT:' || OLD.id;
    END;
  `);
}

async function installMediaTriggers(db: SQLite.SQLiteDatabase) {
  if (!(await tableExists(db, MEDIA_TABLE))) {
    return;
  }

  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS trg_search_media_insert
    AFTER INSERT ON ${MEDIA_TABLE}
    BEGIN
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES
      (
        'MEDIA:' || NEW.id,
        NEW.org_id,
        'MEDIA',
        NEW.id,
        NEW.project_id,
        COALESCE(NULLIF(TRIM(NEW.tag), ''), 'Preuve ' || NEW.id),
        TRIM(COALESCE(NEW.mime, '') || ' ' || COALESCE(NEW.upload_status, '') || ' ' || COALESCE(NEW.task_id, '')),
        CASE WHEN NEW.tag IS NULL OR LENGTH(TRIM(NEW.tag)) = 0 THEN '[]' ELSE json_array(LOWER(TRIM(NEW.tag))) END,
        COALESCE(NEW.created_at, datetime('now')),
        LOWER(COALESCE(NULLIF(TRIM(NEW.tag), ''), 'Preuve ' || NEW.id)),
        LOWER(TRIM(COALESCE(NEW.mime, '') || ' ' || COALESCE(NEW.upload_status, '') || ' ' || COALESCE(NEW.task_id, ''))),
        LOWER(CASE WHEN NEW.tag IS NULL OR LENGTH(TRIM(NEW.tag)) = 0 THEN '[]' ELSE json_array(LOWER(TRIM(NEW.tag))) END)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_media_update
    AFTER UPDATE ON ${MEDIA_TABLE}
    BEGIN
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES
      (
        'MEDIA:' || NEW.id,
        NEW.org_id,
        'MEDIA',
        NEW.id,
        NEW.project_id,
        COALESCE(NULLIF(TRIM(NEW.tag), ''), 'Preuve ' || NEW.id),
        TRIM(COALESCE(NEW.mime, '') || ' ' || COALESCE(NEW.upload_status, '') || ' ' || COALESCE(NEW.task_id, '')),
        CASE WHEN NEW.tag IS NULL OR LENGTH(TRIM(NEW.tag)) = 0 THEN '[]' ELSE json_array(LOWER(TRIM(NEW.tag))) END,
        COALESCE(NEW.created_at, datetime('now')),
        LOWER(COALESCE(NULLIF(TRIM(NEW.tag), ''), 'Preuve ' || NEW.id)),
        LOWER(TRIM(COALESCE(NEW.mime, '') || ' ' || COALESCE(NEW.upload_status, '') || ' ' || COALESCE(NEW.task_id, ''))),
        LOWER(CASE WHEN NEW.tag IS NULL OR LENGTH(TRIM(NEW.tag)) = 0 THEN '[]' ELSE json_array(LOWER(TRIM(NEW.tag))) END)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_media_delete
    AFTER DELETE ON ${MEDIA_TABLE}
    BEGIN
      DELETE FROM ${SEARCH_INDEX_TABLE} WHERE id = 'MEDIA:' || OLD.id;
    END;
  `);
}

async function installExportTriggers(db: SQLite.SQLiteDatabase) {
  if (!(await tableExists(db, EXPORTS_TABLE))) {
    return;
  }

  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS trg_search_exports_insert
    AFTER INSERT ON ${EXPORTS_TABLE}
    BEGIN
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES
      (
        'EXPORT:' || NEW.id,
        NEW.org_id,
        'EXPORT',
        NEW.id,
        NEW.project_id,
        CASE
          WHEN NEW.type = 'CONTROL_PACK' THEN 'Pack controle'
          WHEN NEW.type = 'DOE_ZIP' THEN 'Dossier DOE'
          ELSE 'Rapport chantier'
        END,
        TRIM(COALESCE(NEW.type, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.last_error, '')),
        '[]',
        COALESCE(NEW.finished_at, NEW.created_at, datetime('now')),
        LOWER(
          CASE
            WHEN NEW.type = 'CONTROL_PACK' THEN 'Pack controle'
            WHEN NEW.type = 'DOE_ZIP' THEN 'Dossier DOE'
            ELSE 'Rapport chantier'
          END
        ),
        LOWER(TRIM(COALESCE(NEW.type, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.last_error, ''))),
        '[]'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_exports_update
    AFTER UPDATE ON ${EXPORTS_TABLE}
    BEGIN
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES
      (
        'EXPORT:' || NEW.id,
        NEW.org_id,
        'EXPORT',
        NEW.id,
        NEW.project_id,
        CASE
          WHEN NEW.type = 'CONTROL_PACK' THEN 'Pack controle'
          WHEN NEW.type = 'DOE_ZIP' THEN 'Dossier DOE'
          ELSE 'Rapport chantier'
        END,
        TRIM(COALESCE(NEW.type, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.last_error, '')),
        '[]',
        COALESCE(NEW.finished_at, NEW.created_at, datetime('now')),
        LOWER(
          CASE
            WHEN NEW.type = 'CONTROL_PACK' THEN 'Pack controle'
            WHEN NEW.type = 'DOE_ZIP' THEN 'Dossier DOE'
            ELSE 'Rapport chantier'
          END
        ),
        LOWER(TRIM(COALESCE(NEW.type, '') || ' ' || COALESCE(NEW.status, '') || ' ' || COALESCE(NEW.last_error, ''))),
        '[]'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_search_exports_delete
    AFTER DELETE ON ${EXPORTS_TABLE}
    BEGIN
      DELETE FROM ${SEARCH_INDEX_TABLE} WHERE id = 'EXPORT:' || OLD.id;
    END;
  `);
}

async function installEntityTriggers(db: SQLite.SQLiteDatabase) {
  await Promise.all([
    installTaskTriggers(db),
    installDocumentTriggers(db),
    installMediaTriggers(db),
    installExportTriggers(db)
  ]);
}

async function upsertIndexEntry(db: SQLite.SQLiteDatabase, entry: SearchEntry) {
  const tags = normalizeTags(entry.tags);
  const title = normalizeText(entry.title);
  const body = normalizeText(entry.body);

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    entry.id,
    entry.org_id,
    entry.entity,
    entry.entity_id,
    entry.project_id,
    title,
    body,
    JSON.stringify(tags),
    entry.updated_at,
    normalizeLower(title),
    normalizeLower(body),
    normalizeLower(JSON.stringify(tags))
  );
}

function mapTaskRowToEntry(row: TaskRow): SearchEntry | null {
  if (row.deleted_at) {
    return null;
  }

  const tags = parseJsonArray(row.tags_json);
  const body = `${normalizeText(row.description)} ${normalizeText(row.status)} ${normalizeText(row.priority)}`;

  return {
    id: buildSearchId('TASK', row.id),
    org_id: row.org_id,
    entity: 'TASK',
    entity_id: row.id,
    project_id: normalizeText(row.project_id) || null,
    title: normalizeText(row.title),
    body,
    tags,
    updated_at: toOptional(row.updated_at) ?? toOptional(row.created_at) ?? nowIso()
  };
}

function mapDocumentRowToEntry(row: DocumentRow): SearchEntry | null {
  if (row.deleted_at) {
    return null;
  }

  const tags = parseJsonArray(row.tags_json);
  const body = `${normalizeText(row.description)} ${normalizeText(row.doc_type)} ${normalizeText(row.status)}`;

  return {
    id: buildSearchId('DOCUMENT', row.id),
    org_id: row.org_id,
    entity: 'DOCUMENT',
    entity_id: row.id,
    project_id: toOptional(row.project_id) ?? null,
    title: normalizeText(row.title),
    body,
    tags,
    updated_at: toOptional(row.updated_at) ?? toOptional(row.created_at) ?? nowIso()
  };
}

function mapMediaRowToEntry(row: MediaRow): SearchEntry {
  const tag = normalizeText(row.tag);
  const tags = tag.length > 0 ? [tag] : [];
  const title = tag.length > 0 ? tag : `Preuve ${row.id.slice(0, 8)}`;

  return {
    id: buildSearchId('MEDIA', row.id),
    org_id: row.org_id,
    entity: 'MEDIA',
    entity_id: row.id,
    project_id: toOptional(row.project_id) ?? null,
    title,
    body: `${normalizeText(row.mime)} ${normalizeText(row.upload_status)} ${normalizeText(row.task_id)}`,
    tags,
    updated_at: toOptional(row.created_at) ?? nowIso()
  };
}

function exportTitle(type: string) {
  if (type === 'CONTROL_PACK') return 'Pack controle';
  if (type === 'DOE_ZIP') return 'Dossier DOE';
  return 'Rapport chantier';
}

function mapExportRowToEntry(row: ExportRow): SearchEntry {
  return {
    id: buildSearchId('EXPORT', row.id),
    org_id: row.org_id,
    entity: 'EXPORT',
    entity_id: row.id,
    project_id: normalizeText(row.project_id) || null,
    title: exportTitle(normalizeText(row.type)),
    body: `${normalizeText(row.type)} ${normalizeText(row.status)} ${normalizeText(row.last_error)}`,
    tags: [],
    updated_at: toOptional(row.finished_at) ?? toOptional(row.created_at) ?? nowIso()
  };
}

async function rebuildAllInternal(db: SQLite.SQLiteDatabase) {
  await db.runAsync(`DELETE FROM ${SEARCH_INDEX_TABLE}`);

  if (await tableExists(db, TASKS_TABLE)) {
    await db.execAsync(`
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      SELECT
        'TASK:' || id,
        org_id,
        'TASK',
        id,
        project_id,
        COALESCE(title, ''),
        TRIM(COALESCE(description, '') || ' ' || COALESCE(status, '') || ' ' || COALESCE(priority, '')),
        COALESCE(tags_json, '[]'),
        COALESCE(updated_at, created_at, datetime('now')),
        LOWER(COALESCE(title, '')),
        LOWER(TRIM(COALESCE(description, '') || ' ' || COALESCE(status, '') || ' ' || COALESCE(priority, ''))),
        LOWER(COALESCE(tags_json, '[]'))
      FROM ${TASKS_TABLE}
      WHERE deleted_at IS NULL;
    `);
  }

  if (await tableExists(db, DOCUMENTS_TABLE)) {
    await db.execAsync(`
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      SELECT
        'DOCUMENT:' || id,
        org_id,
        'DOCUMENT',
        id,
        project_id,
        COALESCE(title, ''),
        TRIM(COALESCE(description, '') || ' ' || COALESCE(doc_type, '') || ' ' || COALESCE(status, '')),
        COALESCE(tags_json, '[]'),
        COALESCE(updated_at, created_at, datetime('now')),
        LOWER(COALESCE(title, '')),
        LOWER(TRIM(COALESCE(description, '') || ' ' || COALESCE(doc_type, '') || ' ' || COALESCE(status, ''))),
        LOWER(COALESCE(tags_json, '[]'))
      FROM ${DOCUMENTS_TABLE}
      WHERE deleted_at IS NULL;
    `);
  }

  if (await tableExists(db, MEDIA_TABLE)) {
    await db.execAsync(`
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      SELECT
        'MEDIA:' || id,
        org_id,
        'MEDIA',
        id,
        project_id,
        COALESCE(NULLIF(TRIM(tag), ''), 'Preuve ' || id),
        TRIM(COALESCE(mime, '') || ' ' || COALESCE(upload_status, '') || ' ' || COALESCE(task_id, '')),
        CASE WHEN tag IS NULL OR LENGTH(TRIM(tag)) = 0 THEN '[]' ELSE json_array(LOWER(TRIM(tag))) END,
        COALESCE(created_at, datetime('now')),
        LOWER(COALESCE(NULLIF(TRIM(tag), ''), 'Preuve ' || id)),
        LOWER(TRIM(COALESCE(mime, '') || ' ' || COALESCE(upload_status, '') || ' ' || COALESCE(task_id, ''))),
        LOWER(CASE WHEN tag IS NULL OR LENGTH(TRIM(tag)) = 0 THEN '[]' ELSE json_array(LOWER(TRIM(tag))) END)
      FROM ${MEDIA_TABLE};
    `);
  }

  if (await tableExists(db, EXPORTS_TABLE)) {
    await db.execAsync(`
      INSERT OR REPLACE INTO ${SEARCH_INDEX_TABLE}
      (
        id, org_id, entity, entity_id, project_id,
        title, body, tags_json, updated_at,
        title_norm, body_norm, tags_norm
      )
      SELECT
        'EXPORT:' || id,
        org_id,
        'EXPORT',
        id,
        project_id,
        CASE
          WHEN type = 'CONTROL_PACK' THEN 'Pack controle'
          WHEN type = 'DOE_ZIP' THEN 'Dossier DOE'
          ELSE 'Rapport chantier'
        END,
        TRIM(COALESCE(type, '') || ' ' || COALESCE(status, '') || ' ' || COALESCE(last_error, '')),
        '[]',
        COALESCE(finished_at, created_at, datetime('now')),
        LOWER(
          CASE
            WHEN type = 'CONTROL_PACK' THEN 'Pack controle'
            WHEN type = 'DOE_ZIP' THEN 'Dossier DOE'
            ELSE 'Rapport chantier'
          END
        ),
        LOWER(TRIM(COALESCE(type, '') || ' ' || COALESCE(status, '') || ' ' || COALESCE(last_error, ''))),
        '[]'
      FROM ${EXPORTS_TABLE};
    `);
  }

  const countRow = await db.getFirstAsync<CountRow>(`SELECT COUNT(*) AS count FROM ${SEARCH_INDEX_TABLE}`);
  return countRow?.count ?? 0;
}

async function ensureBootstrapped() {
  await ensureSetup();

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const db = await getDb();
      await installEntityTriggers(db);

      const row = await db.getFirstAsync<CountRow>(`SELECT COUNT(*) AS count FROM ${SEARCH_INDEX_TABLE}`);
      const count = row?.count ?? 0;
      if (count === 0) {
        await rebuildAllInternal(db);
      }
    })();
  }

  return bootstrapPromise;
}

function mapRowToResult(row: SearchIndexRow, tokens: string[]): SearchResult {
  const tags = parseJsonArray(row.tags_json);
  const title = normalizeText(row.title);
  const body = normalizeText(row.body);

  return {
    id: row.id,
    org_id: row.org_id,
    entity: row.entity,
    entity_id: row.entity_id,
    project_id: toOptional(row.project_id),
    title,
    body,
    tags,
    updated_at: row.updated_at,
    score: Number(row.score) || 0,
    title_highlight: applyHighlights(title, tokens),
    body_highlight: applyHighlights(snippet(body, tokens), tokens)
  };
}

function buildGroups(results: SearchResult[]) {
  const byEntity = new Map<SearchEntity, SearchResult[]>();

  for (const row of results) {
    const list = byEntity.get(row.entity) ?? [];
    list.push(row);
    byEntity.set(row.entity, list);
  }

  const groups: SearchGroup[] = [];

  for (const entity of RESULT_GROUP_ORDER) {
    const items = byEntity.get(entity) ?? [];
    if (items.length === 0) {
      continue;
    }

    groups.push({
      entity,
      count: items.length,
      items
    });
  }

  return groups;
}

function entityTable(entity: SearchEntity) {
  if (entity === 'TASK') return TASKS_TABLE;
  if (entity === 'DOCUMENT') return DOCUMENTS_TABLE;
  if (entity === 'MEDIA') return MEDIA_TABLE;
  return EXPORTS_TABLE;
}

async function listProjectsFromTable(db: SQLite.SQLiteDatabase, tableName: string, orgId: string) {
  if (!(await tableExists(db, tableName))) {
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

export const search: SearchApi = {
  setContext(context: Partial<SearchContext>) {
    contextOrgId = normalizeText(context.org_id) || null;
    contextProjectId = normalizeText(context.project_id) || null;
    contextUserId = normalizeText(context.user_id) || null;
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

  async listProjects(scope?: Partial<SearchScope>) {
    await ensureBootstrapped();
    const db = await getDb();
    await installEntityTriggers(db);

    const resolvedScope = resolveScope(scope);

    const [taskProjects, documentProjects, mediaProjects, exportProjects] = await Promise.all([
      listProjectsFromTable(db, TASKS_TABLE, resolvedScope.orgId),
      listProjectsFromTable(db, DOCUMENTS_TABLE, resolvedScope.orgId),
      listProjectsFromTable(db, MEDIA_TABLE, resolvedScope.orgId),
      listProjectsFromTable(db, EXPORTS_TABLE, resolvedScope.orgId)
    ]);

    return unique([...taskProjects, ...documentProjects, ...mediaProjects, ...exportProjects]).sort((left, right) =>
      left.localeCompare(right)
    );
  },

  async query(q: string, opts: SearchQueryOptions): Promise<SearchQueryResponse> {
    const startedAt = Date.now();

    await ensureBootstrapped();
    const db = await getDb();
    await installEntityTriggers(db);

    const tokens = tokenizeQuery(q);
    const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));

    const resolvedScope = resolveScope(opts.scope);
    const entities = sanitizeEntities(opts.entities);

    if (tokens.length === 0) {
      return {
        q,
        limit,
        offset,
        total: 0,
        elapsedMs: Date.now() - startedAt,
        results: [],
        groups: []
      };
    }

    const whereParts: string[] = ['org_id = ?'];
    const whereParams: Array<string | number> = [resolvedScope.orgId];

    if (resolvedScope.projectId) {
      whereParts.push('project_id = ?');
      whereParams.push(resolvedScope.projectId);
    }

    if (entities.length > 0) {
      whereParts.push(`entity IN (${entities.map(() => '?').join(', ')})`);
      whereParams.push(...entities);
    }

    for (const token of tokens) {
      const contains = `%${escapeLike(token)}%`;
      whereParts.push(
        `(title_norm LIKE ? ESCAPE '\\' OR body_norm LIKE ? ESCAPE '\\' OR tags_norm LIKE ? ESCAPE '\\')`
      );
      whereParams.push(contains, contains, contains);
    }

    const scoreParts: string[] = [];
    const scoreParams: Array<string | number> = [];

    for (const token of tokens) {
      const exact = token;
      const prefix = `${escapeLike(token)}%`;
      const contains = `%${escapeLike(token)}%`;

      scoreParts.push(
        `(
          CASE WHEN title_norm = ? THEN 120 ELSE 0 END +
          CASE WHEN title_norm LIKE ? ESCAPE '\\' THEN 80 ELSE 0 END +
          CASE WHEN title_norm LIKE ? ESCAPE '\\' THEN 50 ELSE 0 END +
          CASE WHEN tags_norm LIKE ? ESCAPE '\\' THEN 35 ELSE 0 END +
          CASE WHEN body_norm LIKE ? ESCAPE '\\' THEN 15 ELSE 0 END
        )`
      );

      scoreParams.push(exact, prefix, contains, contains, contains);
    }

    const scoreExpression = scoreParts.length > 0 ? scoreParts.join(' + ') : '0';

    const countRow = await db.getFirstAsync<CountRow>(
      `
        SELECT COUNT(*) AS count
        FROM ${SEARCH_INDEX_TABLE}
        WHERE ${whereParts.join(' AND ')}
      `,
      ...whereParams
    );

    const rows = await db.getAllAsync<SearchIndexRow>(
      `
        SELECT
          id, org_id, entity, entity_id, project_id,
          title, body, tags_json, updated_at,
          title_norm, body_norm, tags_norm,
          (${scoreExpression}) AS score
        FROM ${SEARCH_INDEX_TABLE}
        WHERE ${whereParts.join(' AND ')}
        ORDER BY score DESC, updated_at DESC
        LIMIT ?
        OFFSET ?
      `,
      ...scoreParams,
      ...whereParams,
      limit,
      offset
    );

    const results = rows.map((row) => mapRowToResult(row, tokens));

    return {
      q,
      limit,
      offset,
      total: countRow?.count ?? 0,
      elapsedMs: Date.now() - startedAt,
      results,
      groups: buildGroups(results)
    };
  },

  async getSuggestions(prefix: string, opts: SearchSuggestionOptions) {
    await ensureBootstrapped();
    const db = await getDb();
    await installEntityTriggers(db);

    const resolvedScope = resolveScope(opts.scope);
    const normalizedPrefix = normalizeLower(prefix);
    const safeLimit = clamp(opts.limit ?? DEFAULT_SUGGESTIONS_LIMIT, 1, MAX_SUGGESTIONS_LIMIT);

    const whereParts: string[] = ['org_id = ?'];
    const whereParams: Array<string | number> = [resolvedScope.orgId];

    if (resolvedScope.projectId) {
      whereParts.push('project_id = ?');
      whereParams.push(resolvedScope.projectId);
    }

    if (normalizedPrefix.length > 0) {
      const contains = `%${escapeLike(normalizedPrefix)}%`;
      whereParts.push(
        `(title_norm LIKE ? ESCAPE '\\' OR body_norm LIKE ? ESCAPE '\\' OR tags_norm LIKE ? ESCAPE '\\')`
      );
      whereParams.push(contains, contains, contains);
    }

    const rows = await db.getAllAsync<SuggestRow>(
      `
        SELECT title, tags_json, updated_at
        FROM ${SEARCH_INDEX_TABLE}
        WHERE ${whereParts.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT 80
      `,
      ...whereParams
    );

    const suggestions: string[] = [];
    const seen = new Set<string>();

    const tryAdd = (value: string) => {
      const cleaned = normalizeText(value);
      if (cleaned.length < 2) {
        return;
      }

      const normalized = cleaned.toLowerCase();
      if (normalizedPrefix.length > 0 && !normalized.includes(normalizedPrefix)) {
        return;
      }

      if (seen.has(normalized)) {
        return;
      }

      seen.add(normalized);
      suggestions.push(cleaned);
    };

    for (const row of rows) {
      const title = normalizeText(row.title);
      if (normalizedPrefix.length > 0) {
        if (title.toLowerCase().startsWith(normalizedPrefix)) {
          tryAdd(title);
        }
      } else {
        tryAdd(title.split(' ').slice(0, 3).join(' '));
      }

      const tags = parseJsonArray(row.tags_json);
      for (const tag of tags) {
        if (normalizedPrefix.length > 0) {
          if (tag.startsWith(normalizedPrefix)) {
            tryAdd(tag);
          }
        } else {
          tryAdd(tag);
        }
      }

      if (suggestions.length >= safeLimit) {
        break;
      }
    }

    return suggestions.slice(0, safeLimit);
  },

  async reindexEntity(entity: SearchEntity, id: string) {
    await ensureBootstrapped();

    const db = await getDb();
    await installEntityTriggers(db);

    const cleanId = normalizeText(id);
    if (cleanId.length === 0) {
      throw new Error('id requis pour reindexEntity.');
    }

    if (!ALLOWED_ENTITIES.includes(entity)) {
      throw new Error(`Entité search non supportée: ${entity}`);
    }

    const sourceTable = entityTable(entity);
    if (!(await tableExists(db, sourceTable))) {
      return;
    }

    let entry: SearchEntry | null = null;

    if (entity === 'TASK') {
      const row = await db.getFirstAsync<TaskRow>(
        `
          SELECT id, org_id, project_id, title, description, status, priority, tags_json, updated_at, created_at, deleted_at
          FROM ${TASKS_TABLE}
          WHERE id = ?
          LIMIT 1
        `,
        cleanId
      );

      if (row) {
        entry = mapTaskRowToEntry(row);
      }
    }

    if (entity === 'DOCUMENT') {
      const row = await db.getFirstAsync<DocumentRow>(
        `
          SELECT id, org_id, project_id, title, description, doc_type, status, tags_json, updated_at, created_at, deleted_at
          FROM ${DOCUMENTS_TABLE}
          WHERE id = ?
          LIMIT 1
        `,
        cleanId
      );

      if (row) {
        entry = mapDocumentRowToEntry(row);
      }
    }

    if (entity === 'MEDIA') {
      const row = await db.getFirstAsync<MediaRow>(
        `
          SELECT id, org_id, project_id, task_id, tag, mime, upload_status, created_at
          FROM ${MEDIA_TABLE}
          WHERE id = ?
          LIMIT 1
        `,
        cleanId
      );

      if (row) {
        entry = mapMediaRowToEntry(row);
      }
    }

    if (entity === 'EXPORT') {
      const row = await db.getFirstAsync<ExportRow>(
        `
          SELECT id, org_id, project_id, type, status, created_at, finished_at, last_error
          FROM ${EXPORTS_TABLE}
          WHERE id = ?
          LIMIT 1
        `,
        cleanId
      );

      if (row) {
        entry = mapExportRowToEntry(row);
      }
    }

    if (!entry) {
      await db.runAsync(`DELETE FROM ${SEARCH_INDEX_TABLE} WHERE id = ?`, buildSearchId(entity, cleanId));
      return;
    }

    await upsertIndexEntry(db, entry);
  },

  async rebuildAll() {
    await ensureSetup();

    const db = await getDb();
    await installEntityTriggers(db);

    const indexed = await rebuildAllInternal(db);
    bootstrapPromise = Promise.resolve();

    return { indexed };
  }
};
