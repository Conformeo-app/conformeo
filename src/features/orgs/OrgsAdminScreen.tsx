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
  const { colors, spacing, radii } = useTheme();
  const { role } = useAuth();

  const [organization, setOrganization] = useState<OrganizationRecord | null>(null);
  const [memberRows, setMemberRows] = useState<OrganizationMember[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRecord[]>([]);
  const [moduleRows, setModuleRows] = useState<ModuleFlag[]>([]);
  const [modulePayloadDrafts, setModulePayloadDrafts] = useState<Record<string, string>>({});

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
    await Promise.all([refreshOrganization(), refreshMembers(), refreshTeams(), refreshModules()]);
  }, [refreshMembers, refreshModules, refreshOrganization, refreshTeams]);

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
