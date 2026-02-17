# PR Checklist — UI / UX (Conforméo)

Cette checklist est obligatoire pour toute PR qui touche l’UI.

## Design System

- [ ] J’utilise les tokens DS (`colors/spacing/radii/typography`) — pas de couleurs hardcodées.
- [ ] J’utilise les composants DS (`/src/ui`) — pas de composants dupliqués “vite fait”.
- [ ] J’ai ajouté/actualisé une démo dans la UI Gallery si j’ai créé/modifié un composant DS.

## iPad / iPhone

- [ ] iPad: layout list/detail en SplitView si l’écran s’y prête.
- [ ] iPhone: layout empilé (pas de side menu permanent), actions accessibles.
- [ ] Pas d’overflow texte (titres, badges, chips) en portrait/paysage.

## Offline-first

- [ ] Aucun écran ne dépend du réseau pour afficher les données (lecture locale).
- [ ] Les actions métier fonctionnent offline (création / modif) et reviennent proprement après relaunch.

## États & Erreurs

- [ ] `PENDING` / `FAILED` visibles, filtrables, actionnables (retry / voir détail).
- [ ] Les erreurs sont actionnables (cause + solution + CTA), pas de “erreur inconnue”.
- [ ] Les tâches lourdes (export/upload/compression) sont des jobs async (pas de freeze UI).

## Accessibilité & Ergonomie

- [ ] Zones tactiles >= 44px.
- [ ] Contraste lisible (AA minimum).
- [ ] 3 tailles de texte max par écran (éviter patchwork).
- [ ] 3 actions primaires max visibles par écran.

## Performance

- [ ] Listes / grilles virtualisées (FlashList/FlatList optimisée).
- [ ] Jamais d’images HD dans les listes (thumbnails only).
- [ ] Pas de scroll imbriqué (une zone scrollable par vue/panneau).

## Feature Flags & Quotas

- [ ] Modules désactivés via flags: invisibles et navigation non cassée.
- [ ] Quotas: blocage propre + message clair + solution.

## Validation

- [ ] Test manuel iPad + iPhone.
- [ ] Test manuel offline (mode avion).
