# Module mode-controle

## Role
Mode inspection offline-first, ultra rapide:
- synthese chantier
- preuves critiques
- checklist simple
- export control pack en 1 clic

## API publique
- `controlMode.enable(projectId)`
- `controlMode.disable(projectId)`
- `controlMode.isEnabled(projectId)`
- `controlMode.getSummary(projectId)`
- `controlMode.listCriticalProofs(projectId, filters?)`
- `controlMode.listOpenIssues(projectId)`
- `controlMode.createChecklist(projectId)`
- `controlMode.getLatestChecklist(projectId)`
- `controlMode.toggleItem(itemId, checked)`
- `controlMode.setComment(itemId, text)`
- `controlMode.generateControlPack(projectId)`

API utilitaire ajoutee:
- `controlMode.listProjects()`
- `controlMode.getRecentActivity(projectId, limit?)`
- `controlMode.getState(projectId)`
- `controlMode.getChecklistTemplate()`
- `controlMode.setContext({ org_id, user_id })`

## Schema local
### Table `control_mode_state`
- `project_id` (PK)
- `org_id`
- `enabled`
- `updated_by`
- `enabled_at`
- `disabled_at`
- `updated_at`

### Table `inspection_checklists`
- `id`
- `org_id`
- `project_id`
- `created_by`
- `created_at`

### Table `inspection_items`
- `id`
- `checklist_id`
- `key`
- `label`
- `checked`
- `comment`
- `updated_at`
- `updated_by`

## Regles risque (MVP)
- `blockedTasks > 0` => `RISK`
- sinon `openTasks > 10` => `WATCH`
- sinon si une tache ouverte contient un signal securite (`safety`, `permis_feu`, `epi`, etc.) => `WATCH`
- sinon `OK`

## Offline-first
- Aucune dependance reseau dans ce module.
- Toutes les mutations checklist / mode / etat sont persistantes en SQLite.
- Mutations poussees dans l'outbox via `offlineDB.enqueueOperation`.

## Export 1 clic
- `generateControlPack(projectId)`
  - appelle `exportsDoe.createJob(projectId, 'CONTROL_PACK')`
  - declenche `exportsDoe.run(jobId)` en asynchrone (non bloquant UI)

## Ecran livre
`src/features/control/ControlModeScreen.tsx`
- 2 onglets: `Synthese` / `Preuves`
- actions rapides:
  - activer/desactiver lecture seule
  - pack controle 1 clic
  - partager
  - ajouter preuve
  - ouvrir preuves critiques
- checklist editable seulement hors lecture seule

## Scenarios manuels
1. Offline total -> ouvrir mode controle: synthese + preuves + checklist disponibles.
2. 200 preuves -> onglet preuves fluide en thumbnails avec pagination.
3. Pack controle -> job cree puis partage quand `DONE`.
4. Lecture seule active -> checklist verrouillee, ajout preuve possible.
5. Redemarrage app -> etat lecture seule + checklist conserves.
