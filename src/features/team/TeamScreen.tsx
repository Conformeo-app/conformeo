import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { OrganizationMember, OrgMemberRole, TeamRecord, members, teams } from '../../data/orgs-admin';
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

export function TeamScreen() {
  const { colors, spacing, radii } = useTheme();
  const { role } = useAuth();

  const [memberRows, setMemberRows] = useState<OrganizationMember[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRecord[]>([]);

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

  const refreshMembers = useCallback(async () => {
    const data = await members.list();
    setMemberRows(data);
  }, []);

  const refreshTeams = useCallback(async () => {
    const data = await teams.list();
    setTeamRows(data);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshMembers(), refreshTeams()]);
  }, [refreshMembers, refreshTeams]);

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
      setInfo('Équipe créée.');
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

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="Équipe" subtitle="Membres & équipes (invitation, rôles, affectation)." />

        <View style={{ gap: spacing.md }}>
          {error ? (
            <Card>
              <Text variant="bodyStrong" style={{ color: colors.rose }}>
                {error}
              </Text>
            </Card>
          ) : null}

          {info ? (
            <Card>
              <Text variant="body" style={{ color: colors.slate }}>
                {info}
              </Text>
            </Card>
          ) : null}

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
                      disabled={!isAdmin}
                    >
                      <Text variant="caption" style={{ color: active ? colors.ink : colors.slate }}>
                        {ROLE_LABEL[roleOption]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Button
                label={busy ? 'Envoi...' : 'Inviter'}
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
                        <Button label="Retirer" kind="ghost" onPress={() => void removeMember(item.user_id!)} disabled={busy} />
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
        </View>
      </ScrollView>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(TeamScreen as any).screenKey = 'TEAM';
