-- Real sync application path using SQL RPC (authenticated + org membership check).

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_id text not null,
  status text not null default 'draft',
  data jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, external_id)
);

create index if not exists idx_inspections_org_updated on public.inspections(org_id, updated_at desc);

alter table public.inspections enable row level security;

drop policy if exists inspections_member_read on public.inspections;
create policy inspections_member_read
on public.inspections
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists inspections_member_write on public.inspections;
create policy inspections_member_write
on public.inspections
for all
to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

create or replace function public.apply_sync_operation(
  p_operation_id text,
  p_entity text,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_target_id text;
  v_status text;
  v_inserted_op text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce(length(trim(p_operation_id)), 0) = 0 then
    raise exception 'operation_id is required';
  end if;

  if coalesce(length(trim(p_entity)), 0) = 0 then
    raise exception 'entity is required';
  end if;

  if p_action not in ('insert', 'update', 'delete') then
    raise exception 'invalid action: %', p_action;
  end if;

  v_org_id := nullif(p_payload->>'orgId', '')::uuid;
  if v_org_id is null then
    raise exception 'payload.orgId is required';
  end if;

  if not exists (
    select 1 from public.org_members m
    where m.org_id = v_org_id and m.user_id = v_user_id
  ) then
    raise exception 'forbidden: user is not org member';
  end if;

  insert into public.idempotency_keys(org_id, operation_id)
  values (v_org_id, p_operation_id)
  on conflict (org_id, operation_id) do nothing
  returning operation_id into v_inserted_op;

  if v_inserted_op is null then
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'already-processed');
  end if;

  if p_entity = 'inspection' then
    v_target_id := nullif(coalesce(p_payload->>'id', p_payload->>'externalId'), '');
    if v_target_id is null then
      raise exception 'payload.id is required for inspection';
    end if;

    if p_action = 'delete' then
      delete from public.inspections
      where org_id = v_org_id and external_id = v_target_id;
    else
      v_status := coalesce(nullif(p_payload->>'status', ''), 'draft');

      insert into public.inspections(org_id, external_id, status, data, updated_by, updated_at)
      values (v_org_id, v_target_id, v_status, p_payload, v_user_id, now())
      on conflict (org_id, external_id)
      do update set
        status = excluded.status,
        data = excluded.data,
        updated_by = excluded.updated_by,
        updated_at = now();
    end if;
  else
    raise exception 'unsupported entity: %', p_entity;
  end if;

  insert into public.audit_logs(org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    v_org_id,
    v_user_id,
    'sync.' || p_entity || '.' || p_action,
    p_entity,
    coalesce(v_target_id, ''),
    jsonb_build_object('operationId', p_operation_id, 'payload', p_payload)
  );

  return jsonb_build_object('ok', true, 'applied', true);
end;
$$;

revoke all on function public.apply_sync_operation(text, text, text, jsonb) from public;
grant execute on function public.apply_sync_operation(text, text, text, jsonb) to authenticated;
