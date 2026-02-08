-- Conformeo bootstrap core schema (offline-first + sync + security)
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'inspector', 'viewer')),
  mfa_enforced boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  enabled boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  storage_path text not null,
  mime_type text not null,
  checksum_sha256 text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_annotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  x_norm numeric(6,5) not null check (x_norm >= 0 and x_norm <= 1),
  y_norm numeric(6,5) not null check (y_norm >= 0 and y_norm <= 1),
  status text not null default 'open',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.idempotency_keys (
  org_id uuid not null references public.organizations(id) on delete cascade,
  operation_id text not null,
  processed_at timestamptz not null default now(),
  primary key (org_id, operation_id)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_org_members_user on public.org_members(user_id);
create index if not exists idx_projects_org on public.projects(org_id);
create index if not exists idx_media_assets_org on public.media_assets(org_id);
create index if not exists idx_plans_org on public.plans(org_id);
create index if not exists idx_plan_annotations_org on public.plan_annotations(org_id);
create index if not exists idx_audit_logs_org_created on public.audit_logs(org_id, created_at desc);

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members member
    where member.org_id = target_org
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members member
    where member.org_id = target_org
      and member.user_id = auth.uid()
      and member.role in ('owner', 'admin')
  );
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.org_members enable row level security;
alter table public.projects enable row level security;
alter table public.feature_flags enable row level security;
alter table public.media_assets enable row level security;
alter table public.plans enable row level security;
alter table public.plan_annotations enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.audit_logs enable row level security;

-- Re-create policies idempotently

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
on public.organizations
for select
to authenticated
using (public.is_org_member(id));

drop policy if exists organizations_insert_authenticated on public.organizations;
create policy organizations_insert_authenticated
on public.organizations
for insert
to authenticated
with check (true);

drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin
on public.organizations
for update
to authenticated
using (public.is_org_admin(id))
with check (public.is_org_admin(id));

drop policy if exists org_members_select_member on public.org_members;
create policy org_members_select_member
on public.org_members
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists org_members_manage_admin on public.org_members;
create policy org_members_manage_admin
on public.org_members
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

drop policy if exists projects_member_read on public.projects;
create policy projects_member_read
on public.projects
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists projects_member_write on public.projects;
create policy projects_member_write
on public.projects
for all
to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

drop policy if exists feature_flags_member_read on public.feature_flags;
create policy feature_flags_member_read
on public.feature_flags
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists feature_flags_admin_write on public.feature_flags;
create policy feature_flags_admin_write
on public.feature_flags
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

drop policy if exists media_assets_member_read on public.media_assets;
create policy media_assets_member_read
on public.media_assets
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists media_assets_member_write on public.media_assets;
create policy media_assets_member_write
on public.media_assets
for all
to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

drop policy if exists plans_member_read on public.plans;
create policy plans_member_read
on public.plans
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists plans_member_write on public.plans;
create policy plans_member_write
on public.plans
for all
to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

drop policy if exists plan_annotations_member_read on public.plan_annotations;
create policy plan_annotations_member_read
on public.plan_annotations
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists plan_annotations_member_write on public.plan_annotations;
create policy plan_annotations_member_write
on public.plan_annotations
for all
to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

drop policy if exists idempotency_member_read on public.idempotency_keys;
create policy idempotency_member_read
on public.idempotency_keys
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists idempotency_member_write on public.idempotency_keys;
create policy idempotency_member_write
on public.idempotency_keys
for all
to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read
on public.audit_logs
for select
to authenticated
using (public.is_org_admin(org_id));

drop policy if exists audit_logs_member_insert on public.audit_logs;
create policy audit_logs_member_insert
on public.audit_logs
for insert
to authenticated
with check (public.is_org_member(org_id));
