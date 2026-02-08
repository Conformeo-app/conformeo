# Conformeo

Socle mobile iPad-first pour operations terrain, avec priorite sur:
- securite (RLS, audit, moindre privilege)
- performance (offline-first, outbox locale, pipeline media)
- UX operationnelle (actions rapides, ecrans orientés execution)

## Stack
- Expo SDK 54 + React Native 0.81 + TypeScript
- Supabase (PostgreSQL + RLS + Edge Functions)
- Stockage local: SQLite (outbox persistante)

## Prerequis
- Node.js 22+
- npm 11+

## Demarrage
1. Installer les deps:
   `npm install`
2. Copier les variables d env:
   `cp .env.example .env`
3. Lancer l app:
   `npm run start`

## Variables d environnement
Definir dans `.env`:
- `EXPO_PUBLIC_ENV=development`
- `EXPO_PUBLIC_SUPABASE_URL=...`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY=...`

Sans variables Supabase, l app demarre en mode local et signale l absence de backend.

## Base Supabase
- Migrations: `supabase/migrations/`
- Guide: `supabase/README.md`

## Chiffrement local recommande
Strategie conseillee:
1. Maintenant: donnees sensibles en `expo-secure-store`, session non persistante.
2. Phase suivante: SQLCipher via build natif (EAS dev client / release) pour chiffrement DB complet.

Ce compromis permet de livrer vite sans bloquer le socle offline.
# conformeo
