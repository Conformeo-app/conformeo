import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text as NativeText,
  TextInput,
  View
} from 'react-native';
import { useAuth } from '../../core/auth';
import { SearchEntity, SearchResult, search } from '../../data';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const PAGE_SIZE = 30;
const ORG_SCOPE_KEY = '__ORG__';
const DEBOUNCE_MS = 220;
const SUGGESTIONS_LIMIT = 8;

const ENTITY_ORDER: SearchEntity[] = [
  'TASK',
  'DOCUMENT',
  'MEDIA',
  'EXPORT',
  'BILLING_INVOICE',
  'BILLING_QUOTE',
  'BILLING_CLIENT'
];

const ENTITY_LABELS: Record<SearchEntity, string> = {
  TASK: 'Tâches',
  DOCUMENT: 'Documents',
  MEDIA: 'Preuves',
  EXPORT: 'Exports',
  BILLING_CLIENT: 'Clients',
  BILLING_QUOTE: 'Devis',
  BILLING_INVOICE: 'Factures'
};

const ENTITY_HINTS: Record<SearchEntity, string> = {
  TASK: 'Titre, description, tags, statut',
  DOCUMENT: 'Titre, type, statut, tags',
  MEDIA: 'Tag, mime, statut upload',
  EXPORT: 'Type export, statut, erreurs',
  BILLING_CLIENT: 'Nom, email, téléphone, TVA',
  BILLING_QUOTE: 'Numéro, client, statut, dates',
  BILLING_INVOICE: 'Numéro, client, statut, dates'
};

type HighlightPart = {
  value: string;
  highlighted: boolean;
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Erreur inconnue';
}

function formatDate(iso?: string) {
  if (!iso) {
    return '-';
  }

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  return parsed.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function parseHighlightParts(value: string): HighlightPart[] {
  if (!value) {
    return [];
  }

  const parts: HighlightPart[] = [];
  const regex = /\[\[(.*?)\]\]/g;
  let cursor = 0;

  while (true) {
    const match = regex.exec(value);
    if (!match) {
      break;
    }

    if (match.index > cursor) {
      parts.push({
        value: value.slice(cursor, match.index),
        highlighted: false
      });
    }

    const innerValue = match[1] ?? '';
    if (innerValue.length > 0) {
      parts.push({
        value: innerValue,
        highlighted: true
      });
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push({
      value: value.slice(cursor),
      highlighted: false
    });
  }

  if (parts.length === 0) {
    return [{ value, highlighted: false }];
  }

  return parts;
}

function HighlightedText({ value, title = false }: { value: string; title?: boolean }) {
  const { colors, typography } = useTheme();
  const parts = useMemo(() => parseHighlightParts(value), [value]);

  return (
    <NativeText
      style={[
        title ? typography.h2 : typography.body,
        { color: title ? colors.ink : colors.slate }
      ]}
    >
      {parts.map((part, index) => (
        <NativeText
          key={`${part.value}-${index}`}
          style={
            part.highlighted
              ? [title ? typography.h2 : typography.body, { color: colors.tealDark, fontWeight: '700' }]
              : [title ? typography.h2 : typography.body, { color: title ? colors.ink : colors.slate }]
          }
        >
          {part.value}
        </NativeText>
      ))}
    </NativeText>
  );
}

export function SearchScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [scopeKey, setScopeKey] = useState<string>(ORG_SCOPE_KEY);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);

  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');

  const [entityFilters, setEntityFilters] = useState<SearchEntity[]>([]);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);

  const [total, setTotal] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const searchRequestIdRef = useRef(0);
  const suggestionRequestIdRef = useRef(0);

  const scope = useMemo(() => {
    if (!activeOrgId) {
      return null;
    }

    return {
      orgId: activeOrgId,
      projectId: scopeKey === ORG_SCOPE_KEY ? undefined : scopeKey
    };
  }, [activeOrgId, scopeKey]);

  const hasEnoughChars = query.length >= 2;
  const hasMore = results.length < total;

  const groupedResults = useMemo(() => {
    const buckets = new Map<SearchEntity, SearchResult[]>();

    for (const item of results) {
      const list = buckets.get(item.entity) ?? [];
      list.push(item);
      buckets.set(item.entity, list);
    }

    return ENTITY_ORDER.map((entity) => ({
      entity,
      items: buckets.get(entity) ?? []
    })).filter((group) => group.items.length > 0);
  }, [results]);

  const refreshProjects = useCallback(async () => {
    if (!activeOrgId) {
      setProjectOptions([]);
      setScopeKey(ORG_SCOPE_KEY);
      return;
    }

    try {
      const projects = await search.listProjects({ orgId: activeOrgId });

      setProjectOptions(projects);
      setScopeKey((current) => {
        if (current === ORG_SCOPE_KEY) {
          return current;
        }

        if (projects.includes(current)) {
          return current;
        }

        return ORG_SCOPE_KEY;
      });
    } catch {
      setProjectOptions([]);
      setScopeKey(ORG_SCOPE_KEY);
    }
  }, [activeOrgId]);

  useEffect(() => {
    search.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined,
      project_id: scope?.projectId
    });
  }, [activeOrgId, scope?.projectId, user?.id]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setQuery(queryInput.trim());
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [queryInput]);

  const runSearch = useCallback(async () => {
    const requestId = ++searchRequestIdRef.current;

    if (!scope || !hasEnoughChars) {
      setLoading(false);
      setResults([]);
      setTotal(0);
      setElapsedMs(0);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await search.query(query, {
        scope,
        entities: entityFilters.length > 0 ? entityFilters : undefined,
        limit: PAGE_SIZE,
        offset: 0
      });

      if (searchRequestIdRef.current !== requestId) {
        return;
      }

      setResults(response.results);
      setTotal(response.total);
      setElapsedMs(response.elapsedMs);
    } catch (searchError) {
      if (searchRequestIdRef.current !== requestId) {
        return;
      }

      setError(toErrorMessage(searchError));
      setResults([]);
      setTotal(0);
      setElapsedMs(0);
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [entityFilters, hasEnoughChars, query, scope]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const loadMore = useCallback(async () => {
    if (!scope || !hasEnoughChars || loading || loadingMore || !hasMore) {
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    setLoadingMore(true);
    setError(null);

    try {
      const response = await search.query(query, {
        scope,
        entities: entityFilters.length > 0 ? entityFilters : undefined,
        limit: PAGE_SIZE,
        offset: results.length
      });

      if (searchRequestIdRef.current !== requestId) {
        return;
      }

      setTotal(response.total);
      setElapsedMs(response.elapsedMs);

      setResults((current) => {
        const seen = new Set(current.map((item) => item.id));
        const next = [...current];

        for (const item of response.results) {
          if (!seen.has(item.id)) {
            next.push(item);
            seen.add(item.id);
          }
        }

        return next;
      });
    } catch (loadError) {
      if (searchRequestIdRef.current !== requestId) {
        return;
      }

      setError(toErrorMessage(loadError));
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setLoadingMore(false);
      }
    }
  }, [entityFilters, hasEnoughChars, hasMore, loading, loadingMore, query, results.length, scope]);

  useEffect(() => {
    if (!scope) {
      setSuggestions([]);
      return;
    }

    const prefix = queryInput.trim();
    const requestId = ++suggestionRequestIdRef.current;

    const timeoutId = setTimeout(() => {
      search
        .getSuggestions(prefix, {
          scope,
          limit: SUGGESTIONS_LIMIT
        })
        .then((nextSuggestions) => {
          if (suggestionRequestIdRef.current !== requestId) {
            return;
          }

          setSuggestions(nextSuggestions);
        })
        .catch(() => {
          if (suggestionRequestIdRef.current !== requestId) {
            return;
          }

          setSuggestions([]);
        });
    }, 120);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [queryInput, scope]);

  const toggleEntityFilter = useCallback((entity: SearchEntity) => {
    setEntityFilters((current) => {
      if (current.includes(entity)) {
        return current.filter((item) => item !== entity);
      }

      return [...current, entity];
    });
  }, []);

  const rebuildIndex = useCallback(async () => {
    setRebuilding(true);
    setError(null);
    setInfo(null);

    try {
      const response = await search.rebuildAll();
      setInfo(`Index local reconstruit: ${response.indexed} entrées.`);
      await refreshProjects();
      await runSearch();
    } catch (rebuildError) {
      setError(toErrorMessage(rebuildError));
    } finally {
      setRebuilding(false);
    }
  }, [refreshProjects, runSearch]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.sm,
          paddingBottom: spacing.xl
        }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        alwaysBounceVertical
      >
        <SectionHeader
          title="Recherche"
          subtitle="Index local offline-first: globale + filtres modules, sans dépendance backend."
        />

        <Card>
          <Text variant="h2">Recherche globale</Text>

          <TextInput
            value={queryInput}
            onChangeText={setQueryInput}
            placeholder="Rechercher tâches, docs, preuves, exports..."
            placeholderTextColor={colors.slate}
            autoCorrect={false}
            autoCapitalize="none"
            style={{
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              color: colors.ink,
              marginTop: spacing.sm
            }}
          />

          {suggestions.length > 0 ? (
            <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {suggestions.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setQueryInput(item)}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    backgroundColor: colors.sand,
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs
                  }}
                >
                  <Text variant="caption">{item}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text variant="caption" style={{ marginTop: spacing.md, color: colors.slate }}>
            Scope
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ marginTop: spacing.xs, gap: spacing.xs }}
          >
            <Pressable
              onPress={() => setScopeKey(ORG_SCOPE_KEY)}
              style={{
                borderWidth: 1,
                borderColor: scopeKey === ORG_SCOPE_KEY ? colors.teal : colors.fog,
                backgroundColor: scopeKey === ORG_SCOPE_KEY ? `${colors.teal}22` : colors.white,
                borderRadius: radii.pill,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs
              }}
            >
              <Text variant="caption" style={{ color: scopeKey === ORG_SCOPE_KEY ? colors.tealDark : colors.slate }}>
                Entreprise
              </Text>
            </Pressable>

            {projectOptions.map((projectId) => {
              const active = scopeKey === projectId;

              return (
                <Pressable
                  key={projectId}
                  onPress={() => setScopeKey(projectId)}
                  style={{
                    borderWidth: 1,
                    borderColor: active ? colors.teal : colors.fog,
                    backgroundColor: active ? `${colors.teal}22` : colors.white,
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs
                  }}
                >
                  <Text variant="caption" style={{ color: active ? colors.tealDark : colors.slate }}>
                    {projectId}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text variant="caption" style={{ marginTop: spacing.md, color: colors.slate }}>
            Filtres module
          </Text>

          <View style={{ marginTop: spacing.xs, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {ENTITY_ORDER.map((entity) => {
              const active = entityFilters.includes(entity);

              return (
                <Pressable
                  key={entity}
                  onPress={() => toggleEntityFilter(entity)}
                  style={{
                    borderWidth: 1,
                    borderColor: active ? colors.teal : colors.fog,
                    backgroundColor: active ? `${colors.teal}22` : colors.white,
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs
                  }}
                >
                  <Text variant="caption" style={{ color: active ? colors.tealDark : colors.slate }}>
                    {ENTITY_LABELS[entity]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button
              label="Rafraichir"
              kind="ghost"
              onPress={() => {
                void runSearch();
              }}
              disabled={loading || rebuilding}
            />
            <Button label="Reindex local" kind="ghost" onPress={() => void rebuildIndex()} disabled={loading || rebuilding} />
          </View>

          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            <Text variant="caption" style={{ color: colors.slate }}>
              {hasEnoughChars
                ? `${results.length}/${total} résultats - ${elapsedMs} ms`
                : 'Saisir au moins 2 caractères pour lancer la recherche.'}
            </Text>
            <Text variant="caption" style={{ color: colors.slate }}>
              Sync outbox: {syncStatus.queueDepth}
            </Text>
          </View>

          {info ? (
            <Text variant="caption" style={{ marginTop: spacing.sm, color: colors.tealDark }}>
              {info}
            </Text>
          ) : null}

          {error ? (
            <Text variant="caption" style={{ marginTop: spacing.sm, color: colors.rose }}>
              {error}
            </Text>
          ) : null}
        </Card>

        {loading ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <ActivityIndicator size="small" color={colors.teal} />
              <Text variant="body" style={{ color: colors.slate }}>
                Recherche en cours...
              </Text>
            </View>
          </Card>
        ) : null}

        {!loading && hasEnoughChars && groupedResults.length === 0 ? (
          <Card>
            <Text variant="body" style={{ color: colors.slate }}>
              Aucun résultat pour cette requête.
            </Text>
          </Card>
        ) : null}

        {!loading && !hasEnoughChars ? (
          <Card>
            <Text variant="body" style={{ color: colors.slate }}>
              Suggestions: "permis feu", "doe", "preuve", "controle", "bloqué".
            </Text>
          </Card>
        ) : null}

        {groupedResults.map((group) => (
          <Card key={group.entity}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Text variant="h2">{ENTITY_LABELS[group.entity]}</Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  {ENTITY_HINTS[group.entity]}
                </Text>
              </View>

              <View
                style={{
                  borderRadius: radii.pill,
                  backgroundColor: colors.sand,
                  borderWidth: 1,
                  borderColor: colors.fog,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs
                }}
              >
                <Text variant="caption">{group.items.length}</Text>
              </View>
            </View>

            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              {group.items.map((item) => (
                <View
                  key={item.id}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.white
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                    <View
                      style={{
                        borderRadius: radii.pill,
                        borderWidth: 1,
                        borderColor: colors.fog,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: spacing.xs,
                        backgroundColor: colors.sand
                      }}
                    >
                      <Text variant="caption">score {Math.round(item.score)}</Text>
                    </View>

                    <Text variant="caption" style={{ color: colors.slate }}>
                      {formatDate(item.updated_at)}
                    </Text>
                  </View>

                  <View style={{ marginTop: spacing.xs }}>
                    <HighlightedText value={item.title_highlight || item.title} title />
                  </View>

                  <View style={{ marginTop: spacing.xs }}>
                    <HighlightedText value={item.body_highlight || item.body} />
                  </View>

                  {item.tags.length > 0 ? (
                    <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {item.tags.slice(0, 5).map((tag) => (
                        <View
                          key={`${item.id}-${tag}`}
                          style={{
                            borderRadius: radii.pill,
                            backgroundColor: `${colors.teal}14`,
                            borderWidth: 1,
                            borderColor: `${colors.teal}44`,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: spacing.xs
                          }}
                        >
                          <Text variant="caption" style={{ color: colors.tealDark }}>
                            {tag}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </Card>
        ))}

        {hasEnoughChars && hasMore ? (
          <Card>
            {loadingMore ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <ActivityIndicator size="small" color={colors.teal} />
                <Text variant="body" style={{ color: colors.slate }}>
                  Chargement des résultats suivants...
                </Text>
              </View>
            ) : (
              <Button label="Charger plus" kind="ghost" onPress={() => void loadMore()} />
            )}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
