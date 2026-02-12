# SEARCH

Module: `search`

## Rôle

Recherche locale offline-first, globale et filtrable par module, avec index incrémental:
- query globale multi-entités
- filtres par module (`TASK`, `DOCUMENT`, `MEDIA`, `EXPORT`)
- scope entreprise/chantier
- suggestions locales et ranking léger
- pagination via `limit/offset`

## Data model

Table locale:
- `search_index`

Schéma:
- `id`
- `org_id`
- `entity`
- `entity_id`
- `project_id`
- `title`
- `body`
- `tags_json`
- `updated_at`
- `title_norm`
- `body_norm`
- `tags_norm`

Index SQL:
- `(entity, entity_id)` unique
- `(org_id, entity, updated_at DESC)`
- `(org_id, project_id, updated_at DESC)`
- index sur colonnes normalisées pour filtrage rapide

## Indexation

Fichier:
- `/Users/michelgermanotti/Documents/Conformeo/src/data/search/search.ts`

Mécanisme:
- triggers SQLite sur `tasks`, `documents`, `media_assets`, `export_jobs`
- upsert sur `search_index` à chaque create/update
- purge de l’entrée index lors delete/soft-delete

API dev/debug:
- `search.reindexEntity(entity, id)`
- `search.rebuildAll()`

## API

Fichiers:
- `/Users/michelgermanotti/Documents/Conformeo/src/data/search/types.ts`
- `/Users/michelgermanotti/Documents/Conformeo/src/data/search/search.ts`

API principale:
- `search.query(q, { scope, entities?, limit?, offset? })`
- `search.getSuggestions(prefix, { scope, limit? })`

API utilitaire:
- `search.listProjects(scope?)`
- `search.setContext(...)`
- `search.setOrg(...)`
- `search.setActor(...)`
- `search.setProject(...)`

## UI

Écran:
- `/Users/michelgermanotti/Documents/Conformeo/src/features/search/SearchScreen.tsx`

Fonctions UI:
- champ recherche + suggestions
- scope entreprise/chantier
- filtres module multi-select
- résultats groupés (`Tâches`, `Documents`, `Preuves`, `Exports`)
- highlights `[[...]]` sur title/body
- pagination par bouton `Charger plus`

## Contraintes respectées

- aucun appel backend
- pas de full scan des tables métier à chaque frappe
- index local unique source pour la recherche
- pagination systématique sur requêtes

## Validation

- `npm run -s typecheck`
- recherche fonctionnelle sans réseau (index local)
