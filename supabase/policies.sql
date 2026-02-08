-- RLS de base (à adapter selon le modèle de claims)

alter table orgs enable row level security;
alter table profiles enable row level security;
alter table projects enable row level security;
alter table documents enable row level security;
alter table media enable row level security;
alter table plans enable row level security;
alter table plan_annotations enable row level security;
alter table signatures enable row level security;
alter table feature_flags enable row level security;
alter table audit_log enable row level security;
alter table shares enable row level security;

-- Exemple: accès org_id via claim JWT `org_id`
create policy "orgs_isolation" on orgs
  for select using (id = (auth.jwt() ->> 'org_id')::uuid);

create policy "profiles_isolation" on profiles
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "projects_isolation" on projects
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "documents_isolation" on documents
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "media_isolation" on media
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "plans_isolation" on plans
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "annotations_isolation" on plan_annotations
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "signatures_isolation" on signatures
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "flags_isolation" on feature_flags
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "audit_isolation" on audit_log
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);

create policy "shares_isolation" on shares
  for select using (org_id = (auth.jwt() ->> 'org_id')::uuid);
