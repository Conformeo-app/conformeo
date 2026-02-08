import React from 'react';
import { View } from 'react-native';
import { useAuth } from '../../core/auth';
import { appEnv } from '../../core/env';
import { securityPolicies } from '../../core/security/policies';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

export function SecurityScreen() {
  const { colors, spacing } = useTheme();
  const { user, activeOrgId, signOut } = useAuth();

  return (
    <Screen>
      <SectionHeader
        title="Securite"
        subtitle="Moindre privilege, RLS stricte, audit complet et anti-copie."
      />

      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="h2">Session active</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Utilisateur: {user?.email ?? 'inconnu'}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Organization active: {activeOrgId ?? 'non definie'}
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Button label="Se deconnecter" kind="ghost" onPress={() => void signOut()} />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Configuration backend</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Supabase configure: {appEnv.isSupabaseConfigured ? 'oui' : 'non'}
          </Text>
          {!appEnv.isSupabaseConfigured ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
              Renseigner EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY.
            </Text>
          ) : null}
        </Card>

        <Card>
          <Text variant="h2">Politiques actives</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Session max idle: {securityPolicies.maxSessionIdleMinutes} min
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Tentatives sync max: {securityPolicies.maxSyncAttempts}
          </Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Quota offline local: {securityPolicies.maxOfflineQueueItems} operations
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
