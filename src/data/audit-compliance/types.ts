export type AuditLogPayload = Record<string, unknown>;

export type AuditSource = 'REMOTE' | 'LOCAL';

export type AuditLogEntry = {
  id: string;
  org_id: string;
  user_id?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  payload_json: AuditLogPayload;
  created_at: string;
  source: AuditSource;
  pending_remote: boolean;
};

export type AuditListFilters = {
  org_id?: string;
  user_id?: string;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
  include_pending?: boolean;
  limit?: number;
  offset?: number;
};

export type AuditExportResult = {
  path: string;
  count: number;
  exported_at: string;
};

