-- SEC-02b-org-roles-superadmin
-- Extend org RBAC to support custom roles + user role assignments.
-- Add super-admin permissions and harden impersonation sessions (support_sessions).
--
-- Notes:
-- - This migration is idempotent and compatible with existing v0 tables:
--   public.roles (org_id, key) + public.role_permissions (org_id, role_key, permission)
-- - We add role_id + permission_key for v2 without breaking v0 reads.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Org RBAC v2 (custom roles)
-- -----------------------------------------------------------------------------

alter table public.roles
  add column if not exists is_system boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Allow custom role keys (drop the v0 check constraint).
alter table public.roles drop constraint if exists roles_key_check;

-- Mark built-in roles as system roles.
update public.roles
set is_system = true,
    updated_at = now()
where key in ('admin', 'manager', 'field')
  and is_system is distinct from true;

alter table public.role_permissions
  add column if not exists role_id uuid,
  add column if not exists permission_key text;

-- Allow custom role keys (drop the v0 check constraint).
alter table public.role_permissions drop constraint if exists role_permissions_role_key_check;

-- Backfill v2 columns from v0 columns.
update public.role_permissions rp
set
  role_id = coalesce(
    rp.role_id,
    (
      select r.id
      from public.roles r
      where r.org_id = rp.org_id
        and r.key = rp.role_key
      limit 1
    )
  ),
  permission_key = coalesce(rp.permission_key, rp.permission)
where rp.role_id is null
   or rp.permission_key is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'role_permissions_role_id_fk'
      and conrelid = 'public.role_permissions'::regclass
  ) then
    alter table public.role_permissions
      add constraint role_permissions_role_id_fk
      foreign key (role_id)
      references public.roles(id)
      on delete cascade;
  end if;
exception
  when duplicate_object then null;
end
$$;

create unique index if not exists idx_role_permissions_role_id_permission_key
  on public.role_permissions(role_id, permission_key)
  where role_id is not null and permission_key is not null;

-- Keep v0/v2 columns aligned (so legacy client code keeps working during rollout).
create or replace function public.sync_role_permissions_compat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
begin
  if new.role_id is null then
    if new.org_id is null or coalesce(trim(new.role_key), '') = '' then
      raise exception 'role_permissions requires role_id or (org_id, role_key)';
    end if;

    select *
    into v_role
    from public.roles r
    where r.org_id = new.org_id
      and r.key = new.role_key
    limit 1;

    if v_role.id is null then
      raise exception 'unknown role_key % for org %', new.role_key, new.org_id;
    end if;

    new.role_id := v_role.id;
  else
    select *
    into v_role
    from public.roles r
    where r.id = new.role_id
    limit 1;

    if v_role.id is null then
      raise exception 'unknown role_id %', new.role_id;
    end if;

    new.org_id := v_role.org_id;
    new.role_key := v_role.key;
  end if;

  new.permission_key := coalesce(nullif(trim(new.permission_key), ''), nullif(trim(new.permission), ''));
  new.permission := coalesce(nullif(trim(new.permission), ''), new.permission_key);

  if coalesce(trim(new.permission_key), '') = '' then
    raise exception 'role_permissions.permission_key is required';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_role_permissions_compat on public.role_permissions;
create trigger trg_role_permissions_compat
before insert or update on public.role_permissions
for each row
execute function public.sync_role_permissions_compat();

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index if not exists idx_user_roles_org on public.user_roles(org_id, user_id);

alter table public.user_roles enable row level security;

drop policy if exists user_roles_member_read on public.user_roles;
create policy user_roles_member_read
on public.user_roles
for select
to authenticated
using (
  public.is_org_member(org_id)
  and (user_id = auth.uid() or public.is_org_admin(org_id))
);

drop policy if exists user_roles_admin_write on public.user_roles;
create policy user_roles_admin_write
on public.user_roles
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

create or replace function public.sync_user_roles_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_org uuid;
begin
  if new.org_id is null then
    raise exception 'user_roles.org_id is required';
  end if;
  if new.user_id is null then
    raise exception 'user_roles.user_id is required';
  end if;
  if new.role_id is null then
    raise exception 'user_roles.role_id is required';
  end if;

  select r.org_id
  into v_role_org
  from public.roles r
  where r.id = new.role_id
  limit 1;

  if v_role_org is null or v_role_org <> new.org_id then
    raise exception 'user_roles.role_id does not belong to org_id';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_roles_validate on public.user_roles;
create trigger trg_user_roles_validate
before insert or update on public.user_roles
for each row
execute function public.sync_user_roles_validate();

-- Convenience: compute effective role id for current user (or fallback to system roles).
create or replace function public.get_effective_role_id(p_org_id uuid, p_user_id uuid default auth.uid())
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := p_user_id;
  v_role_id uuid;
  v_role_key text;
begin
  if v_user_id is null or p_org_id is null then
    return null;
  end if;

  if not public.is_org_member(p_org_id) then
    return null;
  end if;

  select ur.role_id
  into v_role_id
  from public.user_roles ur
  where ur.org_id = p_org_id
    and ur.user_id = v_user_id
  limit 1;

  if v_role_id is not null then
    return v_role_id;
  end if;

  select
    case
      when exists (
        select 1 from public.org_members m
        where m.org_id = p_org_id and m.user_id = v_user_id and m.role in ('owner', 'admin')
      ) then 'admin'
      when exists (
        select 1 from public.org_members m
        where m.org_id = p_org_id and m.user_id = v_user_id and m.role = 'manager'
      ) then 'manager'
      else 'field'
    end
  into v_role_key;

  select r.id
  into v_role_id
  from public.roles r
  where r.org_id = p_org_id
    and r.key = v_role_key
  limit 1;

  return v_role_id;
end;
$$;

revoke all on function public.get_effective_role_id(uuid, uuid) from public;
grant execute on function public.get_effective_role_id(uuid, uuid) to authenticated;

-- Update permission helpers to use role_id when available (custom roles).
create or replace function public.permission_matches(p_required text, p_granted text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_required text := trim(coalesce(p_required, ''));
  v_granted text := trim(coalesce(p_granted, ''));
begin
  if v_required = '' or v_granted = '' then
    return false;
  end if;

  if v_granted = '*' then
    return true;
  end if;

  if v_granted = v_required then
    return true;
  end if;

  -- Wildcard: "prefix:*"
  if right(v_granted, 2) = ':*' then
    return position(left(v_granted, length(v_granted) - 1) in v_required) = 1;
  end if;

  return false;
end;
$$;

create or replace function public.has_permission(p_org_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_id uuid;
begin
  if v_user_id is null or p_org_id is null then
    return false;
  end if;

  if not public.is_org_member(p_org_id) then
    return false;
  end if;

  v_role_id := public.get_effective_role_id(p_org_id, v_user_id);
  if v_role_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.role_permissions rp
    where rp.role_id = v_role_id
      and public.permission_matches(p_permission, coalesce(rp.permission_key, rp.permission))
  );
end;
$$;

revoke all on function public.permission_matches(text, text) from public;
revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.permission_matches(text, text) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- Admin RPCs for managing org roles (with audit).
create or replace function public.create_org_role(p_org_id uuid, p_name text, p_based_on_role_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_key text;
  v_try integer := 0;
begin
  perform public.assert_org_admin(p_org_id);

  if coalesce(length(trim(p_name)), 0) = 0 then
    raise exception 'role name is required';
  end if;

  -- Generate a stable-ish key (slug) for the org.
  v_key := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_key := regexp_replace(v_key, '^_+|_+$', '', 'g');
  if v_key = '' then
    v_key := 'role_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  loop
    begin
      insert into public.roles(org_id, key, name, is_system, created_at, updated_at)
      values (p_org_id, v_key, trim(p_name), false, now(), now())
      returning id into v_role_id;
      exit;
    exception
      when unique_violation then
        v_try := v_try + 1;
        if v_try > 5 then
          raise exception 'cannot create role: key collision';
        end if;
        v_key := v_key || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
    end;
  end loop;

  if p_based_on_role_id is not null then
    insert into public.role_permissions(role_id, permission_key)
    select v_role_id, coalesce(rp.permission_key, rp.permission)
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where rp.role_id = p_based_on_role_id
      and r.org_id = p_org_id
    on conflict do nothing;
  end if;

  insert into public.audit_logs(org_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_org_id, auth.uid(), 'rbac.role.create', 'role', v_role_id::text, jsonb_build_object('name', p_name));

  return v_role_id;
end;
$$;

revoke all on function public.create_org_role(uuid, text, uuid) from public;
grant execute on function public.create_org_role(uuid, text, uuid) to authenticated;

create or replace function public.update_org_role(p_role_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select r.org_id into v_org_id from public.roles r where r.id = p_role_id;
  if v_org_id is null then
    raise exception 'role not found';
  end if;

  perform public.assert_org_admin(v_org_id);

  if coalesce(length(trim(p_name)), 0) = 0 then
    raise exception 'role name is required';
  end if;

  update public.roles
  set name = trim(p_name),
      updated_at = now()
  where id = p_role_id;

  insert into public.audit_logs(org_id, actor_user_id, action, target_type, target_id, metadata)
  values (v_org_id, auth.uid(), 'rbac.role.update', 'role', p_role_id::text, jsonb_build_object('name', p_name));
end;
$$;

revoke all on function public.update_org_role(uuid, text) from public;
grant execute on function public.update_org_role(uuid, text) to authenticated;

create or replace function public.set_org_role_permissions(p_role_id uuid, p_permissions text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_count integer := 0;
begin
  select r.org_id into v_org_id from public.roles r where r.id = p_role_id;
  if v_org_id is null then
    raise exception 'role not found';
  end if;

  perform public.assert_org_admin(v_org_id);

  delete from public.role_permissions
  where role_id = p_role_id
    and coalesce(permission_key, permission) <> '*';

  if p_permissions is not null then
    insert into public.role_permissions(role_id, permission_key)
    select p_role_id, trim(p)
    from unnest(p_permissions) as p
    where coalesce(length(trim(p)), 0) > 0
    on conflict do nothing;

    get diagnostics v_count = row_count;
  end if;

  insert into public.audit_logs(org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    v_org_id,
    auth.uid(),
    'rbac.role.set_permissions',
    'role',
    p_role_id::text,
    jsonb_build_object('count', coalesce(array_length(p_permissions, 1), 0))
  );

  return v_count;
end;
$$;

revoke all on function public.set_org_role_permissions(uuid, text[]) from public;
grant execute on function public.set_org_role_permissions(uuid, text[]) to authenticated;

create or replace function public.assign_org_user_role(p_org_id uuid, p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_org_admin(p_org_id);

  if not exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = p_user_id
  ) then
    raise exception 'user is not org member';
  end if;

  if not exists (
    select 1 from public.roles r
    where r.id = p_role_id and r.org_id = p_org_id
  ) then
    raise exception 'role does not belong to org';
  end if;

  insert into public.user_roles(user_id, org_id, role_id)
  values (p_user_id, p_org_id, p_role_id)
  on conflict (user_id, org_id)
  do update set role_id = excluded.role_id, updated_at = now();

  insert into public.audit_logs(org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    auth.uid(),
    'rbac.user.assign_role',
    'user_role',
    p_user_id::text,
    jsonb_build_object('role_id', p_role_id)
  );
end;
$$;

revoke all on function public.assign_org_user_role(uuid, uuid, uuid) from public;
grant execute on function public.assign_org_user_role(uuid, uuid, uuid) to authenticated;

create or replace function public.clear_org_user_role(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_org_admin(p_org_id);

  delete from public.user_roles
  where org_id = p_org_id and user_id = p_user_id;

  insert into public.audit_logs(org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    auth.uid(),
    'rbac.user.clear_role',
    'user_role',
    p_user_id::text,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.clear_org_user_role(uuid, uuid) from public;
grant execute on function public.clear_org_user_role(uuid, uuid) to authenticated;

-- Ensure new baseline permissions exist for projects/team/org management (idempotent).
insert into public.role_permissions (org_id, role_key, permission)
select o.id, seed.role_key, seed.permission
from public.organizations o
cross join (
  values
    ('manager', 'projects:read'),
    ('manager', 'projects:write'),
    ('manager', 'team:read'),
    ('manager', 'team:write'),
    ('manager', 'org:read'),

    ('field', 'projects:read'),
    ('field', 'team:read'),
    ('field', 'org:read')
) as seed(role_key, permission)
on conflict (org_id, role_key, permission) do nothing;

-- -----------------------------------------------------------------------------
-- Super-admin permissions (separate namespace: sa.*)
-- -----------------------------------------------------------------------------

create table if not exists public.super_admin_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null check (length(trim(permission_key)) > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, permission_key)
);

alter table public.super_admin_permissions enable row level security;

drop policy if exists super_admin_permissions_select on public.super_admin_permissions;
create policy super_admin_permissions_select
on public.super_admin_permissions
for select
to authenticated
using (public.is_super_admin());

drop policy if exists super_admin_permissions_insert_deny on public.super_admin_permissions;
create policy super_admin_permissions_insert_deny
on public.super_admin_permissions
for insert
to authenticated
with check (false);

drop policy if exists super_admin_permissions_update_deny on public.super_admin_permissions;
create policy super_admin_permissions_update_deny
on public.super_admin_permissions
for update
to authenticated
using (false)
with check (false);

drop policy if exists super_admin_permissions_delete_deny on public.super_admin_permissions;
create policy super_admin_permissions_delete_deny
on public.super_admin_permissions
for delete
to authenticated
using (false);

-- Seed: grant a baseline set of permissions to current allowlisted super-admins (can be tightened later).
insert into public.super_admin_permissions(user_id, permission_key)
select sa.user_id, seed.permission_key
from public.super_admins sa
cross join (
  values
    ('sa.orgs.view'),
    ('sa.orgs.impersonate'),
    ('sa.support.access'),
    ('sa.billing.view'),
    ('sa.billing.manage'),
    ('sa.logs.view'),
    ('sa.flags.override'),
    ('sa.data.export'),
    ('sa.emergency.actions')
) as seed(permission_key)
on conflict (user_id, permission_key) do nothing;

-- -----------------------------------------------------------------------------
-- Impersonation sessions hardening (support_sessions)
-- -----------------------------------------------------------------------------

alter table public.support_sessions
  add column if not exists revoked_at timestamptz;

create index if not exists idx_support_sessions_org_expires
  on public.support_sessions(org_id, expires_at desc);

create or replace function public.is_support_session_active(p_session_id uuid, p_org_id uuid, p_target_user_id uuid, p_super_admin_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.support_sessions s
    where s.id = p_session_id
      and s.org_id = p_org_id
      and s.target_user_id = p_target_user_id
      and s.ended_at is null
      and s.revoked_at is null
      and s.expires_at > now()
      and (p_super_admin_user_id is null or s.admin_user_id = p_super_admin_user_id)
  );
$$;

revoke all on function public.is_support_session_active(uuid, uuid, uuid, uuid) from public;
grant execute on function public.is_support_session_active(uuid, uuid, uuid, uuid) to authenticated;

-- Harden org helpers: when using an impersonation token, membership is granted only if
-- the support session is active (revocation ends access immediately).
create or replace function public.is_org_member(target_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_sa_user_id uuid;
begin
  if v_user_id is null or target_org is null then
    return false;
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'impersonation_session_id', '')::uuid;
  exception
    when others then v_session_id := null;
  end;

  if v_session_id is not null then
    begin
      v_sa_user_id := nullif(auth.jwt() ->> 'sa_user_id', '')::uuid;
    exception
      when others then v_sa_user_id := null;
    end;

    return public.is_support_session_active(v_session_id, target_org, v_user_id, v_sa_user_id)
      and exists (
        select 1
        from public.org_members member
        where member.org_id = target_org
          and member.user_id = v_user_id
      );
  end if;

  return exists (
    select 1
    from public.org_members member
    where member.org_id = target_org
      and member.user_id = v_user_id
  );
end;
$$;

create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org)
    and exists (
      select 1
      from public.org_members member
      where member.org_id = target_org
        and member.user_id = auth.uid()
        and member.role in ('owner', 'admin')
    );
$$;
