# GEO Context (GPS)

## Objectif

Stocker un contexte GPS **offline-first** (local-only) pour des entites metier (preuves/media, taches, signatures), et fournir une API utilitaire pour verifier un perimetre de chantier (geofence simple).

Contraintes:
- Aucune dependance reseau.
- Ne doit **jamais** casser un flow UI si la localisation est indisponible.
- Multi-tenant: `org_id` present sur chaque enregistrement.

## Stockage local

Table SQLite: `geo_records`

Champs:
- `id` (uuid)
- `org_id`
- `user_id?`
- `project_id?`
- `entity` (ex: `TASK`, `MEDIA`, `SIGNATURE`)
- `entity_id`
- `lat`, `lng`, `accuracy?`
- `created_at` (ISO)

Indexes:
- `(org_id, entity, entity_id, created_at desc)`
- `(org_id, created_at desc)`

## API

Expose via `src/data/geo-context`:

- `geo.setContext({ org_id?, user_id? })`
- `geo.setProvider(provider | null)`
- `geo.getPermissionStatus()`
- `geo.requestPermission()`
- `geo.capture(input): Promise<GeoRecord | null>`
  - Best-effort: retourne `null` si aucun provider GPS n'est configure ou si la localisation echoue.
- `geo.getLatest(entity, entityId, orgId?)`
- `geo.list(entity, entityId, { orgId?, limit? })`
- `geo.checkPerimeter({lat,lng}, {center_lat,center_lng,radius_meters})`

## Provider GPS (important)

Le module utilise `expo-location` par defaut (si la permission est deja accordee). La capture est **best-effort**: si la permission n'est pas accordee, `geo.capture()` retourne `null` sans casser le flow.

Si tu veux override (tests/mocks), tu peux injecter ton provider via `geo.setProvider(...)`.

Note: l'app est deja configuree avec `NSLocationWhenInUseUsageDescription` et les permissions Android (`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`) dans `app.json`.
Un bouton "Demander permission" est disponible dans l'ecran **Securite** pour declencher le prompt iOS/Android.

## Integrations

Des hooks best-effort ont ete ajoutes:
- `tasks.create()` -> `geo.capture({ entity:'TASK', ... })`
- `media.capturePhoto/importFiles/registerGeneratedFile()` -> `geo.capture({ entity:'MEDIA', ... })`
- `sign.finalize()` -> `geo.capture({ entity:'SIGNATURE', ... })`

Si aucun provider n'est configure, ces appels sont no-op (retour `null`).
