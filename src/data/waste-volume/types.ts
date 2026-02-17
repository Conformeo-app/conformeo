export type WasteCategory =
  | 'GRAVATS'
  | 'BOIS'
  | 'METAUX'
  | 'PLASTIQUES'
  | 'PLATRE'
  | 'DIB'
  | 'DEEE'
  | 'AUTRE';

export type WasteEntry = {
  id: string;
  org_id: string;
  project_id: string;
  category: WasteCategory | string;
  length_m: number;
  width_m: number;
  height_m: number;
  volume_m3: number;
  note?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type WasteCreateInput = {
  id?: string;
  org_id: string;
  project_id: string;
  category: WasteCategory | string;
  length_m: number;
  width_m: number;
  height_m: number;
  note?: string;
  created_by: string;
};

export type WasteUpdatePatch = Partial<{
  category: WasteCategory | string;
  length_m: number;
  width_m: number;
  height_m: number;
  note: string | null;
  deleted_at: string | null;
}>;

export type WasteListFilters = {
  org_id: string;
  category?: WasteCategory | string | 'ALL';
  created_from?: string;
  created_to?: string;
  limit?: number;
  offset?: number;
};

export type WasteTotals = {
  total_m3: number;
  by_category: Record<string, number>;
};

export type WasteCsvExportResult = {
  path: string;
  size_bytes: number;
  created_at: string;
  row_count: number;
};

