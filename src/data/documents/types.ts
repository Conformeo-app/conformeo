export type DocumentScope = 'COMPANY' | 'PROJECT';

export type DocumentType = 'PLAN' | 'DOE' | 'PV' | 'REPORT' | 'INTERNAL' | 'OTHER';

export type DocumentStatus = 'DRAFT' | 'FINAL' | 'SIGNED';

export type Document = {
  id: string;
  org_id: string;
  scope: DocumentScope;
  project_id?: string;
  title: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  tags: string[];
  description?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  active_version_id?: string;
};

export type DocumentVersion = {
  id: string;
  document_id: string;
  version_number: number;
  file_asset_id: string;
  file_hash: string;
  file_mime: string;
  file_size: number;
  created_at: string;
  created_by: string;
};

export type LinkedEntity = 'TASK' | 'PLAN_PIN' | 'PROJECT' | 'EXPORT';

export type DocumentLink = {
  id: string;
  document_id: string;
  linked_entity: LinkedEntity;
  linked_id: string;
  created_at: string;
};

export type DocumentsListFilters = {
  org_id?: string;
  status?: DocumentStatus | 'ALL';
  doc_type?: DocumentType | 'ALL';
  tags?: string[];
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

export type DocumentCreateInput = {
  id?: string;
  org_id: string;
  scope: DocumentScope;
  project_id?: string;
  title: string;
  doc_type?: DocumentType;
  status?: DocumentStatus;
  tags?: string[];
  description?: string;
  created_by: string;
};

export type DocumentUpdatePatch = {
  scope?: DocumentScope;
  project_id?: string;
  title?: string;
  doc_type?: DocumentType;
  status?: DocumentStatus;
  tags?: string[];
  description?: string;
  deleted_at?: string;
};

export type AddVersionContext = {
  source?: 'import' | 'capture' | 'existing';
  existing_asset_id?: string;
  tag?: string;
};
