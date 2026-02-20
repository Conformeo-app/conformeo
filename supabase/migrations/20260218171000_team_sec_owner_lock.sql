-- TEAM-SEC-04-owner-lock-self-demotion
-- Guardrails for org membership role changes:
-- - Prevent self role change
-- - Lock OWNER role from modifications/removal
-- - Prevent removing/demoting the last admin/owner
-- - Ensure changes are auditable
-- - Prevent direct writes to org_members from authenticated clients (RPC only)

create or replace function public.org_change_user_role(
  p_org_id uuid,
  p_target_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := lower(trim(coalesce(p_role, '')));
  v_current_role text;
  v_remaining_admins integer;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if p_target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  perform public.assert_org_admin(p_org_id);

  if p_target_user_id = v_actor then
    raise exception 'SELF_ROLE_CHANGE_FORBIDDEN';
  end if;

  -- Do not allow assigning OWNER via this RPC.
  if v_role not in ('admin', 'manager', 'inspector', 'viewer') then
    raise exception 'invalid role';
  end if;

  select m.role
  into v_current_role
  from public.org_members m
  where m.org_id = p_org_id
    and m.user_id = p_target_user_id
  limit 1;

  if v_current_role is null then
    raise exception 'org member not found';
  end if;

  if v_current_role = 'owner' then
    raise exception 'OWNER_ROLE_LOCKED';
  end if;

  if v_current_role = 'admin' and v_role <> 'admin' then
    select count(*)
    into v_remaining_admins
    from public.org_members m
    where m.org_id = p_org_id
      and m.role in ('owner', 'admin')
      and m.user_id <> p_target_user_id;

    if coalesce(v_remaining_admins, 0) <= 0 then
      raise exception 'LAST_ADMIN_FORBIDDEN';
    end if;
  end if;

  update public.org_members
  set role = v_role,
      status = 'ACTIVE',
      joined_at = coalesce(joined_at, now())
  where org_id = p_org_id
    and user_id = p_target_user_id;

  if not found then
    raise exception 'org member not found';
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.member.role.change',
    'org_member',
    p_target_user_id::text,
    jsonb_build_object(
      'old_role', v_current_role,
      'new_role', v_role,
      'target_user_id', p_target_user_id
    )
  );
end;
$$;

revoke all on function public.org_change_user_role(uuid, uuid, text) from public;
grant execute on function public.org_change_user_role(uuid, uuid, text) to authenticated;

-- Backward-compat: keep existing RPC name used by the app.
create or replace function public.set_org_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.org_change_user_role(p_org_id, p_user_id, p_role);
end;
$$;

revoke all on function public.set_org_member_role(uuid, uuid, text) from public;
grant execute on function public.set_org_member_role(uuid, uuid, text) to authenticated;

create or replace function public.org_remove_member(
  p_org_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target_role text;
  v_remaining_admins integer;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  perform public.assert_org_admin(p_org_id);

  if p_user_id = v_actor then
    raise exception 'SELF_MEMBER_REMOVE_FORBIDDEN';
  end if;

  select m.role
  into v_target_role
  from public.org_members m
  where m.org_id = p_org_id
    and m.user_id = p_user_id
  limit 1;

  if v_target_role is null then
    raise exception 'org member not found';
  end if;

  if v_target_role = 'owner' then
    raise exception 'OWNER_ROLE_LOCKED';
  end if;

  if v_target_role = 'admin' then
    select count(*)
    into v_remaining_admins
    from public.org_members m
    where m.org_id = p_org_id
      and m.role in ('owner', 'admin')
      and m.user_id <> p_user_id;

    if coalesce(v_remaining_admins, 0) <= 0 then
      raise exception 'LAST_ADMIN_FORBIDDEN';
    end if;
  end if;

  delete from public.team_members tm
  using public.teams t
  where t.id = tm.team_id
    and t.org_id = p_org_id
    and tm.user_id = p_user_id;

  delete from public.org_members
  where org_id = p_org_id
    and user_id = p_user_id;

  if not found then
    raise exception 'org member not found';
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.member.remove',
    'org_member',
    p_user_id::text,
    jsonb_build_object(
      'old_role', v_target_role,
      'target_user_id', p_user_id
    )
  );
end;
$$;

revoke all on function public.org_remove_member(uuid, uuid) from public;
grant execute on function public.org_remove_member(uuid, uuid) to authenticated;

-- Backward-compat: keep existing RPC name used by the app.
create or replace function public.remove_org_member(
  p_org_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.org_remove_member(p_org_id, p_user_id);
end;
$$;

revoke all on function public.remove_org_member(uuid, uuid) from public;
grant execute on function public.remove_org_member(uuid, uuid) to authenticated;

-- Ensure a single OWNER per org (defensive). Any additional OWNER rows become ADMIN.
with owner_rows as (
  select
    org_id,
    user_id,
    row_number() over (partition by org_id order by created_at asc) as rn
  from public.org_members
  where role = 'owner'
)
update public.org_members m
set role = 'admin'
from owner_rows o
where m.org_id = o.org_id
  and m.user_id = o.user_id
  and o.rn > 1;

create unique index if not exists idx_org_members_unique_owner
on public.org_members(org_id)
where role = 'owner';

-- Harden RLS: prevent direct writes to org_members from the client.
drop policy if exists org_members_manage_admin on public.org_members;

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
