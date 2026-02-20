import type { ModuleKey } from '../core/modules';
import type { IconName } from '../ui/components/Icon';
import { ROUTES, type DrawerRouteName } from './routes';

export type ReleaseState = 'ALPHA' | 'BETA' | 'READY';

export type DrawerEntry = {
  route: DrawerRouteName;
  label: string;
  hint: string;
  icon: IconName;
  state: ReleaseState;
  /**
   * Optional primary module key used for UI "désactivé" hints / CTAs.
   * Example: entry "Parc matériel" is primarily gated by module "equipment".
   */
  primaryModule?: ModuleKey;
  /**
   * Compute whether the entry is enabled for the org.
   * Even when disabled, we keep it visible in the drawer (shows ModuleDisabledScreen).
   */
  isEnabled: (availableModules: ModuleKey[], ctx: { galleryEnabled: boolean }) => boolean;
};

export const DRAWER_ENTRIES: DrawerEntry[] = [
  {
    route: ROUTES.DASHBOARD,
    label: 'Tableau de bord',
    hint: 'Santé globale, alertes, actions rapides',
    icon: 'view-dashboard',
    state: 'READY',
    primaryModule: 'dashboard',
    isEnabled: () => true
  },
  {
    route: ROUTES.PROJECTS,
    label: 'Mes chantiers',
    hint: 'Liste + détail + onglets',
    icon: 'office-building',
    state: 'BETA',
    isEnabled: () => true
  },
  {
    route: ROUTES.EQUIPMENT,
    label: 'Parc matériel',
    hint: 'Équipements, mouvements, liaisons',
    icon: 'tools',
    state: 'ALPHA',
    primaryModule: 'equipment',
    isEnabled: (mods) => mods.includes('equipment')
  },
  {
    route: ROUTES.TEAM,
    label: 'Équipe',
    hint: 'Membres, rôles, équipes',
    icon: 'account-group',
    state: 'BETA',
    primaryModule: 'orgs',
    isEnabled: (mods) => mods.includes('orgs')
  },
  {
    route: ROUTES.PLANNING,
    label: 'Planning',
    hint: 'Affectations, créneaux, alertes',
    icon: 'calendar',
    state: 'ALPHA',
    primaryModule: 'planning',
    isEnabled: (mods) => mods.includes('planning')
  },
  {
    route: ROUTES.ACCOUNT,
    label: 'Mon compte',
    hint: 'Profil, session, déconnexion',
    icon: 'account-circle',
    state: 'READY',
    isEnabled: () => true
  },
  {
    route: ROUTES.SECURITY,
    label: 'Sécurité & DUERP',
    hint: 'Synchronisation, conflits, audit, MFA',
    icon: 'shield-check',
    state: 'BETA',
    primaryModule: 'security',
    isEnabled: (mods, ctx) =>
      ctx.galleryEnabled ||
      mods.includes('security') ||
      mods.includes('search') ||
      mods.includes('offline') ||
      mods.includes('audit') ||
      mods.includes('conflicts') ||
      mods.includes('superadmin')
  },
  {
    route: ROUTES.ENTERPRISE,
    label: 'Mon entreprise',
    hint: 'Paramètres, modules, facturation',
    icon: 'domain',
    state: 'BETA',
    primaryModule: 'orgs',
    isEnabled: (mods) =>
      mods.includes('orgs') ||
      mods.includes('company') ||
      mods.includes('billing') ||
      mods.includes('offers') ||
      mods.includes('governance') ||
      mods.includes('backup')
  }
];

export function isDrawerRouteName(value: string): value is DrawerRouteName {
  return Object.values(ROUTES).includes(value as DrawerRouteName);
}

export function assertDrawerRegistryIntegrity() {
  if (!__DEV__) return;

  const required = [
    ROUTES.DASHBOARD,
    ROUTES.PROJECTS,
    ROUTES.EQUIPMENT,
    ROUTES.TEAM,
    ROUTES.PLANNING,
    ROUTES.ACCOUNT,
    ROUTES.SECURITY,
    ROUTES.ENTERPRISE
  ] as const;

  const routes = DRAWER_ENTRIES.map((e) => e.route);
  const unique = new Set(routes);

  if (unique.size !== routes.length) {
    throw new Error(`[nav.registry] Doublons dans DRAWER_ENTRIES: ${routes.join(', ')}`);
  }

  for (const route of required) {
    if (!unique.has(route)) {
      throw new Error(`[nav.registry] Route manquante dans DRAWER_ENTRIES: ${route}`);
    }
  }

  if (routes.length !== required.length) {
    throw new Error(
      `[nav.registry] DRAWER_ENTRIES doit contenir ${required.length} entrées (8). Reçu: ${routes.length}`
    );
  }
}
