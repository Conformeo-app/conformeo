import * as SQLite from 'expo-sqlite';

const DB_NAME = 'conformeo.db';
const CONTROL_STATE_TABLE = 'control_mode_state';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
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

export async function isProjectReadOnly(orgId: string, projectId: string): Promise<boolean> {
  const safeOrgId = normalizeText(orgId);
  const safeProjectId = normalizeText(projectId);

  if (!safeOrgId || !safeProjectId) {
    return false;
  }

  try {
    const db = await getDb();
    const exists = await tableExists(db, CONTROL_STATE_TABLE);
    if (!exists) {
      return false;
    }

    const row = await db.getFirstAsync<{ enabled: number | string | null }>(
      `
        SELECT enabled
        FROM ${CONTROL_STATE_TABLE}
        WHERE org_id = ?
          AND project_id = ?
        LIMIT 1
      `,
      safeOrgId,
      safeProjectId
    );

    const enabledRaw = row?.enabled ?? 0;
    const enabled = typeof enabledRaw === 'number' ? enabledRaw : Number(enabledRaw);
    return enabled === 1;
  } catch {
    // Fail-open: never block work due to a local read error.
    return false;
  }
}

export async function assertProjectWritable(orgId: string, projectId: string) {
  const readOnly = await isProjectReadOnly(orgId, projectId);
  if (!readOnly) {
    return;
  }

  throw new Error('Mode contrôle actif : ce chantier est en lecture seule (preuves autorisées).');
}

