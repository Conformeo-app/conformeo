import keywordRulesConfig from './keywordRules.json';
import { KeywordRule, KeywordRulesConfig, Task, TaskSuggestion } from './types';

const RULES_CONFIG = keywordRulesConfig as KeywordRulesConfig;

function nowIso() {
  return new Date().toISOString();
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function hasKeyword(haystack: string, keywords: string[]) {
  for (const keyword of keywords) {
    const normalized = normalize(keyword);
    if (normalized.length > 0 && haystack.includes(normalized)) {
      return true;
    }
  }

  return false;
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

export function evaluateKeywordRules(task: Task, rules: KeywordRule[] = RULES_CONFIG.rules) {
  const start = Date.now();
  const content = [task.title, task.description ?? '', ...(task.tags ?? [])]
    .join(' ')
    .toLowerCase();

  const nextTags = new Set<string>();
  const nextSuggestions: TaskSuggestion[] = [];

  for (const rule of rules) {
    if (!hasKeyword(content, rule.keywords)) {
      continue;
    }

    for (const action of rule.actions) {
      if (action.type === 'ADD_TAG') {
        nextTags.add(normalize(action.value));
      }

      if (action.type === 'SUGGEST') {
        nextSuggestions.push(createSuggestion(rule.name, 'SUGGESTION', action.value));
      }

      if (action.type === 'ADD_REMINDER') {
        nextSuggestions.push(createSuggestion(rule.name, 'REMINDER', action.value));
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
