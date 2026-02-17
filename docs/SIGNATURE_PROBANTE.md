# Module signature-probante

Objectif: ajouter une signature "probante" (hash + audit) sur des documents (PDF) en offline-first.

## Principes

- La source de verite est locale.
- La signature genere une nouvelle version du document (on n'ecrase jamais une version existante).
- Idempotence: l'operation de sync utilise un operation_id unique.
- Audit local: org/user/role/device/time + hash SHA-256 du PDF signe.

## Data model local (SQLite)

Table `signatures` (DB locale `conformeo.db`):

- `id` (uuid)
- `org_id`
- `document_id`
- `version_id` (version source signee)
- `signed_document_version_id` (version creee pour le PDF signe)
- `signer_user_id`
- `signer_role`
- `signer_display_name`
- `device_id`
- `signature_asset_id` (media asset: recap signature)
- `signed_pdf_asset_id` (media asset: PDF signe)
- `file_hash` (sha256 base64 du PDF signe)
- `source_version_hash` (sha256 de la version source)
- `signed_at_local`
- `signed_at_server` (apres ack sync)
- `geo_lat`, `geo_lng` (optionnel)
- `status`: DRAFT | PENDING | FINAL
- `created_at`, `updated_at`

## API (TS)

Expose via `src/data/signature-probante`:

- `sign.start(documentId, versionId)`
- `sign.capture(canvasData)`
- `sign.finalize()`
- `sign.getByDocument(documentId)`
- `sign.verify(signatureId)` (MVP: verification locale hash)

## Workflow (MVP)

1. L'utilisateur dessine sa signature.
2. `finalize()` genere un PDF signe (annexe "Signature") via `pdf-lib`.
3. Le PDF signe est enregistre en media asset + nouvelle document_version.
4. Une operation outbox `signatures` est envoyee a la sync.
5. A l'ack serveur, la signature passe de PENDING -> FINAL et remplit `signed_at_server`.

## Tests manuels

- Offline:
  - creer/importer un document PDF
  - lancer "Signer" -> dessiner -> valider
  - le PDF signe est dispo localement (partage OK)
  - la signature apparait en PENDING
- Relance app:
  - l'historique signatures est identique
- Retour reseau:
  - sync -> signature passe en FINAL (timestamp serveur rempli)
- Verification:
  - `verify` -> valid: true
  - si fichier modifie -> valid: false (hash mismatch)
