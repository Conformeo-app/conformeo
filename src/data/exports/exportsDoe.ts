import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as SQLite from 'expo-sqlite';
import JSZip from 'jszip';
import { Document, documents, DocumentVersion } from '../documents';
import { media, MediaAsset } from '../media';
import { offlineDB } from '../offline/outbox';
import { quotas } from '../quotas-limits';
import { Task, tasks } from '../tasks';
import {
  ExportContext,
  ExportItem,
  ExportItemEntity,
  ExportJob,
  ExportManifest,
  ExportManifestFile,
  ExportStatus,
  ExportSummary,
  ExportType
} from './types';

const DB_NAME = 'conformeo.db';
const JOBS_TABLE = 'export_jobs';
const ITEMS_TABLE = 'export_items';

const PAGE_SIZE = 200;
const MAX_EXPORTS_PER_DAY = 20;
const MAX_LOCAL_EXPORT_SIZE_BYTES = 250 * 1024 * 1024;
const REPORT_THUMB_LIMIT = 120;

const IMAGE_MIMES = new Set(['image/webp', 'image/jpeg']);

const CANCELLED_MESSAGE = 'Export annule par utilisateur.';

type ExportJobRow = {
  id: string;
  org_id: string;
  project_id: string;
  type: ExportType;
  status: ExportStatus;
  local_path: string | null;
  size_bytes: number | null;
  created_by: string;
  created_at: string;
  finished_at: string | null;
  retry_count: number;
  last_error: string | null;
};

type ExportItemRow = {
  id: string;
  export_id: string;
  entity: ExportItemEntity;
  entity_id: string;
  created_at: string;
};

type DocumentSelection = {
  document: Document;
  version: DocumentVersion;
  asset: MediaAsset | null;
};

type ProjectSnapshot = {
  tasks: Task[];
  media: MediaAsset[];
  documents: DocumentSelection[];
};

type ZipBuildResult = {
  localPath: string;
  sizeBytes: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

const cancelledJobs = new Set<string>();

function nowIso() {
  return new Date().toISOString();
}

function startOfTodayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
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

function toOptional(value: string | null | undefined) {
  return value && value.length > 0 ? value : undefined;
}

function extensionForMime(mime: string) {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/zip') return 'zip';
  return 'jpg';
}

function fileNameFromPath(path: string) {
  const withoutQuery = path.split('?')[0] ?? path;
  const parts = withoutQuery.split('/').filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  return last ?? 'fichier';
}

function slugify(input: string, fallback = 'item') {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const trimmed = normalized.slice(0, 48);
  return trimmed.length > 0 ? trimmed : fallback;
}

function htmlEscape(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requireDocumentDirectory() {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    throw new Error('FileSystem documentDirectory indisponible.');
  }
  return directory;
}

function exportsRootDir() {
  return `${requireDocumentDirectory()}exports_doe/`;
}

function exportsJobsDir() {
  return `${exportsRootDir()}jobs/`;
}

function exportsTmpDir() {
  return `${exportsRootDir()}tmp/`;
}

function mapJobRow(row: ExportJobRow): ExportJob {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    type: row.type,
    status: row.status,
    local_path: toOptional(row.local_path),
    size_bytes: row.size_bytes ?? undefined,
    created_by: row.created_by,
    created_at: row.created_at,
    finished_at: toOptional(row.finished_at),
    retry_count: row.retry_count,
    last_error: toOptional(row.last_error)
  };
}

function mapItemRow(row: ExportItemRow): ExportItem {
  return {
    id: row.id,
    export_id: row.export_id,
    entity: row.entity,
    entity_id: row.entity_id,
    created_at: row.created_at
  };
}

function requireContext() {
  if (!contextOrgId) {
    throw new Error('Contexte export manquant: org_id non defini.');
  }

  if (!contextUserId) {
    throw new Error('Contexte export manquant: user_id non defini.');
  }

  return {
    org_id: contextOrgId,
    user_id: contextUserId
  } satisfies ExportContext;
}

function ensureExportType(type: string): type is ExportType {
  return type === 'REPORT_PDF' || type === 'CONTROL_PACK' || type === 'DOE_ZIP';
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

async function ensureDirectories() {
  await FileSystem.makeDirectoryAsync(exportsRootDir(), { intermediates: true });
  await FileSystem.makeDirectoryAsync(exportsJobsDir(), { intermediates: true });
  await FileSystem.makeDirectoryAsync(exportsTmpDir(), { intermediates: true });
}

async function setupSchema() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS ${JOBS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('REPORT_PDF', 'CONTROL_PACK', 'DOE_ZIP')),
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
      local_path TEXT,
      size_bytes INTEGER,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_export_jobs_org_project_created
      ON ${JOBS_TABLE}(org_id, project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_export_jobs_status
      ON ${JOBS_TABLE}(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ITEMS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      export_id TEXT NOT NULL,
      entity TEXT NOT NULL CHECK (entity IN ('TASK', 'MEDIA', 'DOCUMENT')),
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_export_items_export
      ON ${ITEMS_TABLE}(export_id, created_at ASC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_export_items_unique
      ON ${ITEMS_TABLE}(export_id, entity, entity_id);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      await ensureDirectories();
      await setupSchema();
    })();
  }

  return setupPromise;
}

async function getJobRowById(id: string): Promise<ExportJobRow | null> {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<ExportJobRow>(
    `
      SELECT *
      FROM ${JOBS_TABLE}
      WHERE id = ?
      LIMIT 1
    `,
    id
  );

  return row ?? null;
}

async function upsertJobRow(row: ExportJobRow) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${JOBS_TABLE}
      (
        id, org_id, project_id, type, status,
        local_path, size_bytes,
        created_by, created_at, finished_at,
        retry_count, last_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    row.id,
    row.org_id,
    row.project_id,
    row.type,
    row.status,
    row.local_path,
    row.size_bytes,
    row.created_by,
    row.created_at,
    row.finished_at,
    row.retry_count,
    row.last_error
  );
}

async function patchJob(jobId: string, patch: Partial<ExportJobRow>) {
  const current = await getJobRowById(jobId);
  if (!current) {
    throw new Error(`Export job introuvable: ${jobId}`);
  }

  const next: ExportJobRow = {
    ...current,
    ...patch
  };

  await upsertJobRow(next);
  await enqueueJobOperation(mapJobRow(next), 'UPDATE');

  return mapJobRow(next);
}

async function ensureContextMatch(job: ExportJobRow) {
  if (contextOrgId && job.org_id !== contextOrgId) {
    throw new Error('Acces refuse: export hors organisation active.');
  }
}

async function enqueueJobOperation(job: ExportJob, type: 'CREATE' | 'UPDATE' | 'DELETE') {
  await offlineDB.enqueueOperation({
    entity: 'export_jobs',
    entity_id: job.id,
    type,
    payload: {
      ...job,
      orgId: job.org_id,
      org_id: job.org_id,
      project_id: job.project_id
    }
  });
}

async function enqueueItemOperation(item: ExportItem, orgId: string, projectId: string) {
  await offlineDB.enqueueOperation({
    entity: 'export_items',
    entity_id: item.id,
    type: 'CREATE',
    payload: {
      ...item,
      org_id: orgId,
      orgId,
      project_id: projectId
    }
  });
}

async function countExportsToday(orgId: string) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM ${JOBS_TABLE}
      WHERE org_id = ?
        AND created_at >= ?
    `,
    orgId,
    startOfTodayIso()
  );

  return row?.count ?? 0;
}

async function listAllTasksByProject(orgId: string, projectId: string) {
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

async function listProjectDocuments(orgId: string, projectId: string) {
  const docs: Document[] = [];
  let offset = 0;

  while (true) {
    const batch = await documents.list('PROJECT', projectId, {
      org_id: orgId,
      include_deleted: false,
      limit: PAGE_SIZE,
      offset
    });

    docs.push(...batch);

    if (batch.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
    await Promise.resolve();
  }

  return docs;
}

function pickDocumentVersion(document: Document, versions: DocumentVersion[]) {
  const active = versions.find((item) => item.id === document.active_version_id);
  if (active) {
    return active;
  }

  const sorted = [...versions].sort((left, right) => right.version_number - left.version_number);
  return sorted[0] ?? null;
}

async function collectProjectSnapshot(orgId: string, projectId: string): Promise<ProjectSnapshot> {
  const taskList = await listAllTasksByProject(orgId, projectId);

  const mediaList = (await media.listByProject(projectId)).filter((asset) => asset.org_id === orgId);

  const documentList = await listProjectDocuments(orgId, projectId);
  const selections: DocumentSelection[] = [];

  for (const document of documentList) {
    const versions = await documents.listVersions(document.id);
    const chosen = pickDocumentVersion(document, versions);
    if (!chosen) {
      continue;
    }

    const asset = await media.getById(chosen.file_asset_id);
    if (asset && asset.org_id !== orgId) {
      continue;
    }

    selections.push({
      document,
      version: chosen,
      asset: asset ?? null
    });

    await Promise.resolve();
  }

  return {
    tasks: taskList,
    media: mediaList,
    documents: selections
  };
}

function computeSummary(snapshot: ProjectSnapshot): ExportSummary {
  let todo = 0;
  let doing = 0;
  let done = 0;
  let blocked = 0;

  for (const task of snapshot.tasks) {
    if (task.status === 'TODO') todo += 1;
    else if (task.status === 'DOING') doing += 1;
    else if (task.status === 'DONE') done += 1;
    else blocked += 1;
  }

  return {
    tasks_total: snapshot.tasks.length,
    tasks_todo: todo,
    tasks_doing: doing,
    tasks_done: done,
    tasks_blocked: blocked,
    proofs_total: snapshot.media.length,
    documents_total: snapshot.documents.length
  };
}

function estimateBytes(snapshot: ProjectSnapshot, type: ExportType) {
  const summary = computeSummary(snapshot);
  const reportEstimate = 850 * 1024 + Math.min(summary.proofs_total * 34 * 1024, 18 * 1024 * 1024);

  if (type === 'REPORT_PDF') {
    return reportEstimate;
  }

  const imageBytes = snapshot.media
    .filter((asset) => IMAGE_MIMES.has(asset.mime))
    .reduce((sum, asset) => sum + Math.max(asset.size_bytes, 0), 0);

  const documentBytes = snapshot.documents.reduce((sum, item) => sum + Math.max(item.version.file_size, 0), 0);

  const overhead = 512 * 1024;
  return reportEstimate + imageBytes + documentBytes + overhead;
}

function mimeForExportType(type: ExportType) {
  if (type === 'REPORT_PDF') {
    return 'application/pdf';
  }
  return 'application/zip';
}

function projectLabel(projectId: string) {
  return slugify(projectId, 'chantier');
}

async function readFileSize(path: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    throw new Error(`Fichier introuvable: ${path}`);
  }

  return typeof info.size === 'number' ? info.size : 0;
}

async function fileExists(path: string) {
  const info = await FileSystem.getInfoAsync(path);
  return info.exists;
}

async function safeDelete(path: string | null | undefined) {
  if (!path) {
    return;
  }

  const exists = await fileExists(path);
  if (!exists) {
    return;
  }

  await FileSystem.deleteAsync(path, { idempotent: true });
}

async function safeMoveOrCopy(sourcePath: string, targetPath: string) {
  await safeDelete(targetPath);

  try {
    await FileSystem.moveAsync({ from: sourcePath, to: targetPath });
    return;
  } catch {
    await FileSystem.copyAsync({ from: sourcePath, to: targetPath });
    await safeDelete(sourcePath);
  }
}

async function toBase64DataUri(path: string, mime: string) {
  const exists = await fileExists(path);
  if (!exists) {
    return null;
  }

  const base64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64
  });

  return `data:${mime};base64,${base64}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR');
}

function taskStatusChipColor(status: Task['status']) {
  if (status === 'TODO') return '#F59E0B';
  if (status === 'DOING') return '#0EA5E9';
  if (status === 'DONE') return '#10B981';
  return '#EF4444';
}

async function buildReportPdf(job: ExportJob, snapshot: ProjectSnapshot, title: string) {
  const summary = computeSummary(snapshot);
  const createdAtLabel = formatDate(job.created_at);

  const tasksRows = snapshot.tasks
    .map((task) => {
      const assignee = task.assignee_user_id ?? '-';
      const dueDate = task.due_date ? formatDate(task.due_date) : '-';
      const tags = task.tags.length > 0 ? task.tags.join(', ') : '-';

      return `
        <tr>
          <td>${htmlEscape(task.title)}</td>
          <td><span class="status" style="background:${taskStatusChipColor(task.status)}">${htmlEscape(task.status)}</span></td>
          <td>${htmlEscape(assignee)}</td>
          <td>${htmlEscape(dueDate)}</td>
          <td>${htmlEscape(tags)}</td>
        </tr>
      `;
    })
    .join('');

  const taskTitleById = new Map(snapshot.tasks.map((task) => [task.id, task.title]));
  const proofAssets = snapshot.media.filter((asset) => IMAGE_MIMES.has(asset.mime)).slice(0, REPORT_THUMB_LIMIT);

  const proofCards: string[] = [];
  for (const asset of proofAssets) {
    const thumb = await toBase64DataUri(asset.local_thumb_path, asset.mime);
    if (!thumb) {
      continue;
    }

    const linkedTaskTitle = asset.task_id ? taskTitleById.get(asset.task_id) : undefined;

    proofCards.push(`
      <div class="proof-card">
        <img src="${thumb}" alt="preuve" />
        <div class="proof-caption">
          <div>${htmlEscape(formatDate(asset.created_at))}</div>
          <div>${htmlEscape(linkedTaskTitle ?? 'Sans tache liee')}</div>
        </div>
      </div>
    `);

    await Promise.resolve();
  }

  const docsRows = snapshot.documents
    .map((item) => {
      return `
        <tr>
          <td>${htmlEscape(item.document.title)}</td>
          <td>${htmlEscape(item.document.doc_type)}</td>
          <td>v${item.version.version_number}</td>
          <td>${htmlEscape(item.document.status)}</td>
        </tr>
      `;
    })
    .join('');

  const omittedProofCount = Math.max(0, snapshot.media.filter((asset) => IMAGE_MIMES.has(asset.mime)).length - proofCards.length);

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { margin: 26px; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; font-size: 11px; }
          h1 { margin: 0 0 6px 0; font-size: 26px; }
          h2 { margin: 14px 0 6px 0; font-size: 16px; }
          .subtle { color: #475569; }
          .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
          .summary { border: 1px solid #CBD5E1; border-radius: 10px; padding: 10px; margin-bottom: 12px; }
          .summary-row { display: flex; gap: 10px; flex-wrap: wrap; }
          .summary-pill { background: #F1F5F9; border-radius: 999px; padding: 5px 10px; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { border: 1px solid #CBD5E1; text-align: left; padding: 5px; vertical-align: top; }
          th { background: #E2E8F0; }
          .status { color: #fff; border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 700; }
          .proof-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
          .proof-card { border: 1px solid #CBD5E1; border-radius: 8px; overflow: hidden; }
          .proof-card img { width: 100%; height: 120px; object-fit: cover; display: block; }
          .proof-caption { padding: 6px; font-size: 10px; color: #334155; }
          .footer { margin-top: 16px; color: #334155; font-size: 10px; }
          .watermark {
            position: fixed;
            top: 48%;
            left: 14%;
            right: 14%;
            text-align: center;
            opacity: 0.08;
            transform: rotate(-18deg);
            font-size: 40px;
            font-weight: 700;
            color: #0f172a;
            z-index: -1;
          }
        </style>
      </head>
      <body>
        <div class="watermark">Genere par Conformeo - ${htmlEscape(job.id)}</div>
        <h1>Conformeo</h1>
        <div class="subtle">${htmlEscape(title)}</div>

        <div class="meta-grid">
          <div><strong>Organisation:</strong> ${htmlEscape(job.org_id)}</div>
          <div><strong>Chantier:</strong> ${htmlEscape(job.project_id)}</div>
          <div><strong>Auteur:</strong> ${htmlEscape(job.created_by)}</div>
          <div><strong>Date:</strong> ${htmlEscape(createdAtLabel)}</div>
          <div><strong>Export ID:</strong> ${htmlEscape(job.id)}</div>
        </div>

        <div class="summary">
          <h2>Resume</h2>
          <div class="summary-row">
            <div class="summary-pill">Taches: ${summary.tasks_total}</div>
            <div class="summary-pill">TODO: ${summary.tasks_todo}</div>
            <div class="summary-pill">DOING: ${summary.tasks_doing}</div>
            <div class="summary-pill">DONE: ${summary.tasks_done}</div>
            <div class="summary-pill">BLOCKED: ${summary.tasks_blocked}</div>
            <div class="summary-pill">Preuves: ${summary.proofs_total}</div>
            <div class="summary-pill">Documents: ${summary.documents_total}</div>
          </div>
        </div>

        <h2>Taches</h2>
        <table>
          <thead>
            <tr>
              <th>Titre</th>
              <th>Statut</th>
              <th>Responsable</th>
              <th>Date</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            ${tasksRows || '<tr><td colspan="5">Aucune tache</td></tr>'}
          </tbody>
        </table>

        <h2>Preuves</h2>
        <div class="proof-grid">
          ${proofCards.join('') || '<div class="subtle">Aucune preuve image</div>'}
        </div>
        ${omittedProofCount > 0 ? `<div class="subtle">${omittedProofCount} preuve(s) supplementaire(s) non affichee(s) dans le PDF pour garder un rendu fluide.</div>` : ''}

        <h2>Documents lies</h2>
        <table>
          <thead>
            <tr>
              <th>Titre</th>
              <th>Type</th>
              <th>Version</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            ${docsRows || '<tr><td colspan="4">Aucun document</td></tr>'}
          </tbody>
        </table>

        <div class="footer">Genere par Conformeo - ${htmlEscape(job.id)}</div>
      </body>
    </html>
  `;

  const rendered = await Print.printToFileAsync({
    html,
    base64: false
  });

  return rendered.uri;
}

async function resetExportItems(exportId: string) {
  await ensureSetup();
  const db = await getDb();
  await db.runAsync(`DELETE FROM ${ITEMS_TABLE} WHERE export_id = ?`, exportId);
}

async function storeExportItems(exportId: string, snapshot: ProjectSnapshot, orgId: string, projectId: string) {
  await resetExportItems(exportId);

  const now = nowIso();
  const items: ExportItem[] = [];

  for (const task of snapshot.tasks) {
    items.push({
      id: createUuid(),
      export_id: exportId,
      entity: 'TASK',
      entity_id: task.id,
      created_at: now
    });
  }

  for (const asset of snapshot.media) {
    items.push({
      id: createUuid(),
      export_id: exportId,
      entity: 'MEDIA',
      entity_id: asset.id,
      created_at: now
    });
  }

  for (const item of snapshot.documents) {
    items.push({
      id: createUuid(),
      export_id: exportId,
      entity: 'DOCUMENT',
      entity_id: item.document.id,
      created_at: now
    });
  }

  await ensureSetup();
  const db = await getDb();

  for (const item of items) {
    await db.runAsync(
      `
        INSERT INTO ${ITEMS_TABLE}
        (id, export_id, entity, entity_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      item.id,
      item.export_id,
      item.entity,
      item.entity_id,
      item.created_at
    );

    await enqueueItemOperation(item, orgId, projectId);
  }
}

function assertNotCancelled(jobId: string) {
  if (cancelledJobs.has(jobId)) {
    throw new Error(CANCELLED_MESSAGE);
  }
}

async function ensureProcessedImage(asset: MediaAsset) {
  if (!IMAGE_MIMES.has(asset.mime)) {
    return asset;
  }

  if (asset.watermark_applied) {
    return asset;
  }

  const processed = await media.process(asset.id);
  return processed;
}

async function addFileToZip(
  zip: JSZip,
  zipPath: string,
  localPath: string,
  mime: string,
  meta: Omit<ExportManifestFile, 'path' | 'mime' | 'size_bytes'>
): Promise<ExportManifestFile> {
  const exists = await fileExists(localPath);
  if (!exists) {
    throw new Error(`Fichier introuvable pour ZIP: ${localPath}`);
  }

  const base64 = await FileSystem.readAsStringAsync(localPath, {
    encoding: FileSystem.EncodingType.Base64
  });

  zip.file(zipPath, base64, { base64: true, binary: true });

  const size = await readFileSize(localPath);

  return {
    path: zipPath,
    mime,
    size_bytes: size,
    ...meta
  };
}

function createManifest(
  job: ExportJob,
  type: ExportType,
  summary: ExportSummary,
  files: ExportManifestFile[]
): ExportManifest {
  return {
    export_id: job.id,
    org_id: job.org_id,
    project_id: job.project_id,
    type,
    generated_at: nowIso(),
    created_by: job.created_by,
    source: 'local-device',
    summary,
    files
  };
}

async function buildDoeZip(job: ExportJob, snapshot: ProjectSnapshot, reportPath: string): Promise<ZipBuildResult> {
  const zip = new JSZip();
  const files: ExportManifestFile[] = [];

  const datePart = job.created_at.slice(0, 10).replace(/-/g, '');
  const project = projectLabel(job.project_id);
  const root = `DOE_${project}_${datePart}_${job.id}`;

  files.push(
    await addFileToZip(zip, `${root}/report/rapport.pdf`, reportPath, 'application/pdf', {
      entity: 'DOCUMENT',
      entity_id: job.id,
      linked_document_id: job.id
    })
  );

  let imageIndex = 1;
  for (const mediaAsset of snapshot.media.filter((asset) => IMAGE_MIMES.has(asset.mime))) {
    assertNotCancelled(job.id);

    const asset = await ensureProcessedImage(mediaAsset);
    const ext = extensionForMime(asset.mime);
    const name = `IMG_${String(imageIndex).padStart(4, '0')}.${ext}`;

    files.push(
      await addFileToZip(zip, `${root}/photos/${name}`, asset.local_path, asset.mime, {
        entity: 'MEDIA',
        entity_id: asset.id,
        linked_task_id: asset.task_id
      })
    );

    imageIndex += 1;
    if (imageIndex % 12 === 0) {
      await Promise.resolve();
    }
  }

  for (const entry of snapshot.documents) {
    assertNotCancelled(job.id);

    if (!entry.asset) {
      continue;
    }

    const ext = extensionForMime(entry.asset.mime);
    const safeTitle = slugify(entry.document.title, 'document');
    const name = `${safeTitle}_v${entry.version.version_number}.${ext}`;

    files.push(
      await addFileToZip(zip, `${root}/documents/${name}`, entry.asset.local_path, entry.asset.mime, {
        entity: 'DOCUMENT',
        entity_id: entry.document.id,
        linked_document_id: entry.document.id
      })
    );

    await Promise.resolve();
  }

  const manifest = createManifest(job, 'DOE_ZIP', computeSummary(snapshot), files);
  zip.file(`${root}/report/manifest.json`, JSON.stringify(manifest, null, 2));

  const zipBase64 = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  const finalPath = `${exportsJobsDir()}DOE_${project}_${datePart}_${job.id}.zip`;
  await FileSystem.writeAsStringAsync(finalPath, zipBase64, {
    encoding: FileSystem.EncodingType.Base64
  });

  const sizeBytes = await readFileSize(finalPath);
  return { localPath: finalPath, sizeBytes };
}

async function buildControlPackZip(job: ExportJob, snapshot: ProjectSnapshot, reportPath: string): Promise<ZipBuildResult> {
  const zip = new JSZip();
  const files: ExportManifestFile[] = [];

  const datePart = job.created_at.slice(0, 10).replace(/-/g, '');
  const project = projectLabel(job.project_id);
  const root = `CONTROL_${project}_${datePart}_${job.id}`;

  files.push(
    await addFileToZip(zip, `${root}/report/control_pack.pdf`, reportPath, 'application/pdf', {
      entity: 'DOCUMENT',
      entity_id: job.id,
      linked_document_id: job.id
    })
  );

  let proofIndex = 1;
  for (const mediaAsset of snapshot.media.filter((asset) => IMAGE_MIMES.has(asset.mime))) {
    assertNotCancelled(job.id);

    const asset = await ensureProcessedImage(mediaAsset);
    const ext = extensionForMime(asset.mime);
    const name = `PROOF_${String(proofIndex).padStart(4, '0')}.${ext}`;

    files.push(
      await addFileToZip(zip, `${root}/annexes/photos/${name}`, asset.local_path, asset.mime, {
        entity: 'MEDIA',
        entity_id: asset.id,
        linked_task_id: asset.task_id
      })
    );

    proofIndex += 1;
  }

  for (const entry of snapshot.documents) {
    assertNotCancelled(job.id);

    if (!entry.asset) {
      continue;
    }

    const ext = extensionForMime(entry.asset.mime);
    const safeTitle = slugify(entry.document.title, 'document');
    const name = `${safeTitle}_v${entry.version.version_number}.${ext}`;

    files.push(
      await addFileToZip(zip, `${root}/annexes/documents/${name}`, entry.asset.local_path, entry.asset.mime, {
        entity: 'DOCUMENT',
        entity_id: entry.document.id,
        linked_document_id: entry.document.id
      })
    );
  }

  const manifest = createManifest(job, 'CONTROL_PACK', computeSummary(snapshot), files);
  zip.file(`${root}/report/manifest.json`, JSON.stringify(manifest, null, 2));

  const zipBase64 = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  const finalPath = `${exportsJobsDir()}CONTROL_${project}_${datePart}_${job.id}.zip`;
  await FileSystem.writeAsStringAsync(finalPath, zipBase64, {
    encoding: FileSystem.EncodingType.Base64
  });

  const sizeBytes = await readFileSize(finalPath);
  return { localPath: finalPath, sizeBytes };
}

async function movePdfToFinal(job: ExportJob, reportPath: string): Promise<ZipBuildResult> {
  const datePart = job.created_at.slice(0, 10).replace(/-/g, '');
  const project = projectLabel(job.project_id);
  const finalPath = `${exportsJobsDir()}RAPPORT_${project}_${datePart}_${job.id}.pdf`;

  await safeMoveOrCopy(reportPath, finalPath);

  const sizeBytes = await readFileSize(finalPath);
  return {
    localPath: finalPath,
    sizeBytes
  };
}

async function clearJobArtifacts(job: ExportJob) {
  if (job.local_path) {
    await safeDelete(job.local_path);
  }
}

export const exportsDoe = {
  config: {
    maxLocalExportSizeBytes: MAX_LOCAL_EXPORT_SIZE_BYTES,
    maxExportsPerDay: MAX_EXPORTS_PER_DAY,
    reportThumbLimit: REPORT_THUMB_LIMIT
  },

  setContext(context: Partial<ExportContext>) {
    contextOrgId = normalizeText(context.org_id) || null;
    contextUserId = normalizeText(context.user_id) || null;
  },

  setActor(userId: string | null) {
    contextUserId = normalizeText(userId) || null;
  },

  setOrg(orgId: string | null) {
    contextOrgId = normalizeText(orgId) || null;
  },

  async createJob(projectId: string, type: ExportType): Promise<ExportJob> {
    await ensureSetup();

    if (!ensureExportType(type)) {
      throw new Error(`Type export invalide: ${type}`);
    }

    const context = requireContext();
    const normalizedProjectId = normalizeText(projectId);
    if (normalizedProjectId.length === 0) {
      throw new Error('projectId est requis.');
    }

    const [exportsToday, quotaRow] = await Promise.all([
      countExportsToday(context.org_id),
      quotas.get()
    ])

    const rawLimit = Number(quotaRow.exports_per_day)
    let maxPerDay = MAX_EXPORTS_PER_DAY
    if (Number.isFinite(rawLimit)) {
      if (rawLimit > 0) {
        maxPerDay = Math.floor(rawLimit)
      }
    }

    if (exportsToday >= maxPerDay) {
      throw new Error('Quota depasse: max ' + maxPerDay + ' exports/jour.')
    }

    const createdAt = nowIso();

    const row: ExportJobRow = {
      id: createUuid(),
      org_id: context.org_id,
      project_id: normalizedProjectId,
      type,
      status: 'PENDING',
      local_path: null,
      size_bytes: null,
      created_by: context.user_id,
      created_at: createdAt,
      finished_at: null,
      retry_count: 0,
      last_error: null
    };
    await upsertJobRow(row);
    void quotas.recordExportCreated();

    const mapped = mapJobRow(row);
    await enqueueJobOperation(mapped, 'CREATE');

    return mapped;
  },

  async run(jobId: string): Promise<ExportJob> {
    const row = await getJobRowById(jobId);
    if (!row) {
      throw new Error(`Export job introuvable: ${jobId}`);
    }

    await ensureContextMatch(row);

    cancelledJobs.delete(jobId);

    const runningJob = await patchJob(jobId, {
      status: 'RUNNING',
      last_error: null
    });

    try {
      assertNotCancelled(jobId);

      const snapshot = await collectProjectSnapshot(runningJob.org_id, runningJob.project_id);
      const estimated = estimateBytes(snapshot, runningJob.type);

      if (estimated > MAX_LOCAL_EXPORT_SIZE_BYTES) {
        throw new Error('Export trop lourd: utiliser export serveur (v1).');
      }

      await storeExportItems(jobId, snapshot, runningJob.org_id, runningJob.project_id);
      await clearJobArtifacts(runningJob);

      const reportTitle =
        runningJob.type === 'REPORT_PDF'
          ? 'Rapport chantier'
          : runningJob.type === 'CONTROL_PACK'
            ? 'Pack controle'
            : 'Dossier DOE complet';

      const reportPath = await buildReportPdf(runningJob, snapshot, reportTitle);
      assertNotCancelled(jobId);

      let output: ZipBuildResult;
      if (runningJob.type === 'REPORT_PDF') {
        output = await movePdfToFinal(runningJob, reportPath);
      } else if (runningJob.type === 'CONTROL_PACK') {
        output = await buildControlPackZip(runningJob, snapshot, reportPath);
        await safeDelete(reportPath);
      } else {
        output = await buildDoeZip(runningJob, snapshot, reportPath);
        await safeDelete(reportPath);
      }

      if (output.sizeBytes > MAX_LOCAL_EXPORT_SIZE_BYTES) {
        await safeDelete(output.localPath);
        throw new Error('Export trop lourd: utiliser export serveur (v1).');
      }

      const done = await patchJob(jobId, {
        status: 'DONE',
        local_path: output.localPath,
        size_bytes: output.sizeBytes,
        finished_at: nowIso(),
        last_error: null
      });

      return done;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Echec generation export.';
      const failed = await patchJob(jobId, {
        status: 'FAILED',
        finished_at: nowIso(),
        retry_count: row.retry_count + 1,
        last_error: message
      });

      return failed;
    } finally {
      cancelledJobs.delete(jobId);
    }
  },

  async cancel(jobId: string): Promise<void> {
    cancelledJobs.add(jobId);

    const row = await getJobRowById(jobId);
    if (!row) {
      return;
    }

    await ensureContextMatch(row);

    if (row.status === 'DONE' || row.status === 'FAILED') {
      return;
    }

    await patchJob(jobId, {
      status: 'FAILED',
      finished_at: nowIso(),
      retry_count: row.retry_count + 1,
      last_error: CANCELLED_MESSAGE
    });
  },

  async getById(jobId: string): Promise<ExportJob | null> {
    const row = await getJobRowById(jobId);
    if (!row) {
      return null;
    }

    await ensureContextMatch(row);
    return mapJobRow(row);
  },

  async listByProject(projectId: string): Promise<ExportJob[]> {
    await ensureSetup();
    const db = await getDb();

    const normalizedProjectId = normalizeText(projectId);
    if (normalizedProjectId.length === 0) {
      return [];
    }

    const where: string[] = ['project_id = ?'];
    const params: Array<string> = [normalizedProjectId];

    if (contextOrgId) {
      where.push('org_id = ?');
      params.push(contextOrgId);
    }

    const rows = await db.getAllAsync<ExportJobRow>(
      `
        SELECT *
        FROM ${JOBS_TABLE}
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
      `,
      ...params
    );

    return rows.map(mapJobRow);
  },

  async listItems(exportId: string): Promise<ExportItem[]> {
    await ensureSetup();
    const db = await getDb();

    const rows = await db.getAllAsync<ExportItemRow>(
      `
        SELECT *
        FROM ${ITEMS_TABLE}
        WHERE export_id = ?
        ORDER BY created_at ASC
      `,
      exportId
    );

    return rows.map(mapItemRow);
  },

  async remove(jobId: string): Promise<void> {
    const row = await getJobRowById(jobId);
    if (!row) {
      return;
    }

    await ensureContextMatch(row);

    const job = mapJobRow(row);

    if (job.local_path) {
      await safeDelete(job.local_path);
    }

    await ensureSetup();
    const db = await getDb();
    await db.runAsync(`DELETE FROM ${ITEMS_TABLE} WHERE export_id = ?`, jobId);
    await db.runAsync(`DELETE FROM ${JOBS_TABLE} WHERE id = ?`, jobId);

    await enqueueJobOperation(job, 'DELETE');
  },

  async purgeOldExports(days: number): Promise<number> {
    await ensureSetup();
    const db = await getDb();

    const safeDays = Math.max(1, Math.floor(days));
    const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();

    const where: string[] = ['created_at < ?'];
    const params: Array<string> = [cutoff];

    if (contextOrgId) {
      where.push('org_id = ?');
      params.push(contextOrgId);
    }

    const rows = await db.getAllAsync<ExportJobRow>(
      `
        SELECT *
        FROM ${JOBS_TABLE}
        WHERE ${where.join(' AND ')}
      `,
      ...params
    );

    for (const row of rows) {
      const job = mapJobRow(row);
      if (job.local_path) {
        await safeDelete(job.local_path);
      }

      await db.runAsync(`DELETE FROM ${ITEMS_TABLE} WHERE export_id = ?`, row.id);
      await db.runAsync(`DELETE FROM ${JOBS_TABLE} WHERE id = ?`, row.id);

      await enqueueJobOperation(job, 'DELETE');
    }

    return rows.length;
  },

  async computeEstimatedSize(projectId: string, type: ExportType): Promise<number> {
    if (!ensureExportType(type)) {
      throw new Error(`Type export invalide: ${type}`);
    }

    const context = requireContext();
    const normalizedProjectId = normalizeText(projectId);
    if (normalizedProjectId.length === 0) {
      throw new Error('projectId est requis.');
    }

    const snapshot = await collectProjectSnapshot(context.org_id, normalizedProjectId);
    return estimateBytes(snapshot, type);
  },

  async getMaxExportSizeBytes() {
    return MAX_LOCAL_EXPORT_SIZE_BYTES;
  },

  getMimeForType(type: ExportType) {
    return mimeForExportType(type);
  },

  getDisplayFileName(job: ExportJob) {
    if (!job.local_path) {
      return `${job.id}.${job.type === 'REPORT_PDF' ? 'pdf' : 'zip'}`;
    }

    return fileNameFromPath(job.local_path);
  }
};
