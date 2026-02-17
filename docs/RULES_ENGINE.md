# MODULE rules-engine (évolution)

## Objectif
Remplacer les règles mots-clés v0 (hardcodées) par un moteur déclaratif extensible :
- règles au format JSON
- exécution 100% locale (offline-first)
- priorités
- journal d'exécution (local)
- évolutif vers remote config (v1)

## Fichiers
- Types: `/Users/michelgermanotti/Documents/Conformeo/src/data/rules-engine/types.ts`
- Implémentation: `/Users/michelgermanotti/Documents/Conformeo/src/data/rules-engine/rulesEngine.ts`
- Règles par défaut: `/Users/michelgermanotti/Documents/Conformeo/src/data/rules-engine/defaultRules.json`

## API
- `rules.evaluate(entity, context)`
- `rules.list()`
- `rules.update(rule)`
- `rules.setContext({ org_id, user_id })`

## Format de règle (JSON)
Exemple (task):
```json
{
  "id": "task.epi",
  "name": "epi",
  "entity": "TASK",
  "enabled": true,
  "priority": 90,
  "condition": {
    "kind": "KEYWORDS_ANY",
    "fields": ["title", "description", "tags"],
    "keywords": ["epi", "casque"]
  },
  "actions": [
    { "kind": "ADD_TAG", "value": "safety" },
    { "kind": "SUGGEST", "value": "Contrôler le port des EPI" }
  ]
}
```

## Journal d'exécution
Table SQLite locale: `rules_engine_journal`.
- un événement est écrit lorsqu'au moins une règle match
- contenu stocké: règles matchées + actions + durée + hash de contexte

## Intégration actuelle
- Les tâches (`tasks-smart`) appellent `rules.evaluate('TASK', ...)` et traduisent les actions en:
  - tags (`ADD_TAG`)
  - suggestions (`SUGGEST`, `ADD_REMINDER`)
