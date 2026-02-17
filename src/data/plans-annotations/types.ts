import { Document, DocumentVersion } from '../documents';
import type { MediaAsset } from '../media';
import type { Task, TaskSuggestion } from '../tasks';

export type PlanPinStatus = 'OPEN' | 'DONE' | 'INFO';

export type PlanPinPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export type PlanPinLinkEntity = 'TASK' | 'MEDIA' | 'DOCUMENT';

export type ActivePlanRecord = {
  project_id: string;
  document_id: string;
  document_version_id: string;
  updated_at: string;
};

export type PinLinkCounts = {
  tasks: number;
  media: number;
  documents: number;
};

export type PlanPin = {
  id: string;
  org_id: string;
  project_id: string;
  document_id: string;
  document_version_id: string;
  page_number: number;
  x: number;
  y: number;
  label?: string;
  status: PlanPinStatus;
  priority: PlanPinPriority;
  assignee_user_id?: string;
  comment?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PlanPinLink = {
  id: string;
  pin_id: string;
  entity: PlanPinLinkEntity;
  entity_id: string;
  created_at: string;
};

export type PlanOpenResult = {
  document: Document;
  version: DocumentVersion;
  versions: DocumentVersion[];
};

export type PlanCreatePinContext = {
  documentId: string;
  versionId?: string;
  page: number;
  x: number;
  y: number;
  projectId?: string;
};

export type PlanCreatePinMeta = {
  id?: string;
  label?: string;
  status?: PlanPinStatus;
  priority?: PlanPinPriority;
  assignee_user_id?: string;
  comment?: string;
  created_by?: string;
};

export type PlanUpdatePinPatch = {
  page_number?: number;
  x?: number;
  y?: number;
  label?: string;
  status?: PlanPinStatus;
  priority?: PlanPinPriority;
  assignee_user_id?: string;
  comment?: string;
};

export type PlanPinFilters = {
  status?: PlanPinStatus | 'ALL';
  page_number?: number;
  limit?: number;
  offset?: number;
};

export type PlanJumpTarget = {
  pin_id: string;
  document_id: string;
  document_version_id: string;
  page_number: number;
  x: number;
  y: number;
};

export type PlansAnnotationsContext = {
  org_id: string;
  user_id: string;
};

export type PlansAnnotationsApi = {
  setContext: (context: Partial<PlansAnnotationsContext>) => void;
  setActor: (userId: string | null) => void;
  setOrg: (orgId: string | null) => void;

  listProjectPlans: (projectId: string) => Promise<Document[]>;
  getActivePlan: (projectId: string) => Promise<ActivePlanRecord | null>;
  setActivePlan: (projectId: string, documentId: string, versionId?: string) => Promise<PlanOpenResult>;
  openActive: (projectId: string) => Promise<PlanOpenResult | null>;

  open: (documentId: string, versionId?: string) => Promise<PlanOpenResult>;
  listPins: (documentId: string, versionId?: string, filters?: PlanPinFilters) => Promise<PlanPin[]>;
  listPinsByProject: (projectId: string, filters?: Pick<PlanPinFilters, 'status' | 'limit' | 'offset'>) => Promise<PlanPin[]>;
  createPin: (ctx: PlanCreatePinContext, meta?: PlanCreatePinMeta) => Promise<PlanPin>;
  updatePin: (pinId: string, patch: PlanUpdatePinPatch) => Promise<PlanPin>;
  deletePin: (pinId: string) => Promise<void>;

  link: (pinId: string, entity: PlanPinLinkEntity, entityId: string) => Promise<void>;
  unlink: (pinId: string, entity: PlanPinLinkEntity, entityId: string) => Promise<void>;
  listLinks: (pinId: string) => Promise<PlanPinLink[]>;
  getLinkCounts: (pinIds: string[]) => Promise<Record<string, PinLinkCounts>>;

  jumpToPin: (pinId: string) => Promise<PlanJumpTarget>;

  createTaskFromPin: (
    pinId: string,
    template?: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'tags'>>
  ) => Promise<Task>;
  addPhotoToPin: (pinId: string) => Promise<MediaAsset>;
};
