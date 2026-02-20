-- Fix profiles schema to support multi-tenant profiles (one row per user + org).
--
-- Before (v0/v1): public.profiles(user_id PK, display_name, created_at, ...)
-- v1 added org_id + role + phone, but kept PK on user_id -> impossible to store multiple org profiles.
--
-- After (v2): public.profiles(id PK uuid) + unique(user_id, org_id)
-- - Backward compatible: existing rows are preserved.
-- - RLS: users can always read/update their own profiles; org_id changes are still gated by is_org_member(org_id).

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists id uuid;

update public.profiles
set id = gen_random_uuid()
where id is null;

alter table public.profiles
  alter column id set default gen_random_uuid(),
  alter column id set not null;

do $$
declare
  pk_cols text[];
  pk_name text;
begin
  select array_agg(att.attname order by att.attname)
  into pk_cols
  from pg_index i
  join pg_attribute att on att.attrelid = i.indrelid and att.attnum = any(i.indkey)
  where i.indrelid = 'public.profiles'::regclass
    and i.indisprimary;

  if pk_cols is null or pk_cols <> array['id'] then
    -- Drop any existing PK (commonly profiles_pkey on user_id).
    for pk_name in
      select conname
      from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and contype = 'p'
    loop
      execute format('alter table public.profiles drop constraint %I', pk_name);
    end loop;

    execute 'alter table public.profiles add constraint profiles_pkey primary key (id)';
  end if;
end
$$;

create unique index if not exists idx_profiles_user_org
  on public.profiles(user_id, org_id);

alter table public.profiles enable row level security;

-- Profiles RLS (multi-tenant)
-- Note: profiles are always scoped to auth.uid(), so org_id membership checks are only needed on INSERT/UPDATE checks.

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (org_id is null or public.is_org_member(org_id))
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (org_id is null or public.is_org_member(org_id))
);

