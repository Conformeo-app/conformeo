import React from 'react';
import { View } from 'react-native';
import { SyncRunResult } from '../../data/sync/types';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

function toLabel(phase: SyncPhase) {
  if (phase === 'syncing') return 'Sync en cours';
  if (phase === 'offline') return 'Sync offline';
  if (phase === 'error') return 'Sync erreur';
  return 'Sync OK';
}

function toColor(phase: SyncPhase) {
  if (phase === 'syncing') return { bg: '#E6F5F7', text: '#1B9AAA' };
  if (phase === 'offline') return { bg: '#FFF4E8', text: '#B35A00' };
  if (phase === 'error') return { bg: '#FCEBEC', text: '#D64550' };
  return { bg: '#E8F5EC', text: '#228B5A' };
}

function formatLastResult(result: SyncRunResult | null) {
  if (!result) {
    return null;
  }
  return `Push:${result.pushed} Retry:${result.failed} Dead:${result.dead}`;
}

export function SyncPill({
  phase,
  queueDepth,
  deadLetterCount,
  lastError,
  lastSyncedAt,
  lastResult
}: {
  phase: SyncPhase;
  queueDepth: number;
  deadLetterCount: number;
  lastError: string | null;
  lastSyncedAt: number | null;
  lastResult: SyncRunResult | null;
}) {
  const { spacing, radii, colors } = useTheme();
  const palette = toColor(phase);
  const resultSummary = formatLastResult(lastResult);

  return (
    <View
      style={{
        backgroundColor: colors.white,
        borderWidth: 1,
        borderColor: colors.fog,
        borderRadius: radii.md,
        padding: spacing.sm,
        marginBottom: spacing.md
      }}
    >
      <View
        style={{
          alignSelf: 'flex-start',
          backgroundColor: palette.bg,
          borderRadius: radii.pill,
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
          marginBottom: spacing.xs
        }}
      >
        <Text variant="caption" style={{ color: palette.text }}>
          {toLabel(phase)}
        </Text>
      </View>

      <Text variant="caption" style={{ color: colors.slate }}>
        File active: {queueDepth}
      </Text>
      <Text variant="caption" style={{ color: deadLetterCount > 0 ? colors.rose : colors.slate }}>
        Echecs terminaux: {deadLetterCount}
      </Text>
      {lastSyncedAt ? (
        <Text variant="caption" style={{ color: colors.slate }}>
          Derniere sync: {new Date(lastSyncedAt).toLocaleTimeString()}
        </Text>
      ) : null}
      {resultSummary ? (
        <Text variant="caption" style={{ color: colors.slate }}>
          Dernier cycle: {resultSummary}
        </Text>
      ) : null}
      {lastError ? (
        <Text variant="caption" style={{ color: colors.rose }}>
          {lastError}
        </Text>
      ) : null}
    </View>
  );
}
