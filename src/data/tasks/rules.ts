import keywordRulesConfig from './keywordRules.json';
import { KeywordRulesConfig, Task, TaskSuggestion } from './types';
import { rules as rulesEngine } from '../rules-engine';

const RULES_CONFIG = keywordRulesConfig as KeywordRulesConfig;

function nowIso() {
  return new Date().toISOString();
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function createSuggestion(ruleName: string, type: TaskSuggestion['type'], value: string): TaskSuggestion {
  return {
    id: `${ruleName}:${type}:${normalize(value)}`,
    rule: ruleName,
    type,
    value,
    created_at: nowIso()
  };
}

function dedupeTags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const normalized = normalize(tag);
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function mergeSuggestions(existing: TaskSuggestion[], next: TaskSuggestion[]) {
  const byId = new Map<string, TaskSuggestion>();

  for (const suggestion of existing) {
    byId.set(suggestion.id, suggestion);
  }

  for (const suggestion of next) {
    if (!byId.has(suggestion.id)) {
      byId.set(suggestion.id, suggestion);
    }
  }

  return [...byId.values()];
}

export async function evaluateKeywordRules(task: Task) {
  const start = Date.now();

  const evaluation = await rulesEngine.evaluate('TASK', {
    org_id: task.org_id,
    entity_id: task.id,
    title: task.title,
    description: task.description ?? '',
    tags: task.tags ?? []
  });

  const nextTags = new Set<string>();
  const nextSuggestions: TaskSuggestion[] = [];

  for (const match of evaluation.matched) {
    for (const action of match.actions) {
      if (action.kind === 'ADD_TAG') {
        nextTags.add(normalize(action.value));
      }

      if (action.kind === 'SUGGEST') {
        nextSuggestions.push(createSuggestion(match.rule_id, 'SUGGESTION', action.value));
      }

      if (action.kind === 'ADD_REMINDER') {
        nextSuggestions.push(createSuggestion(match.rule_id, 'REMINDER', action.value));
      }
    }
  }

  const mergedTags = dedupeTags([...(task.tags ?? []), ...nextTags]);
  const mergedSuggestions = mergeSuggestions(task.suggestions ?? [], nextSuggestions);

  return {
    tags: mergedTags,
    suggestions: mergedSuggestions,
    durationMs: Date.now() - start
  };
}

export function getKeywordRules() {
  return RULES_CONFIG;
}
