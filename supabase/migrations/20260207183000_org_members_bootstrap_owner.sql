-- Allow secure bootstrap of first org owner membership.

drop policy if exists org_members_manage_admin on public.org_members;

create policy org_members_manage_admin
on public.org_members
for all
to authenticated
using (public.is_org_admin(org_id))
with check (
  public.is_org_admin(org_id)
  or (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (
      select 1
      from public.org_members existing
      where existing.org_id = org_members.org_id
    )
  )
);
