-- External sharing (read-only links) for documents/exports.
-- Links are expiring + revocable, and only store a token hash.

create or replace function public.is_org_manager(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members member
    where member.org_id = target_org
      and member.user_id = auth.uid()
      and member.role in ('owner', 'admin', 'manager')
  );
$$;

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  entity text not null check (entity in ('DOCUMENT', 'EXPORT')),
  entity_id text not null,

  resource_bucket text not null,
  resource_path text not null,

  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,

  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint share_links_token_hash_sha256 check (token_hash ~* '^[0-9a-f]{64}$'),
  constraint share_links_resource_scoped check (resource_path like (org_id::text || '/%'))
);

create unique index if not exists idx_share_links_token_hash
  on public.share_links(token_hash);

create index if not exists idx_share_links_org_entity
  on public.share_links(org_id, entity, entity_id, created_at desc);

create index if not exists idx_share_links_org_active
  on public.share_links(org_id, revoked_at, expires_at);

alter table public.share_links enable row level security;

drop policy if exists share_links_member_read on public.share_links;
create policy share_links_member_read
on public.share_links
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists share_links_manager_insert on public.share_links;
create policy share_links_manager_insert
on public.share_links
for insert
to authenticated
with check (public.is_org_manager(org_id));

drop policy if exists share_links_manager_update on public.share_links;
create policy share_links_manager_update
on public.share_links
for update
to authenticated
using (public.is_org_manager(org_id))
with check (public.is_org_manager(org_id));

-- Storage bucket for exports artifacts (PDF/ZIP) to enable external sharing.
-- The app writes objects using the following path convention:
--   {org_id}/{project_id}/{YYYY-MM-DD}/{export_job_id}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'conformeo-exports',
  'conformeo-exports',
  false,
  262144000, -- 250 MB
  array['application/pdf', 'application/zip']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Allow authenticated users to read the bucket metadata (required by storage APIs).
drop policy if exists conformeo_exports_bucket_read on storage.buckets;
create policy conformeo_exports_bucket_read
on storage.buckets
for select
to authenticated
using (id = 'conformeo-exports');

-- Objects: allow org members to read/write objects scoped by the first path segment.
-- We guard the cast with a UUID regex to avoid runtime cast errors.

drop policy if exists conformeo_exports_objects_read on storage.objects;
create policy conformeo_exports_objects_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'conformeo-exports'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists conformeo_exports_objects_insert on storage.objects;
create policy conformeo_exports_objects_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'conformeo-exports'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists conformeo_exports_objects_update on storage.objects;
create policy conformeo_exports_objects_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'conformeo-exports'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
)
with check (
  bucket_id = 'conformeo-exports'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists conformeo_exports_objects_delete on storage.objects;
create policy conformeo_exports_objects_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'conformeo-exports'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);
