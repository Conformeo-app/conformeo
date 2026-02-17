-- audit-compliance module
-- Normalize audit_logs columns for the legal trace API while keeping legacy compatibility.

alter table public.audit_logs
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists entity text,
  add column if not exists entity_id text,
  add column if not exists payload_json jsonb not null default '{}'::jsonb;

update public.audit_logs
set
  user_id = coalesce(user_id, actor_user_id),
  actor_user_id = coalesce(actor_user_id, user_id),
  entity = coalesce(nullif(trim(entity), ''), nullif(trim(target_type), ''), 'unknown'),
  target_type = coalesce(nullif(trim(target_type), ''), nullif(trim(entity), ''), 'unknown'),
  entity_id = coalesce(entity_id, nullif(trim(target_id), '')),
  target_id = coalesce(target_id, entity_id),
  payload_json = coalesce(payload_json, metadata, '{}'::jsonb),
  metadata = coalesce(metadata, payload_json, '{}'::jsonb)
where true;

alter table public.audit_logs
  alter column entity set default 'unknown';

alter table public.audit_logs
  alter column entity set not null;

alter table public.audit_logs
  alter column payload_json set default '{}'::jsonb;

create index if not exists idx_audit_logs_org_action_created
  on public.audit_logs(org_id, action, created_at desc);

create index if not exists idx_audit_logs_org_entity_created
  on public.audit_logs(org_id, entity, created_at desc);

create index if not exists idx_audit_logs_org_user_created
  on public.audit_logs(org_id, user_id, created_at desc);

create or replace function public.sync_audit_logs_compat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := coalesce(new.user_id, new.actor_user_id);
  new.actor_user_id := coalesce(new.actor_user_id, new.user_id);

  new.entity := coalesce(nullif(trim(new.entity), ''), nullif(trim(new.target_type), ''), 'unknown');
  new.target_type := coalesce(nullif(trim(new.target_type), ''), new.entity, 'unknown');

  new.entity_id := coalesce(new.entity_id, nullif(trim(new.target_id), ''));
  new.target_id := coalesce(new.target_id, new.entity_id);

  new.payload_json := coalesce(new.payload_json, new.metadata, '{}'::jsonb);
  new.metadata := coalesce(new.metadata, new.payload_json, '{}'::jsonb);

  if new.org_id is null then
    raise exception 'audit_logs.org_id is required';
  end if;

  if coalesce(trim(new.action), '') = '' then
    raise exception 'audit_logs.action is required';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_logs_compat on public.audit_logs;
create trigger trg_audit_logs_compat
before insert or update on public.audit_logs
for each row
execute function public.sync_audit_logs_compat();

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_admin_read on public.audit_logs;
drop policy if exists "audit_logs_admin_read" on public.audit_logs;
create policy audit_logs_admin_read
on public.audit_logs
for select
to authenticated
using (public.is_org_admin(org_id));

drop policy if exists audit_logs_member_insert on public.audit_logs;
drop policy if exists "audit_logs_member_insert" on public.audit_logs;
create policy audit_logs_member_insert
on public.audit_logs
for insert
to authenticated
with check (public.is_org_member(org_id));

