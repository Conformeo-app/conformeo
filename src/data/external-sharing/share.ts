import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';
import { appEnv } from '../../core/env';
import { getSecureValue, removeSecureValue, setSecureValue } from '../../core/security/secureStore';
import { requireSupabaseClient } from '../../core/supabase/client';
import { documents } from '../documents';
import { exportsDoe } from '../exports';
import { media } from '../media';
import { ShareCreateResult, ShareEntity, ShareLink } from './types';

const DB_NAME = 'conformeo.db';
const SHARE_CACHE_TABLE = 'share_links_cache';

const TOKEN_KEY_PREFIX = 'conformeo.share.token.';

type ShareLinkRow = {
  id: string;
  org_id: string;
  entity: ShareEntity;
  entity_id: string;
  resource_bucket: string;
  resource_path: string;
  expires_at: string;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function tokenKey(linkId: string) {
  return `${TOKEN_KEY_PREFIX}${linkId}`;
}

function requireOrgId() {
  const orgId = normalizeText(contextOrgId);
  if (!orgId) {
    throw new Error('org_id manquant (external-sharing).');
  }
  return orgId;
}

function requireUserId() {
  const userId = normalizeText(contextUserId);
  if (!userId) {
    throw new Error('user_id manquant (external-sharing).');
  }
  return userId;
}

function baseSharePublicUrl() {
  const baseUrl = appEnv.supabaseUrl?.replace(/\/$/, '');
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}/functions/v1/share-public?token=`;
}

function mapRow(row: ShareLinkRow): ShareLink {
  return {
    id: row.id,
    org_id: row.org_id,
    entity: row.entity,
    entity_id: row.entity_id,
    resource_bucket: row.resource_bucket,
    resource_path: row.resource_path,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at ?? undefined,
    created_by: row.created_by,
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

        CREATE TABLE IF NOT EXISTS ${SHARE_CACHE_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          resource_bucket TEXT NOT NULL,
          resource_path TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_share_links_cache_org_entity
          ON ${SHARE_CACHE_TABLE}(org_id, entity, entity_id, created_at DESC);
      `);
    })();
  }

  return setupPromise;
}

async function cacheUpsert(link: ShareLink) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${SHARE_CACHE_TABLE}
      (id, org_id, entity, entity_id, resource_bucket, resource_path, expires_at, revoked_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    link.id,
    link.org_id,
    link.entity,
    link.entity_id,
    link.resource_bucket,
    link.resource_path,
    link.expires_at,
    link.revoked_at ?? null,
    link.created_by,
    link.created_at,
    nowIso()
  );
}

async function cacheList(orgId: string, entity: ShareEntity, entityId: string): Promise<ShareLink[]> {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<ShareLinkRow>(
    `
      SELECT id, org_id, entity, entity_id, resource_bucket, resource_path, expires_at, revoked_at, created_by, created_at, updated_at
      FROM ${SHARE_CACHE_TABLE}
      WHERE org_id = ?
        AND entity = ?
        AND entity_id = ?
      ORDER BY created_at DESC
    `,
    orgId,
    entity,
    entityId
  );

  return rows.map(mapRow);
}

async function attachDeviceUrls(links: ShareLink[]): Promise<ShareLink[]> {
  const base = baseSharePublicUrl();

  return Promise.all(
    links.map(async (link) => {
      const token = await getSecureValue(tokenKey(link.id));
      const tokenAvailable = Boolean(token && base);

      return {
        ...link,
        token_available: tokenAvailable,
        public_url: tokenAvailable ? `${base}${encodeURIComponent(token!)}` : null
      };
    })
  );
}

async function assertOnline() {
  const state = await Network.getNetworkStateAsync();
  const online = Boolean(state.isConnected && state.isInternetReachable !== false);

  if (!online) {
    throw new Error('Réseau requis pour générer un lien de partage.');
  }
}

function exportMimeFromType(type: string) {
  return type === 'REPORT_PDF' ? 'application/pdf' : 'application/zip';
}

function exportExtensionFromMime(mime: string) {
  return mime === 'application/pdf' ? 'pdf' : 'zip';
}

function exportRemotePath(job: { org_id: string; project_id: string; created_at: string; id: string; type: string }) {
  const mime = exportMimeFromType(job.type);
  const ext = exportExtensionFromMime(mime);
  const dayKey = job.created_at.slice(0, 10);
  const project = normalizeText(job.project_id) || 'unscoped-project';
  return {
    bucket: 'conformeo-exports',
    path: `${job.org_id}/${project}/${dayKey}/${job.id}.${ext}`,
    mime
  };
}

async function loadBlobFromUri(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Impossible de lire le fichier local (${response.status}).`);
  }
  return response.blob();
}

async function uploadToStorage(input: { bucket: string; path: string; localUri: string; mime: string }) {
  const client = requireSupabaseClient();
  const blob = await loadBlobFromUri(input.localUri);

  const { error } = await client.storage.from(input.bucket).upload(input.path, blob, {
    contentType: input.mime,
    upsert: true
  });

  if (error) {
    throw new Error(error.message);
  }

  return input.path;
}

async function resolveDocumentResource(documentId: string) {
  const doc = await documents.getById(documentId);
  if (!doc) {
    throw new Error('Document introuvable.');
  }

  const versions = await documents.listVersions(documentId);
  const active =
    versions.find((version) => version.id === doc.active_version_id) ??
    versions.sort((left, right) => right.version_number - left.version_number)[0];

  if (!active) {
    throw new Error('Aucune version disponible pour ce document.');
  }

  const asset = await media.getById(active.file_asset_id);
  if (!asset) {
    throw new Error('Media introuvable pour cette version.');
  }

  if (asset.upload_status !== 'UPLOADED' || !asset.remote_path) {
    throw new Error('Document non uploadé. Lance une sync puis réessaie.');
  }

  return {
    org_id: doc.org_id,
    bucket: 'conformeo-media',
    path: asset.remote_path
  };
}

async function resolveExportResource(jobId: string) {
  const job = await exportsDoe.getById(jobId);
  if (!job) {
    throw new Error('Export introuvable.');
  }

  if (job.status !== 'DONE' || !job.local_path) {
    throw new Error('Export non terminé (fichier local indisponible).');
  }

  const remote = exportRemotePath(job);
  await uploadToStorage({
    bucket: remote.bucket,
    path: remote.path,
    localUri: job.local_path,
    mime: remote.mime
  });

  return {
    org_id: job.org_id,
    bucket: remote.bucket,
    path: remote.path
  };
}

export const share = {
  setContext(input: { org_id?: string; user_id?: string }) {
    contextOrgId = input.org_id ?? null;
    contextUserId = input.user_id ?? null;
  },

  async create(entity: ShareEntity, entityId: string, opts: { expiresInHours: number }): Promise<ShareCreateResult> {
    if (!appEnv.isSupabaseConfigured) {
      throw new Error('Supabase non configuré.');
    }

    await assertOnline();

    const orgId = requireOrgId();
    const userId = requireUserId();

    const cleanEntityId = normalizeText(entityId);
    if (!cleanEntityId) {
      throw new Error('entityId manquant.');
    }

    let resource: { org_id: string; bucket: string; path: string };

    if (entity === 'DOCUMENT') {
      resource = await resolveDocumentResource(cleanEntityId);
    } else {
      resource = await resolveExportResource(cleanEntityId);
    }

    if (resource.org_id !== orgId) {
      throw new Error('Mauvaise organisation pour ce partage.');
    }

    const client = requireSupabaseClient();

    const { data, error } = await client.functions.invoke('share-create', {
      body: {
        org_id: orgId,
        entity,
        entity_id: cleanEntityId,
        resource_bucket: resource.bucket,
        resource_path: resource.path,
        expires_in_hours: Math.max(1, Math.floor(opts.expiresInHours || 72))
      }
    });

    if (error) {
      throw new Error(error.message || 'share-create failed');
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    if (payload.status !== 'OK') {
      const reason = typeof payload.reason === 'string' ? payload.reason : 'share-create rejected';
      throw new Error(reason);
    }

    const id = typeof payload.id === 'string' ? payload.id : '';
    const token = typeof payload.token === 'string' ? payload.token : '';
    const expiresAt = typeof payload.expires_at === 'string' ? payload.expires_at : '';
    const url = typeof payload.url === 'string' ? payload.url : '';

    if (!id || !token || !url) {
      throw new Error('Réponse share-create invalide.');
    }

    await setSecureValue(tokenKey(id), token);

    await cacheUpsert({
      id,
      org_id: orgId,
      entity,
      entity_id: cleanEntityId,
      resource_bucket: resource.bucket,
      resource_path: resource.path,
      expires_at: expiresAt || nowIso(),
      revoked_at: undefined,
      created_by: userId,
      created_at: nowIso()
    });

    return {
      id,
      url,
      expires_at: expiresAt || nowIso()
    };
  },

  async list(entity: ShareEntity, entityId: string): Promise<ShareLink[]> {
    const orgId = requireOrgId();

    const cleanEntityId = normalizeText(entityId);
    if (!cleanEntityId) {
      throw new Error('entityId manquant.');
    }

    if (!appEnv.isSupabaseConfigured) {
      const cached = await cacheList(orgId, entity, cleanEntityId);
      return attachDeviceUrls(cached);
    }

    const client = requireSupabaseClient();

    try {
      const { data, error } = await client
        .from('share_links')
        .select('id, org_id, entity, entity_id, resource_bucket, resource_path, expires_at, revoked_at, created_by, created_at')
        .eq('org_id', orgId)
        .eq('entity', entity)
        .eq('entity_id', cleanEntityId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      const rows = (data ?? []) as unknown as ShareLinkRow[];
      const mapped = rows.map(mapRow);

      for (const link of mapped) {
        await cacheUpsert(link);
      }

      return attachDeviceUrls(mapped);
    } catch {
      const cached = await cacheList(orgId, entity, cleanEntityId);
      return attachDeviceUrls(cached);
    }
  },

  async revoke(linkId: string): Promise<void> {
    const orgId = requireOrgId();

    const id = normalizeText(linkId);
    if (!id) {
      throw new Error('linkId manquant.');
    }

    if (!appEnv.isSupabaseConfigured) {
      throw new Error('Supabase non configuré.');
    }

    await assertOnline();

    const client = requireSupabaseClient();

    const revokedAt = nowIso();

    const { error } = await client
      .from('share_links')
      .update({ revoked_at: revokedAt })
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) {
      throw new Error(error.message);
    }

    await removeSecureValue(tokenKey(id));

    // Update local cache best-effort.
    try {
      await ensureSetup();
      const db = await getDb();

      await db.runAsync(
        `
          UPDATE ${SHARE_CACHE_TABLE}
          SET revoked_at = ?,
              updated_at = ?
          WHERE id = ?
        `,
        revokedAt,
        nowIso(),
        id
      );
    } catch {
      // no-op
    }
  }
};
