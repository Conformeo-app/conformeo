-- Super Admin module
-- Multi-tenant console with strict access + full audit.
-- Note: never expose service_role in client apps.

create extension if not exists pgcrypto;

-- Explicit allowlist of platform super admins.
create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.super_admins sa
    where sa.user_id = auth.uid()
  );
$$;

create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_sessions_admin_started
  on public.support_sessions(admin_user_id, started_at desc);

create index if not exists idx_support_sessions_org_started
  on public.support_sessions(org_id, started_at desc);

create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (length(trim(action)) > 0),
  target text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_admin_created
  on public.admin_audit(admin_user_id, created_at desc);

alter table public.super_admins enable row level security;
alter table public.support_sessions enable row level security;
alter table public.admin_audit enable row level security;

-- Super admins can read the allowlist (for introspection), but cannot modify it from the client.
drop policy if exists super_admins_select on public.super_admins;
create policy super_admins_select
on public.super_admins
for select
to authenticated
using (public.is_super_admin());

drop policy if exists super_admins_insert_deny on public.super_admins;
create policy super_admins_insert_deny
on public.super_admins
for insert
to authenticated
with check (false);

drop policy if exists super_admins_update_deny on public.super_admins;
create policy super_admins_update_deny
on public.super_admins
for update
to authenticated
using (false)
with check (false);

drop policy if exists super_admins_delete_deny on public.super_admins;
create policy super_admins_delete_deny
on public.super_admins
for delete
to authenticated
using (false);

-- Support sessions: strict super-admin only.
drop policy if exists support_sessions_super_admin_access on public.support_sessions;
create policy support_sessions_super_admin_access
on public.support_sessions
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Admin audit: strict super-admin only (read + write).
drop policy if exists admin_audit_super_admin_access on public.admin_audit;
create policy admin_audit_super_admin_access
on public.admin_audit
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

