import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { View } from 'react-native';
import { nav } from '../../navigation/nav';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';

type ParamList = {
  ModuleDisabled: { moduleKey?: string; moduleLabel?: string; reason?: string } | undefined;
};

type ScreenProps = NativeStackScreenProps<ParamList, 'ModuleDisabled'>;

export type ModuleDisabledProps = {
  moduleKey?: string;
  moduleLabel?: string;
  reason?: string;
};

export function ModuleDisabledScreen(props: ScreenProps | ModuleDisabledProps) {
  const { spacing, colors } = useTheme();

  const params: ModuleDisabledProps =
    'route' in props ? (props.route.params ?? {}) : props;

  const label = params.moduleLabel ?? params.moduleKey ?? 'Ce module';
  const reason =
    params.reason ??
    "Ce module est désactivé pour votre organisation (feature flag).";

  return (
    <Screen>
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Text variant="h1">Module désactivé</Text>

        <Card>
          <Text variant="bodyStrong">{label}</Text>
          <Text variant="body" style={{ color: colors.mutedText, marginTop: spacing.sm }}>
            {reason}
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Retour au tableau de bord" kind="ghost" onPress={() => nav.goDashboard()} />
            <Button label="Voir Entreprise" kind="ghost" onPress={() => nav.goEnterprise()} />
            <Button label="Voir Chantiers" kind="ghost" onPress={() => nav.goProjects()} />
          </View>
        </Card>

        <Text variant="caption" style={{ color: colors.mutedText }}>
          Si tu penses que c’est une erreur, demande à un admin d’activer le module (Espace Entreprise → Modules).
        </Text>
      </View>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(ModuleDisabledScreen as any).screenKey = 'MODULE_DISABLED';
