import * as SQLite from 'expo-sqlite';
import { modules as appModules, ModuleKey } from '../../core/modules';
import { isMissingTableError, toErrorMessage } from '../../core/identity-security/utils';
import defaultPlans from './defaultPlans.json';
import { audit } from '../audit-compliance';
import { flags } from '../feature-flags';
import { offlineDB } from '../offline/outbox';
import { OfferPlan, OfferPlanChange, OfferPricing, OrgOfferState } from './types';

const DB_NAME = 'conformeo.db';
const STATE_TABLE = 'org_offer_state';
const HISTORY_TABLE = 'org_offer_history';

type StateRow = {
  org_id: string;
  plan_key: string;
  updated_at: string;
  updated_by: string | null;
  source: string;
};

type HistoryRow = {
  id: string;
  org_id: string;
  old_plan_key: string | null;
  new_plan_key: string;
  changed_by: string | null;
  changed_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

const MODULE_KEY_SET = new Set<ModuleKey>(appModules.map((m) => m.key));

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

function isOfferPlansPayload(value: unknown): value is { plans: unknown[] } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as any).plans);
}

function normalizePlans(): OfferPlan[] {
  const payload = defaultPlans as unknown;
  if (!isOfferPlansPayload(payload)) {
    return [] as OfferPlan[];
  }

  const plans: OfferPlan[] = [];

  for (const raw of payload.plans) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }

    const record = raw as Record<string, unknown>;
    const key = normalizeText(record.key as string);
    const name = normalizeText(record.name as string);
    const base = typeof record.base_price_eur_month === 'number' ? record.base_price_eur_month : 0;
    const includedProjects = typeof record.included_active_projects === 'number' ? record.included_active_projects : 0;
    const extraProject = typeof record.extra_project_eur_month === 'number' ? record.extra_project_eur_month : 0;

    const included = Array.isArray(record.included_modules)
      ? (record.included_modules as unknown[])
          .map((m) => normalizeText(String(m)))
          .filter((m): m is ModuleKey => MODULE_KEY_SET.has(m as ModuleKey))
      : ([] as ModuleKey[]);

    if (!key || !name) {
      continue;
    }

    plans.push({
      key,
      name,
      base_price_eur_month: base,
      included_active_projects: includedProjects,
      extra_project_eur_month: extraProject,
      included_modules: included
    });
  }

  return plans;
}

const PLANS = normalizePlans();
const DEFAULT_PLAN_KEY = PLANS[0]?.key ?? 'STARTER';

function findPlan(planKey: string) {
  const key = normalizeText(planKey);
  return PLANS.find((p) => p.key === key) ?? null;
}

function mapStateRow(row: StateRow): OrgOfferState {
  const source = row.source === 'REMOTE' ? 'REMOTE' : row.source === 'LOCAL' ? 'LOCAL' : 'DEFAULT';
  return {
    org_id: row.org_id,
    plan_key: row.plan_key,
    updated_at: row.updated_at,
    updated_by: toOptional(row.updated_by),
    source
  };
}

function mapHistoryRow(row: HistoryRow): OfferPlanChange {
  return {
    id: row.id,
    org_id: row.org_id,
    old_plan_key: toOptional(row.old_plan_key),
    new_plan_key: row.new_plan_key,
    changed_by: toOptional(row.changed_by),
    changed_at: row.changed_at
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

        CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
          org_id TEXT PRIMARY KEY NOT NULL,
          plan_key TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT,
          source TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          old_plan_key TEXT,
          new_plan_key TEXT NOT NULL,
          changed_by TEXT,
          changed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_org_offer_history_org_changed
          ON ${HISTORY_TABLE}(org_id, changed_at DESC);
      `);
    })();
  }

  return setupPromise;
}

async function readState(orgId: string) {
  await ensureSetup();
  const db = await getDb();
  const row = await db.getFirstAsync<StateRow>(
    `
      SELECT org_id, plan_key, updated_at, updated_by, source
      FROM ${STATE_TABLE}
      WHERE org_id = ?
      LIMIT 1
    `,
    orgId
  );

  return row ? mapStateRow(row) : null;
}

async function writeState(state: OrgOfferState) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${STATE_TABLE}
      (org_id, plan_key, updated_at, updated_by, source)
      VALUES (?, ?, ?, ?, ?)
    `,
    state.org_id,
    state.plan_key,
    state.updated_at,
    state.updated_by ?? null,
    state.source
  );
}

async function insertHistory(change: OfferPlanChange) {
  await ensureSetup();
  const db = await getDb();
  await db.runAsync(
    `
      INSERT INTO ${HISTORY_TABLE}
      (id, org_id, old_plan_key, new_plan_key, changed_by, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    change.id,
    change.org_id,
    change.old_plan_key ?? null,
    change.new_plan_key,
    change.changed_by ?? null,
    change.changed_at
  );
}

async function countActiveProjectsFromTasks(orgId: string) {
  const db = await getDb();
  try {
    const row = await db.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(DISTINCT project_id) AS count
        FROM tasks
        WHERE org_id = ?
          AND deleted_at IS NULL
      `,
      orgId
    );
    return row?.count ?? 0;
  } catch (error) {
    if (isMissingTableError(error, 'tasks')) {
      return 0;
    }
    throw error;
  }
}

export const offers = {
  listPlans(): OfferPlan[] {
    return [...PLANS];
  },

  async getCurrent(orgId: string): Promise<OrgOfferState> {
    const org = normalizeText(orgId);
    if (!org) {
      throw new Error('orgId requis.');
    }

    const current = await readState(org);
    if (current) {
      return current;
    }

    const fallback: OrgOfferState = {
      org_id: org,
      plan_key: DEFAULT_PLAN_KEY,
      updated_at: nowIso(),
      source: 'DEFAULT'
    };

    await writeState(fallback);
    return fallback;
  },

  async setPlan(input: { org_id: string; plan_key: string; actor_user_id?: string }) {
    const org = normalizeText(input.org_id);
    const planKey = normalizeText(input.plan_key);
    const actor = toOptional(input.actor_user_id);

    if (!org) throw new Error('org_id requis.');
    const plan = findPlan(planKey);
    if (!plan) throw new Error('Plan inconnu: ' + planKey);

    const prev = await this.getCurrent(org);
    if (prev.plan_key === plan.key) {
      return prev;
    }

    const updatedAt = nowIso();
    const next: OrgOfferState = {
      org_id: org,
      plan_key: plan.key,
      updated_at: updatedAt,
      updated_by: actor,
      source: 'LOCAL'
    };

    await writeState(next);

    const change: OfferPlanChange = {
      id: createUuid(),
      org_id: org,
      old_plan_key: prev.plan_key,
      new_plan_key: plan.key,
      changed_by: actor,
      changed_at: updatedAt
    };

    await insertHistory(change);

    await offlineDB.enqueueOperation({
      entity: 'org_offer_state',
      entity_id: org,
      type: 'UPDATE',
      payload: {
        org_id: org,
        orgId: org,
        plan_key: next.plan_key,
        updated_at: next.updated_at,
        updated_by: next.updated_by
      }
    });

    await offlineDB.enqueueOperation({
      entity: 'org_offer_history',
      entity_id: change.id,
      type: 'CREATE',
      payload: {
        ...change,
        org_id: org,
        orgId: org
      }
    });

    try {
      await audit.log('offers.change_plan', 'ORG', org, {
        old_plan: prev.plan_key,
        new_plan: plan.key
      });
    } catch (error) {
      if (__DEV__) {
        console.warn('[offer-management] audit log failed:', toErrorMessage(error));
      }
    }

    return next;
  },

  async listHistory(orgId: string, limit = 30) {
    const org = normalizeText(orgId);
    if (!org) {
      return [] as OfferPlanChange[];
    }

    await ensureSetup();
    const db = await getDb();
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 200));
    const rows = await db.getAllAsync<HistoryRow>(
      `
        SELECT *
        FROM ${HISTORY_TABLE}
        WHERE org_id = ?
        ORDER BY changed_at DESC
        LIMIT ?
      `,
      org,
      safeLimit
    );

    return rows.map(mapHistoryRow);
  },

  getPlanModules(planKey: string): ModuleKey[] {
    const plan = findPlan(planKey);
    return plan ? [...plan.included_modules] : [];
  },

  async computePricing(orgId: string): Promise<OfferPricing> {
    const org = normalizeText(orgId);
    if (!org) {
      throw new Error('orgId requis.');
    }

    const current = await this.getCurrent(org);
    const plan = findPlan(current.plan_key) ?? findPlan(DEFAULT_PLAN_KEY);
    if (!plan) {
      throw new Error('Aucun plan disponible.');
    }

    await ensureSetup();
    const activeProjects = await countActiveProjectsFromTasks(org);
    const included = Math.max(0, plan.included_active_projects);
    const extraProjects = Math.max(0, activeProjects - included);
    const base = Math.max(0, plan.base_price_eur_month);
    const extraUnit = Math.max(0, plan.extra_project_eur_month);
    const total = base + extraProjects * extraUnit;

    return {
      org_id: org,
      plan_key: plan.key,
      active_projects: activeProjects,
      included_active_projects: included,
      extra_projects: extraProjects,
      base_price_eur_month: base,
      extra_project_eur_month: extraUnit,
      estimated_total_eur_month: total
    };
  },

  async applyPlanModulesToFlags(orgId: string, planKey: string) {
    const org = normalizeText(orgId);
    const plan = findPlan(planKey);
    if (!org || !plan) {
      throw new Error('orgId/planKey invalide.');
    }

    const included = new Set<ModuleKey>(plan.included_modules);

    const results: Array<{ key: ModuleKey; enabled: boolean; ok: boolean; error?: string }> = [];

    for (const module of appModules) {
      // superadmin is controlled by allowlist + MFA, not by plan.
      if (module.key === 'superadmin') {
        continue;
      }
      // Avoid locking out the billing/admin screen itself.
      if (module.key === 'offers') {
        continue;
      }

      const enabled = included.has(module.key);
      try {
        await flags.setEnabled(module.key, enabled, org);
        results.push({ key: module.key, enabled, ok: true });
      } catch (error) {
        results.push({ key: module.key, enabled, ok: false, error: toErrorMessage(error) });
      }
    }

    try {
      await audit.log('offers.apply_plan_flags', 'ORG', org, {
        plan_key: plan.key,
        applied: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length
      });
    } catch {
      // ignore
    }

    return results;
  }
};
