# Module company-hub

## Rôle
Espace entreprise (scope `COMPANY`) pour:
- bibliothèque documentaire interne structurée par sections
- registre certifications + suivi des échéances
- checklist locaux (incendie / sécurité)

## API
- `companyHub.setContext({ org_id, user_id, role })`
- `companyHub.listSections()`
- `companyHub.listDocuments(sectionKey)`
- `companyHub.addDocument(sectionKey, documentMeta, fileContext?)`
- `companyHub.certs.create(meta)`
- `companyHub.certs.update(id, patch)`
- `companyHub.certs.list()`
- `companyHub.certs.getExpiring(days)`
- `companyHub.checks.get()`
- `companyHub.checks.toggle(key, checked)`
- `companyHub.checks.setComment(key, text)`

Alias exportés:
- `hub` pour sections/documents
- `certs` pour certifications
- `checks` pour checklist locaux

## Schéma local
### `company_sections`
- `id`, `org_id`, `key`, `label`, `sort_order`, `created_at`
- unique `(org_id, key)`

### `certifications`
- `id`, `org_id`, `name`, `issuer`
- `valid_from`, `valid_to`, `doc_id`
- `status` (`VALID|EXPIRING|EXPIRED|UNKNOWN`)
- `created_at`, `updated_at`, `created_by`

### `company_checks`
- `id`, `org_id`, `key`, `label`
- `checked`, `comment`
- `updated_at`, `updated_by`
- unique `(org_id, key)`

## Règles rôle
- écriture autorisée uniquement `ADMIN` / `MANAGER`
- `FIELD` = lecture seule

## Intégration documents
- `addDocument` crée un document `scope=COMPANY`
- tags auto: `company_hub`, `company_section:<key>`
- `doc_type=CERT` est normalisé vers `OTHER` avec tag `company_cert`
- version fichier ajoutée via `documents.addVersion(...)`

## Offline-first
- aucune dépendance réseau pour lecture/écriture locale
- mutations certifications/checks sérialisées dans outbox:
  - `certifications`
  - `company_checks`

## Alertes dashboard
Le dashboard calcule un compteur de certifications à échéance <= 60 jours et génère l’alerte:
- code `CERTIFICATIONS_EXPIRING`
