import * as SQLite from 'expo-sqlite';
import * as Network from 'expo-network';
import { audit } from '../audit-compliance';
import { requireSupabaseClient } from '../../core/supabase/client';
import { offlineDB } from '../offline/outbox';
import type {
  BillingClient,
  BillingClientCreateInput,
  BillingClientUpdatePatch,
  BillingInvoice,
  BillingInvoiceCreateInput,
  BillingInvoiceListItem,
  BillingInvoiceStatus,
  BillingInvoiceUpdatePatch,
  BillingLineItem,
  BillingLineItemDraft,
  BillingLineItemParentType,
  BillingListOptions,
  BillingNumberKind,
  BillingNumberReservation,
  BillingPayment,
  BillingPaymentCreateInput,
  BillingPaymentMethod,
  BillingQuote,
  BillingQuoteCreateInput,
  BillingQuoteListItem,
  BillingQuotesListOptions,
  BillingQuoteStatus,
  BillingQuoteUpdatePatch,
  BillingInvoicesListOptions,
  BillingSummary,
  BillingCurrency
} from './types';

const DB_NAME = 'conformeo.db';

const CLIENTS_TABLE = 'billing_clients';
const QUOTES_TABLE = 'billing_quotes';
const INVOICES_TABLE = 'billing_invoices';
const LINE_ITEMS_TABLE = 'billing_line_items';
const PAYMENTS_TABLE = 'billing_payments';
const NUMBERING_TABLE = 'billing_numbering_state';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 200;

type ClientRow = {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_country: string | null;
  vat_number: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type QuoteRow = {
  id: string;
  org_id: string;
  client_id: string;
  number: string;
  status: BillingQuoteStatus;
  issue_date: string;
  valid_until: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type InvoiceRow = {
  id: string;
  org_id: string;
  client_id: string;
  quote_id: string | null;
  number: string;
  status: BillingInvoiceStatus;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  paid_total: number;
  currency: BillingCurrency;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type LineItemRow = {
  id: string;
  org_id: string;
  parent_type: BillingLineItemParentType;
  parent_id: string;
  label: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  line_total: number;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type PaymentRow = {
  id: string;
  org_id: string;
  invoice_id: string;
  amount: number;
  method: BillingPaymentMethod;
  paid_at: string;
  reference: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type NumberingRow = {
  org_id: string;
  kind: BillingNumberKind;
  prefix: string;
  next_number: number;
  end_number: number;
  updated_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function toOptional(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function roundMoney(amount: number) {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
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

function requireOrgId(explicit?: string | null) {
  const orgId = normalizeText(explicit) || normalizeText(contextOrgId);
  if (!orgId) {
    throw new Error("Contexte facturation manquant: org_id.");
  }
  return orgId;
}

function requireUserId(explicit?: string | null) {
  const userId = normalizeText(explicit) || normalizeText(contextUserId);
  if (!userId) {
    throw new Error("Contexte facturation manquant: user_id.");
  }
  return userId;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function ensureQuoteStatus(value: string): BillingQuoteStatus {
  if (value === 'draft' || value === 'sent' || value === 'accepted' || value === 'rejected' || value === 'expired') {
    return value;
  }
  throw new Error(`Statut devis invalide: ${value}`);
}

function ensureInvoiceStatus(value: string): BillingInvoiceStatus {
  if (
    value === 'draft' ||
    value === 'issued' ||
    value === 'sent' ||
    value === 'paid' ||
    value === 'overdue' ||
    value === 'cancelled'
  ) {
    return value;
  }
  throw new Error(`Statut facture invalide: ${value}`);
}

function ensureMethod(value: string): BillingPaymentMethod {
  if (value === 'transfer' || value === 'card' || value === 'cash' || value === 'check' || value === 'other') {
    return value;
  }
  throw new Error(`Moyen de paiement invalide: ${value}`);
}

function ensureParentType(value: string): BillingLineItemParentType {
  if (value === 'quote' || value === 'invoice') {
    return value;
  }
  throw new Error(`Type parent line item invalide: ${value}`);
}

function ensurePositiveNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} doit être > 0.`);
  }
  return value;
}

function ensureNonNegativeNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} doit être >= 0.`);
  }
  return value;
}

function isTempNumber(value: string) {
  const cleaned = normalizeText(value).toUpperCase();
  return cleaned.startsWith('TEMP-') || cleaned.startsWith('TMP-');
}

function tempNumber(id: string) {
  const token = normalizeText(id) || createUuid();
  return `TEMP-${token}`;
}

function formatNumber(prefix: string, n: number) {
  const p = normalizeText(prefix);
  const year = String(new Date().getFullYear());
  const withYear = /-\d{4}$/.test(p) ? p : `${p}-${year}`;
  const padded = String(n).padStart(6, '0');
  return `${withYear}${withYear.endsWith('-') ? '' : '-'}${padded}`.replace(/--+/g, '-');
}

function computeLineTotals(items: Array<Pick<BillingLineItemDraft, 'quantity' | 'unit_price' | 'tax_rate'>>) {
  let subtotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    const qty = ensurePositiveNumber(item.quantity, 'Quantité');
    const unit = ensureNonNegativeNumber(item.unit_price, 'Prix unitaire');
    const rate = ensureNonNegativeNumber(item.tax_rate, 'TVA');

    const lineSubtotal = roundMoney(qty * unit);
    const lineTax = roundMoney((lineSubtotal * rate) / 100);
    subtotal = roundMoney(subtotal + lineSubtotal);
    taxTotal = roundMoney(taxTotal + lineTax);
  }

  const total = roundMoney(subtotal + taxTotal);
  return { subtotal, tax_total: taxTotal, total };
}

function lineTotal(item: BillingLineItemDraft) {
  const qty = ensurePositiveNumber(item.quantity, 'Quantité');
  const unit = ensureNonNegativeNumber(item.unit_price, 'Prix unitaire');
  const rate = ensureNonNegativeNumber(item.tax_rate, 'TVA');
  const base = roundMoney(qty * unit);
  const tax = roundMoney((base * rate) / 100);
  return roundMoney(base + tax);
}

function mapClientRow(row: ClientRow): BillingClient {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    email: toOptional(row.email),
    phone: toOptional(row.phone),
    address_line1: toOptional(row.address_line1),
    address_line2: toOptional(row.address_line2),
    address_zip: toOptional(row.address_zip),
    address_city: toOptional(row.address_city),
    address_country: toOptional(row.address_country),
    vat_number: toOptional(row.vat_number),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
  };
}

function mapQuoteRow(row: QuoteRow): BillingQuote {
  return {
    id: row.id,
    org_id: row.org_id,
    client_id: row.client_id,
    number: row.number,
    status: row.status,
    issue_date: row.issue_date,
    valid_until: toOptional(row.valid_until),
    subtotal: row.subtotal,
    tax_total: row.tax_total,
    total: row.total,
    notes: toOptional(row.notes),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
  };
}

function mapInvoiceRow(row: InvoiceRow): BillingInvoice {
  return {
    id: row.id,
    org_id: row.org_id,
    client_id: row.client_id,
    quote_id: toOptional(row.quote_id),
    number: row.number,
    status: row.status,
    issue_date: row.issue_date,
    due_date: toOptional(row.due_date),
    subtotal: row.subtotal,
    tax_total: row.tax_total,
    total: row.total,
    paid_total: row.paid_total,
    currency: row.currency,
    notes: toOptional(row.notes),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
  };
}

function mapLineItemRow(row: LineItemRow): BillingLineItem {
  return {
    id: row.id,
    org_id: row.org_id,
    parent_type: row.parent_type,
    parent_id: row.parent_id,
    label: row.label,
    quantity: row.quantity,
    unit_price: row.unit_price,
    tax_rate: row.tax_rate,
    line_total: row.line_total,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: toOptional(row.deleted_at)
  };
}

function mapPaymentRow(row: PaymentRow): BillingPayment {
  return {
    id: row.id,
    org_id: row.org_id,
    invoice_id: row.invoice_id,
    amount: row.amount,
    method: row.method,
    paid_at: row.paid_at,
    reference: toOptional(row.reference),
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

async function setupSchema() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS ${CLIENTS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      address_zip TEXT,
      address_city TEXT,
      address_country TEXT,
      vat_number TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_billing_clients_org_updated
      ON ${CLIENTS_TABLE}(org_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_clients_deleted
      ON ${CLIENTS_TABLE}(deleted_at);

    CREATE TABLE IF NOT EXISTS ${QUOTES_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      number TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','sent','accepted','rejected','expired')),
      issue_date TEXT NOT NULL,
      valid_until TEXT,
      subtotal REAL NOT NULL,
      tax_total REAL NOT NULL,
      total REAL NOT NULL,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_billing_quotes_org_updated
      ON ${QUOTES_TABLE}(org_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_quotes_org_status_updated
      ON ${QUOTES_TABLE}(org_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_quotes_client_updated
      ON ${QUOTES_TABLE}(org_id, client_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_quotes_deleted
      ON ${QUOTES_TABLE}(deleted_at);

    CREATE TABLE IF NOT EXISTS ${INVOICES_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      quote_id TEXT,
      number TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','issued','sent','paid','overdue','cancelled')),
      issue_date TEXT NOT NULL,
      due_date TEXT,
      subtotal REAL NOT NULL,
      tax_total REAL NOT NULL,
      total REAL NOT NULL,
      paid_total REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR')),
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_billing_invoices_org_updated
      ON ${INVOICES_TABLE}(org_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_invoices_org_status_updated
      ON ${INVOICES_TABLE}(org_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_invoices_client_updated
      ON ${INVOICES_TABLE}(org_id, client_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_invoices_deleted
      ON ${INVOICES_TABLE}(deleted_at);

    CREATE TABLE IF NOT EXISTS ${LINE_ITEMS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      parent_type TEXT NOT NULL CHECK (parent_type IN ('quote','invoice')),
      parent_id TEXT NOT NULL,
      label TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      tax_rate REAL NOT NULL,
      line_total REAL NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_billing_line_items_parent_pos
      ON ${LINE_ITEMS_TABLE}(org_id, parent_type, parent_id, position);

    CREATE INDEX IF NOT EXISTS idx_billing_line_items_deleted
      ON ${LINE_ITEMS_TABLE}(deleted_at);

    CREATE TABLE IF NOT EXISTS ${PAYMENTS_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('transfer','card','cash','check','other')),
      paid_at TEXT NOT NULL,
      reference TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_billing_payments_invoice_paid
      ON ${PAYMENTS_TABLE}(org_id, invoice_id, paid_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_payments_deleted
      ON ${PAYMENTS_TABLE}(deleted_at);

    CREATE TABLE IF NOT EXISTS ${NUMBERING_TABLE} (
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('quote','invoice')),
      prefix TEXT NOT NULL,
      next_number INTEGER NOT NULL,
      end_number INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (org_id, kind)
    );
  `);

  await migrateInvoicesAddIssued(db);
}

async function migrateInvoicesAddIssued(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    INVOICES_TABLE
  );

  const createSql = (row?.sql ?? '').toLowerCase();
  if (!createSql) {
    return;
  }

  // Fresh installs already include the new constraint.
  if (createSql.includes('issued')) {
    return;
  }

  // Legacy installs: rebuild invoices table to widen the CHECK constraint.
  // SQLite can't ALTER CHECK constraints in place.
  await db.execAsync(`
    PRAGMA foreign_keys = OFF;
    BEGIN TRANSACTION;

    ALTER TABLE ${INVOICES_TABLE} RENAME TO ${INVOICES_TABLE}_old;

    CREATE TABLE ${INVOICES_TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      quote_id TEXT,
      number TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','issued','sent','paid','overdue','cancelled')),
      issue_date TEXT NOT NULL,
      due_date TEXT,
      subtotal REAL NOT NULL,
      tax_total REAL NOT NULL,
      total REAL NOT NULL,
      paid_total REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR')),
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    INSERT INTO ${INVOICES_TABLE}
      (id, org_id, client_id, quote_id, number, status, issue_date, due_date, subtotal, tax_total, total, paid_total, currency, notes, created_by, created_at, updated_at, deleted_at)
    SELECT
      id, org_id, client_id, quote_id, number, status, issue_date, due_date, subtotal, tax_total, total, paid_total, currency, notes, created_by, created_at, updated_at, deleted_at
    FROM ${INVOICES_TABLE}_old;

    DROP TABLE ${INVOICES_TABLE}_old;

    CREATE INDEX IF NOT EXISTS idx_billing_invoices_org_updated
      ON ${INVOICES_TABLE}(org_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_invoices_org_status_updated
      ON ${INVOICES_TABLE}(org_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_invoices_client_updated
      ON ${INVOICES_TABLE}(org_id, client_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_billing_invoices_deleted
      ON ${INVOICES_TABLE}(deleted_at);

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }
  return setupPromise;
}

function resolvePaging(limit?: number, offset?: number) {
  const safeLimit = clamp(Math.floor(limit ?? DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE);
  const safeOffset = Math.max(0, Math.floor(offset ?? 0));
  return { limit: safeLimit, offset: safeOffset };
}

async function enqueueEntityOperation(input: {
  entity: string;
  entity_id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  orgId: string;
  updatedAt: string;
  payload: Record<string, unknown>;
}) {
  await offlineDB.enqueueOperation({
    entity: input.entity,
    entity_id: input.entity_id,
    type: input.type,
    payload: {
      ...input.payload,
      id: input.entity_id,
      org_id: input.orgId,
      orgId: input.orgId,
      updated_at: input.updatedAt
    }
  });
}

async function getClientRow(id: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<ClientRow>(
    `
      SELECT *
      FROM ${CLIENTS_TABLE}
      WHERE id = ?
        AND (? = 1 OR deleted_at IS NULL)
      LIMIT 1
    `,
    id,
    includeDeleted ? 1 : 0
  );
  return row ?? null;
}

async function getQuoteRow(id: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<QuoteRow>(
    `
      SELECT *
      FROM ${QUOTES_TABLE}
      WHERE id = ?
        AND (? = 1 OR deleted_at IS NULL)
      LIMIT 1
    `,
    id,
    includeDeleted ? 1 : 0
  );
  return row ?? null;
}

async function getInvoiceRow(id: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<InvoiceRow>(
    `
      SELECT *
      FROM ${INVOICES_TABLE}
      WHERE id = ?
        AND (? = 1 OR deleted_at IS NULL)
      LIMIT 1
    `,
    id,
    includeDeleted ? 1 : 0
  );
  return row ?? null;
}

async function listLineItemRows(parentType: BillingLineItemParentType, parentId: string, includeDeleted = false) {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<LineItemRow>(
    `
      SELECT *
      FROM ${LINE_ITEMS_TABLE}
      WHERE parent_type = ?
        AND parent_id = ?
        AND (? = 1 OR deleted_at IS NULL)
      ORDER BY position ASC, created_at ASC
    `,
    parentType,
    parentId,
    includeDeleted ? 1 : 0
  );

  return rows;
}

async function recomputeQuoteTotals(quoteId: string) {
  const quoteRow = await getQuoteRow(quoteId, true);
  if (!quoteRow) {
    throw new Error('Devis introuvable.');
  }

  const orgId = quoteRow.org_id;
  const rows = await listLineItemRows('quote', quoteId, false);
  const totals = computeLineTotals(rows);

  const next: BillingQuote = {
    ...mapQuoteRow(quoteRow),
    subtotal: totals.subtotal,
    tax_total: totals.tax_total,
    total: totals.total,
    updated_at: nowIso()
  };

  const db = await getDb();
  await db.runAsync(
    `
      UPDATE ${QUOTES_TABLE}
      SET subtotal = ?, tax_total = ?, total = ?, updated_at = ?
      WHERE id = ?
    `,
    next.subtotal,
    next.tax_total,
    next.total,
    next.updated_at,
    quoteId
  );

  await enqueueEntityOperation({
    entity: 'billing_quotes',
    entity_id: next.id,
    type: 'UPDATE',
    orgId,
    updatedAt: next.updated_at,
    payload: { data: next, patch: { subtotal: next.subtotal, tax_total: next.tax_total, total: next.total } }
  });

  return next;
}

async function recomputeInvoiceTotals(invoiceId: string) {
  const invoiceRow = await getInvoiceRow(invoiceId, true);
  if (!invoiceRow) {
    throw new Error('Facture introuvable.');
  }

  const orgId = invoiceRow.org_id;
  const rows = await listLineItemRows('invoice', invoiceId, false);
  const totals = computeLineTotals(rows);

  const next: BillingInvoice = {
    ...mapInvoiceRow(invoiceRow),
    subtotal: totals.subtotal,
    tax_total: totals.tax_total,
    total: totals.total,
    updated_at: nowIso()
  };

  const db = await getDb();
  await db.runAsync(
    `
      UPDATE ${INVOICES_TABLE}
      SET subtotal = ?, tax_total = ?, total = ?, updated_at = ?
      WHERE id = ?
    `,
    next.subtotal,
    next.tax_total,
    next.total,
    next.updated_at,
    invoiceId
  );

  await enqueueEntityOperation({
    entity: 'billing_invoices',
    entity_id: next.id,
    type: 'UPDATE',
    orgId,
    updatedAt: next.updated_at,
    payload: { data: next, patch: { subtotal: next.subtotal, tax_total: next.tax_total, total: next.total } }
  });

  return next;
}

async function recomputeInvoicePayments(invoiceId: string) {
  const invoiceRow = await getInvoiceRow(invoiceId, true);
  if (!invoiceRow) {
    throw new Error('Facture introuvable.');
  }

  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<{ paid_total: number }>(
    `
      SELECT COALESCE(SUM(amount), 0) AS paid_total
      FROM ${PAYMENTS_TABLE}
      WHERE invoice_id = ?
        AND deleted_at IS NULL
    `,
    invoiceId
  );

  const paidTotal = roundMoney(row?.paid_total ?? 0);
  const base = mapInvoiceRow(invoiceRow);

  let nextStatus = base.status;
  if (base.status !== 'cancelled') {
    if (paidTotal >= base.total && base.total > 0) {
      nextStatus = 'paid';
    } else if ((base.status === 'sent' || base.status === 'issued') && base.due_date) {
      const dueTs = Date.parse(`${base.due_date}T00:00:00.000Z`);
      if (Number.isFinite(dueTs) && dueTs < Date.now()) {
        nextStatus = 'overdue';
      }
    }
  }

  const next: BillingInvoice = {
    ...base,
    paid_total: paidTotal,
    status: nextStatus,
    updated_at: nowIso()
  };

  await db.runAsync(
    `
      UPDATE ${INVOICES_TABLE}
      SET paid_total = ?, status = ?, updated_at = ?
      WHERE id = ?
    `,
    next.paid_total,
    next.status,
    next.updated_at,
    invoiceId
  );

  await enqueueEntityOperation({
    entity: 'billing_invoices',
    entity_id: next.id,
    type: 'UPDATE',
    orgId: next.org_id,
    updatedAt: next.updated_at,
    payload: { data: next, patch: { paid_total: next.paid_total, status: next.status } }
  });

  return next;
}

async function getNumberingRow(orgId: string, kind: BillingNumberKind) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<NumberingRow>(
    `
      SELECT org_id, kind, prefix, next_number, end_number, updated_at
      FROM ${NUMBERING_TABLE}
      WHERE org_id = ?
        AND kind = ?
      LIMIT 1
    `,
    orgId,
    kind
  );
  return row ?? null;
}

async function upsertNumberingRow(row: NumberingRow) {
  await ensureSetup();
  const db = await getDb();
  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${NUMBERING_TABLE}
      (org_id, kind, prefix, next_number, end_number, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    row.org_id,
    row.kind,
    row.prefix,
    row.next_number,
    row.end_number,
    row.updated_at
  );
}

async function isOnline() {
  const state = await Network.getNetworkStateAsync();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

async function reserveNumbersRemote(orgId: string, kind: BillingNumberKind, count = 50): Promise<BillingNumberReservation> {
  const client = requireSupabaseClient();
  const { data, error } = await client.rpc('reserve_billing_numbers', {
    p_org_id: orgId,
    p_kind: kind,
    p_count: count
  });

  if (error) {
    throw new Error(error.message);
  }

  const record = (data ?? {}) as Record<string, unknown>;

  const prefix = typeof record.prefix === 'string' ? record.prefix : kind === 'quote' ? 'DEV' : 'FAC';
  const startNumber = typeof record.start_number === 'number' ? record.start_number : Number(record.start_number);
  const endNumber = typeof record.end_number === 'number' ? record.end_number : Number(record.end_number);
  if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) {
    throw new Error('Réservation numéros invalide (start/end).');
  }

  return {
    org_id: orgId,
    kind,
    prefix,
    start_number: startNumber,
    end_number: endNumber,
    reserved_at: nowIso()
  };
}

async function ensureNumberRange(kind: BillingNumberKind, minRemaining = 5, reserveCount = 80) {
  const orgId = requireOrgId();

  const current = await getNumberingRow(orgId, kind);
  if (current) {
    const remaining = Math.max(0, current.end_number - current.next_number + 1);
    if (remaining >= minRemaining) {
      return current;
    }
  }

  if (!(await isOnline())) {
    return current;
  }

  try {
    const reservation = await reserveNumbersRemote(orgId, kind, reserveCount);
    const row: NumberingRow = {
      org_id: orgId,
      kind,
      prefix: reservation.prefix,
      next_number: reservation.start_number,
      end_number: reservation.end_number,
      updated_at: nowIso()
    };
    await upsertNumberingRow(row);
    return row;
  } catch {
    return current;
  }
}

async function allocateNumber(kind: BillingNumberKind) {
  const orgId = requireOrgId();
  const row = await ensureNumberRange(kind);

  if (row && row.next_number <= row.end_number) {
    const allocated = row.next_number;
    const nextRow: NumberingRow = {
      ...row,
      next_number: row.next_number + 1,
      updated_at: nowIso()
    };
    await upsertNumberingRow(nextRow);
    return formatNumber(nextRow.prefix, allocated);
  }

  // Fallback: always allow offline draft creation, but temp numbers should not be used for "sent".
  return `TEMP-${createUuid()}`;
}

export const billing = {
  setContext(context: Partial<{ org_id: string; user_id: string }>) {
    if (context.org_id !== undefined) {
      contextOrgId = toOptional(context.org_id) ?? null;
    }
    if (context.user_id !== undefined) {
      contextUserId = toOptional(context.user_id) ?? null;
    }
  },

  setOrg(orgId: string | null) {
    contextOrgId = toOptional(orgId ?? undefined) ?? null;
  },

  setActor(userId: string | null) {
    contextUserId = toOptional(userId ?? undefined) ?? null;
  },

  async warmNumbering() {
    await Promise.all([ensureNumberRange('quote').catch(() => null), ensureNumberRange('invoice').catch(() => null)]);
  },

  async getSummary(): Promise<BillingSummary> {
    const orgId = requireOrgId();
    await ensureSetup();
    const db = await getDb();

    const [clientsRow, quotesDraftRow, invoicesOpenRow, invoicesOverdueRow, totalDueRow] = await Promise.all([
      db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${CLIENTS_TABLE} WHERE org_id = ? AND deleted_at IS NULL`,
        orgId
      ),
      db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${QUOTES_TABLE} WHERE org_id = ? AND deleted_at IS NULL AND status = 'draft'`,
        orgId
      ),
      db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${INVOICES_TABLE} WHERE org_id = ? AND deleted_at IS NULL AND status IN ('draft','issued','sent','overdue')`,
        orgId
      ),
      db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${INVOICES_TABLE} WHERE org_id = ? AND deleted_at IS NULL AND status = 'overdue'`,
        orgId
      ),
      db.getFirstAsync<{ total_due: number }>(
        `
          SELECT COALESCE(SUM(total - paid_total), 0) AS total_due
          FROM ${INVOICES_TABLE}
          WHERE org_id = ?
            AND deleted_at IS NULL
            AND status IN ('issued','sent','overdue')
        `,
        orgId
      )
    ]);

    return {
      clients: clientsRow?.count ?? 0,
      quotesDraft: quotesDraftRow?.count ?? 0,
      invoicesOpen: invoicesOpenRow?.count ?? 0,
      invoicesOverdue: invoicesOverdueRow?.count ?? 0,
      totalDue: roundMoney(totalDueRow?.total_due ?? 0)
    };
  },

  clients: {
    async list(options: BillingListOptions): Promise<BillingClient[]> {
      const orgId = requireOrgId(options.org_id);
      await ensureSetup();
      const db = await getDb();

      const { limit, offset } = resolvePaging(options.limit, options.offset);
      const includeDeleted = Boolean(options.includeDeleted);
      const q = normalizeText(options.q).toLowerCase();

      const params: Array<string | number> = [orgId, includeDeleted ? 1 : 0];
      let where = `org_id = ? AND (? = 1 OR deleted_at IS NULL)`;

      if (q) {
        where += ` AND (LOWER(name) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ?)`;
        params.push(`%${q}%`, `%${q}%`);
      }

      const rows = await db.getAllAsync<ClientRow>(
        `
          SELECT *
          FROM ${CLIENTS_TABLE}
          WHERE ${where}
          ORDER BY updated_at DESC
          LIMIT ?
          OFFSET ?
        `,
        ...params,
        limit,
        offset
      );

      return rows.map(mapClientRow);
    },

    async getById(id: string): Promise<BillingClient | null> {
      const clean = normalizeText(id);
      if (!clean) throw new Error('clientId requis.');
      const row = await getClientRow(clean, false);
      return row ? mapClientRow(row) : null;
    },

    async create(input: BillingClientCreateInput): Promise<BillingClient> {
      const orgId = requireOrgId();
      const userId = requireUserId();
      await ensureSetup();
      const db = await getDb();

      const name = normalizeText(input.name);
      if (name.length < 2) {
        throw new Error('Le nom client doit contenir au moins 2 caractères.');
      }

      const now = nowIso();
      const client: BillingClient = {
        id: normalizeText(input.id) || createUuid(),
        org_id: orgId,
        name,
        email: toOptional(input.email),
        phone: toOptional(input.phone),
        address_line1: toOptional(input.address_line1),
        address_line2: toOptional(input.address_line2),
        address_zip: toOptional(input.address_zip),
        address_city: toOptional(input.address_city),
        address_country: toOptional(input.address_country),
        vat_number: toOptional(input.vat_number),
        created_by: userId,
        created_at: now,
        updated_at: now
      };

      await db.runAsync(
        `
          INSERT OR REPLACE INTO ${CLIENTS_TABLE}
          (
            id, org_id, name, email, phone,
            address_line1, address_line2, address_zip, address_city, address_country,
            vat_number,
            created_by, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `,
        client.id,
        client.org_id,
        client.name,
        client.email ?? null,
        client.phone ?? null,
        client.address_line1 ?? null,
        client.address_line2 ?? null,
        client.address_zip ?? null,
        client.address_city ?? null,
        client.address_country ?? null,
        client.vat_number ?? null,
        client.created_by,
        client.created_at,
        client.updated_at
      );

      await enqueueEntityOperation({
        entity: 'billing_clients',
        entity_id: client.id,
        type: 'CREATE',
        orgId,
        updatedAt: client.updated_at,
        payload: { data: client }
      });

      await audit.log('billing.client.create', 'BILLING_CLIENT', client.id, { name: client.name });
      return client;
    },

    async update(clientId: string, patch: BillingClientUpdatePatch): Promise<BillingClient> {
      const cleanId = normalizeText(clientId);
      if (!cleanId) throw new Error('clientId requis.');
      const existing = await getClientRow(cleanId, true);
      if (!existing) throw new Error('Client introuvable.');

      const current = mapClientRow(existing);

      const next: BillingClient = {
        ...current,
        name: patch.name !== undefined ? normalizeText(patch.name) : current.name,
        email: patch.email !== undefined ? toOptional(patch.email) : current.email,
        phone: patch.phone !== undefined ? toOptional(patch.phone) : current.phone,
        address_line1: patch.address_line1 !== undefined ? toOptional(patch.address_line1) : current.address_line1,
        address_line2: patch.address_line2 !== undefined ? toOptional(patch.address_line2) : current.address_line2,
        address_zip: patch.address_zip !== undefined ? toOptional(patch.address_zip) : current.address_zip,
        address_city: patch.address_city !== undefined ? toOptional(patch.address_city) : current.address_city,
        address_country: patch.address_country !== undefined ? toOptional(patch.address_country) : current.address_country,
        vat_number: patch.vat_number !== undefined ? toOptional(patch.vat_number) : current.vat_number,
        deleted_at: patch.deleted_at === null ? undefined : patch.deleted_at !== undefined ? toOptional(patch.deleted_at) : current.deleted_at,
        updated_at: nowIso()
      };

      if (next.name.length < 2) {
        throw new Error('Le nom client doit contenir au moins 2 caractères.');
      }

      await ensureSetup();
      const db = await getDb();
      await db.runAsync(
        `
          INSERT OR REPLACE INTO ${CLIENTS_TABLE}
          (
            id, org_id, name, email, phone,
            address_line1, address_line2, address_zip, address_city, address_country,
            vat_number,
            created_by, created_at, updated_at, deleted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        next.id,
        next.org_id,
        next.name,
        next.email ?? null,
        next.phone ?? null,
        next.address_line1 ?? null,
        next.address_line2 ?? null,
        next.address_zip ?? null,
        next.address_city ?? null,
        next.address_country ?? null,
        next.vat_number ?? null,
        next.created_by,
        next.created_at,
        next.updated_at,
        next.deleted_at ?? null
      );

      await enqueueEntityOperation({
        entity: 'billing_clients',
        entity_id: next.id,
        type: 'UPDATE',
        orgId: next.org_id,
        updatedAt: next.updated_at,
        payload: { data: next, patch }
      });

      await audit.log('billing.client.update', 'BILLING_CLIENT', next.id, { patch });
      return next;
    },

    async softDelete(clientId: string): Promise<void> {
      const existing = await this.update(clientId, { deleted_at: nowIso() });
      await enqueueEntityOperation({
        entity: 'billing_clients',
        entity_id: existing.id,
        type: 'DELETE',
        orgId: existing.org_id,
        updatedAt: existing.updated_at,
        payload: { id: existing.id, deleted_at: existing.deleted_at ?? nowIso() }
      });

      await audit.log('billing.client.soft_delete', 'BILLING_CLIENT', existing.id, {});
    }
  },

  quotes: {
    async list(options: BillingQuotesListOptions): Promise<BillingQuoteListItem[]> {
      const orgId = requireOrgId(options.org_id);
      await ensureSetup();
      const db = await getDb();

      const { limit, offset } = resolvePaging(options.limit, options.offset);
      const includeDeleted = Boolean(options.includeDeleted);
      const q = normalizeText(options.q).toLowerCase();

      const status = options.status && options.status !== 'ALL' ? ensureQuoteStatus(options.status) : null;
      const clientId = toOptional(options.client_id);

      const params: Array<string | number> = [orgId, includeDeleted ? 1 : 0];
      const where: string[] = [`q.org_id = ?`, `(? = 1 OR q.deleted_at IS NULL)`];

      if (status) {
        where.push(`q.status = ?`);
        params.push(status);
      }

      if (clientId) {
        where.push(`q.client_id = ?`);
        params.push(clientId);
      }

      if (q) {
        where.push(`(LOWER(q.number) LIKE ? OR LOWER(COALESCE(q.notes,'')) LIKE ? OR LOWER(c.name) LIKE ?)`);
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }

      const rows = await db.getAllAsync<(QuoteRow & { client_name: string })>(
        `
          SELECT q.*, c.name AS client_name
          FROM ${QUOTES_TABLE} q
          INNER JOIN ${CLIENTS_TABLE} c ON c.id = q.client_id
          WHERE ${where.join(' AND ')}
          ORDER BY q.updated_at DESC
          LIMIT ?
          OFFSET ?
        `,
        ...params,
        limit,
        offset
      );

      return rows.map((row) => ({ ...mapQuoteRow(row), client_name: row.client_name }));
    },

    async getById(id: string): Promise<BillingQuote | null> {
      const clean = normalizeText(id);
      if (!clean) throw new Error('quoteId requis.');
      const row = await getQuoteRow(clean, false);
      return row ? mapQuoteRow(row) : null;
    },

    async listLineItems(quoteId: string): Promise<BillingLineItem[]> {
      const clean = normalizeText(quoteId);
      if (!clean) throw new Error('quoteId requis.');
      const rows = await listLineItemRows('quote', clean, false);
      return rows.map(mapLineItemRow);
    },

    async create(input: BillingQuoteCreateInput): Promise<BillingQuote> {
      const orgId = requireOrgId();
      const userId = requireUserId();
      await ensureSetup();
      const db = await getDb();

      const clientId = normalizeText(input.client_id);
      if (!clientId) {
        throw new Error('client_id requis.');
      }

      const clientRow = await getClientRow(clientId, false);
      if (!clientRow) {
        throw new Error('Client introuvable (local).');
      }

      const issueDate = normalizeText(input.issue_date) || todayDate();
      const status = input.status ? ensureQuoteStatus(input.status) : 'draft';
      const notes = toOptional(input.notes);

      const drafts = input.line_items?.length ? input.line_items : [{ label: 'Prestation', quantity: 1, unit_price: 0, tax_rate: 20 }];
      const totals = computeLineTotals(drafts);

      const now = nowIso();
      const quoteId = normalizeText(input.id) || createUuid();
      const number = status === 'draft' ? tempNumber(quoteId) : await allocateNumber('quote');
      if (status !== 'draft' && isTempNumber(number)) {
        throw new Error('Impossible de créer un devis non-brouillon hors ligne (réservation numéros requise).');
      }
      const quote: BillingQuote = {
        id: quoteId,
        org_id: orgId,
        client_id: clientId,
        number,
        status,
        issue_date: issueDate,
        valid_until: toOptional(input.valid_until),
        subtotal: totals.subtotal,
        tax_total: totals.tax_total,
        total: totals.total,
        notes,
        created_by: userId,
        created_at: now,
        updated_at: now
      };

      await db.runAsync(
        `
          INSERT OR REPLACE INTO ${QUOTES_TABLE}
          (id, org_id, client_id, number, status, issue_date, valid_until, subtotal, tax_total, total, notes, created_by, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `,
        quote.id,
        quote.org_id,
        quote.client_id,
        quote.number,
        quote.status,
        quote.issue_date,
        quote.valid_until ?? null,
        quote.subtotal,
        quote.tax_total,
        quote.total,
        quote.notes ?? null,
        quote.created_by,
        quote.created_at,
        quote.updated_at
      );

      for (let idx = 0; idx < drafts.length; idx += 1) {
        const draft = drafts[idx]!;
        const item: BillingLineItem = {
          id: normalizeText(draft.id) || createUuid(),
          org_id: orgId,
          parent_type: 'quote',
          parent_id: quote.id,
          label: normalizeText(draft.label) || `Ligne ${idx + 1}`,
          quantity: ensurePositiveNumber(draft.quantity, 'Quantité'),
          unit_price: ensureNonNegativeNumber(draft.unit_price, 'Prix unitaire'),
          tax_rate: ensureNonNegativeNumber(draft.tax_rate, 'TVA'),
          line_total: lineTotal(draft),
          position: Number.isFinite(draft.position ?? NaN) ? Math.max(0, Math.floor(draft.position as number)) : idx,
          created_at: now,
          updated_at: now
        };

        await db.runAsync(
          `
            INSERT OR REPLACE INTO ${LINE_ITEMS_TABLE}
            (id, org_id, parent_type, parent_id, label, quantity, unit_price, tax_rate, line_total, position, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          `,
          item.id,
          item.org_id,
          item.parent_type,
          item.parent_id,
          item.label,
          item.quantity,
          item.unit_price,
          item.tax_rate,
          item.line_total,
          item.position,
          item.created_at,
          item.updated_at
        );

        await enqueueEntityOperation({
          entity: 'billing_line_items',
          entity_id: item.id,
          type: 'CREATE',
          orgId,
          updatedAt: item.updated_at,
          payload: { data: item }
        });
      }

      await enqueueEntityOperation({
        entity: 'billing_quotes',
        entity_id: quote.id,
        type: 'CREATE',
        orgId,
        updatedAt: quote.updated_at,
        payload: { data: quote }
      });

      await audit.log('billing.quote.create', 'BILLING_QUOTE', quote.id, { number: quote.number, status: quote.status });
      return quote;
    },

    async update(quoteId: string, patch: BillingQuoteUpdatePatch): Promise<BillingQuote> {
      const cleanId = normalizeText(quoteId);
      if (!cleanId) throw new Error('quoteId requis.');
      const row = await getQuoteRow(cleanId, true);
      if (!row) throw new Error('Devis introuvable.');

      const current = mapQuoteRow(row);
      let next: BillingQuote = {
        ...current,
        client_id: patch.client_id !== undefined ? normalizeText(patch.client_id) : current.client_id,
        issue_date: patch.issue_date !== undefined ? normalizeText(patch.issue_date) : current.issue_date,
        valid_until:
          patch.valid_until === null ? undefined : patch.valid_until !== undefined ? toOptional(patch.valid_until) : current.valid_until,
        notes: patch.notes === null ? undefined : patch.notes !== undefined ? toOptional(patch.notes) : current.notes,
        status: patch.status !== undefined ? ensureQuoteStatus(patch.status) : current.status,
        subtotal: patch.subtotal !== undefined ? roundMoney(patch.subtotal) : current.subtotal,
        tax_total: patch.tax_total !== undefined ? roundMoney(patch.tax_total) : current.tax_total,
        total: patch.total !== undefined ? roundMoney(patch.total) : current.total,
        deleted_at: patch.deleted_at === null ? undefined : patch.deleted_at !== undefined ? toOptional(patch.deleted_at) : current.deleted_at,
        updated_at: nowIso()
      };

      if (isTempNumber(next.number) && next.status !== 'draft') {
        const allocated = await allocateNumber('quote');
        if (isTempNumber(allocated)) {
          throw new Error('Impossible de passer un devis TEMP en statut non-brouillon sans réservation numéros (repassez en ligne).');
        }
        next = { ...next, number: allocated };
      }

      await ensureSetup();
      const db = await getDb();
      await db.runAsync(
        `
          INSERT OR REPLACE INTO ${QUOTES_TABLE}
          (id, org_id, client_id, number, status, issue_date, valid_until, subtotal, tax_total, total, notes, created_by, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        next.id,
        next.org_id,
        next.client_id,
        next.number,
        next.status,
        next.issue_date,
        next.valid_until ?? null,
        next.subtotal,
        next.tax_total,
        next.total,
        next.notes ?? null,
        next.created_by,
        next.created_at,
        next.updated_at,
        next.deleted_at ?? null
      );

      await enqueueEntityOperation({
        entity: 'billing_quotes',
        entity_id: next.id,
        type: 'UPDATE',
        orgId: next.org_id,
        updatedAt: next.updated_at,
        payload: { data: next, patch }
      });

      await audit.log('billing.quote.update', 'BILLING_QUOTE', next.id, { patch });
      return next;
    },

    async softDelete(quoteId: string) {
      const updated = await this.update(quoteId, { deleted_at: nowIso() });
      await enqueueEntityOperation({
        entity: 'billing_quotes',
        entity_id: updated.id,
        type: 'DELETE',
        orgId: updated.org_id,
        updatedAt: updated.updated_at,
        payload: { id: updated.id, deleted_at: updated.deleted_at ?? nowIso() }
      });
      await audit.log('billing.quote.soft_delete', 'BILLING_QUOTE', updated.id, {});
    }
  },

  invoices: {
    async list(options: BillingInvoicesListOptions): Promise<BillingInvoiceListItem[]> {
      const orgId = requireOrgId(options.org_id);
      await ensureSetup();
      const db = await getDb();

      const { limit, offset } = resolvePaging(options.limit, options.offset);
      const includeDeleted = Boolean(options.includeDeleted);
      const q = normalizeText(options.q).toLowerCase();

      const status = options.status && options.status !== 'ALL' ? ensureInvoiceStatus(options.status) : null;
      const clientId = toOptional(options.client_id);

      const params: Array<string | number> = [orgId, includeDeleted ? 1 : 0];
      const where: string[] = [`i.org_id = ?`, `(? = 1 OR i.deleted_at IS NULL)`];

      if (status) {
        where.push(`i.status = ?`);
        params.push(status);
      }

      if (clientId) {
        where.push(`i.client_id = ?`);
        params.push(clientId);
      }

      if (q) {
        where.push(`(LOWER(i.number) LIKE ? OR LOWER(COALESCE(i.notes,'')) LIKE ? OR LOWER(c.name) LIKE ?)`);
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }

      const rows = await db.getAllAsync<(InvoiceRow & { client_name: string })>(
        `
          SELECT i.*, c.name AS client_name
          FROM ${INVOICES_TABLE} i
          INNER JOIN ${CLIENTS_TABLE} c ON c.id = i.client_id
          WHERE ${where.join(' AND ')}
          ORDER BY i.updated_at DESC
          LIMIT ?
          OFFSET ?
        `,
        ...params,
        limit,
        offset
      );

      return rows.map((row) => ({ ...mapInvoiceRow(row), client_name: row.client_name }));
    },

    async getById(id: string): Promise<BillingInvoice | null> {
      const clean = normalizeText(id);
      if (!clean) throw new Error('invoiceId requis.');
      const row = await getInvoiceRow(clean, false);
      return row ? mapInvoiceRow(row) : null;
    },

    async listLineItems(invoiceId: string): Promise<BillingLineItem[]> {
      const clean = normalizeText(invoiceId);
      if (!clean) throw new Error('invoiceId requis.');
      const rows = await listLineItemRows('invoice', clean, false);
      return rows.map(mapLineItemRow);
    },

    async listPayments(invoiceId: string): Promise<BillingPayment[]> {
      const clean = normalizeText(invoiceId);
      if (!clean) throw new Error('invoiceId requis.');
      await ensureSetup();
      const db = await getDb();

      const rows = await db.getAllAsync<PaymentRow>(
        `
          SELECT *
          FROM ${PAYMENTS_TABLE}
          WHERE invoice_id = ?
            AND deleted_at IS NULL
          ORDER BY paid_at DESC
        `,
        clean
      );

      return rows.map(mapPaymentRow);
    },

    async create(input: BillingInvoiceCreateInput): Promise<BillingInvoice> {
      const orgId = requireOrgId();
      const userId = requireUserId();
      await ensureSetup();
      const db = await getDb();

      const clientId = normalizeText(input.client_id);
      if (!clientId) {
        throw new Error('client_id requis.');
      }

      const clientRow = await getClientRow(clientId, false);
      if (!clientRow) {
        throw new Error('Client introuvable (local).');
      }

      const issueDate = normalizeText(input.issue_date) || todayDate();
      const status = input.status ? ensureInvoiceStatus(input.status) : 'draft';
      const notes = toOptional(input.notes);
      const currency = input.currency ?? 'EUR';

      const drafts = input.line_items?.length ? input.line_items : [{ label: 'Prestation', quantity: 1, unit_price: 0, tax_rate: 20 }];
      const totals = computeLineTotals(drafts);

      const now = nowIso();
      const invoiceId = normalizeText(input.id) || createUuid();
      const number = status === 'draft' ? tempNumber(invoiceId) : await allocateNumber('invoice');
      if (status !== 'draft' && isTempNumber(number)) {
        throw new Error('Impossible de créer une facture non-brouillon hors ligne (réservation numéros requise).');
      }
      const invoice: BillingInvoice = {
        id: invoiceId,
        org_id: orgId,
        client_id: clientId,
        quote_id: toOptional(input.quote_id),
        number,
        status,
        issue_date: issueDate,
        due_date: toOptional(input.due_date),
        subtotal: totals.subtotal,
        tax_total: totals.tax_total,
        total: totals.total,
        paid_total: 0,
        currency,
        notes,
        created_by: userId,
        created_at: now,
        updated_at: now
      };

      await db.runAsync(
        `
          INSERT OR REPLACE INTO ${INVOICES_TABLE}
          (id, org_id, client_id, quote_id, number, status, issue_date, due_date, subtotal, tax_total, total, paid_total, currency, notes, created_by, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `,
        invoice.id,
        invoice.org_id,
        invoice.client_id,
        invoice.quote_id ?? null,
        invoice.number,
        invoice.status,
        invoice.issue_date,
        invoice.due_date ?? null,
        invoice.subtotal,
        invoice.tax_total,
        invoice.total,
        invoice.paid_total,
        invoice.currency,
        invoice.notes ?? null,
        invoice.created_by,
        invoice.created_at,
        invoice.updated_at
      );

      for (let idx = 0; idx < drafts.length; idx += 1) {
        const draft = drafts[idx]!;
        const item: BillingLineItem = {
          id: normalizeText(draft.id) || createUuid(),
          org_id: orgId,
          parent_type: 'invoice',
          parent_id: invoice.id,
          label: normalizeText(draft.label) || `Ligne ${idx + 1}`,
          quantity: ensurePositiveNumber(draft.quantity, 'Quantité'),
          unit_price: ensureNonNegativeNumber(draft.unit_price, 'Prix unitaire'),
          tax_rate: ensureNonNegativeNumber(draft.tax_rate, 'TVA'),
          line_total: lineTotal(draft),
          position: Number.isFinite(draft.position ?? NaN) ? Math.max(0, Math.floor(draft.position as number)) : idx,
          created_at: now,
          updated_at: now
        };

        await db.runAsync(
          `
            INSERT OR REPLACE INTO ${LINE_ITEMS_TABLE}
            (id, org_id, parent_type, parent_id, label, quantity, unit_price, tax_rate, line_total, position, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          `,
          item.id,
          item.org_id,
          item.parent_type,
          item.parent_id,
          item.label,
          item.quantity,
          item.unit_price,
          item.tax_rate,
          item.line_total,
          item.position,
          item.created_at,
          item.updated_at
        );

        await enqueueEntityOperation({
          entity: 'billing_line_items',
          entity_id: item.id,
          type: 'CREATE',
          orgId,
          updatedAt: item.updated_at,
          payload: { data: item }
        });
      }

      await enqueueEntityOperation({
        entity: 'billing_invoices',
        entity_id: invoice.id,
        type: 'CREATE',
        orgId,
        updatedAt: invoice.updated_at,
        payload: { data: invoice }
      });

      await audit.log('billing.invoice.create', 'BILLING_INVOICE', invoice.id, { number: invoice.number, status: invoice.status });
      return invoice;
    },

    async createFromQuote(quoteId: string, overrides: Partial<Pick<BillingInvoiceCreateInput, 'due_date' | 'notes'>> = {}) {
      const quote = await billing.quotes.getById(quoteId);
      if (!quote) {
        throw new Error('Devis introuvable.');
      }

      const items = await billing.quotes.listLineItems(quoteId);
      const drafts: BillingLineItemDraft[] = items.map((item) => ({
        label: item.label,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        position: item.position
      }));

      return this.create({
        client_id: quote.client_id,
        quote_id: quote.id,
        issue_date: todayDate(),
        due_date: overrides.due_date,
        notes: overrides.notes ?? quote.notes,
        status: 'draft',
        line_items: drafts
      });
    },

    async update(invoiceId: string, patch: BillingInvoiceUpdatePatch): Promise<BillingInvoice> {
      const cleanId = normalizeText(invoiceId);
      if (!cleanId) throw new Error('invoiceId requis.');
      const row = await getInvoiceRow(cleanId, true);
      if (!row) throw new Error('Facture introuvable.');

      const current = mapInvoiceRow(row);
      let next: BillingInvoice = {
        ...current,
        client_id: patch.client_id !== undefined ? normalizeText(patch.client_id) : current.client_id,
        quote_id: patch.quote_id === null ? undefined : patch.quote_id !== undefined ? toOptional(patch.quote_id) : current.quote_id,
        issue_date: patch.issue_date !== undefined ? normalizeText(patch.issue_date) : current.issue_date,
        due_date: patch.due_date === null ? undefined : patch.due_date !== undefined ? toOptional(patch.due_date) : current.due_date,
        notes: patch.notes === null ? undefined : patch.notes !== undefined ? toOptional(patch.notes) : current.notes,
        status: patch.status !== undefined ? ensureInvoiceStatus(patch.status) : current.status,
        subtotal: patch.subtotal !== undefined ? roundMoney(patch.subtotal) : current.subtotal,
        tax_total: patch.tax_total !== undefined ? roundMoney(patch.tax_total) : current.tax_total,
        total: patch.total !== undefined ? roundMoney(patch.total) : current.total,
        paid_total: patch.paid_total !== undefined ? roundMoney(patch.paid_total) : current.paid_total,
        deleted_at: patch.deleted_at === null ? undefined : patch.deleted_at !== undefined ? toOptional(patch.deleted_at) : current.deleted_at,
        updated_at: nowIso()
      };

      if (isTempNumber(next.number) && next.status !== 'draft') {
        const allocated = await allocateNumber('invoice');
        if (isTempNumber(allocated)) {
          throw new Error('Impossible de passer une facture TEMP en statut non-brouillon sans réservation numéros (repassez en ligne).');
        }
        next = { ...next, number: allocated };
      }

      await ensureSetup();
      const db = await getDb();
      await db.runAsync(
        `
          INSERT OR REPLACE INTO ${INVOICES_TABLE}
          (id, org_id, client_id, quote_id, number, status, issue_date, due_date, subtotal, tax_total, total, paid_total, currency, notes, created_by, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        next.id,
        next.org_id,
        next.client_id,
        next.quote_id ?? null,
        next.number,
        next.status,
        next.issue_date,
        next.due_date ?? null,
        next.subtotal,
        next.tax_total,
        next.total,
        next.paid_total,
        next.currency,
        next.notes ?? null,
        next.created_by,
        next.created_at,
        next.updated_at,
        next.deleted_at ?? null
      );

      await enqueueEntityOperation({
        entity: 'billing_invoices',
        entity_id: next.id,
        type: 'UPDATE',
        orgId: next.org_id,
        updatedAt: next.updated_at,
        payload: { data: next, patch }
      });

      await audit.log('billing.invoice.update', 'BILLING_INVOICE', next.id, { patch });
      return next;
    },

    async softDelete(invoiceId: string) {
      const updated = await this.update(invoiceId, { deleted_at: nowIso() });
      await enqueueEntityOperation({
        entity: 'billing_invoices',
        entity_id: updated.id,
        type: 'DELETE',
        orgId: updated.org_id,
        updatedAt: updated.updated_at,
        payload: { id: updated.id, deleted_at: updated.deleted_at ?? nowIso() }
      });
      await audit.log('billing.invoice.soft_delete', 'BILLING_INVOICE', updated.id, {});
    },

    async addPayment(invoiceId: string, input: BillingPaymentCreateInput): Promise<BillingPayment> {
      const orgId = requireOrgId();
      const userId = requireUserId();
      await ensureSetup();
      const db = await getDb();

      const cleanInvoiceId = normalizeText(invoiceId);
      if (!cleanInvoiceId) throw new Error('invoiceId requis.');
      const invoiceRow = await getInvoiceRow(cleanInvoiceId, false);
      if (!invoiceRow) throw new Error('Facture introuvable.');

      const amount = roundMoney(ensurePositiveNumber(input.amount, 'Montant'));
      const method = ensureMethod(input.method);
      const paidAt = normalizeText(input.paid_at) || todayDate();

      const now = nowIso();
      const payment: BillingPayment = {
        id: normalizeText(input.id) || createUuid(),
        org_id: orgId,
        invoice_id: cleanInvoiceId,
        amount,
        method,
        paid_at: paidAt,
        reference: toOptional(input.reference),
        created_by: userId,
        created_at: now,
        updated_at: now
      };

      await db.runAsync(
        `
          INSERT OR REPLACE INTO ${PAYMENTS_TABLE}
          (id, org_id, invoice_id, amount, method, paid_at, reference, created_by, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `,
        payment.id,
        payment.org_id,
        payment.invoice_id,
        payment.amount,
        payment.method,
        payment.paid_at,
        payment.reference ?? null,
        payment.created_by,
        payment.created_at,
        payment.updated_at
      );

      await enqueueEntityOperation({
        entity: 'billing_payments',
        entity_id: payment.id,
        type: 'CREATE',
        orgId,
        updatedAt: payment.updated_at,
        payload: { data: payment }
      });

      await audit.log('billing.payment.create', 'BILLING_PAYMENT', payment.id, { invoice_id: payment.invoice_id, amount: payment.amount });

      await recomputeInvoicePayments(cleanInvoiceId);
      return payment;
    }
  },

  lineItems: {
    async create(parentType: BillingLineItemParentType, parentId: string, draft: BillingLineItemDraft): Promise<BillingLineItem> {
      const orgId = requireOrgId();
      await ensureSetup();
      const db = await getDb();

      const cleanParentId = normalizeText(parentId);
      if (!cleanParentId) throw new Error('parentId requis.');

      const now = nowIso();
      const item: BillingLineItem = {
        id: normalizeText(draft.id) || createUuid(),
        org_id: orgId,
        parent_type: ensureParentType(parentType),
        parent_id: cleanParentId,
        label: normalizeText(draft.label) || 'Ligne',
        quantity: ensurePositiveNumber(draft.quantity, 'Quantité'),
        unit_price: ensureNonNegativeNumber(draft.unit_price, 'Prix unitaire'),
        tax_rate: ensureNonNegativeNumber(draft.tax_rate, 'TVA'),
        line_total: lineTotal(draft),
        position: Number.isFinite(draft.position ?? NaN) ? Math.max(0, Math.floor(draft.position as number)) : 0,
        created_at: now,
        updated_at: now
      };

      await db.runAsync(
        `
          INSERT OR REPLACE INTO ${LINE_ITEMS_TABLE}
          (id, org_id, parent_type, parent_id, label, quantity, unit_price, tax_rate, line_total, position, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `,
        item.id,
        item.org_id,
        item.parent_type,
        item.parent_id,
        item.label,
        item.quantity,
        item.unit_price,
        item.tax_rate,
        item.line_total,
        item.position,
        item.created_at,
        item.updated_at
      );

      await enqueueEntityOperation({
        entity: 'billing_line_items',
        entity_id: item.id,
        type: 'CREATE',
        orgId,
        updatedAt: item.updated_at,
        payload: { data: item }
      });

      if (item.parent_type === 'quote') {
        await recomputeQuoteTotals(item.parent_id);
      } else {
        await recomputeInvoiceTotals(item.parent_id);
      }

      return item;
    },

    async update(itemId: string, patch: Partial<BillingLineItemDraft>): Promise<BillingLineItem> {
      const clean = normalizeText(itemId);
      if (!clean) throw new Error('itemId requis.');
      await ensureSetup();
      const db = await getDb();

      const row = await db.getFirstAsync<LineItemRow>(
        `
          SELECT *
          FROM ${LINE_ITEMS_TABLE}
          WHERE id = ?
          LIMIT 1
        `,
        clean
      );
      if (!row) throw new Error('Ligne introuvable.');
      const current = mapLineItemRow(row);

      const nextDraft: BillingLineItemDraft = {
        label: patch.label !== undefined ? patch.label : current.label,
        quantity: patch.quantity !== undefined ? patch.quantity : current.quantity,
        unit_price: patch.unit_price !== undefined ? patch.unit_price : current.unit_price,
        tax_rate: patch.tax_rate !== undefined ? patch.tax_rate : current.tax_rate,
        position: patch.position !== undefined ? patch.position : current.position
      };

      const next: BillingLineItem = {
        ...current,
        label: normalizeText(nextDraft.label) || current.label,
        quantity: ensurePositiveNumber(nextDraft.quantity, 'Quantité'),
        unit_price: ensureNonNegativeNumber(nextDraft.unit_price, 'Prix unitaire'),
        tax_rate: ensureNonNegativeNumber(nextDraft.tax_rate, 'TVA'),
        line_total: lineTotal(nextDraft),
        position: Number.isFinite(nextDraft.position ?? NaN) ? Math.max(0, Math.floor(nextDraft.position as number)) : current.position,
        updated_at: nowIso()
      };

      await db.runAsync(
        `
          UPDATE ${LINE_ITEMS_TABLE}
          SET label = ?, quantity = ?, unit_price = ?, tax_rate = ?, line_total = ?, position = ?, updated_at = ?
          WHERE id = ?
        `,
        next.label,
        next.quantity,
        next.unit_price,
        next.tax_rate,
        next.line_total,
        next.position,
        next.updated_at,
        next.id
      );

      await enqueueEntityOperation({
        entity: 'billing_line_items',
        entity_id: next.id,
        type: 'UPDATE',
        orgId: next.org_id,
        updatedAt: next.updated_at,
        payload: { data: next, patch }
      });

      if (next.parent_type === 'quote') {
        await recomputeQuoteTotals(next.parent_id);
      } else {
        await recomputeInvoiceTotals(next.parent_id);
      }

      return next;
    },

    async softDelete(itemId: string): Promise<void> {
      const clean = normalizeText(itemId);
      if (!clean) throw new Error('itemId requis.');
      await ensureSetup();
      const db = await getDb();

      const row = await db.getFirstAsync<LineItemRow>(
        `
          SELECT *
          FROM ${LINE_ITEMS_TABLE}
          WHERE id = ?
          LIMIT 1
        `,
        clean
      );
      if (!row) throw new Error('Ligne introuvable.');
      const current = mapLineItemRow(row);
      const deletedAt = nowIso();

      await db.runAsync(
        `
          UPDATE ${LINE_ITEMS_TABLE}
          SET deleted_at = ?, updated_at = ?
          WHERE id = ?
        `,
        deletedAt,
        deletedAt,
        clean
      );

      await enqueueEntityOperation({
        entity: 'billing_line_items',
        entity_id: current.id,
        type: 'DELETE',
        orgId: current.org_id,
        updatedAt: deletedAt,
        payload: { id: current.id, deleted_at: deletedAt }
      });

      if (current.parent_type === 'quote') {
        await recomputeQuoteTotals(current.parent_id);
      } else {
        await recomputeInvoiceTotals(current.parent_id);
      }
    }
  }
};
