# Module tasks-smart

## Rôle
Créer, enrichir et suivre les tâches chantier en offline-first, avec preuves médias et dictée vocale.

## API publique
- `tasks.create(data)`
- `tasks.update(id, patch)`
- `tasks.setStatus(id, status)`
- `tasks.softDelete(id)`
- `tasks.getById(id)`
- `tasks.listByProject(projectId, filters?)`
- `tasks.addMedia(taskId, mediaContext)`
- `tasks.listMedia(taskId)`
- `tasks.addComment(taskId, text)`
- `tasks.listComments(taskId)`
- `tasks.runKeywordRules(task)`

## Schéma local
Table `tasks`:
- `id`, `org_id`, `project_id`, `title`, `description`
- `status`, `priority`, `due_date`, `assignee_user_id`, `created_by`
- `tags_json`, `suggestions_json`
- `created_at`, `updated_at`, `deleted_at`, `last_transcript`

Table `task_comments`:
- `id`, `task_id`, `text`, `created_by`, `created_at`

## Offline-first
- Source de vérité locale: SQLite (`conformeo.db`).
- Chaque mutation tâche/commentaire pousse une opération persistante dans `operations_queue` via `offlineDB.enqueueOperation`.
- Aucun appel backend direct dans le module.

## Règles mots-clés v0
- Config locale: `src/data/tasks/keywordRules.json`.
- Moteur: `src/data/tasks/rules.ts`.
- Actions supportées:
  - `ADD_TAG`
  - `SUGGEST`
  - `ADD_REMINDER`
- Règles appliquées sur `title + description + tags`.

## Dictée
- Hook: `src/features/tasks/useTaskDictation.ts`.
- Permission micro + speech recognizer demandée.
- Fallback si module indisponible (build Expo Go / device non compatible).
- Texte transcrit injecté localement dans titre/description/commentaire.

## UX / perf
- Écran unique orienté terrain:
  - création rapide (titre + statut + bouton preuve)
  - liste paginée
  - détail sélectionné (preuves/commentaires/suggestions)
- Pagination par défaut: 25 tâches.
- Limite org offline: 5000 tâches actives.
- Preuves affichées en thumbnails, jamais HD en liste.

## Scénarios manuels
1. Créer 30 tâches offline + preuves photo -> visibles immédiatement.
2. Fermer/relancer l’app -> tâches, commentaires et preuves conservés.
3. Activer dictée -> texte injecté puis persisté.
4. Créer une tâche avec mots-clés (`soudure`, `EPI`, `gravats`) -> tags/suggestions auto.
5. Revenir online -> sync-engine traite outbox sans bloquer l’UI.
