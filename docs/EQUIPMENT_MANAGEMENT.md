# Equipment Management (M27)

## Objectif

Gerer les equipements en **offline-first**:
- CRUD equipements
- Historique des mouvements (affectations chantier)
- Liaison equipement <-> taches (via table de liens)

Note v1: detourage IA image non implemente (placeholder uniquement).

## Stockage local (SQLite)

Tables:
- `equipment`
- `equipment_movements`
- `equipment_task_links`

### equipment
- `id` (uuid)
- `org_id`
- `name`
- `type`
- `status` (`AVAILABLE|ASSIGNED|MAINTENANCE|OUT_OF_SERVICE`)
- `location?`
- `current_project_id?`
- `photo_asset_id?` (reference `media_assets.id`)
- `created_at`, `updated_at`
- `deleted_at?` (soft delete)

### equipment_movements
- `id` (uuid)
- `org_id`
- `equipment_id`
- `from_project_id?`
- `to_project_id?`
- `moved_at`
- `note?`
- `created_at`

### equipment_task_links
- `id` (uuid)
- `org_id`
- `equipment_id`
- `task_id`
- `created_at`

Contrainte: index unique `(org_id, equipment_id, task_id)` pour eviter les doublons.

## Sync / outbox

Chaque mutation genere une operation persistante (outbox) via `offlineDB.enqueueOperation`:
- entity `equipment`
- entity `equipment_movements`
- entity `equipment_task_links`

Le backend MVP stocke ces entites dans `sync_shadow` (generic sink).

## API

Expose via `src/data/equipment-management`:
- `equipment.create(...)`
- `equipment.update(id, patch)`
- `equipment.softDelete(id)`
- `equipment.getById(id)`
- `equipment.list(filters)`
- `equipment.move(equipmentId, {from_project_id?, to_project_id?, moved_at?, note?})`
- `equipment.listMovements(equipmentId, {limit?})`
- `equipment.linkTask({org_id, equipment_id, task_id})`
- `equipment.unlinkTask({org_id, equipment_id, task_id})`
- `equipment.listTaskLinks(equipmentId, orgId)`
- `equipment.listLinkedTasks(equipmentId, orgId)` (helper: resolve tasks via `tasks.getById`)

## UI

Ecran: `src/features/equipment/EquipmentScreen.tsx`
- creation rapide
- liste paginee + filtres
- detail equipement: edition, deplacement, mouvements, taches liees

