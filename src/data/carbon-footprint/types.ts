export type TravelMode = 'CAR' | 'VAN' | 'TRUCK' | 'PUBLIC' | 'BIKE' | 'WALK' | 'OTHER';

export type EnergyType = 'ELECTRICITY_KWH' | 'DIESEL_L' | 'GAS_KWH' | 'OTHER';

export type TravelEntry = {
  id: string;
  org_id: string;
  project_id: string;
  mode: TravelMode | string;
  distance_km: number;
  note?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type EnergyEntry = {
  id: string;
  org_id: string;
  project_id: string;
  energy_type: EnergyType | string;
  quantity: number;
  note?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type EmissionFactorSet = {
  waste_kgco2e_per_m3: Record<string, number>;
  travel_kgco2e_per_km: Record<string, number>;
  energy_kgco2e_per_unit: Record<string, number>;
};

export type CarbonFootprintSummary = {
  org_id: string;
  project_id: string;
  computed_at: string;

  total_kgco2e: number;

  waste_kgco2e: number;
  travel_kgco2e: number;
  energy_kgco2e: number;

  by_waste_category_kgco2e: Record<string, number>;
  by_travel_mode_kgco2e: Record<string, number>;
  by_energy_type_kgco2e: Record<string, number>;

  inputs: {
    waste_m3_by_category: Record<string, number>;
    travel_km_by_mode: Record<string, number>;
    energy_qty_by_type: Record<string, number>;
  };

  factors: EmissionFactorSet;
};

export type CarbonReportPdfResult = {
  path: string;
  size_bytes: number;
  created_at: string;
};

