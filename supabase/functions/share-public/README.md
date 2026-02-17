# share-public

Edge Function publique pour resoudre un token de partage et rediriger vers une Signed URL Supabase Storage.

- Auth: **publique** (JWT desactive via `config.toml` -> `verify_jwt=false`)
- Secret requis: `SUPABASE_SERVICE_ROLE_KEY` (pour bypass RLS + signer l'URL)

## Input
- `GET /functions/v1/share-public?token=...`

## Output
- `302` redirect vers une Signed URL (TTL ~ 5 minutes)
- Sinon: JSON `{ status: "REJECTED", reason }` avec un code HTTP 4xx/5xx.

## Deploiement
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=***
supabase functions deploy share-public
```
