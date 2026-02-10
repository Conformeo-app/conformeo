import React, { useMemo, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './core/auth';
import { ModuleKey } from './core/modules';
import { useSyncStatus } from './data/sync/useSyncStatus';
import { AuthAccessScreen } from './features/auth/AuthAccessScreen';
import { DashboardScreen } from './features/dashboard/DashboardScreen';
import { DocumentsScreen } from './features/documents/DocumentsScreen';
import { ExportsScreen } from './features/exports/ExportsScreen';
import { MediaScreen } from './features/media/MediaScreen';
import { OfflineScreen } from './features/offline/OfflineScreen';
import { PlansScreen } from './features/plans/PlansScreen';
import { SearchScreen } from './features/search/SearchScreen';
import { SecurityScreen } from './features/security/SecurityScreen';
import { TasksScreen } from './features/tasks/TasksScreen';
import { Sidebar } from './ui/components/Sidebar';
import { Text } from './ui/components/Text';
import { SplitLayout } from './ui/layout/SplitLayout';
import { ThemeProvider, useTheme } from './ui/theme/ThemeProvider';

const MIN_WIDE_LAYOUT_WIDTH = 1024;

const moduleToScreen: Record<ModuleKey, React.ComponentType> = {
  dashboard: DashboardScreen,
  tasks: TasksScreen,
  documents: DocumentsScreen,
  exports: ExportsScreen,
  search: SearchScreen,
  offline: OfflineScreen,
  media: MediaScreen,
  plans: PlansScreen,
  security: SecurityScreen
};

function LoadingView() {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.teal} />
      <Text variant="caption" style={{ marginTop: spacing.sm, color: colors.slate }}>
        Initialisation...
      </Text>
    </View>
  );
}

function MainShell() {
  const { width } = useWindowDimensions();
  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');
  const { status } = useSyncStatus();
  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  const ActiveScreen = useMemo(() => moduleToScreen[activeModule], [activeModule]);

  return (
    <SplitLayout
      isWide={isWide}
      sidebar={
        <Sidebar
          active={activeModule}
          onSelect={setActiveModule}
          compact={!isWide}
          syncStatus={status}
        />
      }
      content={<ActiveScreen />}
    />
  );
}

export function AppRoot() {
  const { loading, session, hasMembership } = useAuth();

  return (
    <ThemeProvider>
      <SafeAreaView style={{ flex: 1 }}>
        {loading ? <LoadingView /> : !session || hasMembership === false ? <AuthAccessScreen /> : <MainShell />}
      </SafeAreaView>
    </ThemeProvider>
  );
}
