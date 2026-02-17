export type OrgQuotas = {
  org_id: string;
  storage_mb: number;
  exports_per_day: number;
  media_per_day: number;
  max_file_mb: number;
  updated_at?: string;
};

export type OrgUsage = {
  org_id: string;
  storage_used_mb: number;
  exports_today: number;
  media_today: number;
  computed_at?: string;
};
