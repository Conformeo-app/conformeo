import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, TextInput, View, type ViewStyle } from 'react-native';
import { PlanPin, PlanPinLink, PlanPinLinkEntity, PlanPinPriority, PlanPinStatus } from '../../data/plans-annotations';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { useTheme } from '../../ui/theme/ThemeProvider';

export type ResolvedPinLink = {
  link: PlanPinLink;
  title: string;
  subtitle?: string;
  thumbPath?: string;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function priorityLabel(priority: PlanPinPriority) {
  if (priority === 'HIGH') return 'Haute';
  if (priority === 'MEDIUM') return 'Moyenne';
  return 'Basse';
}

export function PinDetailsPanel({
  pin,
  links,
  busy,
  onClose,
  onUpdate,
  onDelete,
  onCreateLinkedTask,
  onAddProof,
  onLink,
  onUnlink,
  style
}: {
  pin: PlanPin | null;
  links: ResolvedPinLink[];
  busy: boolean;
  onClose?: () => void;
  onUpdate: (patch: { label?: string; status?: PlanPinStatus; priority?: PlanPinPriority; comment?: string }) => void;
  onDelete: () => void;
  onCreateLinkedTask: () => void;
  onAddProof: (source: 'capture' | 'import') => void;
  onLink: (entity: PlanPinLinkEntity, entityId: string) => void;
  onUnlink: (entity: PlanPinLinkEntity, entityId: string) => void;
  style?: ViewStyle;
}) {
  const { colors, spacing, radii } = useTheme();
  const [labelDraft, setLabelDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [linkEntity, setLinkEntity] = useState<PlanPinLinkEntity>('TASK');
  const [linkEntityId, setLinkEntityId] = useState('');

  useEffect(() => {
    setLabelDraft(pin?.label ?? '');
    setCommentDraft(pin?.comment ?? '');
    setLinkEntity('TASK');
    setLinkEntityId('');
  }, [pin?.id]);

  const inputStyle = useMemo(
    () => ({
      borderWidth: 1,
      borderColor: colors.fog,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.white,
      color: colors.ink
    }),
    [colors.fog, colors.ink, colors.white, radii.md, spacing.md, spacing.sm]
  );

  return (
    <View style={[{ flex: 1, minHeight: 0 }, style]}>
      <Card style={{ flex: 1, minHeight: 0 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
          <Text variant="h2">Point du plan</Text>

          {!pin ? (
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Sélectionnez un point pour voir / modifier ses détails.
            </Text>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {pin.label || `Point ${pin.id.slice(0, 6)}`}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    Page {pin.page_number} · {pin.status} · Priorité {priorityLabel(pin.priority)}
                  </Text>
                </View>
                {onClose ? <Button label="Fermer" kind="ghost" onPress={onClose} /> : null}
              </View>

              <TextInput
                value={labelDraft}
                onChangeText={setLabelDraft}
                placeholder="Label"
                placeholderTextColor={colors.slate}
                style={[inputStyle, { marginTop: spacing.md }]}
                editable={!busy}
              />

              <TextInput
                value={commentDraft}
                onChangeText={setCommentDraft}
                placeholder="Commentaire"
                placeholderTextColor={colors.slate}
                multiline
                style={[
                  inputStyle,
                  {
                    marginTop: spacing.sm,
                    minHeight: 88,
                    textAlignVertical: 'top'
                  }
                ]}
                editable={!busy}
              />

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                <Button
                  label="Enregistrer"
                  onPress={() => onUpdate({ label: labelDraft, comment: commentDraft })}
                  disabled={busy}
                />
                <Button label="Supprimer" kind="ghost" onPress={onDelete} disabled={busy} />
              </View>

              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.md }}>
                Statut
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {(['OPEN', 'DONE', 'INFO'] as PlanPinStatus[]).map((status) => (
                  <Button
                    key={status}
                    label={status}
                    kind={pin.status === status ? 'primary' : 'ghost'}
                    onPress={() => onUpdate({ status })}
                    disabled={busy}
                  />
                ))}
              </View>

              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.md }}>
                Priorité
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {(['LOW', 'MEDIUM', 'HIGH'] as PlanPinPriority[]).map((priority) => (
                  <Button
                    key={priority}
                    label={priority}
                    kind={pin.priority === priority ? 'primary' : 'ghost'}
                    onPress={() => onUpdate({ priority })}
                    disabled={busy}
                  />
                ))}
              </View>

              <Text variant="h2" style={{ marginTop: spacing.lg }}>
                Actions rapides
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                <Button label="Créer tâche liée" onPress={onCreateLinkedTask} disabled={busy} />
                <Button label="Photo" kind="ghost" onPress={() => onAddProof('capture')} disabled={busy} />
                <Button label="Importer" kind="ghost" onPress={() => onAddProof('import')} disabled={busy} />
              </View>

              <Text variant="h2" style={{ marginTop: spacing.lg }}>
                Liens
              </Text>
              {links.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                  Aucun lien.
                </Text>
              ) : (
                <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                  {links.slice(0, 30).map((item) => (
                    <View
                      key={item.link.id}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.fog,
                        borderRadius: radii.md,
                        padding: spacing.md,
                        backgroundColor: colors.white
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        {item.thumbPath ? (
                          <Image
                            source={{ uri: item.thumbPath }}
                            style={{ width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.fog }}
                          />
                        ) : null}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text variant="bodyStrong" numberOfLines={1}>
                            [{item.link.entity}] {item.title}
                          </Text>
                          {item.subtitle ? (
                            <Text variant="caption" style={{ color: colors.slate }} numberOfLines={2}>
                              {item.subtitle}
                            </Text>
                          ) : null}
                        </View>
                        <Button
                          label="Retirer"
                          kind="ghost"
                          onPress={() => onUnlink(item.link.entity, item.link.entity_id)}
                          disabled={busy}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.lg }}>
                Lien manuel (debug/MVP)
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {(['TASK', 'MEDIA', 'DOCUMENT'] as PlanPinLinkEntity[]).map((entity) => (
                  <Button
                    key={entity}
                    label={entity}
                    kind={linkEntity === entity ? 'primary' : 'ghost'}
                    onPress={() => setLinkEntity(entity)}
                    disabled={busy}
                  />
                ))}
              </View>
              <TextInput
                value={linkEntityId}
                onChangeText={setLinkEntityId}
                placeholder="entity_id (uuid)"
                placeholderTextColor={colors.slate}
                style={[inputStyle, { marginTop: spacing.sm }]}
                editable={!busy}
              />
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  label="Ajouter le lien"
                  kind="ghost"
                  onPress={() => {
                    const id = normalizeText(linkEntityId);
                    if (!id) return;
                    onLink(linkEntity, id);
                    setLinkEntityId('');
                  }}
                  disabled={busy}
                />
              </View>
            </>
          )}
        </ScrollView>
      </Card>
    </View>
  );
}

