import { ExportJob } from '../exports';
import { MediaAsset } from '../media';
import { Task } from '../tasks';

export type RiskLevel = 'OK' | 'WATCH' | 'RISK';

export type ControlSummary = {
  openTasks: number;
  blockedTasks: number;
  mediaCount: number;
  documentsCount: number;
  lastActivityAt?: string;
  riskLevel: RiskLevel;
};

export type ControlProofFilters = {
  task_id?: string;
  from_date?: string;
  to_date?: string;
  tag?: string;
  critical_only?: boolean;
  limit?: number;
  offset?: number;
};

export type ChecklistTemplateItem = {
  key: string;
  label: string;
};

export type ChecklistTemplateConfig = {
  items: ChecklistTemplateItem[];
};

export type InspectionChecklist = {
  id: string;
  org_id: string;
  project_id: string;
  created_by: string;
  created_at: string;
};

export type InspectionItem = {
  id: string;
  checklist_id: string;
  key: string;
  label: string;
  checked: boolean;
  comment?: string;
  updated_at: string;
  updated_by?: string;
};

export type ChecklistWithItems = {
  checklist: InspectionChecklist;
  items: InspectionItem[];
};

export type ControlModeState = {
  project_id: string;
  org_id: string;
  enabled: boolean;
  updated_by?: string;
  enabled_at?: string;
  disabled_at?: string;
  updated_at: string;
};

export type ControlActivityEntity = 'TASK' | 'MEDIA' | 'DOCUMENT' | 'CHECKLIST';

export type ControlActivity = {
  id: string;
  entity: ControlActivityEntity;
  title: string;
  subtitle?: string;
  at: string;
};

export type ControlModeContext = {
  org_id: string;
  user_id: string;
};

export type ControlModeApi = {
  setContext: (context: Partial<ControlModeContext>) => void;
  setActor: (userId: string | null) => void;
  setOrg: (orgId: string | null) => void;

  listProjects: () => Promise<string[]>;

  enable: (projectId: string) => Promise<void>;
  disable: (projectId: string) => Promise<void>;
  isEnabled: (projectId: string) => Promise<boolean>;
  getState: (projectId: string) => Promise<ControlModeState | null>;

  getSummary: (projectId: string) => Promise<ControlSummary>;
  listCriticalProofs: (projectId: string, filters?: ControlProofFilters) => Promise<MediaAsset[]>;
  listOpenIssues: (projectId: string) => Promise<Task[]>;
  getRecentActivity: (projectId: string, limit?: number) => Promise<ControlActivity[]>;

  createChecklist: (projectId: string) => Promise<InspectionChecklist>;
  getLatestChecklist: (projectId: string) => Promise<ChecklistWithItems>;
  toggleItem: (itemId: string, checked: boolean) => Promise<void>;
  setComment: (itemId: string, text: string) => Promise<void>;
  getChecklistTemplate: () => Promise<ChecklistTemplateConfig>;

  generateControlPack: (projectId: string) => Promise<ExportJob>;
};
