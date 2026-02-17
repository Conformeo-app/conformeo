import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { backup, BackupImportMode, BackupRecord } from '../../data/backup-restore';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

function formatBytes(size?: number) {
  if (!size || size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('fr-FR');
}

export function BackupScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();

  const [items, setItems] = useState<BackupRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasOrg = Boolean(activeOrgId && user?.id);

  useEffect(() => {
    backup.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
  }, [activeOrgId, user?.id]);

  const refresh = useCallback(async () => {
    if (!hasOrg) {
      setItems([]);
      return;
    }

    try {
      const list = await backup.list();
      setItems(list);
    } catch (listError) {
      const message = listError instanceof Error ? listError.message : 'Chargement backups impossible.';
      setError(message);
    }
  }, [hasOrg]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withBusy = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await task();
        await refresh();
      } catch (taskError) {
        const message = taskError instanceof Error ? taskError.message : 'Operation sauvegarde echouee.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const exportBackup = useCallback(
    (includeMedia: boolean) => {
      if (!hasOrg) {
        setError('Session invalide: utilisateur ou organisation absente.');
        return;
      }

      void withBusy(async () => {
        await backup.exportAll({ includeMedia });
      });
    },
    [hasOrg, withBusy]
  );

  const pickZipFile = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed', 'application/*', '*/*'],
      multiple: false,
      copyToCacheDirectory: true
    });

    if (picked.canceled) {
      return null;
    }

    const asset = picked.assets?.[0];
    if (!asset?.uri) {
      return null;
    }

    if (asset.name && !asset.name.toLowerCase().endsWith('.zip')) {
      throw new Error('Fichier invalide: .zip requis.');
    }

    return asset.uri;
  }, []);

  const runImport = useCallback(
    (mode: BackupImportMode) => {
      if (!hasOrg) {
        setError('Session invalide: utilisateur ou organisation absente.');
        return;
      }

      void withBusy(async () => {
        const uri = await pickZipFile();
        if (!uri) return;

        if (mode === 'REPLACE') {
          const ok = await new Promise<boolean>((resolve) => {
            Alert.alert(
              'Importer (écraser)',
              "Cette action remplace les données locales pour l'organisation active. Continuer ?",
              [
                { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Écraser', style: 'destructive', onPress: () => resolve(true) }
              ]
            );
          });
          if (!ok) return;
        }

        await backup.import(uri, { mode });
      });
    },
    [hasOrg, pickZipFile, withBusy]
  );

  const shareBackup = useCallback(
    (record: BackupRecord) => {
      const path = record.path;
      if (!path) {
        setError('Backup sans fichier (path manquant).');
        return;
      }

      void withBusy(async () => {
        const available = await Sharing.isAvailableAsync();
        if (!available) {
          throw new Error('Partage indisponible sur cet appareil.');
        }
        await Sharing.shareAsync(path, {
          mimeType: 'application/zip',
          dialogTitle: 'Partager la sauvegarde'
        });
      });
    },
    [withBusy]
  );

  const deleteBackup = useCallback(
    (record: BackupRecord) => {
      void withBusy(async () => {
        await backup.delete(record.id);
      });
    },
    [withBusy]
  );

  const runningCount = useMemo(() => items.filter((item) => item.status === 'RUNNING').length, [items]);

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }}>
        <SectionHeader
          title="Sauvegarde / Restauration"
          subtitle="Export ZIP local (JSON + manifest + medias optionnels) et import controle (merge ou ecrase)."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Actions</Text>
            {!hasOrg ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
                Connecte-toi et sélectionne une organisation active pour activer les backups.
              </Text>
            ) : (
              <>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  Backups: {items.length} • running: {runningCount}
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button label="Exporter (sans médias)" onPress={() => exportBackup(false)} disabled={busy} />
                  <Button label="Exporter (avec médias)" kind="ghost" onPress={() => exportBackup(true)} disabled={busy} />
                  <Button label="Importer (merge)" kind="ghost" onPress={() => runImport('MERGE')} disabled={busy} />
                  <Button label="Importer (écrase)" kind="ghost" onPress={() => runImport('REPLACE')} disabled={busy} />
                  <Button label="Rafraîchir" kind="ghost" onPress={() => void refresh()} disabled={busy} />
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

            {error ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}
          </Card>

          <Card>
            <Text variant="h2">Historique (max 50)</Text>
            {items.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Aucun backup.
              </Text>
            ) : (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {items.map((item) => (
                  <View
                    key={item.id}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.fog,
                      borderRadius: radii.md,
                      padding: spacing.md
                    }}
                  >
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {item.status} • {formatBytes(item.size_bytes)} • {item.include_media ? 'avec médias' : 'sans médias'}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
                      {formatDate(item.created_at)} • {item.id}
                    </Text>
                    {item.last_error ? (
                      <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }} numberOfLines={2}>
                        {item.last_error}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                      <Button
                        label="Partager"
                        onPress={() => shareBackup(item)}
                        disabled={busy || !item.path || item.status !== 'DONE'}
                      />
                      <Button label="Supprimer" kind="ghost" onPress={() => deleteBackup(item)} disabled={busy} />
                    </View>
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
