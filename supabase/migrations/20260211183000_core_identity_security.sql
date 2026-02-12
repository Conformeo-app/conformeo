-- Core identity & security module
-- Auth + profiles + RBAC + MFA helper + sessions audit

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists phone text,
  add column if not exists role text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('ADMIN', 'MANAGER', 'FIELD'));
  end if;
exception
  when duplicate_object then null;
end
$$;

update public.profiles p
set updated_at = coalesce(p.updated_at, p.created_at, now())
where p.updated_at is null;

update public.profiles p
set org_id = m.org_id,
    role = case
      when m.role in ('owner', 'admin') then 'ADMIN'
      when m.role = 'manager' then 'MANAGER'
      else 'FIELD'
    end,
    updated_at = now()
from (
  select distinct on (om.user_id)
    om.user_id,
    om.org_id,
    om.role
  from public.org_members om
  order by om.user_id, om.created_at asc
) m
where p.user_id = m.user_id
  and (p.org_id is null or p.role is null);

update public.profiles
set role = 'FIELD',
    updated_at = now()
where role is null;

create unique index if not exists idx_profiles_user_org
  on public.profiles(user_id, org_id);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key in ('admin', 'manager', 'field')),
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  role_key text not null check (role_key in ('admin', 'manager', 'field')),
  permission text not null check (length(trim(permission)) > 0),
  created_at timestamptz not null default now(),
  unique (org_id, role_key, permission)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'role_permissions_role_fk'
      and conrelid = 'public.role_permissions'::regclass
  ) then
    alter table public.role_permissions
      add constraint role_permissions_role_fk
      foreign key (org_id, role_key)
      references public.roles(org_id, key)
      on delete cascade;
  end if;
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.sessions_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id text not null,
  device_id text not null,
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, org_id, session_id)
);

create index if not exists idx_sessions_audit_user_org_seen
  on public.sessions_audit(user_id, org_id, last_seen_at desc);

create index if not exists idx_sessions_audit_session
  on public.sessions_audit(session_id);

alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.sessions_audit enable row level security;

-- Profiles RLS (multi-tenant)
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (
  user_id = auth.uid()
  and (org_id is null or public.is_org_member(org_id))
);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (org_id is null or public.is_org_member(org_id))
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (
  user_id = auth.uid()
  and (org_id is null or public.is_org_member(org_id))
)
with check (
  user_id = auth.uid()
  and (org_id is null or public.is_org_member(org_id))
);

-- RBAC tables RLS
drop policy if exists roles_member_read on public.roles;
create policy roles_member_read
on public.roles
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists roles_admin_write on public.roles;
create policy roles_admin_write
on public.roles
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

drop policy if exists role_permissions_member_read on public.role_permissions;
create policy role_permissions_member_read
on public.role_permissions
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists role_permissions_admin_write on public.role_permissions;
create policy role_permissions_admin_write
on public.role_permissions
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

-- Sessions audit RLS
drop policy if exists sessions_audit_select_self on public.sessions_audit;
create policy sessions_audit_select_self
on public.sessions_audit
for select
to authenticated
using (
  user_id = auth.uid()
  and public.is_org_member(org_id)
);

drop policy if exists sessions_audit_insert_self on public.sessions_audit;
create policy sessions_audit_insert_self
on public.sessions_audit
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_org_member(org_id)
);

drop policy if exists sessions_audit_update_self on public.sessions_audit;
create policy sessions_audit_update_self
on public.sessions_audit
for update
to authenticated
using (
  user_id = auth.uid()
  and public.is_org_member(org_id)
)
with check (
  user_id = auth.uid()
  and public.is_org_member(org_id)
);

drop policy if exists sessions_audit_delete_self on public.sessions_audit;
create policy sessions_audit_delete_self
on public.sessions_audit
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.is_org_member(org_id)
);

-- Seed default role definitions for every org
insert into public.roles (org_id, key, name)
select o.id, seed.key, seed.name
from public.organizations o
cross join (
  values
    ('admin', 'Administrateur'),
    ('manager', 'Manager'),
    ('field', 'Terrain')
) as seed(key, name)
on conflict (org_id, key) do nothing;

-- Seed default permissions (can be edited per org)
insert into public.role_permissions (org_id, role_key, permission)
select o.id, seed.role_key, seed.permission
from public.organizations o
cross join (
  values
    ('admin', '*'),

    ('manager', 'tasks:*'),
    ('manager', 'media:*'),
    ('manager', 'documents:*'),
    ('manager', 'exports:*'),
    ('manager', 'control:*'),
    ('manager', 'offline:read'),
    ('manager', 'security:read'),

    ('field', 'tasks:read'),
    ('field', 'tasks:write'),
    ('field', 'media:read'),
    ('field', 'media:write'),
    ('field', 'documents:read'),
    ('field', 'documents:write'),
    ('field', 'exports:read'),
    ('field', 'control:read'),
    ('field', 'offline:read')
) as seed(role_key, permission)
on conflict (org_id, role_key, permission) do nothing;

create or replace function public.is_admin_mfa_required(target_org uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_has_totp boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_org_member(target_org) then
    raise exception 'forbidden: user is not org member';
  end if;

  select exists (
    select 1
    from public.org_members m
    where m.org_id = target_org
      and m.user_id = v_user_id
      and m.role in ('owner', 'admin')
  )
  into v_is_admin;

  if not v_is_admin then
    return false;
  end if;

  if to_regclass('auth.mfa_factors') is null then
    return true;
  end if;

  select exists (
    select 1
    from auth.mfa_factors f
    where f.user_id = v_user_id
      and f.factor_type = 'totp'
      and f.status = 'verified'
  )
  into v_has_totp;

  return not v_has_totp;
end;
$$;

revoke all on function public.is_admin_mfa_required(uuid) from public;
grant execute on function public.is_admin_mfa_required(uuid) to authenticated;
