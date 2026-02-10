# Module exports-doe

## Role
Generer des exports terrain en offline-first a partir de la base locale:
- `REPORT_PDF`
- `CONTROL_PACK`
- `DOE_ZIP`

Source de verite: donnees locales (`tasks`, `media`, `documents`).
Aucun appel backend direct pendant la generation.

## API publique
- `exportsDoe.createJob(projectId, type)`
- `exportsDoe.run(jobId)`
- `exportsDoe.cancel(jobId)`
- `exportsDoe.getById(jobId)`
- `exportsDoe.listByProject(projectId)`
- `exportsDoe.purgeOldExports(days)`
- `exportsDoe.computeEstimatedSize(projectId, type)`

API utilitaire ajoutee:
- `exportsDoe.setContext({ org_id, user_id })`
- `exportsDoe.remove(jobId)`
- `exportsDoe.listItems(exportId)`

## Schema local
### Table `export_jobs`
- `id`
- `org_id`
- `project_id`
- `type` (`REPORT_PDF|CONTROL_PACK|DOE_ZIP`)
- `status` (`PENDING|RUNNING|DONE|FAILED`)
- `local_path`
- `size_bytes`
- `created_by`
- `created_at`
- `finished_at`
- `retry_count`
- `last_error`

### Table `export_items`
- `id`
- `export_id`
- `entity` (`TASK|MEDIA|DOCUMENT`)
- `entity_id`
- `created_at`

## Strategie de generation
- Job async: `PENDING -> RUNNING -> DONE|FAILED`.
- Verification quota journalier: `max 20` exports/jour/org.
- Verification taille estimee avant generation: `max 250 MB` local.
- PDF local via `expo-print`.
- ZIP local via `jszip` + ecriture base64 `expo-file-system`.
- Traçabilite:
  - metadonnees dans PDF (org, chantier, auteur, date, export id)
  - watermark PDF `Genere par Conformeo - {export_id}`
  - `manifest.json` dans les ZIP.

## Types d'exports
### `REPORT_PDF`
- PDF unique avec:
  - resume
  - tableau taches
  - preuves en vignettes (thumbnails)
  - documents lies

### `CONTROL_PACK`
- ZIP local:
  - `/report/control_pack.pdf`
  - `/annexes/photos/*`
  - `/annexes/documents/*`
  - `/report/manifest.json`

### `DOE_ZIP`
- ZIP local conforme structure:
  - `/report/rapport.pdf`
  - `/report/manifest.json`
  - `/photos/*`
  - `/documents/*`

## Regles media
- Aucune photo HD brute en ZIP.
- Inclusion des `local_path` optimises (pipeline media).
- Si image non watermarquee au moment de l'export: `media.process()` est execute avant inclusion.
- PDF: utilisation des thumbnails uniquement pour la section preuves.

## Purge / retention
- `purgeOldExports(days)`:
  - supprime les fichiers locaux d'exports anciens
  - supprime `export_jobs` + `export_items`

## Outbox / sync
- Mutations queuees dans `operations_queue` via `offlineDB.enqueueOperation`:
  - `export_jobs` (CREATE/UPDATE/DELETE)
  - `export_items` (CREATE)

## Ecran livre
`src/features/exports/ExportsScreen.tsx`
- Creation en 2 taps:
  - choix type
  - lancer
- Affichage progression (`RUNNING`)
- Actions fin de job:
  - `Ouvrir`
  - `Partager`
  - `Supprimer`

## Scenarios manuels recommandes
1. Offline total -> lancer `REPORT_PDF` -> fichier genere en local.
2. 200 photos -> PDF avec thumbnails, ZIP avec fichiers optimises.
3. Annulation en cours -> job `FAILED` avec message.
4. Purge 30 jours -> suppression des anciens fichiers + enregistrements.
5. Validation manifest -> references coherentes avec contenus ZIP.
