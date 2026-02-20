import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Card } from './Card';
import { Divider } from './Divider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type QuickActionItem = {
  key: string;
  label: string;
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
  onPress: () => void;
};

export function QuickActions({
  title = 'Actions rapides',
  subtitle,
  items,
  style
}: {
  title?: string;
  subtitle?: string;
  items: QuickActionItem[];
  style?: ViewStyle;
}) {
  const { colors, spacing, radii } = useTheme();

  return (
    <Card style={style}>
      <Text variant="h2">{title}</Text>
      {subtitle ? (
        <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
          {subtitle}
        </Text>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        {items.length === 0 ? (
          <Text variant="caption" style={{ color: colors.mutedText }}>
            Aucune action disponible.
          </Text>
        ) : (
          items.map((item, index) => (
            <View key={item.key}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: item.disabled }}
                disabled={item.disabled}
                onPress={item.onPress}
                style={({ pressed }) => [
                  {
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.sm,
                    borderRadius: radii.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    opacity: item.disabled ? 0.45 : pressed ? 0.9 : 1
                  }
                ]}
              >
                {item.icon ? <Icon name={item.icon} size={20} color={colors.text} /> : null}

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text variant="caption" style={{ color: colors.mutedText }} numberOfLines={2}>
                      {item.hint}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          ))
        )}
      </View>
    </Card>
  );
}
