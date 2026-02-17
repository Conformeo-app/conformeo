import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as SQLite from 'expo-sqlite';
import { geo } from '../geo-context';
import { offlineDB } from '../offline/outbox';
import { waste } from '../waste-volume';
import defaultFactors from './defaultFactors.json';
import {
  CarbonFootprintSummary,
  CarbonReportPdfResult,
  EmissionFactorSet,
  EnergyEntry,
  TravelEntry
} from './types';

const DB_NAME = 'conformeo.db';
const TRAVEL_TABLE = 'travel_entries';
const ENERGY_TABLE = 'energy_entries';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type TravelRow = {
  id: string;
  org_id: string;
  project_id: string;
  mode: string;
  distance_km: number;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type EnergyRow = {
  id: string;
  org_id: string;
  project_id: string;
  energy_type: string;
  quantity: number;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function toOptional(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function ensureFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ensurePositive(value: unknown, label: string) {
  if (!ensureFiniteNumber(value) || value <= 0) {
    throw new Error(`${label} invalide (doit etre > 0).`);
  }
  return value;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
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

function carbonRootDir() {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error('FileSystem documentDirectory unavailable on this device.');
  }
  return `${base}carbon_footprint/`;
}

function exportsDir() {
  return `${carbonRootDir()}exports/`;
}

async function ensureDirectories() {
  await FileSystem.makeDirectoryAsync(carbonRootDir(), { intermediates: true });
  await FileSystem.makeDirectoryAsync(exportsDir(), { intermediates: true });
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensureFactors(): EmissionFactorSet {
  const factors = defaultFactors as unknown;
  if (!factors || typeof factors !== 'object' || Array.isArray(factors)) {
    return {
      waste_kgco2e_per_m3: {},
      travel_kgco2e_per_km: {},
      energy_kgco2e_per_unit: {}
    };
  }

  const record = factors as Record<string, unknown>;
  const wasteFactors = record.waste_kgco2e_per_m3;
  const travelFactors = record.travel_kgco2e_per_km;
  const energyFactors = record.energy_kgco2e_per_unit;

  return {
    waste_kgco2e_per_m3:
      wasteFactors && typeof wasteFactors === 'object' && !Array.isArray(wasteFactors)
        ? (wasteFactors as Record<string, number>)
        : {},
    travel_kgco2e_per_km:
      travelFactors && typeof travelFactors === 'object' && !Array.isArray(travelFactors)
        ? (travelFactors as Record<string, number>)
        : {},
    energy_kgco2e_per_unit:
      energyFactors && typeof energyFactors === 'object' && !Array.isArray(energyFactors)
        ? (energyFactors as Record<string, number>)
        : {}
  };
}

function mapTravelRow(row: TravelRow): TravelEntry {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    mode: row.mode,
    distance_km: row.distance_km,
    note: toOptional(row.note),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
  };
}

function mapEnergyRow(row: EnergyRow): EnergyEntry {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    energy_type: row.energy_type,
    quantity: row.quantity,
    note: toOptional(row.note),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
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
      await ensureDirectories();
      const db = await getDb();
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS ${TRAVEL_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          distance_km REAL NOT NULL,
          note TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_travel_org_project_created
          ON ${TRAVEL_TABLE}(org_id, project_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_travel_org_mode_created
          ON ${TRAVEL_TABLE}(org_id, mode, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_travel_deleted
          ON ${TRAVEL_TABLE}(deleted_at);

        CREATE TABLE IF NOT EXISTS ${ENERGY_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          energy_type TEXT NOT NULL,
          quantity REAL NOT NULL,
          note TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_energy_org_project_created
          ON ${ENERGY_TABLE}(org_id, project_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_energy_org_type_created
          ON ${ENERGY_TABLE}(org_id, energy_type, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_energy_deleted
          ON ${ENERGY_TABLE}(deleted_at);
      `);
    })();
  }

  return setupPromise;
}

async function enqueueOperation(entity: string, entityId: string, orgId: string, payload: Record<string, unknown>) {
  await offlineDB.enqueueOperation({
    entity,
    entity_id: entityId,
    type: 'CREATE',
    payload: {
      ...payload,
      id: entityId,
      org_id: orgId,
      orgId
    }
  });
}

async function getTravelByProject(orgId: string, projectId: string, limit = MAX_LIMIT, offset = 0) {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<TravelRow>(
    `
      SELECT *
      FROM ${TRAVEL_TABLE}
      WHERE org_id = ?
        AND project_id = ?
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    orgId,
    projectId,
    limit,
    offset
  );

  return rows.map(mapTravelRow);
}

async function getEnergyByProject(orgId: string, projectId: string, limit = MAX_LIMIT, offset = 0) {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<EnergyRow>(
    `
      SELECT *
      FROM ${ENERGY_TABLE}
      WHERE org_id = ?
        AND project_id = ?
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    orgId,
    projectId,
    limit,
    offset
  );

  return rows.map(mapEnergyRow);
}

async function fileSize(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === 'number' ? info.size : 0;
}

export const carbon = {
  factors: ensureFactors(),

  async addTravel(input: {
    org_id: string;
    project_id: string;
    mode: string;
    distance_km: number;
    created_by: string;
    note?: string;
  }): Promise<TravelEntry> {
    await ensureSetup();

    const orgId = normalizeText(input.org_id);
    const projectId = normalizeText(input.project_id);
    const createdBy = normalizeText(input.created_by);
    const mode = normalizeText(input.mode) || 'OTHER';
    const distanceKm = ensurePositive(input.distance_km, 'distance_km');

    if (!orgId) throw new Error('org_id requis.');
    if (!projectId) throw new Error('project_id requis.');
    if (!createdBy) throw new Error('created_by requis.');

    const createdAt = nowIso();
    const entry: TravelEntry = {
      id: createUuid(),
      org_id: orgId,
      project_id: projectId,
      mode,
      distance_km: distanceKm,
      note: toOptional(input.note),
      created_by: createdBy,
      created_at: createdAt,
      updated_at: createdAt
    };

    const db = await getDb();
    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${TRAVEL_TABLE}
        (id, org_id, project_id, mode, distance_km, note, created_by, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      entry.id,
      entry.org_id,
      entry.project_id,
      entry.mode,
      entry.distance_km,
      entry.note ?? null,
      entry.created_by,
      entry.created_at,
      entry.updated_at
    );

    await offlineDB.enqueueOperation({
      entity: 'travel_entries',
      entity_id: entry.id,
      type: 'CREATE',
      payload: {
        ...entry,
        org_id: entry.org_id,
        orgId: entry.org_id,
        project_id: entry.project_id
      }
    });

    void geo.capture({
      entity: 'TRAVEL_ENTRY',
      entity_id: entry.id,
      org_id: entry.org_id,
      user_id: entry.created_by,
      project_id: entry.project_id
    });

    return entry;
  },

  async addEnergy(input: {
    org_id: string;
    project_id: string;
    energy_type: string;
    quantity: number;
    created_by: string;
    note?: string;
  }): Promise<EnergyEntry> {
    await ensureSetup();

    const orgId = normalizeText(input.org_id);
    const projectId = normalizeText(input.project_id);
    const createdBy = normalizeText(input.created_by);
    const energyType = normalizeText(input.energy_type) || 'OTHER';
    const quantity = ensurePositive(input.quantity, 'quantity');

    if (!orgId) throw new Error('org_id requis.');
    if (!projectId) throw new Error('project_id requis.');
    if (!createdBy) throw new Error('created_by requis.');

    const createdAt = nowIso();
    const entry: EnergyEntry = {
      id: createUuid(),
      org_id: orgId,
      project_id: projectId,
      energy_type: energyType,
      quantity,
      note: toOptional(input.note),
      created_by: createdBy,
      created_at: createdAt,
      updated_at: createdAt
    };

    const db = await getDb();
    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${ENERGY_TABLE}
        (id, org_id, project_id, energy_type, quantity, note, created_by, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      entry.id,
      entry.org_id,
      entry.project_id,
      entry.energy_type,
      entry.quantity,
      entry.note ?? null,
      entry.created_by,
      entry.created_at,
      entry.updated_at
    );

    await offlineDB.enqueueOperation({
      entity: 'energy_entries',
      entity_id: entry.id,
      type: 'CREATE',
      payload: {
        ...entry,
        org_id: entry.org_id,
        orgId: entry.org_id,
        project_id: entry.project_id
      }
    });

    void geo.capture({
      entity: 'ENERGY_ENTRY',
      entity_id: entry.id,
      org_id: entry.org_id,
      user_id: entry.created_by,
      project_id: entry.project_id
    });

    return entry;
  },

  async listTravel(projectId: string, filters: { org_id: string; limit?: number; offset?: number } ) {
    const orgId = normalizeText(filters.org_id);
    const pid = normalizeText(projectId);
    if (!orgId || !pid) return [] as TravelEntry[];
    const limit = Math.max(1, Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    return getTravelByProject(orgId, pid, limit, offset);
  },

  async listEnergy(projectId: string, filters: { org_id: string; limit?: number; offset?: number } ) {
    const orgId = normalizeText(filters.org_id);
    const pid = normalizeText(projectId);
    if (!orgId || !pid) return [] as EnergyEntry[];
    const limit = Math.max(1, Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    return getEnergyByProject(orgId, pid, limit, offset);
  },

  async computeProject(orgId: string, projectId: string): Promise<CarbonFootprintSummary> {
    const org = normalizeText(orgId);
    const pid = normalizeText(projectId);
    if (!org || !pid) {
      throw new Error('orgId/projectId requis.');
    }

    const factors = ensureFactors();

    const [wasteRows, travelRows, energyRows] = await Promise.all([
      waste.listByProject(pid, { org_id: org, category: 'ALL', limit: MAX_LIMIT, offset: 0 }),
      getTravelByProject(org, pid, MAX_LIMIT, 0),
      getEnergyByProject(org, pid, MAX_LIMIT, 0)
    ]);

    const wasteM3ByCategory: Record<string, number> = {};
    const byWasteCategoryKg: Record<string, number> = {};
    let wasteKg = 0;

    for (const row of wasteRows) {
      const category = normalizeText(String(row.category)) || 'AUTRE';
      wasteM3ByCategory[category] = (wasteM3ByCategory[category] ?? 0) + row.volume_m3;
    }

    for (const [category, m3] of Object.entries(wasteM3ByCategory)) {
      const factor = factors.waste_kgco2e_per_m3[category] ?? factors.waste_kgco2e_per_m3.AUTRE ?? 0;
      const kg = m3 * factor;
      byWasteCategoryKg[category] = round3(kg);
      wasteKg += kg;
    }

    const travelKmByMode: Record<string, number> = {};
    const byTravelModeKg: Record<string, number> = {};
    let travelKg = 0;

    for (const row of travelRows) {
      const mode = normalizeText(String(row.mode)) || 'OTHER';
      travelKmByMode[mode] = (travelKmByMode[mode] ?? 0) + row.distance_km;
    }

    for (const [mode, km] of Object.entries(travelKmByMode)) {
      const factor = factors.travel_kgco2e_per_km[mode] ?? factors.travel_kgco2e_per_km.OTHER ?? 0;
      const kg = km * factor;
      byTravelModeKg[mode] = round3(kg);
      travelKg += kg;
    }

    const energyQtyByType: Record<string, number> = {};
    const byEnergyTypeKg: Record<string, number> = {};
    let energyKg = 0;

    for (const row of energyRows) {
      const type = normalizeText(String(row.energy_type)) || 'OTHER';
      energyQtyByType[type] = (energyQtyByType[type] ?? 0) + row.quantity;
    }

    for (const [type, qty] of Object.entries(energyQtyByType)) {
      const factor = factors.energy_kgco2e_per_unit[type] ?? factors.energy_kgco2e_per_unit.OTHER ?? 0;
      const kg = qty * factor;
      byEnergyTypeKg[type] = round3(kg);
      energyKg += kg;
    }

    const total = wasteKg + travelKg + energyKg;

    return {
      org_id: org,
      project_id: pid,
      computed_at: nowIso(),
      total_kgco2e: round3(total),
      waste_kgco2e: round3(wasteKg),
      travel_kgco2e: round3(travelKg),
      energy_kgco2e: round3(energyKg),
      by_waste_category_kgco2e: byWasteCategoryKg,
      by_travel_mode_kgco2e: byTravelModeKg,
      by_energy_type_kgco2e: byEnergyTypeKg,
      inputs: {
        waste_m3_by_category: Object.fromEntries(
          Object.entries(wasteM3ByCategory).map(([k, v]) => [k, round3(v)])
        ),
        travel_km_by_mode: Object.fromEntries(Object.entries(travelKmByMode).map(([k, v]) => [k, round3(v)])),
        energy_qty_by_type: Object.fromEntries(Object.entries(energyQtyByType).map(([k, v]) => [k, round3(v)]))
      },
      factors
    };
  },

  async generateReportPdf(orgId: string, projectId: string): Promise<CarbonReportPdfResult> {
    await ensureSetup();
    const summary = await this.computeProject(orgId, projectId);
    const createdAt = nowIso();
    const reportId = createUuid();

    const wasteRows = Object.entries(summary.inputs.waste_m3_by_category)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, m3]) => {
        const factor = summary.factors.waste_kgco2e_per_m3[category] ?? summary.factors.waste_kgco2e_per_m3.AUTRE ?? 0;
        const kg = summary.by_waste_category_kgco2e[category] ?? 0;
        return `<tr><td>${htmlEscape(category)}</td><td>${m3}</td><td>${factor}</td><td>${kg}</td></tr>`;
      })
      .join('');

    const travelRows = Object.entries(summary.inputs.travel_km_by_mode)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mode, km]) => {
        const factor = summary.factors.travel_kgco2e_per_km[mode] ?? summary.factors.travel_kgco2e_per_km.OTHER ?? 0;
        const kg = summary.by_travel_mode_kgco2e[mode] ?? 0;
        return `<tr><td>${htmlEscape(mode)}</td><td>${km}</td><td>${factor}</td><td>${kg}</td></tr>`;
      })
      .join('');

    const energyRows = Object.entries(summary.inputs.energy_qty_by_type)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, qty]) => {
        const factor = summary.factors.energy_kgco2e_per_unit[type] ?? summary.factors.energy_kgco2e_per_unit.OTHER ?? 0;
        const kg = summary.by_energy_type_kgco2e[type] ?? 0;
        return `<tr><td>${htmlEscape(type)}</td><td>${qty}</td><td>${factor}</td><td>${kg}</td></tr>`;
      })
      .join('');

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial; padding: 22px; color: #0F172A; }
            h1 { margin: 0 0 4px 0; font-size: 22px; }
            .sub { color: #475569; margin: 0 0 14px 0; font-size: 12px; }
            .pill { display: inline-block; background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 999px; padding: 4px 10px; margin: 4px 6px 0 0; font-size: 12px; font-weight: 600; }
            h2 { margin-top: 18px; font-size: 15px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { border: 1px solid #E2E8F0; padding: 8px; font-size: 11px; vertical-align: top; }
            th { background: #F8FAFC; text-align: left; }
            .footer { margin-top: 18px; font-size: 10px; color: #64748B; }
            .warn { margin-top: 12px; font-size: 10px; color: #64748B; }
          </style>
        </head>
        <body>
          <h1>Bilan carbone (simplifie)</h1>
          <p class="sub">Org: ${htmlEscape(summary.org_id)} • Chantier: ${htmlEscape(summary.project_id)} • ${new Date(createdAt).toLocaleString('fr-FR')} • id: ${htmlEscape(reportId)}</p>

          <div>
            <span class="pill">Total: ${summary.total_kgco2e} kgCO2e</span>
            <span class="pill">Dechets: ${summary.waste_kgco2e} kgCO2e</span>
            <span class="pill">Deplacements: ${summary.travel_kgco2e} kgCO2e</span>
            <span class="pill">Energie: ${summary.energy_kgco2e} kgCO2e</span>
          </div>

          <h2>Dechets (m3)</h2>
          <table>
            <thead>
              <tr><th>Categorie</th><th>Volume (m3)</th><th>Facteur (kgCO2e/m3)</th><th>Emissions (kgCO2e)</th></tr>
            </thead>
            <tbody>
              ${wasteRows || '<tr><td colspan="4">Aucune entree dechets</td></tr>'}
            </tbody>
          </table>

          <h2>Deplacements (km)</h2>
          <table>
            <thead>
              <tr><th>Mode</th><th>Distance (km)</th><th>Facteur (kgCO2e/km)</th><th>Emissions (kgCO2e)</th></tr>
            </thead>
            <tbody>
              ${travelRows || '<tr><td colspan="4">Aucune entree deplacement</td></tr>'}
            </tbody>
          </table>

          <h2>Energie (unites)</h2>
          <table>
            <thead>
              <tr><th>Type</th><th>Quantite</th><th>Facteur (kgCO2e/unite)</th><th>Emissions (kgCO2e)</th></tr>
            </thead>
            <tbody>
              ${energyRows || '<tr><td colspan="4">Aucune entree energie</td></tr>'}
            </tbody>
          </table>

          <div class="warn">
            Facteurs d'emission: simplification MVP (a ajuster selon ta methode). Le resultat n'est pas une comptabilite officielle.
          </div>

          <div class="footer">Genere par Conformeo</div>
        </body>
      </html>
    `;

    const rendered = await Print.printToFileAsync({ html, base64: false });
    const sizeBytes = await fileSize(rendered.uri);
    const targetPath = `${exportsDir()}CARBON_${projectId}_${createdAt.slice(0, 10)}_${reportId}.pdf`;

    try {
      await FileSystem.moveAsync({ from: rendered.uri, to: targetPath });
    } catch {
      await FileSystem.copyAsync({ from: rendered.uri, to: targetPath });
    }

    return {
      path: targetPath,
      size_bytes: sizeBytes,
      created_at: createdAt
    };
  }
};

