export type TaskStatus = 'TODO' | 'DOING' | 'DONE' | 'BLOCKED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export type TaskSuggestionType = 'SUGGESTION' | 'REMINDER';

export type TaskSuggestion = {
  id: string;
  rule: string;
  type: TaskSuggestionType;
  value: string;
  created_at: string;
};

export type Task = {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string;
  assignee_user_id?: string;
  created_by: string;
  tags: string[];
  suggestions: TaskSuggestion[];
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  last_transcript?: string;
};

export type TaskComment = {
  id: string;
  task_id: string;
  text: string;
  created_by: string;
  created_at: string;
};

export type KeywordRuleActionType = 'ADD_TAG' | 'SUGGEST' | 'ADD_REMINDER';

export type KeywordRuleAction = {
  type: KeywordRuleActionType;
  value: string;
};

export type KeywordRule = {
  name: string;
  keywords: string[];
  actions: KeywordRuleAction[];
};

export type KeywordRulesConfig = {
  rules: KeywordRule[];
};

export type TaskFilters = {
  org_id?: string;
  status?: TaskStatus | 'ALL';
  assignee_user_id?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  include_deleted?: boolean;
};

export type TaskCreateInput = {
  id?: string;
  org_id: string;
  project_id: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string;
  assignee_user_id?: string;
  created_by: string;
  tags?: string[];
  suggestions?: TaskSuggestion[];
  last_transcript?: string;
};

export type TaskUpdatePatch = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string;
  assignee_user_id?: string;
  tags?: string[];
  suggestions?: TaskSuggestion[];
  deleted_at?: string;
  last_transcript?: string;
};

export type TaskMediaContext = {
  org_id: string;
  project_id: string;
  tag?: string;
  source?: 'capture' | 'import';
};
