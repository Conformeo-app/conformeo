# UI Shell Principal (iPad + iPhone)

## Objectif

Le **Shell** fournit une navigation hiérarchique stable et offline-safe :

- iPad : side menu **permanent**
- iPhone : drawer **replié** (bouton "Menu")
- top bar contextuelle (org + chantier + sync + accès recherche/actions)
- masquage dynamique des sections via **feature flags**
- contexte global (orgId / projectId) partagé aux écrans

## Architecture navigation

Root (Drawer)
- `Dashboard` (Stack)
- `Projects` (Stack)
  - `ProjectsList`
  - `ProjectDetail` (Top Tabs)
    - `OverviewTab`
    - `TasksTab` (si module `tasks`)
    - `PlansTab` (si module `plans`)
    - `MediaTab` (si module `media`)
    - `DocumentsTab` (si module `documents`)
    - `ControlTab` (si module `control`)
  - `WasteVolume` (si module `waste`, accessible depuis l’onglet Synthèse)
  - `Carbon` (si module `carbon`, accessible depuis l’onglet Synthèse)
  - `Exports` (si module `exports`, accessible depuis l’onglet Synthèse)
- `Equipment` (Stack) (si module `equipment`)
- `Planning` (Stack) (si module `planning`)
- `Team` (Stack) (si module `orgs`)
- `Security` (Stack) (si module `security|search|offline|audit|conflicts|superadmin`)
  - `SecurityHub` (shell)
  - `SecuritySettings` (si module `security`)
- `Enterprise` (Stack) (si module `orgs|company|offers|governance|backup`)
  - `EnterpriseHub` (shell)
  - `OrgAdmin` (si module `orgs`)
- `Account` (Stack)
- `QuickActions` (hidden, accessible via top bar)

## Feature flags

Source : `feature_flags_cache` (offline) + refresh Supabase.

Logique :

- si un module est désactivé, sa section/son onglet n’est pas monté → **non accessible**
- fallback : si aucune ligne de flag n’existe, le module est considéré **activé** (MVP)

Implémentation : `/Users/michelgermanotti/Documents/Conformeo/src/navigation/EnabledModulesProvider.tsx`

## Contexte global (org/chantier)

Le contexte global est stocké dans un store local (mémoire) :

- `orgId` : alimenté par `useAuth().activeOrgId`
- `projectId` : alimenté lors de la sélection d’un chantier (`ProjectsList`) ou à l’ouverture de `ProjectDetail`

API store :
- `/Users/michelgermanotti/Documents/Conformeo/src/navigation/contextStore.ts`

## API navigation (raccourcis)

Fichier : `/Users/michelgermanotti/Documents/Conformeo/src/navigation/navigation.ts`

Exemples :

```ts
import { navigation } from '../navigation/navigation';

navigation.navigate('Projects');
navigation.navigate('ProjectDetail', { projectId: 'chantier-paris-12' });
navigation.navigate('ProjectDetail', { projectId: 'chantier-paris-12', tab: 'Tasks' });

navigation.setContext({ projectId: 'chantier-paris-12' });
const ctx = navigation.getCurrentContext();
```

Notes :
- `ProjectDetail` est un **raccourci** : en interne on navigate vers `Projects -> ProjectDetail`.

## Fichiers clés

- Navigation root : `/Users/michelgermanotti/Documents/Conformeo/src/navigation/AppNavigator.tsx`
- Drawer UI : `/Users/michelgermanotti/Documents/Conformeo/src/navigation/ShellDrawerContent.tsx`
- Header UI : `/Users/michelgermanotti/Documents/Conformeo/src/navigation/ShellHeader.tsx`
- Écrans chantiers : `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectsListScreen.tsx`, `/Users/michelgermanotti/Documents/Conformeo/src/features/projects/ProjectDetailScreen.tsx`
