import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { media, MediaAsset } from '../../data/media';
import {
  documents,
  Document,
  DocumentScope,
  DocumentStatus,
  DocumentsListFilters,
  DocumentType,
  DocumentVersion,
  LinkedEntity
} from '../../data/documents';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const DEMO_PROJECT_ID = 'chantier-conformeo-demo';
const PAGE_SIZE = 25;

const SCOPES: DocumentScope[] = ['PROJECT', 'COMPANY'];
const DOC_TYPES: DocumentType[] = ['PLAN', 'DOE', 'PV', 'REPORT', 'INTERNAL', 'OTHER'];
const DOC_STATUSES: DocumentStatus[] = ['DRAFT', 'FINAL', 'SIGNED'];
const LINKED_ENTITIES: LinkedEntity[] = ['TASK', 'PLAN_PIN', 'PROJECT', 'EXPORT'];

type DocumentPreview = {
  thumbPath: string | null;
  mime: string | null;
};

function parseTagsCsv(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMedia(asset: MediaAsset | null) {
  if (!asset) return false;
  return asset.mime === 'image/webp' || asset.mime === 'image/jpeg';
}

function statusColor(status: DocumentStatus, colors: { amber: string; teal: string; mint: string }) {
  if (status === 'DRAFT') return colors.amber;
  if (status === 'FINAL') return colors.teal;
  return colors.mint;
}

async function resolveDocumentPreview(document: Document): Promise<DocumentPreview> {
  const versions = await documents.listVersions(document.id);
  const active =
    versions.find((version) => version.id === document.active_version_id) ??
    versions.sort((left, right) => right.version_number - left.version_number)[0];

  if (!active) {
    return { thumbPath: null, mime: null };
  }

  const asset = await media.getById(active.file_asset_id);
  if (!asset) {
    return { thumbPath: null, mime: active.file_mime };
  }

  return {
    thumbPath: asset.local_thumb_path || null,
    mime: asset.mime
  };
}

export function DocumentsScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [scope, setScope] = useState<DocumentScope>('PROJECT');
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | 'ALL'>('ALL');
  const [typeFilter, setTypeFilter] = useState<DocumentType | 'ALL'>('ALL');
  const [page, setPage] = useState(0);

  const [documentsList, setDocumentsList] = useState<Document[]>([]);
  const [previews, setPreviews] = useState<Record<string, DocumentPreview>>({});

  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<DocumentVersion[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<Array<{ id: string; linked_entity: LinkedEntity; linked_id: string; created_at: string }>>([]);
  const [activeVersionMedia, setActiveVersionMedia] = useState<MediaAsset | null>(null);

  const [createTitle, setCreateTitle] = useState('');
  const [createType, setCreateType] = useState<DocumentType>('OTHER');
  const [createStatus, setCreateStatus] = useState<DocumentStatus>('DRAFT');
  const [createTags, setCreateTags] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editStatus, setEditStatus] = useState<DocumentStatus>('DRAFT');

  const [linkEntity, setLinkEntity] = useState<LinkedEntity>('TASK');
  const [linkEntityId, setLinkEntityId] = useState('');

  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasNextPage = documentsList.length >= PAGE_SIZE;

  useEffect(() => {
    documents.setActor(user?.id ?? null);
  }, [user?.id]);

  const listFilters = useMemo<DocumentsListFilters>(
    () => ({
      org_id: activeOrgId ?? undefined,
      status: statusFilter,
      doc_type: typeFilter,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE
    }),
    [activeOrgId, page, statusFilter, typeFilter]
  );

  const refreshList = useCallback(async () => {
    if (!activeOrgId) {
      setDocumentsList([]);
      setPreviews({});
      return;
    }

    setLoadingList(true);

    try {
      const nextDocuments = await documents.list(scope, scope === 'PROJECT' ? DEMO_PROJECT_ID : undefined, listFilters);
      setDocumentsList(nextDocuments);

      const previewEntries = await Promise.all(
        nextDocuments.map(async (document) => {
          const preview = await resolveDocumentPreview(document);
          return [document.id, preview] as const;
        })
      );

      setPreviews(Object.fromEntries(previewEntries));

      if (selectedDocument && !nextDocuments.some((document) => document.id === selectedDocument.id)) {
        setSelectedDocument(null);
        setSelectedVersions([]);
        setSelectedLinks([]);
        setActiveVersionMedia(null);
      }
    } catch (listError) {
      const message = listError instanceof Error ? listError.message : 'Chargement documents impossible.';
      setError(message);
    } finally {
      setLoadingList(false);
    }
  }, [activeOrgId, listFilters, scope, selectedDocument]);

  const refreshDetail = useCallback(async (documentId: string) => {
    setLoadingDetail(true);

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
        setActiveVersionMedia(null);
        return;
      }

      setSelectedDocument(doc);
      setSelectedVersions(versions);
      setSelectedLinks(links);
      setEditTitle(doc.title);
      setEditDescription(doc.description ?? '');
      setEditTags(doc.tags.join(', '));
      setEditStatus(doc.status);

      const activeVersion =
        versions.find((version) => version.id === doc.active_version_id) ??
        versions.sort((left, right) => right.version_number - left.version_number)[0];

      if (!activeVersion) {
        setActiveVersionMedia(null);
      } else {
        const mediaAsset = await media.getById(activeVersion.file_asset_id);
        setActiveVersionMedia(mediaAsset);
      }
    } catch (detailError) {
      const message = detailError instanceof Error ? detailError.message : 'Chargement détail document impossible.';
      setError(message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const createDocument = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide: utilisateur ou organisation absente.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const created = await documents.create({
        org_id: activeOrgId,
        scope,
        project_id: scope === 'PROJECT' ? DEMO_PROJECT_ID : undefined,
        title: createTitle,
        doc_type: createType,
        status: createStatus,
        tags: parseTagsCsv(createTags),
        description: createDescription,
        created_by: user.id
      });

      setCreateTitle('');
      setCreateTags('');
      setCreateDescription('');
      setCreateType('OTHER');
      setCreateStatus('DRAFT');

      await refreshList();
      await refreshDetail(created.id);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Création document impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    activeOrgId,
    createDescription,
    createStatus,
    createTags,
    createTitle,
    createType,
    refreshDetail,
    refreshList,
    scope,
    user?.id
  ]);

  const updateDocument = useCallback(async () => {
    if (!selectedDocument) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const updated = await documents.update(selectedDocument.id, {
        title: editTitle,
        description: editDescription,
        tags: parseTagsCsv(editTags),
        status: editStatus
      });

      await refreshList();
      await refreshDetail(updated.id);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Mise à jour document impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [editDescription, editStatus, editTags, editTitle, refreshDetail, refreshList, selectedDocument]);

  const removeDocument = useCallback(async () => {
    if (!selectedDocument) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await documents.softDelete(selectedDocument.id);
      setSelectedDocument(null);
      setSelectedVersions([]);
      setSelectedLinks([]);
      setActiveVersionMedia(null);
      await refreshList();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Suppression document impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [refreshList, selectedDocument]);

  const addVersion = useCallback(
    async (source: 'import' | 'capture') => {
      if (!selectedDocument) {
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        await documents.addVersion(selectedDocument.id, {
          source,
          tag: 'document_version'
        });

        await refreshList();
        await refreshDetail(selectedDocument.id);
      } catch (versionError) {
        const message = versionError instanceof Error ? versionError.message : 'Ajout version impossible.';
        setError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [refreshDetail, refreshList, selectedDocument]
  );

  const activateVersion = useCallback(
    async (versionId: string) => {
      if (!selectedDocument) {
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        await documents.setActiveVersion(selectedDocument.id, versionId);
        await refreshList();
        await refreshDetail(selectedDocument.id);
      } catch (activationError) {
        const message = activationError instanceof Error ? activationError.message : 'Activation version impossible.';
        setError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [refreshDetail, refreshList, selectedDocument]
  );

  const addLink = useCallback(async () => {
    if (!selectedDocument) {
      return;
    }

    const linkedId = linkEntityId.trim();
    if (!linkedId) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await documents.link(selectedDocument.id, linkEntity, linkedId);
      setLinkEntityId('');
      await refreshDetail(selectedDocument.id);
    } catch (linkError) {
      const message = linkError instanceof Error ? linkError.message : 'Création du lien impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [linkEntity, linkEntityId, refreshDetail, selectedDocument]);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
        title="Documents"
        subtitle="Organisation offline-first, versions et liens inter-modules prêts pour DOE/signature."
      />

      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="h2">Nouveau document</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Retrouvable en 10 secondes, même hors réseau.
          </Text>

          <TextInput
            value={createTitle}
            onChangeText={setCreateTitle}
            placeholder="Titre document"
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

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {SCOPES.map((itemScope) => (
              <Button
                key={itemScope}
                label={itemScope}
                kind={scope === itemScope ? 'primary' : 'ghost'}
                onPress={() => {
                  setScope(itemScope);
                  setPage(0);
                }}
                disabled={submitting}
              />
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {DOC_TYPES.map((itemType) => (
                <Button
                  key={itemType}
                  label={itemType}
                  kind={createType === itemType ? 'primary' : 'ghost'}
                  onPress={() => setCreateType(itemType)}
                  disabled={submitting}
                />
              ))}
            </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {DOC_STATUSES.map((itemStatus) => (
              <Button
                key={itemStatus}
                label={itemStatus}
                kind={createStatus === itemStatus ? 'primary' : 'ghost'}
                onPress={() => setCreateStatus(itemStatus)}
                disabled={submitting}
              />
            ))}
          </View>

          <TextInput
            value={createTags}
            onChangeText={setCreateTags}
            placeholder="Tags (ex: sécurité, plan, lot_cvc)"
            placeholderTextColor={colors.slate}
            style={{
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              marginTop: spacing.sm
            }}
          />

          <TextInput
            value={createDescription}
            onChangeText={setCreateDescription}
            placeholder="Description"
            placeholderTextColor={colors.slate}
            multiline
            style={{
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              marginTop: spacing.sm,
              minHeight: 64
            }}
          />

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Créer document" onPress={() => void createDocument()} disabled={submitting} />
            <Button label="Partager (MVP)" kind="ghost" disabled />
          </View>
        </Card>

        <Card>
          <Text variant="bodyStrong">Filtres liste</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {(['ALL', ...DOC_STATUSES] as const).map((itemStatus) => (
              <Button
                key={itemStatus}
                label={itemStatus}
                kind={statusFilter === itemStatus ? 'primary' : 'ghost'}
                onPress={() => {
                  setStatusFilter(itemStatus);
                  setPage(0);
                }}
                disabled={submitting}
              />
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {(['ALL', ...DOC_TYPES] as const).map((itemType) => (
                <Button
                  key={itemType}
                  label={itemType}
                  kind={typeFilter === itemType ? 'primary' : 'ghost'}
                  onPress={() => {
                    setTypeFilter(itemType);
                    setPage(0);
                  }}
                  disabled={submitting}
                />
              ))}
            </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button
              label="Page précédente"
              kind="ghost"
              onPress={() => setPage((previous) => Math.max(0, previous - 1))}
              disabled={page === 0 || submitting}
            />
            <Button
              label="Page suivante"
              kind="ghost"
              onPress={() => setPage((previous) => previous + 1)}
              disabled={!hasNextPage || submitting}
            />
            <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
              Page {page + 1} • sync queue {syncStatus.queueDepth}
            </Text>
          </View>
        </Card>

        <View style={{ gap: spacing.md }}>
          <FlatList
            data={documentsList}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            nestedScrollEnabled={false}
            contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}
            renderItem={({ item }) => {
              const preview = previews[item.id];
              const isActive = selectedDocument?.id === item.id;
              const primaryTag = item.tags[0] ?? 'sans-tag';

              return (
                <Pressable onPress={() => void refreshDetail(item.id)}>
                  <Card
                    style={{
                      borderWidth: isActive ? 2 : 1,
                      borderColor: isActive ? colors.teal : colors.fog
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {item.title}
                      </Text>
                      <View
                        style={{
                          backgroundColor: statusColor(item.status, colors),
                          borderRadius: radii.pill,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: spacing.xs
                        }}
                      >
                        <Text variant="caption">{item.status}</Text>
                      </View>
                    </View>

                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      {item.doc_type} • tag {primaryTag} • {new Date(item.updated_at).toLocaleDateString('fr-FR')}
                    </Text>

                    {preview?.thumbPath ? (
                      <Image
                        source={{ uri: preview.thumbPath }}
                        style={{ width: '100%', height: 86, borderRadius: radii.sm, marginTop: spacing.sm }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={{
                          width: '100%',
                          height: 72,
                          borderRadius: radii.sm,
                          marginTop: spacing.sm,
                          backgroundColor: colors.fog,
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Text variant="caption" style={{ color: colors.slate }}>
                          {preview?.mime?.includes('pdf') ? 'PDF' : 'Aperçu indisponible'}
                        </Text>
                      </View>
                    )}
                  </Card>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Card>
                <Text variant="body" style={{ color: colors.slate }}>
                  {loadingList ? 'Chargement documents...' : 'Aucun document pour ce filtre.'}
                </Text>
              </Card>
            }
          />

          {selectedDocument ? (
            <Card style={{ maxHeight: 400 }}>
              <ScrollView>
                <Text variant="h2">Détail document</Text>

                <TextInput
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="Titre"
                  placeholderTextColor={colors.slate}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.white,
                    marginTop: spacing.sm
                  }}
                />

                <TextInput
                  value={editDescription}
                  onChangeText={setEditDescription}
                  placeholder="Description"
                  placeholderTextColor={colors.slate}
                  multiline
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.white,
                    marginTop: spacing.sm,
                    minHeight: 64
                  }}
                />

                <TextInput
                  value={editTags}
                  onChangeText={setEditTags}
                  placeholder="Tags"
                  placeholderTextColor={colors.slate}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.white,
                    marginTop: spacing.sm
                  }}
                />

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  {DOC_STATUSES.map((itemStatus) => (
                    <Button
                      key={itemStatus}
                      label={itemStatus}
                      kind={editStatus === itemStatus ? 'primary' : 'ghost'}
                      onPress={() => setEditStatus(itemStatus)}
                      disabled={submitting || loadingDetail}
                    />
                  ))}
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button label="Enregistrer meta" onPress={() => void updateDocument()} disabled={submitting || loadingDetail} />
                  <Button label="Supprimer (soft)" kind="ghost" onPress={() => void removeDocument()} disabled={submitting || loadingDetail} />
                  <Button label="Partager (MVP)" kind="ghost" disabled />
                </View>

                <View style={{ marginTop: spacing.md }}>
                  <Text variant="bodyStrong">Versions</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button label="Ajouter version (import)" onPress={() => void addVersion('import')} disabled={submitting || loadingDetail} />
                    <Button label="Ajouter version (photo)" kind="ghost" onPress={() => void addVersion('capture')} disabled={submitting || loadingDetail} />
                  </View>

                  {activeVersionMedia ? (
                    isImageMedia(activeVersionMedia) && activeVersionMedia.local_thumb_path ? (
                      <Image
                        source={{ uri: activeVersionMedia.local_thumb_path }}
                        style={{ width: '100%', height: 96, borderRadius: radii.sm, marginTop: spacing.sm }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={{
                          width: '100%',
                          height: 72,
                          borderRadius: radii.sm,
                          marginTop: spacing.sm,
                          backgroundColor: colors.fog,
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Text variant="caption" style={{ color: colors.slate }}>
                          Version active: {activeVersionMedia.mime.toUpperCase()}
                        </Text>
                      </View>
                    )
                  ) : null}

                  <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
                    {selectedVersions.map((version) => (
                      <View
                        key={version.id}
                        style={{
                          borderWidth: 1,
                          borderColor:
                            selectedDocument.active_version_id === version.id ? colors.teal : colors.fog,
                          borderRadius: radii.md,
                          padding: spacing.sm
                        }}
                      >
                        <Text variant="caption">
                          v{version.version_number} • {version.file_mime} • {formatBytes(version.file_size)}
                        </Text>
                        <Text variant="caption" style={{ color: colors.slate }} numberOfLines={1}>
                          hash: {version.file_hash}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                          <Button
                            label="Activer"
                            kind="ghost"
                            onPress={() => void activateVersion(version.id)}
                            disabled={selectedDocument.active_version_id === version.id || submitting || loadingDetail}
                          />
                        </View>
                      </View>
                    ))}
                    {selectedVersions.length === 0 ? (
                      <Text variant="caption" style={{ color: colors.slate }}>
                        Aucune version pour ce document.
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View style={{ marginTop: spacing.md }}>
                  <Text variant="bodyStrong">Liens inter-modules</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                    {LINKED_ENTITIES.map((entity) => (
                      <Button
                        key={entity}
                        label={entity}
                        kind={linkEntity === entity ? 'primary' : 'ghost'}
                        onPress={() => setLinkEntity(entity)}
                        disabled={submitting || loadingDetail}
                      />
                    ))}
                  </View>

                  <TextInput
                    value={linkEntityId}
                    onChangeText={setLinkEntityId}
                    placeholder="Identifiant entité liée"
                    placeholderTextColor={colors.slate}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.fog,
                      borderRadius: radii.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      backgroundColor: colors.white,
                      marginTop: spacing.sm
                    }}
                  />

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button label="Créer lien" onPress={() => void addLink()} disabled={submitting || loadingDetail} />
                  </View>

                  <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
                    {selectedLinks.map((link) => (
                      <Text key={link.id} variant="caption" style={{ color: colors.slate }}>
                        {link.linked_entity} • {link.linked_id}
                      </Text>
                    ))}
                    {selectedLinks.length === 0 ? (
                      <Text variant="caption" style={{ color: colors.slate }}>
                        Aucun lien pour ce document.
                      </Text>
                    ) : null}
                  </View>
                </View>
              </ScrollView>
            </Card>
          ) : null}
        </View>

        {error ? (
          <Text variant="caption" style={{ color: colors.rose }}>
            {error}
          </Text>
        ) : null}
      </View>
      </ScrollView>
    </Screen>
  );
}
