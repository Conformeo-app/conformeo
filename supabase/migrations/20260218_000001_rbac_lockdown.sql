-- =========================================
-- RBAC LOCKDOWN (compatible with current Conformeo schema)
-- =========================================
--
-- Goals:
-- - Force role changes through RPC only (rbac_assign_role).
-- - Keep OWNER locked and protect self-demotion/last-admin (delegated to org_change_user_role).
-- - Expose a client-safe RBAC context (rbac_get_my_context).
-- - Harden direct table writes with RLS deny policies.

create extension if not exists pgcrypto;

alter table public.roles
  add column if not exists rank integer not null default 0;

-- Auxiliary tables kept for support/debug compatibility.
create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text null
);

create table if not exists public.member_roles (
  org_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid null,
  assigned_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid null,
  actor_user_id uuid null,
  action text not null,
  target_user_id uuid null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_member_roles_org_user on public.member_roles(org_id, user_id);
create index if not exists idx_audit_log_org_created_at on public.audit_log(org_id, created_at desc);

alter table public.permissions enable row level security;
alter table public.member_roles enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists permissions_read on public.permissions;
create policy permissions_read
on public.permissions
for select
to authenticated
using (true);

drop policy if exists permissions_write_denied on public.permissions;
create policy permissions_write_denied
on public.permissions
for all
to authenticated
using (false)
with check (false);

drop policy if exists member_roles_read on public.member_roles;
create policy member_roles_read
on public.member_roles
for select
to authenticated
using (user_id = auth.uid() or public.is_org_admin(org_id));

drop policy if exists member_roles_write_denied on public.member_roles;
create policy member_roles_write_denied
on public.member_roles
for all
to authenticated
using (false)
with check (false);

drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read
on public.audit_log
for select
to authenticated
using (actor_user_id = auth.uid() or (org_id is not null and public.is_org_admin(org_id)));

drop policy if exists audit_log_write_denied on public.audit_log;
create policy audit_log_write_denied
on public.audit_log
for all
to authenticated
using (false)
with check (false);

-- Keep org_members / user_roles write-locked for clients (RPC only).
drop policy if exists org_members_insert_denied on public.org_members;
create policy org_members_insert_denied
on public.org_members
for insert
to authenticated
with check (false);

drop policy if exists org_members_update_denied on public.org_members;
create policy org_members_update_denied
on public.org_members
for update
to authenticated
using (false)
with check (false);

drop policy if exists org_members_delete_denied on public.org_members;
create policy org_members_delete_denied
on public.org_members
for delete
to authenticated
using (false);

drop policy if exists user_roles_insert_denied on public.user_roles;
create policy user_roles_insert_denied
on public.user_roles
for insert
to authenticated
with check (false);

drop policy if exists user_roles_update_denied on public.user_roles;
create policy user_roles_update_denied
on public.user_roles
for update
to authenticated
using (false)
with check (false);

drop policy if exists user_roles_delete_denied on public.user_roles;
create policy user_roles_delete_denied
on public.user_roles
for delete
to authenticated
using (false);

create or replace function public.rbac_role_key(p_org_id uuid, p_user_id uuid default auth.uid())
returns text
language sql
stable
set search_path = public
as $$
  select m.role
  from public.org_members m
  where m.org_id = p_org_id
    and m.user_id = p_user_id
  limit 1
$$;

revoke all on function public.rbac_role_key(uuid, uuid) from public;
grant execute on function public.rbac_role_key(uuid, uuid) to authenticated;

create or replace function public.rbac_get_my_context(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_member_role text;
  v_effective_role_key text;
  v_permissions text[];
  v_is_super boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden: user is not org member';
  end if;

  v_member_role := coalesce(public.rbac_role_key(p_org_id, v_actor), 'viewer');
  v_effective_role_key := case
    when v_member_role in ('owner', 'admin') then 'admin'
    when v_member_role = 'manager' then 'manager'
    else 'field'
  end;

  if to_regprocedure('public.get_my_role_permissions(uuid)') is not null then
    select array_agg(distinct g.permission_key order by g.permission_key)
    into v_permissions
    from public.get_my_role_permissions(p_org_id) g;
  else
    select array_agg(distinct coalesce(rp.permission_key, rp.permission) order by 1)
    into v_permissions
    from public.role_permissions rp
    where rp.org_id = p_org_id
      and rp.role_key = v_effective_role_key;
  end if;

  v_is_super := exists(select 1 from public.super_admins sa where sa.user_id = v_actor);

  return jsonb_build_object(
    'org_id', p_org_id,
    'user_id', v_actor,
    'role_key', v_member_role,
    'permissions', coalesce(v_permissions, array[]::text[]),
    'is_super_admin', v_is_super
  );
end;
$$;

revoke all on function public.rbac_get_my_context(uuid) from public;
grant execute on function public.rbac_get_my_context(uuid) to authenticated;

create or replace function public.rbac_assign_role(
  p_org_id uuid,
  p_target_user_id uuid,
  p_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role text := lower(trim(coalesce(p_role_key, '')));
begin
  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if p_target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  -- Owner assignment is intentionally blocked here.
  if v_target_role = 'owner' then
    raise exception 'OWNER_ROLE_LOCKED';
  elsif v_target_role in ('field', 'inspector') then
    v_target_role := 'inspector';
  elsif v_target_role in ('viewer', 'read_only', 'readonly') then
    v_target_role := 'viewer';
  elsif v_target_role not in ('admin', 'manager') then
    raise exception 'invalid role';
  end if;

  perform public.org_change_user_role(
    p_org_id,
    p_target_user_id,
    v_target_role
  );

  return jsonb_build_object(
    'status', 'ok',
    'org_id', p_org_id,
    'target_user_id', p_target_user_id,
    'role_key', v_target_role
  );
end;
$$;

revoke all on function public.rbac_assign_role(uuid, uuid, text) from public;
grant execute on function public.rbac_assign_role(uuid, uuid, text) to authenticated;
