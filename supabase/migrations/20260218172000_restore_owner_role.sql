-- SEC-06-restore-owner-role
--
-- Goal: allow the organization creator to restore the OWNER membership when it was lost,
-- without allowing multiple owners.
--
-- In Conforméo v0, the OWNER concept is stored in `public.org_members.role = 'owner'`.
-- This RPC is a controlled rescue path:
-- - Only the organization creator (organizations.created_by) can call it.
-- - If an OWNER already exists and it's not the caller -> reject.
-- - If no OWNER exists -> promote the caller to OWNER.
-- - Also aligns `public.user_roles` to the built-in `admin` role (RBAC v2),
--   so permissions become consistent again.

create extension if not exists pgcrypto;

alter table public.organizations
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Backfill created_by for existing orgs (best-effort).
update public.organizations o
set created_by = (
  select m.user_id
  from public.org_members m
  where m.org_id = o.id
  order by m.created_at asc
  limit 1
)
where o.created_by is null;

-- Ensure bootstrap_organization sets created_by.
create or replace function public.bootstrap_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_name text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_name := trim(coalesce(org_name, ''));
  if length(v_name) < 2 then
    raise exception 'Organization name is too short';
  end if;

  insert into public.organizations(name, created_by)
  values (v_name, v_user_id)
  returning id into v_org_id;

  insert into public.org_members(org_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');

  return v_org_id;
end;
$$;

revoke all on function public.bootstrap_organization(text) from public;
grant execute on function public.bootstrap_organization(text) to authenticated;

create or replace function public.org_restore_owner(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_created_by uuid;
  v_existing_owner uuid;
  v_admin_role_id uuid;
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

  select o.created_by
  into v_created_by
  from public.organizations o
  where o.id = p_org_id
  limit 1;

  if v_created_by is null then
    -- Safety net for legacy orgs: fallback to first org member.
    select m.user_id
    into v_created_by
    from public.org_members m
    where m.org_id = p_org_id
    order by m.created_at asc
    limit 1;
  end if;

  if v_created_by is null then
    raise exception 'ORG_CREATOR_UNKNOWN';
  end if;

  if v_created_by <> v_actor then
    raise exception 'forbidden: only org creator can restore owner';
  end if;

  select m.user_id
  into v_existing_owner
  from public.org_members m
  where m.org_id = p_org_id
    and m.role = 'owner'
  limit 1;

  if v_existing_owner is not null and v_existing_owner <> v_actor then
    raise exception 'OWNER_ALREADY_EXISTS';
  end if;

  if v_existing_owner is null then
    update public.org_members
    set role = 'owner',
        status = 'ACTIVE',
        joined_at = coalesce(joined_at, now())
    where org_id = p_org_id
      and user_id = v_actor;

    if not found then
      raise exception 'org member not found';
    end if;
  end if;

  -- Align RBAC v2 (user_roles) to built-in admin role.
  insert into public.roles (org_id, key, name, is_system, created_at, updated_at)
  values (p_org_id, 'admin', 'Administrateur', true, now(), now())
  on conflict (org_id, key)
  do update set
    is_system = true,
    updated_at = now();

  select r.id
  into v_admin_role_id
  from public.roles r
  where r.org_id = p_org_id
    and r.key = 'admin'
  limit 1;

  if v_admin_role_id is not null and to_regclass('public.user_roles') is not null then
    insert into public.user_roles (user_id, org_id, role_id, created_at, updated_at)
    values (v_actor, p_org_id, v_admin_role_id, now(), now())
    on conflict (user_id, org_id)
    do update set
      role_id = excluded.role_id,
      updated_at = now();
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.owner.restore',
    'org_member',
    v_actor::text,
    jsonb_build_object('org_id', p_org_id)
  );

  return jsonb_build_object(
    'status', 'OK',
    'org_id', p_org_id,
    'owner_user_id', v_actor
  );
end;
$$;

revoke all on function public.org_restore_owner(uuid) from public;
grant execute on function public.org_restore_owner(uuid) to authenticated;

-- Harden: user_roles writes should go through RPCs only.
drop policy if exists user_roles_admin_write on public.user_roles;

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

