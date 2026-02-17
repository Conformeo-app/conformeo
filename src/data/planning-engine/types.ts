export type PlanningItem = {
  id: string;
  org_id: string;
  project_id: string;
  task_id: string;
  title_snapshot: string;
  start_at: string; // ISO
  end_at: string; // ISO
  assignee_user_id?: string;
  team_id?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type PlanningCreateInput = {
  id?: string;
  org_id: string;
  project_id: string;
  task_id: string;
  title_snapshot: string;
  start_at: string;
  end_at: string;
  assignee_user_id?: string;
  team_id?: string;
  created_by: string;
};

export type PlanningUpdatePatch = Partial<{
  title_snapshot: string;
  start_at: string;
  end_at: string;
  assignee_user_id: string | null;
  team_id: string | null;
  deleted_at: string | null;
}>;

export type PlanningListFilters = {
  org_id: string;
  assignee_user_id?: string;
  team_id?: string;
  start_from?: string;
  start_to?: string;
  limit?: number;
  offset?: number;
};

export type PlanningOverlap = {
  resource_key: string; // user:<id> | team:<id>
  first: PlanningItem;
  second: PlanningItem;
  overlap_minutes: number;
};

