import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { projects, type Project } from '../../data/projects';
import type { ProjectsStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectEdit'>;

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

export function ProjectEditScreen({ navigation, route }: Props) {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();

  const projectId = route.params.projectId;

  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [teamId, setTeamId] = useState('');
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return Boolean(activeOrgId && user?.id && name.trim().length >= 2 && !busy && project);
  }, [activeOrgId, busy, name, project, user?.id]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await projects.getById(projectId);
      if (!row) {
        setError('Chantier introuvable.');
        setProject(null);
        return;
      }
      setProject(row);
      setName(row.name);
      setAddress(row.address ?? '');
      setStartDate(row.start_date ?? '');
      setEndDate(row.end_date ?? '');
      setTeamId(row.team_id ?? '');
      setGeoLat(row.geo_lat ?? null);
      setGeoLng(row.geo_lng ?? null);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

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

    if (!project) {
      setError('Chantier introuvable.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updated = await projects.update(project.id, {
        name,
        address: address.trim() || null,
        start_date: startDate.trim() || null,
        end_date: endDate.trim() || null,
        team_id: teamId.trim() || null,
        geo_lat: geoLat,
        geo_lng: geoLng
      });

      setProject(updated);
      navigation.goBack();
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, address, endDate, geoLat, geoLng, name, navigation, project, startDate, teamId, user?.id]);

  const archive = useCallback(() => {
    if (!project) {
      return;
    }

    Alert.alert('Archiver le chantier', 'Le chantier sera masqué par défaut (tu peux l’afficher via le filtre).', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Archiver',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await projects.archive(project.id);
              navigation.goBack();
            } catch (archiveError) {
              setError(toErrorMessage(archiveError));
            } finally {
              setBusy(false);
            }
          })();
        }
      }
    ]);
  }, [navigation, project]);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: spacing.lg }}
      >
        <SectionHeader
          title="Modifier chantier"
          subtitle={loading ? 'Chargement…' : project ? project.id : '—'}
        />

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
            <Text variant="bodyStrong">État</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              {project ? `Statut: ${project.status_manual}` : '—'}
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Archiver" kind="ghost" onPress={archive} disabled={busy || !project} />
            </View>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button
              label={busy ? 'Enregistrement...' : 'Enregistrer'}
              onPress={() => void submit()}
              disabled={!canSubmit}
            />
            <Button label="Retour" kind="ghost" onPress={() => navigation.goBack()} disabled={busy} />
          </View>

          {error ? (
            <Card>
              <Text variant="caption" style={{ color: colors.rose }}>
                {error}
              </Text>
            </Card>
          ) : null}

          {!project && !loading ? (
            <Pressable onPress={() => void load()} style={{ alignSelf: 'flex-start' }}>
              <Text variant="bodyStrong" style={{ color: colors.teal }}>
                Recharger
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

