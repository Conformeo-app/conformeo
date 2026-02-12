# UX_ACCELERATORS

Module: `ux-accelerators`

## Rôle

Réduire l’effort utilisateur terrain:
- quick actions (3 taps max)
- favoris
- récents
- templates (tâche / checklist / export)

Tout fonctionne en offline-first (SQLite local).

## Data model

Tables locales:
- `user_favorites`
- `user_recents`
- `templates`

`templates` inclut la version:
- `template_key`
- `version`

Cela évite les templates non versionnés.

## API

Fichiers:
- `/Users/michelgermanotti/Documents/Conformeo/src/data/ux-accelerators/types.ts`
- `/Users/michelgermanotti/Documents/Conformeo/src/data/ux-accelerators/uxAccelerators.ts`

API `ux`:
- `ux.getQuickActions(role)`
- `ux.addFavorite(entity, id)`
- `ux.removeFavorite(entity, id)`
- `ux.listFavorites()`
- `ux.trackRecent(entity, id)`
- `ux.listRecents(limit?)`

API `templates`:
- `templates.create(type, payload)`
- `templates.list(type?)`
- `templates.apply(type, templateId)`

Accélérateur d’exécution:
- `applyQuickAction(actionKey, options?)`

## Intégrations

- `tasks-smart` via création rapide de tâche
- `media-pipeline` via capture de preuve
- `mode-controle` via création checklist
- `exports-doe` via génération report/control pack
- `dashboard` consomme les quick actions dynamiques

## UI

Écran dédié:
- `/Users/michelgermanotti/Documents/Conformeo/src/features/ux/UxAcceleratorsScreen.tsx`

Navigation:
- module `accelerators` ajouté à la sidebar
- quick actions dynamiques affichées sur dashboard et module

## Validation

- `npm run -s typecheck`
- `npx expo export --platform ios --platform android`
