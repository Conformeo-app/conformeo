# Conforméo — Synthèse du Master Socle Immuable v2.4

## Objectif
Un seul document de référence servant de contrat technique long terme : zéro surprise terrain, zéro refactor structurel.

## Principes non négociables
- Offline-first (DB locale = source de vérité)
- UX sans effort (3 taps max, quick actions, favoris, modèles)
- Mobile terrain (iPad prioritaire, zones blanches, usage intensif)
- Performance médias (compression, WebP, thumbnails, upload background)
- Sécurité by design (RLS, RBAC, MFA, audit)
- Juridique probant (signature forte, PDF verrouillé)
- Gouvernance (feature flags, quotas, OTA, monitoring)

## Stack cible
- **Mobile** : Expo + React Native (TypeScript)
- **DB locale** : WatermelonDB ou RxDB
- **Sync** : outbox persistante + deltas + retries + idempotence
- **Backend** : Supabase (PostgreSQL + RLS) + Edge Functions
- **Médias** : Supabase Storage + WebP
- **Plans** : react-native-pdf + annotations
- **CI/CD** : EAS Build + EAS Update
- **Observabilité** : Sentry + audit + métriques quotas

## Modules clés
- Auth / rôles / MFA / sessions
- Orgs & admin
- Dashboard, search
- UX accelerators
- Offline-first + conflits
- Media pipeline
- Plans annotables
- Tâches smart
- Exports / DOE
- Signature probante
- Quotas / limits
- Feature flags
- Partage externe
- Multi-device
- Backup / restore
- Super-admin

## Anti-copie (addendum)
- Hermes + obfuscation + hygiène build
- Secret sauce côté serveur (Edge Functions + validation)
- RLS strict + RBAC + rate limiting + quotas
- Watermark + hash + PDF lock + metadata
