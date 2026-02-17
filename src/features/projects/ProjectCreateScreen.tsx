import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { controlMode } from '../../data/control-mode';
import { projects } from '../../data/projects';
import type { ProjectsStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectCreate'>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue.';
}

function formatAddress(item: Location.LocationGeocodedAddress) {
  const parts = [
    item.name,
    item.street,
    item.postalCode,
    item.city,
    item.region,
    item.country
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);

  return parts.join(', ');
}

export function ProjectCreateScreen({ navigation }: Props) {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [teamId, setTeamId] = useState('');
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);
  const [starterPack, setStarterPack] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return Boolean(activeOrgId && user?.id && name.trim().length >= 2 && !busy);
  }, [activeOrgId, busy, name, user?.id]);

  const captureLocation = useCallback(async () => {
    setError(null);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Permission localisation refusée.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setGeoLat(lat);
        setGeoLng(lng);
      }

      try {
        const rows = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        const first = rows[0];
        if (first) {
          const formatted = formatAddress(first);
          if (formatted.length > 0 && address.trim().length === 0) {
            setAddress(formatted);
          }
        }
      } catch {
        // Reverse geocoding may require network. Keep coords only.
      }
    } catch (locationError) {
      setError(toErrorMessage(locationError));
    }
  }, [address]);

  const submit = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const project = await projects.create({
        org_id: activeOrgId,
        name,
        address: address.trim() || undefined,
        start_date: startDate.trim() || undefined,
        end_date: endDate.trim() || undefined,
        team_id: teamId.trim() || undefined,
        geo_lat: geoLat ?? undefined,
        geo_lng: geoLng ?? undefined,
        created_by: user.id
      });

      if (starterPack) {
        controlMode.setContext({
          org_id: activeOrgId,
          user_id: user.id
        });

        try {
          await controlMode.createChecklist(project.id);
        } catch (starterError) {
          Alert.alert('Chantier créé', `Checklist starter pack non créée: ${toErrorMessage(starterError)}`);
        }
      }

      navigation.replace('ProjectDetail', { projectId: project.id });
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, address, endDate, geoLat, geoLng, name, navigation, startDate, starterPack, teamId, user?.id]);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: spacing.lg }}
      >
        <SectionHeader title="Nouveau chantier" subtitle="Création offline-first (aucun appel réseau requis)." />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="bodyStrong">Informations</Text>

            <Text style={{ color: colors.slate, marginTop: spacing.xs }} variant="caption">
              Nom
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Nom du chantier"
              placeholderTextColor={colors.slate}
              style={{
                marginTop: spacing.xs,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                color: colors.ink,
                backgroundColor: colors.white
              }}
            />

            <Text style={{ color: colors.slate, marginTop: spacing.sm }} variant="caption">
              Adresse (optionnel)
            </Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Adresse / repère"
              placeholderTextColor={colors.slate}
              style={{
                marginTop: spacing.xs,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                color: colors.ink,
                backgroundColor: colors.white
              }}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Récupérer GPS" kind="ghost" onPress={() => void captureLocation()} disabled={busy} />
              {geoLat !== null && geoLng !== null ? (
                <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
                  {geoLat.toFixed(5)}, {geoLng.toFixed(5)}
                </Text>
              ) : null}
            </View>

            <Text style={{ color: colors.slate, marginTop: spacing.sm }} variant="caption">
              Début (YYYY-MM-DD, optionnel)
            </Text>
            <TextInput
              value={startDate}
              onChangeText={setStartDate}
              placeholder="2026-02-16"
              placeholderTextColor={colors.slate}
              autoCapitalize="none"
              style={{
                marginTop: spacing.xs,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                color: colors.ink,
                backgroundColor: colors.white
              }}
            />

            <Text style={{ color: colors.slate, marginTop: spacing.sm }} variant="caption">
              Fin (YYYY-MM-DD, optionnel)
            </Text>
            <TextInput
              value={endDate}
              onChangeText={setEndDate}
              placeholder="2026-03-01"
              placeholderTextColor={colors.slate}
              autoCapitalize="none"
              style={{
                marginTop: spacing.xs,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                color: colors.ink,
                backgroundColor: colors.white
              }}
            />

            <Text style={{ color: colors.slate, marginTop: spacing.sm }} variant="caption">
              Équipe (team_id, optionnel)
            </Text>
            <TextInput
              value={teamId}
              onChangeText={setTeamId}
              placeholder="team_id"
              placeholderTextColor={colors.slate}
              autoCapitalize="none"
              style={{
                marginTop: spacing.xs,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                color: colors.ink,
                backgroundColor: colors.white
              }}
            />
          </Card>

          <Card>
            <Text variant="bodyStrong">Starter pack (optionnel)</Text>

            <Pressable
              onPress={() => setStarterPack((current) => !current)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: colors.fog,
                  backgroundColor: starterPack ? colors.teal : colors.white
                }}
              />
              <Text variant="body">Créer une checklist contrôle automatiquement</Text>
            </Pressable>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Pas bloquant: si ça échoue, le chantier reste créé.
            </Text>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button label={busy ? 'Création...' : 'Créer le chantier'} onPress={() => void submit()} disabled={!canSubmit} />
            <Button label="Annuler" kind="ghost" onPress={() => navigation.goBack()} disabled={busy} />
          </View>

          {error ? (
            <Card>
              <Text variant="caption" style={{ color: colors.rose }}>
                {error}
              </Text>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

