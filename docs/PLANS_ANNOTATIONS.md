# Module plans-annotations

## Role
Module offline-first pour plans interactifs:
- ouverture locale d'un document de type PLAN + version
- pins normalises (`x`,`y` entre 0 et 1) par page
- edition pin (label, statut, priorite, responsable, commentaire)
- liens pin -> tache / media / document

## Schema local
### Table `plan_pins`
- `id` (PK)
- `org_id`
- `project_id`
- `document_id`
- `document_version_id`
- `page_number`
- `x`, `y` (normalises 0..1)
- `label`
- `status` (`OPEN|DONE|INFO`)
- `priority` (`LOW|MEDIUM|HIGH`)
- `assignee_user_id`
- `comment`
- `created_by`
- `created_at`
- `updated_at`

### Table `plan_pin_links`
- `id` (PK)
- `pin_id`
- `entity` (`TASK|MEDIA|DOCUMENT`)
- `entity_id`
- `created_at`
- index unique `(pin_id, entity, entity_id)`

## API publique
- `plans.setContext({ org_id, user_id })`
- `plans.setActor(userId)`
- `plans.setOrg(orgId)`
- `plans.open(documentId, versionId?)`
- `plans.listPins(documentId, versionId?, filters?)`
- `plans.createPin(ctx, meta?)`
- `plans.updatePin(pinId, patch)`
- `plans.deletePin(pinId)`
- `plans.link(pinId, entity, entityId)`
- `plans.listLinks(pinId)`
- `plans.jumpToPin(pinId)`

## Offline-first & sync
- Aucune requete reseau dans ce module.
- Toutes les mutations sont persistantes en SQLite.
- Chaque mutation enfile une operation outbox via `offlineDB.enqueueOperation`:
  - `plan_pins` (`CREATE|UPDATE|DELETE`)
  - `plan_pin_links` (`CREATE|DELETE`)
- Aucun delete silencieux sans trace outbox.

## UI livree
`src/features/plans/PlansScreen.tsx`
- selection du plan
- selection de version
- viewer avec overlay de pins
- mode "ajout pin" en 1 tap
- liste des points filtrable (`ALL/OPEN/DONE/INFO`)
- edition pin + liens + creation tache liee + ajout preuves

## Scenarios manuels
1. Ouvrir un plan offline -> viewer + liste points disponibles.
2. Poser 30 pins sur plusieurs pages -> affichage instantane.
3. Lier un pin a une tache et un media -> liens persistants apres relance app.
4. Basculer de version -> pins limites a la version selectionnee + warning ancienne version.
5. Supprimer un pin -> pin retire localement et operation `DELETE` presente en outbox.
