export type SignatureStatus = 'DRAFT' | 'PENDING' | 'FINAL';

export type SignatureCanvasPoint = {
  x: number; // normalise 0..1
  y: number; // normalise 0..1
};

export type SignatureCanvasStroke = SignatureCanvasPoint[];

export type SignatureCanvasData = {
  strokes: SignatureCanvasStroke[];
};

export type SignatureActor = {
  user_id: string;
  role?: string | null;
  display_name?: string | null;
};

export type SignatureRecord = {
  id: string;
  org_id: string;
  document_id: string;
  version_id: string;
  signed_document_version_id?: string;

  signer_user_id: string;
  signer_role: string;
  signer_display_name?: string;
  device_id?: string;

  signature_asset_id: string;
  signed_pdf_asset_id: string;

  file_hash: string;
  source_version_hash?: string;

  signed_at_local: string;
  signed_at_server?: string;

  geo_lat?: number;
  geo_lng?: number;

  status: SignatureStatus;
  created_at: string;
  updated_at: string;

  canvas?: SignatureCanvasData;
  last_error?: string;
};

export type VerifyResult = {
  valid: boolean;
  reason?: string;
};
