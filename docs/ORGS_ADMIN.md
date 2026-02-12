# ORGS ADMIN

Module: `orgs-admin`

## Role

Le module gere l'espace entreprise:
- organisation courante (settings)
- membres (invitation, role, suppression)
- equipes (creation, affectation)
- activation modules via feature flags

Contrainte cle:
- multi-tenant strict (`org_id`)
- ecriture reservee admin/owner
- cache local en lecture pour mode offline

## API TypeScript

Source: `/Users/michelgermanotti/Documents/Conformeo/src/data/orgs-admin/orgsAdmin.ts`

- `org.getCurrent(preferredOrgId?)`
- `org.updateSettings(patch, preferredOrgId?)`
- `members.invite(email, role, preferredOrgId?)`
- `members.list(preferredOrgId?)`
- `members.remove(userId, preferredOrgId?)`
- `members.changeRole(userId, role, preferredOrgId?)`
- `teams.create(name, preferredOrgId?)`
- `teams.list(preferredOrgId?)`
- `teams.addMember(teamId, userId, preferredOrgId?)`
- `teams.removeMember(teamId, userId, preferredOrgId?)`
- `modules.listEnabled(preferredOrgId?)`
- `modules.setEnabled(key, enabled, preferredOrgId?)`

## Cache offline lecture

Stockage local SQLite (`conformeo.db`):
- table `orgs_admin_cache`
- cles de cache: `org:{orgId}:current|members|teams|modules`
- strategie: remote->cache, fallback cache si le remote echoue

## Backend SQL / RLS

Migration: `/Users/michelgermanotti/Documents/Conformeo/supabase/migrations/20260211193000_orgs_admin.sql`

Ajouts principaux:
- colonnes `organizations`: `siret`, `address`, `settings_json`, `updated_at`
- colonnes `org_members`: `status`, `invited_at`, `joined_at`, `invited_by`, `invited_email`
- tables: `org_member_invites`, `teams`, `team_members`
- policies RLS: lecture membre, ecriture admin
- fonctions RPC:
  - `accept_pending_org_invites()`
  - `list_org_members(uuid)`
  - `invite_org_member(uuid,text,text)`
  - `set_org_member_role(uuid,uuid,text)`
  - `remove_org_member(uuid,uuid)`
  - `update_org_settings(uuid,text,text,text,jsonb)`
  - `create_team(uuid,text)`
  - `add_team_member(uuid,uuid)`
  - `remove_team_member(uuid,uuid)`
  - `set_feature_flag(uuid,text,boolean,jsonb)`

Audit admin:
- insertions dans `audit_logs` pour invite/role/remove/settings/team/flags

## UI

Ecran: `/Users/michelgermanotti/Documents/Conformeo/src/features/orgs/OrgsAdminScreen.tsx`

Sections:
- Organisation
- Membres
- Equipes
- Modules actives

## Validation faite

- `npm run -s typecheck` OK
- `npx expo export --platform ios --platform android` OK
- migration SQL appliquee sur Supabase via `psql` (objets verifies)

## Note invitation

Le provider auth appelle `accept_pending_org_invites()` a l'ouverture de session:
- fichier: `/Users/michelgermanotti/Documents/Conformeo/src/core/auth/AuthProvider.tsx`
- effet: un utilisateur invite est rattache a son org automatiquement apres connexion
