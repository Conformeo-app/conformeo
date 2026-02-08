import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { media, MediaAsset } from '../../data/media';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const DEMO_PROJECT_ID = 'chantier-media-demo';

function isPdf(asset: MediaAsset) {
  return asset.mime === 'application/pdf';
}

export function MediaScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId } = useAuth();
  const { status, syncNow } = useSyncStatus();

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const context = useMemo(
    () => ({
      org_id: activeOrgId ?? '',
      project_id: DEMO_PROJECT_ID,
      tag: 'chantier'
    }),
    [activeOrgId]
  );

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setAssets([]);
      return;
    }

    const next = await media.listLatestByOrg(activeOrgId, 300);
    setAssets(next);
  }, [activeOrgId]);

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
        const message = taskError instanceof Error ? taskError.message : 'Media pipeline error';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const onCapture = useCallback(() => {
    if (!activeOrgId) {
      setError('Compte sans organisation active.');
      return;
    }

    void withBusy(async () => {
      await media.capturePhoto(context);
    });
  }, [activeOrgId, context, withBusy]);

  const onImport = useCallback(() => {
    if (!activeOrgId) {
      setError('Compte sans organisation active.');
      return;
    }

    void withBusy(async () => {
      await media.importFiles(context);
    });
  }, [activeOrgId, context, withBusy]);

  const onSyncNow = useCallback(() => {
    void withBusy(async () => {
      await syncNow();
    });
  }, [syncNow, withBusy]);

  return (
    <Screen>
      <SectionHeader
        title="Pipeline medias"
        subtitle="Capture/import offline, optimisation locale, upload en arriere-plan."
      />

      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="h2">Etat pipeline</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Medias indexes: {assets.length}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Queue sync globale (outbox + media): {status.queueDepth}
          </Text>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
              {error}
            </Text>
          ) : null}
        </Card>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button label="Prendre photo" onPress={onCapture} disabled={busy} />
          <Button label="Importer fichiers" kind="ghost" onPress={onImport} disabled={busy} />
          <Button label="Sync maintenant" onPress={onSyncNow} disabled={busy} />
          <Button label="Rafraichir" kind="ghost" onPress={() => void refresh()} disabled={busy} />
        </View>

        <FlatList
          data={assets}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}
          renderItem={({ item }) => (
            <Card style={{ flex: 1, minHeight: 210 }}>
              {item.local_thumb_path && !isPdf(item) ? (
                <View style={{ position: 'relative', marginBottom: spacing.xs }}>
                  <Image
                    source={{ uri: item.local_thumb_path }}
                    style={{ width: '100%', height: 120, borderRadius: radii.md }}
                    resizeMode="cover"
                  />
                  {item.watermark_text ? (
                    <View
                      style={{
                        position: 'absolute',
                        bottom: 4,
                        left: 4,
                        right: 4,
                        backgroundColor: 'rgba(0, 0, 0, 0.45)',
                        borderRadius: radii.sm,
                        paddingHorizontal: 4,
                        paddingVertical: 2
                      }}
                    >
                      <Text variant="caption" style={{ color: '#FFFFFF' }} numberOfLines={1}>
                        {item.watermark_text}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View
                  style={{
                    width: '100%',
                    height: 120,
                    borderRadius: radii.md,
                    marginBottom: spacing.xs,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.fog
                  }}
                >
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {isPdf(item) ? 'PDF' : 'Thumbnail pending'}
                  </Text>
                </View>
              )}

              <Text variant="bodyStrong" numberOfLines={1}>
                {item.upload_status}
              </Text>
              <Text variant="caption" style={{ color: colors.slate }} numberOfLines={2}>
                {item.watermark_text ?? 'Watermark en attente'}
              </Text>
              {item.last_error ? (
                <Text variant="caption" style={{ color: colors.rose }} numberOfLines={2}>
                  {item.last_error}
                </Text>
              ) : null}
            </Card>
          )}
          ListEmptyComponent={
            <Card>
              <Text variant="body" style={{ color: colors.slate }}>
                Aucun media pour le moment.
              </Text>
            </Card>
          }
        />
      </View>
    </Screen>
  );
}
