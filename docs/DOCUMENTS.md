# Module documents

## Rôle
Centraliser les documents Conformeo en offline-first avec versioning minimal et liens inter-modules.

## API publique
- `documents.create(meta)`
- `documents.update(id, patch)`
- `documents.softDelete(id)`
- `documents.getById(id)`
- `documents.list(scope, projectId?, filters?)`
- `documents.addVersion(documentId, fileContext)`
- `documents.listVersions(documentId)`
- `documents.setActiveVersion(documentId, versionId)`
- `documents.link(documentId, entity, entityId)`
- `documents.listLinks(documentId)`
- `documents.listByLinkedEntity(entity, entityId)`

## Schéma local
### Table `documents`
- `id`, `org_id`, `scope`, `project_id`
- `title`, `doc_type`, `status`
- `tags_json`, `description`
- `created_by`, `created_at`, `updated_at`, `deleted_at`
- `active_version_id`

### Table `document_versions`
- `id`, `document_id`, `version_number`
- `file_asset_id`, `file_hash`, `file_mime`, `file_size`
- `created_at`, `created_by`

### Table `document_links`
- `id`, `document_id`
- `linked_entity`, `linked_id`
- `created_at`

## Offline-first
- Aucune lecture/écriture backend directe.
- Toutes les mutations alimentent `operations_queue` via `offlineDB.enqueueOperation`.
- Source de vérité locale: SQLite (`conformeo.db`).

## Versioning
- Un document est un conteneur de versions.
- `addVersion()` utilise `media-pipeline` (import/capture/existing asset).
- Hash version: `sha256` calculé localement sur le fichier stocké.
- Limite de rétention configurée: 10 versions/document.

## Liens inter-modules
- Liens supportés: `TASK`, `PLAN_PIN`, `PROJECT`, `EXPORT`.
- Requêtes de navigation disponibles avec `listByLinkedEntity`.

## Écran livré
`src/features/documents/DocumentsScreen.tsx`
- Vue liste: scope, filtres, pagination, statut, type, tag principal, preview thumbnail.
- Vue détail: édition méta, ajout version, activation version, gestion des liens, suppression soft.

## Scénarios manuels
1. Ajouter un PDF offline -> visible immédiatement dans la liste.
2. Ajouter v2 -> v1 reste accessible dans les versions.
3. Lier document à une tâche -> lien visible en détail.
4. Revenir online -> versions et méta partent via sync-engine/outbox.
5. Soft delete -> document masqué mais conservé pour sync.
