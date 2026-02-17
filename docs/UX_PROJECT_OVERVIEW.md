# UX-01a — Onglet Apercu (Chantier)

## Objectif

Donner une vue "en 5 secondes" de l'etat d'un chantier, sans aucune dependance reseau :

- KPIs fiables (calcul local)
- alertes actionnables (deep links vers les onglets)
- activite recente (timeline locale)

## Fichiers

- UI : `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectOverviewTab.tsx`
- Service : `/Users/michelgermanotti/Documents/Conformeo/src/data/projects/overview.ts`
- Header chantier (chips + quick actions) : `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectDetailScreen.tsx`

## API (offline-first)

Exposee par `overview` :

- `overview.getKpis(projectId)`
- `overview.getHealth(projectId)`
- `overview.getAlerts(projectId)`
- `overview.getActivity(projectId, limit?)`

## KPIs

Source de verite : SQLite local.

- `openTasks` : tasks `status IN ('TODO','DOING')` (hors soft delete)
- `blockedTasks` : tasks `status='BLOCKED'` (hors soft delete)
- `mediaTotal` / `mediaPending` : `media_assets` (pending = `upload_status != 'UPLOADED'`)
- `docsTotal` / `plansCount` : `documents` (plans = `doc_type='PLAN'`)
- `exportsRecent` : `export_jobs` termines recemment (seuil MVP = 7 jours)

## Health (chips header)

Objectif : ne pas "mentir" sur l'etat sync.

- `offline` : derive de `syncEngine.getStatus().state`
- `pendingOps` : outbox non synced (scan `operations_queue.payload` pour trouver `org_id` + `project_id`) + `pendingUploads`
- `conflictCount` : nb conflits ouverts (via indicateurs projects)
- `failedUploads` : nb medias `upload_status='FAILED'` (via indicateurs projects)

Note : le scan outbox est borne a 5000 ops, et ignore les ops en dead-letter (`retry_count >= maxSyncAttempts`).

## Alertes (regles MVP)

Les alertes sont **courtes** et **actionnables** (CTA vers onglet), ordonnees par severite.

- Quota stockage :
  - WARN si >= 80%
  - CRIT si >= 95%
  - CTA -> onglet `Media`
- Conflits sync ouverts -> CRIT, CTA -> onglet `Control`
- Taches "safety" ouvertes -> WARN, CTA -> onglet `Tasks`
- Uploads medias en echec -> CRIT, CTA -> onglet `Media` filtre `uploadStatus='FAILED'`
- Pas d'export recent (> 7j) -> INFO, CTA -> onglet `Control`

UI : max 3 alertes affichees (le service peut en retourner plus, mais l'UI tranche).

## Activite recente

Derivee sans table d'evenements :

- `tasks.updated_at`
- `media_assets.created_at`
- `documents.updated_at`
- `export_jobs.finished_at|created_at`
- `plan_pins.updated_at`

Chaque event est tappable et ouvre l'onglet correspondant (Tasks / Media / Documents / Control / Plans).

## Deep links / navigation

- Les alertes utilisent `ctaRoute.tab` (+ `ctaRoute.params` optionnels).
- `MediaTab` supporte `uploadStatus: 'ALL' | 'PENDING' | 'FAILED'` (utilise par l'alerte "uploads en echec").

