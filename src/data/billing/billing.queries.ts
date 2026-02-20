// Central place for shared billing constants.
// Keep in sync with backend entity names used by sync-engine/apply-operation.

export const BILLING_ENTITIES = [
  'billing_clients',
  'billing_quotes',
  'billing_invoices',
  'billing_line_items',
  'billing_payments'
] as const;

export type BillingEntity = (typeof BILLING_ENTITIES)[number];

