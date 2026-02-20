# Décisions d’architecture

## Choix validés
- **App** : Conforméo
- **Mobile** : Expo + React Native (TypeScript) + Hermes
- **DB locale** : WatermelonDB (cible) — performances offline élevées
- **Backend** : Supabase (Postgres + RLS) + Edge Functions
- **Sync** : outbox persistante, deltas, retries, idempotence serveur
- **CI/CD** : EAS Build + EAS Update (OTA JS uniquement)
- **Facturation (MVP)** :
  - Accès UI : sous-module dans **Entreprise** (pas de 9e entrée Drawer).
  - Numérotation : réservation de **plage** via RPC `reserve_billing_numbers` + état local `billing_numbering_state`.
  - Fallback offline : numéros `TMP-*` autorisés uniquement en `draft`.

## Choix en attente
- **Bundle ID** : à définir (placeholder en attendant)
- **Supabase** : projet non créé (URL + anon key à fournir)
- **Chiffrement DB locale** : decision validee en 2 etapes
  - Etape 1 (maintenant) : `expo-secure-store` pour secrets + session non persistante
  - Etape 2 (post-MVP) : SQLCipher via build natif EAS pour chiffrement complet SQLite

## Rationale
- WatermelonDB maximise la perf en lecture/écriture et supporte des volumes élevés.
- Supabase offre RLS et Edge Functions, essentiels pour la sécurité et l’anti‑copie.
- OTA permet des correctifs rapides sans repasser par les stores (limité aux changements JS).
- Le chiffrement complet SQLite en Expo demande une couche native; la strategie en deux temps evite de bloquer la livraison.
