import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootDrawerParamList } from './types';
import { getCurrentContext, setCurrentContext, type AppNavigationContext } from './contextStore';
import { ROUTES } from './routes';

export const navigationRef = createNavigationContainerRef<any>();

type NavigateTarget = keyof RootDrawerParamList | 'ProjectDetail';

type ProjectDetailParams = {
  projectId: string;
  tab?: 'Overview' | 'Tasks' | 'Plans' | 'Media' | 'Documents' | 'Control';
  mediaUploadStatus?: 'ALL' | 'PENDING' | 'FAILED';
};

function ensureReady() {
  return navigationRef.isReady();
}

export const navigation = {
  navigate(target: NavigateTarget, params?: unknown) {
    if (!ensureReady()) {
      return;
    }

    if (target === 'ProjectDetail') {
      const typed = params as ProjectDetailParams | undefined;
      if (!typed?.projectId) {
        throw new Error('navigation.navigate("ProjectDetail") requiert { projectId }.');
      }

      navigationRef.navigate(ROUTES.PROJECTS, {
        screen: 'ProjectDetail',
        params: {
          projectId: typed.projectId,
          tab: typed.tab,
          mediaUploadStatus: typed.mediaUploadStatus
        }
      });

      return;
    }

    navigationRef.navigate(target as any, params as any);
  },

  setContext(patch: Partial<AppNavigationContext>) {
    setCurrentContext(patch);
  },

  getCurrentContext() {
    return getCurrentContext();
  }
};
