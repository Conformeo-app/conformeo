# Sécurité

## Principes
- **Moindre privilège** (RBAC + scopes)
- **RLS partout** (org_id obligatoire)
- **Audit complet** (auth, flags, partages, exports)
- **Protection anti‑copie** (code, logique, données, outputs)

## Auth & sessions
- MFA requis pour rôles sensibles
- Tokens courts + refresh
- Révocation session (perte/vol)

## Données
- RLS strictes sur toutes les tables métiers
- Rate limiting & quotas anti‑scraping
- Journalisation des accès sensibles

## Logique métier
- Calculs sensibles côté Edge Functions
- Triggers/constraints Postgres pour cohérence
- Versioning des règles et calculs

## Outputs
- Signature probante + hash
- PDF lock après signature
- Watermark + metadata (org/chantier/date/auteur/id)

## Mobile
- Hermes + obfuscation build
- Pas de logs sensibles, debug off en prod
- Source maps non publiques

## Hardening opérationnel
- Voir `docs/SECURITY_HARDENING.md` pour:
  - checks runtime (`security.getBuildIntegrity`, `assertSecureEnvironment`)
  - configuration Metro/EAS
  - pipeline CI/CD de vérification
