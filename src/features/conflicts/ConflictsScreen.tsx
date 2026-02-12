import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import {
  ConflictPolicy,
  ConflictPolicyRecord,
  ConflictResolutionAction,
  SyncConflict,
  conflicts
} from '../../data';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const POLICY_VALUES: ConflictPolicy[] = ['LWW', 'SERVER_WINS', 'MANUAL'];

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

function toPrettyJson(value: unknown, max = 3000) {
  const serialized = JSON.stringify(value ?? {}, null, 2);
  if (serialized.length <= max) {
    return serialized;
  }

  return `${serialized.slice(0, max)}\n...`;
}

export function ConflictsScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus, syncNow } = useSyncStatus();

  const [openConflicts, setOpenConflicts] = useState<SyncConflict[]>([]);
  const [policies, setPolicies] = useState<ConflictPolicyRecord[]>([]);

  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);

  const [policyEntity, setPolicyEntity] = useState('');
  const [mergePayloadDraft, setMergePayloadDraft] = useState('{}');

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selectedConflict = useMemo(
    () => openConflicts.find((item) => item.id === selectedConflictId) ?? null,
    [openConflicts, selectedConflictId]
  );

  const refresh = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setOpenConflicts([]);
      setPolicies([]);
      setSelectedConflictId(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextConflicts, nextPolicies] = await Promise.all([conflicts.listOpen({ limit: 200 }), conflicts.listPolicies()]);

      setOpenConflicts(nextConflicts);
      setPolicies(nextPolicies);

      setSelectedConflictId((current) => {
        if (!current) {
          return nextConflicts[0]?.id ?? null;
        }

        if (nextConflicts.some((item) => item.id === current)) {
          return current;
        }

        return nextConflicts[0]?.id ?? null;
      });
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, user?.id]);

  useEffect(() => {
    conflicts.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
  }, [activeOrgId, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedConflict) {
      return;
    }

    setPolicyEntity(selectedConflict.entity);
    setMergePayloadDraft(toPrettyJson(selectedConflict.local_payload, 5000));
  }, [selectedConflict]);

  const withBusy = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await task();
      await refresh();
    } catch (taskError) {
      setError(toErrorMessage(taskError));
    } finally {
      setBusy(false);
    }
  };

  const resolveSelected = useCallback(
    async (action: ConflictResolutionAction) => {
      if (!selectedConflict) {
        setError('Aucun conflit sélectionné.');
        return;
      }

      await withBusy(async () => {
        if (action === 'MERGE') {
          const parsed = JSON.parse(mergePayloadDraft) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Payload merge invalide: objet JSON attendu.');
          }

          await conflicts.resolve(selectedConflict.id, 'MERGE', parsed as Record<string, unknown>);
        } else {
          await conflicts.resolve(selectedConflict.id, action);
        }

        if (action !== 'KEEP_SERVER') {
          await syncNow();
        }

        setInfo(`Conflit résolu (${action}).`);
      });
    },
    [mergePayloadDraft, selectedConflict, syncNow]
  );

  const savePolicy = useCallback(
    async (policy: ConflictPolicy) => {
      const entity = policyEntity.trim();
      if (!entity) {
        setError('Entité requise pour définir une policy.');
        return;
      }

      await withBusy(async () => {
        await conflicts.setPolicy(entity, policy);
        setInfo(`Policy ${policy} enregistrée pour ${entity}.`);
      });
    },
    [policyEntity]
  );

  const openCount = openConflicts.length;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Conflits Sync"
          subtitle="Journal des conflits, policies et résolution explicite (jamais silencieuse)."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Etat</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Conflits ouverts: {openCount}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Sync: {syncStatus.phase} • Queue: {syncStatus.queueDepth}
            </Text>

            <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Button label="Rafraîchir" kind="ghost" onPress={() => void refresh()} disabled={loading || busy} />
              <Button label="Sync maintenant" kind="ghost" onPress={() => void syncNow()} disabled={busy} />
            </View>

            {loading ? (
              <View style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <ActivityIndicator size="small" color={colors.teal} />
                <Text variant="caption" style={{ color: colors.slate }}>
                  Chargement des conflits...
                </Text>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text variant="h2">Policies</Text>

            <TextInput
              value={policyEntity}
              onChangeText={setPolicyEntity}
              placeholder="entity (ex: tasks)"
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

            <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {POLICY_VALUES.map((policy) => (
                <Button
                  key={policy}
                  label={policy}
                  kind="ghost"
                  onPress={() => void savePolicy(policy)}
                  disabled={busy}
                />
              ))}
            </View>

            <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
              {policies.map((item) => (
                <Text key={`${item.entity}-${item.policy}`} variant="caption" style={{ color: colors.slate }}>
                  {item.entity}: {item.policy} • {formatDate(item.updated_at)}
                </Text>
              ))}
              {policies.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune policy personnalisée (LWW par défaut).
                </Text>
              ) : null}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Journal OPEN</Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              {openConflicts.map((item) => {
                const selected = item.id === selectedConflictId;

                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setSelectedConflictId(item.id)}
                    style={{
                      borderWidth: 1,
                      borderColor: selected ? colors.teal : colors.fog,
                      borderRadius: radii.md,
                      backgroundColor: selected ? `${colors.teal}14` : colors.white,
                      padding: spacing.md
                    }}
                  >
                    <Text variant="bodyStrong">
                      {item.entity} • {item.entity_id}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      Policy: {item.policy} • {formatDate(item.created_at)}
                    </Text>
                    {item.reason ? (
                      <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
                        {item.reason}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}

              {openConflicts.length === 0 ? (
                <Text variant="body" style={{ color: colors.slate }}>
                  Aucun conflit ouvert.
                </Text>
              ) : null}
            </View>
          </Card>

          {selectedConflict ? (
            <Card>
              <Text variant="h2">Résolution</Text>

              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                {selectedConflict.entity} / {selectedConflict.entity_id}
              </Text>

              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                operation: {selectedConflict.operation_id} ({selectedConflict.operation_type})
              </Text>

              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                policy active: {selectedConflict.policy}
              </Text>

              <Text variant="bodyStrong" style={{ marginTop: spacing.sm }}>
                Local payload
              </Text>
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                {toPrettyJson(selectedConflict.local_payload, 2000)}
              </Text>

              <Text variant="bodyStrong" style={{ marginTop: spacing.sm }}>
                Server payload
              </Text>
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                {toPrettyJson(selectedConflict.server_payload, 2000)}
              </Text>

              <Text variant="bodyStrong" style={{ marginTop: spacing.sm }}>
                Merge payload (v1)
              </Text>
              <TextInput
                value={mergePayloadDraft}
                onChangeText={setMergePayloadDraft}
                multiline
                numberOfLines={8}
                textAlignVertical="top"
                placeholder="JSON merge"
                placeholderTextColor={colors.slate}
                style={{
                  marginTop: spacing.xs,
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  backgroundColor: colors.white,
                  color: colors.ink,
                  minHeight: 160
                }}
              />

              <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <Button label="Garder local" onPress={() => void resolveSelected('KEEP_LOCAL')} disabled={busy} />
                <Button label="Garder serveur" kind="ghost" onPress={() => void resolveSelected('KEEP_SERVER')} disabled={busy} />
                <Button label="Merge" kind="ghost" onPress={() => void resolveSelected('MERGE')} disabled={busy} />
              </View>
            </Card>
          ) : null}

          {info ? (
            <Text variant="caption" style={{ color: colors.tealDark }}>
              {info}
            </Text>
          ) : null}

          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
