# Design System — Conforméo v1.0 (DS-CORE-01)

Objectif: garantir une UI cohérente, rapide à développer, accessible et stable (iPad-first), tout en restant *offline-first*.

## Principes

- Outil terrain avant outil marketing.
- Lisible en plein soleil (contraste + gris pas trop clair).
- Dense mais respirant (éviter le “tout collé”).
- Action > Décoration (pas d’effets inutiles).
- Couleurs fonctionnelles, pas décoratives.
- Tout état doit être visible (offline, pending, error).
- 3 niveaux max de profondeur (navigation).

## Tokens

Source: `/Users/michelgermanotti/Documents/Conformeo/src/ui/theme/tokens.ts`

Accès: `useTheme()` via `ThemeProvider`.

### Couleurs

Règle: utiliser uniquement les tokens (pas de hex hardcodés dans les écrans).

Fonctionnelles:

- `primary`: `#0E7C86`
- `primarySoft`: `#E6F4F6`
- `success`: `#2E7D32`
- `warning`: `#ED6C02`
- `danger`: `#D32F2F`
- `info`: `#1976D2`

Neutres:

- `bg`: `#F7F9FA`
- `surface`: `#FFFFFF`
- `surfaceAlt`: `#F1F3F4`
- `border`: `#E0E3E7`
- `textPrimary`: `#1F2933`
- `textSecondary`: `#52606D`
- `textMuted`: `#9AA5B1`

Alias utilisés par le code (compat):

- texte: `colors.text`, `colors.mutedText`
- états: `successBg`, `warningBg`, `dangerBg`, `infoBg`, `warningText`

Note: les clés historiques (`ink`, `slate`, `teal`, etc.) restent présentes pour compatibilité, mais doivent être évitées dans les nouveaux écrans.

### Spacing / Radius / Typo

Spacing (échelle fixe):

- `xs`: 4
- `sm`: 8
- `md`: 16
- `lg`: 24
- `xl`: 32
- `xxl`: 48

Border radius:

- `sm`: 6
- `md`: 10
- `lg`: 16
- `xl`: 24

Conventions:

- Cards = `md`
- Badges/Chips = `xl`
- Inputs = `md`

Typo (variants):

- `h1`: 24 bold
- `h2`: 20 semibold
- `h3`: 18 semibold
- `body`: 16 regular
- `bodyStrong`: 16 semibold
- `bodySmall`: 14 regular
- `caption`: 12 medium

### Ombres & Layout

Shadows (minimal, 2 niveaux max):

- `shadows.sm` (cards)
- `shadows.md` (drawers/panels)

Layout iPad:

- `layout.sideMenuWidth`: 260
- `layout.topBarHeight`: 64
- `layout.maxContentWidth`: 1400

## Composants (catalogue)

Source: `/Users/michelgermanotti/Documents/Conformeo/src/ui/components`

Exports: `/Users/michelgermanotti/Documents/Conformeo/src/ui/components/index.ts`

### Atoms

- `Text` (variants)
- `Icon`
- `Divider`
- `Badge` (tones: `info|success|warning|danger|risk|sync|quota|safety|neutral`)
- `Tag`
- `Chip` (filtres)
- `Avatar`

### Inputs

- `TextField`
- `SearchInput`
- `Toggle`
- `SegmentedControl`
- `VoiceInputButton` (UI seulement; la logique de dictée reste côté feature)

### Buttons

- `Button` (`variant="primary|secondary|ghost|danger"`, compat `kind`)
- `IconButton`
- `Fab`

### Surfaces / Lists

- `Card` (surface + bordure + `shadows.sm`)
- `KpiCard`
- `ListRow`
- `SectionHeader`
- `TabsBar`

### Feedback / States

- `LoadingState`
- `EmptyState` (1-2 CTA max)
- `ErrorState` (cause + solution + CTA)
- `OfflineBanner`
- `SyncPill` (état sync)

## Patterns (layout)

Source: `/Users/michelgermanotti/Documents/Conformeo/src/ui/layout`

- `SplitView`: master/detail responsive (iPad = 35% / 65%, iPhone = stack)
- `DrawerPanel`: drawer (droite iPad, bottom sheet iPhone) pour filtres/quick create
- `Screen`: padding + flex + minHeight safe

## Conventions UX

- 3 tailles de texte max par écran (souvent `display|h2|caption` ou `h1|body|caption`).
- 3 actions primaires max par écran (une primaire, une secondaire, une urgence optionnelle).
- Pas de scroll imbriqué: une seule zone scrollable par vue (surtout en split view).
- Dans les listes/grilles: thumbnails uniquement (jamais HD).
 
## Icônes

Set actuel: `@expo/vector-icons` (MaterialCommunityIcons) via `/Users/michelgermanotti/Documents/Conformeo/src/ui/components/Icon.tsx`.

Règle: un concept = une icône (pas 2 icônes différentes pour la même chose). Si une icône “concept” est introduite, la documenter et l’utiliser partout.

## UI Gallery (DEV)

But: valider rapidement tokens + composants + états, et faire une revue visuelle ("UI lint").

- Écran: `/Users/michelgermanotti/Documents/Conformeo/src/features/security/UIGalleryScreen.tsx`
- Accès: Sécurité → Outils internes → UI Gallery (en `__DEV__`, ou super-admin)

## Checklist PR (Design System)

- Les nouveaux écrans utilisent les composants DS (pas de composants ad-hoc non alignés).
- Tokens DS utilisés (pas de hex hardcodés).
- Badges conformes (risk/sync/quota/safety).
- Zones tactiles >= 44px (boutons/chips/actions).
- États offline/pending/failed visibles + actionnables.
- Pas d’images HD dans les listes/grilles.
