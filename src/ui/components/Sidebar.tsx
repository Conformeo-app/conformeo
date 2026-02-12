import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ModuleKey, modules } from '../../core/modules';
import { SyncStatus } from '../../data/sync/runtime';
import { useTheme } from '../theme/ThemeProvider';
import { SyncPill } from './SyncPill';
import { Text } from './Text';

export function Sidebar({
  active,
  onSelect,
  compact,
  syncStatus,
  availableModules
}: {
  active: ModuleKey;
  onSelect: (key: ModuleKey) => void;
  compact?: boolean;
  syncStatus: SyncStatus;
  availableModules?: ModuleKey[];
}) {
  const { colors, spacing, radii } = useTheme();

  const visibleModules = useMemo(() => {
    if (!availableModules) {
      return modules;
    }

    const allowed = new Set<ModuleKey>(availableModules);
    return modules.filter((item) => allowed.has(item.key));
  }, [availableModules]);

  if (compact) {
    return (
      <View
        style={{
          padding: spacing.md,
          backgroundColor: colors.white,
          borderBottomWidth: 1,
          borderColor: colors.fog,
          gap: spacing.sm
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="h2">Conformeo</Text>
          <Text variant="caption" style={{ color: colors.slate }}>
            Mobile
          </Text>
        </View>

        <SyncPill
          phase={syncStatus.phase}
          queueDepth={syncStatus.queueDepth}
          deadLetterCount={syncStatus.deadLetterCount}
          lastError={syncStatus.lastError}
          lastSyncedAt={syncStatus.lastSyncedAt}
          lastResult={syncStatus.lastResult}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}
        >
          {visibleModules.map((m) => {
            const isActive = m.key === active;
            return (
              <Pressable
                key={m.key}
                onPress={() => onSelect(m.key)}
                style={{
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: radii.pill,
                  borderWidth: 1,
                  borderColor: isActive ? colors.teal : colors.fog,
                  backgroundColor: isActive ? colors.mint : colors.white,
                  minWidth: 108
                }}
              >
                <Text variant="bodyStrong" style={{ color: isActive ? colors.ink : colors.slate }}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={{
        padding: spacing.lg,
        backgroundColor: colors.white,
        borderRightWidth: 1,
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

      {visibleModules.map((m) => {
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
