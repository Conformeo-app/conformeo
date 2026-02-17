# Process — UI Review (Conforméo)

But: empêcher les régressions UI/UX et garantir offline-first + performance iPad.

## Quand faire une UI Review

Obligatoire si la PR touche:

- navigation / shell
- écrans chantier (Overview/Tasks/Media/Documents/Control)
- listes/grilles (perf)
- sync/pending/error states
- composants DS (`/src/ui`)

## Déroulé (10 minutes)

1. Lire `PR_CHECKLIST.md` et cocher point par point.
2. Ouvrir la UI Gallery:
   - Sécurité → DEV → UI Gallery (build dev)
3. Vérifier iPad:
   - paysage + portrait
   - SplitView / DrawerPanel / TabsBar (Patterns)
4. Vérifier iPhone:
   - navigation empilée
   - actions accessibles
5. Vérifier offline:
   - mode avion
   - création / modification locales OK
   - états `PENDING/FAILED` visibles
6. Vérifier perf:
   - listes/grilles virtualisées
   - thumbnails only
   - pas de scroll imbriqué

## Critères de blocage (fail fast)

- écran inutilisable offline (dépendance réseau obligatoire)
- action terrain > 3 taps sans justification
- liste/grille sans virtualisation (dataset réel)
- images HD en liste
- erreurs non actionnables (pas de CTA)
- module désactivé via flag mais visible / navigation cassée
