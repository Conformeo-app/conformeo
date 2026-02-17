# MODULE 24 — data-governance

## Scope
Module RGPD / gouvernance des données pour Conformeo:
- politiques de rétention configurables par organisation
- purge locale contrôlée
- export portabilité JSON offline-first
- anonymisation utilisateur supprimé
- suppression complète organisation (super-admin + confirmation forte)

## API
Service: `src/data/data-governance/governance.ts`

- `governance.setPolicy(entity, days)`
- `governance.applyRetention()`
- `governance.exportPortableData(orgId?)`
- `governance.anonymizeDeletedUser(userId)`
- `governance.deleteOrganization(orgId, confirmation)`
- `governance.listPolicies(orgId?)`

## Backend
Migration: `supabase/migrations/20260216143000_data_governance.sql`

Crée:
- `public.retention_policies`
- `public.set_retention_policy(...)`
- `public.anonymize_user_data(...)`
- `public.super_admin_delete_org(...)`

RLS:
- lecture policies: membre org
- écriture policies: admin org

## UI
Écran: `src/features/governance/GovernanceScreen.tsx`

Fonctions disponibles:
- édition rétention par entité
- purge immédiate
- export portable local
- anonymisation utilisateur
- suppression org (confirmation `DELETE <org_id>`)

## Tests manuels recommandés
1. Modifier une policy (`RECENTS=30`) puis relancer écran: valeur persistée.
2. Lancer `applyRetention()` avec données anciennes: compteurs de suppression > 0.
3. Lancer export portable: fichier JSON généré dans `documentDirectory/portable_exports`.
4. Anonymiser un utilisateur: résultat local + RPC backend OK.
5. Supprimer org avec mauvaise confirmation: rejet.
6. Supprimer org avec confirmation exacte: suppression + cleanup storage.
