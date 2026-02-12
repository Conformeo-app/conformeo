# SYNC_CONFLICTS

Module: `sync-conflicts`

## Rôle

Gérer les conflits de synchronisation avec:
- détection
- journal persistant
- policy par entité
- UI explicite de résolution

## Data model

Tables locales SQLite:
- `sync_conflicts`
- `sync_conflict_policies`

`sync_conflicts` contient:
- `id`, `org_id`, `entity`, `entity_id`
- `operation_id`, `operation_type`
- `local_payload`, `server_payload`
- `policy`, `status` (`OPEN` / `RESOLVED`)
- `created_at`, `resolved_at`, `resolution_action`

## Policies

Policies supportées:
- `LWW` (par défaut)
- `SERVER_WINS`
- `MANUAL`

API:
- `conflicts.setPolicy(entity, policy)`
- `conflicts.getPolicy(entity)`

## API principale

Fichier:
- `/Users/michelgermanotti/Documents/Conformeo/src/data/sync/conflicts.ts`

API demandée:
- `conflicts.listOpen()`
- `conflicts.getById(id)`
- `conflicts.resolve(id, action, mergedPayload?)`
- `conflicts.setPolicy(entity, policy)`

Actions de résolution:
- `KEEP_LOCAL`
- `KEEP_SERVER`
- `MERGE`

## Intégration sync-engine

Fichier:
- `/Users/michelgermanotti/Documents/Conformeo/src/data/sync/sync-engine.ts`

Comportement:
- détecte conflit sur reject (`reason` conflict/version/stale...) ou mismatch `server_version` vs `local_version`
- journalise via `conflicts.record(...)`
- applique policy:
  - `SERVER_WINS`: auto-resolved côté conflit + opération marquée dead
  - `LWW`: auto-resolved keep-local + retry
  - `MANUAL`: conflit laissé OPEN + opération marquée dead

## UI

Écran dédié:
- `/Users/michelgermanotti/Documents/Conformeo/src/features/conflicts/ConflictsScreen.tsx`

Fonctions:
- liste des conflits OPEN
- vue locale vs serveur
- résolution KEEP_LOCAL / KEEP_SERVER / MERGE
- configuration policy par entité

Navigation:
- module sidebar `Conflits`

## Dashboard badge

Fichier:
- `/Users/michelgermanotti/Documents/Conformeo/src/features/dashboard/DashboardScreen.tsx`

Affiche:
- `Conflits ouverts: N`

## Validation

- `npm run -s typecheck`
- `npx expo export --platform ios --platform android`
