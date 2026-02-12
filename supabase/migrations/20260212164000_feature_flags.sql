-- feature-flags module
-- offline cache relies on explicit audit trail + deterministic set_feature_flag writes.

alter table public.feature_flags
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create table if not exists public.feature_flags_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  old_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_feature_flags_audit_org_key_changed
  on public.feature_flags_audit(org_id, key, changed_at desc);

alter table public.feature_flags_audit enable row level security;

drop policy if exists feature_flags_audit_admin_read on public.feature_flags_audit;
create policy feature_flags_audit_admin_read
on public.feature_flags_audit
for select
to authenticated
using (public.is_org_admin(org_id));

drop policy if exists feature_flags_audit_admin_write on public.feature_flags_audit;
create policy feature_flags_audit_admin_write
on public.feature_flags_audit
for insert
to authenticated
with check (public.is_org_admin(org_id));

create or replace function public.set_feature_flag(
  p_org_id uuid,
  p_key text,
  p_enabled boolean,
  p_payload jsonb default '{}'::jsonb
)
returns public.feature_flags
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_key text;
  v_payload jsonb;
  v_previous public.feature_flags;
  v_row public.feature_flags;
  v_old_value jsonb;
  v_new_value jsonb;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  perform public.assert_org_admin(p_org_id);

  v_key := trim(coalesce(p_key, ''));
  if length(v_key) = 0 then
    raise exception 'feature key required';
  end if;

  v_payload := coalesce(p_payload, '{}'::jsonb);

  select *
  into v_previous
  from public.feature_flags
  where org_id = p_org_id
    and key = v_key;

  insert into public.feature_flags (org_id, key, enabled, payload, updated_at, updated_by)
  values (p_org_id, v_key, p_enabled, v_payload, now(), v_actor)
  on conflict (org_id, key)
  do update set
    enabled = excluded.enabled,
    payload = excluded.payload,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning * into v_row;

  v_old_value :=
    case
      when v_previous.org_id is null then '{}'::jsonb
      else jsonb_build_object(
        'enabled', v_previous.enabled,
        'payload', coalesce(v_previous.payload, '{}'::jsonb)
      )
    end;

  v_new_value := jsonb_build_object(
    'enabled', v_row.enabled,
    'payload', coalesce(v_row.payload, '{}'::jsonb)
  );

  insert into public.feature_flags_audit (org_id, key, old_value, new_value, changed_by, changed_at)
  values (
    p_org_id,
    v_key,
    v_old_value,
    v_new_value,
    v_actor,
    now()
  );

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.module.set_flag',
    'feature_flag',
    v_key,
    jsonb_build_object(
      'oldValue', v_old_value,
      'newValue', v_new_value
    )
  );

  return v_row;
end;
$$;

revoke all on function public.set_feature_flag(uuid, text, boolean, jsonb) from public;
grant execute on function public.set_feature_flag(uuid, text, boolean, jsonb) to authenticated;
