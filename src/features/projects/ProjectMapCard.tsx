import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useMemo, useState } from 'react';
import { Image, Linking, Platform, View } from 'react-native';
import type { Project } from '../../data/projects';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { useTheme } from '../../ui/theme/ThemeProvider';

function staticMapUrl(lat: number, lng: number) {
  const center = `${lat},${lng}`;
  const size = '700x320';
  const zoom = 16;
  const markers = `${lat},${lng},red-pushpin`;
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent(center)}&zoom=${zoom}&size=${size}&markers=${encodeURIComponent(markers)}`;
}

function formatCoords(lat: number, lng: number) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function ProjectMapCard({
  project,
  isOffline,
  busy,
  onDefineLocation,
  onOpenPlans
}: {
  project: Project | null;
  isOffline: boolean;
  busy?: boolean;
  onDefineLocation?: () => void;
  onOpenPlans?: () => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const [imageError, setImageError] = useState(false);

  const address = project?.address?.trim() || '';
  const hasCoords = typeof project?.geo_lat === 'number' && typeof project?.geo_lng === 'number';
  const lat = project?.geo_lat ?? null;
  const lng = project?.geo_lng ?? null;

  const mapUri = useMemo(() => {
    if (!hasCoords || lat === null || lng === null) return null;
    return staticMapUrl(lat, lng);
  }, [hasCoords, lat, lng]);

  const openItinerary = useCallback(async () => {
    if (!hasCoords || lat === null || lng === null) return;

    const destination = `${lat},${lng}`;
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${encodeURIComponent(destination)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    await Linking.openURL(url);
  }, [hasCoords, lat, lng]);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
  }, [address]);

  return (
    <Card>
      <Text variant="h2">Localisation</Text>

      {hasCoords && lat !== null && lng !== null ? (
        <View
          style={{
            marginTop: spacing.sm,
            borderRadius: radii.md,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: colors.fog,
            backgroundColor: colors.sand
          }}
        >
          {!isOffline && mapUri && !imageError ? (
            <Image
              source={{ uri: mapUri }}
              style={{ width: '100%', height: 180 }}
              resizeMode="cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <View style={{ height: 180, alignItems: 'center', justifyContent: 'center', padding: spacing.md }}>
              <Text variant="caption" style={{ color: colors.slate, textAlign: 'center' }}>
                {isOffline
                  ? "Mode hors ligne : la carte n'est pas disponible."
                  : "Impossible d'afficher la carte pour le moment."}
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View
          style={{
            marginTop: spacing.sm,
            padding: spacing.md,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.fog,
            backgroundColor: colors.sand
          }}
        >
          <Text variant="bodyStrong">Localisation non définie</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Renseignez l'adresse puis définissez la localisation pour afficher une carte et générer un itinéraire.
          </Text>
        </View>
      )}

      <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
        {address ? (
          <Text variant="caption" style={{ color: colors.slate }}>
            Adresse : {address}
          </Text>
        ) : (
          <Text variant="caption" style={{ color: colors.slate }}>
            Adresse : —
          </Text>
        )}

      {hasCoords && lat !== null && lng !== null ? (
          <Text variant="caption" style={{ color: colors.slate }}>
            Coordonnées : {formatCoords(lat, lng)}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
        {hasCoords ? (
          <Button label="Itinéraire" kind="ghost" onPress={() => void openItinerary()} disabled={busy} />
        ) : (
          <Button
            label="Définir la localisation"
            kind="ghost"
            onPress={() => onDefineLocation?.()}
            disabled={busy || isOffline || !address || !onDefineLocation}
          />
        )}

        <Button label="Copier l'adresse" kind="ghost" onPress={() => void copyAddress()} disabled={busy || !address} />

        {onOpenPlans ? <Button label="Ouvrir Plans" kind="ghost" onPress={onOpenPlans} disabled={busy} /> : null}
      </View>

      {!hasCoords && isOffline ? (
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
          Mode hors ligne : vous pourrez définir la localisation dès que la connexion revient.
        </Text>
      ) : null}
    </Card>
  );
}
