import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { OrganizationMember, OrgMemberRole, TeamRecord, members, teams } from '../../data/orgs-admin';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { ReleaseBadge } from '../../ui/components/ReleaseBadge';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const INVITE_ROLES: OrgMemberRole[] = ['admin', 'manager', 'inspector', 'viewer'];

const ROLE_LABEL: Record<OrgMemberRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  manager: 'Responsable',
  inspector: 'Terrain',
  viewer: 'Lecture'
};

const MEMBER_STATUS_LABEL: Record<OrganizationMember['status'], string> = {
  INVITED: 'Invité',
  ACTIVE: 'Actif'
};

function getErrorMessage(error: unknown) {
  const normalize = (input: string) => {
    const value = input.toLowerCase();
    if (value.includes('self_role_change_forbidden') || value.includes('owner cannot change own role')) {
      return 'Vous ne pouvez pas modifier votre propre rôle.';
    }
    if (value.includes('owner_role_locked') || value.includes('owner role is locked')) {
      return 'Le rôle Propriétaire est verrouillé.';
    }
    if (value.includes('last_admin_forbidden') || value.includes('cannot remove last admin')) {
      return 'Impossible de retirer le dernier administrateur.';
    }
    return input;
  };

  if (error instanceof Error && error.message) {
    return normalize(error.message);
  }

  return 'Erreur inconnue';
}

export function TeamScreen() {
  const { colors, spacing, radii } = useTheme();
  const { role, memberRole, permissions, user } = useAuth();
  const authUserId = user?.id ?? null;

  const [memberRows, setMemberRows] = useState<OrganizationMember[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRecord[]>([]);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgMemberRole>('manager');
  const [teamNameDraft, setTeamNameDraft] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const matchesPermission = useCallback((required: string, granted: string) => {
    if (granted === '*') return true;
    if (granted === required) return true;
    if (granted.endsWith(':*')) {
      const prefix = granted.slice(0, -1);
      return required.startsWith(prefix);
    }
    return false;
  }, []);

  const hasPermission = useCallback(
    (required: string) => permissions.some((granted) => matchesPermission(required, granted)),
    [matchesPermission, permissions]
  );

  const canManage =
    hasPermission('team:manage') ||
    hasPermission('team:*') ||
    hasPermission('team:write') ||
    role === 'ADMIN' ||
    memberRole === 'owner' ||
    memberRole === 'admin';

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
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xl, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader
          title="Équipe"
          subtitle="Membres & équipes (invitation, rôles, affectation)."
          right={<ReleaseBadge state="BETA" />}
        />

        <View style={{ gap: spacing.md }}>
          {!canManage ? (
            <Card>
              <Text variant="bodyStrong">Lecture seule</Text>
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                La gestion des membres et des équipes est réservée aux administrateurs.
              </Text>
            </Card>
          ) : null}

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
                editable={canManage && !busy}
                style={[
                  inputStyle,
                  !canManage ? { backgroundColor: colors.sand, color: colors.slate } : null
                ]}
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
                      disabled={!canManage || busy}
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
                  disabled={!canManage || busy || inviteEmail.trim().length < 5}
                />
              </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {memberRows.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucun membre.
                </Text>
              ) : (
                memberRows.map((item) => {
                  const isSelf = Boolean(authUserId) && item.user_id === authUserId;
                  const isOwner = item.role === 'owner';
                  const lockedReason = isSelf
                    ? 'Vous ne pouvez pas modifier votre propre rôle.'
                    : isOwner
                      ? 'Le rôle Propriétaire est verrouillé.'
                      : null;

                  return (
                    <Card key={`${item.user_id ?? item.email ?? item.invited_at}-${item.role}`}>
                      <Text variant="bodyStrong">
                        {item.email ?? item.user_id ?? 'invitation sans utilisateur'}
                        {isSelf ? ' (vous)' : ''}
                      </Text>
                      <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                        Rôle {ROLE_LABEL[item.role]} • Statut {MEMBER_STATUS_LABEL[item.status]}
                      </Text>

                      {item.joined_at ? (
                        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                          Rejoint le {new Date(item.joined_at).toLocaleString('fr-FR')}
                        </Text>
                      ) : null}

                      {canManage && item.user_id ? (
                        lockedReason ? (
                          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                            {lockedReason}
                          </Text>
                        ) : (
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
                        )
                      ) : null}
                    </Card>
                  );
                })
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
                editable={canManage && !busy}
                style={[
                  inputStyle,
                  { flex: 1 },
                  !canManage ? { backgroundColor: colors.sand, color: colors.slate } : null
                ]}
              />
              <Button
                label="Créer"
                kind="ghost"
                onPress={() => void createTeam()}
                disabled={!canManage || busy || teamNameDraft.trim().length < 2}
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
                                {canManage ? (
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

                      {canManage && availableMembers.length > 0 ? (
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
