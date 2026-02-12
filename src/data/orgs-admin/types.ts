export type OrgMemberRole = 'owner' | 'admin' | 'manager' | 'inspector' | 'viewer';

export type MemberStatus = 'INVITED' | 'ACTIVE';

export type OrganizationRecord = {
  id: string;
  name: string;
  siret?: string | null;
  address?: string | null;
  settings_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type OrgSettingsPatch = {
  name?: string;
  siret?: string | null;
  address?: string | null;
  settings_json?: Record<string, unknown>;
};

export type OrganizationMember = {
  user_id?: string | null;
  email?: string | null;
  role: OrgMemberRole;
  status: MemberStatus;
  invited_at: string;
  joined_at?: string | null;
};

export type TeamRecord = {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  member_user_ids: string[];
};

export type ModuleFlag = {
  key: string;
  enabled: boolean;
  updated_at?: string;
  payload?: Record<string, unknown>;
  updated_by?: string | null;
  source?: 'REMOTE' | 'CACHE' | 'DEFAULT';
};

export type InviteResult = {
  invited_user_id?: string | null;
  status: 'INVITED';
};
