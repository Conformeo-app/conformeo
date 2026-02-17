import { AppRole } from '../../core/identity-security/types';
import { AddVersionContext, Document, DocumentStatus } from '../documents';

export type CompanySectionKey =
  | 'DOCS_INTERNAL'
  | 'REGULATIONS'
  | 'FIRE_SAFETY'
  | 'CERTIFICATIONS'
  | 'PROCEDURES'
  | 'MANDATORY_POSTERS';

export type CompanySection = {
  id: string;
  org_id: string;
  key: CompanySectionKey;
  label: string;
  sort_order: number;
  created_at: string;
};

export type CompanyDocumentType = 'INTERNAL' | 'REPORT' | 'CERT';

export type HubDocumentMeta = {
  title: string;
  description?: string;
  tags?: string[];
  status?: DocumentStatus;
  doc_type?: CompanyDocumentType;
};

export type CertificationStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'UNKNOWN';

export type Certification = {
  id: string;
  org_id: string;
  name: string;
  issuer?: string;
  valid_from?: string;
  valid_to?: string;
  doc_id?: string;
  status: CertificationStatus;
  created_at: string;
  updated_at: string;
  created_by: string;
};

export type CertificationCreateInput = {
  id?: string;
  name: string;
  issuer?: string;
  valid_from?: string;
  valid_to?: string;
  doc_id?: string;
  status?: CertificationStatus;
};

export type CertificationUpdatePatch = {
  name?: string;
  issuer?: string;
  valid_from?: string;
  valid_to?: string;
  doc_id?: string;
  status?: CertificationStatus;
};

export type CompanyCheck = {
  id: string;
  org_id: string;
  key: string;
  label: string;
  checked: boolean;
  comment?: string;
  updated_at: string;
  updated_by?: string;
};

export type CompanyHubContext = {
  org_id: string;
  user_id: string;
  role: AppRole;
};

export type CompanyHubApi = {
  setContext: (context: Partial<CompanyHubContext>) => void;
  setOrg: (orgId: string | null) => void;
  setActor: (userId: string | null) => void;
  setRole: (role: AppRole | null) => void;

  listSections: () => Promise<CompanySection[]>;
  listDocuments: (sectionKey: CompanySectionKey) => Promise<Document[]>;
  addDocument: (
    sectionKey: CompanySectionKey,
    documentMeta: HubDocumentMeta,
    fileContext?: AddVersionContext
  ) => Promise<Document>;

  certs: {
    create: (meta: CertificationCreateInput) => Promise<Certification>;
    update: (id: string, patch: CertificationUpdatePatch) => Promise<Certification>;
    list: () => Promise<Certification[]>;
    getExpiring: (days: number) => Promise<Certification[]>;
  };

  checks: {
    get: () => Promise<CompanyCheck[]>;
    toggle: (key: string, checked: boolean) => Promise<void>;
    setComment: (key: string, text: string) => Promise<void>;
  };
};
