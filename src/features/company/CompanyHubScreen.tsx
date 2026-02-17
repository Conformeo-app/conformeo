import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import {
  bootstrapCompanyHub,
  certs,
  Certification,
  checks,
  CompanyCheck,
  CompanyDocumentType,
  companyHub,
  CompanySection,
  CompanySectionKey,
  hub
} from '../../data/company-hub';
import { Document } from '../../data/documents';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const HUB_TABS = [
  { key: 'DOCS', label: 'Docs' },
  { key: 'CERTS', label: 'Certifications' },
  { key: 'SAFETY', label: 'Sécurité' }
] as const;

type HubTab = (typeof HUB_TABS)[number]['key'];

const DOC_TYPES: CompanyDocumentType[] = ['INTERNAL', 'REPORT', 'CERT'];

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Erreur inconnue';
}

function formatDate(value?: string) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString('fr-FR');
}

function parseDateInput(value: string) {
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeSearch(text: string) {
  return text.trim().toLowerCase();
}

function certStatusColor(status: string, colors: { mint: string; amber: string; rose: string; fog: string }) {
  if (status === 'VALID') return colors.mint;
  if (status === 'EXPIRING') return colors.amber;
  if (status === 'EXPIRED') return colors.rose;
  return colors.fog;
}

export function CompanyHubScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user, role } = useAuth();

  const [activeTab, setActiveTab] = useState<HubTab>('DOCS');
  const [searchQuery, setSearchQuery] = useState('');

  const [sections, setSections] = useState<CompanySection[]>([]);
  const [selectedSection, setSelectedSection] = useState<CompanySectionKey>('DOCS_INTERNAL');
  const [documentsList, setDocumentsList] = useState<Document[]>([]);

  const [docTitle, setDocTitle] = useState('');
  const [docDescription, setDocDescription] = useState('');
  const [docType, setDocType] = useState<CompanyDocumentType>('INTERNAL');

  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [expiringCerts, setExpiringCerts] = useState<Certification[]>([]);
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [certName, setCertName] = useState('');
  const [certIssuer, setCertIssuer] = useState('');
  const [certValidFrom, setCertValidFrom] = useState('');
  const [certValidTo, setCertValidTo] = useState('');

  const [companyChecks, setCompanyChecks] = useState<CompanyCheck[]>([]);
  const [checkComments, setCheckComments] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const canEdit = role === 'ADMIN' || role === 'MANAGER';

  useEffect(() => {
    companyHub.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined,
      role: role ?? undefined
    });
  }, [activeOrgId, role, user?.id]);

  const refreshSections = useCallback(async () => {
    const nextSections = await hub.listSections();
    setSections(nextSections);

    if (nextSections.length === 0) {
      return;
    }

    if (!nextSections.some((item) => item.key === selectedSection)) {
      setSelectedSection(nextSections[0].key);
    }
  }, [selectedSection]);

  const refreshDocuments = useCallback(async () => {
    const nextDocuments = await hub.listDocuments(selectedSection);
    setDocumentsList(nextDocuments);
  }, [selectedSection]);

  const refreshCertifications = useCallback(async () => {
    const [list, expiring] = await Promise.all([certs.list(), certs.getExpiring(60)]);
    setCertifications(list);
    setExpiringCerts(expiring);
  }, []);

  const refreshChecks = useCallback(async () => {
    const nextChecks = await checks.get();
    setCompanyChecks(nextChecks);

    const comments = Object.fromEntries(nextChecks.map((item) => [item.key, item.comment ?? '']));
    setCheckComments(comments);
  }, []);

  const refreshAll = useCallback(async () => {
    if (!activeOrgId) {
      setSections([]);
      setDocumentsList([]);
      setCertifications([]);
      setExpiringCerts([]);
      setCompanyChecks([]);
      setCheckComments({});
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await bootstrapCompanyHub();
      await Promise.all([refreshSections(), refreshDocuments(), refreshCertifications(), refreshChecks()]);
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, refreshCertifications, refreshChecks, refreshDocuments, refreshSections]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!activeOrgId) {
      return;
    }

    void refreshDocuments();
  }, [activeOrgId, refreshDocuments, selectedSection]);

  const withBusy = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      setInfo(null);

      try {
        await work();
      } catch (workError) {
        setError(toErrorMessage(workError));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const filteredDocuments = useMemo(() => {
    const search = normalizeSearch(searchQuery);
    if (!search) {
      return documentsList;
    }

    return documentsList.filter((document) => {
      const haystack = [document.title, document.description ?? '', ...document.tags].join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }, [documentsList, searchQuery]);

  const filteredCertifications = useMemo(() => {
    const search = normalizeSearch(searchQuery);
    if (!search) {
      return certifications;
    }

    return certifications.filter((item) => {
      const haystack = [item.name, item.issuer ?? '', item.status, item.valid_to ?? ''].join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }, [certifications, searchQuery]);

  const filteredChecks = useMemo(() => {
    const search = normalizeSearch(searchQuery);
    if (!search) {
      return companyChecks;
    }

    return companyChecks.filter((item) => {
      const haystack = [item.label, item.key, item.comment ?? ''].join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }, [companyChecks, searchQuery]);

  const createOrUpdateCertification = useCallback(async () => {
    if (!canEdit) {
      setError('Lecture seule pour le rôle terrain.');
      return;
    }

    await withBusy(async () => {
      const payload = {
        name: certName,
        issuer: certIssuer,
        valid_from: parseDateInput(certValidFrom),
        valid_to: parseDateInput(certValidTo)
      };

      if (editingCertId) {
        await certs.update(editingCertId, payload);
        setInfo('Certification mise à jour.');
      } else {
        await certs.create(payload);
        setInfo('Certification créée.');
      }

      setEditingCertId(null);
      setCertName('');
      setCertIssuer('');
      setCertValidFrom('');
      setCertValidTo('');

      await refreshCertifications();
    });
  }, [canEdit, certIssuer, certName, certValidFrom, certValidTo, editingCertId, refreshCertifications, withBusy]);

  const startEditCertification = useCallback((item: Certification) => {
    setEditingCertId(item.id);
    setCertName(item.name);
    setCertIssuer(item.issuer ?? '');
    setCertValidFrom(item.valid_from ? item.valid_from.slice(0, 10) : '');
    setCertValidTo(item.valid_to ? item.valid_to.slice(0, 10) : '');
  }, []);

  const resetCertificationForm = useCallback(() => {
    setEditingCertId(null);
    setCertName('');
    setCertIssuer('');
    setCertValidFrom('');
    setCertValidTo('');
  }, []);

  const addDocument = useCallback(
    async (source: 'capture' | 'import') => {
      if (!canEdit) {
        setError('Lecture seule pour le rôle terrain.');
        return;
      }

      await withBusy(async () => {
        await hub.addDocument(
          selectedSection,
          {
            title: docTitle,
            description: docDescription,
            doc_type: docType,
            tags: ['company_hub']
          },
          {
            source,
            tag: 'company_hub'
          }
        );

        setDocTitle('');
        setDocDescription('');
        setDocType('INTERNAL');

        await refreshDocuments();
        setInfo('Document ajouté au hub entreprise.');
      });
    },
    [canEdit, docDescription, docTitle, docType, refreshDocuments, selectedSection, withBusy]
  );

  const toggleCheck = useCallback(
    async (check: CompanyCheck) => {
      if (!canEdit) {
        setError('Lecture seule pour le rôle terrain.');
        return;
      }

      await withBusy(async () => {
        await checks.toggle(check.key, !check.checked);
        await refreshChecks();
      });
    },
    [canEdit, refreshChecks, withBusy]
  );

  const saveCheckComment = useCallback(
    async (check: CompanyCheck) => {
      if (!canEdit) {
        setError('Lecture seule pour le rôle terrain.');
        return;
      }

      await withBusy(async () => {
        await checks.setComment(check.key, checkComments[check.key] ?? '');
        await refreshChecks();
      });
    },
    [canEdit, checkComments, refreshChecks, withBusy]
  );

  const tabsHeader = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {HUB_TABS.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={{
              borderWidth: 1,
              borderColor: active ? colors.teal : colors.fog,
              backgroundColor: active ? colors.mint : colors.white,
              borderRadius: radii.pill,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md
            }}
          >
            <Text variant="bodyStrong">{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const commonHeader = (
    <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
      <SectionHeader
        title="Espace entreprise"
        subtitle="Documents internes, certifications et sécurité des locaux — hors ligne d'abord."
      />

      {tabsHeader}

      <Card>
        <Text variant="h2">État entreprise</Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Rôle: {role ?? 'TERRAIN'} · Édition {canEdit ? 'autorisée' : 'désactivée (lecture seule)'}
        </Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Certifications à surveiller (60 jours): {expiringCerts.length}
        </Text>

        {info ? (
          <Text variant="caption" style={{ color: colors.teal, marginTop: spacing.sm }}>
            {info}
          </Text>
        ) : null}

        {error ? (
          <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
            {error}
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text variant="h2">Recherche interne</Text>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Rechercher dans l'onglet courant"
          placeholderTextColor={colors.slate}
          style={{
            marginTop: spacing.sm,
            borderWidth: 1,
            borderColor: colors.fog,
            borderRadius: radii.md,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            color: colors.ink
          }}
        />
      </Card>
    </View>
  );

  if (activeTab === 'DOCS') {
    return (
      <Screen>
        <FlatList
          data={filteredDocuments}
          keyExtractor={(item) => item.id}
          style={{ flex: 1, minHeight: 0 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentContainerStyle={{ paddingBottom: spacing.lg }}
          ListHeaderComponent={
            <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
              {commonHeader}

              <Card>
                <Text variant="h2">Sections</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  {sections.map((section) => {
                    const active = section.key === selectedSection;
                    return (
                      <Pressable
                        key={section.id}
                        onPress={() => setSelectedSection(section.key)}
                        style={{
                          borderWidth: 1,
                          borderColor: active ? colors.teal : colors.fog,
                          backgroundColor: active ? colors.mint : colors.white,
                          borderRadius: radii.pill,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.md
                        }}
                      >
                        <Text variant="caption">{section.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>

              <Card>
                <Text variant="h2">Ajouter un document</Text>
                <TextInput
                  value={docTitle}
                  onChangeText={setDocTitle}
                  editable={canEdit && !busy}
                  placeholder="Titre document entreprise"
                  placeholderTextColor={colors.slate}
                  style={{
                    marginTop: spacing.sm,
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    color: colors.ink,
                    opacity: canEdit ? 1 : 0.65
                  }}
                />

                <TextInput
                  value={docDescription}
                  onChangeText={setDocDescription}
                  editable={canEdit && !busy}
                  placeholder="Description"
                  placeholderTextColor={colors.slate}
                  multiline
                  style={{
                    marginTop: spacing.sm,
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    color: colors.ink,
                    minHeight: 72,
                    textAlignVertical: 'top',
                    opacity: canEdit ? 1 : 0.65
                  }}
                />

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  {DOC_TYPES.map((type) => {
                    const active = docType === type;
                    return (
                      <Pressable
                        key={type}
                        onPress={() => setDocType(type)}
                        disabled={!canEdit || busy}
                        style={{
                          borderWidth: 1,
                          borderColor: active ? colors.teal : colors.fog,
                          backgroundColor: active ? colors.mint : colors.white,
                          borderRadius: radii.pill,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.md,
                          opacity: canEdit ? 1 : 0.65
                        }}
                      >
                        <Text variant="caption">{type}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button
                    label="Importer document"
                    onPress={() => void addDocument('import')}
                    disabled={!canEdit || busy || loading}
                  />
                  <Button
                    label="Capture photo"
                    kind="ghost"
                    onPress={() => void addDocument('capture')}
                    disabled={!canEdit || busy || loading}
                  />
                </View>
              </Card>
            </View>
          }
          renderItem={({ item }) => (
            <Card style={{ marginBottom: spacing.sm }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {item.title}
              </Text>
              <Text variant="caption" style={{ color: colors.slate }}>
                {item.doc_type} · {item.status} · {formatDate(item.updated_at)}
              </Text>
              <Text variant="caption" style={{ color: colors.slate }} numberOfLines={2}>
                {item.description ?? 'Sans description'}
              </Text>
            </Card>
          )}
          ListEmptyComponent={
            <Card>
              <Text variant="body" style={{ color: colors.slate }}>
                {loading ? 'Chargement...' : 'Aucun document dans cette section.'}
              </Text>
            </Card>
          }
        />
      </Screen>
    );
  }

  if (activeTab === 'CERTS') {
    return (
      <Screen>
        <FlatList
          data={filteredCertifications}
          keyExtractor={(item) => item.id}
          style={{ flex: 1, minHeight: 0 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentContainerStyle={{ paddingBottom: spacing.lg }}
          ListHeaderComponent={
            <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
              {commonHeader}

              <Card>
                <Text variant="h2">Registre certifications</Text>

                <TextInput
                  value={certName}
                  onChangeText={setCertName}
                  editable={canEdit && !busy}
                  placeholder="Nom certification"
                  placeholderTextColor={colors.slate}
                  style={{
                    marginTop: spacing.sm,
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    color: colors.ink,
                    opacity: canEdit ? 1 : 0.65
                  }}
                />

                <TextInput
                  value={certIssuer}
                  onChangeText={setCertIssuer}
                  editable={canEdit && !busy}
                  placeholder="Émetteur"
                  placeholderTextColor={colors.slate}
                  style={{
                    marginTop: spacing.sm,
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    color: colors.ink,
                    opacity: canEdit ? 1 : 0.65
                  }}
                />

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <TextInput
                    value={certValidFrom}
                    onChangeText={setCertValidFrom}
                    editable={canEdit && !busy}
                    placeholder="Validité début (YYYY-MM-DD)"
                    placeholderTextColor={colors.slate}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: colors.fog,
                      borderRadius: radii.md,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      color: colors.ink,
                      opacity: canEdit ? 1 : 0.65
                    }}
                  />

                  <TextInput
                    value={certValidTo}
                    onChangeText={setCertValidTo}
                    editable={canEdit && !busy}
                    placeholder="Expiration (YYYY-MM-DD)"
                    placeholderTextColor={colors.slate}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: colors.fog,
                      borderRadius: radii.md,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      color: colors.ink,
                      opacity: canEdit ? 1 : 0.65
                    }}
                  />
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button
                    label={editingCertId ? 'Mettre à jour' : 'Créer certification'}
                    onPress={() => void createOrUpdateCertification()}
                    disabled={!canEdit || busy || loading}
                  />
                  {editingCertId ? (
                    <Button label="Annuler" kind="ghost" onPress={resetCertificationForm} disabled={busy} />
                  ) : null}
                </View>
              </Card>
            </View>
          }
          renderItem={({ item }) => (
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {item.issuer ?? 'Émetteur non défini'}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {formatDate(item.valid_from)} → {formatDate(item.valid_to)}
                  </Text>
                </View>

                <View
                  style={{
                    backgroundColor: certStatusColor(item.status, {
                      mint: colors.mint,
                      amber: colors.amber,
                      rose: colors.rose,
                      fog: colors.fog
                    }),
                    borderRadius: radii.pill,
                    paddingVertical: spacing.xs,
                    paddingHorizontal: spacing.sm
                  }}
                >
                  <Text variant="caption">{item.status}</Text>
                </View>
              </View>

              {canEdit ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Button label="Modifier" kind="ghost" onPress={() => startEditCertification(item)} disabled={busy} />
                </View>
              ) : null}
            </Card>
          )}
          ListEmptyComponent={
            <Card>
              <Text variant="body" style={{ color: colors.slate }}>
                {loading ? 'Chargement...' : 'Aucune certification enregistrée.'}
              </Text>
            </Card>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={filteredChecks}
        keyExtractor={(item) => item.id}
        style={{ flex: 1, minHeight: 0 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
            {commonHeader}

            <Card>
              <Text variant="h2">Checklist locaux</Text>
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Incendie, issues, affichages obligatoires et registre sécurité.
              </Text>
            </Card>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{item.label}</Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  {item.key}
                </Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Dernière mise à jour: {formatDate(item.updated_at)}
                </Text>
              </View>

              <Button
                label={item.checked ? 'Conforme' : 'Non conforme'}
                kind={item.checked ? 'primary' : 'ghost'}
                onPress={() => void toggleCheck(item)}
                disabled={!canEdit || busy}
              />
            </View>

            <TextInput
              value={checkComments[item.key] ?? ''}
              onChangeText={(value) =>
                setCheckComments((current) => ({
                  ...current,
                  [item.key]: value
                }))
              }
              editable={canEdit && !busy}
              placeholder="Commentaire"
              placeholderTextColor={colors.slate}
              multiline
              style={{
                marginTop: spacing.sm,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                color: colors.ink,
                minHeight: 64,
                textAlignVertical: 'top',
                opacity: canEdit ? 1 : 0.65
              }}
            />

            <View style={{ marginTop: spacing.sm }}>
              <Button
                label="Enregistrer commentaire"
                kind="ghost"
                onPress={() => void saveCheckComment(item)}
                disabled={!canEdit || busy}
              />
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <Card>
            <Text variant="body" style={{ color: colors.slate }}>
              {loading ? 'Chargement...' : 'Aucun check local disponible.'}
            </Text>
          </Card>
        }
      />
    </Screen>
  );
}
