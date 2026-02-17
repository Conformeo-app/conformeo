import * as SQLite from 'expo-sqlite';
import { AppRole } from '../../core/identity-security/types';
import { AddVersionContext, Document, DocumentType, documents } from '../documents';
import { offlineDB } from '../offline/outbox';
import {
  Certification,
  CertificationCreateInput,
  CertificationStatus,
  CertificationUpdatePatch,
  CompanyCheck,
  CompanyHubApi,
  CompanyHubContext,
  CompanySection,
  CompanySectionKey,
  HubDocumentMeta
} from './types';

const DB_NAME = 'conformeo.db';
const SECTIONS_TABLE = 'company_sections';
const CERTIFICATIONS_TABLE = 'certifications';
const CHECKS_TABLE = 'company_checks';

type SectionTemplate = {
  key: CompanySectionKey;
  label: string;
  sort_order: number;
  defaultDocType: DocumentType;
};

type CheckTemplate = {
  key: string;
  label: string;
};

type SectionRow = {
  id: string;
  org_id: string;
  key: CompanySectionKey;
  label: string;
  sort_order: number;
  created_at: string;
};

type CertificationRow = {
  id: string;
  org_id: string;
  name: string;
  issuer: string | null;
  valid_from: string | null;
  valid_to: string | null;
  doc_id: string | null;
  status: CertificationStatus;
  created_at: string;
  updated_at: string;
  created_by: string;
};

type CheckRow = {
  id: string;
  org_id: string;
  key: string;
  label: string;
  checked: number;
  comment: string | null;
  updated_at: string;
  updated_by: string | null;
};

const SECTION_TEMPLATES: SectionTemplate[] = [
  { key: 'DOCS_INTERNAL', label: 'Documents internes', sort_order: 0, defaultDocType: 'INTERNAL' },
  { key: 'REGULATIONS', label: 'Réglementations des locaux', sort_order: 1, defaultDocType: 'REPORT' },
  { key: 'FIRE_SAFETY', label: 'Sécurité incendie', sort_order: 2, defaultDocType: 'REPORT' },
  { key: 'CERTIFICATIONS', label: 'Certifications', sort_order: 3, defaultDocType: 'REPORT' },
  { key: 'PROCEDURES', label: 'Procédures', sort_order: 4, defaultDocType: 'INTERNAL' },
  { key: 'MANDATORY_POSTERS', label: 'Affichages obligatoires', sort_order: 5, defaultDocType: 'INTERNAL' }
];

const CHECK_TEMPLATES: CheckTemplate[] = [
  { key: 'extincteurs_accessibles', label: 'Extincteurs accessibles et vérifiés' },
  { key: 'issues_secours_libres', label: 'Issues de secours dégagées' },
  { key: 'plans_evacuation_affiches', label: 'Plans d\'évacuation affichés' },
  { key: 'registre_securite_a_jour', label: 'Registre sécurité à jour' },
  { key: 'alarme_incendie_testee', label: 'Alarme incendie testée' }
];

const WRITER_ROLES = new Set<AppRole>(['ADMIN', 'MANAGER']);

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;
let contextRole: AppRole = 'FIELD';

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
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

function parseDateIsoOrThrow(input: string | undefined, label: string) {
  if (!input) {
    return undefined;
  }

  const cleaned = normalizeText(input);
  if (!cleaned) {
    return undefined;
  }

  const parsed = Date.parse(cleaned);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} invalide. Utilise un format ISO (YYYY-MM-DD ou date ISO complète).`);
  }

  return new Date(parsed).toISOString();
}

function ensureSectionKey(sectionKey: string): CompanySectionKey {
  const match = SECTION_TEMPLATES.find((item) => item.key === sectionKey);
  if (!match) {
    throw new Error(`Section invalide: ${sectionKey}`);
  }

  return match.key;
}

function getSectionTemplate(sectionKey: CompanySectionKey) {
  const template = SECTION_TEMPLATES.find((item) => item.key === sectionKey);
  if (!template) {
    throw new Error(`Section introuvable: ${sectionKey}`);
  }

  return template;
}

function ensureCertificationStatus(status: string): CertificationStatus {
  if (status === 'VALID' || status === 'EXPIRING' || status === 'EXPIRED' || status === 'UNKNOWN') {
    return status;
  }

  throw new Error(`Statut certification invalide: ${status}`);
}

function computeCertificationStatus(validTo?: string) {
  if (!validTo) {
    return 'UNKNOWN' as const;
  }

  const expiresAt = Date.parse(validTo);
  if (Number.isNaN(expiresAt)) {
    return 'UNKNOWN' as const;
  }

  const now = Date.now();
  if (expiresAt < now) {
    return 'EXPIRED' as const;
  }

  const daysLeft = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
  if (daysLeft <= 30) {
    return 'EXPIRING' as const;
  }

  return 'VALID' as const;
}

function requireOrgId() {
  if (!contextOrgId) {
    throw new Error('org_id est requis pour company-hub.');
  }

  return contextOrgId;
}

function requireUserId() {
  if (!contextUserId) {
    throw new Error('user_id est requis pour company-hub.');
  }

  return contextUserId;
}

function assertCanWrite() {
  if (!WRITER_ROLES.has(contextRole)) {
    throw new Error('Accès refusé: rôle admin ou manager requis.');
  }
}

function sectionTag(sectionKey: CompanySectionKey) {
  return `company_section:${sectionKey.toLowerCase()}`;
}

function normalizeTags(tags: string[] | undefined, sectionKey: CompanySectionKey) {
  const result = new Set<string>();

  result.add('company_hub');
  result.add(sectionTag(sectionKey));

  for (const tag of tags ?? []) {
    const cleaned = normalizeText(tag).toLowerCase();
    if (cleaned) {
      result.add(cleaned);
    }
  }

  return Array.from(result);
}

function mapSectionRow(row: SectionRow): CompanySection {
  return {
    id: row.id,
    org_id: row.org_id,
    key: row.key,
    label: row.label,
    sort_order: row.sort_order,
    created_at: row.created_at
  };
}

function mapCertificationRow(row: CertificationRow): Certification {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    issuer: row.issuer ?? undefined,
    valid_from: row.valid_from ?? undefined,
    valid_to: row.valid_to ?? undefined,
    doc_id: row.doc_id ?? undefined,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by
  };
}

function mapCheckRow(row: CheckRow): CompanyCheck {
  return {
    id: row.id,
    org_id: row.org_id,
    key: row.key,
    label: row.label,
    checked: row.checked === 1,
    comment: row.comment ?? undefined,
    updated_at: row.updated_at,
    updated_by: row.updated_by ?? undefined
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

    CREATE TABLE IF NOT EXISTS ${SECTIONS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(org_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_company_sections_org_sort
      ON ${SECTIONS_TABLE}(org_id, sort_order ASC);

    CREATE TABLE IF NOT EXISTS ${CERTIFICATIONS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      issuer TEXT,
      valid_from TEXT,
      valid_to TEXT,
      doc_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('VALID', 'EXPIRING', 'EXPIRED', 'UNKNOWN')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_certifications_org_valid_to
      ON ${CERTIFICATIONS_TABLE}(org_id, valid_to ASC);

    CREATE INDEX IF NOT EXISTS idx_certifications_org_status
      ON ${CERTIFICATIONS_TABLE}(org_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${CHECKS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      UNIQUE(org_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_company_checks_org
      ON ${CHECKS_TABLE}(org_id, key ASC);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }

  return setupPromise;
}

async function ensureDefaultSections(orgId: string) {
  await ensureSetup();
  const db = await getDb();

  for (const template of SECTION_TEMPLATES) {
    await db.runAsync(
      `
        INSERT OR IGNORE INTO ${SECTIONS_TABLE}
        (id, org_id, key, label, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      createUuid(),
      orgId,
      template.key,
      template.label,
      template.sort_order,
      nowIso()
    );
  }
}

async function ensureDefaultChecks(orgId: string) {
  await ensureSetup();
  const db = await getDb();

  for (const template of CHECK_TEMPLATES) {
    await db.runAsync(
      `
        INSERT OR IGNORE INTO ${CHECKS_TABLE}
        (id, org_id, key, label, checked, comment, updated_at, updated_by)
        VALUES (?, ?, ?, ?, 0, NULL, ?, NULL)
      `,
      createUuid(),
      orgId,
      template.key,
      template.label,
      nowIso()
    );
  }
}

async function ensureDefaults(orgId: string) {
  await Promise.all([ensureDefaultSections(orgId), ensureDefaultChecks(orgId)]);
}

async function getCertificationById(id: string) {
  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<CertificationRow>(
    `
      SELECT *
      FROM ${CERTIFICATIONS_TABLE}
      WHERE id = ?
      LIMIT 1
    `,
    id
  );

  return row ? mapCertificationRow(row) : null;
}

async function enqueueCertificationOperation(
  certification: Certification,
  type: 'CREATE' | 'UPDATE'
) {
  await offlineDB.enqueueOperation({
    entity: 'certifications',
    entity_id: certification.id,
    type,
    payload: {
      ...certification,
      orgId: certification.org_id,
      org_id: certification.org_id
    }
  });
}

async function enqueueCheckOperation(check: CompanyCheck) {
  await offlineDB.enqueueOperation({
    entity: 'company_checks',
    entity_id: check.id,
    type: 'UPDATE',
    payload: {
      ...check,
      orgId: check.org_id,
      org_id: check.org_id
    }
  });
}

function resolveDocumentType(sectionKey: CompanySectionKey, requested?: string): DocumentType {
  if (requested === 'INTERNAL') {
    return 'INTERNAL';
  }

  if (requested === 'REPORT') {
    return 'REPORT';
  }

  if (requested === 'CERT') {
    return 'OTHER';
  }

  return getSectionTemplate(sectionKey).defaultDocType;
}

async function listChecksByOrg(orgId: string) {
  await ensureDefaultChecks(orgId);

  const db = await getDb();
  const rows = await db.getAllAsync<CheckRow>(
    `
      SELECT *
      FROM ${CHECKS_TABLE}
      WHERE org_id = ?
      ORDER BY key ASC
    `,
    orgId
  );

  return rows.map(mapCheckRow);
}

export const companyHub: CompanyHubApi = {
  setContext(context: Partial<CompanyHubContext>) {
    contextOrgId = optionalString(context.org_id) ?? null;
    contextUserId = optionalString(context.user_id) ?? null;
    contextRole = context.role ?? 'FIELD';
  },

  setOrg(orgId: string | null) {
    contextOrgId = optionalString(orgId) ?? null;
  },

  setActor(userId: string | null) {
    contextUserId = optionalString(userId) ?? null;
  },

  setRole(role: AppRole | null) {
    contextRole = role ?? 'FIELD';
  },

  async listSections() {
    const orgId = requireOrgId();
    await ensureDefaultSections(orgId);

    const db = await getDb();
    const rows = await db.getAllAsync<SectionRow>(
      `
        SELECT *
        FROM ${SECTIONS_TABLE}
        WHERE org_id = ?
        ORDER BY sort_order ASC, label ASC
      `,
      orgId
    );

    return rows.map(mapSectionRow);
  },

  async listDocuments(sectionKey: CompanySectionKey): Promise<Document[]> {
    const orgId = requireOrgId();
    const safeSection = ensureSectionKey(sectionKey);

    const allDocuments = await documents.list('COMPANY', undefined, {
      org_id: orgId,
      limit: 500,
      offset: 0
    });

    const expectedTag = sectionTag(safeSection);

    return allDocuments.filter((document) =>
      document.tags.some((tag) => normalizeText(tag).toLowerCase() === expectedTag)
    );
  },

  async addDocument(sectionKey: CompanySectionKey, documentMeta: HubDocumentMeta, fileContext: AddVersionContext = {}) {
    assertCanWrite();

    const orgId = requireOrgId();
    const userId = requireUserId();
    const safeSection = ensureSectionKey(sectionKey);

    const title = normalizeText(documentMeta.title);
    if (title.length < 2) {
      throw new Error('Le titre du document doit contenir au moins 2 caractères.');
    }

    documents.setActor(userId);

    const tags = normalizeTags(documentMeta.tags, safeSection);
    if (documentMeta.doc_type === 'CERT') {
      tags.push('company_cert');
    }

    const created = await documents.create({
      org_id: orgId,
      scope: 'COMPANY',
      title,
      doc_type: resolveDocumentType(safeSection, documentMeta.doc_type),
      status: documentMeta.status ?? 'DRAFT',
      tags,
      description: optionalString(documentMeta.description),
      created_by: userId
    });

    await documents.addVersion(created.id, fileContext);

    const refreshed = await documents.getById(created.id);
    if (!refreshed) {
      throw new Error('Document introuvable après création.');
    }

    return refreshed;
  },

  certs: {
    async create(meta: CertificationCreateInput) {
      assertCanWrite();

      const orgId = requireOrgId();
      const userId = requireUserId();

      const name = normalizeText(meta.name);
      if (name.length < 2) {
        throw new Error('Le nom de certification doit contenir au moins 2 caractères.');
      }

      const validFrom = parseDateIsoOrThrow(meta.valid_from, 'valid_from');
      const validTo = parseDateIsoOrThrow(meta.valid_to, 'valid_to');
      const status = meta.status ? ensureCertificationStatus(meta.status) : computeCertificationStatus(validTo);
      const docId = optionalString(meta.doc_id);

      if (docId) {
        const linked = await documents.getById(docId);
        if (!linked || linked.org_id !== orgId) {
          throw new Error('doc_id invalide ou hors organisation.');
        }
      }

      const now = nowIso();

      const certification: Certification = {
        id: optionalString(meta.id) ?? createUuid(),
        org_id: orgId,
        name,
        issuer: optionalString(meta.issuer),
        valid_from: validFrom,
        valid_to: validTo,
        doc_id: docId,
        status,
        created_at: now,
        updated_at: now,
        created_by: userId
      };

      await ensureSetup();
      const db = await getDb();

      await db.runAsync(
        `
          INSERT INTO ${CERTIFICATIONS_TABLE}
          (id, org_id, name, issuer, valid_from, valid_to, doc_id, status, created_at, updated_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        certification.id,
        certification.org_id,
        certification.name,
        certification.issuer ?? null,
        certification.valid_from ?? null,
        certification.valid_to ?? null,
        certification.doc_id ?? null,
        certification.status,
        certification.created_at,
        certification.updated_at,
        certification.created_by
      );

      await enqueueCertificationOperation(certification, 'CREATE');
      return certification;
    },

    async update(id: string, patch: CertificationUpdatePatch) {
      assertCanWrite();

      const orgId = requireOrgId();
      const userId = requireUserId();

      const current = await getCertificationById(id);
      if (!current || current.org_id !== orgId) {
        throw new Error('Certification introuvable.');
      }

      const nextValidFrom =
        patch.valid_from !== undefined ? parseDateIsoOrThrow(patch.valid_from, 'valid_from') : current.valid_from;
      const nextValidTo = patch.valid_to !== undefined ? parseDateIsoOrThrow(patch.valid_to, 'valid_to') : current.valid_to;

      const nextDocId = patch.doc_id !== undefined ? optionalString(patch.doc_id) : current.doc_id;
      if (nextDocId) {
        const linked = await documents.getById(nextDocId);
        if (!linked || linked.org_id !== orgId) {
          throw new Error('doc_id invalide ou hors organisation.');
        }
      }

      const updated: Certification = {
        ...current,
        name: patch.name !== undefined ? normalizeText(patch.name) : current.name,
        issuer: patch.issuer !== undefined ? optionalString(patch.issuer) : current.issuer,
        valid_from: nextValidFrom,
        valid_to: nextValidTo,
        doc_id: nextDocId,
        status: patch.status ? ensureCertificationStatus(patch.status) : computeCertificationStatus(nextValidTo),
        updated_at: nowIso(),
        created_by: current.created_by || userId
      };

      if (updated.name.length < 2) {
        throw new Error('Le nom de certification doit contenir au moins 2 caractères.');
      }

      await ensureSetup();
      const db = await getDb();

      await db.runAsync(
        `
          UPDATE ${CERTIFICATIONS_TABLE}
          SET name = ?,
              issuer = ?,
              valid_from = ?,
              valid_to = ?,
              doc_id = ?,
              status = ?,
              updated_at = ?
          WHERE id = ?
        `,
        updated.name,
        updated.issuer ?? null,
        updated.valid_from ?? null,
        updated.valid_to ?? null,
        updated.doc_id ?? null,
        updated.status,
        updated.updated_at,
        updated.id
      );

      await enqueueCertificationOperation(updated, 'UPDATE');
      return updated;
    },

    async list() {
      const orgId = requireOrgId();
      await ensureSetup();

      const db = await getDb();
      const rows = await db.getAllAsync<CertificationRow>(
        `
          SELECT *
          FROM ${CERTIFICATIONS_TABLE}
          WHERE org_id = ?
          ORDER BY
            CASE status
              WHEN 'EXPIRED' THEN 0
              WHEN 'EXPIRING' THEN 1
              WHEN 'VALID' THEN 2
              ELSE 3
            END,
            COALESCE(valid_to, created_at) ASC
        `,
        orgId
      );

      return rows.map(mapCertificationRow);
    },

    async getExpiring(days: number) {
      const orgId = requireOrgId();
      await ensureSetup();

      const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(Math.floor(days), 3650)) : 30;
      const horizon = new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();

      const db = await getDb();
      const rows = await db.getAllAsync<CertificationRow>(
        `
          SELECT *
          FROM ${CERTIFICATIONS_TABLE}
          WHERE org_id = ?
            AND valid_to IS NOT NULL
            AND valid_to <= ?
          ORDER BY valid_to ASC
        `,
        orgId,
        horizon
      );

      return rows.map(mapCertificationRow);
    }
  },

  checks: {
    async get() {
      const orgId = requireOrgId();
      return listChecksByOrg(orgId);
    },

    async toggle(key: string, checked: boolean) {
      assertCanWrite();

      const orgId = requireOrgId();
      const userId = requireUserId();
      await ensureDefaultChecks(orgId);

      const safeKey = normalizeText(key);
      if (!safeKey) {
        throw new Error('key est requis.');
      }

      await ensureSetup();
      const db = await getDb();
      const updatedAt = nowIso();

      await db.runAsync(
        `
          UPDATE ${CHECKS_TABLE}
          SET checked = ?, updated_at = ?, updated_by = ?
          WHERE org_id = ?
            AND key = ?
        `,
        checked ? 1 : 0,
        updatedAt,
        userId,
        orgId,
        safeKey
      );

      const row = await db.getFirstAsync<CheckRow>(
        `
          SELECT *
          FROM ${CHECKS_TABLE}
          WHERE org_id = ?
            AND key = ?
          LIMIT 1
        `,
        orgId,
        safeKey
      );

      if (!row) {
        throw new Error('Check introuvable.');
      }

      await enqueueCheckOperation(mapCheckRow(row));
    },

    async setComment(key: string, text: string) {
      assertCanWrite();

      const orgId = requireOrgId();
      const userId = requireUserId();
      await ensureDefaultChecks(orgId);

      const safeKey = normalizeText(key);
      if (!safeKey) {
        throw new Error('key est requis.');
      }

      await ensureSetup();
      const db = await getDb();
      const updatedAt = nowIso();

      await db.runAsync(
        `
          UPDATE ${CHECKS_TABLE}
          SET comment = ?, updated_at = ?, updated_by = ?
          WHERE org_id = ?
            AND key = ?
        `,
        optionalString(text) ?? null,
        updatedAt,
        userId,
        orgId,
        safeKey
      );

      const row = await db.getFirstAsync<CheckRow>(
        `
          SELECT *
          FROM ${CHECKS_TABLE}
          WHERE org_id = ?
            AND key = ?
          LIMIT 1
        `,
        orgId,
        safeKey
      );

      if (!row) {
        throw new Error('Check introuvable.');
      }

      await enqueueCheckOperation(mapCheckRow(row));
    }
  }
};

export const hub = {
  listSections: companyHub.listSections,
  listDocuments: companyHub.listDocuments,
  addDocument: companyHub.addDocument
};

export const certs = companyHub.certs;
export const checks = companyHub.checks;

export async function bootstrapCompanyHub() {
  const orgId = requireOrgId();
  await ensureDefaults(orgId);
}
