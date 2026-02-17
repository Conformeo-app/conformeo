# UX-01e — Onglet Documents (Chantier)

## Objectif
Gestion documentaire chantier "offline-first" :
- liste rapide + filtres (types / signés / liés à une tâche)
- création / import (PDF/images) sans dépendance réseau
- versioning (v1, v2, ...) sans écrasement
- liens inter-modules (tâches, pins, exports)
- signature probante + partage externe (optionnels via feature flags)

## Source de vérité
- Tables locales (SQLite) : `documents`, `document_versions`, `document_links`
- Service : `src/data/documents/documents.ts`
- Fichiers (versions) : `media_assets` via `src/data/media/mediaPipeline.ts`

## Filtres (UI)
Chips :
- Tous
- Plans (`doc_type=PLAN`)
- DOE/Rapports (`doc_type IN (DOE, REPORT)`)
- PV (`doc_type=PV`)
- Sécurité (tag `securite`)
- Autres (`doc_type=OTHER`)
- Signés (`status=SIGNED`)
- Liés à une tâche (EXISTS link `linked_entity=TASK`)

## Versioning
- Ajout version : `documents.addVersion(documentId, { source: 'import' | 'capture' })`
- La nouvelle version devient active : `active_version_id` mis à jour
- Activation manuelle : `documents.setActiveVersion(documentId, versionId)`

## Liens
Depuis le détail :
- Lier à une tâche (picker local)
- Lier à un pin (picker local)
- Lier à un export (picker local)
- Suppression lien : `documents.unlink(documentId, entity, entityId)`

## Feature flags (optionnels)
Par défaut, les sections sensibles sont masquées :
- Signature probante : flag `signature-probante`
- Partage externe : flag `external-sharing`

## Fichiers clefs
- UI : `src/features/documents/DocumentsScreen.tsx`
- Data : `src/data/documents/documents.ts`, `src/data/documents/types.ts`

