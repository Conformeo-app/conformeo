import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import {
  FavoriteRecord,
  QuickAction,
  TemplateRecord,
  TemplateType,
  UxEntity,
  applyQuickAction,
  templates,
  ux
} from '../../data';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const ORG_SCOPE = '__ORG__';
const ENTITY_CHOICES: UxEntity[] = ['PROJECT', 'TASK', 'DOCUMENT', 'MEDIA', 'EXPORT', 'CHECKLIST', 'TEMPLATE'];
const TEMPLATE_TYPES: TemplateType[] = ['TASK', 'CHECKLIST', 'EXPORT'];

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

function defaultTemplatePayload(type: TemplateType) {
  if (type === 'TASK') {
    return JSON.stringify(
      {
        title: 'Contrôle sécurité zone A',
        status: 'TODO',
        priority: 'HIGH',
        tags: ['safety', 'terrain'],
        with_photo: false
      },
      null,
      2
    );
  }

  if (type === 'CHECKLIST') {
    return JSON.stringify(
      {
        checked_keys: ['epi_ok'],
        comments_by_key: {
          epi_ok: 'Vérifié sur zone principale'
        }
      },
      null,
      2
    );
  }

  return JSON.stringify(
    {
      export_type: 'REPORT_PDF'
    },
    null,
    2
  );
}

function quickActionLabel(action: QuickAction) {
  return `${action.label} (${action.max_taps} taps max)`;
}

export function UxAcceleratorsScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user, role } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [projectScope, setProjectScope] = useState<string>(ORG_SCOPE);
  const [projects, setProjects] = useState<string[]>([]);

  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);
  const [recents, setRecents] = useState<Array<{ entity: UxEntity; entity_id: string; last_opened_at: string }>>([]);

  const [templateTypeFilter, setTemplateTypeFilter] = useState<TemplateType>('TASK');
  const [templatesList, setTemplatesList] = useState<TemplateRecord[]>([]);

  const [favoriteEntity, setFavoriteEntity] = useState<UxEntity>('PROJECT');
  const [favoriteEntityId, setFavoriteEntityId] = useState('');

  const [templateName, setTemplateName] = useState('');
  const [templatePayloadDraft, setTemplatePayloadDraft] = useState(defaultTemplatePayload('TASK'));

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selectedProject = projectScope === ORG_SCOPE ? undefined : projectScope;

  const filteredTemplates = useMemo(
    () => templatesList.filter((item) => item.type === templateTypeFilter),
    [templateTypeFilter, templatesList]
  );

  useEffect(() => {
    ux.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined,
      project_id: selectedProject
    });
  }, [activeOrgId, selectedProject, user?.id]);

  const refreshQuickActions = useCallback(async () => {
    const next = await ux.getQuickActions(role ?? 'FIELD');
    setQuickActions(next);
  }, [role]);

  const refreshProjects = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setProjects([]);
      setProjectScope(ORG_SCOPE);
      return;
    }

    const list = await ux.listProjects();
    setProjects(list);

    setProjectScope((current) => {
      if (current === ORG_SCOPE) {
        return current;
      }

      if (list.includes(current)) {
        return current;
      }

      return ORG_SCOPE;
    });
  }, [activeOrgId, user?.id]);

  const refreshLists = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setFavorites([]);
      setRecents([]);
      setTemplatesList([]);
      return;
    }

    const [nextFavorites, nextRecents, nextTemplates] = await Promise.all([
      ux.listFavorites(),
      ux.listRecents(30),
      templates.list()
    ]);

    setFavorites(nextFavorites);
    setRecents(nextRecents);
    setTemplatesList(nextTemplates);
  }, [activeOrgId, user?.id]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await Promise.all([refreshQuickActions(), refreshProjects(), refreshLists()]);
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [refreshLists, refreshProjects, refreshQuickActions]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await action();
      await refreshLists();
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const runQuickAction = useCallback(
    async (action: QuickAction) => {
      if (!activeOrgId || !user?.id) {
        setError('Session invalide.');
        return;
      }

      if (action.requires_project && !selectedProject) {
        setError('Sélectionne un chantier pour cette action rapide.');
        return;
      }

      await withBusy(async () => {
        const result = await applyQuickAction(action.key, {
          projectId: selectedProject
        });

        setInfo(result.message);
      });
    },
    [activeOrgId, selectedProject, user?.id]
  );

  const addFavorite = useCallback(async () => {
    const cleanId = favoriteEntityId.trim();
    if (!cleanId) {
      setError('entity_id requis.');
      return;
    }

    await withBusy(async () => {
      const next = await ux.addFavorite(favoriteEntity, cleanId);
      setFavoriteEntityId('');
      setInfo(`Favori ajouté: ${next.entity} / ${next.entity_id}`);
    });
  }, [favoriteEntity, favoriteEntityId]);

  const addSelectedProjectFavorite = useCallback(async () => {
    if (!selectedProject) {
      setError('Sélectionne un chantier.');
      return;
    }

    await withBusy(async () => {
      await ux.addFavorite('PROJECT', selectedProject);
      setInfo('Chantier ajouté aux favoris.');
    });
  }, [selectedProject]);

  const removeFavorite = useCallback(async (favorite: FavoriteRecord) => {
    await withBusy(async () => {
      await ux.removeFavorite(favorite.entity, favorite.entity_id);
      setInfo('Favori supprimé.');
    });
  }, []);

  const createTemplate = useCallback(async () => {
    await withBusy(async () => {
      let payload: Record<string, unknown> = {};

      const parsed = JSON.parse(templatePayloadDraft) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      } else {
        throw new Error('Payload JSON invalide: objet attendu.');
      }

      if (templateName.trim().length > 0) {
        payload.name = templateName.trim();
      }

      const created = await templates.create(templateTypeFilter, payload);
      setTemplateName('');
      setInfo(`Template créé: ${created.name} v${created.version}`);
    });
  }, [templateName, templatePayloadDraft, templateTypeFilter]);

  const applyTemplate = useCallback(async (item: TemplateRecord) => {
    await withBusy(async () => {
      const result = await templates.apply(item.type, item.id);
      setInfo(result.message);
    });
  }, []);

  useEffect(() => {
    setTemplatePayloadDraft(defaultTemplatePayload(templateTypeFilter));
    setTemplateName('');
  }, [templateTypeFilter]);

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
          title="UX Accelerators"
          subtitle="Quick actions, favoris, récents, templates. Cible: 3 taps max, offline-first."
        />

        <Card>
          <Text variant="h2">Contexte</Text>
          <Text variant="caption" style={{ marginTop: spacing.xs, color: colors.slate }}>
            Rôle: {role ?? 'FIELD'} • Sync queue: {syncStatus.queueDepth}
          </Text>

          <Text variant="caption" style={{ marginTop: spacing.sm, color: colors.slate }}>
            Scope chantier
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ marginTop: spacing.xs, gap: spacing.xs }}
          >
            <Pressable
              onPress={() => setProjectScope(ORG_SCOPE)}
              style={{
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: projectScope === ORG_SCOPE ? colors.teal : colors.fog,
                backgroundColor: projectScope === ORG_SCOPE ? `${colors.teal}22` : colors.white,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs
              }}
            >
              <Text variant="caption">Entreprise</Text>
            </Pressable>

            {projects.map((projectId) => {
              const active = projectId === projectScope;

              return (
                <Pressable
                  key={projectId}
                  onPress={() => setProjectScope(projectId)}
                  style={{
                    borderRadius: radii.pill,
                    borderWidth: 1,
                    borderColor: active ? colors.teal : colors.fog,
                    backgroundColor: active ? `${colors.teal}22` : colors.white,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs
                  }}
                >
                  <Text variant="caption">{projectId}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button label="Rafraîchir" kind="ghost" onPress={() => void refreshAll()} disabled={busy || loading} />
            <Button label="Favori chantier" kind="ghost" onPress={() => void addSelectedProjectFavorite()} disabled={busy || !selectedProject} />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Quick Actions</Text>
          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            {quickActions.map((action) => (
              <View
                key={action.key}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  backgroundColor: colors.white
                }}
              >
                <Text variant="bodyStrong">{quickActionLabel(action)}</Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  {action.hint}
                </Text>
                <View style={{ marginTop: spacing.sm }}>
                  <Button
                    label="Exécuter"
                    kind="ghost"
                    onPress={() => void runQuickAction(action)}
                    disabled={busy || (action.requires_project && !selectedProject)}
                  />
                </View>
              </View>
            ))}

            {quickActions.length === 0 ? (
              <Text variant="body" style={{ color: colors.slate }}>
                Aucune quick action disponible pour ce rôle.
              </Text>
            ) : null}
          </View>
        </Card>

        <Card>
          <Text variant="h2">Favoris</Text>

          <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {ENTITY_CHOICES.map((entity) => {
              const active = favoriteEntity === entity;

              return (
                <Pressable
                  key={entity}
                  onPress={() => setFavoriteEntity(entity)}
                  style={{
                    borderRadius: radii.pill,
                    borderWidth: 1,
                    borderColor: active ? colors.teal : colors.fog,
                    backgroundColor: active ? `${colors.teal}22` : colors.white,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs
                  }}
                >
                  <Text variant="caption">{entity}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={favoriteEntityId}
            onChangeText={setFavoriteEntityId}
            placeholder="entity_id"
            placeholderTextColor={colors.slate}
            style={{
              marginTop: spacing.sm,
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              color: colors.ink
            }}
          />

          <View style={{ marginTop: spacing.sm }}>
            <Button label="Ajouter favori" onPress={() => void addFavorite()} disabled={busy} />
          </View>

          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            {favorites.map((item) => (
              <View
                key={`${item.entity}-${item.entity_id}`}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.sm,
                  backgroundColor: colors.white,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text variant="bodyStrong">{item.entity}</Text>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {item.entity_id} • {formatDate(item.created_at)}
                  </Text>
                </View>
                <Button label="Retirer" kind="ghost" onPress={() => void removeFavorite(item)} disabled={busy} />
              </View>
            ))}

            {favorites.length === 0 ? (
              <Text variant="body" style={{ color: colors.slate }}>
                Aucun favori.
              </Text>
            ) : null}
          </View>
        </Card>

        <Card>
          <Text variant="h2">Récents</Text>
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            {recents.map((item) => (
              <View
                key={`${item.entity}-${item.entity_id}`}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.sm,
                  backgroundColor: colors.white
                }}
              >
                <Text variant="bodyStrong">{item.entity}</Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  {item.entity_id} • {formatDate(item.last_opened_at)}
                </Text>
              </View>
            ))}

            {recents.length === 0 ? (
              <Text variant="body" style={{ color: colors.slate }}>
                Aucun récent.
              </Text>
            ) : null}
          </View>
        </Card>

        <Card>
          <Text variant="h2">Templates</Text>

          <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {TEMPLATE_TYPES.map((type) => {
              const active = templateTypeFilter === type;

              return (
                <Pressable
                  key={type}
                  onPress={() => setTemplateTypeFilter(type)}
                  style={{
                    borderRadius: radii.pill,
                    borderWidth: 1,
                    borderColor: active ? colors.teal : colors.fog,
                    backgroundColor: active ? `${colors.teal}22` : colors.white,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs
                  }}
                >
                  <Text variant="caption">{type}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={templateName}
            onChangeText={setTemplateName}
            placeholder="Nom template"
            placeholderTextColor={colors.slate}
            style={{
              marginTop: spacing.sm,
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              color: colors.ink
            }}
          />

          <TextInput
            value={templatePayloadDraft}
            onChangeText={setTemplatePayloadDraft}
            multiline
            numberOfLines={8}
            textAlignVertical="top"
            placeholder="Payload JSON"
            placeholderTextColor={colors.slate}
            style={{
              marginTop: spacing.sm,
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              color: colors.ink,
              minHeight: 150
            }}
          />

          <View style={{ marginTop: spacing.sm }}>
            <Button label="Créer template" onPress={() => void createTemplate()} disabled={busy} />
          </View>

          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            {filteredTemplates.map((item) => (
              <View
                key={item.id}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  backgroundColor: colors.white
                }}
              >
                <Text variant="bodyStrong">{item.name}</Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  {item.type} • {item.template_key} • v{item.version}
                </Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  {formatDate(item.created_at)}
                </Text>
                <View style={{ marginTop: spacing.sm }}>
                  <Button label="Appliquer" kind="ghost" onPress={() => void applyTemplate(item)} disabled={busy} />
                </View>
              </View>
            ))}

            {filteredTemplates.length === 0 ? (
              <Text variant="body" style={{ color: colors.slate }}>
                Aucun template {templateTypeFilter}.
              </Text>
            ) : null}
          </View>
        </Card>

        {(loading || busy) && !error ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <ActivityIndicator size="small" color={colors.teal} />
              <Text variant="body" style={{ color: colors.slate }}>
                Traitement en cours...
              </Text>
            </View>
          </Card>
        ) : null}

        {info ? (
          <Card>
            <Text variant="caption" style={{ color: colors.tealDark }}>
              {info}
            </Text>
          </Card>
        ) : null}

        {error ? (
          <Card>
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
