# Super Admin

## Objectif
Console multi-tenant dans l'app (MVP) pour support / incidents / actions admin, avec:
- Accès strict (allowlist `super_admins`)
- MFA obligatoire (AAL2) pour actions sensibles
- Audit total (`admin_audit`)
- Impersonation encadrée via `support_sessions` (traçable)

## Backend (Supabase)
- Migration: `supabase/migrations/20260215235000_super_admin.sql`
  - `super_admins` (allowlist)
  - `support_sessions`
  - `admin_audit`
- Migration: `supabase/migrations/20260218160000_rbac_org_roles_superadmin_support.sql`
  - `super_admin_permissions` (permissions SA: `sa.*`)
  - durcissement impersonation (support_sessions + `is_org_member` validant la session)
- Edge Function: `supabase/functions/super-admin`
  - Vérifie JWT + allowlist
  - Exige `aal2` (MFA) sauf pour `self`
  - Exécute les actions via `SUPABASE_SERVICE_ROLE_KEY` (serveur uniquement)
  - Actions impersonation:
    - `start_impersonation` → retourne `{ session, access_token, expires_at }`
    - `stop_impersonation`

## Client (Expo)
- Data: `/Users/michelgermanotti/Documents/Conformeo/src/data/super-admin`
- UI: `/Users/michelgermanotti/Documents/Conformeo/src/features/super-admin/SuperAdminScreen.tsx`
- Menu: module `superadmin` filtré si `admin.self().is_super_admin !== true`

## Notes
- Ne jamais embarquer `SUPABASE_SERVICE_ROLE_KEY` côté mobile.
- Pour utiliser la console, il faut ajouter le user dans `public.super_admins`.
- Pour `start_impersonation`, le backend doit avoir accès à `SUPABASE_JWT_SECRET` (secret Edge Function) afin de signer un JWT `role=authenticated` pour l’utilisateur cible.
- Un token d’impersonation est automatiquement invalidé si la session est stoppée (`ended_at`/`revoked_at`) ou expirée (contrôle dans `public.is_org_member()`).
