import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootDrawerParamList } from './types';
import { getCurrentContext, setCurrentContext, type AppNavigationContext } from './contextStore';

export const navigationRef = createNavigationContainerRef<any>();

type NavigateTarget = keyof RootDrawerParamList | 'ProjectDetail';

type ProjectDetailParams = {
  projectId: string;
  tab?: 'Overview' | 'Tasks' | 'Plans' | 'Media' | 'Documents' | 'Control';
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

      navigationRef.navigate('Projects', {
        screen: 'ProjectDetail',
        params: {
          projectId: typed.projectId,
          tab: typed.tab
        }
      });

      return;
    }

    if (target === 'Projects') {
      navigationRef.navigate('Projects', { screen: 'ProjectsList' });
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
