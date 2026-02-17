import React from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '../../../ui/layout/Screen';
import {
  Avatar,
  Card,
  Chip,
  Divider,
  Icon,
  QuotaBadge,
  RiskBadge,
  SafetyTag,
  SectionHeader,
  SyncStatusBadge,
  Tag,
  Text
} from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

export function UIGalleryAtomsScreen() {
  const { spacing, colors, typography } = useTheme();

  return (
    <Screen>
      <SectionHeader title="UI Gallery — Atoms" subtitle="Text, Icon, Badge, Tag, Chip, Divider, Avatar…" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing['2xl'] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Text variant="h2">Text (variants)</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Limiter à 3 tailles max par écran (éviter le patchwork).
          </Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            {(Object.keys(typography) as Array<keyof typeof typography>).map((key) => (
              <View key={key} style={{ gap: 2 }}>
                <Text variant="caption" style={{ color: colors.mutedText }}>
                  {String(key)}
                </Text>
                <Text variant={key}>Conforméo — outil terrain</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <Text variant="h2">Icon / Divider</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Icon name="camera" size={22} />
            <Icon name="hard-hat" size={22} />
            <Icon name="file-document-outline" size={22} />
            <Icon name="sync" size={22} />
            <Icon name="alert-circle" size={22} />
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Divider />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Badges (officiels)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <RiskBadge level="OK" />
            <RiskBadge level="WATCH" />
            <RiskBadge level="RISK" />
            <SyncStatusBadge state="SYNCED" />
            <SyncStatusBadge state="PENDING" />
            <SyncStatusBadge state="FAILED" />
            <QuotaBadge level="OK" />
            <QuotaBadge level="WARN" />
            <QuotaBadge level="CRIT" />
            <SafetyTag />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Tags</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Tag label="neutral" />
            <Tag label="info" tone="info" />
            <Tag label="success" tone="success" />
            <Tag label="warning" tone="warning" />
            <Tag label="danger" tone="danger" />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Chips / Avatar</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Chip label="Tous" selected onPress={() => {}} />
            <Chip label="À faire" onPress={() => {}} />
            <Chip label="En cours" onPress={() => {}} />
            <Chip label="Bloquées" onPress={() => {}} />
            <Avatar label="Michel Germanotti" />
            <Avatar label="Conducteur Travaux" size={36} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
