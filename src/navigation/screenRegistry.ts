export type ScreenKey =
  | 'DASHBOARD'
  | 'PROJECTS_LIST'
  | 'EQUIPMENT'
  | 'PLANNING'
  | 'TEAM'
  | 'SECURITY_HUB'
  | 'ENTERPRISE_HUB'
  | 'BILLING_HOME'
  | 'BILLING_CLIENTS'
  | 'BILLING_QUOTES'
  | 'BILLING_INVOICES'
  | 'ACCOUNT'
  | 'ENTERPRISE_ORGS_ADMIN'
  | 'MODULE_DISABLED';

export type ScreenComponent = { screenKey?: ScreenKey };

export function assertScreenKey(component: unknown, expected: ScreenKey, where: string) {
  if (!__DEV__) return;

  const actual = (component as ScreenComponent | null | undefined)?.screenKey;
  if (actual !== expected) {
    throw new Error(`[nav] Wiring invalide: ${where} doit rendre screenKey=${expected}. Reçu: ${String(actual)}`);
  }
}
