import { navigationRef } from './navigationRef';
import { ROUTES } from './routes';
import { getCurrentContext, setCurrentContext, type AppNavigationContext } from './contextStore';

type ProjectDetailParams = {
  projectId: string;
  tab?: 'Overview' | 'Tasks' | 'Plans' | 'Media' | 'Documents' | 'Control';
  mediaUploadStatus?: 'ALL' | 'PENDING' | 'FAILED';
};

function ensureReady() {
  return navigationRef.isReady();
}

export const nav = {
  goDashboard() {
    if (!ensureReady()) return;
    navigationRef.navigate(ROUTES.DASHBOARD as any);
  },

  goProjects() {
    if (!ensureReady()) return;
    navigationRef.navigate(ROUTES.PROJECTS as any, { screen: 'ProjectsList' } as any);
  },

  createProject() {
    if (!ensureReady()) return;
    navigationRef.navigate(ROUTES.PROJECTS as any, { screen: 'ProjectCreate' } as any);
  },

  openProject(projectId: string, tab?: ProjectDetailParams['tab'], params?: Omit<ProjectDetailParams, 'projectId' | 'tab'>) {
    if (!ensureReady()) return;
    const clean = typeof projectId === 'string' ? projectId.trim() : '';
    if (!clean) {
      throw new Error('nav.openProject requiert projectId.');
    }

    navigationRef.navigate(
      ROUTES.PROJECTS as any,
      {
        screen: 'ProjectDetail',
        params: { projectId: clean, tab, ...(params ?? {}) }
      } as any
    );
  },

  goTeam() {
    if (!ensureReady()) return;
    navigationRef.navigate(ROUTES.TEAM as any);
  },

  goEnterprise(params?: { screen?: string; params?: any }) {
    if (!ensureReady()) return;
    if (params?.screen) {
      navigationRef.navigate(ROUTES.ENTERPRISE as any, params as any);
      return;
    }
    navigationRef.navigate(ROUTES.ENTERPRISE as any);
  },

  goSecurity(params?: { screen?: string; params?: any }) {
    if (!ensureReady()) return;
    if (params?.screen) {
      navigationRef.navigate(ROUTES.SECURITY as any, params as any);
      return;
    }
    navigationRef.navigate(ROUTES.SECURITY as any);
  },

  goAccount() {
    if (!ensureReady()) return;
    navigationRef.navigate(ROUTES.ACCOUNT as any);
  },

  moduleDisabled(input?: { moduleKey?: string; moduleLabel?: string; reason?: string }) {
    if (!ensureReady()) return;
    navigationRef.navigate(
      ROUTES.MODULE_DISABLED as any,
      { screen: 'ModuleDisabled', params: input ?? undefined } as any
    );
  },

  // Context helpers (required by UX shell contract)
  setContext(patch: Partial<AppNavigationContext>) {
    setCurrentContext(patch);
  },

  getCurrentContext() {
    return getCurrentContext();
  }
};
