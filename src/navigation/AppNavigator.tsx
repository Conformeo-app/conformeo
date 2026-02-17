import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '../core/auth';
import { AuditScreen } from '../features/audit/AuditScreen';
import { AccountScreen } from '../features/account/AccountScreen';
import { BackupScreen } from '../features/backup/BackupScreen';
import { CompanyHubScreen } from '../features/company/CompanyHubScreen';
import { ConflictsScreen } from '../features/conflicts/ConflictsScreen';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { EquipmentScreen } from '../features/equipment/EquipmentScreen';
import { ExportsScreen } from '../features/exports/ExportsScreen';
import { GovernanceScreen } from '../features/governance/GovernanceScreen';
import { OfferManagementScreen } from '../features/offers/OfferManagementScreen';
import { OfflineScreen } from '../features/offline/OfflineScreen';
import { OrgsAdminScreen } from '../features/orgs/OrgsAdminScreen';
import { PlanningScreen } from '../features/planning/PlanningScreen';
import { ProjectsListScreen } from '../features/projects/ProjectsListScreen';
import { ProjectDetailScreen } from '../features/projects/ProjectDetailScreen';
import { ProjectCreateScreen } from '../features/projects/ProjectCreateScreen';
import { ProjectEditScreen } from '../features/projects/ProjectEditScreen';
import { WasteVolumeScreen } from '../features/waste/WasteVolumeScreen';
import { CarbonScreen } from '../features/carbon/CarbonScreen';
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
import { EnterpriseHubScreen } from '../features/enterprise/EnterpriseHubScreen';
import { TeamScreen } from '../features/team/TeamScreen';
import { UxAcceleratorsScreen } from '../features/ux/UxAcceleratorsScreen';
import { ModuleDisabledScreen } from '../screens/system/ModuleDisabledScreen';
import { resetCurrentContext, setCurrentContext } from './contextStore';
import { useEnabledModules } from './EnabledModulesProvider';
import { navigationRef } from './navigationRef';
import { SideMenu } from '../app/SideMenu';
import { TopBar } from '../app/TopBar';
import { flags } from '../data/feature-flags';
import { assertRoutesIntegrity, ROUTES } from './routes';
import type {
  AccountStackParamList,
  EnterpriseStackParamList,
  EquipmentStackParamList,
  PlanningStackParamList,
  ProjectsStackParamList,
  RootDrawerParamList,
  SecurityStackParamList,
  TeamStackParamList
} from './types';
import { useTheme } from '../ui/theme/ThemeProvider';

const MIN_WIDE_LAYOUT_WIDTH = 1024;

const Drawer = createDrawerNavigator<RootDrawerParamList & { QuickActions: undefined }>();

const DashboardStack = createNativeStackNavigator<{ DashboardHome: undefined }>();
const ProjectsStack = createNativeStackNavigator<ProjectsStackParamList>();
const EquipmentStack = createNativeStackNavigator<EquipmentStackParamList>();
const PlanningStack = createNativeStackNavigator<PlanningStackParamList>();
const TeamStack = createNativeStackNavigator<TeamStackParamList>();
const SecurityStack = createNativeStackNavigator<SecurityStackParamList>();
const EnterpriseStack = createNativeStackNavigator<EnterpriseStackParamList>();
const AccountStack = createNativeStackNavigator<AccountStackParamList>();
const QuickActionsStack = createNativeStackNavigator<{ QuickActionsHome: undefined }>();
const ModuleDisabledStack = createNativeStackNavigator<{ ModuleDisabled: { moduleKey?: string; moduleLabel?: string; reason?: string } | undefined }>();

const TEAM_HOME_COMPONENT = TeamScreen;

function DashboardStackScreen() {
  const { colors } = useTheme();

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

  return (
    <ProjectsStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <ProjectsStack.Screen name="ProjectsList" component={ProjectsListScreen} options={{ title: 'Chantiers' }} />
      <ProjectsStack.Screen
        name="ProjectCreate"
        component={ProjectCreateScreen}
        options={{ title: 'Nouveau chantier' }}
      />
      <ProjectsStack.Screen
        name="ProjectEdit"
        component={ProjectEditScreen}
        options={{ title: 'Modifier chantier' }}
      />
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

  return (
    <EquipmentStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <EquipmentStack.Screen name="EquipmentHome" component={EquipmentScreen} options={{ title: 'Équipements' }} />
    </EquipmentStack.Navigator>
  );
}

function PlanningStackScreen() {
  const { colors } = useTheme();

  return (
    <PlanningStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <PlanningStack.Screen name="PlanningHome" component={PlanningScreen} options={{ title: 'Planning' }} />
    </PlanningStack.Navigator>
  );
}

function TeamStackScreen() {
  const { colors } = useTheme();

  if (__DEV__) {
    const screenKey = (TEAM_HOME_COMPONENT as any).screenKey;
    if (screenKey !== 'TEAM') {
      throw new Error(`[nav] TeamHome doit rendre TeamScreen (screenKey TEAM). Reçu: ${String(screenKey)}`);
    }
  }

  return (
    <TeamStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <TeamStack.Screen name="TeamHome" component={TEAM_HOME_COMPONENT} options={{ title: 'Équipe' }} />
    </TeamStack.Navigator>
  );
}

function SecurityStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();
  const { activeOrgId, role } = useAuth();
  const galleryEnabled =
    __DEV__ || (role === 'ADMIN' && flags.isEnabled('ui_gallery', { orgId: activeOrgId ?? undefined, fallback: false }));

  return (
      <SecurityStack.Navigator
        screenOptions={{
          header: (props) => <TopBar {...props} />,
          contentStyle: { backgroundColor: colors.bg }
        }}
      >
        <SecurityStack.Screen name="SecurityHub" component={SecurityHubScreen} options={{ title: 'Sécurité' }} />
      {galleryEnabled ? (
        <>
          <SecurityStack.Screen name="UIGallery" component={UIGalleryScreen} options={{ title: 'Galerie UI' }} />
          <SecurityStack.Screen
            name="UIGalleryAtoms"
            component={UIGalleryAtomsScreen}
            options={{ title: 'Galerie UI — Atomes' }}
          />
          <SecurityStack.Screen
            name="UIGalleryInputs"
            component={UIGalleryInputsScreen}
            options={{ title: 'Galerie UI — Champs' }}
          />
          <SecurityStack.Screen
            name="UIGallerySurfaces"
            component={UIGallerySurfacesScreen}
            options={{ title: 'Galerie UI — Surfaces' }}
          />
          <SecurityStack.Screen
            name="UIGalleryPatterns"
            component={UIGalleryPatternsScreen}
            options={{ title: 'Galerie UI — Structures' }}
          />
          <SecurityStack.Screen
            name="UIGalleryStates"
            component={UIGalleryStatesScreen}
            options={{ title: 'Galerie UI — États' }}
          />
        </>
      ) : null}
      {availableModules.includes('security') ? (
        <SecurityStack.Screen
          name="SecuritySettings"
          component={SecurityScreen}
          options={{ title: 'Identité & MFA' }}
        />
      ) : null}
      {availableModules.includes('search') ? (
        <SecurityStack.Screen name="Search" component={SearchScreen} options={{ title: 'Recherche' }} />
      ) : null}
      {availableModules.includes('offline') ? (
        <SecurityStack.Screen name="Offline" component={OfflineScreen} options={{ title: 'Hors ligne / Synchronisation' }} />
      ) : null}
      {availableModules.includes('conflicts') ? (
        <SecurityStack.Screen name="Conflicts" component={ConflictsScreen} options={{ title: 'Conflits' }} />
      ) : null}
      {availableModules.includes('audit') ? (
        <SecurityStack.Screen name="Audit" component={AuditScreen} options={{ title: 'Audit' }} />
      ) : null}
      {availableModules.includes('superadmin') ? (
        <SecurityStack.Screen name="SuperAdmin" component={SuperAdminScreen} options={{ title: 'Super-admin' }} />
      ) : null}
    </SecurityStack.Navigator>
  );
}

function EnterpriseStackScreen() {
  const { colors } = useTheme();
  const { availableModules } = useEnabledModules();

  return (
    <EnterpriseStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <EnterpriseStack.Screen name="EnterpriseHub" component={EnterpriseHubScreen} options={{ title: 'Entreprise' }} />
      {availableModules.includes('orgs') ? (
        <EnterpriseStack.Screen name="OrgAdmin" component={OrgsAdminScreen} options={{ title: 'Paramètres org' }} />
      ) : null}
      {availableModules.includes('company') ? (
        <EnterpriseStack.Screen name="CompanyHub" component={CompanyHubScreen} options={{ title: 'Espace entreprise' }} />
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
    </EnterpriseStack.Navigator>
  );
}

function AccountStackScreen() {
  const { colors } = useTheme();

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

  return (
    <QuickActionsStack.Navigator
      screenOptions={{
        header: (props) => <TopBar {...props} />,
        contentStyle: { backgroundColor: colors.bg }
      }}
    >
      <QuickActionsStack.Screen
        name="QuickActionsHome"
        component={UxAcceleratorsScreen}
        options={{ title: 'Actions rapides' }}
      />
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
      <ModuleDisabledStack.Screen
        name="ModuleDisabled"
        component={ModuleDisabledScreen}
        options={{ title: 'Module désactivé' }}
      />
    </ModuleDisabledStack.Navigator>
  );
}

export function AppNavigator() {
  assertRoutesIntegrity();
  const { width } = useWindowDimensions();
  const { activeOrgId } = useAuth();
  const { availableModules } = useEnabledModules();
  const { colors, layout } = useTheme();
  const lastOrgIdRef = useRef<string | null>(null);

  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  useEffect(() => {
    if (!activeOrgId) {
      resetCurrentContext();
      return;
    }

    setCurrentContext({ orgId: activeOrgId, projectId: undefined });

    // Si l'org change en cours de session, on repart sur un état de navigation propre.
    if (lastOrgIdRef.current && lastOrgIdRef.current !== activeOrgId && navigationRef.isReady()) {
      navigationRef.navigate(ROUTES.DASHBOARD);
    }

    lastOrgIdRef.current = activeOrgId;
  }, [activeOrgId]);

  const sections = useMemo(() => {
    const has = (key: string) => availableModules.includes(key as any);

    return {
      equipment: has('equipment'),
      planning: has('planning'),
      team: has('orgs'),
      security: has('security') || has('search') || has('offline') || has('audit') || has('conflicts') || has('superadmin'),
      enterprise: has('orgs') || has('company') || has('offers') || has('governance') || has('backup')
    };
  }, [availableModules]);

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
      <Drawer.Navigator
        screenOptions={{
          headerShown: false,
          drawerType: isWide ? 'permanent' : 'front',
          drawerStyle: {
            width: isWide ? layout.sideMenuWidth : 300
          }
        }}
        drawerContent={(props) => <SideMenu {...props} />}
      >
        <Drawer.Screen name={ROUTES.DASHBOARD} component={DashboardStackScreen} />
        <Drawer.Screen name={ROUTES.PROJECTS} component={ProjectsStackScreen} />
        {sections.equipment ? <Drawer.Screen name={ROUTES.EQUIPMENT} component={EquipmentStackScreen} /> : null}
        {sections.planning ? <Drawer.Screen name={ROUTES.PLANNING} component={PlanningStackScreen} /> : null}
        {sections.team ? <Drawer.Screen name={ROUTES.TEAM} component={TeamStackScreen} /> : null}
        {sections.security ? <Drawer.Screen name={ROUTES.SECURITY} component={SecurityStackScreen} /> : null}
        {sections.enterprise ? <Drawer.Screen name={ROUTES.ENTERPRISE} component={EnterpriseStackScreen} /> : null}
        <Drawer.Screen name={ROUTES.ACCOUNT} component={AccountStackScreen} />
        <Drawer.Screen name={ROUTES.MODULE_DISABLED} component={ModuleDisabledStackScreen} />

        {/* Hidden route: accessible via la top bar (quick actions globales). */}
        {availableModules.includes('accelerators') ? (
          <Drawer.Screen name={ROUTES.QUICK_ACTIONS} component={QuickActionsStackScreen} />
        ) : null}
      </Drawer.Navigator>
    </NavigationContainer>
  );
}
