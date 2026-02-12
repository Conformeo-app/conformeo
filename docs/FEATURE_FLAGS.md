# FEATURE FLAGS

Module: `feature-flags`

## Rôle

Activer/désactiver modules et UX par organisation avec:
- cache offline local (lecture)
- API `isEnabled(key)` utilisable partout dans l'app
- audit backend des changements
- rollback rapide sur le dernier changement d’un flag

## API TypeScript

Source: `/Users/michelgermanotti/Documents/Conformeo/src/data/feature-flags/featureFlags.ts`

- `flags.refresh(preferredOrgId?)`
- `flags.listAll(preferredOrgId?)`
- `flags.isEnabled(key, options?)`
- `flags.getPayload(key, options?)`
- `flags.setEnabled(key, enabled, preferredOrgId?)`
- `flags.setPayload(key, payload, preferredOrgId?)`
- `flags.listAudit(preferredOrgId?, options?)`
- `flags.rollbackLastChange(key, preferredOrgId?)`

## Cache offline

SQLite (`conformeo.db`):
- `feature_flags_cache`
- `feature_flags_audit_cache`

Compatibilité legacy:
- alimentation de `orgs_admin_cache` clé `org:{orgId}:modules` pour les modules qui lisent encore cet ancien cache.

## Defaults

- Flags de modules (`dashboard`, `tasks`, `documents`, etc.)
  - par défaut = `enabled: true` si aucun flag explicite n’existe.
- Flags non-module
  - par défaut = `false` via `isEnabled` (sauf fallback explicite).

## Intégrations app

- Auth:
  - `AuthProvider` hydrate les flags au login (`listAll`) puis tente un refresh réseau (`refresh`).
- Navigation:
  - `AppRoot` filtre les modules affichés dans la `Sidebar` selon les flags actifs.
- Orgs Admin:
  - section `Modules activés` permet:
    - toggle enabled/disabled
    - édition payload JSON
    - rollback 1 clic (dernier changement)

## Backend / audit

Migration:
- `/Users/michelgermanotti/Documents/Conformeo/supabase/migrations/20260212164000_feature_flags.sql`

Ajouts:
- table `feature_flags_audit`
- colonne `feature_flags.updated_by`
- `set_feature_flag(...)` mis à jour pour:
  - write déterministe (`payload` remplacé, non fusionné)
  - insertion audit `old_value` / `new_value`
  - trace complémentaire dans `audit_logs`

## Validation attendue

- Offline sans réseau: `flags.listAll()` et `flags.isEnabled()` restent fonctionnels via cache.
- Toggle admin: effet local immédiat après refresh.
- Rollback: retour à l’état précédent du flag en 1 action.
