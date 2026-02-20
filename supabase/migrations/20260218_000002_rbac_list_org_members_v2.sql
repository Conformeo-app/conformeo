-- =========================================
-- list_org_members v2 (RBAC-aware)
-- Retourne la liste des membres + rôle effectif
-- Source role:
--   1) member_roles -> roles.key
--   2) fallback org_members.role
-- + garde les invitations en attente.
-- =========================================

create or replace function public.list_org_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  status text,
  invited_at timestamptz,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden';
  end if;

  return query
  select
    om.user_id,
    lower(coalesce(u.email, om.invited_email)) as email,
    coalesce(
      case lower(coalesce(r.key, ''))
        when 'field' then 'inspector'
        when 'read_only' then 'viewer'
        when 'readonly' then 'viewer'
        else nullif(lower(r.key), '')
      end,
      lower(om.role),
      'viewer'
    ) as role,
    coalesce(om.status, 'ACTIVE') as status,
    coalesce(om.invited_at, om.created_at, now()) as invited_at,
    om.joined_at
  from public.org_members om
  left join auth.users u on u.id = om.user_id
  left join public.member_roles mr
    on mr.org_id = om.org_id and mr.user_id = om.user_id
  left join public.roles r
    on r.id = mr.role_id
  where om.org_id = p_org_id

  union all

  select
    i.invited_user_id as user_id,
    lower(i.email) as email,
    lower(coalesce(i.role, 'viewer')) as role,
    coalesce(i.status, 'INVITED') as status,
    coalesce(i.invited_at, now()) as invited_at,
    i.joined_at
  from public.org_member_invites i
  where i.org_id = p_org_id
    and coalesce(i.status, 'INVITED') = 'INVITED'

  order by invited_at asc;
end;
$$;

revoke all on function public.list_org_members(uuid) from public;
grant execute on function public.list_org_members(uuid) to authenticated;
