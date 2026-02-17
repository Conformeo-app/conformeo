import { useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import {
  ModuleFlag,
  OrganizationMember,
  OrganizationRecord,
  OrgMemberRole,
  TeamRecord,
  members,
  modules,
  org,
  teams
} from '../../data/orgs-admin';
import { OrgQuotas, OrgUsage, quotas } from '../../data/quotas-limits';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const INVITE_ROLES: OrgMemberRole[] = ['admin', 'manager', 'inspector', 'viewer'];

const ROLE_LABEL: Record<OrgMemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  inspector: 'Terrain',
  viewer: 'Lecture'
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Erreur inconnue';
}

export function OrgsAdminScreen() {
  const route = useRoute();
  const { colors, spacing, radii } = useTheme();
  const { role } = useAuth();

  if (__DEV__ && route.name === 'TeamHome') {
    // This screen is part of the Enterprise stack (OrgAdmin). If it shows up under TeamHome,
    // the drawer route wiring is wrong and "Équipe" will render enterprise UI.
    throw new Error('[nav] OrgsAdminScreen ne doit jamais être monté sur TeamHome. Vérifie TeamStackScreen.');
  }

  const [organization, setOrganization] = useState<OrganizationRecord | null>(null);
  const [memberRows, setMemberRows] = useState<OrganizationMember[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRecord[]>([]);
  const [moduleRows, setModuleRows] = useState<ModuleFlag[]>([]);
  const [modulePayloadDrafts, setModulePayloadDrafts] = useState<Record<string, string>>({});

  const [quotaRow, setQuotaRow] = useState<OrgQuotas | null>(null);
  const [usageRow, setUsageRow] = useState<OrgUsage | null>(null);

  const [storageMbDraft, setStorageMbDraft] = useState('');
  const [exportsPerDayDraft, setExportsPerDayDraft] = useState('');
  const [mediaPerDayDraft, setMediaPerDayDraft] = useState('');
  const [maxFileMbDraft, setMaxFileMbDraft] = useState('');

  const [orgNameDraft, setOrgNameDraft] = useState('');
  const [siretDraft, setSiretDraft] = useState('');
  const [addressDraft, setAddressDraft] = useState('');
  const [pdfTemplateDraft, setPdfTemplateDraft] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgMemberRole>('manager');
  const [teamNameDraft, setTeamNameDraft] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isAdmin = role === 'ADMIN';

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.fog,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    backgroundColor: colors.white
  } as const;

  const hydrateOrgDraft = useCallback((value: OrganizationRecord) => {
    setOrgNameDraft(value.name);
    setSiretDraft(value.siret ?? '');
    setAddressDraft(value.address ?? '');

    const maybeTemplate = value.settings_json.pdf_template;
    setPdfTemplateDraft(typeof maybeTemplate === 'string' ? maybeTemplate : '');
  }, []);

  const hydrateQuotasDraft = useCallback((value: OrgQuotas) => {
    setStorageMbDraft(String(value.storage_mb));
    setExportsPerDayDraft(String(value.exports_per_day));
    setMediaPerDayDraft(String(value.media_per_day));
    setMaxFileMbDraft(String(value.max_file_mb));
  }, []);

  const refreshQuotas = useCallback(async () => {
    const [nextQuotas, nextUsage] = await Promise.all([quotas.get(), quotas.getUsage()]);
    setQuotaRow(nextQuotas);
    setUsageRow(nextUsage);
    hydrateQuotasDraft(nextQuotas);
  }, [hydrateQuotasDraft]);

  const refreshOrganization = useCallback(async () => {
    const data = await org.getCurrent();
    setOrganization(data);
    hydrateOrgDraft(data);
  }, [hydrateOrgDraft]);

  const refreshMembers = useCallback(async () => {
    const data = await members.list();
    setMemberRows(data);
  }, []);

  const refreshTeams = useCallback(async () => {
    const data = await teams.list();
    setTeamRows(data);
  }, []);

  const refreshModules = useCallback(async () => {
    const data = await modules.listEnabled();
    setModuleRows(data);
    setModulePayloadDrafts((current) => {
      const next = { ...current };
      for (const item of data) {
        next[item.key] = JSON.stringify(item.payload ?? {}, null, 2);
      }
      return next;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshOrganization(), refreshMembers(), refreshTeams(), refreshModules(), refreshQuotas()]);
  }, [refreshMembers, refreshModules, refreshOrganization, refreshTeams, refreshQuotas]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setBusy(true);
      setError(null);
      try {
        await refreshAll();
      } catch (refreshError) {
        if (!cancelled) {
          setError(getErrorMessage(refreshError));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  const withBusy = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await work();
    } catch (workError) {
      setError(getErrorMessage(workError));
    } finally {
      setBusy(false);
    }
  };

  const memberByUserId = useMemo(() => {
    const map = new Map<string, OrganizationMember>();
    for (const item of memberRows) {
      if (item.user_id) {
        map.set(item.user_id, item);
      }
    }
    return map;
  }, [memberRows]);

  const activeMembers = useMemo(
    () => memberRows.filter((item) => item.status === 'ACTIVE' && Boolean(item.user_id)),
    [memberRows]
  );

  const saveOrgSettings = async () => {
    if (!organization) {
      return;
    }

    await withBusy(async () => {
      const next = await org.updateSettings({
        name: orgNameDraft,
        siret: siretDraft,
        address: addressDraft,
        settings_json: {
          ...organization.settings_json,
          pdf_template: pdfTemplateDraft.trim().length > 0 ? pdfTemplateDraft.trim() : null
        }
      });

      setOrganization(next);
      hydrateOrgDraft(next);
      setInfo('Paramètres organisation enregistrés.');
    });
  };

  const inviteMember = async () => {
    await withBusy(async () => {
      await members.invite(inviteEmail, inviteRole);
      setInviteEmail('');
      await refreshMembers();
      setInfo('Invitation envoyée.');
    });
  };

  const changeMemberRole = async (userId: string, nextRole: OrgMemberRole) => {
    await withBusy(async () => {
      await members.changeRole(userId, nextRole);
      await refreshMembers();
      setInfo('Rôle membre mis à jour.');
    });
  };

  const removeMember = async (userId: string) => {
    await withBusy(async () => {
      await members.remove(userId);
      await Promise.all([refreshMembers(), refreshTeams()]);
      setInfo('Membre retiré.');
    });
  };

  const createTeam = async () => {
    await withBusy(async () => {
      await teams.create(teamNameDraft);
      setTeamNameDraft('');
      await refreshTeams();
      setInfo('Equipe créée.');
    });
  };

  const addTeamMember = async (teamId: string, userId: string) => {
    await withBusy(async () => {
      await teams.addMember(teamId, userId);
      await refreshTeams();
      setInfo('Membre ajouté à l’équipe.');
    });
  };

  const removeTeamMember = async (teamId: string, userId: string) => {
    await withBusy(async () => {
      await teams.removeMember(teamId, userId);
      await refreshTeams();
      setInfo('Membre retiré de l’équipe.');
    });
  };

  const toggleModule = async (moduleKey: string, enabled: boolean) => {
    await withBusy(async () => {
      await modules.setEnabled(moduleKey, enabled);
      await refreshModules();
      setInfo(`Module ${moduleKey} ${enabled ? 'activé' : 'désactivé'}.`);
    });
  };

  const updateModulePayloadDraft = (moduleKey: string, nextValue: string) => {
    setModulePayloadDrafts((current) => ({
      ...current,
      [moduleKey]: nextValue
    }));
  };

  const saveModulePayload = async (moduleKey: string) => {
    await withBusy(async () => {
      const draft = modulePayloadDrafts[moduleKey] ?? '{}';
      const parsed = JSON.parse(draft) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Payload invalide: objet JSON attendu.');
      }

      await modules.setPayload(moduleKey, parsed as Record<string, unknown>);
      await refreshModules();
      setInfo(`Payload module ${moduleKey} enregistré.`);
    });
  };

  const rollbackModule = async (moduleKey: string) => {
    await withBusy(async () => {
      await modules.rollback(moduleKey);
      await refreshModules();
      setInfo(`Rollback module ${moduleKey} appliqué.`);
    });
  };

  const refreshQuotasRemote = async () => {
    await withBusy(async () => {
      const result = await quotas.refresh();
      if (!result) {
        setInfo("Quotas indisponibles (pas d'organisation active).");
        return;
      }

      setQuotaRow(result.quotas);
      setUsageRow(result.usage);
      hydrateQuotasDraft(result.quotas);
      setInfo('Quotas rafraichis.');
    });
  };

  const saveQuotasSettings = async () => {
    if (!isAdmin) {
      return;
    }

    await withBusy(async () => {
      const patch: Partial<Omit<OrgQuotas, 'org_id' | 'updated_at'>> = {};

      const storageMb = Number.parseInt(storageMbDraft, 10);
      const exportsPerDay = Number.parseInt(exportsPerDayDraft, 10);
      const mediaPerDay = Number.parseInt(mediaPerDayDraft, 10);
      const maxFileMb = Number.parseInt(maxFileMbDraft, 10);

      if (Number.isFinite(storageMb)) patch.storage_mb = storageMb;
      if (Number.isFinite(exportsPerDay)) patch.exports_per_day = exportsPerDay;
      if (Number.isFinite(mediaPerDay)) patch.media_per_day = mediaPerDay;
      if (Number.isFinite(maxFileMb)) patch.max_file_mb = maxFileMb;

      if (Object.keys(patch).length === 0) {
        throw new Error('Aucune valeur quota valide à enregistrer.');
      }

      const next = await quotas.update(patch);
      setQuotaRow(next);
      hydrateQuotasDraft(next);

      const nextUsage = await quotas.getUsage();
      setUsageRow(nextUsage);

      setInfo('Quotas enregistrés.');
    });
  };

  const purgeOldExports = async () => {
    await withBusy(async () => {
      const removed = await quotas.purgeOldExports(7);
      setInfo(`${removed} export(s) purgé(s) (>= 7 jours).`);
    });
  };

  const cleanupLocalCache = async () => {
    await withBusy(async () => {
      await quotas.cleanupCache();
      setInfo('Cache media nettoyé.');
    });
  };


  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Espace Entreprise"
          subtitle="Organisation, équipe, membres et activation modules (feature flags)."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Organisation</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Cache local en lecture actif. Edition réservée admin/owner.
            </Text>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <TextInput
                value={orgNameDraft}
                onChangeText={setOrgNameDraft}
                placeholder="Nom organisation"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
              />
              <TextInput
                value={siretDraft}
                onChangeText={setSiretDraft}
                placeholder="SIRET"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
              />
              <TextInput
                value={addressDraft}
                onChangeText={setAddressDraft}
                placeholder="Adresse"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
              />
              <TextInput
                value={pdfTemplateDraft}
                onChangeText={setPdfTemplateDraft}
                placeholder="Template PDF par défaut"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
              />
            </View>

            <View style={{ marginTop: spacing.md }}>
              <Button
                label={busy ? 'Enregistrement...' : 'Enregistrer paramètres'}
                onPress={() => void saveOrgSettings()}
                disabled={!isAdmin || busy || !organization}
              />
            </View>
          </Card>
          <Card>
            <Text variant="h2">Quotas & limites</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Stockage serveur + limites journalières (cache offline). Dépassement : blocage upload/export.
            </Text>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Text variant="body">
                Stockage: {usageRow ? Math.ceil(usageRow.storage_used_mb) : 0} / {quotaRow ? quotaRow.storage_mb : 0} MB
              </Text>
              <Text variant="body">
                Exports aujourd'hui: {usageRow ? usageRow.exports_today : 0} / {quotaRow ? quotaRow.exports_per_day : 0}
              </Text>
              <Text variant="body">
                Médias aujourd'hui: {usageRow ? usageRow.media_today : 0} / {quotaRow ? quotaRow.media_per_day : 0}
              </Text>
              <Text variant="body">Taille fichier max: {quotaRow ? quotaRow.max_file_mb : 0} MB</Text>
              <Text variant="caption" style={{ color: colors.slate }}>
                Dernier calcul: {usageRow?.computed_at ?? quotaRow?.updated_at ?? 'n/a'}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Rafraichir" kind="ghost" onPress={() => void refreshQuotasRemote()} disabled={busy} />
              <Button label="Purger exports (7j)" kind="ghost" onPress={() => void purgeOldExports()} disabled={busy} />
              <Button label="Nettoyer cache" kind="ghost" onPress={() => void cleanupLocalCache()} disabled={busy} />
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <TextInput
                value={storageMbDraft}
                onChangeText={setStorageMbDraft}
                placeholder="Stockage max (MB)"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
                keyboardType="number-pad"
              />
              <TextInput
                value={exportsPerDayDraft}
                onChangeText={setExportsPerDayDraft}
                placeholder="Exports / jour"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
                keyboardType="number-pad"
              />
              <TextInput
                value={mediaPerDayDraft}
                onChangeText={setMediaPerDayDraft}
                placeholder="Médias / jour"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
                keyboardType="number-pad"
              />
              <TextInput
                value={maxFileMbDraft}
                onChangeText={setMaxFileMbDraft}
                placeholder="Taille fichier max (MB)"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
                keyboardType="number-pad"
              />
            </View>

            <View style={{ marginTop: spacing.md }}>
              <Button
                label="Enregistrer quotas"
                onPress={() => void saveQuotasSettings()}
                disabled={!isAdmin || busy}
              />
            </View>
          </Card>

          <Card>
            <Text variant="h2">Membres</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Invitation par email, statut invité/actif, changement de rôle.
            </Text>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <TextInput
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="email@entreprise.com"
                placeholderTextColor={colors.slate}
                style={inputStyle}
                editable={isAdmin}
              />

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {INVITE_ROLES.map((roleOption) => {
                  const active = inviteRole === roleOption;
                  return (
                    <Pressable
                      key={roleOption}
                      onPress={() => setInviteRole(roleOption)}
                      style={{
                        borderRadius: radii.pill,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.xs,
                        backgroundColor: active ? colors.mint : colors.white,
                        borderWidth: 1,
                        borderColor: active ? 'transparent' : colors.fog
                      }}
                    >
                      <Text variant="caption" style={{ color: active ? colors.ink : colors.slate }}>
                        {ROLE_LABEL[roleOption]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Button
                label="Inviter"
                onPress={() => void inviteMember()}
                disabled={!isAdmin || busy || inviteEmail.trim().length < 5}
              />
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {memberRows.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucun membre.
                </Text>
              ) : (
                memberRows.map((item) => (
                  <Card key={`${item.user_id ?? item.email ?? item.invited_at}-${item.role}`}>
                    <Text variant="bodyStrong">{item.email ?? item.user_id ?? 'invitation sans utilisateur'}</Text>
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      Rôle {ROLE_LABEL[item.role]} • Statut {item.status}
                    </Text>

                    {item.joined_at ? (
                      <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                        Rejoint le {new Date(item.joined_at).toLocaleString('fr-FR')}
                      </Text>
                    ) : null}

                    {isAdmin && item.user_id ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                        {INVITE_ROLES.map((roleOption) => (
                          <Button
                            key={`${item.user_id}-${roleOption}`}
                            label={ROLE_LABEL[roleOption]}
                            kind={item.role === roleOption ? 'primary' : 'ghost'}
                            onPress={() => void changeMemberRole(item.user_id!, roleOption)}
                            disabled={busy}
                          />
                        ))}
                        <Button
                          label="Retirer"
                          kind="ghost"
                          onPress={() => void removeMember(item.user_id!)}
                          disabled={busy}
                        />
                      </View>
                    ) : null}
                  </Card>
                ))
              )}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Équipes</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Création d’équipes et affectation membres.
            </Text>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TextInput
                value={teamNameDraft}
                onChangeText={setTeamNameDraft}
                placeholder="Nom équipe"
                placeholderTextColor={colors.slate}
                style={[inputStyle, { flex: 1 }]}
                editable={isAdmin}
              />
              <Button
                label="Créer"
                kind="ghost"
                onPress={() => void createTeam()}
                disabled={!isAdmin || busy || teamNameDraft.trim().length < 2}
              />
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {teamRows.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune équipe.
                </Text>
              ) : (
                teamRows.map((team) => {
                  const availableMembers = activeMembers.filter(
                    (candidate) => candidate.user_id && !team.member_user_ids.includes(candidate.user_id)
                  );

                  return (
                    <Card key={team.id}>
                      <Text variant="bodyStrong">{team.name}</Text>
                      <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                        {team.member_user_ids.length} membre(s)
                      </Text>

                      <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
                        {team.member_user_ids.length === 0 ? (
                          <Text variant="caption" style={{ color: colors.slate }}>
                            Aucun membre affecté.
                          </Text>
                        ) : (
                          team.member_user_ids.map((memberId) => {
                            const item = memberByUserId.get(memberId);
                            return (
                              <View
                                key={`${team.id}-${memberId}`}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: spacing.sm
                                }}
                              >
                                <Text variant="caption" style={{ color: colors.slate, flex: 1 }}>
                                  {item?.email ?? memberId}
                                </Text>
                                {isAdmin ? (
                                  <Button
                                    label="Retirer"
                                    kind="ghost"
                                    onPress={() => void removeTeamMember(team.id, memberId)}
                                    disabled={busy}
                                  />
                                ) : null}
                              </View>
                            );
                          })
                        )}
                      </View>

                      {isAdmin && availableMembers.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                          {availableMembers.slice(0, 8).map((candidate) => (
                            <Button
                              key={`${team.id}-${candidate.user_id}`}
                              label={`+ ${candidate.email ?? candidate.user_id}`}
                              kind="ghost"
                              onPress={() => void addTeamMember(team.id, candidate.user_id!)}
                              disabled={busy}
                            />
                          ))}
                        </View>
                      ) : null}
                    </Card>
                  );
                })
              )}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Modules activés</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Activation via feature flags avec audit admin côté backend.
            </Text>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {moduleRows.map((item) => (
                <Card key={item.key}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: spacing.sm
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{item.key}</Text>
                      <Text variant="caption" style={{ color: colors.slate }}>
                        {item.enabled ? 'Activé' : 'Désactivé'} • source: {item.source ?? 'CACHE'}
                      </Text>
                    </View>

                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <Button
                        label={item.enabled ? 'Désactiver' : 'Activer'}
                        kind={item.enabled ? 'ghost' : 'primary'}
                        onPress={() => void toggleModule(item.key, !item.enabled)}
                        disabled={!isAdmin || busy}
                      />
                      <Button
                        label="Rollback"
                        kind="ghost"
                        onPress={() => void rollbackModule(item.key)}
                        disabled={!isAdmin || busy}
                      />
                    </View>
                  </View>

                  <TextInput
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    value={modulePayloadDrafts[item.key] ?? JSON.stringify(item.payload ?? {}, null, 2)}
                    onChangeText={(value) => updateModulePayloadDraft(item.key, value)}
                    placeholder="Payload JSON"
                    placeholderTextColor={colors.slate}
                    style={{
                      marginTop: spacing.sm,
                      borderWidth: 1,
                      borderColor: colors.fog,
                      borderRadius: radii.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      color: colors.ink,
                      backgroundColor: colors.white,
                      minHeight: 120
                    }}
                    editable={isAdmin}
                  />

                  <View style={{ marginTop: spacing.sm }}>
                    <Button
                      label="Enregistrer payload"
                      kind="ghost"
                      onPress={() => void saveModulePayload(item.key)}
                      disabled={!isAdmin || busy}
                    />
                  </View>
                </Card>
              ))}
            </View>
          </Card>

          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}

          {info ? (
            <Text variant="caption" style={{ color: colors.tealDark }}>
              {info}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(OrgsAdminScreen as any).screenKey = 'ENTERPRISE_ORGS_ADMIN';
