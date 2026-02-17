import * as SQLite from 'expo-sqlite';
import defaultRulesConfig from './defaultRules.json';
import {
  RuleAction,
  RuleCondition,
  RuleDefinition,
  RuleEntity,
  RuleRecord,
  RuleSource,
  RulesConfig,
  RulesEvaluateContext,
  RulesEvaluationResult,
  RulesMatch
} from './types';

const DB_NAME = 'conformeo.db';
const RULES_CACHE_TABLE = 'rules_engine_cache';
const RULES_JOURNAL_TABLE = 'rules_engine_journal';

const DEFAULT_PRIORITY = 50;

type CacheRow = {
  org_id: string;
  rule_id: string;
  rule_json: string;
  updated_at: string;
  updated_by: string | null;
  source: RuleSource;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let contextOrgId: string | null = null;
let contextUserId: string | null = null;

const defaultConfig = defaultRulesConfig as RulesConfig;

const rulesByOrgMemory = new Map<string, Map<string, RuleRecord>>();

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUpper(value: string | null | undefined) {
  return normalizeText(value).toUpperCase();
}

function normalizeLower(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function toOptional(value: string | null | undefined) {
  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureObject(value: unknown) {
  return isRecord(value) ? value : ({} as Record<string, unknown>);
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function hashFNV1a(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function contextHash(entity: RuleEntity, context: RulesEvaluateContext) {
  const title = typeof context.title === 'string' ? context.title.slice(0, 256) : '';
  const description = typeof context.description === 'string' ? context.description.slice(0, 256) : '';
  const tags = Array.isArray(context.tags)
    ? context.tags
        .slice(0, 20)
        .map((tag) => (typeof tag === 'string' ? tag : ''))
        .join(',')
    : '';
  const entityId = normalizeText(context.entity_id) || normalizeText((context as any).id);
  const raw = JSON.stringify({ entity: normalizeUpper(entity), entity_id: entityId, title, description, tags });
  return hashFNV1a(raw);
}

function ruleOrder(left: RuleRecord, right: RuleRecord) {
  if (left.entity !== right.entity) {
    return left.entity.localeCompare(right.entity);
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.id.localeCompare(right.id);
}

function normalizeCondition(input: RuleCondition): RuleCondition {
  if (input.kind === 'ALWAYS') {
    return input;
  }

  if (input.kind === 'KEYWORDS_ANY') {
    const fields = Array.isArray(input.fields) ? input.fields.map((f) => normalizeText(f)).filter(Boolean) : [];
    const keywords = Array.isArray(input.keywords) ? input.keywords.map((k) => normalizeText(k)).filter(Boolean) : [];
    if (fields.length === 0 || keywords.length === 0) {
      throw new Error('Condition KEYWORDS_ANY invalide (fields/keywords).');
    }
    return { ...input, fields, keywords };
  }

  if (input.kind === 'FIELD_EQUALS') {
    const field = normalizeText(input.field);
    if (!field) {
      throw new Error('Condition FIELD_EQUALS invalide (field).');
    }
    return { ...input, field };
  }

  if (input.kind === 'ARRAY_INCLUDES_ANY') {
    const field = normalizeText(input.field);
    const values = Array.isArray(input.values) ? input.values.map((v) => normalizeText(v)).filter(Boolean) : [];
    if (!field || values.length === 0) {
      throw new Error('Condition ARRAY_INCLUDES_ANY invalide (field/values).');
    }
    return { ...input, field, values };
  }

  if (input.kind === 'AND') {
    if (!Array.isArray(input.all) || input.all.length === 0) {
      throw new Error('Condition AND invalide (all).');
    }
    return { ...input, all: input.all.map(normalizeCondition) };
  }

  if (input.kind === 'OR') {
    if (!Array.isArray(input.any) || input.any.length === 0) {
      throw new Error('Condition OR invalide (any).');
    }
    return { ...input, any: input.any.map(normalizeCondition) };
  }

  if (input.kind === 'NOT') {
    return { ...input, cond: normalizeCondition(input.cond) };
  }

  throw new Error(`Condition inconnue: ${(input as any).kind}`);
}

function normalizeAction(action: RuleAction): RuleAction {
  if (action.kind === 'ADD_TAG' || action.kind === 'SUGGEST' || action.kind === 'ADD_REMINDER') {
    const value = normalizeText(action.value);
    if (!value) {
      throw new Error(`Action ${action.kind} invalide (value).`);
    }
    return { ...action, value } as RuleAction;
  }

  if (action.kind === 'SET_FIELD') {
    const field = normalizeText(action.field);
    if (!field) {
      throw new Error('Action SET_FIELD invalide (field).');
    }
    return { ...action, field } as RuleAction;
  }

  throw new Error(`Action inconnue: ${(action as any).kind}`);
}

function normalizeRule(def: RuleDefinition, source: RuleSource, meta?: Partial<Pick<RuleRecord, 'updated_at' | 'updated_by'>>): RuleRecord {
  const id = normalizeText(def.id);
  const name = normalizeText(def.name);
  const entity = normalizeUpper(def.entity);
  if (!id) throw new Error('Rule.id manquant.');
  if (!name) throw new Error(`Rule.name manquant (${id}).`);
  if (!entity) throw new Error(`Rule.entity manquant (${id}).`);

  const enabled = def.enabled !== undefined ? Boolean(def.enabled) : true;
  const priority = clamp(Math.floor(def.priority ?? DEFAULT_PRIORITY), 0, 1000);

  if (!Array.isArray(def.actions) || def.actions.length === 0) {
    throw new Error(`Rule.actions manquant (${id}).`);
  }

  return {
    id,
    name,
    entity,
    enabled,
    priority,
    condition: normalizeCondition(def.condition),
    actions: def.actions.map(normalizeAction),
    updated_at: toOptional(meta?.updated_at) ?? undefined,
    updated_by: meta?.updated_by ?? null,
    source
  };
}

function loadDefaultRules(): RuleRecord[] {
  const rows = Array.isArray(defaultConfig.rules) ? defaultConfig.rules : [];
  const mapped: RuleRecord[] = [];

  for (const rule of rows) {
    try {
      mapped.push(normalizeRule(rule, 'DEFAULT'));
    } catch {
      // ignore invalid default rules
    }
  }

  return mapped.sort(ruleOrder);
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

        CREATE TABLE IF NOT EXISTS ${RULES_CACHE_TABLE} (
          org_id TEXT NOT NULL,
          rule_id TEXT NOT NULL,
          rule_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT,
          source TEXT NOT NULL CHECK (source IN ('DEFAULT', 'LOCAL', 'REMOTE')),
          PRIMARY KEY (org_id, rule_id)
        );

        CREATE INDEX IF NOT EXISTS idx_rules_engine_cache_org_updated
          ON ${RULES_CACHE_TABLE}(org_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS ${RULES_JOURNAL_TABLE} (
          id TEXT PRIMARY KEY NOT NULL,
          org_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT,
          context_hash TEXT,
          matched_rules_json TEXT NOT NULL,
          actions_json TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rules_engine_journal_org_created
          ON ${RULES_JOURNAL_TABLE}(org_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_rules_engine_journal_org_entity_created
          ON ${RULES_JOURNAL_TABLE}(org_id, entity, created_at DESC);
      `);
    })();
  }

  return setupPromise;
}

async function readCacheRules(orgId: string): Promise<RuleRecord[]> {
  await ensureSetup();
  const db = await getDb();

  const rows = await db.getAllAsync<CacheRow>(
    `
      SELECT org_id, rule_id, rule_json, updated_at, updated_by, source
      FROM ${RULES_CACHE_TABLE}
      WHERE org_id = ?
      ORDER BY updated_at DESC
    `,
    orgId
  );

  const mapped: RuleRecord[] = [];
  for (const row of rows ?? []) {
    const parsed = safeJsonParse(row.rule_json);
    if (!parsed || !isRecord(parsed)) {
      continue;
    }

    try {
      mapped.push(
        normalizeRule(parsed as RuleDefinition, row.source ?? 'LOCAL', {
          updated_at: row.updated_at,
          updated_by: row.updated_by
        })
      );
    } catch {
      continue;
    }
  }

  return mapped.sort(ruleOrder);
}

async function upsertCacheRule(orgId: string, rule: RuleRecord) {
  await ensureSetup();
  const db = await getDb();

  const updatedAt = rule.updated_at ?? nowIso();

  const payload: RuleDefinition = {
    id: rule.id,
    name: rule.name,
    entity: rule.entity,
    enabled: rule.enabled,
    priority: rule.priority,
    condition: rule.condition,
    actions: rule.actions
  };

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${RULES_CACHE_TABLE}
      (org_id, rule_id, rule_json, updated_at, updated_by, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    orgId,
    rule.id,
    JSON.stringify(payload),
    updatedAt,
    rule.updated_by ?? null,
    rule.source
  );
}

function mergeRules(defaultRules: RuleRecord[], cachedRules: RuleRecord[]) {
  const map = new Map<string, RuleRecord>();

  for (const row of defaultRules) {
    map.set(row.id, row);
  }

  for (const row of cachedRules) {
    map.set(row.id, row);
  }

  return Array.from(map.values()).sort(ruleOrder);
}

function resolveOrgId(inputOrgId?: string) {
  return normalizeText(inputOrgId) || contextOrgId || null;
}

function resolvePath(context: Record<string, unknown>, path: string) {
  const cleaned = normalizeText(path);
  if (!cleaned) return undefined;

  const segments = cleaned.split('.').filter(Boolean);
  let cursor: unknown = context;

  for (const seg of segments) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[seg];
  }

  return cursor;
}

function fieldAsText(context: Record<string, unknown>, path: string) {
  const value = resolvePath(context, path);

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : '')).filter(Boolean).join(' ');
  }

  return '';
}

function evaluateCondition(condition: RuleCondition, context: Record<string, unknown>): boolean {
  if (condition.kind === 'ALWAYS') {
    return true;
  }

  if (condition.kind === 'KEYWORDS_ANY') {
    const haystack = condition.fields.map((field) => fieldAsText(context, field)).join(' ').toLowerCase();
    if (!haystack) return false;
    for (const keyword of condition.keywords) {
      const needle = normalizeLower(keyword);
      if (needle && haystack.includes(needle)) {
        return true;
      }
    }
    return false;
  }

  if (condition.kind === 'FIELD_EQUALS') {
    const actual = resolvePath(context, condition.field);
    const expected = condition.value;

    if (typeof actual === 'string' && typeof expected === 'string') {
      if (condition.case_insensitive === false) {
        return actual === expected;
      }
      return normalizeLower(actual) === normalizeLower(expected);
    }

    return actual === expected;
  }

  if (condition.kind === 'ARRAY_INCLUDES_ANY') {
    const actual = resolvePath(context, condition.field);
    if (!Array.isArray(actual)) {
      return false;
    }

    const normalized = new Set(
      actual.map((item) => (typeof item === 'string' ? normalizeLower(item) : '')).filter(Boolean)
    );

    for (const value of condition.values) {
      const needle = normalizeLower(value);
      if (needle && normalized.has(needle)) {
        return true;
      }
    }

    return false;
  }

  if (condition.kind === 'AND') {
    return condition.all.every((child) => evaluateCondition(child, context));
  }

  if (condition.kind === 'OR') {
    return condition.any.some((child) => evaluateCondition(child, context));
  }

  if (condition.kind === 'NOT') {
    return !evaluateCondition(condition.cond, context);
  }

  return false;
}

async function writeJournal(orgId: string, entity: RuleEntity, entityId: string | null, result: { matched: RulesMatch[]; actions: RuleAction[]; duration_ms: number }, ctxHash: string) {
  await ensureSetup();
  const db = await getDb();

  const id = createUuid();
  const createdAt = nowIso();

  await db.runAsync(
    `
      INSERT INTO ${RULES_JOURNAL_TABLE}
      (id, org_id, entity, entity_id, context_hash, matched_rules_json, actions_json, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    orgId,
    normalizeUpper(entity),
    entityId ?? null,
    ctxHash,
    JSON.stringify(result.matched),
    JSON.stringify(result.actions),
    Math.max(0, Math.floor(result.duration_ms)),
    createdAt
  );

  return id;
}

export const rules = {
  setContext(context: { org_id?: string; user_id?: string }) {
    contextOrgId = normalizeText(context.org_id) || null;
    contextUserId = normalizeText(context.user_id) || null;
    rulesByOrgMemory.clear();
  },

  async list(): Promise<RuleRecord[]> {
    const orgId = resolveOrgId();
    const defaults = loadDefaultRules();

    if (!orgId) {
      return defaults;
    }

    const memory = rulesByOrgMemory.get(orgId);
    if (memory) {
      return Array.from(memory.values()).sort(ruleOrder);
    }

    const cached = await readCacheRules(orgId);
    const merged = mergeRules(defaults, cached);

    const map = new Map<string, RuleRecord>();
    for (const row of merged) {
      map.set(row.id, row);
    }
    rulesByOrgMemory.set(orgId, map);

    return merged;
  },

  async update(rule: RuleDefinition): Promise<RuleRecord> {
    const orgId = resolveOrgId();
    if (!orgId) {
      throw new Error('org_id manquant (rules-engine).');
    }

    const updatedAt = nowIso();
    const updatedBy = toOptional(contextUserId ?? undefined) ?? null;

    const normalized = normalizeRule(rule, 'LOCAL', {
      updated_at: updatedAt,
      updated_by: updatedBy
    });

    await upsertCacheRule(orgId, normalized);

    const memory = rulesByOrgMemory.get(orgId);
    if (memory) {
      memory.set(normalized.id, normalized);
    } else {
      rulesByOrgMemory.set(orgId, new Map([[normalized.id, normalized]]));
    }

    return normalized;
  },

  async evaluate(entity: RuleEntity, context: RulesEvaluateContext): Promise<RulesEvaluationResult> {
    const started = Date.now();

    const entityNorm = normalizeUpper(entity);
    const orgId = resolveOrgId(typeof context.org_id === 'string' ? context.org_id : undefined) ?? undefined;
    const entityId = normalizeText(typeof context.entity_id === 'string' ? context.entity_id : undefined) || undefined;

    const rulesList = orgId ? await this.list() : loadDefaultRules();
    const candidates = rulesList.filter((rule) => rule.enabled && rule.entity === entityNorm).sort(ruleOrder);

    const ctx = ensureObject(context) as Record<string, unknown>;

    const matched: RulesMatch[] = [];
    const actions: RuleAction[] = [];

    for (const rule of candidates) {
      let ok = false;
      try {
        ok = evaluateCondition(rule.condition, ctx);
      } catch {
        ok = false;
      }

      if (!ok) continue;

      const normalizedActions = rule.actions.map(normalizeAction);
      matched.push({ rule_id: rule.id, rule_name: rule.name, actions: normalizedActions });
      actions.push(...normalizedActions);
    }

    const durationMs = Date.now() - started;
    const result: RulesEvaluationResult = {
      entity: entityNorm,
      org_id: orgId,
      entity_id: entityId,
      matched,
      actions,
      duration_ms: durationMs
    };

    if (orgId && matched.length > 0) {
      try {
        const journalId = await writeJournal(orgId, entityNorm, entityId ?? null, { matched, actions, duration_ms: durationMs }, contextHash(entityNorm, context));
        result.journal_id = journalId;
      } catch {
        // no-op (journal should not break UX)
      }
    }

    return result;
  }
};

