export type AdminSelf = {
  user_id: string;
  is_super_admin: boolean;
  aal: string | null;
  mfa_verified: boolean;
  permissions: string[];
};

export type AdminOrg = {
  id: string;
  name: string;
  siret?: string | null;
  address?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type AdminOrgUser = {
  user_id: string;
  org_id: string;
  role: string;
  status: 'INVITED' | 'ACTIVE' | string;
  invited_email?: string | null;
  invited_at?: string | null;
  joined_at?: string | null;
  display_name?: string | null;
  phone?: string | null;
  profile_role?: string | null;
};

export type SupportSession = {
  id: string;
  admin_user_id: string;
  target_user_id: string;
  org_id: string;
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at?: string | null;
  created_at: string;
};

export type SuperAdminPermissions = {
  permissions: string[];
};

export type ImpersonationStartResult = {
  session: SupportSession;
  access_token: string;
  expires_at: string;
};

export type DeleteOrgResult = {
  org_id: string;
  deleted: boolean;
  storage_objects_deleted: number;
  deleted_at: string;
};

export type AdminActionResult<T> =
  | { status: 'OK'; data: T }
  | { status: 'REJECTED'; reason: string };
