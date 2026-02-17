# Guide — Ajouter un composant au Design System

Objectif: éviter la duplication et garder une UI stable.

## Règles

- Un composant DS doit être générique (pas de logique métier).
- Il doit utiliser **uniquement** les tokens (`useTheme()`).
- Il doit respecter accessibilité minimale (zones tactiles >= 44px si interactif).
- Il doit être visible dans la UI Gallery avant merge.

## Étapes

1. Créer le composant dans `/Users/michelgermanotti/Documents/Conformeo/src/ui/components`.
2. L’exporter dans `/Users/michelgermanotti/Documents/Conformeo/src/ui/components/index.ts`.
3. Ajouter une démo dans la UI Gallery:
   - Atoms / Inputs / Surfaces / Patterns / States
4. Si le composant introduit un nouvel état (pending/error/etc):
   - documenter la convention dans `/Users/michelgermanotti/Documents/Conformeo/docs/DESIGN_SYSTEM.md`
5. Si un nouveau token est nécessaire:
   - l’ajouter dans `/Users/michelgermanotti/Documents/Conformeo/src/ui/theme/tokens.ts`
   - éviter de renommer des clés existantes (compatibilité)

## Anti-patterns (refus PR)

- Couleurs hardcodées dans un écran (au lieu de tokens)
- Composant “duplicata” (même rôle qu’un composant DS existant)
- Composant non présent dans la UI Gallery
- Props trop spécifiques à un seul écran
