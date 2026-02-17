export type EquipmentStatus = 'AVAILABLE' | 'ASSIGNED' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

export type Equipment = {
  id: string;
  org_id: string;
  name: string;
  type: string;
  status: EquipmentStatus;
  location?: string;
  current_project_id?: string;
  photo_asset_id?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type EquipmentMovement = {
  id: string;
  org_id: string;
  equipment_id: string;
  from_project_id?: string;
  to_project_id?: string;
  moved_at: string;
  note?: string;
  created_at: string;
};

export type EquipmentTaskLink = {
  id: string;
  org_id: string;
  equipment_id: string;
  task_id: string;
  created_at: string;
};

export type EquipmentListFilters = {
  org_id: string;
  status?: EquipmentStatus | 'ALL';
  project_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type EquipmentMoveInput = {
  from_project_id?: string;
  to_project_id?: string;
  moved_at?: string;
  note?: string;
};

