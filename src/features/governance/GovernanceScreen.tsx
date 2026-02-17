import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import {
  AnonymizeUserResult,
  PortableDataExportResult,
  RetentionApplyResult,
  RetentionEntity,
  RetentionPolicy,
  governance
} from '../../data/data-governance';
import { DeleteOrgResult } from '../../data/super-admin';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue';
}

function normalizeText(value: string) {
  return value.trim();
}

function formatDate(value?: string) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('fr-FR');
}

type BusyKey =
  | 'load'
  | 'set_policy'
  | 'apply_retention'
  | 'export_portable'
  | 'anonymize_user'
  | 'delete_org'
  | null;

export function GovernanceScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user, role } = useAuth();

  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [policyDrafts, setPolicyDrafts] = useState<Record<RetentionEntity, string>>({
    AUDIT_LOGS: '3650',
    EXPORT_JOBS: '365',
    DELETED_TASKS: '365',
    DELETED_DOCUMENTS: '365',
    RECENTS: '180',
    OPERATIONS_SYNCED: '30'
  });

  const [busy, setBusy] = useState<BusyKey>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [retentionResult, setRetentionResult] = useState<RetentionApplyResult | null>(null);
  const [portableResult, setPortableResult] = useState<PortableDataExportResult | null>(null);
  const [anonymizeResult, setAnonymizeResult] = useState<AnonymizeUserResult | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteOrgResult | null>(null);

  const [anonymizeUserId, setAnonymizeUserId] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const expectedDeleteConfirmation = useMemo(() => {
    if (!activeOrgId) {
      return 'DELETE <org_id>';
    }
    return `DELETE ${activeOrgId}`;
  }, [activeOrgId]);

  const loadPolicies = useCallback(async () => {
    if (!activeOrgId) {
      setPolicies([]);
      return;
    }

    setBusy('load');
    setError(null);

    try {
      const rows = await governance.listPolicies(activeOrgId);
      setPolicies(rows);
      setPolicyDrafts((previous) => {
        const next = { ...previous };
        for (const row of rows) {
          next[row.entity] = String(row.retention_days);
        }
        return next;
      });
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setBusy(null);
    }
  }, [activeOrgId]);

  useEffect(() => {
    governance.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
    void loadPolicies();
  }, [activeOrgId, loadPolicies, user?.id]);

  const savePolicy = useCallback(
    async (entity: RetentionEntity) => {
      const raw = normalizeText(policyDrafts[entity] ?? '');
      const days = Number(raw);

      if (!Number.isFinite(days)) {
        setError(`Valeur invalide pour ${entity}.`);
        return;
      }

      setBusy('set_policy');
      setError(null);
      setInfo(null);

      try {
        const saved = await governance.setPolicy(entity, days);
        setPolicies((previous) => {
          const others = previous.filter((row) => row.entity !== entity);
          return [...others, saved].sort((left, right) => left.entity.localeCompare(right.entity));
        });
        setPolicyDrafts((previous) => ({ ...previous, [entity]: String(saved.retention_days) }));
        setInfo(`Politique ${entity} mise à jour (${saved.retention_days} jours).`);
      } catch (saveError) {
        setError(toErrorMessage(saveError));
      } finally {
        setBusy(null);
      }
    },
    [policyDrafts]
  );

  const runRetention = useCallback(async () => {
    setBusy('apply_retention');
    setError(null);
    setInfo(null);

    try {
      const result = await governance.applyRetention();
      setRetentionResult(result);
      setInfo(`Rétention appliquée. ${result.total_deleted_rows} lignes supprimées.`);
      await loadPolicies();
    } catch (runError) {
      setError(toErrorMessage(runError));
    } finally {
      setBusy(null);
    }
  }, [loadPolicies]);

  const runPortableExport = useCallback(async () => {
    if (!activeOrgId) {
      setError('Organisation active manquante.');
      return;
    }

    setBusy('export_portable');
    setError(null);
    setInfo(null);

    try {
      const result = await governance.exportPortableData(activeOrgId);
      setPortableResult(result);
      setInfo(`Export RGPD généré (${result.rows} lignes).`);
    } catch (exportError) {
      setError(toErrorMessage(exportError));
    } finally {
      setBusy(null);
    }
  }, [activeOrgId]);

  const runAnonymization = useCallback(async () => {
    const targetUserId = normalizeText(anonymizeUserId);
    if (!targetUserId) {
      setError('Renseigne un user_id à anonymiser.');
      return;
    }

    setBusy('anonymize_user');
    setError(null);
    setInfo(null);

    try {
      const result = await governance.anonymizeDeletedUser(targetUserId);
      setAnonymizeResult(result);
      setInfo(`Anonymisation appliquée sur ${targetUserId}.`);
    } catch (anonymizeError) {
      setError(toErrorMessage(anonymizeError));
    } finally {
      setBusy(null);
    }
  }, [anonymizeUserId]);

  const runDeleteOrg = useCallback(() => {
    if (!activeOrgId) {
      setError('Organisation active manquante.');
      return;
    }

    const confirmation = normalizeText(deleteConfirmation);
    if (confirmation !== expectedDeleteConfirmation) {
      setError(`Confirmation invalide. Saisis exactement: ${expectedDeleteConfirmation}`);
      return;
    }

    Alert.alert(
      'Suppression organisation',
      "Cette action est irréversible. Toutes les données org seront supprimées côté backend.",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy('delete_org');
              setError(null);
              setInfo(null);
              try {
                const result = await governance.deleteOrganization(activeOrgId, confirmation);
                setDeleteResult(result);
                setInfo(`Organisation supprimée (${result.storage_objects_deleted} objets storage nettoyés).`);
              } catch (deleteError) {
                setError(toErrorMessage(deleteError));
              } finally {
                setBusy(null);
              }
            })();
          }
        }
      ]
    );
  }, [activeOrgId, deleteConfirmation, expectedDeleteConfirmation]);

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.fog,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    color: colors.ink
  } as const;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <SectionHeader
          title="Data Governance"
          subtitle="Rétention, purge, RGPD, anonymisation et suppression org contrôlée."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Contexte</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              org_id: {activeOrgId ?? '—'}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              user_id: {user?.id ?? '—'}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              role: {role ?? '—'}
            </Text>
            {info ? (
              <Text variant="caption" style={{ color: colors.teal, marginTop: spacing.sm }}>
                {info}
              </Text>
            ) : null}
            {error ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}
            <View style={{ marginTop: spacing.sm }}>
              <Button label="Rafraîchir les politiques" kind="ghost" onPress={() => void loadPolicies()} disabled={busy !== null} />
            </View>
          </Card>

          <Card>
            <Text variant="h2">Politiques de rétention</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Politique configurable par entité (en jours).
            </Text>

            <View style={{ marginTop: spacing.md, gap: spacing.md }}>
              {policies.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune politique chargée.
                </Text>
              ) : (
                policies.map((policy) => (
                  <Card key={policy.entity}>
                    <Text variant="bodyStrong">{policy.entity}</Text>
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      Source: {policy.source} • MAJ: {formatDate(policy.updated_at)}
                    </Text>
                    <TextInput
                      value={policyDrafts[policy.entity] ?? String(policy.retention_days)}
                      onChangeText={(value) => setPolicyDrafts((previous) => ({ ...previous, [policy.entity]: value }))}
                      keyboardType="number-pad"
                      placeholder="Jours"
                      placeholderTextColor={colors.slate}
                      style={[inputStyle, { marginTop: spacing.sm }]}
                    />
                    <View style={{ marginTop: spacing.sm }}>
                      <Button
                        label="Enregistrer"
                        kind="ghost"
                        onPress={() => void savePolicy(policy.entity)}
                        disabled={busy !== null}
                      />
                    </View>
                  </Card>
                ))
              )}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Actions RGPD</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Appliquer la rétention" onPress={() => void runRetention()} disabled={busy !== null || !activeOrgId} />
              <Button
                label="Exporter données portables"
                kind="ghost"
                onPress={() => void runPortableExport()}
                disabled={busy !== null || !activeOrgId}
              />
            </View>

            {retentionResult ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Dernière purge: {formatDate(retentionResult.applied_at)} • lignes: {retentionResult.total_deleted_rows} • fichiers:{' '}
                  {retentionResult.total_deleted_files}
                </Text>
              </View>
            ) : null}

            {portableResult ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Export: {portableResult.path}
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  Tables: {portableResult.tables} • Lignes: {portableResult.rows} • Taille: {portableResult.size_bytes} bytes
                </Text>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text variant="h2">Anonymisation utilisateur</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Remplace les références sensibles pour un utilisateur supprimé.
            </Text>
            <TextInput
              value={anonymizeUserId}
              onChangeText={setAnonymizeUserId}
              autoCapitalize="none"
              placeholder="user_id à anonymiser"
              placeholderTextColor={colors.slate}
              style={[inputStyle, { marginTop: spacing.sm }]}
            />
            <View style={{ marginTop: spacing.sm }}>
              <Button label="Lancer anonymisation" kind="ghost" onPress={() => void runAnonymization()} disabled={busy !== null || !activeOrgId} />
            </View>

            {anonymizeResult ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Alias: {anonymizeResult.alias}
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  Remote: {anonymizeResult.remote_applied ? 'OK' : `N/A (${anonymizeResult.remote_error ?? 'indisponible'})`}
                </Text>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text variant="h2">Zone dangereuse</Text>
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
              Suppression complète organisation (super-admin + MFA requis).
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Saisis: {expectedDeleteConfirmation}
            </Text>
            <TextInput
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              autoCapitalize="characters"
              placeholder={expectedDeleteConfirmation}
              placeholderTextColor={colors.slate}
              style={[inputStyle, { marginTop: spacing.sm }]}
            />
            <View style={{ marginTop: spacing.sm }}>
              <Button
                label="Supprimer l'organisation"
                kind="ghost"
                onPress={runDeleteOrg}
                disabled={busy !== null || !activeOrgId}
              />
            </View>

            {deleteResult ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Supprimée le {formatDate(deleteResult.deleted_at)} • objets storage supprimés: {deleteResult.storage_objects_deleted}
              </Text>
            ) : null}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

