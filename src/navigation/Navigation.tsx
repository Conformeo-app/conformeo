import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '../core/auth';
import { AccountScreen } from '../features/account/AccountScreen';
import { AuditScreen } from '../features/audit/AuditScreen';
import { BackupScreen } from '../features/backup/BackupScreen';
import { CarbonScreen } from '../features/carbon/CarbonScreen';
import { CompanyHubScreen } from '../features/company/CompanyHubScreen';
import { ConflictsScreen } from '../features/conflicts/ConflictsScreen';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { EquipmentScreen } from '../features/equipment/EquipmentScreen';
import { EnterpriseHubScreen } from '../features/enterprise/EnterpriseHubScreen';
import { ExportsScreen } from '../features/exports/ExportsScreen';
import { GovernanceScreen } from '../features/governance/GovernanceScreen';
import { OfflineScreen } from '../features/offline/OfflineScreen';
import { OfferManagementScreen } from '../features/offers/OfferManagementScreen';
import { OrgsAdminScreen } from '../features/orgs/OrgsAdminScreen';
import { PlanningScreen } from '../features/planning/PlanningScreen';
import { ProjectCreateScreen } from '../features/projects/ProjectCreateScreen';
import { ProjectDetailScreen } from '../features/projects/ProjectDetailScreen';
import { ProjectEditScreen } from '../features/projects/ProjectEditScreen';
import { ProjectsListScreen } from '../features/projects/ProjectsListScreen';
import { SearchScreen } from '../features/search/SearchScreen';
import { SecurityScreen } from '../features/security/SecurityScreen';
import { SecurityHubScreen } from '../features/security/SecurityHubScreen';
import { UIGalleryScreen } from '../features/security/UIGalleryScreen';
import { UIGalleryAtomsScreen } from '../features/security/ui-gallery/UIGalleryAtomsScreen';
import { UIGalleryInputsScreen } from '../features/security/ui-gallery/UIGalleryInputsScreen';
import { UIGallerySurfacesScreen } from '../features/security/ui-gallery/UIGallerySurfacesScreen';
import { UIGalleryPatternsScreen } from '../features/security/ui-gallery/UIGalleryPatternsScreen';
import { UIGalleryStatesScreen } from '../features/security/ui-gallery/UIGalleryStatesScreen';
import { SuperAdminScreen } from '../features/super-admin/SuperAdminScreen';
import { TeamScreen } from '../features/team/TeamScreen';
import { UxAcceleratorsScreen } from '../features/ux/UxAcceleratorsScreen';
import { WasteVolumeScreen } from '../features/waste/WasteVolumeScreen';
import { AdminMfaEnrollmentScreen } from '../features/auth/AdminMfaEnrollmentScreen';
import { AuthAccessScreen } from '../features/auth/AuthAccessScreen';
import { ModuleDisabledScreen } from '../screens/system/ModuleDisabledScreen';
import { SideMenu } from '../app/SideMenu';
import { TopBar } from '../app/TopBar';
import { resetCurrentContext, setCurrentContext } from './contextStore';
import { useEnabledModules } from './EnabledModulesProvider';
import { flags } from '../data/feature-flags';
import { navigationRef } from './navigationRef';
import { assertRoutesIntegrity, ROUTES } from './routes';
import { assertScreenKey } from './screenRegistry';
import type {
  AccountStackParamList,
  AuthStackParamList,
  EnterpriseStackParamList,
  EquipmentStackParamList,
  PlanningStackParamList,
  ProjectsStackParamList,
  RootDrawerParamList,
  RootStackParamList,
  SecurityStackParamList,
  TeamStackParamList
} from './types';
import { useTheme } from '../ui/theme/ThemeProvider';

const MIN_WIDE_LAYOUT_WIDTH = 1024;

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

const Drawer = createDrawerNavigator<RootDrawerParamList>();

const DashboardStack = createNativeStackNavigator<{ DashboardHome: undefined }>();
const ProjectsStack = createNativeStackNavigator<ProjectsStackParamList>();
const EquipmentStack = createNativeStackNavigator<EquipmentStackParamList>();
const PlanningStack = createNativeStackNavigator<PlanningStackParamList>();
const TeamStack = createNativeStackNavigator<TeamStackParamList>();
const SecurityStack = createNativeStackNavigator<SecurityStackParamList>();
const EnterpriseStack = createNativeStackNavigator<EnterpriseStackParamList>();
const AccountStack = createNativeStackNavigator<AccountStackParamList>();
const QuickActionsStack = createNativeStackNavigator<{ QuickActionsHome: undefined }>();
const ModuleDisabledStack = createNativeStackNavigator<{
  ModuleDisabled: { moduleKey?: string; moduleLabel?: string; reason?: string } | undefined;
}>();

function AuthStackScreen() {
  const { colors } = useTheme();
  const { requiresMfaEnrollment } = useAuth();

  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      {requiresMfaEnrollment ? (
        <AuthStack.Screen name="AdminMfaEnrollment" component={AdminMfaEnrollmentScreen} />
      ) : (
        <AuthStack.Screen name="AuthAccess" component={AuthAccessScreen} />
      )}
    </AuthStack.Navigator>
  );
}

function DashboardStackScreen() {
  const { colors } = useTheme();
  assertScreenKey(DashboardScreen, 'DASHBOARD', 'DashboardHome');

  return (
    <DashboardStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <DashboardStack.Screen name="DashboardHome" component={DashboardScreen} options={{ title: 'Tableau de bord' }} />
    </DashboardStack.Navigator>
  );
}

function ProjectsStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();
  assertScreenKey(ProjectsListScreen, 'PROJECTS_LIST', 'ProjectsList');

  return (
    <ProjectsStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <ProjectsStack.Screen name="ProjectsList" component={ProjectsListScreen} options={{ title: 'Chantiers' }} />
      <ProjectsStack.Screen name="ProjectCreate" component={ProjectCreateScreen} options={{ title: 'Nouveau chantier' }} />
      <ProjectsStack.Screen name="ProjectEdit" component={ProjectEditScreen} options={{ title: 'Modifier chantier' }} />
      <ProjectsStack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: 'Chantier' }} />

      {availableModules.includes('waste') ? (
        <ProjectsStack.Screen
          name="WasteVolume"
          options={{ title: 'Déchets' }}
          children={({ route }) => <WasteVolumeScreen projectId={route.params.projectId} />}
        />
      ) : null}
      {availableModules.includes('carbon') ? (
        <ProjectsStack.Screen
          name="Carbon"
          options={{ title: 'Carbone' }}
          children={({ route }) => <CarbonScreen projectId={route.params.projectId} />}
        />
      ) : null}
      {availableModules.includes('exports') ? (
        <ProjectsStack.Screen
          name="Exports"
          options={{ title: 'Exports' }}
          children={({ route }) => <ExportsScreen projectId={route.params.projectId} />}
        />
      ) : null}
    </ProjectsStack.Navigator>
  );
}

function EquipmentStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();
  const enabled = availableModules.includes('equipment');

  if (enabled) {
    assertScreenKey(EquipmentScreen, 'EQUIPMENT', 'EquipmentHome');
  }

  return (
    <EquipmentStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <EquipmentStack.Screen name="EquipmentHome" options={{ title: 'Équipements' }}>
        {() =>
          enabled ? (
            <EquipmentScreen />
          ) : (
            <ModuleDisabledScreen moduleKey="equipment" moduleLabel="Équipements" />
          )
        }
      </EquipmentStack.Screen>
    </EquipmentStack.Navigator>
  );
}

function PlanningStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();
  const enabled = availableModules.includes('planning');

  if (enabled) {
    assertScreenKey(PlanningScreen, 'PLANNING', 'PlanningHome');
  }

  return (
    <PlanningStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <PlanningStack.Screen name="PlanningHome" options={{ title: 'Planning' }}>
        {() =>
          enabled ? (
            <PlanningScreen />
          ) : (
            <ModuleDisabledScreen moduleKey="planning" moduleLabel="Planning" />
          )
        }
      </PlanningStack.Screen>
    </PlanningStack.Navigator>
  );
}

const TEAM_HOME_COMPONENT = TeamScreen;

function TeamStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();
  const enabled = availableModules.includes('orgs');

  if (__DEV__ && enabled) {
    assertScreenKey(TEAM_HOME_COMPONENT, 'TEAM', 'TeamHome');
  }

  return (
    <TeamStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <TeamStack.Screen name="TeamHome" options={{ title: 'Équipe' }}>
        {() =>
          enabled ? (
            <TEAM_HOME_COMPONENT />
          ) : (
            <ModuleDisabledScreen moduleKey="orgs" moduleLabel="Équipe" reason="Le module Entreprise/Équipe est désactivé." />
          )
        }
      </TeamStack.Screen>
    </TeamStack.Navigator>
  );
}

function SecurityStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();
  const { activeOrgId, role } = useAuth();
  const galleryEnabled =
    __DEV__ || (role === 'ADMIN' && flags.isEnabled('ui_gallery', { orgId: activeOrgId ?? undefined, fallback: false }));

  const enabled =
    galleryEnabled ||
    availableModules.includes('security') ||
    availableModules.includes('search') ||
    availableModules.includes('offline') ||
    availableModules.includes('audit') ||
    availableModules.includes('conflicts') ||
    availableModules.includes('superadmin');

  if (enabled) {
    assertScreenKey(SecurityHubScreen, 'SECURITY_HUB', 'SecurityHub');
  }

  return (
    <SecurityStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      {enabled ? (
        <>
          <SecurityStack.Screen name="SecurityHub" component={SecurityHubScreen} options={{ title: 'Sécurité' }} />
          {availableModules.includes('security') ? (
            <SecurityStack.Screen name="SecuritySettings" component={SecurityScreen} options={{ title: 'Identité & MFA' }} />
          ) : null}
          {availableModules.includes('search') ? (
            <SecurityStack.Screen name="Search" component={SearchScreen} options={{ title: 'Recherche' }} />
          ) : null}
          {availableModules.includes('offline') ? (
            <SecurityStack.Screen name="Offline" component={OfflineScreen} options={{ title: 'Offline / Sync' }} />
          ) : null}
          {availableModules.includes('conflicts') ? (
            <SecurityStack.Screen name="Conflicts" component={ConflictsScreen} options={{ title: 'Conflits' }} />
          ) : null}
          {availableModules.includes('audit') ? (
            <SecurityStack.Screen name="Audit" component={AuditScreen} options={{ title: 'Audit' }} />
          ) : null}
          {availableModules.includes('superadmin') ? (
            <SecurityStack.Screen name="SuperAdmin" component={SuperAdminScreen} options={{ title: 'Super Admin' }} />
          ) : null}
          {galleryEnabled ? (
            <>
              <SecurityStack.Screen name="UIGallery" component={UIGalleryScreen} options={{ title: 'UI Gallery' }} />
              <SecurityStack.Screen name="UIGalleryAtoms" component={UIGalleryAtomsScreen} options={{ title: 'Atoms' }} />
              <SecurityStack.Screen name="UIGalleryInputs" component={UIGalleryInputsScreen} options={{ title: 'Inputs' }} />
              <SecurityStack.Screen
                name="UIGallerySurfaces"
                component={UIGallerySurfacesScreen}
                options={{ title: 'Surfaces' }}
              />
              <SecurityStack.Screen
                name="UIGalleryPatterns"
                component={UIGalleryPatternsScreen}
                options={{ title: 'Patterns' }}
              />
              <SecurityStack.Screen name="UIGalleryStates" component={UIGalleryStatesScreen} options={{ title: 'States' }} />
            </>
          ) : null}
        </>
      ) : (
        <SecurityStack.Screen name="SecurityHub" options={{ title: 'Sécurité' }}>
          {() => <ModuleDisabledScreen moduleKey="security" moduleLabel="Sécurité" />}
        </SecurityStack.Screen>
      )}
    </SecurityStack.Navigator>
  );
}

function EnterpriseStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();
  const enabled =
    availableModules.includes('orgs') ||
    availableModules.includes('company') ||
    availableModules.includes('offers') ||
    availableModules.includes('governance') ||
    availableModules.includes('backup');

  if (enabled) {
    assertScreenKey(EnterpriseHubScreen, 'ENTERPRISE_HUB', 'EnterpriseHub');
  }

  return (
    <EnterpriseStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      {enabled ? (
        <>
          <EnterpriseStack.Screen name="EnterpriseHub" component={EnterpriseHubScreen} options={{ title: 'Entreprise' }} />
          {availableModules.includes('orgs') ? (
            <EnterpriseStack.Screen name="OrgAdmin" component={OrgsAdminScreen} options={{ title: 'Paramètres org' }} />
          ) : null}
          {availableModules.includes('company') ? (
            <EnterpriseStack.Screen name="CompanyHub" component={CompanyHubScreen} options={{ title: 'Company Hub' }} />
          ) : null}
          {availableModules.includes('offers') ? (
            <EnterpriseStack.Screen name="Offers" component={OfferManagementScreen} options={{ title: 'Offres' }} />
          ) : null}
          {availableModules.includes('governance') ? (
            <EnterpriseStack.Screen name="Governance" component={GovernanceScreen} options={{ title: 'Gouvernance' }} />
          ) : null}
          {availableModules.includes('backup') ? (
            <EnterpriseStack.Screen name="Backup" component={BackupScreen} options={{ title: 'Sauvegarde' }} />
          ) : null}
        </>
      ) : (
        <EnterpriseStack.Screen name="EnterpriseHub" options={{ title: 'Entreprise' }}>
          {() => <ModuleDisabledScreen moduleKey="orgs" moduleLabel="Entreprise" />}
        </EnterpriseStack.Screen>
      )}
    </EnterpriseStack.Navigator>
  );
}

function AccountStackScreen() {
  const { colors } = useTheme();
  assertScreenKey(AccountScreen, 'ACCOUNT', 'AccountHome');

  return (
    <AccountStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <AccountStack.Screen name="AccountHome" component={AccountScreen} options={{ title: 'Compte' }} />
    </AccountStack.Navigator>
  );
}

function QuickActionsStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();
  const enabled = availableModules.includes('accelerators');

  return (
    <QuickActionsStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <QuickActionsStack.Screen name="QuickActionsHome" options={{ title: 'Actions rapides' }}>
        {() =>
          enabled ? (
            <UxAcceleratorsScreen />
          ) : (
            <ModuleDisabledScreen moduleKey="accelerators" moduleLabel="Actions rapides" />
          )
        }
      </QuickActionsStack.Screen>
    </QuickActionsStack.Navigator>
  );
}

function ModuleDisabledStackScreen() {
  const { colors } = useTheme();

  return (
    <ModuleDisabledStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <ModuleDisabledStack.Screen name="ModuleDisabled" component={ModuleDisabledScreen} options={{ title: 'Module désactivé' }} />
    </ModuleDisabledStack.Navigator>
  );
}

function AppDrawerScreen() {
  const { width } = useWindowDimensions();
  const { activeOrgId } = useAuth();
  const { colors, layout } = useTheme();
  const lastOrgIdRef = useRef<string | null>(null);

  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  useEffect(() => {
    if (!activeOrgId) {
      resetCurrentContext();
      return;
    }

    setCurrentContext({ orgId: activeOrgId, projectId: undefined });

    if (lastOrgIdRef.current && lastOrgIdRef.current !== activeOrgId && navigationRef.isReady()) {
      navigationRef.navigate(ROUTES.DASHBOARD);
    }

    lastOrgIdRef.current = activeOrgId;
  }, [activeOrgId]);

  return (
    <Drawer.Navigator
      screenOptions={{
        headerShown: false,
        drawerType: isWide ? 'permanent' : 'front',
        drawerStyle: {
          width: isWide ? layout.sideMenuWidth : 300
        },
        sceneStyle: { backgroundColor: colors.bg }
      }}
      drawerContent={(props) => <SideMenu {...props} />}
    >
      <Drawer.Screen name={ROUTES.DASHBOARD} component={DashboardStackScreen} />
      <Drawer.Screen name={ROUTES.PROJECTS} component={ProjectsStackScreen} />
      <Drawer.Screen name={ROUTES.EQUIPMENT} component={EquipmentStackScreen} />
      <Drawer.Screen name={ROUTES.PLANNING} component={PlanningStackScreen} />
      <Drawer.Screen name={ROUTES.TEAM} component={TeamStackScreen} />
      <Drawer.Screen name={ROUTES.SECURITY} component={SecurityStackScreen} />
      <Drawer.Screen name={ROUTES.ENTERPRISE} component={EnterpriseStackScreen} />
      <Drawer.Screen name={ROUTES.ACCOUNT} component={AccountStackScreen} />
      <Drawer.Screen name={ROUTES.MODULE_DISABLED} component={ModuleDisabledStackScreen} />
      <Drawer.Screen name={ROUTES.QUICK_ACTIONS} component={QuickActionsStackScreen} />
    </Drawer.Navigator>
  );
}

export function AppNavigator() {
  assertRoutesIntegrity();
  const { colors } = useTheme();
  const { session, hasMembership, requiresMfaEnrollment } = useAuth();
  const showApp = Boolean(session) && hasMembership !== false && !requiresMfaEnrollment;

  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        primary: colors.primary,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.danger
      }
    }),
    [colors]
  );

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onStateChange={() => {
        if (!__DEV__) return;
        const route = navigationRef.getCurrentRoute();
        if (route) {
          // eslint-disable-next-line no-console
          console.log(`[nav] route=${route.name}`);
        }
      }}
    >
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {showApp ? (
          <RootStack.Screen name="App" component={AppDrawerScreen} />
        ) : (
          <RootStack.Screen name="Auth" component={AuthStackScreen} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
