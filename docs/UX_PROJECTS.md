# UX-01 — Chantiers

## Objectif

Donner une experience "Chantiers" iPad-first :

- liste + preview (split view)
- creation / edition
- detail chantier avec onglets (synthese, taches, plans, medias, documents, controle)
- offline-first (DB locale source de verite)
- indicateurs de risque + etat de sync

## Ecrans

- `ProjectsList` : split view sur iPad (liste a gauche, preview a droite)
- `ProjectCreate` : creation chantier offline-first (+ option "starter pack")
- `ProjectEdit` : edition + archivage
- `ProjectDetail` : header chantier (badges + quick actions) + top tabs

Fichiers :

- `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectsListScreen.tsx`
- `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectCreateScreen.tsx`
- `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectEditScreen.tsx`
- `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectDetailScreen.tsx`
- `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectOverviewTab.tsx`

Doc apercu (UX-01a) :

- `/Users/michelgermanotti/Documents/Conformeo/docs/UX_PROJECT_OVERVIEW.md`

Doc onglet taches (UX-01b) :

- `/Users/michelgermanotti/Documents/Conformeo/docs/UX_PROJECT_TASKS.md`

## Data Model (SQLite)

Table `projects` creee dans :

- `/Users/michelgermanotti/Documents/Conformeo/src/data/projects/projects.ts`

Champs :

- `id` (TEXT, PK)
- `org_id` (TEXT)
- `name` (TEXT)
- `address` (TEXT, nullable)
- `geo_lat` / `geo_lng` (REAL, nullable)
- `start_date` / `end_date` (TEXT, nullable)
- `status_manual` ("ACTIVE" | "ARCHIVED")
- `team_id` (TEXT, nullable)
- `created_by` (TEXT)
- `created_at` / `updated_at` (TEXT ISO)

Favoris / recents :

- stockes via `ux-accelerators` dans `user_favorites` et `user_recents` (entite `PROJECT`)

Outbox :

- operations `projects` sont poussees dans `operations_queue` via `offlineDB.enqueueOperation`.

## Services

API :

- `projects.create/update/archive/list/getById`
- `projects.getIndicators(orgId, projectIds)` -> map `ProjectIndicators`
- `projects.computeRiskLevel(projectId, orgId?)`
- `projects.getSyncState(projectId, orgId?)`

Fichiers :

- `/Users/michelgermanotti/Documents/Conformeo/src/data/projects/projects.ts`
- `/Users/michelgermanotti/Documents/Conformeo/src/data/projects/types.ts`

## Indicateurs

### Risk badge

Regles (MVP) :

- `blockedTasks > 0` -> `RISK`
- sinon `openTasks > 10` -> `WATCH`
- sinon `safetyOpenTasks > 0` -> `WATCH`
- sinon `openConflicts > 0` -> `WATCH`
- sinon `OK`

Sources :

- `tasks` (counts + detection keywords dans `title/description/tags_json`)
- `sync_conflicts` (payload parse)

### Sync state

Regles :

- `FAILED ops` ou `FAILED uploads` -> `ERROR`
- sinon `PENDING ops` ou `PENDING/UPLOADING uploads` -> `PENDING`
- sinon `SYNCED`

Sources :

- `operations_queue` join sur `tasks/documents/export_jobs/projects`
- `media_assets.upload_status`

## Feature Flags

Les onglets sont masques selon `availableModules` (provider feature flags) :

- taches / plans / medias / documents / controle

## Quotas

Quick actions :

- `Photo` verifie `quotas.explainUploadBlock(...)`
- `Pack controle` verifie `quotas.explainExportBlock()`

## Tests manuels (checklist)

1. Offline total
   - creer un chantier
   - creer une tache + photo -> visible dans onglet correspondant
   - quitter / relancer -> le chantier et ses donnees sont la

2. Flags
   - desactiver "Plans" -> onglet Plans absent, aucune erreur

3. Quotas
   - depasser quota export -> action "Pack controle" affiche un message clair

4. Dataset
   - 50 chantiers / 2000 taches -> scroll fluide, time-to-interactive raisonnable
