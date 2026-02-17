import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../core/auth';
import { flags } from '../../data/feature-flags';
import { useEnabledModules } from '../../navigation/EnabledModulesProvider';
import type { SecurityStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

type Props = NativeStackScreenProps<SecurityStackParamList, 'SecurityHub'>;

export function SecurityHubScreen({ navigation }: Props) {
  const { spacing, colors } = useTheme();
  const { availableModules } = useEnabledModules();
  const { activeOrgId, role } = useAuth();
  const galleryEnabled =
    __DEV__ || (role === 'ADMIN' && flags.isEnabled('ui_gallery', { orgId: activeOrgId ?? undefined, fallback: false }));

  const actions = useMemo(
    () => [
      { key: 'search', label: 'Recherche', route: 'Search' as const },
      { key: 'security', label: 'Identité & MFA', route: 'SecuritySettings' as const },
      { key: 'offline', label: 'Offline / Sync', route: 'Offline' as const },
      { key: 'conflicts', label: 'Conflits', route: 'Conflicts' as const },
      { key: 'audit', label: 'Audit', route: 'Audit' as const },
      { key: 'superadmin', label: 'Super Admin', route: 'SuperAdmin' as const }
    ],
    []
  );

  const enabled = actions.filter((item) => availableModules.includes(item.key as any));

  return (
    <Screen>
      <SectionHeader title="Sécurité" subtitle="Accès aux outils de sécurité, audit et sync (selon modules activés)." />

      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="h2">Raccourcis</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Les entrées apparaissent uniquement si le module est activé via feature flags.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            {enabled.length ? (
              enabled.map((item) => (
                <Button key={item.key} label={item.label} kind="ghost" onPress={() => navigation.navigate(item.route)} />
              ))
            ) : (
              <Text variant="caption" style={{ color: colors.slate }}>
                Aucun module sécurité actif.
              </Text>
            )}
          </View>
        </Card>

        {galleryEnabled ? (
          <Card>
            <Text variant="h2">Outils internes</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Disponible en dev, ou si le flag `ui_gallery` est activé (admins uniquement), pour valider le Design System.
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="UI Gallery" kind="ghost" onPress={() => navigation.navigate('UIGallery')} />
            </View>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(SecurityHubScreen as any).screenKey = 'SECURITY_HUB';
