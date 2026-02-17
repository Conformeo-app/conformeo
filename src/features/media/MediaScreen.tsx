import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../core/auth';
import { flags } from '../../data/feature-flags';
import { MediaAsset, media } from '../../data/media';
import { plans } from '../../data/plans-annotations';
import type { PlanPin } from '../../data/plans-annotations';
import type { Task, TaskFilters } from '../../data/tasks';
import { tasks } from '../../data/tasks';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { useAppNavigationContext } from '../../navigation/contextStore';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const DEMO_PROJECT_ID = 'chantier-conformeo-demo';

type QuickFilter =
  | 'ALL'
  | 'TODAY'
  | 'WEEK'
  | 'TASK_LINKED'
  | 'UNLINKED'
  | 'UPLOAD_PENDING'
  | 'UPLOAD_FAILED';

const QUICK_FILTERS: Array<{ key: QuickFilter; label: string }> = [
  { key: 'ALL', label: 'Toutes' },
  { key: 'TODAY', label: "Aujourd'hui" },
  { key: 'WEEK', label: 'Cette semaine' },
  { key: 'TASK_LINKED', label: 'Liees a une tache' },
  { key: 'UNLINKED', label: 'Non liees' },
  { key: 'UPLOAD_PENDING', label: 'Upload en attente' },
  { key: 'UPLOAD_FAILED', label: 'Upload en echec' }
];

type DetailState = {
  open: boolean;
  assetId: string | null;
};

type UploadStatus = MediaAsset['upload_status'];

function isPdf(asset: MediaAsset) {
  return asset.mime === 'application/pdf';
}

function isImage(asset: MediaAsset) {
  return asset.mime === 'image/webp' || asset.mime === 'image/jpeg';
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function startOfTodayLocal() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function startOfWeekLocal() {
  const now = new Date();
  const day = now.getDay(); // 0..6 (Sun..Sat)
  const diff = (day === 0 ? 6 : day - 1); // Monday start
  now.setDate(now.getDate() - diff);
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function formatShortDate(value: string) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function statusTint(status: UploadStatus, palette: { teal: string; mint: string; amber: string; rose: string }) {
  if (status === 'UPLOADED') return palette.mint;
  if (status === 'UPLOADING') return palette.teal;
  if (status === 'FAILED') return palette.rose;
  return palette.amber;
}

function statusLabel(status: UploadStatus) {
  if (status === 'UPLOADED') return 'UPLOADED';
  if (status === 'UPLOADING') return 'UPLOADING';
  if (status === 'FAILED') return 'FAILED';
  return 'PENDING';
}

function tileIcons(asset: MediaAsset) {
  const hasTask = Boolean(asset.task_id);
  const hasPin = Boolean(asset.plan_pin_id);
  return { hasTask, hasPin };
}

function TaskPickerModal({
  visible,
  projectId,
  orgId,
  onClose,
  onPick
}: {
  visible: boolean;
  projectId: string;
  orgId: string;
  onClose: () => void;
  onPick: (task: Task) => void;
}) {
  const { colors, spacing, radii } = useTheme();

  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: TaskFilters = { org_id: orgId, limit: 60, offset: 0 };
      const cleaned = normalizeText(query);
      const next = cleaned ? await tasks.searchByProject(projectId, cleaned, filters) : await tasks.listByProject(projectId, filters);
      setItems(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Chargement taches impossible.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId, query]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [load, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <Card style={{ flex: 1, minHeight: 0 }}>
          <Text variant="h2">Choisir une tache</Text>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher (titre/desc)"
            placeholderTextColor={colors.slate}
            style={{
              marginTop: spacing.md,
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              backgroundColor: colors.white
            }}
          />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Rechercher" onPress={() => void load()} disabled={loading} />
            <Button label="Fermer" kind="ghost" onPress={onClose} disabled={loading} />
          </View>

          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
              {error}
            </Text>
          ) : null}

          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            style={{ flex: 1, minHeight: 0, marginTop: spacing.md }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item)}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  backgroundColor: colors.white,
                  marginBottom: spacing.sm
                }}
              >
                <Text variant="bodyStrong" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                  {item.status} · {item.priority} · {item.id.slice(0, 6)}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text variant="caption" style={{ color: colors.slate }}>
                {loading ? 'Chargement...' : 'Aucune tache.'}
              </Text>
            }
          />
        </Card>
      </Screen>
    </Modal>
  );
}

function PinPickerModal({
  visible,
  projectId,
  onClose,
  onPick
}: {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  onPick: (pin: PlanPin) => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PlanPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await plans.listPinsByProject(projectId, { status: 'ALL', limit: 250, offset: 0 });
      const cleaned = normalizeText(query).toLowerCase();
      const filtered = cleaned
        ? next.filter((pin) => (pin.label ?? '').toLowerCase().includes(cleaned) || pin.id.toLowerCase().includes(cleaned))
        : next;
      setItems(filtered.slice(0, 120));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Chargement pins impossible.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId, query]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [load, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <Card style={{ flex: 1, minHeight: 0 }}>
          <Text variant="h2">Choisir un pin</Text>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher (label/id)"
            placeholderTextColor={colors.slate}
            style={{
              marginTop: spacing.md,
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              backgroundColor: colors.white
            }}
          />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Rechercher" onPress={() => void load()} disabled={loading} />
            <Button label="Fermer" kind="ghost" onPress={onClose} disabled={loading} />
          </View>

          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
              {error}
            </Text>
          ) : null}

          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            style={{ flex: 1, minHeight: 0, marginTop: spacing.md }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item)}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  backgroundColor: colors.white,
                  marginBottom: spacing.sm
                }}
              >
                <Text variant="bodyStrong" numberOfLines={1}>
                  {item.label || `Pin ${item.id.slice(0, 6)}`}
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                  Page {item.page_number} · {item.status} · {item.priority}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text variant="caption" style={{ color: colors.slate }}>
                {loading ? 'Chargement...' : 'Aucun pin.'}
              </Text>
            }
          />
        </Card>
      </Screen>
    </Modal>
  );
}

function MediaDetailPanel({
  asset,
  linkedTask,
  pinHint,
  busy,
  onClose,
  onLinkTask,
  onUnlinkTask,
  onCreateTaskFromProof,
  onLinkPin,
  onUnlinkPin,
  onRetryUpload,
  onOpenFile
}: {
  asset: MediaAsset | null;
  linkedTask: Task | null;
  pinHint: { page_number?: number } | null;
  busy: boolean;
  onClose?: () => void;
  onLinkTask: () => void;
  onUnlinkTask: () => void;
  onCreateTaskFromProof: () => void;
  onLinkPin: () => void;
  onUnlinkPin: () => void;
  onRetryUpload: () => void;
  onOpenFile: () => void;
}) {
  const { colors, spacing, radii } = useTheme();

  if (!asset) {
    return (
      <Card style={{ flex: 1, minHeight: 0 }}>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Text variant="h2">Detail preuve</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Selectionnez une preuve dans la grille.
          </Text>
        </ScrollView>
      </Card>
    );
  }

  const tint = statusTint(asset.upload_status, {
    teal: colors.teal,
    mint: colors.mint,
    amber: colors.amber,
    rose: colors.rose
  });

  return (
    <Card style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={1}>
              {asset.tag ?? 'Preuve'}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
              {formatShortDate(asset.created_at)} · {asset.mime} · {Math.round(asset.size_bytes / 1024)} KB
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: tint }} />
            <Text variant="caption" style={{ color: colors.slate }}>
              {statusLabel(asset.upload_status)}
            </Text>
            {onClose ? <Button label="Fermer" kind="ghost" onPress={onClose} /> : null}
          </View>
        </View>

        {isImage(asset) ? (
          <View style={{ marginTop: spacing.md, borderRadius: radii.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.fog }}>
            <Image source={{ uri: asset.local_path }} style={{ width: '100%', height: 260, backgroundColor: colors.fog }} resizeMode="contain" />
          </View>
        ) : (
          <View style={{ marginTop: spacing.md, borderRadius: radii.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.fog }}>
            <View style={{ padding: spacing.lg, backgroundColor: colors.fog }}>
              <Text variant="bodyStrong">Document</Text>
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                {isPdf(asset) ? 'PDF' : asset.mime}
              </Text>
              <View style={{ marginTop: spacing.md }}>
                <Button label="Ouvrir" kind="ghost" onPress={onOpenFile} disabled={busy} />
              </View>
            </View>
          </View>
        )}

        {asset.last_error ? (
          <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.sand }}>
            <Text variant="bodyStrong" style={{ color: colors.rose }}>
              Erreur
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              {asset.last_error}
            </Text>
          </View>
        ) : null}

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Liens
        </Text>

        <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
          <View style={{ borderWidth: 1, borderColor: colors.fog, borderRadius: radii.md, padding: spacing.md }}>
            <Text variant="bodyStrong">Tache</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
              {linkedTask ? linkedTask.title : asset.task_id ? `Tache ${asset.task_id}` : 'Non liee'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Lier" onPress={onLinkTask} disabled={busy} />
              <Button label="Delier" kind="ghost" onPress={onUnlinkTask} disabled={busy || !asset.task_id} />
              <Button label="Creer tache depuis preuve" kind="ghost" onPress={onCreateTaskFromProof} disabled={busy} />
            </View>
          </View>

          <View style={{ borderWidth: 1, borderColor: colors.fog, borderRadius: radii.md, padding: spacing.md }}>
            <Text variant="bodyStrong">Pin plan</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
              {asset.plan_pin_id
                ? `Pin ${asset.plan_pin_id.slice(0, 6)}${pinHint?.page_number ? ` (page ${pinHint.page_number})` : ''}`
                : 'Non lie'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Lier" onPress={onLinkPin} disabled={busy} />
              <Button label="Delier" kind="ghost" onPress={onUnlinkPin} disabled={busy || !asset.plan_pin_id} />
            </View>
          </View>
        </View>

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Upload
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="Retenter upload" onPress={onRetryUpload} disabled={busy} />
          <Button label="Ouvrir fichier" kind="ghost" onPress={onOpenFile} disabled={busy} />
        </View>
      </ScrollView>
    </Card>
  );
}

export function MediaScreen({
  projectId,
  initialUploadStatus
}: {
  projectId?: string;
  initialUploadStatus?: 'ALL' | 'PENDING' | 'FAILED';
} = {}) {
  const { colors, spacing, radii } = useTheme();
  const { width } = useWindowDimensions();
  const split = width >= 980;

  const { activeOrgId, user } = useAuth();
  const navCtx = useAppNavigationContext();
  const { status: syncStatus, syncNow } = useSyncStatus();

  const effectiveProjectId = projectId ?? navCtx.projectId ?? DEMO_PROJECT_ID;

  const allowImport = useMemo(() => {
    const payload = flags.getPayload<Record<string, unknown>>('media', { orgId: activeOrgId ?? undefined }) ?? {};
    return payload.allow_import !== false;
  }, [activeOrgId]);

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [filter, setFilter] = useState<QuickFilter>(() => {
    if (initialUploadStatus === 'FAILED') return 'UPLOAD_FAILED';
    if (initialUploadStatus === 'PENDING') return 'UPLOAD_PENDING';
    return 'ALL';
  });
  const [gridWidth, setGridWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<DetailState>({ open: false, assetId: null });
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);

  useEffect(() => {
    if (!initialUploadStatus) {
      return;
    }

    if (initialUploadStatus === 'FAILED') {
      setFilter('UPLOAD_FAILED');
    } else if (initialUploadStatus === 'PENDING') {
      setFilter('UPLOAD_PENDING');
    } else {
      setFilter('ALL');
    }
  }, [initialUploadStatus]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === detail.assetId) ?? null,
    [assets, detail.assetId]
  );

  const [linkedTask, setLinkedTask] = useState<Task | null>(null);
  const [pinHint, setPinHint] = useState<{ page_number?: number } | null>(null);

  useEffect(() => {
    media.setContext({ org_id: activeOrgId ?? undefined, user_id: user?.id ?? undefined });
    plans.setContext({ org_id: activeOrgId ?? undefined, user_id: user?.id ?? undefined });
    tasks.setActor(user?.id ?? null);
  }, [activeOrgId, user?.id]);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setAssets([]);
      return;
    }

    try {
      const next = await media.listByProject(effectiveProjectId);
      setAssets(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Chargement des preuves impossible.';
      setError(message);
    }
  }, [activeOrgId, effectiveProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Lightweight polling to pick up thumbnails / processing updates shortly after capture/import.
  useEffect(() => {
    if (!activeOrgId) {
      return;
    }

    const now = Date.now();
    const hasRecentProcessing = assets.some((asset) => {
      const ts = Date.parse(asset.created_at);
      if (!Number.isFinite(ts) || now - ts > 2 * 60_000) {
        return false;
      }

      if (!isImage(asset)) {
        return false;
      }

      return !asset.local_thumb_path || !asset.watermark_applied;
    });

    if (!hasRecentProcessing || busy) {
      return;
    }

    const handle = setTimeout(() => {
      void refresh();
    }, 1200);

    return () => clearTimeout(handle);
  }, [activeOrgId, assets, busy, refresh]);

  useEffect(() => {
    if (!detail.assetId) {
      setLinkedTask(null);
      setPinHint(null);
      return;
    }

    const run = async () => {
      const asset = await media.getById(detail.assetId!);
      if (!asset) {
        setLinkedTask(null);
        setPinHint(null);
        return;
      }

      if (asset.task_id) {
        const task = await tasks.getById(asset.task_id);
        setLinkedTask(task);
      } else {
        setLinkedTask(null);
      }

      if (asset.plan_pin_id) {
        try {
          const target = await plans.jumpToPin(asset.plan_pin_id);
          setPinHint({ page_number: target.page_number });
        } catch {
          setPinHint(null);
        }
      } else {
        setPinHint(null);
      }
    };

    void run();
  }, [detail.assetId]);

  const stats = useMemo(() => {
    const total = assets.length;
    const pending = assets.filter((asset) => asset.upload_status === 'PENDING' || asset.upload_status === 'UPLOADING').length;
    const failed = assets.filter((asset) => asset.upload_status === 'FAILED').length;
    return { total, pending, failed };
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const todayMs = startOfTodayLocal();
    const weekMs = startOfWeekLocal();

    return assets.filter((asset) => {
      const ts = Date.parse(asset.created_at);
      const hasTask = Boolean(asset.task_id);
      const hasPin = Boolean(asset.plan_pin_id);
      const pending = asset.upload_status === 'PENDING' || asset.upload_status === 'UPLOADING';
      const failed = asset.upload_status === 'FAILED';

      if (filter === 'TODAY') return Number.isFinite(ts) ? ts >= todayMs : false;
      if (filter === 'WEEK') return Number.isFinite(ts) ? ts >= weekMs : false;
      if (filter === 'TASK_LINKED') return hasTask;
      if (filter === 'UNLINKED') return !hasTask && !hasPin;
      if (filter === 'UPLOAD_PENDING') return pending;
      if (filter === 'UPLOAD_FAILED') return failed;
      return true;
    });
  }, [assets, filter]);

  const panelWidth = 380;

  const columns = useMemo(() => {
    if (gridWidth <= 0) return 3;
    const usable = gridWidth - spacing.md * 2;
    const desired = split ? 160 : 120;
    const guess = Math.max(2, Math.min(6, Math.floor(usable / desired)));
    if (split && detail.open) {
      return Math.max(2, Math.min(5, guess));
    }
    return guess;
  }, [detail.open, gridWidth, spacing.md, split]);

  const tileSize = useMemo(() => {
    if (gridWidth <= 0) return 120;
    const usable = gridWidth - spacing.md * 2 - spacing.sm * (columns - 1);
    const size = Math.max(96, Math.floor(usable / columns));
    return size;
  }, [columns, gridWidth, spacing.md, spacing.sm]);

  const withBusy = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await task();
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur media';
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
      await media.capturePhoto({
        org_id: activeOrgId,
        project_id: effectiveProjectId,
        tag: 'proof'
      });
    });
  }, [activeOrgId, effectiveProjectId, withBusy]);

  const onImport = useCallback(() => {
    if (!activeOrgId) {
      setError('Compte sans organisation active.');
      return;
    }

    void withBusy(async () => {
      await media.importFiles({
        org_id: activeOrgId,
        project_id: effectiveProjectId,
        tag: 'proof'
      });
    });
  }, [activeOrgId, effectiveProjectId, withBusy]);

  const onSyncNow = useCallback(() => {
    void withBusy(async () => {
      await syncNow();
    });
  }, [syncNow, withBusy]);

  const onSelectAsset = useCallback(
    (assetId: string) => {
      setDetail({ open: true, assetId });
      if (!split) {
        // Open as modal on phone.
        return;
      }
    },
    [split]
  );

  const closeDetail = useCallback(() => {
    setDetail({ open: false, assetId: null });
    setTaskPickerOpen(false);
    setPinPickerOpen(false);
  }, []);

  const openFile = useCallback(async () => {
    if (!selectedAsset) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        throw new Error('Partage iOS indisponible sur cet appareil.');
      }
      await Sharing.shareAsync(selectedAsset.local_path, { mimeType: selectedAsset.mime });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ouverture fichier impossible.';
      setError(message);
    }
  }, [selectedAsset]);

  const retryUpload = useCallback(() => {
    if (!selectedAsset) return;
    void withBusy(async () => {
      await media.retryUpload(selectedAsset.id);
      await syncNow();
    });
  }, [selectedAsset, syncNow, withBusy]);

  const unlinkTask = useCallback(() => {
    if (!selectedAsset) return;
    void withBusy(async () => {
      await media.unlinkFromTask(selectedAsset.id);
    });
  }, [selectedAsset, withBusy]);

  const linkTask = useCallback(() => {
    if (!selectedAsset) return;
    setTaskPickerOpen(true);
  }, [selectedAsset]);

  const onPickTask = useCallback(
    (task: Task) => {
      setTaskPickerOpen(false);
      if (!selectedAsset) return;
      void withBusy(async () => {
        await media.linkToTask(selectedAsset.id, task.id);
      });
    },
    [selectedAsset, withBusy]
  );

  const createTaskFromProof = useCallback(() => {
    if (!selectedAsset || !activeOrgId || !user?.id) return;
    const projectId = selectedAsset.project_id;
    if (!projectId) {
      setError("Preuve sans project_id: impossible de creer une tache.");
      return;
    }

    void withBusy(async () => {
      const task = await tasks.create({
        org_id: activeOrgId,
        project_id: projectId,
        created_by: user.id,
        title: `Preuve ${new Date(selectedAsset.created_at).toLocaleDateString('fr-FR')}`,
        description: selectedAsset.tag ? `Tag: ${selectedAsset.tag}` : undefined,
        status: 'TODO',
        priority: 'MEDIUM',
        tags: ['proof']
      });

      await media.linkToTask(selectedAsset.id, task.id);
    });
  }, [activeOrgId, selectedAsset, user?.id, withBusy]);

  const linkPin = useCallback(() => {
    if (!selectedAsset) return;
    setPinPickerOpen(true);
  }, [selectedAsset]);

  const unlinkPin = useCallback(() => {
    if (!selectedAsset || !selectedAsset.plan_pin_id) return;
    void withBusy(async () => {
      const pinId = selectedAsset.plan_pin_id!;
      await plans.unlink(pinId, 'MEDIA', selectedAsset.id);
      await media.unlinkFromPin(selectedAsset.id);
    });
  }, [selectedAsset, withBusy]);

  const onPickPin = useCallback(
    (pin: PlanPin) => {
      setPinPickerOpen(false);
      if (!selectedAsset) return;
      void withBusy(async () => {
        await plans.link(pin.id, 'MEDIA', selectedAsset.id);
        await media.linkToPin(selectedAsset.id, pin.id);
      });
    },
    [selectedAsset, withBusy]
  );

  const renderTile = useCallback(
    ({ item }: { item: MediaAsset }) => {
      const icons = tileIcons(item);
      const tint = statusTint(item.upload_status, {
        teal: colors.teal,
        mint: colors.mint,
        amber: colors.amber,
        rose: colors.rose
      });

      return (
        <Pressable
          onPress={() => onSelectAsset(item.id)}
          style={{
            width: tileSize,
            height: tileSize,
            borderRadius: radii.md,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: colors.fog,
            backgroundColor: colors.fog
          }}
        >
          {item.local_thumb_path && isImage(item) ? (
            <Image source={{ uri: item.local_thumb_path }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.sm }}>
              <Text variant="caption" style={{ color: colors.slate }}>
                {isPdf(item) ? 'PDF' : '...'}
              </Text>
            </View>
          )}

          <View style={{ position: 'absolute', top: 6, left: 6, flexDirection: 'row', gap: 6 }}>
            {icons.hasTask ? (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text variant="caption" style={{ color: '#FFFFFF' }}>
                  T
                </Text>
              </View>
            ) : null}
            {icons.hasPin ? (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text variant="caption" style={{ color: '#FFFFFF' }}>
                  P
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ position: 'absolute', bottom: 6, left: 6, right: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, flex: 1, minWidth: 0 }}>
              <Text variant="caption" style={{ color: '#FFFFFF' }} numberOfLines={1}>
                {new Date(item.created_at).toLocaleDateString('fr-FR')}
              </Text>
            </View>
            <View style={{ width: 10, height: 10, borderRadius: 999, marginLeft: 8, backgroundColor: tint }} />
          </View>
        </Pressable>
      );
    },
    [colors.amber, colors.fog, colors.mint, colors.rose, colors.slate, colors.teal, onSelectAsset, radii.md, spacing.sm, tileSize]
  );

  const leftColumn = (
    <View style={{ gap: spacing.md }}>
      <SectionHeader
        title="Preuves"
        subtitle="Grille thumbnail-first, capture/import offline, upload en arriere-plan, filtres rapides."
      />

      <Card>
        <Text variant="h2">Etat</Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Total: {stats.total}
        </Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          En attente: {stats.pending} · En echec: {stats.failed}
        </Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Queue sync globale: {syncStatus.queueDepth} · dead letters: {syncStatus.deadLetterCount}
        </Text>
        {error ? (
          <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
            {error}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          <Button label="+ Photo" onPress={onCapture} disabled={busy} />
          {allowImport ? <Button label="Importer" kind="ghost" onPress={onImport} disabled={busy} /> : null}
          <Button label="Sync" kind="ghost" onPress={onSyncNow} disabled={busy} />
          <Button label="Rafraichir" kind="ghost" onPress={() => void refresh()} disabled={busy} />
        </View>
      </Card>

      <Card>
        <Text variant="h2">Filtres</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
          {QUICK_FILTERS.map((item) => (
            <Button
              key={item.key}
              label={item.label}
              kind={filter === item.key ? 'primary' : 'ghost'}
              onPress={() => setFilter(item.key)}
              disabled={busy}
            />
          ))}
        </View>

        {stats.failed > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Button label="Voir les echecs" onPress={() => setFilter('UPLOAD_FAILED')} disabled={busy} />
          </View>
        ) : null}
      </Card>
    </View>
  );

  const grid = (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(event) => {
        const w = event.nativeEvent.layout.width;
        if (w !== gridWidth) setGridWidth(w);
      }}
    >
      <FlatList
        data={filteredAssets}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        style={{ flex: 1, minHeight: 0 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.md,
          paddingBottom: spacing.lg
        }}
        columnWrapperStyle={{ gap: spacing.sm }}
        key={String(columns)}
        initialNumToRender={24}
        maxToRenderPerBatch={24}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        renderItem={renderTile}
        ListHeaderComponent={!split ? <View style={{ marginBottom: spacing.md }}>{leftColumn}</View> : null}
        ListEmptyComponent={
          <Card>
            <Text variant="body" style={{ color: colors.slate }}>
              Aucune preuve pour ce filtre.
            </Text>
          </Card>
        }
      />
    </View>
  );

  const detailPanel = (
    <MediaDetailPanel
      asset={selectedAsset}
      linkedTask={linkedTask}
      pinHint={pinHint}
      busy={busy}
      onClose={closeDetail}
      onLinkTask={linkTask}
      onUnlinkTask={unlinkTask}
      onCreateTaskFromProof={createTaskFromProof}
      onLinkPin={linkPin}
      onUnlinkPin={unlinkPin}
      onRetryUpload={retryUpload}
      onOpenFile={openFile}
    />
  );

  if (!split) {
    return (
      <Screen>
        {grid}

        <Modal visible={detail.open} animationType="slide" onRequestClose={closeDetail}>
          <Screen>{detailPanel}</Screen>
        </Modal>

        {activeOrgId ? (
          <TaskPickerModal
            visible={taskPickerOpen}
            projectId={effectiveProjectId}
            orgId={activeOrgId}
            onClose={() => setTaskPickerOpen(false)}
            onPick={onPickTask}
          />
        ) : null}

        <PinPickerModal
          visible={pinPickerOpen}
          projectId={effectiveProjectId}
          onClose={() => setPinPickerOpen(false)}
          onPick={onPickPin}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: spacing.md }}>
        <ScrollView style={{ width: 360, minHeight: 0 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
          {leftColumn}
        </ScrollView>
        <View style={{ flex: 1, minHeight: 0 }}>
          {grid}
        </View>
        {detail.open ? <View style={{ width: panelWidth, minHeight: 0 }}>{detailPanel}</View> : null}
      </View>

      {activeOrgId ? (
        <TaskPickerModal
          visible={taskPickerOpen}
          projectId={effectiveProjectId}
          orgId={activeOrgId}
          onClose={() => setTaskPickerOpen(false)}
          onPick={onPickTask}
        />
      ) : null}

      <PinPickerModal visible={pinPickerOpen} projectId={effectiveProjectId} onClose={() => setPinPickerOpen(false)} onPick={onPickPin} />
    </Screen>
  );
}
