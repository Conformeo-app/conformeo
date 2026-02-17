import React from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export function TextField({
  label,
  helpText,
  error,
  style,
  inputStyle,
  ...props
}: TextInputProps & {
  label?: string;
  helpText?: string;
  error?: string | null;
  inputStyle?: TextInputProps['style'];
}) {
  const { colors, spacing, radii } = useTheme();

  return (
    <View style={style}>
      {label ? (
        <Text variant="caption" style={{ color: colors.mutedText, marginBottom: spacing.xs }}>
          {label}
        </Text>
      ) : null}

      <TextInput
        {...props}
        placeholderTextColor={colors.mutedText}
        style={[
          {
            minHeight: 44,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.surface,
            color: colors.text
          },
          inputStyle
        ]}
      />

      {error ? (
        <Text variant="caption" style={{ color: colors.danger, marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : helpText ? (
        <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
          {helpText}
        </Text>
      ) : null}
    </View>
  );
}

