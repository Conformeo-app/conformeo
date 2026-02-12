# DASHBOARD

Module: `dashboard`

## Rôle

Synthèse locale chantier/entreprise, sans dépendance réseau obligatoire:
- widgets KPI (tâches, preuves, documents, exports)
- alertes utiles (sync, quota, safety)
- timeline d'activité récente
- quick actions terrain

## API data

Fichiers:
- `/Users/michelgermanotti/Documents/Conformeo/src/data/dashboard/dashboard.ts`
- `/Users/michelgermanotti/Documents/Conformeo/src/data/dashboard/types.ts`

API principale:
- `dashboard.getSummary(scope)`
- `dashboard.getWidgetsConfig(scope?)`
- `dashboard.setWidgetsConfig(config, scope?)`
- `dashboard.getActivityFeed(limit, scope?)`

API utilitaire:
- `dashboard.listProjects(scope?)`
- `dashboard.setContext(...)`

## Offline-first

Le calcul est fait en SQL local sur `conformeo.db`:
- `tasks`
- `media_assets`
- `documents`
- `export_jobs`
- `operations_queue`

Aucun widget ne nécessite un appel backend pour s'afficher.

## Widgets configurables

Préférences locales dans la table:
- `dashboard_prefs`

Clé de scope:
- `org_id`
- `project_id` (vide pour vue entreprise)

Widgets supportés:
- `open_tasks`
- `blocked_tasks`
- `proofs`
- `documents`
- `exports_recent`
- `alerts`
- `activity`

## Feature flags

Intégration via cache local `orgs_admin_cache`:
- clé `org:{orgId}:modules`
- si module désactivé par flag, widget verrouillé côté UI

Comportement de sécurité:
- absence de cache flags => widgets autorisés (fallback local)

## Alertes MVP

- `SYNC_ERRORS`
- `SAFETY_TASKS`
- `UPLOAD_QUEUE_QUOTA`
- `EXPORT_DAILY_QUOTA`

## UI

Écran:
- `/Users/michelgermanotti/Documents/Conformeo/src/features/dashboard/DashboardScreen.tsx`

Composants clés:
- sélection scope entreprise/chantier
- quick actions (tâche, preuve, rapport)
- widgets cliquables (drill-down local)
- panneau de configuration widgets

## Validation

- `npm run -s typecheck` OK
