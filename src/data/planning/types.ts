export type PlanningViewMode = 'DAY' | 'WEEK' | 'MONTH';

export type PlanningEventKind = 'PROJECT' | 'TEAM' | 'CONTROL' | 'DOC' | 'TASK';

export type PlanningEvent = {
  id: string;
  org_id: string;
  project_id?: string;
  title: string;
  description?: string;
  kind: PlanningEventKind;
  start_at: string;
  end_at: string;
  assignee_user_id?: string;
  team_id?: string;
  related_task_id?: string;
  related_document_id?: string;
  is_urgent: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type PlanningEventCreateInput = {
  id?: string;
  org_id: string;
  project_id?: string;
  title: string;
  description?: string;
  kind: PlanningEventKind;
  start_at: string;
  end_at: string;
  assignee_user_id?: string;
  team_id?: string;
  related_task_id?: string;
  related_document_id?: string;
  is_urgent?: boolean;
  created_by: string;
};

export type PlanningEventUpdatePatch = Partial<{
  project_id: string | null;
  title: string;
  description: string | null;
  kind: PlanningEventKind;
  start_at: string;
  end_at: string;
  assignee_user_id: string | null;
  team_id: string | null;
  related_task_id: string | null;
  related_document_id: string | null;
  is_urgent: boolean;
  deleted_at: string | null;
}>;

export type PlanningListFilters = {
  project_id?: string;
  assignee_user_id?: string;
  team_id?: string;
  onlyMineUserId?: string;
  kinds?: PlanningEventKind[];
  includeDeleted?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
};

export type PlanningIndicators = {
  weekEventsCount: number;
  urgentCount: number;
  mineCount: number;
  todayCount: number;
  pendingOpsCount: number;
};
