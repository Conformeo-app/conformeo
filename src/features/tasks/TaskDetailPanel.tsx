import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import type { MediaAsset } from '../../data/media';
import type { Task, TaskComment, TaskPriority, TaskStatus, TaskSuggestion, TaskUpdatePatch } from '../../data/tasks';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { useTheme } from '../../ui/theme/ThemeProvider';

const STATUS_ORDER: TaskStatus[] = ['TODO', 'DOING', 'DONE', 'BLOCKED'];
const PRIORITY_ORDER: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];

function statusLabel(status: TaskStatus) {
  if (status === 'TODO') return 'À faire';
  if (status === 'DOING') return 'En cours';
  if (status === 'DONE') return 'Terminée';
  return 'Bloquée';
}

function priorityLabel(priority: TaskPriority) {
  if (priority === 'LOW') return 'Faible';
  if (priority === 'MEDIUM') return 'Moyenne';
  return 'Haute';
}

function parseTagsInput(input: string) {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function isPdf(asset: MediaAsset) {
  return asset.mime === 'application/pdf';
}

function activeSuggestions(suggestions: TaskSuggestion[]) {
  return (suggestions ?? []).filter((item) => !item.dismissed_at);
}

export function TaskDetailPanel({
  task,
  media,
  comments,
  busy,
  currentUserId,
  dictationAvailable,
  isListening,
  activeField,
  onToggleDictation,
  onUpdate,
  onSetStatus,
  onAddProof,
  onAddComment,
  onSoftDelete,
  onDismissSuggestion,
  onAssignToMe,
  onOpenCreate
}: {
  task: Task | null;
  media: MediaAsset[];
  comments: TaskComment[];
  busy: boolean;
  currentUserId?: string | null;
  dictationAvailable: boolean;
  isListening: boolean;
  activeField: 'title' | 'description' | 'comment' | null;
  onToggleDictation: (field: 'description' | 'comment', options: { initialText: string; onText: (value: string) => void }) => void;
  onUpdate: (patch: TaskUpdatePatch) => void;
  onSetStatus: (status: TaskStatus) => void;
  onAddProof: (source: 'capture' | 'import') => void;
  onAddComment: (text: string) => void;
  onSoftDelete: () => void;
  onDismissSuggestion: (suggestionId: string) => void;
  onAssignToMe: () => void;
  onOpenCreate?: () => void;
}) {
  const { colors, spacing, radii } = useTheme();

  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');

  useEffect(() => {
    setDescriptionDraft(task?.description ?? '');
    setTagsDraft(task?.tags?.join(', ') ?? '');
    setCommentDraft('');
  }, [task?.id]);

  const suggestions = useMemo(() => activeSuggestions(task?.suggestions ?? []), [task?.suggestions]);

  const saveDescription = useCallback(() => {
    if (!task) return;
    onUpdate({ description: descriptionDraft, last_transcript: activeField === 'description' ? descriptionDraft : undefined });
  }, [activeField, descriptionDraft, onUpdate, task]);

  const saveTags = useCallback(() => {
    if (!task) return;
    onUpdate({ tags: parseTagsInput(tagsDraft) });
  }, [onUpdate, tagsDraft, task]);

  const submitComment = useCallback(() => {
    const text = commentDraft.trim();
    if (!text) return;
    onAddComment(text);
    setCommentDraft('');
  }, [commentDraft, onAddComment]);

  if (!task) {
    return (
      <Card>
        <Text variant="h2">Détail tâche</Text>
        <Text variant="body" style={{ color: colors.slate, marginTop: spacing.sm }}>
          Sélectionnez une tâche à gauche.
        </Text>
        {onOpenCreate ? (
          <View style={{ marginTop: spacing.md }}>
            <Button label="Créer une tâche" onPress={onOpenCreate} />
          </View>
        ) : null}
      </Card>
    );
  }

  const assignedToMe = Boolean(currentUserId && task.assignee_user_id === currentUserId);

  return (
    <Card style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <Text variant="h2">Détail tâche</Text>
        <Text variant="bodyStrong" style={{ marginTop: spacing.xs }}>
          {task.title}
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
          {STATUS_ORDER.map((status) => (
            <Button
              key={status}
              label={statusLabel(status)}
              kind={task.status === status ? 'primary' : 'ghost'}
              onPress={() => onSetStatus(status)}
              disabled={busy}
            />
          ))}
        </View>

        {suggestions.length > 0 ? (
          <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mint }}>
            <Text variant="bodyStrong">Suggestions</Text>
            <View style={{ marginTop: spacing.xs, gap: spacing.sm }}>
              {suggestions.slice(0, 2).map((suggestion) => (
                <View key={suggestion.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="caption" style={{ color: colors.slate }} numberOfLines={2}>
                      [{suggestion.type}] {suggestion.value}
                    </Text>
                  </View>
                  <Button label="Ignorer" kind="ghost" onPress={() => onDismissSuggestion(suggestion.id)} disabled={busy} />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.md }}>
          Priorité
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          {PRIORITY_ORDER.map((priority) => (
            <Button
              key={priority}
              label={priorityLabel(priority)}
              kind={task.priority === priority ? 'primary' : 'ghost'}
              onPress={() => onUpdate({ priority })}
              disabled={busy}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          <Button
            label={assignedToMe ? 'Assignee: moi' : "Me l'assigner"}
            kind={assignedToMe ? 'primary' : 'ghost'}
            onPress={onAssignToMe}
            disabled={busy}
          />
        </View>

        <TextInput
          value={descriptionDraft}
          onChangeText={setDescriptionDraft}
          placeholder="Description"
          multiline
          placeholderTextColor={colors.slate}
          style={{
            borderWidth: 1,
            borderColor: colors.fog,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.white,
            marginTop: spacing.md,
            minHeight: 96
          }}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button
            label={isListening && activeField === 'description' ? 'Arrêter dictée' : 'Dictée'}
            kind="ghost"
            onPress={() => onToggleDictation('description', { initialText: descriptionDraft, onText: setDescriptionDraft })}
            disabled={busy || !dictationAvailable}
          />
          <Button label="Enregistrer" onPress={saveDescription} disabled={busy} />
        </View>

        <TextInput
          value={tagsDraft}
          onChangeText={setTagsDraft}
          placeholder="Tags (séparés par des virgules)"
          placeholderTextColor={colors.slate}
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
          <Button label="Enregistrer les tags" kind="ghost" onPress={saveTags} disabled={busy} />
          <Button label="Supprimer (non définitif)" kind="ghost" onPress={onSoftDelete} disabled={busy} />
        </View>

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Preuves
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="Photo" onPress={() => onAddProof('capture')} disabled={busy} />
          <Button label="Importer" kind="ghost" onPress={() => onAddProof('import')} disabled={busy} />
          <Button label="Exporter (v1)" kind="ghost" onPress={() => {}} disabled />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          {media.length === 0 ? (
            <Text variant="caption" style={{ color: colors.slate }}>
              Aucune preuve liée.
            </Text>
          ) : (
            media.slice(0, 60).map((asset) => (
              <Pressable key={asset.id} onPress={() => {}}>
                {asset.local_thumb_path && !isPdf(asset) ? (
                  <Image
                    source={{ uri: asset.local_thumb_path }}
                    style={{ width: 96, height: 96, borderRadius: radii.sm }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: radii.sm,
                      backgroundColor: colors.fog,
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Text variant="caption" style={{ color: colors.slate }}>
                      {isPdf(asset) ? 'PDF' : 'vignette'}
                    </Text>
                  </View>
                )}
              </Pressable>
            ))
          )}
        </View>

        <Text variant="h2" style={{ marginTop: spacing.lg }}>
          Commentaires
        </Text>

        <TextInput
          value={commentDraft}
          onChangeText={setCommentDraft}
          placeholder="Ajouter un commentaire"
          placeholderTextColor={colors.slate}
          style={{
            borderWidth: 1,
            borderColor: colors.fog,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.white,
            marginTop: spacing.sm
          }}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button
            label={isListening && activeField === 'comment' ? 'Arrêter dictée' : 'Dictée'}
            kind="ghost"
            onPress={() => onToggleDictation('comment', { initialText: commentDraft, onText: setCommentDraft })}
            disabled={busy || !dictationAvailable}
          />
          <Button label="Ajouter" onPress={submitComment} disabled={busy} />
        </View>

        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {comments.slice(0, 10).map((comment) => (
            <View key={comment.id}>
              <Text variant="caption" style={{ color: colors.slate }}>
                {comment.created_by} • {new Date(comment.created_at).toLocaleString('fr-FR')}
              </Text>
              <Text variant="body">{comment.text}</Text>
            </View>
          ))}
        </View>

        {!dictationAvailable ? (
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.md }}>
            Dictée native indisponible sur ce build (fallback clavier / dictée système).
          </Text>
        ) : null}
      </ScrollView>
    </Card>
  );
}
