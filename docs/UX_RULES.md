# Conforméo — UX Rules (Global)

## Objectif

Garantir une UX cohérente, ultra rapide sur chantier, offline-first, et scalable sans devenir une usine à gaz.

---

## R1 — 3 taps max

Toute action terrain fréquente doit être faisable en ≤ 3 taps :

- créer une tâche
- ajouter une preuve
- épingler sur un plan
- générer un pack contrôle

---

## R2 — 3 actions primaires max par écran

Chaque écran doit avoir au maximum :

- 1 action principale
- 1 action secondaire
- 1 action d'urgence (optionnelle)

---

## R3 — Contexte avant module

Navigation logique :
Tableau de bord → Chantier → Action  
Jamais : module → module → module

---

## R4 — Offline transparent

Offline ne doit pas empêcher :

- lister
- créer
- consulter

Offline peut seulement différer :

- partage externe
- certaines validations serveur (timestamp certifié)

---

## R5 — Pending/Failed visibles et actionnables

Tout ce qui est :

- en attente (sync/upload)
- en échec

doit être :

- visible
- filtrable
- actionnable (retry / résoudre)

---

## R6 — Long tasks non bloquantes

Compression, uploads batch, exports :

- doivent tourner en job async
- ne bloquent jamais l’UI
- affichent une progression/état

---

## R7 — Patterns iPad/iPhone

- iPad : SplitView (liste/détail) par défaut
- iPhone : Stack + BottomSheet/Drawer
- pas de scroll imbriqué

---

## R8 — Erreurs actionnables

Chaque erreur doit contenir :

- cause probable
- solution
- CTA clair

Interdit : “Une erreur est survenue.”

---

## R9 — Filtres cohérents

Toujours :

- chips rapides
- drawer filtres avancés
- bouton reset

---

## R10 — Feature flags invisibles

Un module désactivé :

- n’apparaît pas dans le menu
- ne casse pas la navigation
- affiche un message seulement si accès via deep link

---

## R11 — Lisibilité terrain

- contraste AA minimum
- pas de texte trop clair
- zones tactiles min 44px
- densité pro mais respirante

---

## Définition du Done (UX)

Un écran est “Done” si :

- DS tokens utilisés
- offline safe validé
- pending/failed visibles
- action principale ≤ 3 taps
- perf OK (list/grid virtualisées)
