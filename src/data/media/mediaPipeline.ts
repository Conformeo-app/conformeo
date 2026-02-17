import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as SQLite from 'expo-sqlite';
import { Image } from 'react-native';
import { securityPolicies } from '../../core/security/policies';
import { geo } from '../geo-context';
import { quotas } from '../quotas-limits';
import { MediaAsset, MediaContext, MediaListFilters, MediaMime, MediaProcessConfig } from './types';

const DB_NAME = 'conformeo.db';
const TABLE_NAME = 'media_assets';

const MEDIA_CONFIG: MediaProcessConfig = {
  maxEdgePx: 1920,
  thumbMaxEdgePx: 320,
  maxImportSizeBytes: 25 * 1024 * 1024,
  jpegQuality: 0.78,
  webpQuality: 0.74,
  maxPendingUploads: 500,
  cleanupExportOlderThanMs: 7 * 24 * 60 * 60 * 1000
};

type MediaRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  task_id: string | null;
  plan_pin_id: string | null;
  tag: string | null;
  local_original_path: string;
  local_path: string;
  local_thumb_path: string;
  mime: MediaMime;
  width: number | null;
  height: number | null;
  size_bytes: number;
  watermark_applied: number;
  watermark_text: string | null;
  upload_status: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  remote_path: string | null;
  remote_url: string | null;
  created_at: string;
  retry_count: number;
  last_error: string | null;
};

type ImportedFile = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  width?: number;
  height?: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

const processingQueue: string[] = [];
const processingSet = new Set<string>();
let processWorkerRunning = false;

function requireDocumentDirectory() {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    throw new Error('FileSystem documentDirectory unavailable on this device.');
  }

  return directory;
}

function mediaRootDir() {
  return `${requireDocumentDirectory()}media_pipeline/`;
}

function originalsDir() {
  return `${mediaRootDir()}originals/`;
}

function optimizedDir() {
  return `${mediaRootDir()}optimized/`;
}

function thumbsDir() {
  return `${mediaRootDir()}thumbs/`;
}

function exportsDir() {
  return `${mediaRootDir()}exports/`;
}

function nowIso() {
  return new Date().toISOString();
}

function createUuid() {
  const randomUUID = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }

  // RFC4122-like fallback to keep DB ids valid UUID strings.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function optionalString(value: string | null | undefined) {
  return value && value.length > 0 ? value : undefined;
}

function normalizeMime(input: string | null | undefined, uri: string): MediaMime {
  const value = input?.toLowerCase() ?? '';

  if (value.includes('pdf') || uri.toLowerCase().endsWith('.pdf')) {
    return 'application/pdf';
  }

  if (value.includes('webp') || uri.toLowerCase().endsWith('.webp')) {
    return 'image/webp';
  }

  return 'image/jpeg';
}

function extensionForMime(mime: MediaMime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function isImageMime(mime: MediaMime) {
  return mime === 'image/webp' || mime === 'image/jpeg';
}

function buildWatermarkText(asset: Pick<MediaAsset, 'org_id' | 'project_id' | 'created_at'>) {
  const chantier = asset.project_id ?? 'chantier';
  const date = new Date(asset.created_at).toLocaleString('fr-FR');
  return `Genere par Conformeo - ${asset.org_id} - ${chantier} - ${date}`;
}

function mapRow(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: optionalString(row.project_id),
    task_id: optionalString(row.task_id),
    plan_pin_id: optionalString(row.plan_pin_id),
    tag: optionalString(row.tag),
    local_original_path: row.local_original_path,
    local_path: row.local_path,
    local_thumb_path: row.local_thumb_path,
    mime: row.mime,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    size_bytes: row.size_bytes,
    watermark_applied: row.watermark_applied === 1,
    watermark_text: optionalString(row.watermark_text),
    upload_status: row.upload_status,
    remote_path: optionalString(row.remote_path),
    remote_url: optionalString(row.remote_url),
    created_at: row.created_at,
    retry_count: row.retry_count,
    last_error: optionalString(row.last_error)
  };
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }

  return dbPromise;
}

async function ensureDirectories() {
  const folders = [mediaRootDir(), originalsDir(), optimizedDir(), thumbsDir(), exportsDir()];

  for (const folder of folders) {
    await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  }
}

async function recoverInterruptedUploads() {
  const db = await getDb();
  await db.runAsync(
    `
      UPDATE ${TABLE_NAME}
      SET upload_status = 'FAILED',
          last_error = COALESCE(last_error, 'Upload interrompu: reprise au prochain cycle.'),
          retry_count = retry_count + 1
      WHERE upload_status = 'UPLOADING'
    `
  );
}

async function setupSchema() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      plan_pin_id TEXT,
      tag TEXT,
      local_original_path TEXT NOT NULL,
      local_path TEXT NOT NULL,
      local_thumb_path TEXT NOT NULL,
      mime TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg', 'application/pdf')),
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER NOT NULL,
      watermark_applied INTEGER NOT NULL DEFAULT 0,
      watermark_text TEXT,
      upload_status TEXT NOT NULL CHECK (upload_status IN ('PENDING', 'UPLOADING', 'UPLOADED', 'FAILED')),
      remote_path TEXT,
      remote_url TEXT,
      created_at TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_media_assets_org_created
      ON ${TABLE_NAME}(org_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_media_assets_project
      ON ${TABLE_NAME}(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_media_assets_task
      ON ${TABLE_NAME}(task_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_media_assets_upload_status
      ON ${TABLE_NAME}(upload_status, created_at ASC);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = (async () => {
      await ensureDirectories();
      await setupSchema();
      await recoverInterruptedUploads();
      void cleanupOrphanedThumbs();
      void cleanupOldExports();
    })();
  }

  return setupPromise;
}

async function runQuery(sql: string, ...params: Array<string | number | null>) {
  const db = await getDb();
  return db.runAsync(sql, ...params);
}

async function getByIdInternal(id: string) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<MediaRow>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE id = ?
      LIMIT 1
    `,
    id
  );

  return row ? mapRow(row) : null;
}

async function saveAsset(asset: MediaAsset) {
  await ensureSetup();

  await runQuery(
    `
      INSERT OR REPLACE INTO ${TABLE_NAME}
      (
        id, org_id, project_id, task_id, plan_pin_id, tag,
        local_original_path, local_path, local_thumb_path,
        mime, width, height, size_bytes, watermark_applied, watermark_text,
        upload_status, remote_path, remote_url,
        created_at, retry_count, last_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    asset.id,
    asset.org_id,
    asset.project_id ?? null,
    asset.task_id ?? null,
    asset.plan_pin_id ?? null,
    asset.tag ?? null,
    asset.local_original_path,
    asset.local_path,
    asset.local_thumb_path,
    asset.mime,
    asset.width ?? null,
    asset.height ?? null,
    asset.size_bytes,
    asset.watermark_applied ? 1 : 0,
    asset.watermark_text ?? null,
    asset.upload_status,
    asset.remote_path ?? null,
    asset.remote_url ?? null,
    asset.created_at,
    asset.retry_count,
    asset.last_error ?? null
  );

  return asset;
}

async function updateAsset(id: string, patch: Partial<MediaAsset>) {
  const current = await getByIdInternal(id);
  if (!current) {
    throw new Error(`Media asset not found: ${id}`);
  }

  const next: MediaAsset = {
    ...current,
    ...patch,
    id: current.id,
    org_id: current.org_id,
    created_at: current.created_at,
    local_original_path: current.local_original_path
  };

  return saveAsset(next);
}

async function getFileSize(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) {
    throw new Error(`File not found: ${uri}`);
  }

  return typeof info.size === 'number' ? info.size : 0;
}

async function safeMoveOrCopy(source: string, target: string) {
  if (source === target) {
    return target;
  }

  const targetInfo = await FileSystem.getInfoAsync(target);
  if (targetInfo.exists) {
    await FileSystem.deleteAsync(target, { idempotent: true });
  }

  try {
    await FileSystem.moveAsync({ from: source, to: target });
  } catch {
    await FileSystem.copyAsync({ from: source, to: target });
  }

  return target;
}

async function getImageDimensions(uri: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => reject(new Error(`Unable to read image dimensions: ${uri}`))
    );
  });
}

function computeResizedDimensions(width: number, height: number, maxEdge: number) {
  if (width <= maxEdge && height <= maxEdge) {
    return { width, height };
  }

  if (width >= height) {
    return { width: maxEdge, height: Math.max(1, Math.round((height / width) * maxEdge)) };
  }

  return { width: Math.max(1, Math.round((width / height) * maxEdge)), height: maxEdge };
}

async function createLocalAssetFromImportedFile(context: MediaContext, file: ImportedFile) {
  if (!context.org_id || context.org_id.trim().length === 0) {
    throw new Error('org_id is required for media capture/import.');
  }

  await ensureSetup();

  const mime = normalizeMime(file.mimeType, file.uri);
  const id = createUuid();
  const extension = extensionForMime(mime);
  const targetOriginalPath = `${originalsDir()}${id}.${extension}`;

  const sourceSize =
    typeof file.fileSize === 'number' && file.fileSize > 0 ? file.fileSize : await getFileSize(file.uri);

  if (sourceSize > MEDIA_CONFIG.maxImportSizeBytes) {
    throw new Error(
      `Fichier trop lourd (${Math.round(sourceSize / 1024 / 1024)} MB). Limite ${Math.round(
        MEDIA_CONFIG.maxImportSizeBytes / 1024 / 1024
      )} MB.`
    );
  }

  const pendingCount = await media.countPendingUploads();
  if (pendingCount >= MEDIA_CONFIG.maxPendingUploads) {
    throw new Error("Limite file d'upload atteinte (" + MEDIA_CONFIG.maxPendingUploads + " medias en attente).");
  }

  const sizeMb = sourceSize / 1024 / 1024;
  const uploadBlockReason = await quotas.explainUploadBlock(sizeMb);
  if (uploadBlockReason) {
    throw new Error(uploadBlockReason);
  }

  await FileSystem.copyAsync({ from: file.uri, to: targetOriginalPath });

  const finalSize = await getFileSize(targetOriginalPath);
  const createdAt = nowIso();

  const asset: MediaAsset = {
    id,
    org_id: context.org_id,
    project_id: context.project_id,
    task_id: context.task_id,
    plan_pin_id: context.plan_pin_id,
    tag: context.tag,
    local_original_path: targetOriginalPath,
    local_path: targetOriginalPath,
    local_thumb_path: '',
    mime,
    width: file.width,
    height: file.height,
    size_bytes: finalSize,
    watermark_applied: false,
    upload_status: 'PENDING',
    created_at: createdAt,
    retry_count: 0
  };
  await saveAsset(asset);
  void quotas.recordMediaCreated();
  void geo.capture({
    entity: 'MEDIA',
    entity_id: asset.id,
    org_id: asset.org_id,
    project_id: asset.project_id
  });
  return asset;
}

function scheduleBackgroundProcess(assetId: string) {
  if (processingSet.has(assetId)) {
    return;
  }

  processingSet.add(assetId);
  processingQueue.push(assetId);
  void runProcessWorker();
}

async function runProcessWorker() {
  if (processWorkerRunning) {
    return;
  }

  processWorkerRunning = true;

  while (processingQueue.length > 0) {
    const next = processingQueue.shift();
    if (!next) {
      break;
    }

    try {
      await media.process(next);
      await media.enqueueUpload(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media processing failed';
      await media.markFailed(next, message);
      if (__DEV__) {
        console.warn('[media-pipeline] process worker error:', message);
      }
    } finally {
      processingSet.delete(next);
    }
  }

  processWorkerRunning = false;
}

async function cleanupOrphanedThumbs() {
  await ensureSetup();

  const db = await getDb();
  const rows = await db.getAllAsync<{ local_thumb_path: string }>(
    `
      SELECT local_thumb_path
      FROM ${TABLE_NAME}
      WHERE local_thumb_path != ''
    `
  );

  const referenced = new Set(rows.map((row) => row.local_thumb_path));
  const directory = thumbsDir();

  let files: string[] = [];
  try {
    files = await FileSystem.readDirectoryAsync(directory);
  } catch {
    return;
  }

  for (const name of files) {
    const absolute = `${directory}${name}`;
    if (!referenced.has(absolute)) {
      await FileSystem.deleteAsync(absolute, { idempotent: true });
    }
  }
}

async function cleanupOldExports() {
  await ensureSetup();

  const directory = exportsDir();
  let files: string[] = [];

  try {
    files = await FileSystem.readDirectoryAsync(directory);
  } catch {
    return;
  }

  const now = Date.now();

  for (const name of files) {
    const absolute = `${directory}${name}`;
    const info = await FileSystem.getInfoAsync(absolute);
    const modifiedAtMs =
      info.exists && !info.isDirectory && typeof info.modificationTime === 'number'
        ? info.modificationTime * 1000
        : now;

    if (now - modifiedAtMs > MEDIA_CONFIG.cleanupExportOlderThanMs) {
      await FileSystem.deleteAsync(absolute, { idempotent: true });
    }
  }
}

export const media = {
  config: MEDIA_CONFIG,

  // Optional context for UI helpers (does not affect capture/import which always require explicit org_id).
  setContext(_context: { org_id?: string; user_id?: string }) {
    // Intentionally no-op for now. Keep API surface stable for future audit fields (created_by, etc.).
  },

  async capturePhoto(context: MediaContext) {
    await ensureSetup();

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Permission camera refusee.');
    }

    const capture = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      exif: false
    });

    if (capture.canceled || !capture.assets?.[0]) {
      throw new Error('Capture annulee.');
    }

    const first = capture.assets[0];
    const asset = await createLocalAssetFromImportedFile(context, {
      uri: first.uri,
      mimeType: first.mimeType,
      fileName: first.fileName,
      fileSize: first.fileSize,
      width: first.width,
      height: first.height
    });

    scheduleBackgroundProcess(asset.id);
    return asset;
  },

  async importFiles(context: MediaContext) {
    await ensureSetup();

    const picked = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      multiple: true,
      copyToCacheDirectory: true
    });

    if (picked.canceled) {
      return [] as MediaAsset[];
    }

    const assets: MediaAsset[] = [];

    for (const file of picked.assets) {
      const mediaAsset = await createLocalAssetFromImportedFile(context, {
        uri: file.uri,
        mimeType: file.mimeType,
        fileName: file.name,
        fileSize: file.size
      });

      assets.push(mediaAsset);
      scheduleBackgroundProcess(mediaAsset.id);
    }

    return assets;
  },



  async registerGeneratedFile(context: MediaContext, file: ImportedFile & { tag?: string }) {
    await ensureSetup();

    const asset = await createLocalAssetFromImportedFile(
      {
        ...context,
        tag: file.tag ?? context.tag
      },
      {
        uri: file.uri,
        mimeType: file.mimeType,
        fileName: file.fileName,
        fileSize: file.fileSize,
        width: file.width,
        height: file.height
      }
    );

    scheduleBackgroundProcess(asset.id);
    return asset;
  },
  async process(assetId: string) {
    const asset = await getByIdInternal(assetId);
    if (!asset) {
      throw new Error(`Media asset not found: ${assetId}`);
    }

    if (!isImageMime(asset.mime)) {
      return updateAsset(asset.id, {
        local_path: asset.local_original_path,
        local_thumb_path: asset.local_thumb_path,
        watermark_applied: true,
        watermark_text: buildWatermarkText(asset),
        size_bytes: await getFileSize(asset.local_original_path),
        last_error: undefined
      });
    }

    const dimensions =
      typeof asset.width === 'number' && typeof asset.height === 'number'
        ? { width: asset.width, height: asset.height }
        : await getImageDimensions(asset.local_original_path);

    const target = computeResizedDimensions(dimensions.width, dimensions.height, MEDIA_CONFIG.maxEdgePx);

    let optimizeResult: ImageManipulator.ImageResult;
    let outputMime: MediaMime;

    try {
      optimizeResult = await ImageManipulator.manipulateAsync(
        asset.local_original_path,
        [{ resize: { width: target.width, height: target.height } }],
        {
          compress: MEDIA_CONFIG.webpQuality,
          format: ImageManipulator.SaveFormat.WEBP
        }
      );
      outputMime = 'image/webp';
    } catch {
      optimizeResult = await ImageManipulator.manipulateAsync(
        asset.local_original_path,
        [{ resize: { width: target.width, height: target.height } }],
        {
          compress: MEDIA_CONFIG.jpegQuality,
          format: ImageManipulator.SaveFormat.JPEG
        }
      );
      outputMime = 'image/jpeg';
    }

    const optimizedPath = `${optimizedDir()}${asset.id}.${extensionForMime(outputMime)}`;
    await safeMoveOrCopy(optimizeResult.uri, optimizedPath);

    const thumbTarget = computeResizedDimensions(
      optimizeResult.width,
      optimizeResult.height,
      MEDIA_CONFIG.thumbMaxEdgePx
    );

    const thumbResult = await ImageManipulator.manipulateAsync(
      optimizedPath,
      [{ resize: { width: thumbTarget.width, height: thumbTarget.height } }],
      {
        compress: 0.65,
        format: outputMime === 'image/webp' ? ImageManipulator.SaveFormat.WEBP : ImageManipulator.SaveFormat.JPEG
      }
    );

    const thumbPath = `${thumbsDir()}${asset.id}.${extensionForMime(outputMime)}`;
    await safeMoveOrCopy(thumbResult.uri, thumbPath);

    const optimizedSize = await getFileSize(optimizedPath);

    return updateAsset(asset.id, {
      local_path: optimizedPath,
      local_thumb_path: thumbPath,
      mime: outputMime,
      width: optimizeResult.width,
      height: optimizeResult.height,
      size_bytes: optimizedSize,
      watermark_applied: true,
      watermark_text: buildWatermarkText(asset),
      last_error: undefined
    });
  },

  async enqueueUpload(assetId: string) {
    const asset = await getByIdInternal(assetId);
    if (!asset) {
      throw new Error(`Média introuvable : ${assetId}`);
    }

    if (!asset.watermark_applied) {
      throw new Error('Le média doit être traité avant téléversement.');
    }

    const pendingCount = await this.countPendingUploads();
    if (pendingCount >= MEDIA_CONFIG.maxPendingUploads && asset.upload_status !== 'PENDING') {
      throw new Error('Limite atteinte : 500 médias en attente de téléversement.');
    }

    await updateAsset(assetId, {
      upload_status: 'PENDING',
      last_error: undefined
    });
  },

  async getById(id: string) {
    return getByIdInternal(id);
  },

  async updateMeta(id: string, patch: Partial<Pick<MediaAsset, 'project_id' | 'task_id' | 'plan_pin_id' | 'tag'>>) {
    await updateAsset(id, patch as Partial<MediaAsset>);
    const refreshed = await getByIdInternal(id);
    if (!refreshed) {
      throw new Error('Media asset introuvable apres mise a jour.');
    }
    return refreshed;
  },

  async linkToTask(mediaId: string, taskId: string) {
    await this.updateMeta(mediaId, { task_id: taskId });
  },

  async unlinkFromTask(mediaId: string) {
    await this.updateMeta(mediaId, { task_id: undefined });
  },

  // Note: pin <-> media linking is source-of-truth in `plan_pin_links` (plans-annotations).
  // This local field is kept as a mirror for fast filters / UI indicators.
  async linkToPin(mediaId: string, pinId: string) {
    await this.updateMeta(mediaId, { plan_pin_id: pinId });
  },

  async unlinkFromPin(mediaId: string) {
    await this.updateMeta(mediaId, { plan_pin_id: undefined });
  },

  async retryUpload(mediaId: string) {
    const asset = await getByIdInternal(mediaId);
    if (!asset) {
      throw new Error('Media introuvable.');
    }

    // Ensure the asset is processed + in PENDING state. This is safe offline-first.
    if (!asset.watermark_applied) {
      await this.process(asset.id);
    }

    await this.enqueueUpload(asset.id);

    // Allow manual retries even after many automatic attempts.
    await updateAsset(asset.id, {
      retry_count: 0,
      last_error: undefined
    });

    const refreshed = await getByIdInternal(asset.id);
    if (!refreshed) {
      throw new Error('Media introuvable apres retry.');
    }
    return refreshed;
  },

  async listByProject(projectId: string, filters: MediaListFilters = {}) {
    await ensureSetup();
    const db = await getDb();

    const where: string[] = ['project_id = ?'];
    const params: Array<string> = [projectId];

    if (filters.upload_status) {
      where.push('upload_status = ?');
      params.push(filters.upload_status);
    }

    if (filters.tag) {
      where.push('tag = ?');
      params.push(filters.tag);
    }

    const rows = await db.getAllAsync<MediaRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
      `,
      ...params
    );

    return rows.map(mapRow);
  },

  async countByProject(projectId: string, filters: MediaListFilters = {}) {
    await ensureSetup();
    const db = await getDb();

    const where: string[] = ['project_id = ?'];
    const params: Array<string> = [projectId];

    if (filters.upload_status) {
      where.push('upload_status = ?');
      params.push(filters.upload_status);
    }

    if (filters.tag) {
      where.push('tag = ?');
      params.push(filters.tag);
    }

    const row = await db.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM ${TABLE_NAME}
        WHERE ${where.join(' AND ')}
      `,
      ...params
    );

    return row?.count ?? 0;
  },

  async listByTask(taskId: string) {
    await ensureSetup();
    const db = await getDb();

    const rows = await db.getAllAsync<MediaRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE task_id = ?
        ORDER BY created_at DESC
      `,
      taskId
    );

    return rows.map(mapRow);
  },

  async getUploadPendingBatch(limit: number) {
    await ensureSetup();
    const db = await getDb();

    const rows = await db.getAllAsync<MediaRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE watermark_applied = 1
          AND (
            upload_status = 'PENDING'
            OR (upload_status = 'FAILED' AND retry_count < ?)
          )
        ORDER BY created_at ASC
        LIMIT ?
      `,
      securityPolicies.maxSyncAttempts,
      Math.max(1, limit)
    );

    return rows.map(mapRow);
  },

  async markUploading(id: string) {
    await updateAsset(id, {
      upload_status: 'UPLOADING',
      last_error: undefined
    });
  },

  async markUploaded(id: string, remote_path: string, remote_url?: string) {
    await updateAsset(id, {
      upload_status: 'UPLOADED',
      remote_path,
      remote_url,
      last_error: undefined
    });
  },

  async markFailed(id: string, error: string, options: { terminal?: boolean } = {}) {
    const asset = await getByIdInternal(id);
    if (!asset) {
      return;
    }

    const nextRetryCount = options.terminal
      ? securityPolicies.maxSyncAttempts
      : asset.retry_count + 1;

    await updateAsset(id, {
      upload_status: 'FAILED',
      retry_count: nextRetryCount,
      last_error: error
    });
  },

  async countPendingUploads(orgId?: string) {
    await ensureSetup();
    const db = await getDb();
    const org = typeof orgId === 'string' ? orgId.trim() : '';
    const orgClause = org ? ' AND org_id = ?' : '';
    const row = await db.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM ${TABLE_NAME}
        WHERE (
          upload_status = 'PENDING'
          OR upload_status = 'UPLOADING'
          OR (upload_status = 'FAILED' AND retry_count < ?)
        )
        ${orgClause}
      `,
      securityPolicies.maxSyncAttempts,
      ...(org ? [org] : [])
    );

    return row?.count ?? 0;
  },

  async countFailedUploads(orgId?: string) {
    await ensureSetup();
    const db = await getDb();
    const org = typeof orgId === 'string' ? orgId.trim() : '';
    const orgClause = org ? ' AND org_id = ?' : '';
    const row = await db.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM ${TABLE_NAME}
        WHERE upload_status = 'FAILED'
        ${orgClause}
      `,
      ...(org ? [org] : [])
    );

    return row?.count ?? 0;
  },

  async listLatestByOrg(orgId: string, limit = 100) {
    await ensureSetup();
    const db = await getDb();

    const rows = await db.getAllAsync<MediaRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE org_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      orgId,
      Math.max(1, limit)
    );

    return rows.map(mapRow);
  },

  async runMaintenance() {
    await cleanupOrphanedThumbs();
    await cleanupOldExports();
  }
};
