# Planning Engine (M28)

## Objectif

Planning **offline-first** des taches par chantier:
- calendrier par projet (chantier)
- assignation (user/team ids)
- detection de chevauchements (alertes)

v1 (non implemente): vue Gantt + alertes avancees.

## Stockage local (SQLite)

Table: `planning_items`

Champs:
- `id` (uuid)
- `org_id`, `project_id`
- `task_id`
- `title_snapshot` (pour garder un libelle stable)
- `start_at`, `end_at` (ISO)
- `assignee_user_id?`, `team_id?`
- `created_by`
- `created_at`, `updated_at`
- `deleted_at?` (soft delete)

## Sync / outbox

Chaque mutation enfile une operation via `offlineDB.enqueueOperation`:
- entity `planning_items`

Le backend MVP (generic sink) stocke dans `sync_shadow`.

## API

Expose via `src/data/planning-engine`:
- `planning.create(input)`
- `planning.update(id, patch)`
- `planning.softDelete(id)`
- `planning.getById(id)`
- `planning.listByProject(projectId, filters)`
- `planning.computeOverlaps(items)` -> `PlanningOverlap[]`

## UI

Ecran: `src/features/planning/PlanningScreen.tsx`
- Vue "Aujourd'hui" / "7 jours"
- Creation d'un item planning depuis une tache
- Alerte chevauchement (top 6)

