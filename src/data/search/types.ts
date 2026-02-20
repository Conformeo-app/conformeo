export type SearchEntity =
  | 'TASK'
  | 'DOCUMENT'
  | 'MEDIA'
  | 'EXPORT'
  | 'BILLING_CLIENT'
  | 'BILLING_QUOTE'
  | 'BILLING_INVOICE';

export type SearchScope = {
  orgId: string;
  projectId?: string;
};

export type SearchContext = {
  org_id?: string;
  user_id?: string;
  project_id?: string;
};

export type SearchQueryOptions = {
  scope: SearchScope;
  entities?: SearchEntity[];
  limit?: number;
  offset?: number;
};

export type SearchResult = {
  id: string;
  org_id: string;
  entity: SearchEntity;
  entity_id: string;
  project_id?: string;
  title: string;
  body: string;
  tags: string[];
  updated_at: string;
  score: number;
  title_highlight: string;
  body_highlight: string;
};

export type SearchGroup = {
  entity: SearchEntity;
  count: number;
  items: SearchResult[];
};

export type SearchQueryResponse = {
  q: string;
  limit: number;
  offset: number;
  total: number;
  elapsedMs: number;
  results: SearchResult[];
  groups: SearchGroup[];
};

export type SearchSuggestionOptions = {
  scope: SearchScope;
  limit?: number;
};

export type SearchApi = {
  setContext: (context: Partial<SearchContext>) => void;
  setOrg: (orgId: string | null) => void;
  setActor: (userId: string | null) => void;
  setProject: (projectId: string | null) => void;

  listProjects: (scope?: Partial<SearchScope>) => Promise<string[]>;

  query: (q: string, opts: SearchQueryOptions) => Promise<SearchQueryResponse>;
  getSuggestions: (prefix: string, opts: SearchSuggestionOptions) => Promise<string[]>;

  reindexEntity: (entity: SearchEntity, id: string) => Promise<void>;
  rebuildAll: () => Promise<{ indexed: number }>;
};
