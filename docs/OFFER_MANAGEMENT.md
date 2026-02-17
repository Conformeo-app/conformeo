# Offer Management (MODULE offer-management)

## Objectif

Gestion "offres SaaS" (MVP) :
- plans
- modules inclus
- surcouts par chantier actif (estimation)
- historique des changements de plan
- application des modules via `feature-flags` (admin)

Ce module est **administratif** (pas critique terrain). Les tarifs sont des placeholders configurables.

## Config plans

Fichier: `src/data/offer-management/defaultPlans.json`

Champs:
- `key`, `name`
- `base_price_eur_month`
- `included_active_projects`
- `extra_project_eur_month`
- `included_modules` (cles `ModuleKey`)

## Stockage local (SQLite)

Tables:
- `org_offer_state` (etat courant)
- `org_offer_history` (historique)

### org_offer_state
- `org_id` (PK)
- `plan_key`
- `updated_at`
- `updated_by?`
- `source` (`LOCAL|REMOTE|DEFAULT`)

### org_offer_history
- `id` (uuid)
- `org_id`
- `old_plan_key?`
- `new_plan_key`
- `changed_by?`
- `changed_at`

## Sync / outbox

Les changements sont serialises (outbox):
- entity `org_offer_state` (UPDATE)
- entity `org_offer_history` (CREATE)

Le backend MVP stocke dans `sync_shadow` (generic sink).

## API

Expose via `src/data/offer-management`:
- `offers.listPlans()`
- `offers.getCurrent(orgId)`
- `offers.setPlan({org_id, plan_key, actor_user_id?})`
- `offers.listHistory(orgId, limit?)`
- `offers.computePricing(orgId)`
- `offers.getPlanModules(planKey)`
- `offers.applyPlanModulesToFlags(orgId, planKey)` (RPC `set_feature_flag`)

### Note "chantiers actifs"

MVP: nombre de chantiers actifs estime via `COUNT(DISTINCT tasks.project_id)` (si la table tasks existe localement).

## UI

Ecran: `src/features/offers/OfferManagementScreen.tsx`

