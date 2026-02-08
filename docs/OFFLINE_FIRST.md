# Module offline-first

## Role
Le module `offlineDB` rend l'application utilisable sans reseau. Toute lecture/ecriture locale passe par lui, et chaque mutation est enregistree dans une outbox persistante.

## Choix technique (justification)
- Runtime actuel: Expo managed + Expo Go.
- Base locale retenue: SQLite (`expo-sqlite`) pour fiabilite immediate sans ajout natif.
- Contrat conserve: API `offlineDB` stable pour migrer vers WatermelonDB/RxDB plus tard sans toucher les ecrans.

## Schema local
Fichier: `src/data/offline/outbox.ts`

### Table `local_entities`
- `entity TEXT`
- `id TEXT`
- `data TEXT` (JSON serialise)
- `deleted INTEGER`
- `created_at TEXT` (ISO)
- `updated_at TEXT` (ISO)
- PK `(entity, id)`

### Table `operations_queue`
- `id TEXT` (uuid/local id)
- `entity TEXT`
- `entity_id TEXT`
- `type TEXT` (`CREATE|UPDATE|DELETE`)
- `payload TEXT` (JSON serialise)
- `status TEXT` (`PENDING|SYNCED|FAILED`)
- `created_at TEXT` (ISO)
- `retry_count INTEGER`
- `next_attempt_at INTEGER` (epoch ms)
- `last_error TEXT`
- `synced_at TEXT`

Regle: aucune suppression automatique des operations.

## API offlineDB (obligatoire)
- `offlineDB.create(entity, data)`
- `offlineDB.update(entity, id, patch)`
- `offlineDB.delete(entity, id)`
- `offlineDB.query(entity, filters)`
- `offlineDB.getById(entity, id)`
- `offlineDB.enqueueOperation(operation)`
- `offlineDB.getPendingOperations(limit?, now?)`
- `offlineDB.flushOutbox(limit?, now?)`

API sync utile:
- `offlineDB.markAsSynced(id)`
- `offlineDB.markAsFailed(id, error, nextAttemptAt?)`
- `offlineDB.markAsDead(id, error)`

## Contrat sync
- `sync/engine.ts` lit via `offlineDB.flushOutbox()`.
- Le transport reseau est hors module offline (`sync/transport.ts`).
- Une operation passe en `SYNCED` uniquement apres confirmation serveur.

## Tests de resistance (manuel)
1. Couper le reseau, creer 50 enregistrements via l'ecran Offline.
2. Fermer brutalement l'app.
3. Relancer l'app: verifier `queueDepth` identique et donnees locales presentes.
4. Reconnecter le reseau.
5. Lancer `Synchroniser`.
6. Verifier baisse de `queueDepth` et passage des operations en `SYNCED`.

## Checklist de conformite
- [x] Toutes les donnees passent par la DB locale
- [x] Outbox persistante implementee
- [x] Fonctionne app fermee / relancee
- [x] Aucun appel backend dans `offlineDB`
- [x] API claire et documentee
