export type MediaMime = 'image/webp' | 'image/jpeg' | 'application/pdf';

export type MediaUploadStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';

export type MediaContext = {
  org_id: string;
  project_id?: string;
  task_id?: string;
  plan_pin_id?: string;
  tag?: string;
  project_label?: string;
};

export type MediaAsset = {
  id: string;
  org_id: string;
  project_id?: string;
  task_id?: string;
  plan_pin_id?: string;
  tag?: string;
  local_original_path: string;
  local_path: string;
  local_thumb_path: string;
  mime: MediaMime;
  width?: number;
  height?: number;
  size_bytes: number;
  watermark_applied: boolean;
  watermark_text?: string;
  upload_status: MediaUploadStatus;
  remote_path?: string;
  remote_url?: string;
  created_at: string;
  retry_count: number;
  last_error?: string;
};

export type MediaListFilters = {
  upload_status?: MediaUploadStatus;
  tag?: string;
};

export type MediaProcessConfig = {
  maxEdgePx: number;
  thumbMaxEdgePx: number;
  maxImportSizeBytes: number;
  jpegQuality: number;
  webpQuality: number;
  maxPendingUploads: number;
  cleanupExportOlderThanMs: number;
};
