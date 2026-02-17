import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { useAuth } from '../../core/auth';
import { Document, DocumentVersion, documents } from '../../data/documents';
import { MediaAsset, media } from '../../data/media';
import {
  PinLinkCounts,
  PlanPin,
  PlanPinLink,
  PlanPinLinkEntity,
  PlanPinPriority,
  PlanPinStatus,
  plans
} from '../../data/plans-annotations';
import { tasks } from '../../data/tasks';
import { useAppNavigationContext } from '../../navigation/contextStore';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const DEMO_PROJECT_ID = 'chantier-conformeo-demo';

const STATUS_FILTERS: Array<{ key: PlanPinStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'Tous' },
  { key: 'OPEN', label: 'Ouverts' },
  { key: 'DONE', label: 'Faits' },
  { key: 'INFO', label: 'Info' }
];

const PRIORITY_FILTERS: Array<{ key: PlanPinPriority | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'Toutes' },
  { key: 'HIGH', label: 'Haute' },
  { key: 'MEDIUM', label: 'Moyenne' },
  { key: 'LOW', label: 'Basse' }
];

type TaskLinkFilter = 'ALL' | 'WITH_TASK' | 'WITHOUT_TASK';

type ResolvedLink = {
  link: PlanPinLink;
  title: string;
  subtitle?: string;
  thumbPath?: string;
};

type ViewerHandle = {
  centerOn: (coords: { x: number; y: number }) => void;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function parsePageInput(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function isPdf(asset: MediaAsset) {
  return asset.mime === 'application/pdf';
}

function isImage(asset: MediaAsset) {
  return asset.mime === 'image/webp' || asset.mime === 'image/jpeg';
}

function statusDotColor(status: PlanPinStatus, colors: { teal: string; mint: string; amber: string }) {
  if (status === 'OPEN') return colors.teal;
  if (status === 'DONE') return colors.mint;
  return colors.amber;
}

function priorityLabel(priority: PlanPinPriority) {
  if (priority === 'HIGH') return 'Haute';
  if (priority === 'MEDIUM') return 'Moyenne';
  return 'Basse';
}

type PlanViewerProps = {
  asset: MediaAsset | null;
  pins: PlanPin[];
  selectedPinId: string | null;
  addMode: boolean;
  onSelectPin: (pin: PlanPin) => void;
  onCreatePin: (x: number, y: number) => void;
  onOpenPdf: (asset: MediaAsset) => void;
};

const PlanViewer = React.forwardRef<ViewerHandle, PlanViewerProps>(function PlanViewerInner(
  { asset, pins, selectedPinId, addMode, onSelectPin, onCreatePin, onOpenPdf },
  ref
) {
  const { colors, spacing, radii } = useTheme();
  const scrollRef = useRef<ScrollView | null>(null);
  const zoomScaleRef = useRef(1);
  const viewportRef = useRef({ width: 0, height: 0 });

  const naturalSize = useMemo(() => {
    if (!asset) return null;
    if (!isImage(asset)) return null;
    if (typeof asset.width !== 'number' || typeof asset.height !== 'number') return null;
    if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height)) return null;
    if (asset.width <= 0 || asset.height <= 0) return null;
    return { width: asset.width, height: asset.height };
  }, [asset]);

  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const fit = useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return { width: 0, height: 0 };
    }

    if (!naturalSize) {
      return { width: viewport.width, height: viewport.height };
    }

    const scale = Math.min(viewport.width / naturalSize.width, viewport.height / naturalSize.height);
    return {
      width: Math.max(1, Math.floor(naturalSize.width * scale)),
      height: Math.max(1, Math.floor(naturalSize.height * scale))
    };
  }, [naturalSize, viewport.height, viewport.width]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const zoomScale = (event.nativeEvent as unknown as { zoomScale?: number }).zoomScale;
    if (typeof zoomScale === 'number' && Number.isFinite(zoomScale)) {
      zoomScaleRef.current = zoomScale;
    }
  }, []);

  const centerOn = useCallback((coords: { x: number; y: number }) => {
    const z = zoomScaleRef.current;
    const vp = viewportRef.current;
    if (!scrollRef.current) return;
    if (vp.width <= 0 || vp.height <= 0) return;
    if (fit.width <= 0 || fit.height <= 0) return;

    const contentW = fit.width * z;
    const contentH = fit.height * z;

    const rawX = coords.x * contentW - vp.width / 2;
    const rawY = coords.y * contentH - vp.height / 2;

    const maxX = Math.max(0, contentW - vp.width);
    const maxY = Math.max(0, contentH - vp.height);

    const clampedX = Math.max(0, Math.min(rawX, maxX));
    const clampedY = Math.max(0, Math.min(rawY, maxY));

    scrollRef.current.scrollTo({ x: clampedX, y: clampedY, animated: true });
  }, [fit.height, fit.width]);

  useImperativeHandle(ref, () => ({ centerOn }), [centerOn]);

  const onTap = useCallback(
    (event: GestureResponderEvent) => {
      if (!addMode) return;
      if (fit.width <= 0 || fit.height <= 0) return;

      const x = event.nativeEvent.locationX / fit.width;
      const y = event.nativeEvent.locationY / fit.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;

      onCreatePin(Number(x.toFixed(6)), Number(y.toFixed(6)));
    },
    [addMode, fit.height, fit.width, onCreatePin]
  );

  const renderPin = useCallback(
    (pin: PlanPin) => {
      const isSelected = pin.id === selectedPinId;
      const left = pin.x * fit.width;
      const top = pin.y * fit.height;
      return (
        <Pressable
          key={pin.id}
          onPress={() => onSelectPin(pin)}
          style={{
            position: 'absolute',
            left,
            top,
            width: isSelected ? 22 : 18,
            height: isSelected ? 22 : 18,
            borderRadius: 999,
            marginLeft: isSelected ? -11 : -9,
            marginTop: isSelected ? -11 : -9,
            borderWidth: 2,
            borderColor: colors.white,
            backgroundColor: statusDotColor(pin.status, {
              teal: colors.teal,
              mint: colors.mint,
              amber: colors.amber
            }),
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Text variant="caption" style={{ color: colors.ink, fontSize: 10 }}>
            {pin.page_number}
          </Text>
        </Pressable>
      );
    },
    [colors.amber, colors.ink, colors.mint, colors.teal, colors.white, fit.height, fit.width, onSelectPin, selectedPinId]
  );

  const view = (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setViewport({ width, height });
      }}
      style={{
        flex: 1,
        minHeight: 0,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: addMode ? colors.teal : colors.fog,
        overflow: 'hidden',
        backgroundColor: colors.sand
      }}
    >
      {asset ? (
        isImage(asset) ? (
          <ScrollView
            ref={(node) => {
              scrollRef.current = node;
            }}
            style={{ flex: 1 }}
            contentContainerStyle={{
              width: viewport.width,
              height: viewport.height,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            minimumZoomScale={1}
            maximumZoomScale={4}
            bouncesZoom
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              onPress={onTap}
              style={{
                width: fit.width,
                height: fit.height,
                position: 'relative',
                backgroundColor: colors.fog
              }}
            >
              <Image source={{ uri: asset.local_path }} style={{ width: fit.width, height: fit.height }} resizeMode="stretch" />
              {pins.map(renderPin)}
            </Pressable>
          </ScrollView>
        ) : (
          <Pressable onPress={onTap} style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
            <Text variant="bodyStrong" style={{ textAlign: 'center' }}>
              Apercu PDF non disponible dans ce build.
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs, textAlign: 'center' }}>
              Vous pouvez ouvrir le fichier dans le viewer iOS. Le placement des pins reste possible (coordonnees normalisees).
            </Text>
            <View style={{ marginTop: spacing.md, alignSelf: 'center' }}>
              <Button label="Ouvrir le PDF" kind="ghost" onPress={() => onOpenPdf(asset)} />
            </View>
            <View style={{ marginTop: spacing.lg, flex: 1 }}>
              <View style={{ flex: 1, minHeight: 220, borderRadius: radii.md, backgroundColor: colors.fog, position: 'relative' }}>
                {pins.map((pin) => {
                  const isSelected = pin.id === selectedPinId;
                  return (
                    <Pressable
                      key={pin.id}
                      onPress={() => onSelectPin(pin)}
                      style={{
                        position: 'absolute',
                        left: `${pin.x * 100}%`,
                        top: `${pin.y * 100}%`,
                        width: isSelected ? 22 : 18,
                        height: isSelected ? 22 : 18,
                        borderRadius: 999,
                        marginLeft: isSelected ? -11 : -9,
                        marginTop: isSelected ? -11 : -9,
                        borderWidth: 2,
                        borderColor: colors.white,
                        backgroundColor: statusDotColor(pin.status, {
                          teal: colors.teal,
                          mint: colors.mint,
                          amber: colors.amber
                        }),
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Text variant="caption" style={{ color: colors.ink, fontSize: 10 }}>
                        {pin.page_number}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Pressable>
        )
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
          <Text variant="bodyStrong" style={{ textAlign: 'center' }}>
            Aucun plan selectionne.
          </Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs, textAlign: 'center' }}>
            Selectionnez un plan a gauche, puis activez le mode ajout pour poser des pins.
          </Text>
        </View>
      )}
    </View>
  );

  return view;
});

function PinDetailPanel({
  pin,
  links,
  busy,
  onClose,
  onUpdate,
  onDelete,
  onCreateLinkedTask,
  onAddProof,
  onLink,
  onUnlink
}: {
  pin: PlanPin | null;
  links: ResolvedLink[];
  busy: boolean;
  onClose?: () => void;
  onUpdate: (patch: { label?: string; status?: PlanPinStatus; priority?: PlanPinPriority; comment?: string }) => void;
  onDelete: () => void;
  onCreateLinkedTask: () => void;
  onAddProof: (source: 'capture' | 'import') => void;
  onLink: (entity: PlanPinLinkEntity, entityId: string) => void;
  onUnlink: (entity: PlanPinLinkEntity, entityId: string) => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const [labelDraft, setLabelDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [linkEntity, setLinkEntity] = useState<PlanPinLinkEntity>('TASK');
  const [linkEntityId, setLinkEntityId] = useState('');

  useEffect(() => {
    setLabelDraft(pin?.label ?? '');
    setCommentDraft(pin?.comment ?? '');
    setLinkEntity('TASK');
    setLinkEntityId('');
  }, [pin?.id]);

  if (!pin) {
    return (
      <Card style={{ flex: 1, minHeight: 0 }}>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Text variant="h2">Point du plan</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Selectionnez un pin pour voir / modifier ses details.
          </Text>
        </ScrollView>
      </Card>
    );
  }

  return (
    <Card style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={1}>
              {pin.label || `Point ${pin.id.slice(0, 6)}`}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Page {pin.page_number} · {pin.status} · Priorite {priorityLabel(pin.priority)}
            </Text>
          </View>
          {onClose ? <Button label="Fermer" kind="ghost" onPress={onClose} /> : null}
        </View>

        <TextInput
          value={labelDraft}
          onChangeText={setLabelDraft}
          placeholder="Label"
          placeholderTextColor={colors.slate}
          style={{
            marginTop: spacing.md,
            borderWidth: 1,
            borderColor: colors.fog,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.white
          }}
        />

        <TextInput
          value={commentDraft}
          onChangeText={setCommentDraft}
          placeholder="Commentaire"
          placeholderTextColor={colors.slate}
          multiline
          style={{
            marginTop: spacing.sm,
            borderWidth: 1,
            borderColor: colors.fog,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.white,
            minHeight: 88,
            textAlignVertical: 'top'
          }}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="Enregistrer" onPress={() => onUpdate({ label: labelDraft, comment: commentDraft })} disabled={busy} />
          <Button label="Supprimer" kind="ghost" onPress={onDelete} disabled={busy} />
        </View>

        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.md }}>
          Statut
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          {(['OPEN', 'DONE', 'INFO'] as PlanPinStatus[]).map((status) => (
            <Button
              key={status}
              label={status}
              kind={pin.status === status ? 'primary' : 'ghost'}
              onPress={() => onUpdate({ status })}
              disabled={busy}
            />
          ))}
        </View>

        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.md }}>
          Priorite
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          {(['LOW', 'MEDIUM', 'HIGH'] as PlanPinPriority[]).map((priority) => (
            <Button
              key={priority}
              label={priority}
              kind={pin.priority === priority ? 'primary' : 'ghost'}
              onPress={() => onUpdate({ priority })}
              disabled={busy}
            />
          ))}
        </View>

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Actions rapides
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="Creer tache liee" onPress={onCreateLinkedTask} disabled={busy} />
          <Button label="Photo" kind="ghost" onPress={() => onAddProof('capture')} disabled={busy} />
          <Button label="Importer" kind="ghost" onPress={() => onAddProof('import')} disabled={busy} />
        </View>

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Liens
        </Text>
        {links.length === 0 ? (
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Aucun lien.
          </Text>
        ) : (
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {links.slice(0, 30).map((item) => (
              <View
                key={item.link.id}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  backgroundColor: colors.white
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  {item.thumbPath ? (
                    <Image
                      source={{ uri: item.thumbPath }}
                      style={{ width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.fog }}
                    />
                  ) : null}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      [{item.link.entity}] {item.title}
                    </Text>
                    {item.subtitle ? (
                      <Text variant="caption" style={{ color: colors.slate }} numberOfLines={2}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <Button
                    label="Retirer"
                    kind="ghost"
                    onPress={() => onUnlink(item.link.entity, item.link.entity_id)}
                    disabled={busy}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.lg }}>
          Lien manuel (debug/MVP)
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          {(['TASK', 'MEDIA', 'DOCUMENT'] as PlanPinLinkEntity[]).map((entity) => (
            <Button
              key={entity}
              label={entity}
              kind={linkEntity === entity ? 'primary' : 'ghost'}
              onPress={() => setLinkEntity(entity)}
              disabled={busy}
            />
          ))}
        </View>
        <TextInput
          value={linkEntityId}
          onChangeText={setLinkEntityId}
          placeholder="entity_id (uuid)"
          placeholderTextColor={colors.slate}
          style={{
            marginTop: spacing.sm,
            borderWidth: 1,
            borderColor: colors.fog,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.white
          }}
        />
        <View style={{ marginTop: spacing.sm }}>
          <Button
            label="Ajouter le lien"
            kind="ghost"
            onPress={() => {
              const id = normalizeText(linkEntityId);
              if (!id) return;
              onLink(linkEntity, id);
              setLinkEntityId('');
            }}
            disabled={busy}
          />
        </View>
      </ScrollView>
    </Card>
  );
}

export function PlansScreen({ projectId }: { projectId?: string } = {}) {
  const { colors, spacing, radii } = useTheme();
  const { width } = useWindowDimensions();
  const split = width >= 980;

  const { activeOrgId, user } = useAuth();
  const navCtx = useAppNavigationContext();
  const effectiveProjectId = projectId ?? navCtx.projectId ?? DEMO_PROJECT_ID;

  const viewerRef = useRef<ViewerHandle | null>(null);

  const [planDocuments, setPlanDocuments] = useState<Document[]>([]);
  const [planQuery, setPlanQuery] = useState('');

  const [openResult, setOpenResult] = useState<{ document: Document; version: DocumentVersion; versions: DocumentVersion[] } | null>(null);
  const [activeAsset, setActiveAsset] = useState<MediaAsset | null>(null);

  const [pins, setPins] = useState<PlanPin[]>([]);
  const [linkCounts, setLinkCounts] = useState<Record<string, PinLinkCounts>>({});

  const [filterStatus, setFilterStatus] = useState<PlanPinStatus | 'ALL'>('ALL');
  const [filterPriority, setFilterPriority] = useState<PlanPinPriority | 'ALL'>('ALL');
  const [filterTasks, setFilterTasks] = useState<TaskLinkFilter>('ALL');

  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');

  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedPinLinks, setSelectedPinLinks] = useState<ResolvedLink[]>([]);

  const [addMode, setAddMode] = useState(false);
  const [quickLabel, setQuickLabel] = useState('');
  const [quickStatus, setQuickStatus] = useState<PlanPinStatus>('OPEN');
  const [quickPriority, setQuickPriority] = useState<PlanPinPriority>('MEDIUM');

  const [detailOpen, setDetailOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    plans.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
  }, [activeOrgId, user?.id]);

  const selectedPin = useMemo(() => pins.find((pin) => pin.id === selectedPinId) ?? null, [pins, selectedPinId]);

  const visiblePlans = useMemo(() => {
    const q = normalizeText(planQuery).toLowerCase();
    if (!q) return planDocuments;
    return planDocuments.filter((doc) => doc.title.toLowerCase().includes(q));
  }, [planDocuments, planQuery]);

  const maxKnownPage = useMemo(() => {
    const maxFromPins = pins.reduce((max, pin) => Math.max(max, pin.page_number), 1);
    return Math.max(1, maxFromPins, currentPage);
  }, [currentPage, pins]);

  const pagePins = useMemo(() => pins.filter((pin) => pin.page_number === currentPage), [currentPage, pins]);

  const filteredPins = useMemo(() => {
    let list = pins;
    if (filterPriority !== 'ALL') {
      list = list.filter((pin) => pin.priority === filterPriority);
    }

    if (filterTasks !== 'ALL') {
      list = list.filter((pin) => {
        const counts = linkCounts[pin.id];
        const hasTask = (counts?.tasks ?? 0) > 0;
        return filterTasks === 'WITH_TASK' ? hasTask : !hasTask;
      });
    }

    return list;
  }, [filterPriority, filterTasks, linkCounts, pins]);

  const refreshLinks = useCallback(async (pinId: string | null) => {
    if (!pinId) {
      setSelectedPinLinks([]);
      return;
    }

    const links = await plans.listLinks(pinId);

    const resolved = await Promise.all(
      links.map(async (link): Promise<ResolvedLink> => {
        if (link.entity === 'TASK') {
          const task = await tasks.getById(link.entity_id);
          return {
            link,
            title: task?.title ?? `Tache ${link.entity_id}`,
            subtitle: task ? `${task.status} · ${task.priority}` : 'Tache introuvable'
          };
        }

        if (link.entity === 'DOCUMENT') {
          const document = await documents.getById(link.entity_id);
          return {
            link,
            title: document?.title ?? `Document ${link.entity_id}`,
            subtitle: document ? `${document.doc_type} · ${document.status}` : 'Document introuvable'
          };
        }

        const asset = await media.getById(link.entity_id);
        return {
          link,
          title: asset?.tag ?? `Media ${link.entity_id}`,
          subtitle: asset ? `${asset.mime} · ${asset.upload_status}` : 'Media introuvable',
          thumbPath: asset?.local_thumb_path
        };
      })
    );

    setSelectedPinLinks(resolved);
  }, []);

  const openPlan = useCallback(
    async (documentId: string, versionId?: string) => {
      setLoading(true);
      setError(null);

      try {
        const opened = await plans.setActivePlan(effectiveProjectId, documentId, versionId);
        setOpenResult(opened);
        setSelectedPinId(null);
        setSelectedPinLinks([]);
        setAddMode(false);
        setCurrentPage(1);
        setPageInput('1');

        const asset = await media.getById(opened.version.file_asset_id);
        setActiveAsset(asset);
      } catch (openError) {
        const message = openError instanceof Error ? openError.message : 'Ouverture du plan impossible.';
        setError(message);
        setOpenResult(null);
        setActiveAsset(null);
        setPins([]);
        setLinkCounts({});
      } finally {
        setLoading(false);
      }
    },
    [effectiveProjectId]
  );

  const refreshPlans = useCallback(async () => {
    if (!activeOrgId) {
      setPlanDocuments([]);
      setOpenResult(null);
      setActiveAsset(null);
      setPins([]);
      setLinkCounts({});
      setSelectedPinId(null);
      setSelectedPinLinks([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await plans.listProjectPlans(effectiveProjectId);
      setPlanDocuments(list);

      const opened = await plans.openActive(effectiveProjectId);
      if (!opened) {
        setOpenResult(null);
        setActiveAsset(null);
        setPins([]);
        setLinkCounts({});
        return;
      }

      setOpenResult(opened);
      const asset = await media.getById(opened.version.file_asset_id);
      setActiveAsset(asset);
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Chargement des plans impossible.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, effectiveProjectId]);

  const refreshPins = useCallback(async () => {
    if (!openResult) {
      setPins([]);
      setLinkCounts({});
      return;
    }

    try {
      const nextPins = await plans.listPins(openResult.document.id, openResult.version.id, {
        status: filterStatus,
        limit: 1000
      });

      setPins(nextPins);

      const counts = await plans.getLinkCounts(nextPins.map((pin) => pin.id));
      setLinkCounts(counts);

      if (selectedPinId && !nextPins.some((pin) => pin.id === selectedPinId)) {
        setSelectedPinId(null);
        setSelectedPinLinks([]);
      }
    } catch (pinsError) {
      const message = pinsError instanceof Error ? pinsError.message : 'Chargement des pins impossible.';
      setError(message);
    }
  }, [filterStatus, openResult, selectedPinId]);

  useEffect(() => {
    void refreshPlans();
  }, [refreshPlans]);

  useEffect(() => {
    void refreshPins();
  }, [refreshPins]);

  useEffect(() => {
    if (!selectedPinId) {
      setSelectedPinLinks([]);
      return;
    }

    void refreshLinks(selectedPinId);
  }, [refreshLinks, selectedPinId]);

  useEffect(() => {
    if (pins.length === 0) return;
    const max = pins.reduce((value, pin) => Math.max(value, pin.page_number), 1);
    if (currentPage > max) {
      setCurrentPage(max);
      setPageInput(String(max));
    }
  }, [currentPage, pins]);

  const selectPin = useCallback(
    async (pin: PlanPin) => {
      setSelectedPinId(pin.id);
      setDetailOpen(true);
      setCurrentPage(pin.page_number);
      setPageInput(String(pin.page_number));
      viewerRef.current?.centerOn({ x: pin.x, y: pin.y });
      await refreshLinks(pin.id);
    },
    [refreshLinks]
  );

  const createPinAt = useCallback(
    async (x: number, y: number) => {
      if (!openResult) {
        return;
      }

      setBusy(true);
      setError(null);

      try {
        const created = await plans.createPin(
          {
            documentId: openResult.document.id,
            versionId: openResult.version.id,
            page: currentPage,
            x,
            y,
            projectId: openResult.document.project_id ?? effectiveProjectId
          },
          {
            label: quickLabel,
            status: quickStatus,
            priority: quickPriority,
            created_by: user?.id
          }
        );

        await refreshPins();
        await selectPin(created);
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : 'Creation du pin impossible.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [
      currentPage,
      effectiveProjectId,
      openResult,
      quickLabel,
      quickPriority,
      quickStatus,
      refreshPins,
      selectPin,
      user?.id
    ]
  );

  const updateSelectedPin = useCallback(
    async (patch: { label?: string; status?: PlanPinStatus; priority?: PlanPinPriority; comment?: string }) => {
      if (!selectedPin) return;

      setBusy(true);
      setError(null);

      try {
        await plans.updatePin(selectedPin.id, patch);
        await refreshPins();
        await refreshLinks(selectedPin.id);
      } catch (updateError) {
        const message = updateError instanceof Error ? updateError.message : 'Mise a jour du pin impossible.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [refreshLinks, refreshPins, selectedPin]
  );

  const deleteSelectedPin = useCallback(async () => {
    if (!selectedPin) return;

    setBusy(true);
    setError(null);

    try {
      await plans.deletePin(selectedPin.id);
      setSelectedPinId(null);
      setSelectedPinLinks([]);
      await refreshPins();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Suppression du pin impossible.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [refreshPins, selectedPin]);

  const createLinkedTask = useCallback(async () => {
    if (!selectedPin) return;

    setBusy(true);
    setError(null);

    try {
      await plans.createTaskFromPin(selectedPin.id, {
        title: selectedPin.label ?? `Point plan p.${selectedPin.page_number}`,
        description: selectedPin.comment,
        status: selectedPin.status === 'DONE' ? 'DONE' : 'TODO',
        priority: selectedPin.priority,
        tags: ['plan_pin']
      });

      await refreshLinks(selectedPin.id);
      await refreshPins();
    } catch (taskError) {
      const message = taskError instanceof Error ? taskError.message : 'Creation tache liee impossible.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [refreshLinks, refreshPins, selectedPin]);

  const addProofToPin = useCallback(
    async (source: 'capture' | 'import') => {
      if (!selectedPin || !activeOrgId) return;

      setBusy(true);
      setError(null);

      try {
        if (source === 'capture') {
          await plans.addPhotoToPin(selectedPin.id);
        } else {
          const assets = await media.importFiles({
            org_id: activeOrgId,
            project_id: selectedPin.project_id,
            plan_pin_id: selectedPin.id,
            tag: 'plan_pin'
          });

          for (const asset of assets) {
            await plans.link(selectedPin.id, 'MEDIA', asset.id);
          }
        }

        await refreshLinks(selectedPin.id);
        await refreshPins();
      } catch (attachError) {
        const message = attachError instanceof Error ? attachError.message : 'Ajout de preuve impossible.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, refreshLinks, refreshPins, selectedPin]
  );

  const addManualLink = useCallback(
    async (entity: PlanPinLinkEntity, entityId: string) => {
      if (!selectedPin) return;

      setBusy(true);
      setError(null);

      try {
        await plans.link(selectedPin.id, entity, entityId);
        await refreshLinks(selectedPin.id);
        await refreshPins();
      } catch (linkError) {
        const message = linkError instanceof Error ? linkError.message : 'Creation du lien impossible.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [refreshLinks, refreshPins, selectedPin]
  );

  const removeLink = useCallback(
    async (entity: PlanPinLinkEntity, entityId: string) => {
      if (!selectedPin) return;

      setBusy(true);
      setError(null);

      try {
        await plans.unlink(selectedPin.id, entity, entityId);
        await refreshLinks(selectedPin.id);
        await refreshPins();
      } catch (unlinkError) {
        const message = unlinkError instanceof Error ? unlinkError.message : 'Suppression du lien impossible.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [refreshLinks, refreshPins, selectedPin]
  );

  const openPdf = useCallback(async (asset: MediaAsset) => {
    if (!isPdf(asset)) return;

    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        throw new Error('Partage iOS indisponible sur cet appareil.');
      }
      await Sharing.shareAsync(asset.local_path, { mimeType: 'application/pdf' });
    } catch (shareError) {
      const message = shareError instanceof Error ? shareError.message : 'Ouverture du PDF impossible.';
      setError(message);
    }
  }, []);

  const importPlan = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide pour importer un plan.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const doc = await documents.create({
        org_id: activeOrgId,
        scope: 'PROJECT',
        project_id: effectiveProjectId,
        title: `Plan ${new Date().toLocaleDateString('fr-FR')}`,
        doc_type: 'PLAN',
        status: 'DRAFT',
        tags: ['plan'],
        created_by: user.id
      });

      const version = await documents.addVersion(doc.id, { source: 'import', tag: 'plan' });
      await openPlan(doc.id, version.id);
      await refreshPlans();
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : 'Import du plan impossible.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, effectiveProjectId, openPlan, refreshPlans, user?.id]);

  const applyPageInput = useCallback(
    (raw: string) => {
      setPageInput(raw);
      const parsed = parsePageInput(raw, currentPage);
      setCurrentPage(parsed);
    },
    [currentPage]
  );

  const jumpPrevPage = useCallback(() => {
    const next = Math.max(1, currentPage - 1);
    setCurrentPage(next);
    setPageInput(String(next));
  }, [currentPage]);

  const jumpNextPage = useCallback(() => {
    const next = currentPage + 1;
    setCurrentPage(next);
    setPageInput(String(next));
  }, [currentPage]);

  const renderPinRow = useCallback(
    ({ item }: { item: PlanPin }) => {
      const isSelected = item.id === selectedPinId;
      const counts = linkCounts[item.id] ?? { tasks: 0, media: 0, documents: 0 };

      return (
        <Pressable
          onPress={() => void selectPin(item)}
          style={{
            borderWidth: 1,
            borderColor: isSelected ? colors.teal : colors.fog,
            borderRadius: radii.md,
            backgroundColor: isSelected ? colors.mint : colors.white,
            padding: spacing.md,
            marginBottom: spacing.sm
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {item.label || `Point ${item.id.slice(0, 6)}`}
              </Text>
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
                Page {item.page_number} · {item.status} · Priorite {priorityLabel(item.priority)}
              </Text>
              <Text variant="caption" style={{ color: colors.slate }} numberOfLines={1}>
                T:{counts.tasks} · P:{counts.media} · D:{counts.documents}
              </Text>
            </View>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: statusDotColor(item.status, {
                  teal: colors.teal,
                  mint: colors.mint,
                  amber: colors.amber
                })
              }}
            />
          </View>
        </Pressable>
      );
    },
    [
      colors.amber,
      colors.fog,
      colors.mint,
      colors.slate,
      colors.teal,
      colors.white,
      radii.md,
      selectPin,
      selectedPinId,
      spacing.md,
      spacing.sm,
      spacing.xs,
      linkCounts
    ]
  );

  const leftColumn = (
    <FlatList
      data={filteredPins}
      keyExtractor={(item) => item.id}
      style={{ flex: 1, minHeight: 0 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator
      contentContainerStyle={{ paddingBottom: spacing.lg }}
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
          <SectionHeader
            title="Plans"
            subtitle="Plans (documents) + pins normalises (x,y 0..1) + liens taches / preuves / docs. Offline-first."
          />

          <Card>
            <Text variant="h2">Plans disponibles</Text>
            <TextInput
              value={planQuery}
              onChangeText={setPlanQuery}
              placeholder="Rechercher un plan"
              placeholderTextColor={colors.slate}
              style={{
                marginTop: spacing.sm,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                backgroundColor: colors.white
              }}
            />

            {visiblePlans.length === 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucun plan local.
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button label="Importer un plan PDF" onPress={() => void importPlan()} disabled={busy} />
                  <Button label="Rafraichir" kind="ghost" onPress={() => void refreshPlans()} disabled={busy} />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                {visiblePlans.slice(0, 16).map((document) => {
                  const isActive = document.id === openResult?.document.id;
                  return (
                    <Pressable
                      key={document.id}
                      onPress={() => void openPlan(document.id)}
                      style={{
                        borderWidth: 1,
                        borderColor: isActive ? colors.teal : colors.fog,
                        backgroundColor: isActive ? colors.mint : colors.white,
                        borderRadius: radii.pill,
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                        maxWidth: 260
                      }}
                    >
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {document.title}
                      </Text>
                      <Text variant="caption" style={{ color: colors.slate }} numberOfLines={1}>
                        {document.scope} · {document.status}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {openResult ? (
              <View style={{ marginTop: spacing.md }}>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Plan actif: {openResult.document.title}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  {openResult.versions.slice(0, 10).map((version) => {
                    const isActive = openResult.version.id === version.id;
                    return (
                      <Button
                        key={version.id}
                        label={`v${version.version_number}`}
                        kind={isActive ? 'primary' : 'ghost'}
                        onPress={() => void openPlan(openResult.document.id, version.id)}
                        disabled={busy}
                      />
                    );
                  })}
                </View>

                {openResult.document.active_version_id && openResult.version.id !== openResult.document.active_version_id ? (
                  <Text variant="caption" style={{ color: colors.amber, marginTop: spacing.sm }}>
                    Attention: vous annotez une ancienne version du plan.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {error ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}
          </Card>

          <Card>
            <Text variant="h2">Filtres points</Text>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Statut
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              {STATUS_FILTERS.map((chip) => (
                <Button
                  key={chip.key}
                  label={chip.label}
                  kind={filterStatus === chip.key ? 'primary' : 'ghost'}
                  onPress={() => setFilterStatus(chip.key)}
                  disabled={busy}
                />
              ))}
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.md }}>
              Priorite
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              {PRIORITY_FILTERS.map((chip) => (
                <Button
                  key={chip.key}
                  label={chip.label}
                  kind={filterPriority === chip.key ? 'primary' : 'ghost'}
                  onPress={() => setFilterPriority(chip.key)}
                  disabled={busy}
                />
              ))}
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.md }}>
              Taches liees
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              <Button label="Tous" kind={filterTasks === 'ALL' ? 'primary' : 'ghost'} onPress={() => setFilterTasks('ALL')} />
              <Button
                label="Avec tache"
                kind={filterTasks === 'WITH_TASK' ? 'primary' : 'ghost'}
                onPress={() => setFilterTasks('WITH_TASK')}
              />
              <Button
                label="Sans tache"
                kind={filterTasks === 'WITHOUT_TASK' ? 'primary' : 'ghost'}
                onPress={() => setFilterTasks('WITHOUT_TASK')}
              />
            </View>
          </Card>
        </View>
      }
      renderItem={renderPinRow}
      ListEmptyComponent={
        openResult ? (
          <Card>
            <Text variant="bodyStrong">Aucun pin</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Activez le mode ajout dans le viewer puis tapez sur le plan pour creer un point.
            </Text>
          </Card>
        ) : null
      }
    />
  );

  const viewerToolbar = (
    <Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="bodyStrong">Page</Text>
        <Button label="-" kind="ghost" onPress={jumpPrevPage} disabled={busy} />
        <TextInput
          value={pageInput}
          onChangeText={applyPageInput}
          keyboardType="number-pad"
          placeholder="1"
          placeholderTextColor={colors.slate}
          style={{
            width: 72,
            borderWidth: 1,
            borderColor: colors.fog,
            borderRadius: radii.md,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            backgroundColor: colors.white
          }}
        />
        <Button label="+" kind="ghost" onPress={jumpNextPage} disabled={busy} />
        <Text variant="caption" style={{ color: colors.slate }}>
          max: {maxKnownPage}
        </Text>

        <View style={{ flex: 1 }} />

        <Button
          label={addMode ? 'Ajout: ON' : 'Ajout: OFF'}
          kind={addMode ? 'primary' : 'ghost'}
          onPress={() => setAddMode((value) => !value)}
          disabled={busy || !openResult}
        />
        <Button label="Rafraichir" kind="ghost" onPress={() => void refreshPins()} disabled={busy || !openResult} />
      </View>

      <TextInput
        value={quickLabel}
        onChangeText={setQuickLabel}
        placeholder="Label par defaut (optionnel)"
        placeholderTextColor={colors.slate}
        style={{
          marginTop: spacing.sm,
          borderWidth: 1,
          borderColor: colors.fog,
          borderRadius: radii.md,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          backgroundColor: colors.white
        }}
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
        {(['OPEN', 'DONE', 'INFO'] as PlanPinStatus[]).map((status) => (
          <Button key={status} label={status} kind={quickStatus === status ? 'primary' : 'ghost'} onPress={() => setQuickStatus(status)} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
        {(['LOW', 'MEDIUM', 'HIGH'] as PlanPinPriority[]).map((priority) => (
          <Button
            key={priority}
            label={priority}
            kind={quickPriority === priority ? 'primary' : 'ghost'}
            onPress={() => setQuickPriority(priority)}
          />
        ))}
      </View>
    </Card>
  );

  const rightColumn = (
    <View style={{ flex: 1, minHeight: 0, gap: spacing.md, position: 'relative' }}>
      {viewerToolbar}

      <View style={{ flex: 1, minHeight: 0 }}>
        <PlanViewer
          ref={viewerRef}
          asset={activeAsset}
          pins={pagePins}
          selectedPinId={selectedPinId}
          addMode={addMode}
          onSelectPin={selectPin}
          onCreatePin={createPinAt}
          onOpenPdf={openPdf}
        />
      </View>

      {!split ? (
        <Modal animationType="slide" visible={detailOpen} onRequestClose={() => setDetailOpen(false)}>
          <Screen>
            <PinDetailPanel
              pin={selectedPin}
              links={selectedPinLinks}
              busy={busy}
              onClose={() => setDetailOpen(false)}
              onUpdate={updateSelectedPin}
              onDelete={() => void deleteSelectedPin()}
              onCreateLinkedTask={() => void createLinkedTask()}
              onAddProof={(source) => void addProofToPin(source)}
              onLink={(entity, id) => void addManualLink(entity, id)}
              onUnlink={(entity, id) => void removeLink(entity, id)}
            />
          </Screen>
        </Modal>
      ) : (
        <View style={{ position: 'absolute', top: spacing.md, right: spacing.md, bottom: spacing.md, width: 380 }}>
          <PinDetailPanel
            pin={selectedPin}
            links={selectedPinLinks}
            busy={busy}
            onUpdate={updateSelectedPin}
            onDelete={() => void deleteSelectedPin()}
            onCreateLinkedTask={() => void createLinkedTask()}
            onAddProof={(source) => void addProofToPin(source)}
            onLink={(entity, id) => void addManualLink(entity, id)}
            onUnlink={(entity, id) => void removeLink(entity, id)}
          />
        </View>
      )}
    </View>
  );

  if (!split) {
    return (
      <Screen>
        <View style={{ flex: 1, minHeight: 0, gap: spacing.md }}>
          {leftColumn}
          {rightColumn}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: spacing.md }}>
        <View style={{ width: 420, minHeight: 0 }}>{leftColumn}</View>
        {rightColumn}
      </View>
      {loading ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: spacing.md,
            left: spacing.md,
            right: spacing.md,
            padding: spacing.sm,
            borderRadius: radii.md,
            backgroundColor: colors.fog
          }}
        >
          <Text variant="caption" style={{ color: colors.slate }}>
            Chargement...
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}
