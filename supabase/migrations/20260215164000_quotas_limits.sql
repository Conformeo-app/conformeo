-- Quotas & limits (cost/perf protection)

create table if not exists public.org_quotas (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  storage_mb integer not null default 10240 check (storage_mb > 0),
  exports_per_day integer not null default 20 check (exports_per_day > 0),
  media_per_day integer not null default 500 check (media_per_day > 0),
  max_file_mb integer not null default 25 check (max_file_mb > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_usage (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  storage_used_mb numeric not null default 0,
  exports_today integer not null default 0,
  media_today integer not null default 0,
  computed_at timestamptz not null default now()
);

alter table public.org_quotas enable row level security;
alter table public.org_usage enable row level security;

-- org_quotas policies

drop policy if exists org_quotas_member_read on public.org_quotas;
create policy org_quotas_member_read
on public.org_quotas
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists org_quotas_admin_write on public.org_quotas;
create policy org_quotas_admin_write
on public.org_quotas
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

-- org_usage policies (read-only for clients)

drop policy if exists org_usage_member_read on public.org_usage;
create policy org_usage_member_read
on public.org_usage
for select
to authenticated
using (public.is_org_member(org_id));

-- Seed defaults for existing orgs
insert into public.org_quotas(org_id)
select id
from public.organizations
on conflict (org_id) do nothing;

-- Recompute usage server-side (Storage + audit logs)
create or replace function public.refresh_org_usage(p_org_id uuid)
returns public.org_usage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_storage_bytes bigint;
  v_media_today integer;
  v_exports_today integer;
  v_now timestamptz;
  v_row public.org_usage;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden: user is not org member';
  end if;

  select coalesce(
    sum(
      case
        when (o.metadata->>'size') ~ '^[0-9]+$' then (o.metadata->>'size')::bigint
        else 0
      end
    ),
    0
  )
  into v_storage_bytes
  from storage.objects o
  where o.bucket_id = 'conformeo-media'
    and split_part(o.name, '/', 1) = p_org_id::text;

  select count(*)
  into v_media_today
  from storage.objects o
  where o.bucket_id = 'conformeo-media'
    and split_part(o.name, '/', 1) = p_org_id::text
    and o.created_at >= date_trunc('day', now());

  select count(*)
  into v_exports_today
  from public.audit_logs a
  where a.org_id = p_org_id
    and a.created_at >= date_trunc('day', now())
    and a.action = 'sync.export_jobs.insert';

  v_now := now();

  insert into public.org_usage(org_id, storage_used_mb, exports_today, media_today, computed_at)
  values (
    p_org_id,
    (v_storage_bytes::numeric / 1024 / 1024),
    coalesce(v_exports_today, 0),
    coalesce(v_media_today, 0),
    v_now
  )
  on conflict (org_id) do update
    set storage_used_mb = excluded.storage_used_mb,
        exports_today = excluded.exports_today,
        media_today = excluded.media_today,
        computed_at = excluded.computed_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.refresh_org_usage(uuid) from public;
grant execute on function public.refresh_org_usage(uuid) to authenticated;
