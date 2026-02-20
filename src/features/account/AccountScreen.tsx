import React, { useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../core/auth';
import { getSupabaseClient } from '../../core/supabase/client';
import { toErrorMessage } from '../../core/identity-security/utils';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { ReleaseBadge } from '../../ui/components/ReleaseBadge';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { ui } from '../../ui/runtime/ui';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

export function AccountScreen() {
  const { colors, spacing } = useTheme();
  const { user, activeOrgId, memberRole, role, profile, permissions, signOut, refreshMembership, refreshAuthorization } =
    useAuth();
  const [restoringOwner, setRestoringOwner] = useState(false);

  const canAttemptRestoreOwner = Boolean(user && activeOrgId);

  return (
    <Screen>
      <SectionHeader title="Mon compte" subtitle="Session, profil et déconnexion." right={<ReleaseBadge state="READY" />} />

      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="h2">Utilisateur</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Email: {user?.email ?? '—'}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Org active: {activeOrgId ?? '—'}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Rôle org: {memberRole ?? '—'}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Rôle app: {role ?? '—'}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Permissions: {permissions.length > 0 ? `${permissions.length}` : '—'}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Profil: {profile?.display_name ?? '—'}
          </Text>
        </Card>

        <Card>
          <Text variant="h2">Actions</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button
              label={restoringOwner ? 'Restauration en cours…' : 'Restaurer le rôle propriétaire'}
              kind="ghost"
              disabled={!canAttemptRestoreOwner || restoringOwner}
              onPress={() => {
                if (!activeOrgId) return;
                const client = getSupabaseClient();
                if (!client) {
                  ui.showToast('Supabase non configuré.', 'danger');
                  return;
                }

                void (async () => {
                  const confirmed = await ui.showConfirm({
                    title: 'Restaurer le rôle propriétaire',
                    body: "Cette action tente de restaurer le rôle 'OWNER' si aucun propriétaire n'est défini sur l'organisation et si vous en êtes le créateur."
                  });

                  if (!confirmed) {
                    return;
                  }

                  setRestoringOwner(true);
                  try {
                    const { error } = await client.rpc('org_restore_owner', { p_org_id: activeOrgId });
                    if (error) {
                      const message = toErrorMessage(error);
                      const normalized = message.toLowerCase();

                      if (normalized.includes('does not exist')) {
                        ui.showToast(
                          "Backend pas à jour : la RPC 'org_restore_owner' est introuvable. Appliquez les migrations Supabase.",
                          'danger'
                        );
                        return;
                      }

                      if (message.includes('OWNER_ALREADY_EXISTS')) {
                        ui.showToast("Impossible : un propriétaire existe déjà pour cette organisation.", 'warning');
                        return;
                      }

                      if (normalized.includes('only org creator')) {
                        ui.showToast("Impossible : seul le créateur de l'organisation peut restaurer OWNER.", 'warning');
                        return;
                      }

                      ui.showToast(`Échec restauration OWNER : ${message}`, 'danger');
                      return;
                    }

                    ui.showToast('Rôle propriétaire restauré.', 'success');
                    await refreshMembership();
                    await refreshAuthorization();
                  } catch (restoreError) {
                    ui.showToast(`Échec restauration OWNER : ${toErrorMessage(restoreError)}`, 'danger');
                  } finally {
                    setRestoringOwner(false);
                  }
                })();
              }}
            />
            <Button label="Se déconnecter" kind="ghost" onPress={() => void signOut()} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(AccountScreen as any).screenKey = 'ACCOUNT';
