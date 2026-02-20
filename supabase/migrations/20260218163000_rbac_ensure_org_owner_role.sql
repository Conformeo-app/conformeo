-- RBAC hydration helpers (client-safe RPCs)
--
-- Goal: ensure a consistent role/permissions set for the currently authenticated user on the active org.
-- - Creates missing system roles/permissions (idempotent).
-- - Ensures user_roles assignment exists (v2) without overriding custom roles.
-- - Returns the effective role id + permissions (for client hydration / debugging).

create extension if not exists pgcrypto;

create or replace function public.ensure_org_owner_role(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_key text;
  v_role_id uuid;
  v_permissions text[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden: user is not org member';
  end if;

  -- Ensure built-in roles exist (idempotent).
  -- roles.is_system was added in the SEC-02b migration, but this remains safe if the column exists.
  insert into public.roles (org_id, key, name, is_system, created_at, updated_at)
  values
    (p_org_id, 'admin', 'Administrateur', true, now(), now()),
    (p_org_id, 'manager', 'Manager', true, now(), now()),
    (p_org_id, 'field', 'Terrain', true, now(), now())
  on conflict (org_id, key)
  do update set
    is_system = true,
    updated_at = now();

  -- Ensure minimal permission seed exists for admin.
  -- (Other roles are seeded earlier by core migrations; this is a last-resort safety net.)
  insert into public.role_permissions (role_id, permission_key)
  select r.id, '*'
  from public.roles r
  where r.org_id = p_org_id
    and r.key = 'admin'
  on conflict do nothing;

  -- Determine effective system role from org_members (fallback).
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

  if v_role_id is null then
    raise exception 'role not found for org';
  end if;

  -- Ensure a user_roles row exists (do not override custom role assignments).
  if to_regclass('public.user_roles') is not null then
    insert into public.user_roles (user_id, org_id, role_id, created_at, updated_at)
    values (v_user_id, p_org_id, v_role_id, now(), now())
    on conflict (user_id, org_id)
    do nothing;
  end if;

  select array_agg(distinct coalesce(rp.permission_key, rp.permission) order by 1)
  into v_permissions
  from public.role_permissions rp
  where rp.role_id = v_role_id;

  return jsonb_build_object(
    'org_id', p_org_id,
    'user_id', v_user_id,
    'role_key', v_role_key,
    'role_id', v_role_id,
    'permissions', coalesce(v_permissions, array[]::text[])
  );
end;
$$;

revoke all on function public.ensure_org_owner_role(uuid) from public;
grant execute on function public.ensure_org_owner_role(uuid) to authenticated;

create or replace function public.get_my_role_permissions(p_org_id uuid)
returns table (
  role_id uuid,
  permission_key text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.get_effective_role_id(p_org_id, auth.uid()) as role_id,
    coalesce(rp.permission_key, rp.permission) as permission_key
  from public.role_permissions rp
  where rp.role_id = public.get_effective_role_id(p_org_id, auth.uid())
  order by 2;
$$;

revoke all on function public.get_my_role_permissions(uuid) from public;
grant execute on function public.get_my_role_permissions(uuid) to authenticated;

