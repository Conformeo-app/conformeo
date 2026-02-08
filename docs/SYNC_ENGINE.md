# Module sync-engine

## Role
Le module synchronise l'outbox locale vers Supabase sans bloquer l'utilisateur.
La base locale reste la source de verite.

## API publique
- `syncEngine.start()`
- `syncEngine.stop()`
- `syncEngine.triggerSync(reason)`
  - `reason`: `NETWORK_RESTORED | MANUAL | APP_START | TIMER`
- `syncEngine.getStatus()`
  - `{ state, pendingOps, lastSyncAt?, lastError? }`
- `syncEngine.onStatusChange(cb)`

## Etats
- `IDLE`: moteur pret, pas de cycle actif.
- `SYNCING`: cycle en cours.
- `OFFLINE`: reseau indisponible.
- `ERROR`: erreur active (inclut circuit breaker ouvert).

## Strategie
- Demarrage app: `APP_START`.
- Retour reseau: `NETWORK_RESTORED`.
- Timer online: toutes les 10 minutes.
- Trigger manuel: `MANUAL`.
- Verrou anti-boucle: un seul cycle a la fois.
- FIFO: traitement par `created_at ASC`.
- Batch: 50 operations max par lot, 500 max par cycle.
- Upload media: worker dedie declenche dans chaque cycle sync (batch 12).

## Resilience
- Retry automatique.
- Backoff exponentiel via `backoffSchedule(retryCount)`.
- Circuit breaker: ouverture apres 8 echecs consecutifs, cooldown 60s.
- Operation `REJECTED`: marquee dead-letter (`FAILED` terminal).

## Idempotence
- Chaque operation possede un `operation_id` unique (id outbox).
- Reponse serveur `DUPLICATE` est traitee comme succes.
- L'operation passe `SYNCED` uniquement apres confirmation `OK|DUPLICATE`.

## Contrat serveur
Edge Function: `apply-operation`.

Input:
```json
{
  "operation_id": "uuid",
  "org_id": "uuid",
  "user_id": "uuid",
  "entity": "task",
  "entity_id": "uuid",
  "type": "CREATE|UPDATE|DELETE",
  "payload": {}
}
```

Output:
```json
{
  "status": "OK|DUPLICATE|REJECTED",
  "server_version": 12,
  "server_updated_at": "ISO",
  "reason": "optional"
}
```

## Interdits respectes
- Pas de suppression d'operation sans ACK serveur.
- Pas de blocage UI (asynchrone + lock interne).
- Pas de skip silencieux (erreurs conservees + lastError + logs dev).
- Pas de service role embarque cote mobile.

## Scenarios de validation manuelle
1. 200 operations offline creees -> toutes en `PENDING`.
2. Reseau restaure -> sync par batch sans freeze UI.
3. Kill app pendant sync -> reprise au prochain start.
4. Renvoi operation identique -> `DUPLICATE` accepte.
5. Payload invalide -> `REJECTED`, operation `FAILED`, erreur visible.
