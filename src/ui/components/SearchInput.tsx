import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { TextField } from './TextField';

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Rechercher...',
  disabled = false
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { spacing } = useTheme();

  return (
    <View style={{ position: 'relative' }}>
      <View style={{ position: 'absolute', left: spacing.md, top: 0, bottom: 0, justifyContent: 'center', zIndex: 1 }}>
        <Icon name="magnify" size={20} muted />
      </View>
      <TextField
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        inputStyle={{ paddingLeft: spacing['2xl'] }}
      />
    </View>
  );
}
