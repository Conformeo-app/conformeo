import React from 'react';
import { Pressable, View } from 'react-native';
import { ModuleKey, modules } from '../../core/modules';
import { SyncStatus } from '../../data/sync/runtime';
import { useTheme } from '../theme/ThemeProvider';
import { SyncPill } from './SyncPill';
import { Text } from './Text';

export function Sidebar({
  active,
  onSelect,
  compact,
  syncStatus
}: {
  active: ModuleKey;
  onSelect: (key: ModuleKey) => void;
  compact?: boolean;
  syncStatus: SyncStatus;
}) {
  const { colors, spacing, radii } = useTheme();

  return (
    <View
      style={{
        padding: spacing.lg,
        backgroundColor: colors.white,
        borderRightWidth: compact ? 0 : 1,
        borderBottomWidth: compact ? 1 : 0,
        borderColor: colors.fog
      }}
    >
      <Text variant="h1" style={{ marginBottom: spacing.md }}>
        Conformeo
      </Text>

      <SyncPill
        phase={syncStatus.phase}
        queueDepth={syncStatus.queueDepth}
        deadLetterCount={syncStatus.deadLetterCount}
        lastError={syncStatus.lastError}
        lastSyncedAt={syncStatus.lastSyncedAt}
        lastResult={syncStatus.lastResult}
      />

      {modules.map((m) => {
        const isActive = m.key === active;
        return (
          <Pressable
            key={m.key}
            onPress={() => onSelect(m.key)}
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radii.md,
              marginBottom: spacing.sm,
              backgroundColor: isActive ? colors.mint : 'transparent'
            }}
          >
            <Text variant="bodyStrong" style={{ color: isActive ? colors.ink : colors.slate }}>
              {m.label}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, opacity: 0.7 }}>
              {m.hint}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
