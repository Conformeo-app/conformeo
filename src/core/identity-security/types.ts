export type AppRole = 'ADMIN' | 'MANAGER' | 'FIELD';

export type UserProfile = {
  user_id: string;
  org_id: string;
  display_name: string;
  phone?: string | null;
  role: AppRole;
  created_at: string;
  updated_at: string;
};

export type ProfilePatch = {
  display_name?: string;
  phone?: string | null;
};

export type RbacContext = {
  orgId?: string | null;
  projectId?: string | null;
};

export type MfaEnrollment = {
  factorId: string;
  qrCodeSvg: string;
  secret: string;
  uri: string;
};

export type SessionAuditEntry = {
  id: string;
  user_id: string;
  org_id: string;
  session_id: string;
  device_id: string;
  device_label?: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at?: string | null;
};
