import { ModuleKey } from '../../core/modules';

export type DashboardScope = {
  orgId: string;
  projectId?: string;
};

export type DashboardContext = {
  org_id?: string;
  user_id?: string;
  project_id?: string;
};

export type DashboardWidgetKey =
  | 'open_tasks'
  | 'blocked_tasks'
  | 'proofs'
  | 'documents'
  | 'exports_recent'
  | 'alerts'
  | 'activity';

export type DashboardWidgetConfigItem = {
  key: DashboardWidgetKey;
  enabled: boolean;
  order: number;
  requiredModule?: ModuleKey;
  lockedByFeatureFlag?: boolean;
};

export type DashboardWidgetsConfig = {
  scope: DashboardScope;
  widgets: DashboardWidgetConfigItem[];
  updated_at: string;
  source: 'DEFAULT' | 'LOCAL';
};

export type DashboardWidgetsConfigInput = {
  widgets: Array<{
    key: DashboardWidgetKey;
    enabled: boolean;
    order?: number;
  }>;
};

export type DashboardAlertLevel = 'INFO' | 'WARN' | 'ERROR';

export type DashboardAlertCode =
  | 'SYNC_ERRORS'
  | 'SAFETY_TASKS'
  | 'UPLOAD_QUEUE_QUOTA'
  | 'EXPORT_DAILY_QUOTA'
  | 'MEDIA_DAILY_QUOTA'
  | 'STORAGE_QUOTA'
  | 'CERTIFICATIONS_EXPIRING';

export type DashboardAlert = {
  code: DashboardAlertCode;
  level: DashboardAlertLevel;
  message: string;
  value?: number;
};

export type DashboardActivityEntity = 'TASK' | 'MEDIA' | 'DOCUMENT' | 'EXPORT' | 'SYNC';

export type DashboardActivity = {
  id: string;
  entity: DashboardActivityEntity;
  at: string;
  title: string;
  subtitle?: string;
  project_id?: string;
};

export type DashboardTaskPreview = {
  id: string;
  title: string;
  status: 'TODO' | 'DOING' | 'DONE' | 'BLOCKED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  updated_at: string;
  project_id: string;
  tags: string[];
};

export type DashboardMediaPreview = {
  id: string;
  tag?: string;
  mime: string;
  created_at: string;
  upload_status: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  local_thumb_path?: string;
  project_id?: string;
};

export type DashboardDocumentPreview = {
  id: string;
  title: string;
  doc_type: 'PLAN' | 'DOE' | 'PV' | 'REPORT' | 'INTERNAL' | 'OTHER';
  status: 'DRAFT' | 'FINAL' | 'SIGNED';
  updated_at: string;
  project_id?: string;
};

export type DashboardExportPreview = {
  id: string;
  type: 'REPORT_PDF' | 'CONTROL_PACK' | 'DOE_ZIP';
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  created_at: string;
  finished_at?: string;
  project_id: string;
};

export type DashboardSummary = {
  scope: DashboardScope;
  generated_at: string;

  openTasks: number;
  blockedTasks: number;
  proofs: number;
  documents: number;
  recentExports: number;

  syncPendingOps: number;
  syncFailedOps: number;
  safetyOpenTasks: number;
  expiringCertifications: number;

  alerts: DashboardAlert[];

  openTaskPreviews: DashboardTaskPreview[];
  blockedTaskPreviews: DashboardTaskPreview[];
  latestProofs: DashboardMediaPreview[];
  latestDocuments: DashboardDocumentPreview[];
  latestExports: DashboardExportPreview[];
  activity: DashboardActivity[];
};

export type DashboardApi = {
  setContext: (context: Partial<DashboardContext>) => void;
  setOrg: (orgId: string | null) => void;
  setActor: (userId: string | null) => void;
  setProject: (projectId: string | null) => void;

  listProjects: (scope?: Partial<DashboardScope>) => Promise<string[]>;

  getSummary: (scope: DashboardScope) => Promise<DashboardSummary>;

  getWidgetsConfig: (scope?: Partial<DashboardScope>) => Promise<DashboardWidgetsConfig>;
  setWidgetsConfig: (
    config: DashboardWidgetsConfigInput,
    scope?: Partial<DashboardScope>
  ) => Promise<DashboardWidgetsConfig>;

  getActivityFeed: (limit: number, scope?: Partial<DashboardScope>) => Promise<DashboardActivity[]>;
};
