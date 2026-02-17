# Conforméo — PR Checklist (UI/UX)

## Obligatoire (bloquant)

- [ ] Utilise uniquement les tokens DS (`theme.ts`) — pas de couleurs hardcodées
- [ ] Utilise les composants DS (`/src/ui`) — pas de composants duplicats
- [ ] Offline-first validé (lister/consulter/créer sans réseau)
- [ ] Pending/failed visibles et actionnables (retry/résoudre)
- [ ] 3 taps max pour l’action principale
- [ ] 3 actions primaires max sur l’écran
- [ ] Erreurs actionnables (cause + solution + CTA)
- [ ] Feature flags respectés (module off = invisible, pas d’écran cassé)

## iPad / iPhone

- [ ] iPad : SplitView si liste/détail
- [ ] iPhone : navigation stack propre (pas de layout cassé)
- [ ] Pas de scroll imbriqué

## Performance

- [ ] Listes/grilles virtualisées si volumineuses
- [ ] Aucune image HD en liste/grille (thumb uniquement)
- [ ] Chargements async non bloquants

## Accessibilité

- [ ] Taille tactile min 44px
- [ ] Contraste lisible (pas de gris trop clair)

## Qualité

- [ ] Ajout/maj dans UI Gallery si nouveau composant
- [ ] Screenshots (si changement UI notable)

