import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { admin, AdminOrg, AdminOrgUser, AdminSelf } from '../../data/super-admin';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

function normalizeText(value: string) {
  return value.trim();
}

function shortId(value: string) {
  const cleaned = normalizeText(value);
  if (cleaned.length <= 10) return cleaned;
  return `${cleaned.slice(0, 6)}…${cleaned.slice(-4)}`;
}

export function SuperAdminScreen() {
  const { colors, spacing, radii } = useTheme();
  const { user } = useAuth();

  const [self, setSelf] = useState<AdminSelf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [orgQuery, setOrgQuery] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [orgUsers, setOrgUsers] = useState<AdminOrgUser[]>([]);

  const [reasonDraft, setReasonDraft] = useState('');

  const selectedOrg = useMemo(() => orgs.find((o) => o.id === selectedOrgId) ?? null, [orgs, selectedOrgId]);

  const refreshSelf = useCallback(async () => {
    setError(null);
    try {
      const next = await admin.self();
      setSelf(next);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Impossible de charger super-admin.self';
      setSelf(null);
      setError(message);
    }
  }, []);

  const refreshOrgs = useCallback(async () => {
    setError(null);
    try {
      const next = await admin.listOrgs({ limit: 50, query: orgQuery || undefined });
      setOrgs(next);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Impossible de charger la liste des orgs';
      setError(message);
    }
  }, [orgQuery]);

  const refreshOrgUsers = useCallback(
    async (orgId: string) => {
      setError(null);
      try {
        const next = await admin.listOrgUsers(orgId);
        setOrgUsers(next);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Impossible de charger les membres";
        setError(message);
      }
    },
    []
  );

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await refreshSelf();
      await refreshOrgs();
      if (selectedOrgId) {
        await refreshOrgUsers(selectedOrgId);
      }
    } finally {
      setLoading(false);
    }
  }, [refreshOrgs, refreshOrgUsers, refreshSelf, selectedOrgId]);

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectOrg = useCallback(
    async (orgId: string) => {
      setSelectedOrgId(orgId);
      setOrgUsers([]);
      await refreshOrgUsers(orgId);
    },
    [refreshOrgUsers]
  );

  const revokeSessions = useCallback(async (targetUserId: string) => {
    Alert.alert(
      'Révoquer les sessions',
      `Révoquer toutes les sessions actives de ${shortId(targetUserId)} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Révoquer',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLoading(true);
              setError(null);
              try {
                const res = await admin.revokeUserSessions({
                  user_id: targetUserId,
                  org_id: selectedOrgId ?? undefined
                });
                Alert.alert('OK', `Sessions révoquées: ${res.revoked}`);
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Révocation impossible';
                setError(message);
              } finally {
                setLoading(false);
              }
            })();
          }
        }
      ]
    );
  }, [selectedOrgId]);

  const resetMfa = useCallback(async (targetUserId: string) => {
    Alert.alert(
      'Reset MFA',
      `Supprimer tous les facteurs MFA de ${shortId(targetUserId)} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Reset MFA',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLoading(true);
              setError(null);
              try {
                const res = await admin.resetUserMfa(targetUserId);
                Alert.alert('OK', `Facteurs supprimés: ${res.deleted}`);
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Reset MFA impossible';
                setError(message);
              } finally {
                setLoading(false);
              }
            })();
          }
        }
      ]
    );
  }, []);

  const startSupport = useCallback(
    async (targetUserId: string) => {
      const orgId = selectedOrgId;
      if (!orgId) {
        setError('Sélectionne une organisation d’abord.');
        return;
      }

      const reason = normalizeText(reasonDraft);
      if (!reason) {
        setError('Raison obligatoire pour démarrer une session support.');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const session = await admin.startSupportSession({
          org_id: orgId,
          target_user_id: targetUserId,
          reason,
          expires_in_minutes: 30
        });
        Alert.alert('Session support démarrée', `id: ${shortId(session.id)} (30 min)`);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Impossible de démarrer la session support';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [reasonDraft, selectedOrgId]
  );

  const headerSubtitle = useMemo(() => {
    if (!self) {
      return 'Accès restreint (super-admin).';
    }
    if (!self.is_super_admin) {
      return 'Compte non autorisé (pas super-admin).';
    }
    if (!self.mfa_verified) {
      return 'MFA requis (AAL2) pour exécuter des actions.';
    }
    return 'Console multi-tenant (support / audit / sécurité).';
  }, [self]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="Super-admin" subtitle={headerSubtitle} />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Identité</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              user_id: {user?.id ? shortId(user.id) : '—'}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              is_super_admin: {self?.is_super_admin ? 'true' : 'false'} • aal: {self?.aal ?? '—'}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              mfa_verified: {self?.mfa_verified ? 'true' : 'false'}
            </Text>
            {error ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Rafraîchir" onPress={() => void refreshAll()} disabled={loading} />
            </View>
          </Card>

          <Card>
            <Text variant="h2">Organisations</Text>
            <TextInput
              value={orgQuery}
              onChangeText={setOrgQuery}
              placeholder="Rechercher (nom / uuid)"
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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Charger orgs" kind="ghost" onPress={() => void refreshOrgs()} disabled={loading} />
            </View>
            {orgs.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Aucune org.
              </Text>
            ) : (
              orgs.map((org) => (
                <Card
                  key={org.id}
                  style={{
                    marginTop: spacing.sm,
                    borderWidth: 1,
                    borderColor: selectedOrgId === org.id ? colors.teal : colors.fog
                  }}
                >
                  <Button label={`${org.name} (${shortId(org.id)})`} onPress={() => void selectOrg(org.id)} disabled={loading} />
                </Card>
              ))
            )}
          </Card>

          <Card>
            <Text variant="h2">Membres org</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Org sélectionnée: {selectedOrg ? `${selectedOrg.name} (${shortId(selectedOrg.id)})` : '—'}
            </Text>
            <TextInput
              value={reasonDraft}
              onChangeText={setReasonDraft}
              placeholder="Raison (obligatoire pour support session)"
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

            {orgUsers.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Aucun membre chargé.
              </Text>
            ) : (
              orgUsers.map((member) => (
                <Card key={`${member.org_id}:${member.user_id}`} style={{ marginTop: spacing.sm }}>
                  <Text variant="bodyStrong">{member.display_name ?? 'Utilisateur'}</Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    user_id: {shortId(member.user_id)} • role: {member.role} • status: {member.status}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button label="Support session" onPress={() => void startSupport(member.user_id)} disabled={loading} />
                    <Button
                      label="Revoke sessions"
                      kind="ghost"
                      onPress={() => void revokeSessions(member.user_id)}
                      disabled={loading}
                    />
                    <Button label="Reset MFA" kind="ghost" onPress={() => void resetMfa(member.user_id)} disabled={loading} />
                  </View>
                </Card>
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
