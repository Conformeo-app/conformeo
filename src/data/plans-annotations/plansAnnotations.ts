import * as SQLite from 'expo-sqlite';
import { DocumentVersion, documents } from '../documents';
import { media } from '../media';
import { offlineDB } from '../offline/outbox';
import { assertProjectWritable } from '../control-mode/readOnly';
import { tasks } from '../tasks';
import {
  ActivePlanRecord,
  PlanCreatePinContext,
  PlanCreatePinMeta,
  PlanJumpTarget,
  PlanOpenResult,
  PlanPin,
  PlanPinFilters,
  PlanPinLink,
  PlanPinLinkEntity,
  PinLinkCounts,
  PlanPinPriority,
  PlanPinStatus,
  PlansAnnotationsApi,
  PlansAnnotationsContext,
  PlanUpdatePinPatch
} from './types';

const DB_NAME = 'conformeo.db';
const PINS_TABLE = 'plan_pins';
const LINKS_TABLE = 'plan_pin_links';
const ACTIVE_PLAN_TABLE = 'project_active_plan';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

type PinRow = {
  id: string;
  org_id: string;
  project_id: string;
  document_id: string;
  document_version_id: string;
  page_number: number;
  x: number;
  y: number;
  label: string | null;
  status: PlanPinStatus;
  priority: PlanPinPriority;
  assignee_user_id: string | null;
  comment: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type LinkRow = {
  id: string;
  pin_id: string;
  entity: PlanPinLinkEntity;
  entity_id: string;
  created_at: string;
};

type ActivePlanRow = {
  org_id: string;
  project_id: string;
  document_id: string;
  document_version_id: string;
  updated_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

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

function normalizeText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function optionalString(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function ensureCoordinate(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} doit être un nombre.`);
  }

  if (value < 0 || value > 1) {
    throw new Error(`${label} doit être normalisé entre 0 et 1.`);
  }

  return Number(value.toFixed(6));
}

function ensurePage(value: number, label = 'page_number') {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} doit être un nombre.`);
  }

  const next = Math.floor(value);
  if (next < 1) {
    throw new Error(`${label} doit être >= 1.`);
  }

  return next;
}

function ensurePinStatus(status: string): PlanPinStatus {
  if (status === 'OPEN' || status === 'DONE' || status === 'INFO') {
    return status;
  }

  throw new Error(`Statut de pin invalide: ${status}`);
}

function ensurePinPriority(priority: string): PlanPinPriority {
  if (priority === 'LOW' || priority === 'MEDIUM' || priority === 'HIGH') {
    return priority;
  }

  throw new Error(`Priorité de pin invalide: ${priority}`);
}

function ensureLinkEntity(entity: string): PlanPinLinkEntity {
  if (entity === 'TASK' || entity === 'MEDIA' || entity === 'DOCUMENT') {
    return entity;
  }

  throw new Error(`Type de lien invalide: ${entity}`);
}

function mapPinRow(row: PinRow): PlanPin {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    document_id: row.document_id,
    document_version_id: row.document_version_id,
    page_number: row.page_number,
    x: row.x,
    y: row.y,
    label: row.label ?? undefined,
    status: row.status,
    priority: row.priority,
    assignee_user_id: row.assignee_user_id ?? undefined,
    comment: row.comment ?? undefined,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapLinkRow(row: LinkRow): PlanPinLink {
  return {
    id: row.id,
    pin_id: row.pin_id,
    entity: row.entity,
    entity_id: row.entity_id,
    created_at: row.created_at
  };
}

function mapActivePlanRow(row: ActivePlanRow): ActivePlanRecord {
  return {
    project_id: row.project_id,
    document_id: row.document_id,
    document_version_id: row.document_version_id,
    updated_at: row.updated_at
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

    CREATE TABLE IF NOT EXISTS ${PINS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      document_version_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      label TEXT,
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'DONE', 'INFO')),
      priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
      assignee_user_id TEXT,
      comment TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plan_pins_document_version_page
      ON ${PINS_TABLE}(document_id, document_version_id, page_number);

    CREATE INDEX IF NOT EXISTS idx_plan_pins_project_updated
      ON ${PINS_TABLE}(project_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_plan_pins_org_updated
      ON ${PINS_TABLE}(org_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${LINKS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      pin_id TEXT NOT NULL,
      entity TEXT NOT NULL CHECK (entity IN ('TASK', 'MEDIA', 'DOCUMENT')),
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_pin_links_unique
      ON ${LINKS_TABLE}(pin_id, entity, entity_id);

    CREATE INDEX IF NOT EXISTS idx_plan_pin_links_pin
      ON ${LINKS_TABLE}(pin_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ACTIVE_PLAN_TABLE} (
      org_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      document_version_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (org_id, project_id)
    );

    CREATE INDEX IF NOT EXISTS idx_project_active_plan_updated
      ON ${ACTIVE_PLAN_TABLE}(org_id, updated_at DESC);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }

  return setupPromise;
}

async function getPinRow(pinId: string) {
  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<PinRow>(
    `
      SELECT *
      FROM ${PINS_TABLE}
      WHERE id = ?
      LIMIT 1
    `,
    pinId
  );

  return row ?? null;
}

async function ensurePin(pinId: string) {
  const row = await getPinRow(pinId);
  if (!row) {
    throw new Error('Pin introuvable.');
  }

  return mapPinRow(row);
}

async function savePin(pin: PlanPin) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${PINS_TABLE}
      (
        id, org_id, project_id,
        document_id, document_version_id,
        page_number, x, y,
        label, status, priority,
        assignee_user_id, comment,
        created_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    pin.id,
    pin.org_id,
    pin.project_id,
    pin.document_id,
    pin.document_version_id,
    pin.page_number,
    pin.x,
    pin.y,
    pin.label ?? null,
    pin.status,
    pin.priority,
    pin.assignee_user_id ?? null,
    pin.comment ?? null,
    pin.created_by,
    pin.created_at,
    pin.updated_at
  );

  return pin;
}

function ensureOrgAccess(orgId: string) {
  if (contextOrgId && contextOrgId !== orgId) {
    throw new Error('Accès refusé: pin hors organisation active.');
  }
}

async function resolveOpenResult(documentId: string, versionId?: string): Promise<PlanOpenResult> {
  const safeDocumentId = normalizeText(documentId);
  if (!safeDocumentId) {
    throw new Error('documentId est requis.');
  }

  const document = await documents.getById(safeDocumentId);
  if (!document) {
    throw new Error('Plan document introuvable.');
  }

  if (document.doc_type !== 'PLAN') {
    throw new Error('Le document sélectionné n\'est pas de type PLAN.');
  }

  ensureOrgAccess(document.org_id);

  const versions = await documents.listVersions(document.id);
  if (versions.length === 0) {
    throw new Error('Aucune version disponible pour ce plan.');
  }

  const safeVersionId = normalizeText(versionId);

  let resolvedVersion: DocumentVersion | undefined;
  if (safeVersionId) {
    resolvedVersion = versions.find((version) => version.id === safeVersionId);
  } else if (document.active_version_id) {
    resolvedVersion = versions.find((version) => version.id === document.active_version_id);
  }

  if (!resolvedVersion) {
    resolvedVersion = versions.sort((left, right) => right.version_number - left.version_number)[0];
  }

  if (!resolvedVersion) {
    throw new Error('Version de plan introuvable.');
  }

  return {
    document,
    version: resolvedVersion,
    versions: versions.sort((left, right) => right.version_number - left.version_number)
  };
}

async function listLinkRows(pinId: string) {
  await ensureSetup();
  const db = await getDb();

  return db.getAllAsync<LinkRow>(
    `
      SELECT *
      FROM ${LINKS_TABLE}
      WHERE pin_id = ?
      ORDER BY created_at DESC
    `,
    pinId
  );
}

async function getActivePlanRow(projectId: string) {
  await ensureSetup();
  const db = await getDb();

  const cleanedProjectId = normalizeText(projectId);
  if (!cleanedProjectId) {
    throw new Error('projectId est requis.');
  }

  const params: string[] = [];
  const where: string[] = [];

  where.push('project_id = ?');
  params.push(cleanedProjectId);

  if (contextOrgId) {
    where.push('org_id = ?');
    params.push(contextOrgId);
  }

  const row = await db.getFirstAsync<ActivePlanRow>(
    `
      SELECT *
      FROM ${ACTIVE_PLAN_TABLE}
      WHERE ${where.join(' AND ')}
      LIMIT 1
    `,
    ...params
  );

  return row ?? null;
}

async function enqueuePinOperation(pin: PlanPin, type: 'CREATE' | 'UPDATE' | 'DELETE', extra?: Record<string, unknown>) {
  await offlineDB.enqueueOperation({
    entity: 'plan_pins',
    entity_id: pin.id,
    type,
    payload: {
      ...pin,
      ...extra,
      org_id: pin.org_id,
      orgId: pin.org_id,
      project_id: pin.project_id,
      document_id: pin.document_id,
      document_version_id: pin.document_version_id
    }
  });
}

async function enqueueLinkOperation(
  link: PlanPinLink,
  pin: PlanPin,
  type: 'CREATE' | 'DELETE',
  extra?: Record<string, unknown>
) {
  await offlineDB.enqueueOperation({
    entity: 'plan_pin_links',
    entity_id: link.id,
    type,
    payload: {
      ...link,
      ...extra,
      org_id: pin.org_id,
      orgId: pin.org_id,
      project_id: pin.project_id,
      document_id: pin.document_id,
      document_version_id: pin.document_version_id
    }
  });
}

async function validateLinkTarget(pin: PlanPin, entity: PlanPinLinkEntity, entityId: string) {
  if (entity === 'TASK') {
    const task = await tasks.getById(entityId);
    if (!task) {
      throw new Error('Tâche liée introuvable.');
    }

    if (task.org_id !== pin.org_id) {
      throw new Error('La tâche appartient à une autre organisation.');
    }

    return;
  }

  if (entity === 'MEDIA') {
    const asset = await media.getById(entityId);
    if (!asset) {
      throw new Error('Média lié introuvable.');
    }

    if (asset.org_id !== pin.org_id) {
      throw new Error('Le média appartient à une autre organisation.');
    }

    return;
  }

  const document = await documents.getById(entityId);
  if (!document) {
    throw new Error('Document lié introuvable.');
  }

  if (document.org_id !== pin.org_id) {
    throw new Error('Le document appartient à une autre organisation.');
  }
}

export const plans: PlansAnnotationsApi = {
  setContext(context: Partial<PlansAnnotationsContext>) {
    contextOrgId = optionalString(context.org_id) ?? null;
    contextUserId = optionalString(context.user_id) ?? null;
  },

  setActor(userId: string | null) {
    contextUserId = optionalString(userId) ?? null;
  },

  setOrg(orgId: string | null) {
    contextOrgId = optionalString(orgId) ?? null;
  },

  async listProjectPlans(projectId: string) {
    const cleanedProjectId = normalizeText(projectId);
    if (!cleanedProjectId) {
      throw new Error('projectId est requis.');
    }

    const orgId = contextOrgId ?? undefined;

    const [projectPlans, companyPlans] = await Promise.all([
      documents.list('PROJECT', cleanedProjectId, {
        org_id: orgId,
        doc_type: 'PLAN',
        limit: 250,
        offset: 0
      }),
      orgId
        ? documents.list('COMPANY', undefined, {
            org_id: orgId,
            doc_type: 'PLAN',
            limit: 250,
            offset: 0
          })
        : Promise.resolve([])
    ]);

    const merged = [...projectPlans, ...companyPlans];
    const byId = new Map<string, (typeof merged)[number]>();
    for (const document of merged) {
      byId.set(document.id, document);
    }

    return Array.from(byId.values()).sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  },

  async getActivePlan(projectId: string): Promise<ActivePlanRecord | null> {
    const row = await getActivePlanRow(projectId);
    return row ? mapActivePlanRow(row) : null;
  },

  async setActivePlan(projectId: string, documentId: string, versionId?: string): Promise<PlanOpenResult> {
    const cleanedProjectId = normalizeText(projectId);
    if (!cleanedProjectId) {
      throw new Error('projectId est requis.');
    }

    const openResult = await resolveOpenResult(documentId, versionId);

    if (openResult.document.scope === 'PROJECT' && openResult.document.project_id) {
      if (openResult.document.project_id !== cleanedProjectId) {
        throw new Error('Ce plan ne correspond pas au chantier actif.');
      }
    }

    await ensureSetup();
    const db = await getDb();

    const updatedAt = nowIso();
    await db.runAsync(
      `
        INSERT OR REPLACE INTO ${ACTIVE_PLAN_TABLE}
        (org_id, project_id, document_id, document_version_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      openResult.document.org_id,
      cleanedProjectId,
      openResult.document.id,
      openResult.version.id,
      updatedAt
    );

    return openResult;
  },

  async openActive(projectId: string): Promise<PlanOpenResult | null> {
    const cleanedProjectId = normalizeText(projectId);
    if (!cleanedProjectId) {
      throw new Error('projectId est requis.');
    }

    const active = await plans.getActivePlan(cleanedProjectId);
    if (active) {
      try {
        return await resolveOpenResult(active.document_id, active.document_version_id);
      } catch {
        // ignore and try fallback
      }
    }

    const candidates = await plans.listProjectPlans(cleanedProjectId);
    const first = candidates[0];
    if (!first) {
      return null;
    }

    try {
      return await plans.setActivePlan(cleanedProjectId, first.id, first.active_version_id ?? undefined);
    } catch {
      return null;
    }
  },

  async open(documentId: string, versionId?: string): Promise<PlanOpenResult> {
    return resolveOpenResult(documentId, versionId);
  },

  async listPins(documentId: string, versionId?: string, filters: PlanPinFilters = {}): Promise<PlanPin[]> {
    const openResult = await resolveOpenResult(documentId, versionId);

    await ensureSetup();
    const db = await getDb();

    const where: string[] = ['document_id = ?', 'document_version_id = ?'];
    const params: Array<string | number> = [openResult.document.id, openResult.version.id];

    if (filters.status && filters.status !== 'ALL') {
      where.push('status = ?');
      params.push(ensurePinStatus(filters.status));
    }

    if (typeof filters.page_number === 'number') {
      where.push('page_number = ?');
      params.push(ensurePage(filters.page_number, 'filters.page_number'));
    }

    const limit = Math.max(1, Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));

    const rows = await db.getAllAsync<PinRow>(
      `
        SELECT *
        FROM ${PINS_TABLE}
        WHERE ${where.join(' AND ')}
        ORDER BY page_number ASC, created_at DESC
        LIMIT ? OFFSET ?
      `,
      ...params,
      limit,
      offset
    );

    return rows.map(mapPinRow);
  },

  async listPinsByProject(projectId: string, filters: Pick<PlanPinFilters, 'status' | 'limit' | 'offset'> = {}) {
    const cleanedProjectId = normalizeText(projectId);
    if (!cleanedProjectId) {
      throw new Error('projectId est requis.');
    }

    await ensureSetup();
    const db = await getDb();

    const where: string[] = ['project_id = ?'];
    const params: Array<string | number> = [cleanedProjectId];

    if (contextOrgId) {
      where.push('org_id = ?');
      params.push(contextOrgId);
    }

    if (filters.status && filters.status !== 'ALL') {
      where.push('status = ?');
      params.push(ensurePinStatus(filters.status));
    }

    const limit = Math.max(1, Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));

    const rows = await db.getAllAsync<PinRow>(
      `
        SELECT *
        FROM ${PINS_TABLE}
        WHERE ${where.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
      ...params,
      limit,
      offset
    );

    return rows.map(mapPinRow);
  },

  async createPin(ctx: PlanCreatePinContext, meta: PlanCreatePinMeta = {}): Promise<PlanPin> {
    const openResult = await resolveOpenResult(ctx.documentId, ctx.versionId);

    const projectId = optionalString(ctx.projectId) ?? optionalString(openResult.document.project_id);
    if (!projectId) {
      throw new Error('projectId est requis pour créer un pin.');
    }

    if (openResult.document.scope === 'PROJECT' && openResult.document.project_id) {
      if (projectId !== openResult.document.project_id) {
        throw new Error('projectId incohérent avec le document de plan.');
      }
    }

    await assertProjectWritable(openResult.document.org_id, projectId);

    const createdBy = optionalString(meta.created_by) ?? contextUserId ?? openResult.document.created_by;
    if (!createdBy) {
      throw new Error('created_by est requis pour créer un pin.');
    }

    const now = nowIso();

    const pin: PlanPin = {
      id: optionalString(meta.id) ?? createUuid(),
      org_id: openResult.document.org_id,
      project_id: projectId,
      document_id: openResult.document.id,
      document_version_id: openResult.version.id,
      page_number: ensurePage(ctx.page, 'ctx.page'),
      x: ensureCoordinate(ctx.x, 'ctx.x'),
      y: ensureCoordinate(ctx.y, 'ctx.y'),
      label: optionalString(meta.label),
      status: meta.status ? ensurePinStatus(meta.status) : 'OPEN',
      priority: meta.priority ? ensurePinPriority(meta.priority) : 'MEDIUM',
      assignee_user_id: optionalString(meta.assignee_user_id),
      comment: optionalString(meta.comment),
      created_by: createdBy,
      created_at: now,
      updated_at: now
    };

    await savePin(pin);
    await enqueuePinOperation(pin, 'CREATE', {
      version_number: openResult.version.version_number
    });

    return pin;
  },

  async updatePin(pinId: string, patch: PlanUpdatePinPatch): Promise<PlanPin> {
    const current = await ensurePin(pinId);
    ensureOrgAccess(current.org_id);
    await assertProjectWritable(current.org_id, current.project_id);

    const nextPage = patch.page_number !== undefined ? ensurePage(patch.page_number) : current.page_number;
    const nextX = patch.x !== undefined ? ensureCoordinate(patch.x, 'patch.x') : current.x;
    const nextY = patch.y !== undefined ? ensureCoordinate(patch.y, 'patch.y') : current.y;

    const updated: PlanPin = {
      ...current,
      page_number: nextPage,
      x: nextX,
      y: nextY,
      label: patch.label !== undefined ? optionalString(patch.label) : current.label,
      status: patch.status !== undefined ? ensurePinStatus(patch.status) : current.status,
      priority: patch.priority !== undefined ? ensurePinPriority(patch.priority) : current.priority,
      assignee_user_id:
        patch.assignee_user_id !== undefined ? optionalString(patch.assignee_user_id) : current.assignee_user_id,
      comment: patch.comment !== undefined ? optionalString(patch.comment) : current.comment,
      updated_at: nowIso()
    };

    await savePin(updated);
    await enqueuePinOperation(updated, 'UPDATE', {
      patch,
      data: updated
    });

    return updated;
  },

  async deletePin(pinId: string): Promise<void> {
    const pin = await ensurePin(pinId);
    ensureOrgAccess(pin.org_id);
    await assertProjectWritable(pin.org_id, pin.project_id);

    await ensureSetup();
    const db = await getDb();

    const links = await listLinkRows(pin.id);

    await db.runAsync(`DELETE FROM ${LINKS_TABLE} WHERE pin_id = ?`, pin.id);
    await db.runAsync(`DELETE FROM ${PINS_TABLE} WHERE id = ?`, pin.id);

    for (const linkRow of links) {
      await enqueueLinkOperation(mapLinkRow(linkRow), pin, 'DELETE', {
        deleted_at: nowIso()
      });
    }

    await enqueuePinOperation(pin, 'DELETE', {
      deleted_at: nowIso()
    });
  },

  async link(pinId: string, entity: PlanPinLinkEntity, entityId: string): Promise<void> {
    const pin = await ensurePin(pinId);
    ensureOrgAccess(pin.org_id);
    await assertProjectWritable(pin.org_id, pin.project_id);

    const safeEntity = ensureLinkEntity(entity);
    const safeEntityId = normalizeText(entityId);

    if (!safeEntityId) {
      throw new Error('entityId est requis.');
    }

    await validateLinkTarget(pin, safeEntity, safeEntityId);

    await ensureSetup();
    const db = await getDb();

    const existing = await db.getFirstAsync<LinkRow>(
      `
        SELECT *
        FROM ${LINKS_TABLE}
        WHERE pin_id = ?
          AND entity = ?
          AND entity_id = ?
        LIMIT 1
      `,
      pin.id,
      safeEntity,
      safeEntityId
    );

    if (existing) {
      return;
    }

    const link: PlanPinLink = {
      id: createUuid(),
      pin_id: pin.id,
      entity: safeEntity,
      entity_id: safeEntityId,
      created_at: nowIso()
    };

    await db.runAsync(
      `
        INSERT INTO ${LINKS_TABLE}
        (id, pin_id, entity, entity_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      link.id,
      link.pin_id,
      link.entity,
      link.entity_id,
      link.created_at
    );

    await enqueueLinkOperation(link, pin, 'CREATE');
  },

  async unlink(pinId: string, entity: PlanPinLinkEntity, entityId: string): Promise<void> {
    const pin = await ensurePin(pinId);
    ensureOrgAccess(pin.org_id);
    await assertProjectWritable(pin.org_id, pin.project_id);

    const safeEntity = ensureLinkEntity(entity);
    const safeEntityId = normalizeText(entityId);

    if (!safeEntityId) {
      throw new Error('entityId est requis.');
    }

    await ensureSetup();
    const db = await getDb();

    const existing = await db.getFirstAsync<LinkRow>(
      `
        SELECT *
        FROM ${LINKS_TABLE}
        WHERE pin_id = ?
          AND entity = ?
          AND entity_id = ?
        LIMIT 1
      `,
      pin.id,
      safeEntity,
      safeEntityId
    );

    if (!existing) {
      return;
    }

    await db.runAsync(`DELETE FROM ${LINKS_TABLE} WHERE id = ?`, existing.id);

    await enqueueLinkOperation(mapLinkRow(existing), pin, 'DELETE', {
      deleted_at: nowIso()
    });
  },

  async listLinks(pinId: string): Promise<PlanPinLink[]> {
    await ensurePin(pinId);
    const rows = await listLinkRows(pinId);
    return rows.map(mapLinkRow);
  },

  async getLinkCounts(pinIds: string[]): Promise<Record<string, PinLinkCounts>> {
    const cleaned = (pinIds ?? []).map((id) => normalizeText(id)).filter((id) => id.length > 0);
    if (cleaned.length === 0) {
      return {};
    }

    await ensureSetup();
    const db = await getDb();

    const placeholders = cleaned.map(() => '?').join(', ');
    const rows = await db.getAllAsync<{ pin_id: string; entity: PlanPinLinkEntity; count: number }>(
      `
        SELECT pin_id, entity, COUNT(*) AS count
        FROM ${LINKS_TABLE}
        WHERE pin_id IN (${placeholders})
        GROUP BY pin_id, entity
      `,
      ...cleaned
    );

    const result: Record<string, PinLinkCounts> = {};
    for (const pinId of cleaned) {
      result[pinId] = { tasks: 0, media: 0, documents: 0 };
    }

    for (const row of rows) {
      const bucket = result[row.pin_id] ?? { tasks: 0, media: 0, documents: 0 };
      const count = typeof row.count === 'number' ? row.count : Number(row.count);
      if (row.entity === 'TASK') bucket.tasks = count;
      if (row.entity === 'MEDIA') bucket.media = count;
      if (row.entity === 'DOCUMENT') bucket.documents = count;
      result[row.pin_id] = bucket;
    }

    return result;
  },

  async jumpToPin(pinId: string): Promise<PlanJumpTarget> {
    const pin = await ensurePin(pinId);

    return {
      pin_id: pin.id,
      document_id: pin.document_id,
      document_version_id: pin.document_version_id,
      page_number: pin.page_number,
      x: pin.x,
      y: pin.y
    };
  },

  async createTaskFromPin(pinId: string, template = {}) {
    const pin = await ensurePin(pinId);
    ensureOrgAccess(pin.org_id);
    await assertProjectWritable(pin.org_id, pin.project_id);

    const createdBy = contextUserId ?? pin.created_by;

    const tags = Array.from(new Set([...(template.tags ?? []), 'plan_pin']));

    const task = await tasks.create({
      org_id: pin.org_id,
      project_id: pin.project_id,
      created_by: createdBy,
      title: template.title ?? pin.label ?? `Point plan p.${pin.page_number}`,
      description: template.description ?? pin.comment,
      status: template.status ?? (pin.status === 'DONE' ? 'DONE' : 'TODO'),
      priority: template.priority ?? pin.priority,
      tags
    });

    await plans.link(pin.id, 'TASK', task.id);
    return task;
  },

  async addPhotoToPin(pinId: string) {
    const pin = await ensurePin(pinId);
    ensureOrgAccess(pin.org_id);
    await assertProjectWritable(pin.org_id, pin.project_id);

    const asset = await media.capturePhoto({
      org_id: pin.org_id,
      project_id: pin.project_id,
      plan_pin_id: pin.id,
      tag: 'plan_pin'
    });

    await plans.link(pin.id, 'MEDIA', asset.id);
    return asset;
  }
};
