# UX-01d — Onglet Preuves (Chantier)

## Objectif
Grille "thumbnail-first" pour toutes les preuves d'un chantier, utilisable 100% offline, avec:
- capture/import rapides
- filtres simples (date / liens / upload)
- detail preuve (viewer + liens + retry)
- indicateurs pending/failed sans stress utilisateur

## Source de verite
- Table locale: `media_assets` (SQLite via `src/data/media/mediaPipeline.ts`)
- Upload: `src/data/media/uploadWorker.ts` (Supabase Storage)
- Sync global: `src/data/sync/sync-engine.ts` / `src/data/sync/runtime.ts`

## Etats upload (UI)
- `PENDING`: dans la file d'upload (offline OK)
- `UPLOADING`: en cours
- `UPLOADED`: confirme cote storage
- `FAILED`: erreur stockee dans `last_error`

CTA:
- "Retenter upload" -> `media.retryUpload(id)` (re-queue)

## Filtres rapides (chips)
- Toutes
- Aujourd'hui
- Cette semaine
- Liees a une tache
- Non liees (ni tache ni pin)
- Upload en attente (PENDING + UPLOADING)
- Upload en echec (FAILED)

## Liens
- `task_id`: lien direct vers une tache
- `plan_pin_id`: miroir local (filtrage/indicateur)
- Source-of-truth pin<->media: `plan_pin_links` via `plans.link/unlink`

Dans le detail:
- Lier/Delier tache (picker local)
- Creer tache depuis preuve
- Lier/Delier pin (picker local)

## Perf
- Grille: `FlatList` + thumbnails uniquement (`local_thumb_path`)
- Detail: charge l'image optimisee (`local_path`)

## Fichiers clefs
- UI: `src/features/media/MediaScreen.tsx`
- Data: `src/data/media/mediaPipeline.ts`
- Pins: `src/data/plans-annotations/plansAnnotations.ts`

