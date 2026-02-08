# Architecture

## Vue d’ensemble
- **Client mobile (iPad-first)**
- **DB locale** : source de vérité en lecture/écriture
- **Sync** : asynchrone, résiliente, idempotente
- **Backend** : Supabase (PostgreSQL + RLS) + Edge Functions

## Flux de données
1. Écriture locale -> outbox (opération UUID)
2. Sync -> envoi des opérations -> application serveur idempotente
3. Réponse serveur -> deltas -> mise à jour locale
4. Gestion des conflits (LWW v0 puis merge par champs v1)

## Modules
- Core identity & security
- Admin orgs & modules
- Dashboard & search
- Offline-first + conflits
- Media pipeline
- Plans annotables
- Signature probante
- Quotas / feature flags
- Partage externe
- Multi-device
- Backup / restore

## Gouvernance
- Feature flags par org
- Limites & quotas
- Observabilité (Sentry + audit)
- Releases OTA contrôlées
