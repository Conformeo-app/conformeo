import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useEnabledModules } from '../../navigation/EnabledModulesProvider';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'EnterpriseHub'>;

export function EnterpriseHubScreen({ navigation }: Props) {
  const { spacing, colors } = useTheme();
  const { availableModules } = useEnabledModules();

  const actions = useMemo(
    () => [
      { key: 'orgs', label: 'Paramètres org', route: 'OrgAdmin' as const },
      { key: 'company', label: 'Company Hub', route: 'CompanyHub' as const },
      { key: 'offers', label: 'Offres', route: 'Offers' as const },
      { key: 'governance', label: 'Gouvernance', route: 'Governance' as const },
      { key: 'backup', label: 'Sauvegarde', route: 'Backup' as const }
    ],
    []
  );

  const enabled = actions.filter((item) => availableModules.includes(item.key as any));

  return (
    <Screen>
      <SectionHeader title="Entreprise" subtitle="Espace entreprise: équipe, paramètres, modules, offres, gouvernance." />

      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="h2">Accès rapide</Text>
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
                Aucun module entreprise actif.
              </Text>
            )}
          </View>
        </Card>
      </View>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(EnterpriseHubScreen as any).screenKey = 'ENTERPRISE_HUB';
