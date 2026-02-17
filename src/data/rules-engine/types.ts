export type RuleEntity = string;

export type RuleCondition =
  | { kind: 'ALWAYS' }
  | { kind: 'KEYWORDS_ANY'; fields: string[]; keywords: string[] }
  | { kind: 'FIELD_EQUALS'; field: string; value: string | number | boolean | null; case_insensitive?: boolean }
  | { kind: 'ARRAY_INCLUDES_ANY'; field: string; values: string[] }
  | { kind: 'AND'; all: RuleCondition[] }
  | { kind: 'OR'; any: RuleCondition[] }
  | { kind: 'NOT'; cond: RuleCondition };

export type RuleAction =
  | { kind: 'ADD_TAG'; value: string }
  | { kind: 'SUGGEST'; value: string }
  | { kind: 'ADD_REMINDER'; value: string }
  | { kind: 'SET_FIELD'; field: string; value: unknown };

export type RuleSource = 'DEFAULT' | 'LOCAL' | 'REMOTE';

export type RuleDefinition = {
  id: string;
  name: string;
  entity: RuleEntity;
  enabled?: boolean;
  priority?: number;
  condition: RuleCondition;
  actions: RuleAction[];
};

export type RuleRecord = {
  id: string;
  name: string;
  entity: RuleEntity;
  enabled: boolean;
  priority: number;
  condition: RuleCondition;
  actions: RuleAction[];
  updated_at?: string;
  updated_by?: string | null;
  source: RuleSource;
};

export type RulesConfig = {
  version: number;
  rules: RuleDefinition[];
};

export type RulesEvaluateContext = {
  org_id?: string;
  entity_id?: string;
  [key: string]: unknown;
};

export type RulesMatch = {
  rule_id: string;
  rule_name: string;
  actions: RuleAction[];
};

export type RulesEvaluationResult = {
  entity: RuleEntity;
  org_id?: string;
  entity_id?: string;
  matched: RulesMatch[];
  actions: RuleAction[];
  duration_ms: number;
  journal_id?: string;
};

