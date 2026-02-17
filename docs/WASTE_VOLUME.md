# Waste Volume (MODULE waste-volume)

## Objectif

Estimer et suivre le volume de dechets sur chantier **offline-first**:
- calcul volume via dimensions (L x l x h en metres)
- categorisation
- historique + totals
- export CSV local (partage via OS)

## Stockage local (SQLite)

Table: `waste_entries`

Champs:
- `id` (uuid)
- `org_id`, `project_id`
- `category` (texte)
- `length_m`, `width_m`, `height_m`
- `volume_m3` (calc)
- `note?`
- `created_by`
- `created_at`, `updated_at`
- `deleted_at?` (soft delete)

## Sync / outbox

Chaque mutation enfile une operation via `offlineDB.enqueueOperation`:
- entity `waste_entries`

Le backend MVP stocke ces entites dans `sync_shadow` (generic sink).

## API

Expose via `src/data/waste-volume`:
- `waste.computeVolume(length_m, width_m, height_m)`
- `waste.create(input)`
- `waste.update(id, patch)`
- `waste.softDelete(id)`
- `waste.getById(id)`
- `waste.listByProject(projectId, filters)`
- `waste.computeTotals(projectId, filters)`
- `waste.exportCsv(projectId, filters, { delimiter? })`

## UI

Ecran: `src/features/waste/WasteVolumeScreen.tsx`
- ajout rapide + calcul volume instantane
- historique pagine + filtre categorie
- export CSV via `expo-sharing` (sinon affiche le chemin local)

