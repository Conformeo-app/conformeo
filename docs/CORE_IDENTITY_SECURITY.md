# Core Identity Security

Module: `/Users/michelgermanotti/Documents/Conformeo/src/core/identity-security`

## Scope

- Auth Supabase (email/password + magic link)
- Profil utilisateur par organisation
- RBAC local + fallback permissions par role
- MFA TOTP pour admins
- Audit sessions multi-appareils + révocation
- Stockage token sécurisé via `expo-secure-store`

## API

### auth

- `auth.signIn(email, password)`
- `auth.signInWithMagicLink(email)`
- `auth.signOut()`
- `auth.getSession()`
- `auth.refreshSession()`

### identity

- `identity.getProfile()`
- `identity.updateProfile(patch)`

### rbac

- `rbac.getRole()`
- `rbac.listPermissions()`
- `rbac.hasPermission(permission, ctx?)`
- `rbac.clearCache()`

### mfa

- `mfa.enrollTOTP()`
- `mfa.verify(code)`
- `mfa.disable()`
- `mfa.hasVerifiedTotp()`

### sessions

- `sessions.touchCurrent(deviceLabel?)`
- `sessions.list()`
- `sessions.revoke(sessionId)`
- `sessions.isCurrentRevoked()`
- `sessions.getCurrentSessionId()`

## Intégration UI

- Enrôlement MFA admin bloquant:
  - `/Users/michelgermanotti/Documents/Conformeo/src/features/auth/AdminMfaEnrollmentScreen.tsx`
- Ecran sécurité enrichi:
  - `/Users/michelgermanotti/Documents/Conformeo/src/features/security/SecurityScreen.tsx`
- Provider auth étendu:
  - `/Users/michelgermanotti/Documents/Conformeo/src/core/auth/AuthProvider.tsx`

## Migration SQL

- `/Users/michelgermanotti/Documents/Conformeo/supabase/migrations/20260211183000_core_identity_security.sql`

Ajouts:

- `roles`
- `role_permissions`
- `sessions_audit`
- extension `profiles` (`org_id`, `phone`, `role`, `updated_at`)
- policies RLS dédiées
- helper SQL `is_admin_mfa_required(target_org uuid)`

## Scénarios de test manuel

1. User org1 ne voit jamais org2
- Connecter user A org1
- Vérifier `sessions.list()` et lectures `roles/role_permissions`
- Attendu: seulement org1 (RLS)

2. Admin sans MFA
- Connecter admin sans facteur vérifié
- Attendu: écran `AdminMfaEnrollmentScreen` bloquant

3. Enrôlement MFA
- `enrollTOTP` puis `verify`
- Attendu: accès shell principal débloqué

4. Révocation session
- Depuis écran sécurité: révoquer session courante
- Attendu: logout auto (heartbeat du provider)

5. Changement permissions
- Modifier `role_permissions` en base
- Appeler `refreshAuthorization`
- Attendu: permissions mises à jour immédiatement
