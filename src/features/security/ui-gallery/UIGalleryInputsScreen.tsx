import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '../../../ui/layout/Screen';
import {
  Card,
  SearchInput,
  SectionHeader,
  SegmentedControl,
  Text,
  TextField,
  Toggle,
  VoiceInputButton
} from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

type Segment = 'A' | 'B' | 'C';

export function UIGalleryInputsScreen() {
  const { spacing, colors } = useTheme();

  const [search, setSearch] = useState('');
  const [value, setValue] = useState('');
  const [toggle, setToggle] = useState(false);
  const [segment, setSegment] = useState<Segment>('A');

  const segments = useMemo(
    () => [
      { key: 'A' as const, label: 'Option A' },
      { key: 'B' as const, label: 'Option B' },
      { key: 'C' as const, label: 'Option C' }
    ],
    []
  );

  return (
    <Screen>
      <SectionHeader title="Galerie UI — Champs" subtitle="Champs texte, recherche, toggle, sélection, dictée…" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing['2xl'] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Text variant="h2">Recherche</Text>
          <View style={{ marginTop: spacing.md }}>
            <SearchInput value={search} onChangeText={setSearch} placeholder="Rechercher…" />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Champ texte</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Hauteur min 44px, erreurs actionnables, pas de couleurs hardcodées.
          </Text>

          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            <TextField label="Titre" value={value} onChangeText={setValue} placeholder="Saisir…" />
            <TextField
              label="Exemple erreur"
              value="Valeur invalide"
              onChangeText={() => {}}
              error="Champ obligatoire / format incorrect."
            />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Interrupteur</Text>
          <View style={{ marginTop: spacing.md }}>
            <Toggle label="Mode contrôle" value={toggle} onValueChange={setToggle} />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Sélecteur</Text>
          <View style={{ marginTop: spacing.md }}>
            <SegmentedControl value={segment} options={segments} onChange={setSegment} />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Bouton dictée</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            UI uniquement. La disponibilité dépend du build (Expo Go vs dev build).
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <VoiceInputButton listening={false} available={true} onPress={() => {}} />
            <VoiceInputButton listening={true} available={true} onPress={() => {}} />
            <VoiceInputButton listening={false} available={false} onPress={() => {}} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
