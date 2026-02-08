import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { modules } from '../../core/modules';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

export function SearchScreen() {
  const { colors, spacing, radii } = useTheme();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return modules;
    }
    return modules.filter(
      (module) =>
        module.label.toLowerCase().includes(normalized) ||
        module.hint.toLowerCase().includes(normalized)
    );
  }, [query]);

  return (
    <Screen>
      <SectionHeader
        title="Recherche"
        subtitle="Acces immediat aux modules et fonctions critiques."
      />

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Rechercher: offline, plans, signatures..."
        placeholderTextColor={colors.slate}
        style={{
          borderWidth: 1,
          borderColor: colors.fog,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          backgroundColor: colors.white,
          marginBottom: spacing.md
        }}
      />

      <View style={{ gap: spacing.sm }}>
        {results.map((item) => (
          <Card key={item.key}>
            <Text variant="h2">{item.label}</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              {item.hint}
            </Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
