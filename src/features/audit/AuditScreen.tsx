import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { audit, AuditLogEntry } from '../../data/audit-compliance';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Erreur inconnue';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR');
}

function shortValue(value: string | null | undefined) {
  if (!value) {
    return '-';
  }
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 24)}...`;
}

export function AuditScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();

  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const hasContext = Boolean(activeOrgId && user?.id);

  const inputStyle = useMemo(
    () =>
      ({
        borderWidth: 1,
        borderColor: colors.fog,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        color: colors.ink,
        backgroundColor: colors.white
      }) as const,
    [colors.fog, colors.ink, colors.white, radii.md, spacing.md, spacing.sm]
  );

  useEffect(() => {
    audit.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
  }, [activeOrgId, user?.id]);

  const refresh = useCallback(async () => {
    if (!hasContext) {
      setRows([]);
      return;
    }

    const action = actionFilter.trim();
    const entity = entityFilter.trim();

    const data = await audit.list({
      action: action.length > 0 ? action : undefined,
      entity: entity.length > 0 ? entity : undefined,
      limit: 200
    });

    setRows(data);
  }, [actionFilter, entityFilter, hasContext]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withBusy = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      setInfo(null);

      try {
        await task();
      } catch (taskError) {
        setError(toErrorMessage(taskError));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const exportAudit = useCallback(async () => {
    if (!hasContext) {
      setError('Session invalide: org/user manquants.');
      return;
    }

    await withBusy(async () => {
      const action = actionFilter.trim();
      const entity = entityFilter.trim();

      const exported = await audit.export({
        action: action.length > 0 ? action : undefined,
        entity: entity.length > 0 ? entity : undefined,
        limit: 1000
      });

      setInfo(`Export audit cree (${exported.count} ligne(s)).`);

      const sharingAvailable = await Sharing.isAvailableAsync();
      if (sharingAvailable) {
        await Sharing.shareAsync(exported.path, {
          mimeType: 'application/json',
          dialogTitle: 'Partager audit compliance'
        });
      }
    });
  }, [actionFilter, entityFilter, hasContext, withBusy]);

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <SectionHeader
          title="Audit conformité"
          subtitle="Traçabilité des actions sensibles (multi-tenant, exportable, offline-first)."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Filtres</Text>
            {!hasContext ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
                Connecte-toi et sélectionne une organisation active pour consulter les audits.
              </Text>
            ) : (
              <>
                <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                  <TextInput
                    value={actionFilter}
                    onChangeText={setActionFilter}
                    placeholder="Action (ex: document.soft_delete)"
                    placeholderTextColor={colors.slate}
                    style={inputStyle}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TextInput
                    value={entityFilter}
                    onChangeText={setEntityFilter}
                    placeholder="Entite (ex: DOCUMENT, SIGNATURE)"
                    placeholderTextColor={colors.slate}
                    style={inputStyle}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                  <Button label="Rafraichir" onPress={() => void withBusy(refresh)} disabled={busy} />
                  <Button label="Exporter JSON" kind="ghost" onPress={() => void exportAudit()} disabled={busy} />
                </View>
              </>
            )}

            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                <ActivityIndicator size="small" color={colors.teal} />
                <Text variant="caption" style={{ color: colors.slate }}>
                  Traitement en cours...
                </Text>
              </View>
            ) : null}

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
          </Card>

          <Card>
            <Text variant="h2">Journal ({rows.length})</Text>
            {rows.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Aucun log audit.
              </Text>
            ) : (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {rows.map((row) => (
                  <View
                    key={`${row.id}-${row.created_at}`}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.fog,
                      borderRadius: radii.md,
                      padding: spacing.md
                    }}
                  >
                    <Text variant="bodyStrong">
                      {row.action} · {row.entity}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      {formatDate(row.created_at)} · id:{shortValue(row.id)} · entity_id:{shortValue(row.entity_id)}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      user:{shortValue(row.user_id)} · source:{row.source}
                      {row.pending_remote ? ' · pending remote' : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

