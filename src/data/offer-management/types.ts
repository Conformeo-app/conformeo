import type { ModuleKey } from '../../core/modules';

export type OfferPlan = {
  key: string;
  name: string;
  base_price_eur_month: number;
  included_active_projects: number;
  extra_project_eur_month: number;
  included_modules: ModuleKey[];
};

export type OrgOfferState = {
  org_id: string;
  plan_key: string;
  updated_at: string;
  updated_by?: string;
  source: 'LOCAL' | 'REMOTE' | 'DEFAULT';
};

export type OfferPlanChange = {
  id: string;
  org_id: string;
  old_plan_key?: string;
  new_plan_key: string;
  changed_by?: string;
  changed_at: string;
};

export type OfferPricing = {
  org_id: string;
  plan_key: string;
  active_projects: number;
  included_active_projects: number;
  extra_projects: number;
  base_price_eur_month: number;
  extra_project_eur_month: number;
  estimated_total_eur_month: number;
};

