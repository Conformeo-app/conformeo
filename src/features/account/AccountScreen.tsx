import React from 'react';
import { View } from 'react-native';
import { useAuth } from '../../core/auth';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

export function AccountScreen() {
  const { colors, spacing } = useTheme();
  const { user, activeOrgId, role, profile, signOut } = useAuth();

  return (
    <Screen>
      <SectionHeader title="Compte" subtitle="Session, profil et déconnexion." />

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
            Rôle: {role ?? '—'}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Profil: {profile?.display_name ?? '—'}
          </Text>
        </Card>

        <Card>
          <Text variant="h2">Actions</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Se déconnecter" kind="ghost" onPress={() => void signOut()} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(AccountScreen as any).screenKey = 'ACCOUNT';
