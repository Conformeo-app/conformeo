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
- Edge Function: `supabase/functions/super-admin`
  - Vérifie JWT + allowlist
  - Exige `aal2` (MFA) sauf pour `self`
  - Exécute les actions via `SUPABASE_SERVICE_ROLE_KEY` (serveur uniquement)

## Client (Expo)
- Data: `/Users/michelgermanotti/Documents/Conformeo/src/data/super-admin`
- UI: `/Users/michelgermanotti/Documents/Conformeo/src/features/super-admin/SuperAdminScreen.tsx`
- Menu: module `superadmin` filtré si `admin.self().is_super_admin !== true`

## Notes
- Ne jamais embarquer `SUPABASE_SERVICE_ROLE_KEY` côté mobile.
- Pour utiliser la console, il faut ajouter le user dans `public.super_admins`.

