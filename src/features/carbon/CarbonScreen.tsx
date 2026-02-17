import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../../core/auth';
import { carbon, CarbonFootprintSummary, EnergyEntry, TravelEntry } from '../../data/carbon-footprint';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { useAppNavigationContext } from '../../navigation/contextStore';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const DEMO_PROJECT_ID = 'chantier-conformeo-demo';

function parseNumber(input: string) {
  const cleaned = input.replace(',', '.').trim();
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function modeLabel(mode: string) {
  switch (mode) {
    case 'CAR':
      return 'Voiture';
    case 'VAN':
      return 'Utilitaire';
    case 'TRUCK':
      return 'Camion';
    case 'PUBLIC':
      return 'Transport public';
    case 'BIKE':
      return 'Velo';
    case 'WALK':
      return 'Marche';
    default:
      return mode;
  }
}

function energyLabel(type: string) {
  switch (type) {
    case 'ELECTRICITY_KWH':
      return 'Electricite (kWh)';
    case 'DIESEL_L':
      return 'Diesel (L)';
    case 'GAS_KWH':
      return 'Gaz (kWh)';
    default:
      return type;
  }
}

export function CarbonScreen({ projectId }: { projectId?: string } = {}) {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();
  const navCtx = useAppNavigationContext();

  const effectiveProjectId = projectId ?? navCtx.projectId ?? DEMO_PROJECT_ID;

  const [summary, setSummary] = useState<CarbonFootprintSummary | null>(null);
  const [travelRows, setTravelRows] = useState<TravelEntry[]>([]);
  const [energyRows, setEnergyRows] = useState<EnergyEntry[]>([]);

  const [travelMode, setTravelMode] = useState('CAR');
  const [travelDistance, setTravelDistance] = useState('10');
  const [travelNote, setTravelNote] = useState('');

  const [energyType, setEnergyType] = useState('ELECTRICITY_KWH');
  const [energyQty, setEnergyQty] = useState('5');
  const [energyNote, setEnergyNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const inputStyle = useMemo(
    () => ({
      borderWidth: 1,
      borderColor: colors.fog,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.ink,
      backgroundColor: colors.white
    }),
    [colors, radii.md, spacing.md, spacing.sm]
  );

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setSummary(null);
      setTravelRows([]);
      setEnergyRows([]);
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const [computed, travel, energy] = await Promise.all([
        carbon.computeProject(activeOrgId, effectiveProjectId),
        carbon.listTravel(effectiveProjectId, { org_id: activeOrgId, limit: 200, offset: 0 }),
        carbon.listEnergy(effectiveProjectId, { org_id: activeOrgId, limit: 200, offset: 0 })
      ]);

      setSummary(computed);
      setTravelRows(travel);
      setEnergyRows(energy);
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Calcul carbone impossible.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, effectiveProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addTravel = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide: utilisateur ou organisation manquante.');
      return;
    }

    const distance = parseNumber(travelDistance);
    if (distance === null) {
      setError('distance_km invalide.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await carbon.addTravel({
        org_id: activeOrgId,
        project_id: effectiveProjectId,
        mode: travelMode,
        distance_km: distance,
        note: travelNote || undefined,
        created_by: user.id
      });

      setTravelNote('');
      await refresh();
      setInfo('Déplacement ajouté.');
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : 'Ajout déplacement impossible.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, effectiveProjectId, refresh, travelDistance, travelMode, travelNote, user?.id]);

  const addEnergy = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide: utilisateur ou organisation manquante.');
      return;
    }

    const qty = parseNumber(energyQty);
    if (qty === null) {
      setError('quantite invalide.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await carbon.addEnergy({
        org_id: activeOrgId,
        project_id: effectiveProjectId,
        energy_type: energyType,
        quantity: qty,
        note: energyNote || undefined,
        created_by: user.id
      });

      setEnergyNote('');
      await refresh();
      setInfo('Énergie ajoutée.');
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Ajout énergie impossible.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, effectiveProjectId, energyNote, energyQty, energyType, refresh, user?.id]);

  const exportPdf = useCallback(async () => {
    if (!activeOrgId) {
      setError('Organisation manquante.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const result = await carbon.generateReportPdf(activeOrgId, effectiveProjectId);
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(result.path, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: 'Partager bilan carbone (PDF)'
        });
      }
      setInfo(`PDF généré: ${result.path}`);
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : 'Export PDF impossible.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, effectiveProjectId]);

  const topWaste = useMemo(() => {
    if (!summary) return [] as Array<{ key: string; value: number }>;
    return Object.entries(summary.by_waste_category_kgco2e)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [summary]);

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <SectionHeader
          title="Bilan carbone"
          subtitle="Calcul simplifié chantier (déchets, déplacements, énergie) + export PDF."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Synthèse</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Chantier: {effectiveProjectId} • queue sync {syncStatus.queueDepth}
            </Text>

            {summary ? (
              <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                <Text variant="bodyStrong">Total: {summary.total_kgco2e} kgCO2e</Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Déchets: {summary.waste_kgco2e} • Déplacements: {summary.travel_kgco2e} • Énergie: {summary.energy_kgco2e}
                </Text>
                {topWaste.length > 0 ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text variant="caption" style={{ color: colors.slate }}>
                      Top déchets (kgCO2e):
                    </Text>
                    {topWaste.map((row) => (
                      <Text key={row.key} variant="caption" style={{ color: colors.slate }}>
                        {row.key}: {row.value}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Aucun calcul disponible.
              </Text>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={busy ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={busy} />
              <Button label={busy ? '...' : 'Exporter PDF'} onPress={() => void exportPdf()} disabled={busy} />
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Note: facteurs d’émission simplifiés (MVP), ajustables dans le code.
            </Text>
          </Card>

          <Card>
            <Text variant="h2">Déplacements</Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              {['CAR', 'VAN', 'TRUCK', 'PUBLIC', 'BIKE', 'WALK', 'OTHER'].map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setTravelMode(mode)}
                  style={{
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    backgroundColor: travelMode === mode ? colors.mint : colors.white,
                    borderWidth: 1,
                    borderColor: travelMode === mode ? colors.teal : colors.fog
                  }}
                >
                  <Text variant="caption" style={{ color: travelMode === mode ? colors.ink : colors.slate }}>
                    {modeLabel(mode)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={travelDistance}
              onChangeText={setTravelDistance}
              placeholder="Distance (km)"
              placeholderTextColor={colors.slate}
              keyboardType="decimal-pad"
              style={{ ...inputStyle, marginTop: spacing.sm }}
            />

            <TextInput
              value={travelNote}
              onChangeText={setTravelNote}
              placeholder="Note (optionnel)"
              placeholderTextColor={colors.slate}
              style={{ ...inputStyle, marginTop: spacing.sm }}
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={busy ? 'Ajout...' : 'Ajouter'} onPress={() => void addTravel()} disabled={busy} />
            </View>

            <FlatList
              data={travelRows}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              nestedScrollEnabled={false}
              contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}
              renderItem={({ item }) => (
                <Card>
                  <Text variant="bodyStrong">
                    {modeLabel(String(item.mode))} • {item.distance_km} km
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    {new Date(item.created_at).toLocaleString('fr-FR')}
                  </Text>
                  {item.note ? (
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      {item.note}
                    </Text>
                  ) : null}
                </Card>
              )}
              ListEmptyComponent={
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                  Aucun déplacement.
                </Text>
              }
            />
          </Card>

          <Card>
            <Text variant="h2">Énergie</Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              {['ELECTRICITY_KWH', 'DIESEL_L', 'GAS_KWH', 'OTHER'].map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setEnergyType(t)}
                  style={{
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    backgroundColor: energyType === t ? colors.mint : colors.white,
                    borderWidth: 1,
                    borderColor: energyType === t ? colors.teal : colors.fog
                  }}
                >
                  <Text variant="caption" style={{ color: energyType === t ? colors.ink : colors.slate }}>
                    {energyLabel(t)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={energyQty}
              onChangeText={setEnergyQty}
              placeholder="Quantité (unité selon type)"
              placeholderTextColor={colors.slate}
              keyboardType="decimal-pad"
              style={{ ...inputStyle, marginTop: spacing.sm }}
            />

            <TextInput
              value={energyNote}
              onChangeText={setEnergyNote}
              placeholder="Note (optionnel)"
              placeholderTextColor={colors.slate}
              style={{ ...inputStyle, marginTop: spacing.sm }}
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={busy ? 'Ajout...' : 'Ajouter'} onPress={() => void addEnergy()} disabled={busy} />
            </View>

            <FlatList
              data={energyRows}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              nestedScrollEnabled={false}
              contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}
              renderItem={({ item }) => (
                <Card>
                  <Text variant="bodyStrong">
                    {energyLabel(String(item.energy_type))} • {item.quantity}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    {new Date(item.created_at).toLocaleString('fr-FR')}
                  </Text>
                  {item.note ? (
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      {item.note}
                    </Text>
                  ) : null}
                </Card>
              )}
              ListEmptyComponent={
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                  Aucune entrée énergie.
                </Text>
              }
            />
          </Card>

          {info ? (
            <Card>
              <Text variant="caption" style={{ color: colors.slate }}>
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
        </View>
      </ScrollView>
    </Screen>
  );
}
