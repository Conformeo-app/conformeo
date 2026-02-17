import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, ScrollView, Share, TextInput, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../core/auth';
import { flags } from '../../data/feature-flags';
import type { ExportJob } from '../../data/exports';
import { exportsDoe } from '../../data/exports';
import type { ShareLink } from '../../data/external-sharing';
import { share } from '../../data/external-sharing';
import type { MediaAsset } from '../../data/media';
import { media } from '../../data/media';
import type { PlanPin } from '../../data/plans-annotations';
import { plans } from '../../data/plans-annotations';
import type { SignatureActor, SignatureRecord } from '../../data/signature-probante';
import { sign } from '../../data/signature-probante';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import type { Task, TaskFilters } from '../../data/tasks';
import { tasks } from '../../data/tasks';
import {
  Document,
  DocumentLink,
  DocumentScope,
  DocumentStatus,
  DocumentsListFilters,
  DocumentType,
  DocumentVersion,
  LinkedEntity,
  documents
} from '../../data/documents';
import { useAppNavigationContext } from '../../navigation/contextStore';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { SignatureModal } from './SignatureModal';

const DEMO_PROJECT_ID = 'chantier-conformeo-demo';
const PAGE_SIZE = 30;

type QuickFilter = 'ALL' | 'PLANS' | 'DOE_REPORTS' | 'PV' | 'SECURITY' | 'OTHER' | 'SIGNED' | 'LINKED_TASK';

const QUICK_FILTERS: Array<{ key: QuickFilter; label: string }> = [
  { key: 'ALL', label: 'Tous' },
  { key: 'PLANS', label: 'Plans' },
  { key: 'DOE_REPORTS', label: 'DOE / Rapports' },
  { key: 'PV', label: 'PV' },
  { key: 'SECURITY', label: 'Sécurité' },
  { key: 'OTHER', label: 'Autres' },
  { key: 'SIGNED', label: 'Signés' },
  { key: 'LINKED_TASK', label: 'Liés à une tâche' }
];

type DetailState = { open: boolean; documentId: string | null };

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function parseTagsCsv(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortDate(value: string) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleDateString('fr-FR');
}

function statusTint(status: DocumentStatus, palette: { amber: string; teal: string; mint: string }) {
  if (status === 'DRAFT') return palette.amber;
  if (status === 'FINAL') return palette.teal;
  return palette.mint;
}

function statusLabel(status: DocumentStatus) {
  if (status === 'DRAFT') return 'Brouillon';
  if (status === 'FINAL') return 'Final';
  return 'Signé';
}

function signatureStatusLabel(status: SignatureRecord['status']) {
  if (status === 'DRAFT') return 'Brouillon';
  if (status === 'PENDING') return 'En attente';
  return 'Finalisée';
}

function isPdfVersion(version: DocumentVersion | null) {
  return Boolean(version && version.file_mime === 'application/pdf');
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
      const filters: TaskFilters = { org_id: orgId, limit: 80, offset: 0 };
      const cleaned = normalizeText(query);
      const next = cleaned ? await tasks.searchByProject(projectId, cleaned, filters) : await tasks.listByProject(projectId, filters);
      setItems(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Chargement tâches impossible.';
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
          <Text variant="h2">Lier à une tâche</Text>
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
                {loading ? 'Chargement...' : 'Aucune tâche.'}
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
      setItems(filtered.slice(0, 150));
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
          <Text variant="h2">Lier à un point de plan</Text>
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

function ExportPickerModal({
  visible,
  projectId,
  onClose,
  onPick
}: {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  onPick: (job: ExportJob) => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const [items, setItems] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await exportsDoe.listByProject(projectId);
      setItems(next.slice(0, 120));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Chargement exports impossible.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [load, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <Card style={{ flex: 1, minHeight: 0 }}>
          <Text variant="h2">Lier à un export</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Exports récents du chantier.
          </Text>

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
                  {item.type} · {item.status}
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                  {formatShortDate(item.created_at)} · {item.id.slice(0, 6)} · {item.size_bytes ? formatBytes(item.size_bytes) : '—'}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text variant="caption" style={{ color: colors.slate }}>
                {loading ? 'Chargement...' : 'Aucun export.'}
              </Text>
            }
          />

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Fermer" kind="ghost" onPress={onClose} disabled={loading} />
          </View>
        </Card>
      </Screen>
    </Modal>
  );
}

function NewDocumentModal({
  visible,
  orgId,
  projectId,
  createdBy,
  onClose,
  onCreated
}: {
  visible: boolean;
  orgId: string;
  projectId: string;
  createdBy: string;
  onClose: () => void;
  onCreated: (documentId: string) => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocumentType>('OTHER');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState<DocumentStatus>('DRAFT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTitle('');
    setDocType('OTHER');
    setTags('');
    setStatus('DRAFT');
    setError(null);
  }, []);

  useEffect(() => {
    if (!visible) {
      reset();
    }
  }, [reset, visible]);

  const createBase = useCallback(async () => {
    const created = await documents.create({
      org_id: orgId,
      scope: 'PROJECT',
      project_id: projectId,
      title,
      doc_type: docType,
      status,
      tags: parseTagsCsv(tags),
      created_by: createdBy
    });
    return created.id;
  }, [createdBy, docType, orgId, projectId, status, tags, title]);

  const onCreateEmpty = useCallback(() => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const id = await createBase();
        onCreated(id);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Création document impossible.');
      } finally {
        setBusy(false);
      }
    })();
  }, [createBase, onClose, onCreated]);

  const onCreateAndImport = useCallback(() => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const id = await createBase();
        try {
          await documents.addVersion(id, { source: 'import', tag: 'document_version' });
        } catch (versionError) {
          // If the user cancels the document picker, keep the document and let them add a version later.
          const message = versionError instanceof Error ? versionError.message : '';
          if (!message.toLowerCase().includes('aucun fichier import')) {
            throw versionError;
          }
        }
        onCreated(id);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Création/import impossible.');
      } finally {
        setBusy(false);
      }
    })();
  }, [createBase, onClose, onCreated]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <Card style={{ flex: 1, minHeight: 0 }}>
          <Text variant="h2">Nouveau document</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Hors ligne d'abord. Tu peux importer le fichier maintenant ou ajouter une version plus tard.
          </Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Titre"
            placeholderTextColor={colors.slate}
            style={{
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              marginTop: spacing.md
            }}
          />

          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Type
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {(['PLAN', 'DOE', 'REPORT', 'PV', 'OTHER'] as DocumentType[]).map((type) => (
                <Button
                  key={type}
                  label={type}
                  kind={docType === type ? 'primary' : 'ghost'}
                  onPress={() => setDocType(type)}
                  disabled={busy}
                />
              ))}
            </View>
          </ScrollView>

          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Statut
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            {(['DRAFT', 'FINAL'] as DocumentStatus[]).map((value) => (
              <Button
                key={value}
                label={value}
                kind={status === value ? 'primary' : 'ghost'}
                onPress={() => setStatus(value)}
                disabled={busy}
              />
            ))}
          </View>

          <TextInput
            value={tags}
            onChangeText={setTags}
            placeholder="Tags (ex: securite, lot_cvc)"
            placeholderTextColor={colors.slate}
            style={{
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              marginTop: spacing.md
            }}
          />

          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
              {error}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Importer fichier" onPress={onCreateAndImport} disabled={busy} />
            <Button label="Créer sans fichier" kind="ghost" onPress={onCreateEmpty} disabled={busy} />
            <Button label="Annuler" kind="ghost" onPress={onClose} disabled={busy} />
          </View>
        </Card>
      </Screen>
    </Modal>
  );
}

function DocumentDetailPanel({
  document,
  versions,
  links,
  signatures,
  shareLinks,
  activeAsset,
  activeVersionNumber,
  linkCount,
  busy,
  signatureEnabled,
  sharingEnabled,
  onClose,
  onRefresh,
  onAddVersionImport,
  onAddVersionPhoto,
  onActivateVersion,
  onSetStatus,
  onSoftDelete,
  onOpenActiveFile,
  onOpenTaskPicker,
  onOpenPinPicker,
  onOpenExportPicker,
  onUnlink,
  onCreateShareLink,
  onRevokeShareLink,
  onStartSignature
}: {
  document: Document | null;
  versions: DocumentVersion[];
  links: DocumentLink[];
  signatures: SignatureRecord[];
  shareLinks: ShareLink[];
  activeAsset: MediaAsset | null;
  activeVersionNumber: number | null;
  linkCount: number;
  busy: boolean;
  signatureEnabled: boolean;
  sharingEnabled: boolean;
  onClose?: () => void;
  onRefresh: () => void;
  onAddVersionImport: () => void;
  onAddVersionPhoto: () => void;
  onActivateVersion: (versionId: string) => void;
  onSetStatus: (status: DocumentStatus) => void;
  onSoftDelete: () => void;
  onOpenActiveFile: () => void;
  onOpenTaskPicker: () => void;
  onOpenPinPicker: () => void;
  onOpenExportPicker: () => void;
  onUnlink: (link: DocumentLink) => void;
  onCreateShareLink: () => void;
  onRevokeShareLink: (linkId: string) => void;
  onStartSignature: (versionId: string) => void;
}) {
  const { colors, spacing, radii } = useTheme();

  if (!document) {
    return (
      <Card style={{ flex: 1, minHeight: 0 }}>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Text variant="h2">Détail</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Sélectionne un document dans la liste.
          </Text>
        </ScrollView>
      </Card>
    );
  }

  const activeVersion =
    versions.find((version) => version.id === document.active_version_id) ??
    [...versions].sort((left, right) => right.version_number - left.version_number)[0] ??
    null;

  const canSign = signatureEnabled && isPdfVersion(activeVersion);

  const statusColor = statusTint(document.status, { amber: colors.amber, teal: colors.teal, mint: colors.mint });

  return (
    <Card style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={2}>
              {document.title}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
              {document.doc_type} · maj {formatShortDate(document.updated_at)} · v{activeVersionNumber ?? '—'} · liens {linkCount}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
            <View style={{ backgroundColor: statusColor, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
              <Text variant="caption">{statusLabel(document.status)}</Text>
            </View>
            {onClose ? <Button label="Fermer" kind="ghost" onPress={onClose} disabled={busy} /> : null}
          </View>
        </View>

        {activeAsset ? (
          activeAsset.mime.startsWith('image/') && activeAsset.local_thumb_path ? (
            <Image
              source={{ uri: activeAsset.local_thumb_path }}
              style={{ width: '100%', height: 120, borderRadius: radii.md, marginTop: spacing.md }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: '100%',
                height: 96,
                borderRadius: radii.md,
                marginTop: spacing.md,
                backgroundColor: colors.fog,
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Text variant="caption" style={{ color: colors.slate }}>
                Version active: {activeAsset.mime.toUpperCase()}
              </Text>
            </View>
          )
        ) : (
          <View
            style={{
              width: '100%',
              height: 72,
              borderRadius: radii.md,
              marginTop: spacing.md,
              backgroundColor: colors.fog,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Text variant="caption" style={{ color: colors.slate }}>
              Aucune version (fichier) pour ce document.
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          <Button label="Rafraîchir" kind="ghost" onPress={onRefresh} disabled={busy} />
          <Button label="Ajouter version (import)" onPress={onAddVersionImport} disabled={busy} />
          <Button label="Ajouter version (photo)" kind="ghost" onPress={onAddVersionPhoto} disabled={busy} />
          <Button label="Ouvrir fichier" kind="ghost" onPress={onOpenActiveFile} disabled={busy || !activeAsset} />
        </View>

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Statut
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="Brouillon" kind={document.status === 'DRAFT' ? 'primary' : 'ghost'} onPress={() => onSetStatus('DRAFT')} disabled={busy} />
          <Button label="Final" kind={document.status === 'FINAL' ? 'primary' : 'ghost'} onPress={() => onSetStatus('FINAL')} disabled={busy} />
          <Button label="Supprimer (non définitif)" kind="ghost" onPress={onSoftDelete} disabled={busy} />
        </View>

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Versions
        </Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {versions.length === 0 ? (
            <Text variant="caption" style={{ color: colors.slate }}>
              Aucune version.
            </Text>
          ) : (
            versions.map((version) => {
              const isActive = document.active_version_id === version.id;
              return (
                <View
                  key={version.id}
                  style={{
                    borderWidth: 1,
                    borderColor: isActive ? colors.teal : colors.fog,
                    borderRadius: radii.md,
                    padding: spacing.md
                  }}
                >
                  <Text variant="bodyStrong" numberOfLines={1}>
                    v{version.version_number} · {version.file_mime} · {formatBytes(version.file_size)}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                    {formatShortDate(version.created_at)} · {version.id.slice(0, 6)}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                    hash: {version.file_hash}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button label="Activer" kind="ghost" onPress={() => onActivateVersion(version.id)} disabled={busy || isActive} />
                    {signatureEnabled && version.file_mime === 'application/pdf' ? (
                      <Button label="Signer" kind="ghost" onPress={() => onStartSignature(version.id)} disabled={busy} />
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Liens
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="Lier à une tâche" onPress={onOpenTaskPicker} disabled={busy} />
          <Button label="Lier à un pin" kind="ghost" onPress={onOpenPinPicker} disabled={busy} />
          <Button label="Lier à un export" kind="ghost" onPress={onOpenExportPicker} disabled={busy} />
        </View>
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {links.length === 0 ? (
            <Text variant="caption" style={{ color: colors.slate }}>
              Aucun lien.
            </Text>
          ) : (
            links.map((link) => (
              <View
                key={link.id}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.md
                }}
              >
                <Text variant="bodyStrong" numberOfLines={1}>
                  {link.linked_entity} · {link.linked_id}
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                  {formatShortDate(link.created_at)}
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button label="Supprimer lien" kind="ghost" onPress={() => onUnlink(link)} disabled={busy} />
                </View>
              </View>
            ))
          )}
        </View>

        {signatureEnabled ? (
          <>
            <Text variant="h2" style={{ marginTop: spacing.lg }}>
              Signature probante
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Une signature génère un PDF signé + un reçu, et passe le document en statut « Signé ».
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Signer la version active" onPress={() => activeVersion && onStartSignature(activeVersion.id)} disabled={busy || !canSign} />
            </View>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {signatures.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune signature.
                </Text>
              ) : (
                signatures.slice(0, 6).map((row) => (
                  <View
                    key={row.id}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.fog,
                      borderRadius: radii.md,
                      padding: spacing.md
                    }}
                  >
                    <Text variant="caption" style={{ color: colors.slate }} numberOfLines={1}>
                      {signatureStatusLabel(row.status)} · local {row.signed_at_local ? formatShortDate(row.signed_at_local) : '—'}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate }} numberOfLines={1}>
                      hash: {row.file_hash || '—'}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}

        {sharingEnabled ? (
          <>
            <Text variant="h2" style={{ marginTop: spacing.lg }}>
              Partage externe
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Génère un lien temporaire en lecture seule (réseau requis).
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Créer lien (72h)" onPress={onCreateShareLink} disabled={busy} />
            </View>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {shareLinks.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucun lien.
                </Text>
              ) : (
                shareLinks.map((link) => {
                  const expired = Date.parse(link.expires_at) <= Date.now();
                  const revoked = Boolean(link.revoked_at);
                  const status = revoked ? 'REVOQUÉ' : expired ? 'EXPIRÉ' : 'ACTIF';
                  return (
                    <View
                      key={link.id}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.fog,
                        borderRadius: radii.md,
                        padding: spacing.md
                      }}
                    >
                      <Text variant="caption" style={{ color: colors.slate }}>
                        {status} · expire {new Date(link.expires_at).toLocaleString('fr-FR')}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                        {link.public_url ? (
                          <Button
                            label="Partager lien"
                            kind="ghost"
                            onPress={() => {
                              void Share.share({ message: link.public_url! }).catch(() => {
                                // no-op
                              });
                            }}
                            disabled={busy}
                          />
                        ) : (
                          <Text variant="caption" style={{ color: colors.slate }}>
                            Token non dispo sur ce device.
                          </Text>
                        )}
                        {!revoked && !expired ? (
                          <Button label="Révoquer" kind="ghost" onPress={() => onRevokeShareLink(link.id)} disabled={busy} />
                        ) : null}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </Card>
  );
}

export function DocumentsScreen({ projectId }: { projectId?: string } = {}) {
  const { colors, spacing, radii } = useTheme();
  const { width } = useWindowDimensions();
  const split = width >= 980;

  const { activeOrgId, user } = useAuth();
  const navCtx = useAppNavigationContext();
  const { status: syncStatus } = useSyncStatus();

  const effectiveProjectId = projectId ?? navCtx.projectId ?? DEMO_PROJECT_ID;

  const signatureEnabled = useMemo(
    () => flags.isEnabled('signature-probante', { orgId: activeOrgId ?? undefined, fallback: false }),
    [activeOrgId]
  );
  const sharingEnabled = useMemo(
    () => flags.isEnabled('external-sharing', { orgId: activeOrgId ?? undefined, fallback: false }),
    [activeOrgId]
  );

  const [filter, setFilter] = useState<QuickFilter>('ALL');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [items, setItems] = useState<Document[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [listBusy, setListBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeVersionNumbers, setActiveVersionNumbers] = useState<Record<string, number | null>>({});
  const [linkCounts, setLinkCounts] = useState<Record<string, number>>({});

  const [detail, setDetail] = useState<DetailState>({ open: false, documentId: null });
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<DocumentVersion[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<DocumentLink[]>([]);
  const [selectedSignatures, setSelectedSignatures] = useState<SignatureRecord[]>([]);
  const [selectedShareLinks, setSelectedShareLinks] = useState<ShareLink[]>([]);
  const [activeAsset, setActiveAsset] = useState<MediaAsset | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [exportPickerOpen, setExportPickerOpen] = useState(false);

  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureTargetVersionId, setSignatureTargetVersionId] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(normalizeText(query)), 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    documents.setActor(user?.id ?? null);
    plans.setContext({ org_id: activeOrgId ?? undefined, user_id: user?.id ?? undefined });
    exportsDoe.setContext({ org_id: activeOrgId ?? undefined, user_id: user?.id ?? undefined });
    share.setContext({ org_id: activeOrgId ?? undefined, user_id: user?.id ?? undefined });
  }, [activeOrgId, user?.id]);

  const buildFilters = useCallback(
    (pageOffset: number) => {
      const base: DocumentsListFilters = {
        org_id: activeOrgId ?? undefined,
        include_deleted: false,
        limit: PAGE_SIZE,
        offset: pageOffset
      };

      if (filter === 'PLANS') {
        base.doc_type = 'PLAN';
      } else if (filter === 'DOE_REPORTS') {
        base.doc_types = ['DOE', 'REPORT'];
      } else if (filter === 'PV') {
        base.doc_type = 'PV';
      } else if (filter === 'SECURITY') {
        base.tags = ['securite'];
      } else if (filter === 'OTHER') {
        base.doc_type = 'OTHER';
      } else if (filter === 'SIGNED') {
        base.status = 'SIGNED';
      } else if (filter === 'LINKED_TASK') {
        base.linked_entity = 'TASK';
      }

      return base;
    },
    [activeOrgId, filter]
  );

  const loadPage = useCallback(
    async (mode: 'reset' | 'more') => {
      if (!activeOrgId) {
        setItems([]);
        setOffset(0);
        setHasMore(false);
        setActiveVersionNumbers({});
        setLinkCounts({});
        return;
      }

      const nextOffset = mode === 'more' ? offset : 0;
      if (mode === 'more' && (!hasMore || listBusy)) {
        return;
      }

      setListBusy(true);
      setError(null);

      try {
        const filters = buildFilters(nextOffset);
        const pageItems =
          debouncedQuery.length > 0
            ? await documents.searchByProject(effectiveProjectId, debouncedQuery, filters)
            : await documents.listByProject(effectiveProjectId, filters);

        setHasMore(pageItems.length >= PAGE_SIZE);
        setOffset(nextOffset + PAGE_SIZE);

        setItems((prev) => {
          if (mode === 'reset') {
            return pageItems;
          }

          const byId = new Map(prev.map((doc) => [doc.id, doc] as const));
          for (const doc of pageItems) {
            byId.set(doc.id, doc);
          }
          return Array.from(byId.values()).sort((left, right) => right.updated_at.localeCompare(left.updated_at));
        });

        const ids = pageItems.map((doc) => doc.id);
        if (ids.length > 0) {
          const [versionsMap, linksMap] = await Promise.all([
            documents.getActiveVersionNumbers(ids),
            documents.getLinkCounts(ids)
          ]);

          setActiveVersionNumbers((prev) => ({ ...prev, ...versionsMap }));
          setLinkCounts((prev) => ({ ...prev, ...linksMap }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Chargement documents impossible.');
      } finally {
        setListBusy(false);
      }
    },
    [activeOrgId, buildFilters, debouncedQuery, effectiveProjectId, hasMore, listBusy, offset]
  );

  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    void loadPage('reset');
  }, [activeOrgId, debouncedQuery, effectiveProjectId, filter, loadPage]);

  const refreshDetail = useCallback(
    async (documentId: string) => {
      setDetailBusy(true);
      setError(null);

      try {
        const [doc, versions, links] = await Promise.all([
          documents.getById(documentId),
          documents.listVersions(documentId),
          documents.listLinks(documentId)
        ]);

        if (!doc) {
          setSelectedDocument(null);
          setSelectedVersions([]);
          setSelectedLinks([]);
          setSelectedSignatures([]);
          setSelectedShareLinks([]);
          setActiveAsset(null);
          return;
        }

        setSelectedDocument(doc);
        setSelectedVersions(versions);
        setSelectedLinks(links);

        if (signatureEnabled) {
          const rows = await sign.getByDocument(doc.id);
          setSelectedSignatures(rows);
        } else {
          setSelectedSignatures([]);
        }

        if (sharingEnabled) {
          const rows = await share.list('DOCUMENT', doc.id);
          setSelectedShareLinks(rows);
        } else {
          setSelectedShareLinks([]);
        }

        const activeVersion =
          versions.find((version) => version.id === doc.active_version_id) ??
          [...versions].sort((left, right) => right.version_number - left.version_number)[0] ??
          null;

        if (!activeVersion) {
          setActiveAsset(null);
        } else {
          const asset = await media.getById(activeVersion.file_asset_id);
          setActiveAsset(asset);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Chargement détail impossible.');
      } finally {
        setDetailBusy(false);
      }
    },
    [sharingEnabled, signatureEnabled]
  );

  const openDetail = useCallback(
    (documentId: string) => {
      setDetail({ open: true, documentId });
      void refreshDetail(documentId);
    },
    [refreshDetail]
  );

  const closeDetail = useCallback(() => {
    setDetail({ open: false, documentId: null });
    setTaskPickerOpen(false);
    setPinPickerOpen(false);
    setExportPickerOpen(false);
  }, []);

  const withDetailBusy = useCallback(
    async (task: () => Promise<void>) => {
      setDetailBusy(true);
      setError(null);
      try {
        await task();
        if (selectedDocument) {
          await refreshDetail(selectedDocument.id);
        }
        await loadPage('reset');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action impossible.');
      } finally {
        setDetailBusy(false);
      }
    },
    [loadPage, refreshDetail, selectedDocument]
  );

  const selectedActiveVersionNumber = selectedDocument ? activeVersionNumbers[selectedDocument.id] ?? null : null;
  const selectedLinkCount = selectedDocument ? linkCounts[selectedDocument.id] ?? selectedLinks.length : selectedLinks.length;

  const header = (
    <View style={{ gap: spacing.md }}>
      <SectionHeader title="Documents" subtitle="Hors ligne d'abord, versioning + liens, prêt pour DOE / signature." />

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
          <Button label="+ Document" onPress={() => setCreateOpen(true)} disabled={listBusy || !activeOrgId || !user?.id} />
          <Button label="Rafraîchir" kind="ghost" onPress={() => void loadPage('reset')} disabled={listBusy} />
          <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
            {syncStatus.phase === 'offline' ? 'Hors ligne' : 'En ligne'} · file sync {syncStatus.queueDepth}
          </Text>
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher (titre/tags)"
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

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
          {QUICK_FILTERS.map((item) => (
            <Button
              key={item.key}
              label={item.label}
              kind={filter === item.key ? 'primary' : 'ghost'}
              onPress={() => setFilter(item.key)}
              disabled={listBusy}
            />
          ))}
        </View>

        {error ? (
          <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
            {error}
          </Text>
        ) : null}
      </Card>
    </View>
  );

  const renderItem = useCallback(
    ({ item }: { item: Document }) => {
      const isActive = selectedDocument?.id === item.id;
      const linkCount = linkCounts[item.id] ?? 0;
      const v = activeVersionNumbers[item.id];
      const statusColor = statusTint(item.status, { amber: colors.amber, teal: colors.teal, mint: colors.mint });

      return (
        <Pressable onPress={() => openDetail(item.id)}>
          <Card
            style={{
              borderWidth: isActive ? 2 : 1,
              borderColor: isActive ? colors.teal : colors.fog,
              padding: spacing.md
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
                  {item.doc_type} · v{v ?? '—'} · liens {linkCount} · maj {formatShortDate(item.updated_at)}
                </Text>
              </View>
              <View style={{ backgroundColor: statusColor, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                <Text variant="caption">{statusLabel(item.status)}</Text>
              </View>
            </View>
          </Card>
        </Pressable>
      );
    },
    [activeVersionNumbers, colors.amber, colors.fog, colors.mint, colors.slate, colors.teal, linkCounts, openDetail, radii.pill, selectedDocument?.id, spacing.md, spacing.sm, spacing.xs]
  );

  const list = (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}
      ListHeaderComponent={header}
      ListFooterComponent={
        hasMore ? (
          <View style={{ marginTop: spacing.md }}>
            <Button label={listBusy ? 'Chargement…' : 'Charger plus'} kind="ghost" onPress={() => void loadPage('more')} disabled={listBusy} />
          </View>
        ) : (
          <View style={{ marginTop: spacing.md }}>
            <Text variant="caption" style={{ color: colors.slate }}>
              Fin de liste.
            </Text>
          </View>
        )
      }
      ListEmptyComponent={
        <Card>
          <Text variant="body" style={{ color: colors.slate }}>
            {listBusy ? 'Chargement…' : 'Aucun document.'}
          </Text>
        </Card>
      }
    />
  );

  const detailPanel = (
    <DocumentDetailPanel
      document={selectedDocument}
      versions={selectedVersions}
      links={selectedLinks}
      signatures={selectedSignatures}
      shareLinks={selectedShareLinks}
      activeAsset={activeAsset}
      activeVersionNumber={selectedActiveVersionNumber}
      linkCount={selectedLinkCount}
      busy={detailBusy || listBusy}
      signatureEnabled={signatureEnabled}
      sharingEnabled={sharingEnabled}
      onClose={split ? undefined : closeDetail}
      onRefresh={() => selectedDocument && void refreshDetail(selectedDocument.id)}
      onAddVersionImport={() =>
        selectedDocument &&
        void withDetailBusy(async () => {
          await documents.addVersion(selectedDocument.id, { source: 'import', tag: 'document_version' });
        })
      }
      onAddVersionPhoto={() =>
        selectedDocument &&
        void withDetailBusy(async () => {
          await documents.addVersion(selectedDocument.id, { source: 'capture', tag: 'document_version' });
        })
      }
      onActivateVersion={(versionId) =>
        selectedDocument &&
        void withDetailBusy(async () => {
          await documents.setActiveVersion(selectedDocument.id, versionId);
        })
      }
      onSetStatus={(status) =>
        selectedDocument &&
        void withDetailBusy(async () => {
          await documents.update(selectedDocument.id, { status });
        })
      }
      onSoftDelete={() =>
        selectedDocument &&
        void withDetailBusy(async () => {
          await documents.softDelete(selectedDocument.id);
          setSelectedDocument(null);
          setSelectedVersions([]);
          setSelectedLinks([]);
          setSelectedShareLinks([]);
          setSelectedSignatures([]);
          setActiveAsset(null);
        })
      }
      onOpenActiveFile={() => {
        void (async () => {
          try {
            if (!activeAsset) {
              throw new Error('Fichier local introuvable.');
            }

            const available = await Sharing.isAvailableAsync();
            if (!available) {
              throw new Error('Partage iOS indisponible sur cet appareil.');
            }

            await Sharing.shareAsync(activeAsset.local_path, { mimeType: activeAsset.mime });
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Ouverture fichier impossible.');
          }
        })();
      }}
      onOpenTaskPicker={() => setTaskPickerOpen(true)}
      onOpenPinPicker={() => setPinPickerOpen(true)}
      onOpenExportPicker={() => setExportPickerOpen(true)}
      onUnlink={(link) =>
        selectedDocument &&
        void withDetailBusy(async () => {
          await documents.unlink(selectedDocument.id, link.linked_entity, link.linked_id);
        })
      }
      onCreateShareLink={() =>
        selectedDocument &&
        void withDetailBusy(async () => {
          const created = await share.create('DOCUMENT', selectedDocument.id, { expiresInHours: 72 });
          await share.list('DOCUMENT', selectedDocument.id).then(setSelectedShareLinks);
          void Share.share({ message: created.url });
        })
      }
      onRevokeShareLink={(linkId) =>
        selectedDocument &&
        void withDetailBusy(async () => {
          await share.revoke(linkId);
          const rows = await share.list('DOCUMENT', selectedDocument.id);
          setSelectedShareLinks(rows);
        })
      }
      onStartSignature={(versionId) => {
        setSignatureTargetVersionId(versionId);
        setSignatureModalOpen(true);
      }}
    />
  );

  const actor = useMemo<SignatureActor | null>(() => {
    if (!user?.id) return null;
    return {
      user_id: user.id,
      role: undefined,
      display_name: user.email ?? undefined
    };
  }, [user?.email, user?.id]);

  const signatureVersion =
    signatureTargetVersionId && selectedVersions.length > 0
      ? selectedVersions.find((v) => v.id === signatureTargetVersionId) ?? null
      : null;

  const onPickTask = useCallback(
    (task: Task) => {
      setTaskPickerOpen(false);
      if (!selectedDocument) return;
      void withDetailBusy(async () => {
        await documents.link(selectedDocument.id, 'TASK', task.id);
      });
    },
    [selectedDocument, withDetailBusy]
  );

  const onPickPin = useCallback(
    (pin: PlanPin) => {
      setPinPickerOpen(false);
      if (!selectedDocument) return;
      void withDetailBusy(async () => {
        await documents.link(selectedDocument.id, 'PLAN_PIN', pin.id);
      });
    },
    [selectedDocument, withDetailBusy]
  );

  const onPickExport = useCallback(
    (job: ExportJob) => {
      setExportPickerOpen(false);
      if (!selectedDocument) return;
      void withDetailBusy(async () => {
        await documents.link(selectedDocument.id, 'EXPORT', job.id);
      });
    },
    [selectedDocument, withDetailBusy]
  );

  if (!split) {
    return (
      <Screen>
        {list}

        <Modal visible={detail.open} animationType="slide" onRequestClose={closeDetail}>
          <Screen>{detailPanel}</Screen>
        </Modal>

        {activeOrgId && user?.id ? (
          <NewDocumentModal
            visible={createOpen}
            orgId={activeOrgId}
            projectId={effectiveProjectId}
            createdBy={user.id}
            onClose={() => setCreateOpen(false)}
            onCreated={(id) => {
              setCreateOpen(false);
              openDetail(id);
              void loadPage('reset');
            }}
          />
        ) : null}

        {activeOrgId ? (
          <TaskPickerModal visible={taskPickerOpen} projectId={effectiveProjectId} orgId={activeOrgId} onClose={() => setTaskPickerOpen(false)} onPick={onPickTask} />
        ) : null}
        <PinPickerModal visible={pinPickerOpen} projectId={effectiveProjectId} onClose={() => setPinPickerOpen(false)} onPick={onPickPin} />
        <ExportPickerModal visible={exportPickerOpen} projectId={effectiveProjectId} onClose={() => setExportPickerOpen(false)} onPick={onPickExport} />

        <SignatureModal
          visible={signatureModalOpen}
          document={selectedDocument}
          version={signatureVersion}
          actor={actor}
          onClose={() => {
            setSignatureModalOpen(false);
            setSignatureTargetVersionId(null);
          }}
          onCompleted={async () => {
            if (selectedDocument) {
              await refreshDetail(selectedDocument.id);
              await loadPage('reset');
            }
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: spacing.md }}>
        <View style={{ width: 380, minHeight: 0 }}>{list}</View>
        <View style={{ flex: 1, minHeight: 0 }}>{detailPanel}</View>
      </View>

      {activeOrgId && user?.id ? (
        <NewDocumentModal
          visible={createOpen}
          orgId={activeOrgId}
          projectId={effectiveProjectId}
          createdBy={user.id}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            openDetail(id);
            void loadPage('reset');
          }}
        />
      ) : null}

      {activeOrgId ? (
        <TaskPickerModal visible={taskPickerOpen} projectId={effectiveProjectId} orgId={activeOrgId} onClose={() => setTaskPickerOpen(false)} onPick={onPickTask} />
      ) : null}
      <PinPickerModal visible={pinPickerOpen} projectId={effectiveProjectId} onClose={() => setPinPickerOpen(false)} onPick={onPickPin} />
      <ExportPickerModal visible={exportPickerOpen} projectId={effectiveProjectId} onClose={() => setExportPickerOpen(false)} onPick={onPickExport} />

      <SignatureModal
        visible={signatureModalOpen}
        document={selectedDocument}
        version={signatureVersion}
        actor={actor}
        onClose={() => {
          setSignatureModalOpen(false);
          setSignatureTargetVersionId(null);
        }}
        onCompleted={async () => {
          if (selectedDocument) {
            await refreshDetail(selectedDocument.id);
            await loadPage('reset');
          }
        }}
      />
    </Screen>
  );
}
