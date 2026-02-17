import React from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../components/Button';
import { Text } from '../components/Text';

export function DrawerPanel({
  visible,
  title,
  onClose,
  children,
  width = 420
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const { colors, spacing, radii, shadows } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();

  const isNarrow = viewportWidth < 640;
  const panelWidth = Math.min(width, Math.floor(viewportWidth * 0.92));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />

      <View
        style={{
          position: 'absolute',
          right: 0,
          left: isNarrow ? 0 : undefined,
          bottom: isNarrow ? 0 : 0,
          top: isNarrow ? undefined : 0,
          width: isNarrow ? '100%' : panelWidth,
          maxHeight: isNarrow ? '82%' : '100%',
          backgroundColor: colors.surface,
          padding: spacing.lg,
          borderLeftWidth: isNarrow ? 0 : 1,
          borderTopWidth: isNarrow ? 1 : 0,
          borderColor: colors.border,
          borderTopLeftRadius: isNarrow ? radii.lg : radii.lg,
          borderBottomLeftRadius: isNarrow ? 0 : radii.lg,
          borderTopRightRadius: isNarrow ? radii.lg : 0,
          ...shadows.md
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="h2" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </Text>
          <Button label="Fermer" variant="ghost" onPress={onClose} />
        </View>

        <View style={{ marginTop: spacing.md, flex: 1, minHeight: 0 }}>{children}</View>
      </View>
    </Modal>
  );
}
