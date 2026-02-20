-- Chantiers: restore member-based access so mobile can bootstrap/sync projects.
-- Context: Projects list depends on remote read from public.projects and public.sync_shadow.

alter table public.projects enable row level security;

-- Clean existing project policies (legacy + RBAC variants).
drop policy if exists projects_member_read on public.projects;
drop policy if exists projects_member_write on public.projects;
drop policy if exists projects_read on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
drop policy if exists projects_select_member on public.projects;
drop policy if exists projects_insert_member on public.projects;
drop policy if exists projects_update_member on public.projects;

-- SELECT: org member can read projects in its org.
create policy projects_select_member
on public.projects for select
to authenticated
using (
  exists (
    select 1
    from public.org_members om
    where om.org_id = projects.org_id
      and om.user_id = auth.uid()
  )
);

-- INSERT: org member can create projects in its org.
create policy projects_insert_member
on public.projects for insert
to authenticated
with check (
  exists (
    select 1
    from public.org_members om
    where om.org_id = projects.org_id
      and om.user_id = auth.uid()
  )
);

-- UPDATE: org member can update projects in its org.
create policy projects_update_member
on public.projects for update
to authenticated
using (
  exists (
    select 1
    from public.org_members om
    where om.org_id = projects.org_id
      and om.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.org_members om
    where om.org_id = projects.org_id
      and om.user_id = auth.uid()
  )
);

alter table public.sync_shadow enable row level security;

-- Ensure select policy on sync_shadow follows org membership.
drop policy if exists sync_shadow_member_read on public.sync_shadow;
drop policy if exists sync_shadow_select_member on public.sync_shadow;

create policy sync_shadow_select_member
on public.sync_shadow for select
to authenticated
using (
  exists (
    select 1
    from public.org_members om
    where om.org_id = sync_shadow.org_id
      and om.user_id = auth.uid()
  )
);
