# Module media-pipeline

## Role
Module offline-first pour capture/import, optimisation locale et upload background des medias chantier.

## API publique
- `media.capturePhoto(context)`
- `media.importFiles(context)`
- `media.process(assetId)`
- `media.enqueueUpload(assetId)`
- `media.getById(id)`
- `media.listByProject(projectId, filters?)`
- `media.listByTask(taskId)`
- `media.getUploadPendingBatch(limit)`
- `media.markUploading(id)`
- `media.markUploaded(id, remotePath, remoteUrl?)`
- `media.markFailed(id, error)`

## Schema local
Table SQLite locale: `media_assets`.

Colonnes principales:
- `id`, `org_id`, `project_id`, `task_id`, `plan_pin_id`
- `local_original_path`, `local_path`, `local_thumb_path`
- `mime`, `width`, `height`, `size_bytes`
- `watermark_applied`, `watermark_text`
- `upload_status`, `remote_path`, `remote_url`
- `created_at`, `retry_count`, `last_error`

## Pipeline local
1. Capture/import -> copie locale immediate (`originals/`).
2. `process()`:
   - resize max 1920 px
   - conversion WebP (fallback JPEG)
   - thumbnail 320 px
   - watermark text operationnel (sur outputs/preview)
3. `enqueueUpload()` seulement apres processing.

## Quotas / limites
- Taille max import: `25 MB`.
- Queue max upload: `500` medias.
- Maintenance locale:
  - suppression thumbs orphelins
  - suppression exports anciens (> 7 jours)

## Upload background
- Worker: `mediaUploadWorker.runPendingUploads(limit)`.
- Declenchement: cycle `sync-engine` (online).
- Batch par cycle: 12 medias (config actuelle).
- Reprise apres kill app: etat persistant en DB locale.

## Stockage distant
- Bucket Supabase Storage: `conformeo-media`.
- Chemin distant: `{org}/{project}/{date}/{mediaId}.{ext}`.

## Scenarios manuels
1. 100 photos offline -> thumbnails visibles + `PENDING`.
2. Kill app -> relance -> medias toujours presents.
3. Reseau revient -> upload batch sans freeze UI.
4. Echec upload -> `retry_count++` et `last_error` visible.
5. Preview export -> watermark texte present.
