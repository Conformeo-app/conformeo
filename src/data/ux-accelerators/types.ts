import { AppRole } from '../../core/identity-security';
import { ModuleKey } from '../../core/modules';
import { ExportType } from '../exports';
import { TaskPriority, TaskStatus } from '../tasks';

export type UxEntity = 'PROJECT' | 'TASK' | 'DOCUMENT' | 'MEDIA' | 'EXPORT' | 'CHECKLIST' | 'TEMPLATE';

export type QuickActionKey =
  | 'NEW_TASK'
  | 'ADD_PROOF'
  | 'GENERATE_REPORT'
  | 'GENERATE_CONTROL_PACK'
  | 'CREATE_CHECKLIST';

export type QuickAction = {
  key: QuickActionKey;
  label: string;
  hint: string;
  module: ModuleKey;
  requires_project: boolean;
  max_taps: number;
  order: number;
};

export type FavoriteRecord = {
  user_id: string;
  org_id: string;
  entity: UxEntity;
  entity_id: string;
  created_at: string;
};

export type RecentRecord = {
  user_id: string;
  org_id: string;
  entity: UxEntity;
  entity_id: string;
  last_opened_at: string;
};

export type TemplateType = 'TASK' | 'CHECKLIST' | 'EXPORT';

export type TaskTemplatePayload = {
  name?: string;
  template_key?: string;
  project_id?: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  with_photo?: boolean;
  media_tag?: string;
};

export type ChecklistTemplatePayload = {
  name?: string;
  template_key?: string;
  project_id?: string;
  checked_keys?: string[];
  comments_by_key?: Record<string, string>;
};

export type ExportTemplatePayload = {
  name?: string;
  template_key?: string;
  project_id?: string;
  export_type?: ExportType;
};

export type TemplatePayload = TaskTemplatePayload | ChecklistTemplatePayload | ExportTemplatePayload;

export type TemplateRecord = {
  id: string;
  org_id: string;
  type: TemplateType;
  template_key: string;
  version: number;
  name: string;
  payload_json: TemplatePayload;
  created_by: string;
  created_at: string;
};

export type TemplateApplyResult = {
  type: TemplateType;
  template_id: string;
  template_version: number;
  created_entity: 'TASK' | 'CHECKLIST' | 'EXPORT_JOB';
  entity_id: string;
  message: string;
};

export type UxContext = {
  org_id: string;
  user_id: string;
  project_id?: string;
};

export type UxApi = {
  setContext: (context: Partial<UxContext>) => void;
  setOrg: (orgId: string | null) => void;
  setActor: (userId: string | null) => void;
  setProject: (projectId: string | null) => void;

  listProjects: () => Promise<string[]>;

  getQuickActions: (role?: AppRole | null) => Promise<QuickAction[]>;

  addFavorite: (entity: UxEntity, id: string) => Promise<FavoriteRecord>;
  removeFavorite: (entity: UxEntity, id: string) => Promise<void>;
  listFavorites: () => Promise<FavoriteRecord[]>;

  trackRecent: (entity: UxEntity, id: string) => Promise<RecentRecord>;
  listRecents: (limit?: number) => Promise<RecentRecord[]>;
};

export type TemplatesApi = {
  create: (type: TemplateType, payload: TemplatePayload) => Promise<TemplateRecord>;
  list: (type?: TemplateType) => Promise<TemplateRecord[]>;
  apply: (type: TemplateType, templateId: string) => Promise<TemplateApplyResult>;
};
