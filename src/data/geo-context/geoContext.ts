import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import { offlineDB } from '../offline/outbox';
import { GeoCaptureInput, GeoContext, GeoPerimeter, GeoPerimeterResult, GeoProvider, GeoRecord } from './types';

const DB_NAME = 'conformeo.db';
const TABLE_NAME = 'geo_records';

type GeoRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  project_id: string | null;
  entity: string;
  entity_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  created_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;
let activeContext: GeoContext = {};
let provider: GeoProvider | null = null;
let cachedCoords: { coords: { lat: number; lng: number; accuracy?: number }; capturedAtMs: number } | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | undefined | null) {
  return typeof value === 'string' ? value.trim() : '';
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

function toOptional(value: string | null) {
  return value && value.trim().length > 0 ? value : undefined;
}

function ensureFinite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

function mapRow(row: GeoRow): GeoRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    user_id: toOptional(row.user_id),
    project_id: toOptional(row.project_id),
    entity: row.entity,
    entity_id: row.entity_id,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy ?? undefined,
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

    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      user_id TEXT,
      project_id TEXT,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy REAL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_geo_records_org_entity_created
      ON ${TABLE_NAME}(org_id, entity, entity_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_geo_records_org_created
      ON ${TABLE_NAME}(org_id, created_at DESC);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }
  return setupPromise;
}

async function insertRecord(record: GeoRecord) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${TABLE_NAME}
      (
        id, org_id, user_id, project_id,
        entity, entity_id,
        lat, lng, accuracy,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    record.id,
    record.org_id,
    record.user_id ?? null,
    record.project_id ?? null,
    record.entity,
    record.entity_id,
    record.lat,
    record.lng,
    record.accuracy ?? null,
    record.created_at
  );

  await offlineDB.enqueueOperation({
    id: offlineDB.createOperationId('geo'),
    entity: 'geo_records',
    entity_id: record.id,
    type: 'CREATE',
    payload: {
      ...record,
      orgId: record.org_id,
      org_id: record.org_id,
      user_id: record.user_id
    }
  });

  return record;
}

function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371e3; // metres
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const deltaPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLambda = ((b.lng - a.lng) * Math.PI) / 180;

  const sinDeltaPhi = Math.sin(deltaPhi / 2);
  const sinDeltaLambda = Math.sin(deltaLambda / 2);

  const c =
    2 *
    Math.atan2(
      Math.sqrt(sinDeltaPhi * sinDeltaPhi + Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda),
      Math.sqrt(1 - (sinDeltaPhi * sinDeltaPhi + Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda))
    );

  return R * c;
}

async function getCurrentPositionFromExpoLocation() {
  const now = Date.now();
  if (cachedCoords && now - cachedCoords.capturedAtMs < 30_000) {
    return cachedCoords.coords;
  }

  const permissions = await Location.getForegroundPermissionsAsync();
  if (permissions.status !== 'granted') {
    throw new Error('Location permission not granted');
  }

  const lastKnown = await Location.getLastKnownPositionAsync({});
  if (lastKnown) {
    const coords = {
      lat: lastKnown.coords.latitude,
      lng: lastKnown.coords.longitude,
      accuracy: lastKnown.coords.accuracy ?? undefined
    };
    cachedCoords = { coords, capturedAtMs: now };
    return coords;
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced
  });

  const coords = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy ?? undefined
  };

  cachedCoords = { coords, capturedAtMs: now };
  return coords;
}

export const geo = {
  setContext(context: GeoContext) {
    activeContext = { ...context };
  },

  setProvider(next: GeoProvider | null) {
    provider = next;
  },

  async getPermissionStatus() {
    const permissions = await Location.getForegroundPermissionsAsync();
    return permissions.status;
  },

  async requestPermission() {
    const permissions = await Location.requestForegroundPermissionsAsync();
    return permissions.status;
  },

  /**
   * Best-effort GPS capture: returns null when GPS provider is not configured/available.
   * This function must never block the UI flow.
   */
  async capture(input: GeoCaptureInput): Promise<GeoRecord | null> {
    const entity = normalizeText(input.entity);
    const entityId = normalizeText(input.entity_id);

    if (!entity || !entityId) {
      throw new Error('geo.capture: entity et entity_id requis.');
    }

    const orgId = normalizeText(input.org_id ?? activeContext.org_id);
    if (!orgId) {
      // Do not throw (called from non-blocking hooks); just skip.
      return null;
    }

    const userId = normalizeText(input.user_id ?? activeContext.user_id) || undefined;
    const projectId = normalizeText(input.project_id) || undefined;
    const createdAt = normalizeText(input.created_at) || nowIso();

    let coords = input.coords;
    if (!coords) {
      try {
        coords = provider ? await provider.getCurrentPosition() : await getCurrentPositionFromExpoLocation();
      } catch (error) {
        if (__DEV__) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn('[geo-context] getCurrentPosition failed:', message);
        }
        return null;
      }
    }

    if (!ensureFinite(coords.lat) || !ensureFinite(coords.lng)) {
      return null;
    }

    const record: GeoRecord = {
      id: createUuid(),
      org_id: orgId,
      user_id: userId,
      project_id: projectId,
      entity,
      entity_id: entityId,
      lat: coords.lat,
      lng: coords.lng,
      accuracy: ensureFinite(coords.accuracy) ? coords.accuracy : undefined,
      created_at: createdAt
    };

    try {
      return await insertRecord(record);
    } catch (error) {
      if (__DEV__) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[geo-context] insert failed:', message);
      }
      return null;
    }
  },

  async getLatest(entity: string, entityId: string, orgId?: string) {
    const e = normalizeText(entity);
    const id = normalizeText(entityId);
    const org = normalizeText(orgId ?? activeContext.org_id);

    if (!e || !id || !org) {
      return null;
    }

    await ensureSetup();
    const db = await getDb();
    const row = await db.getFirstAsync<GeoRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE org_id = ?
          AND entity = ?
          AND entity_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
      org,
      e,
      id
    );

    return row ? mapRow(row) : null;
  },

  async list(entity: string, entityId: string, opts?: { orgId?: string; limit?: number }) {
    const e = normalizeText(entity);
    const id = normalizeText(entityId);
    const org = normalizeText(opts?.orgId ?? activeContext.org_id);
    const limit = typeof opts?.limit === 'number' && opts.limit > 0 ? Math.min(500, Math.floor(opts.limit)) : 50;

    if (!e || !id || !org) {
      return [] as GeoRecord[];
    }

    await ensureSetup();
    const db = await getDb();
    const rows = await db.getAllAsync<GeoRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE org_id = ?
          AND entity = ?
          AND entity_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      org,
      e,
      id,
      limit
    );

    return rows.map(mapRow);
  },

  checkPerimeter(current: { lat: number; lng: number }, perimeter: GeoPerimeter): GeoPerimeterResult {
    const distance = haversineDistanceMeters(current, { lat: perimeter.center_lat, lng: perimeter.center_lng });
    return {
      inside: distance <= perimeter.radius_meters,
      distance_meters: distance
    };
  }
};
