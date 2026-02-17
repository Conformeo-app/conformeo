export type ProjectStatusManual = 'ACTIVE' | 'ARCHIVED';

export type ProjectRiskLevel = 'OK' | 'WATCH' | 'RISK';

export type ProjectSyncState = 'SYNCED' | 'PENDING' | 'ERROR';

export type Project = {
  id: string;
  org_id: string;
  name: string;
  address?: string;
  geo_lat?: number;
  geo_lng?: number;
  start_date?: string;
  end_date?: string;
  status_manual: ProjectStatusManual;
  team_id?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ProjectCreateInput = {
  id?: string;
  org_id: string;
  name: string;
  address?: string;
  geo_lat?: number;
  geo_lng?: number;
  start_date?: string;
  end_date?: string;
  status_manual?: ProjectStatusManual;
  team_id?: string;
  created_by: string;
};

export type ProjectUpdatePatch = Partial<{
  name: string;
  address: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  start_date: string | null;
  end_date: string | null;
  status_manual: ProjectStatusManual;
  team_id: string | null;
}>;

export type ProjectListFilters = {
  org_id: string;
  query?: string;
  include_archived?: boolean;
  limit?: number;
  offset?: number;
};

export type ProjectIndicators = {
  project_id: string;
  riskLevel: ProjectRiskLevel;
  syncState: ProjectSyncState;
  openTasks: number;
  blockedTasks: number;
  safetyOpenTasks: number;
  pendingOps: number;
  failedOps: number;
  pendingUploads: number;
  failedUploads: number;
  openConflicts: number;
};
