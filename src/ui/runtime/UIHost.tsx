import React, { useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { DrawerPanel } from '../layout/DrawerPanel';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { ui, useUIState, type ToastTone } from './ui';

function toneToView(colors: Record<string, string>, tone: ToastTone) {
  if (tone === 'info') return { bg: colors.infoBg, text: colors.info, icon: 'information' as const };
  if (tone === 'success') return { bg: colors.successBg, text: colors.success, icon: 'check-circle' as const };
  if (tone === 'warning') return { bg: colors.warningBg, text: colors.warningText ?? colors.warning, icon: 'alert' as const };
  if (tone === 'danger') return { bg: colors.dangerBg, text: colors.danger, icon: 'alert-circle' as const };
  return { bg: colors.fog, text: colors.text, icon: 'message-text' as const };
}

export function UIHost() {
  const { toast, drawer } = useUIState();
  const { colors, spacing, radii } = useTheme();

  const palette = useMemo(() => {
    return toast ? toneToView(colors as unknown as Record<string, string>, toast.tone) : null;
  }, [colors, toast]);

  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const handle = setTimeout(() => ui.clearToast(id), toast.durationMs);
    return () => clearTimeout(handle);
  }, [toast]);

  return (
    <>
      {drawer ? (
        <DrawerPanel visible title={drawer.title} width={drawer.width} onClose={() => ui.closeDrawer()}>
          {drawer.content}
        </DrawerPanel>
      ) : null}

      {toast && palette ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: spacing.lg,
            right: spacing.lg,
            bottom: spacing.lg
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => ui.clearToast(toast.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              backgroundColor: colors.surface,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: radii.pill,
                backgroundColor: palette.bg,
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Icon name={palette.icon} size={18} color={palette.text} />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="caption" style={{ color: palette.text }} numberOfLines={3}>
                {toast.message}
              </Text>
            </View>

            <Icon name="close" size={20} muted />
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

