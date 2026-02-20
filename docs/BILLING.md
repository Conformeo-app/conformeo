# Module facturation (billing)

## Rôle
Fournir un module **offline-first** de gestion :
- Clients
- Devis
- Factures
- Paiements
- Export PDF (devis / facture)

Le module est **activable par organisation** via feature flags, et ne doit pas apparaître si désactivé.

## Activation (feature flags)
- Module key : `billing`
- Par défaut : **désactivé** (fallback local) tant que non activé via `OrgsAdmin -> Modules activés`.

## Permissions (RBAC)
Permissions backend (RLS via `public.has_permission(org_id, permission)`):
- `billing:read`
- `billing:write`
- `billing:payments:write` (paiements)
- `billing:export` (PDF) — côté client (garde UI), serveur couvert via `billing:*` si utilisé.

MVP rôles :
- `admin` / `manager` : `billing:*`
- `field` : `billing:read`

> Note : la sécurité réelle est côté DB (RLS). Le client ne fait que des **guards UX**.

## Schéma local (SQLite)
DB : `conformeo.db` (créé/maintenu par `src/data/billing/billing.ts`)

### Tables
`billing_clients`
- `id`, `org_id`, `name`, `email?`, `phone?`, `address_*?`, `vat_number?`
- `created_by`, `created_at`, `updated_at`, `deleted_at?`

`billing_quotes`
- `id`, `org_id`, `client_id`
- `number`, `status` (`draft|sent|accepted|rejected|expired`)
- `issue_date`, `valid_until?`
- `subtotal`, `tax_total`, `total`, `notes?`
- `created_by`, `created_at`, `updated_at`, `deleted_at?`

`billing_invoices`
- `id`, `org_id`, `client_id`, `quote_id?`
- `number`, `status` (`draft|issued|sent|paid|overdue|cancelled`)
- `issue_date`, `due_date?`
- `subtotal`, `tax_total`, `total`, `paid_total`, `currency`
- `created_by`, `created_at`, `updated_at`, `deleted_at?`

`billing_line_items`
- `id`, `org_id`, `parent_type` (`quote|invoice`), `parent_id`
- `label`, `quantity`, `unit_price`, `tax_rate`, `line_total`, `position`
- `created_at`, `updated_at`, `deleted_at?`

`billing_payments`
- `id`, `org_id`, `invoice_id`
- `amount`, `method` (`transfer|card|cash|check|other`), `paid_at`, `reference?`
- `created_by`, `created_at`, `updated_at`, `deleted_at?`

`billing_numbering_state`
- `org_id`, `kind` (`quote|invoice`)
- `prefix`, `next_number`, `end_number`, `updated_at`

## Offline-first + Sync
- Toutes les écritures passent par SQLite (source de vérité).
- Chaque mutation **enfile** une opération persistante via `offlineDB.enqueueOperation()` :
  - entities : `billing_clients`, `billing_quotes`, `billing_invoices`, `billing_line_items`, `billing_payments`
  - types : `CREATE|UPDATE|DELETE`
- Le `sync-engine` pousse ces opérations vers Supabase :
  - Edge Function `apply-operation` (si dispo)
  - Fallback RPC `public.apply_sync_operation(...)`
- Côté serveur, `apply_sync_operation` :
  - vérifie membership org
  - garantit l’idempotence (`idempotency_keys`)
  - matérialise les entités billing dans les tables dédiées
  - écrit dans `sync_shadow` + `audit_logs`

## Numérotation (anti-collision)
Objectif : éviter les collisions entre devices offline.

Stratégie MVP :
1. Online (si possible) : réservation d’une **plage** via RPC `public.reserve_billing_numbers(org_id, kind, count)`
2. Local : stockage de la plage dans `billing_numbering_state`, allocation séquentielle.
3. Offline dur : fallback numéro temporaire `TEMP-UUID` (autorisé pour `draft` uniquement)
   - garde-fou : impossible de passer un devis/facture `TEMP-*` en statut non-brouillon tant que la réservation n’a pas été faite (doit repasser en ligne).

Règles MVP (conformes au produit) :
- Devis : le numéro “officiel” est fixé au passage `status = sent`.
- Facture : le numéro “officiel” est fixé au passage `status = issued`.
- Format : `DEV-{YEAR}-{increment}` et `FAC-{YEAR}-{increment}` (préfixes personnalisables côté org, année incluse).

## Export PDF (MVP)
- Génération locale via `expo-print` + stockage dans `FileSystem.documentDirectory/billing_exports/`
- Partage via `expo-sharing` (si disponible)
- Audit local : `billing.invoice.export_pdf` / `billing.quote.export_pdf`

Implémentation : `src/data/billing/pdf.ts`

## Navigation & Écrans
Décision UX : pas de 9e entrée Drawer → Facturation est accessible depuis **Entreprise → Facturation**.

Écrans (Enterprise stack) : `src/features/billing/*`
- `BillingHomeScreen`
- Clients : `ClientsListScreen`, `ClientDetailScreen`, `ClientEditScreen`
- Devis : `QuotesListScreen`, `QuoteDetailScreen`, `QuoteEditScreen`
- Factures : `InvoicesListScreen`, `InvoiceDetailScreen`, `InvoiceEditScreen`
- Paiements : `PaymentCreateModal`

## Scénarios manuels (acceptance)
1. Activer `billing` (OrgsAdmin → Modules) → entrée “Facturation” visible dans Entreprise.
2. Créer un client offline → visible dans liste + détail après relance app.
3. Créer un devis offline (lignes) → visible + modifiable, outbox PENDING.
4. Passer devis en “Envoyé” :
   - OK si numéro réservé
   - KO si `TEMP-*` (message explicite).
5. Convertir devis → facture.
6. Passer la facture en “Émise” (`issued`) :
   - génère un numéro officiel
7. Envoyer la facture (`sent`) + ajouter paiement (manager/admin) → `paid_total` mis à jour, statut `paid` si total atteint.
8. Export PDF facture → fichier généré + partage.
9. Revenir online → sync sans duplication (idempotence), tables Supabase à jour.
10. User sans `billing:read` : écran refuse l’accès (UX guard) + RLS côté serveur.
