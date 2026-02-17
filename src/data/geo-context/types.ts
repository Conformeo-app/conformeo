export type GeoEntity = 'TASK' | 'MEDIA' | 'SIGNATURE' | 'DOCUMENT' | 'EXPORT' | 'OTHER';

export type GeoCoords = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export type GeoRecord = {
  id: string;
  org_id: string;
  user_id?: string;
  project_id?: string;
  entity: GeoEntity | string;
  entity_id: string;
  lat: number;
  lng: number;
  accuracy?: number;
  created_at: string;
};

export type GeoContext = {
  org_id?: string;
  user_id?: string;
};

export type GeoCaptureInput = {
  org_id?: string;
  user_id?: string;
  project_id?: string;
  entity: GeoEntity | string;
  entity_id: string;
  coords?: GeoCoords;
  created_at?: string;
};

export type GeoPerimeter = {
  center_lat: number;
  center_lng: number;
  radius_meters: number;
};

export type GeoPerimeterResult = {
  inside: boolean;
  distance_meters: number;
};

export type GeoProvider = {
  getCurrentPosition: () => Promise<GeoCoords>;
};

