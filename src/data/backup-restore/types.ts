export type BackupType = 'LOCAL_EXPORT' | 'SERVER_SNAPSHOT';

export type BackupStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export type BackupRecord = {
  id: string;
  org_id: string;
  type: BackupType;
  status: BackupStatus;
  created_at: string;
  path?: string;
  size_bytes?: number;
  include_media: boolean;
  last_error?: string;
};

export type BackupExportOptions = {
  includeMedia: boolean;
};

export type BackupImportMode = 'MERGE' | 'REPLACE';

export type BackupImportOptions = {
  mode?: BackupImportMode;
};

export type BackupManifestFile = {
  path: string; // relative to FileSystem.documentDirectory
  size_bytes: number;
  sha256?: string;
};

export type BackupManifest = {
  format_version: 1;
  backup_id: string;
  org_id: string;
  created_at: string;
  created_by?: string;
  include_media: boolean;
  app: {
    name: 'conformeo';
    version?: string;
  };
  db: {
    tables: Array<{ name: string; row_count: number }>;
  };
  files?: {
    total_count: number;
    total_bytes: number;
    entries: BackupManifestFile[];
  };
};

