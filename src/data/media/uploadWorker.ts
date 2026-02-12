import { appEnv } from '../../core/env';
import { requireSupabaseClient } from '../../core/supabase/client';
import { MediaAsset } from './types';
import { media } from './mediaPipeline';

const STORAGE_BUCKET = 'conformeo-media';
const UPLOAD_TIMEOUT_MS = 20_000;

function extensionFromMime(mime: MediaAsset['mime']) {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'application/pdf') return 'pdf';
  return 'jpg';
}

function resolveRemotePath(asset: MediaAsset) {
  const extension = extensionFromMime(asset.mime);
  const dayKey = asset.created_at.slice(0, 10);
  const project = asset.project_id ?? 'unscoped-project';
  return `${asset.org_id}/${project}/${dayKey}/${asset.id}.${extension}`;
}

async function loadBlobFromLocalPath(localPath: string) {
  const response = await fetch(localPath);
  if (!response.ok) {
    throw new Error(`Unable to read local file for upload (${response.status}).`);
  }

  return response.blob();
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    task.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function isTerminalUploadError(message: string) {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('bucket not found') ||
    lowered.includes('not authorized') ||
    lowered.includes('unauthorized') ||
    lowered.includes('forbidden') ||
    lowered.includes('permission') ||
    lowered.includes('invalid') ||
    lowered.includes('policy')
  );
}

async function uploadSingle(asset: MediaAsset) {
  const client = requireSupabaseClient();
  const remotePath = resolveRemotePath(asset);
  const blob = await loadBlobFromLocalPath(asset.local_path);

  const { error } = await withTimeout(
    client.storage.from(STORAGE_BUCKET).upload(remotePath, blob, {
      contentType: asset.mime,
      upsert: true
    }),
    UPLOAD_TIMEOUT_MS,
    'media upload'
  );

  if (error) {
    throw new Error(error.message);
  }

  const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(remotePath);

  await media.markUploaded(asset.id, remotePath, data.publicUrl);
}

export const mediaUploadWorker = {
  async runPendingUploads(limit = 12) {
    if (!appEnv.isSupabaseConfigured) {
      return { uploaded: 0, failed: 0, pending: await media.countPendingUploads() };
    }

    const batch = await media.getUploadPendingBatch(limit);
    let uploaded = 0;
    let failed = 0;

    for (const asset of batch) {
      await media.markUploading(asset.id);

      try {
        await uploadSingle(asset);
        uploaded += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'Upload failed';
        await media.markFailed(asset.id, message, {
          terminal: isTerminalUploadError(message)
        });
        break;
      }
    }

    return {
      uploaded,
      failed,
      pending: await media.countPendingUploads()
    };
  },

  async getPendingCount() {
    return media.countPendingUploads();
  }
};
