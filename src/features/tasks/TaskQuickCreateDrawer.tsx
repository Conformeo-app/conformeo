import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import type { TaskStatus } from '../../data/tasks';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { useTheme } from '../../ui/theme/ThemeProvider';

const STATUS_ORDER: TaskStatus[] = ['TODO', 'DOING', 'BLOCKED', 'DONE'];

function statusLabel(status: TaskStatus) {
  if (status === 'TODO') return 'A faire';
  if (status === 'DOING') return 'En cours';
  if (status === 'DONE') return 'Terminee';
  return 'Bloquee';
}

export function TaskQuickCreateDrawer({
  visible,
  title,
  status,
  safety,
  busy,
  error,
  dictationAvailable,
  isListeningTitle,
  onChangeTitle,
  onChangeStatus,
  onToggleSafety,
  onToggleTitleDictation,
  onCreate,
  onClose
}: {
  visible: boolean;
  title: string;
  status: TaskStatus;
  safety: boolean;
  busy: boolean;
  error?: string | null;
  dictationAvailable: boolean;
  isListeningTitle: boolean;
  onChangeTitle: (value: string) => void;
  onChangeStatus: (value: TaskStatus) => void;
  onToggleSafety: () => void;
  onToggleTitleDictation: () => void;
  onCreate: (options: { withPhoto: boolean }) => void;
  onClose: () => void;
}) {
  const { colors, spacing, radii } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 420,
            maxWidth: '92%',
            backgroundColor: colors.sand,
            padding: spacing.lg,
            borderTopLeftRadius: radii.lg,
            borderBottomLeftRadius: radii.lg
          }}
        >
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="h2">Nouvelle tache</Text>
              <Button label="Fermer" kind="ghost" onPress={onClose} disabled={busy} />
            </View>

            <TextInput
              value={title}
              onChangeText={onChangeTitle}
              placeholder="Titre (obligatoire)"
              placeholderTextColor={colors.slate}
              autoFocus
              style={{
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                backgroundColor: colors.white,
                marginTop: spacing.md
              }}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              {STATUS_ORDER.map((item) => {
                const active = status === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => onChangeStatus(item)}
                    style={{
                      borderRadius: radii.pill,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                      backgroundColor: active ? colors.mint : colors.white,
                      borderWidth: 1,
                      borderColor: active ? 'transparent' : colors.fog
                    }}
                  >
                    <Text variant="caption" style={{ color: active ? colors.ink : colors.slate }}>
                      {statusLabel(item)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button
                label={safety ? 'Securite: ON' : 'Securite: OFF'}
                kind={safety ? 'primary' : 'ghost'}
                onPress={onToggleSafety}
                disabled={busy}
              />
              <Button
                label={isListeningTitle ? 'Stop dictee' : 'Dictee'}
                kind="ghost"
                onPress={onToggleTitleDictation}
                disabled={busy || !dictationAvailable}
              />
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Creer" onPress={() => onCreate({ withPhoto: false })} disabled={busy} />
              <Button label="Creer + photo" kind="ghost" onPress={() => onCreate({ withPhoto: true })} disabled={busy} />
            </View>

            {error ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}

            {!dictationAvailable ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Dictee native indisponible sur ce build (fallback clavier dictee).
              </Text>
            ) : null}
          </Card>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

