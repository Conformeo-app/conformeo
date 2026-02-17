# Carbon Footprint (MODULE carbon-footprint)

## Objectif

Calcul simplifie du bilan carbone chantier a partir de donnees **offline-first**:
- dechets (via `waste-volume`)
- deplacements (km par mode)
- energie (kWh / L / etc.)
- export PDF local (partage OS)

## Donnees locales (SQLite)

Tables:
- `travel_entries`
- `energy_entries`

### travel_entries
- `id` (uuid)
- `org_id`, `project_id`
- `mode` (texte, ex: `CAR`, `VAN`, `TRUCK`, `PUBLIC`, ...)
- `distance_km`
- `note?`
- `created_by`
- `created_at`, `updated_at`
- `deleted_at?` (soft delete prevu)

### energy_entries
- `id` (uuid)
- `org_id`, `project_id`
- `energy_type` (texte, ex: `ELECTRICITY_KWH`, `DIESEL_L`, ...)
- `quantity`
- `note?`
- `created_by`
- `created_at`, `updated_at`
- `deleted_at?`

## Facteurs d'emission (MVP)

Fichier: `src/data/carbon-footprint/defaultFactors.json`

- `waste_kgco2e_per_m3`
- `travel_kgco2e_per_km`
- `energy_kgco2e_per_unit`

Important: valeurs **simplifiees** (non contractuelles). A remplacer/ajuster selon ta methode.

## Sync / outbox

Chaque entree ajoutee enfile une operation via `offlineDB.enqueueOperation`:
- entity `travel_entries`
- entity `energy_entries`

Le backend MVP stocke dans `sync_shadow` (generic sink).

## API

Expose via `src/data/carbon-footprint`:
- `carbon.addTravel(...)`
- `carbon.addEnergy(...)`
- `carbon.listTravel(projectId, {org_id,...})`
- `carbon.listEnergy(projectId, {org_id,...})`
- `carbon.computeProject(orgId, projectId)`
- `carbon.generateReportPdf(orgId, projectId)`

## UI

Ecran: `src/features/carbon/CarbonScreen.tsx`
- ajout deplacements + energie
- synthese + export PDF

