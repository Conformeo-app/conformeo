# Audit Compliance

Objectif: garantir une tracabilite juridique des actions sensibles, meme offline.

## Scope MVP
- API locale `audit.log`, `audit.list`, `audit.export`.
- Cache SQLite persistant (`audit_logs_cache`) avec reprise offline.
- Push remote vers `public.audit_logs` quand backend disponible.
- Compatibilite schema legacy/new colonnes (`actor_user_id/target_type/metadata` + `user_id/entity/payload_json`).

## API (mobile)
- `audit.log(action, entity, id, payload?)`
- `audit.list(filters?)`
- `audit.export(filters?)`
- `audit.flushPending()`

Contexte requis:
- `org_id`
- `user_id`

Le contexte est injecte depuis `AuthProvider`.

## Integrations deja branchees
- Documents:
  - `document.create`
  - `document.update`
  - `document.soft_delete`
- Signature probante:
  - `signature.finalize`
  - `signature.mark_final`
- Super-admin (Edge Function):
  - `super_admin.impersonation.start`
  - `super_admin.impersonation.stop`
- Feature flags:
  - deja tracees dans `public.set_feature_flag` via `audit_logs`

## UI
- Ecran module `Audit`:
  - filtres action / entite
  - liste des logs
  - export JSON partageable

## Migration Supabase
- `supabase/migrations/20260216120000_audit_compliance.sql`
  - ajoute colonnes standardisees sur `audit_logs`
  - trigger de compatibilite bidirectionnelle
  - indexes
  - policies RLS (`read admin`, `insert member`)

