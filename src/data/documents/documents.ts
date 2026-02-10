import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { media } from '../media';
import { offlineDB } from '../offline/outbox';
import {
  AddVersionContext,
  Document,
  DocumentCreateInput,
  DocumentLink,
  DocumentsListFilters,
  DocumentStatus,
  DocumentType,
  DocumentUpdatePatch,
  DocumentVersion,
  DocumentScope,
  LinkedEntity
} from './types';

const DB_NAME = 'conformeo.db';
const DOCUMENTS_TABLE = 'documents';
const VERSIONS_TABLE = 'document_versions';
const LINKS_TABLE = 'document_links';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;
const MAX_VERSIONS_PER_DOCUMENT = 10;

type DocumentRow = {
  id: string;
  org_id: string;
  scope: DocumentScope;
  project_id: string | null;
  title: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  tags_json: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  active_version_id: string | null;
};

type VersionRow = {
  id: string;
  document_id: string;
  version_number: number;
  file_asset_id: string;
  file_hash: string;
  file_mime: string;
  file_size: number;
  created_at: string;
  created_by: string;
};

type LinkRow = {
  id: string;
  document_id: string;
  linked_entity: LinkedEntity;
  linked_id: string;
  created_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;
let actorUserId: string | null = null;

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

function normalizeTags(tags?: string[]) {
  if (!tags || tags.length === 0) {
    return [] as string[];
  }

  const set = new Set<string>();
  const next: string[] = [];

  for (const tag of tags) {
    const cleaned = normalizeText(tag).toLowerCase();
    if (cleaned.length === 0 || set.has(cleaned)) {
      continue;
    }

    set.add(cleaned);
    next.push(cleaned);
  }

  return next;
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

function isValidScope(scope: string): scope is DocumentScope {
  return scope === 'COMPANY' || scope === 'PROJECT';
}

function isValidType(type: string): type is DocumentType {
  return (
    type === 'PLAN' ||
    type === 'DOE' ||
    type === 'PV' ||
    type === 'REPORT' ||
    type === 'INTERNAL' ||
    type === 'OTHER'
  );
}

function isValidStatus(status: string): status is DocumentStatus {
  return status === 'DRAFT' || status === 'FINAL' || status === 'SIGNED';
}

function isValidLinkedEntity(entity: string): entity is LinkedEntity {
  return entity === 'TASK' || entity === 'PLAN_PIN' || entity === 'PROJECT' || entity === 'EXPORT';
}

function mapDocumentRow(row: DocumentRow): Document {
  return {
    id: row.id,
    org_id: row.org_id,
    scope: row.scope,
    project_id: row.project_id ?? undefined,
    title: row.title,
    doc_type: row.doc_type,
    status: row.status,
    tags: parseJsonArray<string>(row.tags_json, []),
    description: row.description ?? undefined,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
    active_version_id: row.active_version_id ?? undefined
  };
}

function mapVersionRow(row: VersionRow): DocumentVersion {
  return {
    id: row.id,
    document_id: row.document_id,
    version_number: row.version_number,
    file_asset_id: row.file_asset_id,
    file_hash: row.file_hash,
    file_mime: row.file_mime,
    file_size: row.file_size,
    created_at: row.created_at,
    created_by: row.created_by
  };
}

function mapLinkRow(row: LinkRow): DocumentLink {
  return {
    id: row.id,
    document_id: row.document_id,
    linked_entity: row.linked_entity,
    linked_id: row.linked_id,
    created_at: row.created_at
  };
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

    CREATE TABLE IF NOT EXISTS ${DOCUMENTS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('COMPANY', 'PROJECT')),
      project_id TEXT,
      title TEXT NOT NULL,
      doc_type TEXT NOT NULL CHECK (doc_type IN ('PLAN', 'DOE', 'PV', 'REPORT', 'INTERNAL', 'OTHER')),
      status TEXT NOT NULL CHECK (status IN ('DRAFT', 'FINAL', 'SIGNED')),
      tags_json TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      active_version_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_documents_org_scope_updated
      ON ${DOCUMENTS_TABLE}(org_id, scope, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_documents_project_updated
      ON ${DOCUMENTS_TABLE}(project_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_documents_deleted
      ON ${DOCUMENTS_TABLE}(deleted_at);

    CREATE TABLE IF NOT EXISTS ${VERSIONS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      file_asset_id TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_mime TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_unique_number
      ON ${VERSIONS_TABLE}(document_id, version_number);

    CREATE INDEX IF NOT EXISTS idx_document_versions_document
      ON ${VERSIONS_TABLE}(document_id, version_number DESC);

    CREATE TABLE IF NOT EXISTS ${LINKS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      linked_entity TEXT NOT NULL CHECK (linked_entity IN ('TASK', 'PLAN_PIN', 'PROJECT', 'EXPORT')),
      linked_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_links_unique
      ON ${LINKS_TABLE}(document_id, linked_entity, linked_id);

    CREATE INDEX IF NOT EXISTS idx_document_links_entity
      ON ${LINKS_TABLE}(linked_entity, linked_id);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }

  return setupPromise;
}

async function getDocumentRowById(documentId: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<DocumentRow>(
    `
      SELECT *
      FROM ${DOCUMENTS_TABLE}
      WHERE id = ?
        AND (? = 1 OR deleted_at IS NULL)
      LIMIT 1
    `,
    documentId,
    includeDeleted ? 1 : 0
  );

  return row ?? null;
}

async function ensureDocumentExists(documentId: string, includeDeleted = false) {
  const row = await getDocumentRowById(documentId, includeDeleted);
  if (!row) {
    throw new Error('Document introuvable.');
  }

  return mapDocumentRow(row);
}

async function saveDocument(document: Document) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${DOCUMENTS_TABLE}
      (
        id, org_id, scope, project_id,
        title, doc_type, status,
        tags_json, description,
        created_by, created_at, updated_at,
        deleted_at, active_version_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    document.id,
    document.org_id,
    document.scope,
    document.project_id ?? null,
    document.title,
    document.doc_type,
    document.status,
    JSON.stringify(document.tags),
    document.description ?? null,
    document.created_by,
    document.created_at,
    document.updated_at,
    document.deleted_at ?? null,
    document.active_version_id ?? null
  );

  return document;
}

async function getDocumentVersionCount(documentId: string) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM ${VERSIONS_TABLE}
      WHERE document_id = ?
    `,
    documentId
  );

  return row?.count ?? 0;
}

async function getNextVersionNumber(documentId: string) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<{ max_version: number | null }>(
    `
      SELECT MAX(version_number) AS max_version
      FROM ${VERSIONS_TABLE}
      WHERE document_id = ?
    `,
    documentId
  );

  return (row?.max_version ?? 0) + 1;
}

async function saveVersion(version: DocumentVersion) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT INTO ${VERSIONS_TABLE}
      (
        id, document_id, version_number,
        file_asset_id, file_hash, file_mime,
        file_size, created_at, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    version.id,
    version.document_id,
    version.version_number,
    version.file_asset_id,
    version.file_hash,
    version.file_mime,
    version.file_size,
    version.created_at,
    version.created_by
  );

  return version;
}

async function getVersionById(versionId: string) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<VersionRow>(
    `
      SELECT *
      FROM ${VERSIONS_TABLE}
      WHERE id = ?
      LIMIT 1
    `,
    versionId
  );

  return row ? mapVersionRow(row) : null;
}

async function computeFileHash(localPath: string) {
  const fileData = await FileSystem.readAsStringAsync(localPath, {
    encoding: FileSystem.EncodingType.Base64
  });

  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fileData);
}

async function resolveVersionMedia(document: Document, context: AddVersionContext) {
  if (context.source === 'existing') {
    const existingId = normalizeText(context.existing_asset_id);
    if (!existingId) {
      throw new Error('existing_asset_id est requis quand source=existing.');
    }

    const existingAsset = await media.getById(existingId);
    if (!existingAsset) {
      throw new Error('Media asset introuvable pour cette version.');
    }

    return existingAsset;
  }

  if (context.source === 'capture') {
    return media.capturePhoto({
      org_id: document.org_id,
      project_id: document.project_id,
      tag: context.tag ?? 'document_version'
    });
  }

  const importedAssets = await media.importFiles({
    org_id: document.org_id,
    project_id: document.project_id,
    tag: context.tag ?? 'document_version'
  });

  const firstAsset = importedAssets[0];
  if (!firstAsset) {
    throw new Error('Aucun fichier importé.');
  }

  return firstAsset;
}

async function enqueueDocumentOperation(
  document: Document,
  type: 'CREATE' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>
) {
  await offlineDB.enqueueOperation({
    entity: 'documents',
    entity_id: document.id,
    type,
    payload: {
      ...payload,
      id: document.id,
      org_id: document.org_id,
      orgId: document.org_id,
      scope: document.scope,
      project_id: document.project_id,
      updated_at: document.updated_at
    }
  });
}

function normalizeCreateInput(input: DocumentCreateInput): Document {
  const now = nowIso();

  const orgId = normalizeText(input.org_id);
  const scope = input.scope;
  const projectId = normalizeText(input.project_id) || undefined;
  const title = normalizeText(input.title);
  const createdBy = normalizeText(input.created_by);

  if (orgId.length === 0) {
    throw new Error('org_id est requis.');
  }

  if (!isValidScope(scope)) {
    throw new Error(`Scope invalide: ${scope}`);
  }

  if (scope === 'PROJECT' && !projectId) {
    throw new Error('project_id est requis pour scope PROJECT.');
  }

  if (title.length < 2) {
    throw new Error('Le titre du document doit contenir au moins 2 caractères.');
  }

  if (createdBy.length === 0) {
    throw new Error('created_by est requis.');
  }

  const docType = input.doc_type ?? 'OTHER';
  const status = input.status ?? 'DRAFT';

  if (!isValidType(docType)) {
    throw new Error(`Type de document invalide: ${docType}`);
  }

  if (!isValidStatus(status)) {
    throw new Error(`Statut document invalide: ${status}`);
  }

  return {
    id: normalizeText(input.id) || createUuid(),
    org_id: orgId,
    scope,
    project_id: projectId,
    title,
    doc_type: docType,
    status,
    tags: normalizeTags(input.tags),
    description: normalizeText(input.description) || undefined,
    created_by: createdBy,
    created_at: now,
    updated_at: now
  };
}

function mergeDocumentPatch(document: Document, patch: DocumentUpdatePatch): Document {
  const nextScope = patch.scope ?? document.scope;
  const nextType = patch.doc_type ?? document.doc_type;
  const nextStatus = patch.status ?? document.status;

  if (!isValidScope(nextScope)) {
    throw new Error(`Scope invalide: ${nextScope}`);
  }

  if (!isValidType(nextType)) {
    throw new Error(`Type de document invalide: ${nextType}`);
  }

  if (!isValidStatus(nextStatus)) {
    throw new Error(`Statut document invalide: ${nextStatus}`);
  }

  const nextProjectId =
    patch.project_id !== undefined ? normalizeText(patch.project_id) || undefined : document.project_id;

  if (nextScope === 'PROJECT' && !nextProjectId) {
    throw new Error('project_id est requis pour scope PROJECT.');
  }

  return {
    ...document,
    scope: nextScope,
    project_id: nextProjectId,
    title: patch.title !== undefined ? normalizeText(patch.title) : document.title,
    doc_type: nextType,
    status: nextStatus,
    tags: patch.tags ? normalizeTags(patch.tags) : document.tags,
    description:
      patch.description !== undefined ? normalizeText(patch.description) || undefined : document.description,
    deleted_at: patch.deleted_at !== undefined ? patch.deleted_at : document.deleted_at,
    updated_at: nowIso()
  };
}

export const documents = {
  async create(meta: DocumentCreateInput): Promise<Document> {
    const document = normalizeCreateInput(meta);
    await saveDocument(document);

    await enqueueDocumentOperation(document, 'CREATE', {
      data: document
    });

    return document;
  },

  async update(id: string, patch: DocumentUpdatePatch): Promise<Document> {
    const current = await ensureDocumentExists(id);
    const updated = mergeDocumentPatch(current, patch);

    if (updated.title.length < 2) {
      throw new Error('Le titre du document doit contenir au moins 2 caractères.');
    }

    await saveDocument(updated);

    await enqueueDocumentOperation(updated, 'UPDATE', {
      patch,
      data: updated
    });

    return updated;
  },

  async softDelete(id: string): Promise<void> {
    const current = await ensureDocumentExists(id);

    if (current.deleted_at) {
      return;
    }

    const now = nowIso();
    const next: Document = {
      ...current,
      deleted_at: now,
      updated_at: now
    };

    await saveDocument(next);

    await enqueueDocumentOperation(next, 'UPDATE', {
      patch: { deleted_at: next.deleted_at },
      data: next
    });
  },

  async getById(id: string): Promise<Document | null> {
    const row = await getDocumentRowById(id);
    return row ? mapDocumentRow(row) : null;
  },

  async list(scope: DocumentScope, projectId?: string, filters: DocumentsListFilters = {}): Promise<Document[]> {
    if (!isValidScope(scope)) {
      throw new Error(`Scope invalide: ${scope}`);
    }

    await ensureSetup();
    const db = await getDb();

    const limit = Math.max(1, Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
    const offset = Math.max(0, filters.offset ?? 0);

    const where: string[] = ['scope = ?'];
    const params: Array<string | number> = [scope];

    if (scope === 'PROJECT') {
      const cleanedProjectId = normalizeText(projectId);
      if (!cleanedProjectId) {
        throw new Error('projectId est requis pour list(PROJECT).');
      }

      where.push('project_id = ?');
      params.push(cleanedProjectId);
    }

    if (filters.org_id) {
      where.push('org_id = ?');
      params.push(filters.org_id);
    }

    if (!filters.include_deleted) {
      where.push('deleted_at IS NULL');
    }

    if (filters.doc_type && filters.doc_type !== 'ALL') {
      where.push('doc_type = ?');
      params.push(filters.doc_type);
    }

    if (filters.status && filters.status !== 'ALL') {
      where.push('status = ?');
      params.push(filters.status);
    }

    const rows = await db.getAllAsync<DocumentRow>(
      `
        SELECT *
        FROM ${DOCUMENTS_TABLE}
        WHERE ${where.join(' AND ')}
        ORDER BY updated_at DESC
      `,
      ...params
    );

    let mapped = rows.map(mapDocumentRow);

    if (filters.tags && filters.tags.length > 0) {
      const expected = normalizeTags(filters.tags);
      mapped = mapped.filter((document) => expected.every((tag) => document.tags.includes(tag)));
    }

    return mapped.slice(offset, offset + limit);
  },

  async addVersion(documentId: string, fileContext: AddVersionContext = {}): Promise<DocumentVersion> {
    const document = await ensureDocumentExists(documentId);

    const existingCount = await getDocumentVersionCount(documentId);
    if (existingCount >= MAX_VERSIONS_PER_DOCUMENT) {
      throw new Error(
        `Limite de versions atteinte (${MAX_VERSIONS_PER_DOCUMENT}). Archive ou supprime une version avant d'en ajouter.`
      );
    }

    const capturedAsset = await resolveVersionMedia(document, fileContext);

    const processedAsset =
      capturedAsset.watermark_applied === true ? capturedAsset : await media.process(capturedAsset.id);

    await media.enqueueUpload(processedAsset.id);

    const finalAsset = await media.getById(processedAsset.id);
    if (!finalAsset) {
      throw new Error('Media asset introuvable après traitement.');
    }

    const versionNumber = await getNextVersionNumber(document.id);
    const hash = await computeFileHash(finalAsset.local_path);

    const createdBy = actorUserId ?? document.created_by;
    const createdAt = nowIso();

    const version: DocumentVersion = {
      id: createUuid(),
      document_id: document.id,
      version_number: versionNumber,
      file_asset_id: finalAsset.id,
      file_hash: hash,
      file_mime: finalAsset.mime,
      file_size: finalAsset.size_bytes,
      created_at: createdAt,
      created_by: createdBy
    };

    await saveVersion(version);

    const updatedDocument: Document = {
      ...document,
      active_version_id: version.id,
      updated_at: createdAt
    };

    await saveDocument(updatedDocument);

    await offlineDB.enqueueOperation({
      entity: 'document_versions',
      entity_id: version.id,
      type: 'CREATE',
      payload: {
        ...version,
        org_id: document.org_id,
        orgId: document.org_id,
        project_id: document.project_id,
        scope: document.scope
      }
    });

    await enqueueDocumentOperation(updatedDocument, 'UPDATE', {
      patch: { active_version_id: version.id },
      data: updatedDocument
    });

    return version;
  },

  async listVersions(documentId: string): Promise<DocumentVersion[]> {
    await ensureDocumentExists(documentId, true);
    await ensureSetup();

    const db = await getDb();
    const rows = await db.getAllAsync<VersionRow>(
      `
        SELECT *
        FROM ${VERSIONS_TABLE}
        WHERE document_id = ?
        ORDER BY version_number DESC
      `,
      documentId
    );

    return rows.map(mapVersionRow);
  },

  async setActiveVersion(documentId: string, versionId: string): Promise<void> {
    const document = await ensureDocumentExists(documentId);
    const version = await getVersionById(versionId);

    if (!version || version.document_id !== document.id) {
      throw new Error('Version introuvable pour ce document.');
    }

    const next: Document = {
      ...document,
      active_version_id: version.id,
      updated_at: nowIso()
    };

    await saveDocument(next);

    await enqueueDocumentOperation(next, 'UPDATE', {
      patch: { active_version_id: version.id },
      data: next
    });
  },

  async link(documentId: string, entity: LinkedEntity, entityId: string): Promise<void> {
    const document = await ensureDocumentExists(documentId);

    if (!isValidLinkedEntity(entity)) {
      throw new Error(`Entité liée invalide: ${entity}`);
    }

    const linkedId = normalizeText(entityId);
    if (!linkedId) {
      throw new Error('linked_id est requis.');
    }

    await ensureSetup();
    const db = await getDb();

    const link: DocumentLink = {
      id: createUuid(),
      document_id: document.id,
      linked_entity: entity,
      linked_id: linkedId,
      created_at: nowIso()
    };

    await db.runAsync(
      `
        INSERT OR IGNORE INTO ${LINKS_TABLE}
        (id, document_id, linked_entity, linked_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      link.id,
      link.document_id,
      link.linked_entity,
      link.linked_id,
      link.created_at
    );

    await offlineDB.enqueueOperation({
      entity: 'document_links',
      entity_id: link.id,
      type: 'CREATE',
      payload: {
        ...link,
        org_id: document.org_id,
        orgId: document.org_id,
        project_id: document.project_id
      }
    });
  },

  async listLinks(documentId: string): Promise<DocumentLink[]> {
    await ensureDocumentExists(documentId, true);
    await ensureSetup();

    const db = await getDb();
    const rows = await db.getAllAsync<LinkRow>(
      `
        SELECT *
        FROM ${LINKS_TABLE}
        WHERE document_id = ?
        ORDER BY created_at DESC
      `,
      documentId
    );

    return rows.map(mapLinkRow);
  },

  async listByLinkedEntity(entity: LinkedEntity, entityId: string): Promise<Document[]> {
    if (!isValidLinkedEntity(entity)) {
      throw new Error(`Entité liée invalide: ${entity}`);
    }

    const linkedId = normalizeText(entityId);
    if (!linkedId) {
      throw new Error('entityId est requis.');
    }

    await ensureSetup();
    const db = await getDb();

    const rows = await db.getAllAsync<DocumentRow>(
      `
        SELECT d.*
        FROM ${DOCUMENTS_TABLE} d
        INNER JOIN ${LINKS_TABLE} l ON l.document_id = d.id
        WHERE l.linked_entity = ?
          AND l.linked_id = ?
          AND d.deleted_at IS NULL
        ORDER BY d.updated_at DESC
      `,
      entity,
      linkedId
    );

    return rows.map(mapDocumentRow);
  },

  setActor(userId: string | null) {
    actorUserId = userId && userId.trim().length > 0 ? userId : null;
  }
};
