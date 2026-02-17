import * as SQLite from 'expo-sqlite';
import { requireSupabaseClient } from '../../core/supabase/client';
import { toErrorMessage } from '../../core/identity-security/utils';
import { OrgQuotas, OrgUsage } from './types';

const DB_NAME = 'conformeo.db';

const QUOTAS_CACHE_TABLE = 'org_quotas_cache';
const USAGE_CACHE_TABLE = 'org_usage_cache';

const MEDIA_TABLE = 'media_assets';
const EXPORTS_TABLE = 'export_jobs';

const DEFAULT_QUOTAS: Omit<OrgQuotas, 'org_id'> = {
  storage_mb: 10240,
  exports_per_day: 20,
  media_per_day: 500,
  max_file_mb: 25
};

type QuotasCacheRow = {
  org_id: string;
  storage_mb: number;
  exports_per_day: number;
  media_per_day: number;
  max_file_mb: number;
  updated_at: string;
};

type UsageCacheRow = {
  org_id: string;
  storage_used_mb: number;
  exports_today: number;
  media_today: number;
  computed_at: string;
  updated_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

const quotasMemory = new Map<string, OrgQuotas>();
const usageMemory = new Map<string, OrgUsage>();

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function dayKeyLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfTodayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function bytesToMb(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 0;
  }

  return bytes / 1024 / 1024;
}

function toOrgQuotas(row: QuotasCacheRow): OrgQuotas {
  return {
    org_id: row.org_id,
    storage_mb: row.storage_mb,
    exports_per_day: row.exports_per_day,
    media_per_day: row.media_per_day,
    max_file_mb: row.max_file_mb,
    updated_at: row.updated_at
  };
}

function toOrgUsage(row: UsageCacheRow): OrgUsage {
  return {
    org_id: row.org_id,
    storage_used_mb: row.storage_used_mb,
    exports_today: row.exports_today,
    media_today: row.media_today,
    computed_at: row.computed_at
  };
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

        CREATE TABLE IF NOT EXISTS ${QUOTAS_CACHE_TABLE} (
          org_id TEXT PRIMARY KEY NOT NULL,
          storage_mb INTEGER NOT NULL,
          exports_per_day INTEGER NOT NULL,
          media_per_day INTEGER NOT NULL,
          max_file_mb INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${USAGE_CACHE_TABLE} (
          org_id TEXT PRIMARY KEY NOT NULL,
          storage_used_mb REAL NOT NULL,
          exports_today INTEGER NOT NULL,
          media_today INTEGER NOT NULL,
          computed_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    })();
  }

  return setupPromise;
}

function requireOrgId() {
  const orgId = normalizeText(contextOrgId);
  if (!orgId) {
    throw new Error('org_id manquant (quotas).');
  }
  return orgId;
}

async function readQuotasCache(orgId: string): Promise<OrgQuotas | null> {
  const memory = quotasMemory.get(orgId);
  if (memory) {
    return memory;
  }

  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<QuotasCacheRow>(
    `
      SELECT org_id, storage_mb, exports_per_day, media_per_day, max_file_mb, updated_at
      FROM ${QUOTAS_CACHE_TABLE}
      WHERE org_id = ?
      LIMIT 1
    `,
    orgId
  );

  if (!row) {
    return null;
  }

  const mapped = toOrgQuotas(row);
  quotasMemory.set(orgId, mapped);
  return mapped;
}

async function writeQuotasCache(row: OrgQuotas) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${QUOTAS_CACHE_TABLE}
      (org_id, storage_mb, exports_per_day, media_per_day, max_file_mb, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    row.org_id,
    Math.max(1, Math.floor(row.storage_mb)),
    Math.max(1, Math.floor(row.exports_per_day)),
    Math.max(1, Math.floor(row.media_per_day)),
    Math.max(1, Math.floor(row.max_file_mb)),
    row.updated_at ?? nowIso()
  );

  quotasMemory.set(row.org_id, row);
}

async function readUsageCache(orgId: string): Promise<OrgUsage | null> {
  const memory = usageMemory.get(orgId);
  if (memory) {
    return memory;
  }

  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<UsageCacheRow>(
    `
      SELECT org_id, storage_used_mb, exports_today, media_today, computed_at, updated_at
      FROM ${USAGE_CACHE_TABLE}
      WHERE org_id = ?
      LIMIT 1
    `,
    orgId
  );

  if (!row) {
    return null;
  }

  const mapped = toOrgUsage(row);
  usageMemory.set(orgId, mapped);
  return mapped;
}

async function writeUsageCache(row: OrgUsage & { computed_at?: string }) {
  await ensureSetup();
  const db = await getDb();

  const computedAt = row.computed_at ?? nowIso();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${USAGE_CACHE_TABLE}
      (org_id, storage_used_mb, exports_today, media_today, computed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    row.org_id,
    Math.max(0, Number(row.storage_used_mb) || 0),
    Math.max(0, Math.floor(row.exports_today)),
    Math.max(0, Math.floor(row.media_today)),
    computedAt,
    nowIso()
  );

  usageMemory.set(row.org_id, {
    org_id: row.org_id,
    storage_used_mb: Math.max(0, Number(row.storage_used_mb) || 0),
    exports_today: Math.max(0, Math.floor(row.exports_today)),
    media_today: Math.max(0, Math.floor(row.media_today)),
    computed_at: computedAt
  });
}

async function countLocalMediaToday(orgId: string) {
  await ensureSetup();
  const db = await getDb();

  if (!(await tableExists(db, MEDIA_TABLE))) {
    return 0;
  }

  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM ${MEDIA_TABLE}
      WHERE org_id = ?
        AND created_at >= ?
    `,
    orgId,
    startOfTodayIso()
  );

  return row?.count ?? 0;
}

async function sumPendingMediaBytes(orgId: string) {
  await ensureSetup();
  const db = await getDb();

  if (!(await tableExists(db, MEDIA_TABLE))) {
    return 0;
  }

  const row = await db.getFirstAsync<{ size_bytes: number }>(
    `
      SELECT COALESCE(SUM(size_bytes), 0) AS size_bytes
      FROM ${MEDIA_TABLE}
      WHERE org_id = ?
        AND upload_status != 'UPLOADED'
    `,
    orgId
  );

  return Number(row?.size_bytes ?? 0) || 0;
}

async function countLocalExportsToday(orgId: string) {
  await ensureSetup();
  const db = await getDb();

  if (!(await tableExists(db, EXPORTS_TABLE))) {
    return 0;
  }

  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM ${EXPORTS_TABLE}
      WHERE org_id = ?
        AND created_at >= ?
    `,
    orgId,
    startOfTodayIso()
  );

  return row?.count ?? 0;
}

export const quotas = {
  setContext(context: { org_id?: string; user_id?: string }) {
    contextOrgId = normalizeText(context.org_id) || null;
    contextUserId = normalizeText(context.user_id) || null;

    quotasMemory.clear();
    usageMemory.clear();
  },

  async get(): Promise<OrgQuotas> {
    const orgId = normalizeText(contextOrgId);

    if (!orgId) {
      return {
        org_id: 'unknown',
        ...DEFAULT_QUOTAS
      };
    }

    const cached = await readQuotasCache(orgId);
    if (cached) {
      return cached;
    }

    return {
      org_id: orgId,
      ...DEFAULT_QUOTAS
    };
  },

  async getUsage(): Promise<OrgUsage> {
    const orgId = normalizeText(contextOrgId);

    if (!orgId) {
      return {
        org_id: 'unknown',
        storage_used_mb: 0,
        exports_today: 0,
        media_today: 0,
        computed_at: nowIso()
      };
    }

    const [cachedUsage, localMediaToday, localExportsToday] = await Promise.all([
      readUsageCache(orgId),
      countLocalMediaToday(orgId),
      countLocalExportsToday(orgId)
    ]);

    const today = dayKeyLocal(new Date());
    const cachedDay = cachedUsage?.computed_at ? dayKeyLocal(new Date(cachedUsage.computed_at)) : null;

    const remoteExportsToday = cachedUsage && cachedDay === today ? cachedUsage.exports_today : 0;
    const remoteMediaToday = cachedUsage && cachedDay === today ? cachedUsage.media_today : 0;

    return {
      org_id: orgId,
      storage_used_mb: cachedUsage?.storage_used_mb ?? 0,
      exports_today: Math.max(remoteExportsToday, localExportsToday),
      media_today: Math.max(remoteMediaToday, localMediaToday),
      computed_at: cachedUsage?.computed_at
    };
  },

  async refresh(): Promise<{ quotas: OrgQuotas; usage: OrgUsage } | null> {
    const orgId = normalizeText(contextOrgId);

    if (!orgId) {
      return null;
    }

    const client = requireSupabaseClient();

    try {
      const { data: quotasRow, error } = await client
        .from('org_quotas')
        .select('org_id, storage_mb, exports_per_day, media_per_day, max_file_mb, updated_at')
        .eq('org_id', orgId)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (quotasRow) {
        const mapped: OrgQuotas = {
          org_id: String(quotasRow.org_id),
          storage_mb: Number(quotasRow.storage_mb) || DEFAULT_QUOTAS.storage_mb,
          exports_per_day: Number(quotasRow.exports_per_day) || DEFAULT_QUOTAS.exports_per_day,
          media_per_day: Number(quotasRow.media_per_day) || DEFAULT_QUOTAS.media_per_day,
          max_file_mb: Number(quotasRow.max_file_mb) || DEFAULT_QUOTAS.max_file_mb,
          updated_at: typeof quotasRow.updated_at === 'string' ? quotasRow.updated_at : nowIso()
        };

        await writeQuotasCache(mapped);
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[quotas] refresh quotas failed:', toErrorMessage(error));
      }
    }

    try {
      const { data: usageRow, error } = await client.rpc('refresh_org_usage', {
        p_org_id: orgId
      });

      if (error) {
        throw new Error(error.message);
      }

      if (usageRow && typeof usageRow === 'object' && !Array.isArray(usageRow)) {
        const record = usageRow as Record<string, unknown>;
        const mapped: OrgUsage = {
          org_id: String(record.org_id ?? orgId),
          storage_used_mb: Number(record.storage_used_mb) || 0,
          exports_today: Number(record.exports_today) || 0,
          media_today: Number(record.media_today) || 0,
          computed_at: typeof record.computed_at === 'string' ? record.computed_at : nowIso()
        };

        await writeUsageCache(mapped);
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[quotas] refresh usage failed:', toErrorMessage(error));
      }
    }

    const [nextQuotas, nextUsage] = await Promise.all([this.get(), this.getUsage()]);
    return { quotas: nextQuotas, usage: nextUsage };
  },

  async update(patch: Partial<Omit<OrgQuotas, 'org_id' | 'updated_at'>>): Promise<OrgQuotas> {
    const orgId = requireOrgId();
    const client = requireSupabaseClient();

    const updatePayload: Record<string, unknown> = {};

    if (typeof patch.storage_mb === 'number') updatePayload.storage_mb = Math.floor(patch.storage_mb);
    if (typeof patch.exports_per_day === 'number') updatePayload.exports_per_day = Math.floor(patch.exports_per_day);
    if (typeof patch.media_per_day === 'number') updatePayload.media_per_day = Math.floor(patch.media_per_day);
    if (typeof patch.max_file_mb === 'number') updatePayload.max_file_mb = Math.floor(patch.max_file_mb);

    const { data, error } = await client
      .from('org_quotas')
      .update(updatePayload)
      .eq('org_id', orgId)
      .select('org_id, storage_mb, exports_per_day, media_per_day, max_file_mb, updated_at')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    const mapped: OrgQuotas = {
      org_id: String(data.org_id),
      storage_mb: Number(data.storage_mb) || DEFAULT_QUOTAS.storage_mb,
      exports_per_day: Number(data.exports_per_day) || DEFAULT_QUOTAS.exports_per_day,
      media_per_day: Number(data.media_per_day) || DEFAULT_QUOTAS.media_per_day,
      max_file_mb: Number(data.max_file_mb) || DEFAULT_QUOTAS.max_file_mb,
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : nowIso()
    };

    await writeQuotasCache(mapped);
    return mapped;
  },

  async explainUploadBlock(sizeMb: number): Promise<string | null> {
    const orgId = normalizeText(contextOrgId);

    if (!orgId) {
      return null;
    }

    const [quotaRow, usageRow, pendingBytes, localMediaToday] = await Promise.all([
      this.get(),
      this.getUsage(),
      sumPendingMediaBytes(orgId),
      countLocalMediaToday(orgId)
    ]);

    if (Number.isFinite(sizeMb) && sizeMb > quotaRow.max_file_mb) {
      return `Fichier trop lourd: ${Math.ceil(sizeMb)} MB (max ${quotaRow.max_file_mb} MB).`;
    }

    if (localMediaToday >= quotaRow.media_per_day) {
      return `Quota medias/jour atteint (${localMediaToday}/${quotaRow.media_per_day}).`;
    }

    const projectedMb = usageRow.storage_used_mb + bytesToMb(pendingBytes) + Math.max(0, sizeMb);

    if (projectedMb >= quotaRow.storage_mb) {
      return `Quota stockage depasse (env. ${Math.ceil(projectedMb)}MB/${quotaRow.storage_mb}MB).`;
    }

    return null;
  },

  async canUpload(sizeMb: number) {
    const reason = await this.explainUploadBlock(sizeMb);
    return reason === null;
  },

  async explainExportBlock(): Promise<string | null> {
    const orgId = normalizeText(contextOrgId);

    if (!orgId) {
      return null;
    }

    const [quotaRow, localExportsToday] = await Promise.all([this.get(), countLocalExportsToday(orgId)]);

    if (localExportsToday >= quotaRow.exports_per_day) {
      return `Quota exports/jour atteint (${localExportsToday}/${quotaRow.exports_per_day}).`;
    }

    return null;
  },

  async canCreateExport() {
    const reason = await this.explainExportBlock();
    return reason === null;
  },

  async recordMediaCreated() {
    const orgId = normalizeText(contextOrgId);
    if (orgId) {
      usageMemory.delete(orgId);
    }
  },

  async recordExportCreated() {
    const orgId = normalizeText(contextOrgId);
    if (orgId) {
      usageMemory.delete(orgId);
    }
  },

  async purgeOldExports(days: number) {
    const { exportsDoe } = await import('../exports');

    if (contextOrgId) {
      exportsDoe.setOrg(contextOrgId);
    }

    return exportsDoe.purgeOldExports(days);
  },

  async cleanupCache() {
    const { media } = await import('../media');
    await media.runMaintenance();
  }
};

void contextUserId;
