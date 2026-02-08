# apply-operation

Edge Function de synchronisation offline-first.

## Contrat d'entree
```json
{
  "operation_id": "uuid",
  "org_id": "uuid",
  "user_id": "uuid (optionnel)",
  "entity": "task|inspection|...",
  "entity_id": "uuid|string",
  "type": "CREATE|UPDATE|DELETE",
  "payload": {}
}
```

## Contrat de sortie
```json
{
  "status": "OK|DUPLICATE|REJECTED",
  "reason": "optional",
  "server_version": 12,
  "server_updated_at": "ISO"
}
```

## Garanties
- Aucune `service_role` dans la fonction.
- Auth utilisateur via bearer token.
- Application serveur via RPC `apply_sync_operation` (idempotence + controles droits).
- `DUPLICATE` si `operation_id` deja traite.

## Deploiement
```bash
supabase functions deploy apply-operation
```
