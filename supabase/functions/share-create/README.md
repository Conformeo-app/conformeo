# share-create

Edge Function pour creer un lien de partage externe (token temporaire) vers un fichier Storage.

- Auth: **JWT utilisateur requis** (verify_jwt=true par defaut)
- Stockage: enregistre uniquement un **hash** du token (`token_hash`) dans `public.share_links`.

## Input
```json
{
  "org_id": "uuid",
  "entity": "DOCUMENT|EXPORT",
  "entity_id": "uuid|string",
  "resource_bucket": "conformeo-media|conformeo-exports",
  "resource_path": "{org_id}/...",
  "expires_in_hours": 72
}
```

## Output
```json
{
  "status": "OK|REJECTED",
  "reason": "optional",
  "id": "uuid",
  "token": "string",
  "expires_at": "ISO",
  "url": "https://<project>.supabase.co/functions/v1/share-public?token=..."
}
```

## Deploiement
```bash
supabase functions deploy share-create
```
