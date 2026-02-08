-- Conforméo: schéma de base (à compléter)
create extension if not exists "pgcrypto";

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  role text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  kind text not null,
  status text not null default 'draft',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  storage_path text not null,
  mime text,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  storage_path text not null,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists plan_annotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete cascade,
  page int not null,
  x numeric not null,
  y numeric not null,
  status text not null default 'open',
  color text,
  created_at timestamptz not null default now()
);

create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  signer_id uuid references profiles(id) on delete set null,
  signed_at timestamptz not null default now(),
  hash text not null,
  ip text,
  device_info jsonb
);

create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  enabled boolean not null default false,
  payload jsonb,
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid references documents(id) on delete set null,
  token text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
