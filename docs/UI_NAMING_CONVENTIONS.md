# Conventions — Nommage UI / UX (Conforméo)

But: garder un mapping clair entre specs UX et code.

## Écrans (features)

Convention: `{Module}{Screen|Tab|Panel}`

Exemples:

- `ProjectDetailScreen`
- `ProjectOverviewTab`
- `TaskQuickCreateDrawer`
- `MediaDetailPanel`

## Références specs

Quand un écran correspond à une spec UX identifiée, ajouter le lien dans un commentaire en tête de fichier:

Exemple:

`// Spec: UX-01d-project-media`

IDs recommandés:

- `UX-01-projects` (Chantiers)
- `UX-01a-project-overview`
- `UX-01b-project-tasks`
- `UX-01c-project-plans`
- `UX-01d-project-media`
- `UX-01e-project-documents`
- `UX-01f-project-control`

## Composants Design System

Composants génériques uniquement, dans `/src/ui/components`:

- `Button`, `IconButton`, `Card`, `ListRow`, `TabsBar`, etc.

Règle: pas de suffixes métier dans le DS (ex: `TaskButton` n’a pas sa place dans le DS).
