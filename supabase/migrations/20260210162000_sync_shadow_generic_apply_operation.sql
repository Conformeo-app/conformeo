-- Generic sync sink for offline-first entities.
-- Keeps idempotence and org membership checks while accepting all entities.

create table if not exists public.sync_shadow (
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, entity, entity_id)
);

create index if not exists idx_sync_shadow_org_updated
  on public.sync_shadow(org_id, updated_at desc);

alter table public.sync_shadow enable row level security;

drop policy if exists sync_shadow_member_read on public.sync_shadow;
create policy sync_shadow_member_read
on public.sync_shadow
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists sync_shadow_member_write on public.sync_shadow;
create policy sync_shadow_member_write
on public.sync_shadow
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
  v_now timestamptz;
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

  v_org_id := coalesce(
    nullif(p_payload->>'orgId', '')::uuid,
    nullif(p_payload->>'org_id', '')::uuid
  );
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
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'reason', 'already-processed',
      'server_updated_at', now()
    );
  end if;

  v_now := now();
  v_target_id := nullif(coalesce(p_payload->>'id', p_payload->>'entityId', p_payload->>'externalId'), '');
  if v_target_id is null then
    v_target_id := p_operation_id;
  end if;

  if p_entity = 'inspection' then
    if p_action = 'delete' then
      delete from public.inspections
      where org_id = v_org_id and external_id = v_target_id;
    else
      v_status := coalesce(nullif(p_payload->>'status', ''), 'draft');

      insert into public.inspections(org_id, external_id, status, data, updated_by, updated_at)
      values (v_org_id, v_target_id, v_status, p_payload, v_user_id, v_now)
      on conflict (org_id, external_id)
      do update set
        status = excluded.status,
        data = excluded.data,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
    end if;
  end if;

  if p_action = 'delete' then
    insert into public.sync_shadow(org_id, entity, entity_id, payload, deleted, updated_by, updated_at)
    values (v_org_id, p_entity, v_target_id, p_payload, true, v_user_id, v_now)
    on conflict (org_id, entity, entity_id)
    do update set
      payload = excluded.payload,
      deleted = true,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  else
    insert into public.sync_shadow(org_id, entity, entity_id, payload, deleted, updated_by, updated_at)
    values (v_org_id, p_entity, v_target_id, p_payload, false, v_user_id, v_now)
    on conflict (org_id, entity, entity_id)
    do update set
      payload = excluded.payload,
      deleted = false,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  end if;

  insert into public.audit_logs(org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    v_org_id,
    v_user_id,
    'sync.' || p_entity || '.' || p_action,
    p_entity,
    v_target_id,
    jsonb_build_object('operationId', p_operation_id, 'payload', p_payload)
  );

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'server_updated_at', v_now
  );
end;
$$;

revoke all on function public.apply_sync_operation(text, text, text, jsonb) from public;
grant execute on function public.apply_sync_operation(text, text, text, jsonb) to authenticated;
