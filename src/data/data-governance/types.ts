export type RetentionEntity =
  | 'AUDIT_LOGS'
  | 'EXPORT_JOBS'
  | 'DELETED_TASKS'
  | 'DELETED_DOCUMENTS'
  | 'RECENTS'
  | 'OPERATIONS_SYNCED';

export type RetentionPolicy = {
  org_id: string;
  entity: RetentionEntity;
  retention_days: number;
  updated_at: string;
  updated_by?: string | null;
  source: 'REMOTE' | 'LOCAL' | 'DEFAULT';
};

export type RetentionApplyItem = {
  entity: RetentionEntity;
  retention_days: number;
  deleted_rows: number;
  deleted_files: number;
};

export type RetentionApplyResult = {
  org_id: string;
  applied_at: string;
  items: RetentionApplyItem[];
  total_deleted_rows: number;
  total_deleted_files: number;
};

export type PortableDataExportResult = {
  org_id: string;
  path: string;
  generated_at: string;
  tables: number;
  rows: number;
  size_bytes: number;
};

export type AnonymizeUserResult = {
  org_id: string;
  user_id: string;
  alias: string;
  local_updates: Record<string, number>;
  remote_applied: boolean;
  remote_error?: string;
  processed_at: string;
};

