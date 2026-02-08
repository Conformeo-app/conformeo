-- Atomic bootstrap for first organization + owner membership.

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

  insert into public.organizations(name)
  values (v_name)
  returning id into v_org_id;

  insert into public.org_members(org_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');

  return v_org_id;
end;
$$;

revoke all on function public.bootstrap_organization(text) from public;
grant execute on function public.bootstrap_organization(text) to authenticated;
