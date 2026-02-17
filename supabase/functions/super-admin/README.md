# Super Admin (Edge Function)

Edge Function `super-admin` : console multi-tenant (support, audit, actions admin).

## Sécurité
- Auth obligatoire (JWT utilisateur via header `Authorization`).
- Vérification `super_admins` (allowlist).
- MFA obligatoire (`aal2`) pour toutes les actions sensibles.
- Aucune `service_role_key` dans l'app mobile : uniquement côté Edge Function.

## Actions (MVP)
- `self`
- `list_orgs`
- `list_org_users`
- `start_support_session` / `stop_support_session`
- `revoke_user_sessions`
- `reset_user_mfa`

