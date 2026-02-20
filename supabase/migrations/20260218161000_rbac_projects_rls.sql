-- SEC-02b follow-up: enforce RBAC permissions at DB level for core entities.
-- Start with `projects` (Chantiers) to guarantee "no projects:view => no access".

drop policy if exists projects_member_read on public.projects;
drop policy if exists projects_member_write on public.projects;

drop policy if exists projects_read on public.projects;
create policy projects_read
on public.projects
for select
to authenticated
using (public.has_permission(org_id, 'projects:read'));

drop policy if exists projects_insert on public.projects;
create policy projects_insert
on public.projects
for insert
to authenticated
with check (public.has_permission(org_id, 'projects:write'));

drop policy if exists projects_update on public.projects;
create policy projects_update
on public.projects
for update
to authenticated
using (public.has_permission(org_id, 'projects:write'))
with check (public.has_permission(org_id, 'projects:write'));

drop policy if exists projects_delete on public.projects;
create policy projects_delete
on public.projects
for delete
to authenticated
using (public.has_permission(org_id, 'projects:write'));

