-- Supabase Storage: bucket + RLS policies for media uploads.
-- The app writes objects using the following path convention:
--   {org_id}/{project_id}/{YYYY-MM-DD}/{asset_id}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'conformeo-media',
  'conformeo-media',
  false,
  26214400, -- 25 MB
  array['image/webp', 'image/jpeg', 'application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
-- Allow authenticated users to read the bucket metadata (required by storage APIs).
drop policy if exists conformeo_media_bucket_read on storage.buckets;
create policy conformeo_media_bucket_read
on storage.buckets
for select
to authenticated
using (id = 'conformeo-media');

-- Objects: allow org members to read/write objects scoped by the first path segment.
-- We guard the cast with a UUID regex to avoid runtime cast errors.

drop policy if exists conformeo_media_objects_read on storage.objects;
create policy conformeo_media_objects_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'conformeo-media'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists conformeo_media_objects_insert on storage.objects;
create policy conformeo_media_objects_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'conformeo-media'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists conformeo_media_objects_update on storage.objects;
create policy conformeo_media_objects_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'conformeo-media'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
)
with check (
  bucket_id = 'conformeo-media'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists conformeo_media_objects_delete on storage.objects;
create policy conformeo_media_objects_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'conformeo-media'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);
