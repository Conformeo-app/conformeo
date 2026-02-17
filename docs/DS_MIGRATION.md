# Migration vers le Design System (UX-DS-02)

Objectif: standardiser l’UI, réduire les bugs UI/UX, et garder une expérience iPad-first stable.

## Stratégie (ordre)

### Phase A — Infrastructure

- ThemeProvider global
- tokens sémantiques + aliases (compat)
- composants “states” (offline/error/empty/loading)

Statut: **fait** (socle en place).

### Phase B — Patterns navigation

- SplitView iPad sur écrans list/detail (Chantiers, Tâches, Docs, Preuves)
- DrawerPanel pour filtres/quick create
- TabsBar chantier (uniformisation)

Statut: **en cours** (SplitView/DrawerPanel/ TabsBar dispo; adoption progressive).

### Phase C — Composants critiques

- ListRow / SectionHeader systématiques
- Button/IconButton/FAB uniformisés
- Badges & Tags pour Risk/Sync/Quota/Safety

Statut: **en cours**.

### Phase D — Écrans prioritaires

- Dashboard
- Chantiers (list + detail + tabs)

Statut: **à dérouler** (migration par écran, sans refactor massif).

### Phase E — Reste

- Planning, Équipe, Entreprise, Compte

Statut: **à faire**.

## Règles d’exécution

- Petites PRs: 1 écran / 1 pattern à la fois.
- Zéro régression offline-first.
- Toute modif DS = ajout dans UI Gallery.
- Utiliser `PR_CHECKLIST.md` + UI review.
