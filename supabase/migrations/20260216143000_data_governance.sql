-- data-governance module
-- Retention policies, RGPD anonymization, and super-admin org deletion backend hooks.

create extension if not exists pgcrypto;

create table if not exists public.retention_policies (
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity text not null,
  retention_days integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (org_id, entity)
);

alter table public.retention_policies
  add column if not exists org_id uuid,
  add column if not exists entity text,
  add column if not exists retention_days integer,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid;

alter table public.retention_policies
  alter column org_id set not null,
  alter column entity set not null,
  alter column retention_days set not null,
  alter column updated_at set not null;

alter table public.retention_policies
  alter column updated_at set default now();

update public.retention_policies
set entity = upper(trim(entity))
where entity is not null;

delete from public.retention_policies
where org_id is null
   or entity is null;

update public.retention_policies
set retention_days = 1
where retention_days is null or retention_days < 1;

update public.retention_policies
set retention_days = 3650
where retention_days > 3650;

update public.retention_policies
set updated_at = now()
where updated_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'retention_policies_entity_chk'
      and conrelid = 'public.retention_policies'::regclass
  ) then
    alter table public.retention_policies
      add constraint retention_policies_entity_chk
      check (
        entity in (
          'AUDIT_LOGS',
          'EXPORT_JOBS',
          'DELETED_TASKS',
          'DELETED_DOCUMENTS',
          'RECENTS',
          'OPERATIONS_SYNCED'
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'retention_policies_days_chk'
      and conrelid = 'public.retention_policies'::regclass
  ) then
    alter table public.retention_policies
      add constraint retention_policies_days_chk
      check (retention_days between 1 and 3650);
  end if;
end
$$;

create index if not exists idx_retention_policies_org_updated
  on public.retention_policies(org_id, updated_at desc);

alter table public.retention_policies enable row level security;

drop policy if exists retention_policies_member_read on public.retention_policies;
create policy retention_policies_member_read
on public.retention_policies
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists retention_policies_admin_write on public.retention_policies;
create policy retention_policies_admin_write
on public.retention_policies
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

grant select, insert, update, delete on public.retention_policies to authenticated;

create or replace function public.touch_retention_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  new.entity := upper(trim(new.entity));
  new.updated_at := now();

  v_actor := auth.uid();
  if v_actor is not null then
    new.updated_by := v_actor;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_touch_retention_policy on public.retention_policies;
create trigger trg_touch_retention_policy
before insert or update on public.retention_policies
for each row
execute function public.touch_retention_policy();

create or replace function public.set_retention_policy(
  p_org_id uuid,
  p_entity text,
  p_retention_days integer
)
returns public.retention_policies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_entity text := upper(trim(coalesce(p_entity, '')));
  v_row public.retention_policies;
begin
  if v_actor is null then
    raise exception 'Unauthorized';
  end if;

  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if not public.is_org_admin(p_org_id) then
    raise exception 'Forbidden';
  end if;

  if v_entity = '' then
    raise exception 'entity is required';
  end if;

  if v_entity not in ('AUDIT_LOGS', 'EXPORT_JOBS', 'DELETED_TASKS', 'DELETED_DOCUMENTS', 'RECENTS', 'OPERATIONS_SYNCED') then
    raise exception 'entity is invalid: %', v_entity;
  end if;

  if p_retention_days is null or p_retention_days < 1 or p_retention_days > 3650 then
    raise exception 'retention_days out of range: %', p_retention_days;
  end if;

  insert into public.retention_policies(org_id, entity, retention_days, updated_by)
  values (p_org_id, v_entity, p_retention_days, v_actor)
  on conflict (org_id, entity)
  do update
  set retention_days = excluded.retention_days,
      updated_at = now(),
      updated_by = v_actor
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_retention_policy(uuid, text, integer) to authenticated;

create or replace function public.anonymize_user_data(
  p_org_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_alias text;
  v_count bigint := 0;
  v_updates jsonb := '{}'::jsonb;
  v_has_super_admin_fn boolean := to_regprocedure('public.is_super_admin()') is not null;
  v_is_super_admin boolean := false;
begin
  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if v_actor is null then
    raise exception 'Unauthorized';
  end if;

  if v_has_super_admin_fn then
    execute 'select public.is_super_admin()' into v_is_super_admin;
  end if;

  if not public.is_org_admin(p_org_id) and not coalesce(v_is_super_admin, false) then
    raise exception 'Forbidden';
  end if;

  v_alias := 'deleted_' || substr(encode(digest(p_user_id::text, 'sha256'), 'hex'), 1, 12);

  if to_regclass('public.profiles') is not null then
    update public.profiles
    set display_name = 'Utilisateur supprimé',
        phone = null,
        updated_at = now()
    where org_id = p_org_id
      and user_id = p_user_id;
    get diagnostics v_count = row_count;
    v_updates := v_updates || jsonb_build_object('profiles', v_count);
  end if;

  if to_regclass('public.org_members') is not null then
    delete from public.org_members
    where org_id = p_org_id
      and user_id = p_user_id;
    get diagnostics v_count = row_count;
    v_updates := v_updates || jsonb_build_object('org_members', v_count);
  end if;

  if to_regclass('public.sessions_audit') is not null then
    update public.sessions_audit
    set revoked_at = coalesce(revoked_at, now())
    where org_id = p_org_id
      and user_id = p_user_id;
    get diagnostics v_count = row_count;
    v_updates := v_updates || jsonb_build_object('sessions_audit', v_count);
  end if;

  if to_regclass('public.audit_logs') is not null then
    update public.audit_logs
    set user_id = null,
        actor_user_id = null,
        payload_json = coalesce(payload_json, '{}'::jsonb) || jsonb_build_object('anonymized', true)
    where org_id = p_org_id
      and (user_id = p_user_id or actor_user_id = p_user_id);
    get diagnostics v_count = row_count;
    v_updates := v_updates || jsonb_build_object('audit_logs', v_count);
  end if;

  if to_regclass('public.feature_flags_audit') is not null then
    update public.feature_flags_audit
    set changed_by = null
    where org_id = p_org_id
      and changed_by = p_user_id;
    get diagnostics v_count = row_count;
    v_updates := v_updates || jsonb_build_object('feature_flags_audit', v_count);
  end if;

  if to_regclass('public.retention_policies') is not null then
    update public.retention_policies
    set updated_by = null
    where org_id = p_org_id
      and updated_by = p_user_id;
    get diagnostics v_count = row_count;
    v_updates := v_updates || jsonb_build_object('retention_policies', v_count);
  end if;

  if to_regclass('public.admin_audit') is not null then
    insert into public.admin_audit(admin_user_id, action, target, payload_json)
    values (
      v_actor,
      'governance.anonymize_user',
      p_org_id::text || ':' || p_user_id::text,
      jsonb_build_object('alias', v_alias, 'updates', v_updates)
    );
  end if;

  return jsonb_build_object(
    'org_id', p_org_id,
    'user_id', p_user_id,
    'alias', v_alias,
    'updates', v_updates,
    'processed_at', now()
  );
end;
$$;

grant execute on function public.anonymize_user_data(uuid, uuid) to authenticated;

create or replace function public.super_admin_delete_org(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_table record;
  v_count bigint := 0;
  v_deleted_rows jsonb := '{}'::jsonb;
begin
  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if p_actor_user_id is null then
    raise exception 'actor_user_id is required';
  end if;

  v_expected := 'DELETE ' || p_org_id::text;
  if trim(coalesce(p_confirmation, '')) <> v_expected then
    raise exception 'invalid confirmation';
  end if;

  if not exists (select 1 from public.super_admins where user_id = p_actor_user_id) then
    raise exception 'Forbidden';
  end if;

  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'Organization not found';
  end if;

  for v_table in
    select c.relname as table_name, format('%I.%I', n.nspname, c.relname) as fq_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> 'organizations'
    order by
      case c.relname
        when 'org_members' then 1
        when 'projects' then 2
        else 50
      end,
      c.relname
  loop
    execute format('delete from %s where org_id = $1', v_table.fq_name) using p_org_id;
    get diagnostics v_count = row_count;
    v_deleted_rows := v_deleted_rows || jsonb_build_object(v_table.table_name, v_count);
  end loop;

  delete from public.organizations
  where id = p_org_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Organization not found';
  end if;

  if to_regclass('public.admin_audit') is not null then
    insert into public.admin_audit(admin_user_id, action, target, payload_json)
    values (
      p_actor_user_id,
      'admin.delete_org',
      p_org_id::text,
      jsonb_build_object(
        'confirmation', p_confirmation,
        'deleted_rows', v_deleted_rows,
        'deleted_at', now()
      )
    );
  end if;

  return jsonb_build_object(
    'org_id', p_org_id,
    'deleted', true,
    'deleted_rows', v_deleted_rows,
    'deleted_at', now()
  );
end;
$$;

grant execute on function public.super_admin_delete_org(uuid, uuid, text) to authenticated;
