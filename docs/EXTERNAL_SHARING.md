# External Sharing (Liens temporaires)

## Objectif
Permettre de partager des `DOCUMENT` et `EXPORT` via un lien temporaire **lecture seule**, **révocable**, avec **traçabilité**.

- Côté app: génération du lien via Edge Function `share-create`.
- Côté public: résolution du lien via Edge Function `share-public` (redirige vers une Signed URL Supabase Storage).

## Backend (Supabase)

### 1) Migration SQL
Appliquer: `supabase/migrations/20260215190000_external_sharing.sql`

Cette migration crée:
- `public.share_links`
- `public.is_org_manager(org_id)`
- le bucket Storage `conformeo-exports` + policies

### 2) Edge Functions
Déployer:
- `supabase/functions/share-create`
- `supabase/functions/share-public`

Configuration:
- `share-public` doit être **publique** (verify_jwt=false) pour être ouvrable dans un navigateur sans headers.
- Dans ce repo: `supabase/functions/share-public/config.toml`.

#### Secret requis
`share-public` nécessite une clé de service pour bypass RLS et signer les URLs:
- secret: `SUPABASE_SERVICE_ROLE_KEY`

Important: la **service role key ne doit jamais être embarquée dans l'app**.

## App (Expo / RN)

### Module
- `src/data/external-sharing/share.ts`
- `src/data/external-sharing/types.ts`

API:
- `share.create(entity, entityId, { expiresInHours })`
- `share.list(entity, entityId)`
- `share.revoke(linkId)`

Notes:
- Les tokens sont stockés en **SecureStore** (Keychain) et ne sont disponibles que sur l'appareil qui a créé le lien.
- Si un lien a été créé sur un autre appareil, l'app affiche le lien comme "non dispo" (mais il reste révocable).

### UI
- Documents: `src/features/documents/DocumentsScreen.tsx`
- Exports: `src/features/exports/ExportsScreen.tsx`

## Flux MVP

### Partage Document
1. Le document doit être uploadé (media `upload_status = UPLOADED` + `remote_path`).
2. L'app appelle `share.create('DOCUMENT', docId, { expiresInHours })`.
3. Un lien public est généré et proposé via la feuille de partage iOS.

### Partage Export
1. L'export `DONE` est uploadé sur `conformeo-exports` (upsert).
2. L'app appelle `share.create('EXPORT', exportJobId, { expiresInHours })`.
3. Un lien public est généré et proposé via la feuille de partage iOS.
