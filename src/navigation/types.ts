export type ProjectTabKey = 'Overview' | 'Tasks' | 'Plans' | 'Media' | 'Documents' | 'Control';

export type RootDrawerParamList = {
  Dashboard: undefined;
  Projects: undefined;
  Equipment: undefined;
  Planning: undefined;
  Team: undefined;
  Security: undefined;
  Enterprise: undefined;
  Account: undefined;
  ModuleDisabled: { moduleKey?: string; moduleLabel?: string; reason?: string } | undefined;
  QuickActions: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
};

export type AuthStackParamList = {
  AuthAccess: undefined;
  AdminMfaEnrollment: undefined;
};

export type ProjectsStackParamList = {
  ProjectsList: undefined;
  ProjectCreate: undefined;
  ProjectEdit: { projectId: string };
  ProjectDetail: { projectId: string; tab?: ProjectTabKey; mediaUploadStatus?: 'ALL' | 'PENDING' | 'FAILED' };
  WasteVolume: { projectId: string };
  Carbon: { projectId: string };
  Exports: { projectId: string };
};

export type ProjectTabsParamList = {
  OverviewTab: { projectId: string };
  TasksTab: { projectId: string };
  PlansTab: { projectId: string };
  MediaTab: { projectId: string; uploadStatus?: 'ALL' | 'PENDING' | 'FAILED' };
  DocumentsTab: { projectId: string };
  ControlTab: { projectId: string };
};

export type EquipmentStackParamList = {
  EquipmentHome: undefined;
};

export type PlanningStackParamList = {
  PlanningHome: undefined;
};

export type TeamStackParamList = {
  TeamHome: undefined;
};

export type SecurityStackParamList = {
  SecurityHub: undefined;
  UIGallery: undefined;
  UIGalleryAtoms: undefined;
  UIGalleryInputs: undefined;
  UIGallerySurfaces: undefined;
  UIGalleryPatterns: undefined;
  UIGalleryStates: undefined;
  SecuritySettings: undefined;
  Search: undefined;
  Offline: undefined;
  Conflicts: undefined;
  Audit: undefined;
  SuperAdmin: undefined;
};

export type EnterpriseStackParamList = {
  EnterpriseHub: undefined;
  OrgAdmin: undefined;
  CompanyHub: undefined;
  BillingHome: undefined;
  BillingClients: undefined;
  BillingClientDetail: { clientId: string };
  BillingClientEdit: { clientId?: string };
  BillingQuotes: undefined;
  BillingQuoteDetail: { quoteId: string };
  BillingQuoteEdit: { quoteId?: string; clientId?: string };
  BillingInvoices: undefined;
  BillingInvoiceDetail: { invoiceId: string };
  BillingInvoiceEdit: { invoiceId?: string; clientId?: string; quoteId?: string };
  BillingPaymentCreate: { invoiceId: string };
  Offers: undefined;
  Governance: undefined;
  Backup: undefined;
};

export type AccountStackParamList = {
  AccountHome: undefined;
};
