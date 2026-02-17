import React from 'react';
import { View } from 'react-native';
import { SyncRunResult } from '../../data/sync/types';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

function toLabel(phase: SyncPhase) {
  if (phase === 'syncing') return 'Synchronisation en cours';
  if (phase === 'offline') return 'Synchronisation hors ligne';
  if (phase === 'error') return 'Synchronisation en échec';
  return 'Synchronisation OK';
}

function toColor(phase: SyncPhase) {
  if (phase === 'syncing') return { bgKey: 'infoBg', textKey: 'info' } as const;
  if (phase === 'offline') return { bgKey: 'warningBg', textKey: 'warningText' } as const;
  if (phase === 'error') return { bgKey: 'dangerBg', textKey: 'danger' } as const;
  return { bgKey: 'successBg', textKey: 'success' } as const;
}

function formatLastResult(result: SyncRunResult | null) {
  if (!result) {
    return null;
  }
  return `Envoyés:${result.pushed} Retentatives:${result.failed} Terminaux:${result.dead}`;
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

  const toneBg = colors[palette.bgKey] ?? colors.fog;
  const toneText = (colors as unknown as Record<string, string>)[palette.textKey] ?? colors.text;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.md,
        padding: spacing.sm,
        marginBottom: spacing.md
      }}
    >
      <View
        style={{
          alignSelf: 'flex-start',
          backgroundColor: toneBg,
          borderRadius: radii.pill,
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
          marginBottom: spacing.xs
        }}
      >
        <Text variant="caption" style={{ color: toneText }}>
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
          Derniere synchronisation: {new Date(lastSyncedAt).toLocaleTimeString()}
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
