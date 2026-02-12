-- Orgs Admin module
-- Organizations settings, members invitations, teams, module flags with admin audit.

create extension if not exists pgcrypto;

alter table public.organizations
  add column if not exists siret text,
  add column if not exists address text,
  add column if not exists settings_json jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.organizations
set settings_json = coalesce(settings_json, '{}'::jsonb),
    updated_at = coalesce(updated_at, created_at, now())
where true;

alter table public.org_members
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists invited_at timestamptz,
  add column if not exists joined_at timestamptz,
  add column if not exists invited_by uuid references auth.users(id) on delete set null,
  add column if not exists invited_email text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'org_members_status_check'
      and conrelid = 'public.org_members'::regclass
  ) then
    alter table public.org_members
      add constraint org_members_status_check
      check (status in ('INVITED', 'ACTIVE'));
  end if;
exception
  when duplicate_object then null;
end
$$;

update public.org_members
set status = 'ACTIVE',
    invited_at = coalesce(invited_at, created_at, now()),
    joined_at = coalesce(joined_at, created_at, now()),
    invited_email = coalesce(invited_email, null)
where true;

create table if not exists public.org_member_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'manager', 'inspector', 'viewer')),
  status text not null default 'INVITED' check (status in ('INVITED', 'ACTIVE', 'CANCELED')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_user_id uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (org_id, email)
);

create index if not exists idx_org_member_invites_org_status
  on public.org_member_invites(org_id, status, invited_at desc);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists idx_teams_org_updated
  on public.teams(org_id, updated_at desc);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists idx_team_members_user
  on public.team_members(user_id, joined_at desc);

alter table public.org_member_invites enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- Invitations: readable by members, writable by org admins.
drop policy if exists org_member_invites_member_read on public.org_member_invites;
create policy org_member_invites_member_read
on public.org_member_invites
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists org_member_invites_admin_write on public.org_member_invites;
create policy org_member_invites_admin_write
on public.org_member_invites
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

-- Teams: readable by members, writable by org admins.
drop policy if exists teams_member_read on public.teams;
create policy teams_member_read
on public.teams
for select
to authenticated
using (public.is_org_member(org_id));

drop policy if exists teams_admin_write on public.teams;
create policy teams_admin_write
on public.teams
for all
to authenticated
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

-- Team members inherit security through teams.org_id.
drop policy if exists team_members_member_read on public.team_members;
create policy team_members_member_read
on public.team_members
for select
to authenticated
using (
  exists (
    select 1
    from public.teams t
    where t.id = team_members.team_id
      and public.is_org_member(t.org_id)
  )
);

drop policy if exists team_members_admin_write on public.team_members;
create policy team_members_admin_write
on public.team_members
for all
to authenticated
using (
  exists (
    select 1
    from public.teams t
    where t.id = team_members.team_id
      and public.is_org_admin(t.org_id)
  )
)
with check (
  exists (
    select 1
    from public.teams t
    where t.id = team_members.team_id
      and public.is_org_admin(t.org_id)
  )
);

create or replace function public.assert_org_admin(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_org_admin(p_org_id) then
    raise exception 'forbidden: admin role required';
  end if;
end;
$$;

revoke all on function public.assert_org_admin(uuid) from public;
grant execute on function public.assert_org_admin(uuid) to authenticated;

create or replace function public.accept_pending_org_invites()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_joined_count integer := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select lower(u.email)
  into v_user_email
  from auth.users u
  where u.id = v_user_id;

  if v_user_email is null then
    return 0;
  end if;

  insert into public.org_members (
    org_id,
    user_id,
    role,
    status,
    invited_at,
    joined_at,
    invited_by,
    invited_email
  )
  select
    i.org_id,
    v_user_id,
    i.role,
    'ACTIVE',
    i.invited_at,
    now(),
    i.invited_by,
    i.email
  from public.org_member_invites i
  where lower(i.email) = v_user_email
    and i.status = 'INVITED'
  on conflict (org_id, user_id)
  do update set
    role = excluded.role,
    status = 'ACTIVE',
    joined_at = now(),
    invited_email = excluded.invited_email;

  get diagnostics v_joined_count = row_count;

  update public.org_member_invites
  set status = 'ACTIVE',
      invited_user_id = v_user_id,
      joined_at = now()
  where lower(email) = v_user_email
    and status = 'INVITED';

  return coalesce(v_joined_count, 0);
end;
$$;

revoke all on function public.accept_pending_org_invites() from public;
grant execute on function public.accept_pending_org_invites() to authenticated;

create or replace function public.list_org_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  status text,
  invited_at timestamptz,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden: user is not org member';
  end if;

  return query
  select
    m.user_id,
    lower(u.email) as email,
    m.role,
    coalesce(m.status, 'ACTIVE') as status,
    coalesce(m.invited_at, m.created_at, now()) as invited_at,
    m.joined_at
  from public.org_members m
  left join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id

  union all

  select
    i.invited_user_id as user_id,
    lower(i.email) as email,
    i.role,
    i.status,
    i.invited_at,
    i.joined_at
  from public.org_member_invites i
  where i.org_id = p_org_id
    and i.status = 'INVITED'

  order by invited_at desc;
end;
$$;

revoke all on function public.list_org_members(uuid) from public;
grant execute on function public.list_org_members(uuid) to authenticated;

create or replace function public.invite_org_member(
  p_org_id uuid,
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_user_id uuid;
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  perform public.assert_org_admin(p_org_id);

  v_email := lower(trim(coalesce(p_email, '')));
  if length(v_email) < 5 or position('@' in v_email) = 0 then
    raise exception 'invalid email';
  end if;

  if p_role not in ('owner', 'admin', 'manager', 'inspector', 'viewer') then
    raise exception 'invalid role';
  end if;

  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_user_id is not null then
    insert into public.org_members (
      org_id,
      user_id,
      role,
      status,
      invited_at,
      joined_at,
      invited_by,
      invited_email
    )
    values (
      p_org_id,
      v_user_id,
      p_role,
      'ACTIVE',
      now(),
      now(),
      v_actor,
      v_email
    )
    on conflict (org_id, user_id)
    do update set
      role = excluded.role,
      status = 'ACTIVE',
      invited_at = now(),
      joined_at = coalesce(public.org_members.joined_at, now()),
      invited_by = excluded.invited_by,
      invited_email = excluded.invited_email;

    insert into public.org_member_invites (
      org_id,
      email,
      role,
      status,
      invited_by,
      invited_user_id,
      invited_at,
      joined_at
    )
    values (
      p_org_id,
      v_email,
      p_role,
      'ACTIVE',
      v_actor,
      v_user_id,
      now(),
      now()
    )
    on conflict (org_id, email)
    do update set
      role = excluded.role,
      status = 'ACTIVE',
      invited_by = excluded.invited_by,
      invited_user_id = excluded.invited_user_id,
      invited_at = excluded.invited_at,
      joined_at = excluded.joined_at;
  else
    insert into public.org_member_invites (
      org_id,
      email,
      role,
      status,
      invited_by,
      invited_at,
      joined_at,
      invited_user_id
    )
    values (
      p_org_id,
      v_email,
      p_role,
      'INVITED',
      v_actor,
      now(),
      null,
      null
    )
    on conflict (org_id, email)
    do update set
      role = excluded.role,
      status = 'INVITED',
      invited_by = excluded.invited_by,
      invited_at = excluded.invited_at,
      joined_at = null,
      invited_user_id = null;
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.member.invite',
    'org_member',
    coalesce(v_user_id::text, v_email),
    jsonb_build_object('email', v_email, 'role', p_role, 'userId', v_user_id)
  );

  return jsonb_build_object(
    'status', 'INVITED',
    'invited_user_id', v_user_id
  );
end;
$$;

revoke all on function public.invite_org_member(uuid, text, text) from public;
grant execute on function public.invite_org_member(uuid, text, text) to authenticated;

create or replace function public.set_org_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  perform public.assert_org_admin(p_org_id);

  if p_role not in ('owner', 'admin', 'manager', 'inspector', 'viewer') then
    raise exception 'invalid role';
  end if;

  update public.org_members
  set role = p_role,
      status = 'ACTIVE',
      joined_at = coalesce(joined_at, now())
  where org_id = p_org_id
    and user_id = p_user_id;

  if not found then
    raise exception 'org member not found';
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.member.role.change',
    'org_member',
    p_user_id::text,
    jsonb_build_object('role', p_role)
  );
end;
$$;

revoke all on function public.set_org_member_role(uuid, uuid, text) from public;
grant execute on function public.set_org_member_role(uuid, uuid, text) to authenticated;

create or replace function public.remove_org_member(
  p_org_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  perform public.assert_org_admin(p_org_id);

  delete from public.team_members tm
  using public.teams t
  where t.id = tm.team_id
    and t.org_id = p_org_id
    and tm.user_id = p_user_id;

  delete from public.org_members
  where org_id = p_org_id
    and user_id = p_user_id;

  if not found then
    raise exception 'org member not found';
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.member.remove',
    'org_member',
    p_user_id::text,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.remove_org_member(uuid, uuid) from public;
grant execute on function public.remove_org_member(uuid, uuid) to authenticated;

create or replace function public.update_org_settings(
  p_org_id uuid,
  p_name text,
  p_siret text,
  p_address text,
  p_settings_patch jsonb default '{}'::jsonb
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_row public.organizations;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  perform public.assert_org_admin(p_org_id);

  update public.organizations o
  set name = coalesce(nullif(trim(p_name), ''), o.name),
      siret = case when p_siret is null then o.siret else nullif(trim(p_siret), '') end,
      address = case when p_address is null then o.address else nullif(trim(p_address), '') end,
      settings_json = coalesce(o.settings_json, '{}'::jsonb) || coalesce(p_settings_patch, '{}'::jsonb),
      updated_at = now()
  where o.id = p_org_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'organization not found';
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.settings.update',
    'organization',
    p_org_id::text,
    jsonb_build_object(
      'name', coalesce(nullif(trim(p_name), ''), null),
      'siret', p_siret,
      'address', p_address,
      'settings_patch', coalesce(p_settings_patch, '{}'::jsonb)
    )
  );

  return v_row;
end;
$$;

revoke all on function public.update_org_settings(uuid, text, text, text, jsonb) from public;
grant execute on function public.update_org_settings(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.create_team(
  p_org_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_team_id uuid;
  v_name text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  perform public.assert_org_admin(p_org_id);

  v_name := trim(coalesce(p_name, ''));
  if length(v_name) < 2 then
    raise exception 'team name too short';
  end if;

  insert into public.teams (org_id, name, created_by, updated_at)
  values (p_org_id, v_name, v_actor, now())
  returning id into v_team_id;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.team.create',
    'team',
    v_team_id::text,
    jsonb_build_object('name', v_name)
  );

  return v_team_id;
end;
$$;

revoke all on function public.create_team(uuid, text) from public;
grant execute on function public.create_team(uuid, text) to authenticated;

create or replace function public.add_team_member(
  p_team_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select t.org_id
  into v_org_id
  from public.teams t
  where t.id = p_team_id;

  if v_org_id is null then
    raise exception 'team not found';
  end if;

  perform public.assert_org_admin(v_org_id);

  if not exists (
    select 1
    from public.org_members m
    where m.org_id = v_org_id
      and m.user_id = p_user_id
  ) then
    raise exception 'user is not org member';
  end if;

  insert into public.team_members (team_id, user_id)
  values (p_team_id, p_user_id)
  on conflict (team_id, user_id)
  do nothing;

  update public.teams
  set updated_at = now()
  where id = p_team_id;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    v_org_id,
    v_actor,
    'org.team.member.add',
    'team_member',
    p_team_id::text,
    jsonb_build_object('userId', p_user_id)
  );
end;
$$;

revoke all on function public.add_team_member(uuid, uuid) from public;
grant execute on function public.add_team_member(uuid, uuid) to authenticated;

create or replace function public.remove_team_member(
  p_team_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select t.org_id
  into v_org_id
  from public.teams t
  where t.id = p_team_id;

  if v_org_id is null then
    raise exception 'team not found';
  end if;

  perform public.assert_org_admin(v_org_id);

  delete from public.team_members
  where team_id = p_team_id
    and user_id = p_user_id;

  update public.teams
  set updated_at = now()
  where id = p_team_id;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    v_org_id,
    v_actor,
    'org.team.member.remove',
    'team_member',
    p_team_id::text,
    jsonb_build_object('userId', p_user_id)
  );
end;
$$;

revoke all on function public.remove_team_member(uuid, uuid) from public;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;

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
  v_row public.feature_flags;
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

  insert into public.feature_flags (org_id, key, enabled, payload, updated_at)
  values (p_org_id, v_key, p_enabled, coalesce(p_payload, '{}'::jsonb), now())
  on conflict (org_id, key)
  do update set
    enabled = excluded.enabled,
    payload = coalesce(public.feature_flags.payload, '{}'::jsonb) || excluded.payload,
    updated_at = excluded.updated_at
  returning * into v_row;

  insert into public.audit_logs (org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'org.module.set_flag',
    'feature_flag',
    v_key,
    jsonb_build_object('enabled', p_enabled, 'payload', coalesce(p_payload, '{}'::jsonb))
  );

  return v_row;
end;
$$;

revoke all on function public.set_feature_flag(uuid, text, boolean, jsonb) from public;
grant execute on function public.set_feature_flag(uuid, text, boolean, jsonb) to authenticated;
