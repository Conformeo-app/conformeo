# UX-01b — Onglet Taches (Chantier)

## Objectif

Permettre la gestion des taches chantier en mode terrain :

- creation ultra rapide (titre + statut + option photo)
- dictée vocale (si disponible sur le build)
- suggestions "smart" (mots-cles) visibles mais non destructives
- preuves liees (photos / fichiers) via media-pipeline
- filtres simples mais efficaces
- offline-first total + perfs correctes sur gros volume

## Fichiers

- UI onglet : `/Users/michelgermanotti/Documents/Conformeo/src/features/tasks/ProjectTasksTab.tsx`
- Drawer creation : `/Users/michelgermanotti/Documents/Conformeo/src/features/tasks/TaskQuickCreateDrawer.tsx`
- Panel detail : `/Users/michelgermanotti/Documents/Conformeo/src/features/tasks/TaskDetailPanel.tsx`
- Hook dictée : `/Users/michelgermanotti/Documents/Conformeo/src/features/tasks/useTaskDictation.ts`

Data layer :

- tasks-smart : `/Users/michelgermanotti/Documents/Conformeo/src/data/tasks/tasksSmart.ts`
- rules keyword : `/Users/michelgermanotti/Documents/Conformeo/src/data/tasks/keywordRules.json`

## UX (MVP)

### Layout

- iPad (largeur >= ~980px) : split view
  - gauche : liste + filtres
  - droite : detail tache
- iPhone : liste, detail en modal slide-in

### Filtres rapides

- Statuts : Tous / A faire / En cours / Bloquees / Terminees
- Toggle : Securite (tags `safety` ou `permis_feu`)
- Preuves : Toutes / Avec preuves / Sans preuves
- Recherche locale : titre + description (debounce)

### Creation rapide

Drawer "Nouvelle tache" :

- titre obligatoire
- statut
- toggle securite
- dictee titre (si dispo)
- "Creer" / "Creer + photo"

Empty state :

- "Creer tache"
- "Ajouter une preuve" (cree une tache "Preuve chantier" + capture photo)

### Liste taches

Chaque item affiche :

- statut
- titre + tags
- compteur preuves liees
- badge safety
- badge sync (OK / SYNC / SYNC ERR)
- avatar initiales (MVP sur `assignee_user_id`)

### Detail tache

- changement statut + priorite
- assignation "Me l'assigner"
- description + dictee + sauvegarde
- tags csv + sauvegarde
- preuves (grille thumbs) + ajout photo/import
- commentaires v0 + dictee
- suggestions v0 (bandeau) + "Ignorer"

## Notes techniques

- Offline-first : aucune dependance reseau.
- Perfs : pagination (PAGE_SIZE=25), liste virtualisee (FlatList).
- Sync badges :
  - `operations_queue` (PENDING/FAILED) pour `entity='tasks'`
  - `sync_conflicts` (OPEN) pour `entity='tasks'`
- Avec/Sans preuves : filtre SQL via `EXISTS` sur `media_assets` (index `task_id`).
- Dismiss suggestion : persiste via `dismissed_at` dans `suggestions_json` (pas de table additionnelle).

