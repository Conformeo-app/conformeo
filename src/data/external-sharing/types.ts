export type ShareEntity = 'DOCUMENT' | 'EXPORT';

export type ShareLink = {
  id: string;
  org_id: string;
  entity: ShareEntity;
  entity_id: string;
  resource_bucket: string;
  resource_path: string;
  expires_at: string;
  revoked_at?: string;
  created_by: string;
  created_at: string;

  // Device-local convenience.
  public_url?: string | null;
  token_available?: boolean;
};

export type ShareCreateResult = {
  id: string;
  url: string;
  expires_at: string;
};
