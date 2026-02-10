export type ExportType = 'REPORT_PDF' | 'CONTROL_PACK' | 'DOE_ZIP';

export type ExportStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export type ExportItemEntity = 'TASK' | 'MEDIA' | 'DOCUMENT';

export type ExportJob = {
  id: string;
  org_id: string;
  project_id: string;
  type: ExportType;
  status: ExportStatus;
  local_path?: string;
  size_bytes?: number;
  created_by: string;
  created_at: string;
  finished_at?: string;
  retry_count: number;
  last_error?: string;
};

export type ExportItem = {
  id: string;
  export_id: string;
  entity: ExportItemEntity;
  entity_id: string;
  created_at: string;
};

export type ExportSummary = {
  tasks_total: number;
  tasks_todo: number;
  tasks_doing: number;
  tasks_done: number;
  tasks_blocked: number;
  proofs_total: number;
  documents_total: number;
};

export type ExportManifestFile = {
  path: string;
  mime: string;
  size_bytes: number;
  entity: ExportItemEntity;
  entity_id: string;
  linked_task_id?: string;
  linked_document_id?: string;
};

export type ExportManifest = {
  export_id: string;
  org_id: string;
  project_id: string;
  type: ExportType;
  generated_at: string;
  created_by: string;
  source: 'local-device';
  summary: ExportSummary;
  files: ExportManifestFile[];
};

export type ExportContext = {
  org_id: string;
  user_id: string;
};
