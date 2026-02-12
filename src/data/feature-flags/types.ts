export type FeatureFlagSource = 'REMOTE' | 'CACHE' | 'DEFAULT';

export type FeatureFlagRecord = {
  org_id: string;
  key: string;
  enabled: boolean;
  payload: Record<string, unknown>;
  updated_at?: string;
  updated_by?: string;
  source: FeatureFlagSource;
};

export type FeatureFlagAuditValue = {
  enabled?: boolean;
  payload?: Record<string, unknown>;
};

export type FeatureFlagAuditRecord = {
  id: string;
  org_id: string;
  key: string;
  old_value: FeatureFlagAuditValue;
  new_value: FeatureFlagAuditValue;
  changed_by?: string;
  changed_at: string;
};

export type FeatureFlagsContext = {
  org_id?: string;
  user_id?: string;
};

export type FeatureFlagsListAuditOptions = {
  key?: string;
  limit?: number;
};

export type FeatureFlagsIsEnabledOptions = {
  orgId?: string;
  fallback?: boolean;
};

export type FeatureFlagsPayloadOptions = {
  orgId?: string;
};

export type FeatureFlagsApi = {
  setContext: (context: Partial<FeatureFlagsContext>) => void;
  setOrg: (orgId: string | null) => void;
  setActor: (userId: string | null) => void;

  refresh: (preferredOrgId?: string | null) => Promise<FeatureFlagRecord[]>;
  listAll: (preferredOrgId?: string | null) => Promise<FeatureFlagRecord[]>;

  isEnabled: (key: string, options?: FeatureFlagsIsEnabledOptions) => boolean;
  getPayload: <T extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
    options?: FeatureFlagsPayloadOptions
  ) => T | null;

  setEnabled: (key: string, enabled: boolean, preferredOrgId?: string | null) => Promise<FeatureFlagRecord>;
  setPayload: (
    key: string,
    payload: Record<string, unknown>,
    preferredOrgId?: string | null
  ) => Promise<FeatureFlagRecord>;

  listAudit: (preferredOrgId?: string | null, options?: FeatureFlagsListAuditOptions) => Promise<FeatureFlagAuditRecord[]>;
  rollbackLastChange: (key: string, preferredOrgId?: string | null) => Promise<FeatureFlagRecord>;
};
