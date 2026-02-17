# UI Gallery (DEV) — Comment l’utiliser

La UI Gallery est la référence unique pour valider le Design System Conforméo.

Objectifs:

- vérifier cohérence visuelle (tokens + composants)
- vérifier accessibilité (zones tactiles, lisibilité)
- vérifier patterns iPad/iPhone (SplitView, DrawerPanel)
- vérifier états offline/pending/quota/conflits

## Accès

Disponible en build dev (`__DEV__`) et accessible aux super-admins si activé dans la navigation.

Chemin:

`Sécurité` → `Outils internes` → `UI Gallery`

## Structure

- UI Gallery (home)
  - Atoms
  - Inputs
  - Surfaces
  - Patterns
  - States

## Playground (states)

La page d’accueil expose des toggles qui pilotent la page `States`:

- Offline (true/false)
- Pending ops (nombre)
- Conflits (nombre)
- Quota (OK/WARN/CRIT)

Ces états sont en mémoire (aucune persistance, zéro réseau).

API interne:

- `gallery.setOffline(true|false)`
- `gallery.setPendingOps(n)`
- `gallery.setConflicts(n)`
- `gallery.setQuotaLevel("OK"|"WARN"|"CRIT")`

Implémentation: `/Users/michelgermanotti/Documents/Conformeo/src/features/security/ui-gallery/galleryState.ts`

## Utilisation en revue UI (check rapide)

1. Ouvrir `Patterns` en iPad paysage + iPhone.
2. Activer `Offline` + mettre `Pending ops` > 0.
3. Passer sur `States` et vérifier:
   - offline banner visible
   - indicateur pending visible
   - conflits visibles + message actionnable
4. Vérifier `Atoms/Inputs` (zones tactiles >= 44px, contraste, typo).

## Ajout d’un nouveau composant DS

Règle: tout nouveau composant doit être visible dans la UI Gallery avant merge.

- ajouter le composant dans `/Users/michelgermanotti/Documents/Conformeo/src/ui/components`
- l’exporter dans `/Users/michelgermanotti/Documents/Conformeo/src/ui/components/index.ts`
- ajouter une section dans une page de la UI Gallery (Atoms/Inputs/Surfaces/Patterns/States)
