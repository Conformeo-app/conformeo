// Centralized route names (avoid scattered string literals).
// Keep values stable: changing them breaks deep links and persisted navigation state.

export const ROUTES = {
  DASHBOARD: 'Dashboard',
  PROJECTS: 'Projects',
  EQUIPMENT: 'Equipment',
  PLANNING: 'Planning',
  TEAM: 'Team',
  SECURITY: 'Security',
  ENTERPRISE: 'Enterprise',
  ACCOUNT: 'Account',
  QUICK_ACTIONS: 'QuickActions',
  MODULE_DISABLED: 'ModuleDisabled'
} as const;

export type DrawerRouteName = (typeof ROUTES)[keyof typeof ROUTES];

export function assertRoutesIntegrity() {
  if (!__DEV__) return;

  const values = Object.values(ROUTES);
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(`[routes] Doublons détectés dans ROUTES: ${values.join(', ')}`);
  }
}
