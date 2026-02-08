# Supabase setup

## Pre-requis
- Projet Supabase cree
- CLI Supabase installee et connectee

## Variables mobile
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Migrations
1. Lier le projet: `supabase link --project-ref <project_ref>`
2. Appliquer le schema: `supabase db push`

## Flux auth minimal
1. Creer un utilisateur email/password dans Supabase Auth (Dashboard ou app).
2. Se connecter dans l'app.
3. Si aucun membership n'existe, l'app propose `Creer l'organisation`.
4. L'app appelle `bootstrap_organization(org_name)` pour creer atomiquement:
   - une ligne `organizations`
   - une ligne `org_members` en role `owner`.

## Flux sync actif
- Le client mobile appelle l'Edge Function `apply-operation`.
- La fonction tourne avec le token utilisateur (pas de service role), puis delegue a la RPC `apply_sync_operation`.
- La RPC verifie auth + membership org + idempotence.
- Entite supportee actuellement: `inspection`.

## Fonctions Edge
- `apply-operation`: active.
- `sync-operation`: deprecated (retourne 410).

## Storage medias
- Bucket recommande: `conformeo-media`.
- Le module mobile uploade les fichiers optimises + thumbnails en background via le sync-engine.

## Notes securite
- Les policies RLS imposent un membership via `org_members`.
- Le bootstrap owner n'est autorise que pour une org sans membre existant.
- Les actions de sync ecrivent dans `audit_logs`.
