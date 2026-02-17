import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../../core/auth';
import { waste, WasteCategory, WasteEntry } from '../../data/waste-volume';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { useAppNavigationContext } from '../../navigation/contextStore';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const PAGE_SIZE = 50;
const DEMO_PROJECT_ID = 'chantier-conformeo-demo';

function parseNumber(input: string) {
  const cleaned = input.replace(',', '.').trim();
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function categoryLabel(category: string) {
  switch (category) {
    case 'GRAVATS':
      return 'Gravats';
    case 'BOIS':
      return 'Bois';
    case 'METAUX':
      return 'Metaux';
    case 'PLASTIQUES':
      return 'Plastiques';
    case 'PLATRE':
      return 'Platre';
    case 'DIB':
      return 'DIB';
    case 'DEEE':
      return 'DEEE';
    default:
      return 'Autre';
  }
}

export function WasteVolumeScreen({ projectId }: { projectId?: string } = {}) {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();
  const navCtx = useAppNavigationContext();

  const effectiveProjectId = projectId ?? navCtx.projectId ?? DEMO_PROJECT_ID;

  const [items, setItems] = useState<WasteEntry[]>([]);
  const [totals, setTotals] = useState<{ total: number; byCategory: Record<string, number> }>({
    total: 0,
    byCategory: {}
  });

  const [category, setCategory] = useState<WasteCategory | string>('GRAVATS');
  const [lengthDraft, setLengthDraft] = useState('1.0');
  const [widthDraft, setWidthDraft] = useState('1.0');
  const [heightDraft, setHeightDraft] = useState('1.0');
  const [noteDraft, setNoteDraft] = useState('');

  const [filterCategory, setFilterCategory] = useState<string | 'ALL'>('ALL');
  const [page, setPage] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
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

  const computedVolume = useMemo(() => {
    const l = parseNumber(lengthDraft);
    const w = parseNumber(widthDraft);
    const h = parseNumber(heightDraft);
    if (l === null || w === null || h === null || l <= 0 || w <= 0 || h <= 0) {
      return null;
    }
    return waste.computeVolume(l, w, h);
  }, [heightDraft, lengthDraft, widthDraft]);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setItems([]);
      setTotals({ total: 0, byCategory: {} });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const filters = {
        org_id: activeOrgId,
        category: filterCategory === 'ALL' ? 'ALL' : filterCategory,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      } as const;

      const [rows, t] = await Promise.all([
        waste.listByProject(effectiveProjectId, filters),
        waste.computeTotals(effectiveProjectId, { ...filters, limit: 500, offset: 0 })
      ]);

      setItems(rows);
      setTotals({
        total: t.total_m3,
        byCategory: t.by_category
      });
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Impossible de charger les déchets.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, effectiveProjectId, filterCategory, page]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createEntry = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide: utilisateur ou organisation manquante.');
      return;
    }

    const l = parseNumber(lengthDraft);
    const w = parseNumber(widthDraft);
    const h = parseNumber(heightDraft);

    if (l === null || w === null || h === null) {
      setError('Dimensions invalides.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      const entry = await waste.create({
        org_id: activeOrgId,
        project_id: effectiveProjectId,
        category,
        length_m: l,
        width_m: w,
        height_m: h,
        note: noteDraft,
        created_by: user.id
      });

      setInfo(`Ajoute: ${entry.volume_m3} m3 (${categoryLabel(String(entry.category))})`);
      setNoteDraft('');
      setPage(0);
      await refresh();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Ajout impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [activeOrgId, category, effectiveProjectId, heightDraft, lengthDraft, noteDraft, refresh, user?.id, widthDraft]);

  const exportCsv = useCallback(async () => {
    if (!activeOrgId) {
      setError('Organisation manquante.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      const result = await waste.exportCsv(effectiveProjectId, {
        org_id: activeOrgId,
        category: filterCategory === 'ALL' ? 'ALL' : filterCategory,
        limit: 500,
        offset: 0
      });

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        setInfo(`CSV genere: ${result.path}`);
        return;
      }

      await Sharing.shareAsync(result.path, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
        dialogTitle: 'Exporter CSV déchets'
      });

      setInfo(`CSV exporte (${result.row_count} lignes).`);
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : "Export CSV impossible.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [activeOrgId, effectiveProjectId, filterCategory]);

  const hasNextPage = items.length >= PAGE_SIZE;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Déchets (volume)"
          subtitle="Estimation volume (m3) via dimensions, catégorisation, historique et export CSV."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Ajout rapide</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Volume calcule: {computedVolume === null ? '—' : `${computedVolume} m3`} • queue sync {syncStatus.queueDepth}
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              {waste.categories.map((c) => {
                const active = String(category) === String(c);
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(c)}
                    style={{
                      borderRadius: radii.pill,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                      backgroundColor: active ? colors.mint : colors.white,
                      borderWidth: 1,
                      borderColor: active ? colors.teal : colors.fog
                    }}
                  >
                    <Text variant="caption" style={{ color: active ? colors.ink : colors.slate }}>
                      {categoryLabel(c)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  value={lengthDraft}
                  onChangeText={setLengthDraft}
                  placeholder="Longueur (m)"
                  placeholderTextColor={colors.slate}
                  keyboardType="decimal-pad"
                  style={inputStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput
                  value={widthDraft}
                  onChangeText={setWidthDraft}
                  placeholder="Largeur (m)"
                  placeholderTextColor={colors.slate}
                  keyboardType="decimal-pad"
                  style={inputStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput
                  value={heightDraft}
                  onChangeText={setHeightDraft}
                  placeholder="Hauteur (m)"
                  placeholderTextColor={colors.slate}
                  keyboardType="decimal-pad"
                  style={inputStyle}
                />
              </View>
            </View>

            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Note (optionnel)"
              placeholderTextColor={colors.slate}
              style={{ ...inputStyle, marginTop: spacing.sm }}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label={submitting ? 'Ajout...' : 'Ajouter'}
                onPress={() => void createEntry()}
                disabled={submitting}
              />
              <Button label="Exporter CSV" kind="ghost" onPress={() => void exportCsv()} disabled={submitting} />
              <Button label="Rafraîchir" kind="ghost" onPress={() => void refresh()} disabled={submitting} />
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Total sur chantier: {totals.total} m3
            </Text>
          </Card>

          <Card>
            <Text variant="h2">Historique</Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button
                label="Tous"
                kind={filterCategory === 'ALL' ? 'primary' : 'ghost'}
                onPress={() => {
                  setFilterCategory('ALL');
                  setPage(0);
                }}
                disabled={submitting}
              />
              {waste.categories.map((c) => (
                <Button
                  key={c}
                  label={categoryLabel(c)}
                  kind={filterCategory === c ? 'primary' : 'ghost'}
                  onPress={() => {
                    setFilterCategory(c);
                    setPage(0);
                  }}
                  disabled={submitting}
                />
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label="Page précédente"
                kind="ghost"
                onPress={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || submitting}
              />
              <Button
                label="Page suivante"
                kind="ghost"
                onPress={() => setPage((p) => p + 1)}
                disabled={!hasNextPage || submitting}
              />
              <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
                Page {page + 1}
              </Text>
            </View>
          </Card>

          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            nestedScrollEnabled={false}
            contentContainerStyle={{ gap: spacing.sm }}
            renderItem={({ item }) => (
              <Card>
                <Text variant="bodyStrong">
                  {categoryLabel(String(item.category))} • {item.volume_m3} m3
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  {item.length_m} x {item.width_m} x {item.height_m} m • {new Date(item.created_at).toLocaleString('fr-FR')}
                </Text>
                {item.note ? (
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    {item.note}
                  </Text>
                ) : null}
              </Card>
            )}
            ListEmptyComponent={
              <Card>
                <Text variant="body" style={{ color: colors.slate }}>
                  {loading ? 'Chargement...' : 'Aucune entrée.'}
                </Text>
              </Card>
            }
          />

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
