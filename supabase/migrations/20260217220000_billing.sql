-- billing (facturation) module
-- Tables: clients, devis, factures, lignes, paiements, numérotation + RLS + RPC reserve numbers.

create extension if not exists pgcrypto;

-- --------
-- RBAC helpers (billing uses permissions via public.role_permissions)
-- --------

create or replace function public.permission_matches(p_required text, p_granted text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_required text := trim(coalesce(p_required, ''));
  v_granted text := trim(coalesce(p_granted, ''));
begin
  if v_required = '' or v_granted = '' then
    return false;
  end if;

  if v_granted = '*' then
    return true;
  end if;

  if v_granted = v_required then
    return true;
  end if;

  if right(v_granted, 2) = ':*' then
    return position(left(v_granted, length(v_granted) - 1) in v_required) = 1;
  end if;

  return false;
end;
$$;

create or replace function public.has_permission(p_org_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_key text;
begin
  if v_user_id is null then
    return false;
  end if;

  if p_org_id is null then
    return false;
  end if;

  if not public.is_org_member(p_org_id) then
    return false;
  end if;

  select
    case
      when exists (
        select 1 from public.org_members m
        where m.org_id = p_org_id and m.user_id = v_user_id and m.role in ('owner', 'admin')
      ) then 'admin'
      when exists (
        select 1 from public.org_members m
        where m.org_id = p_org_id and m.user_id = v_user_id and m.role = 'manager'
      ) then 'manager'
      else 'field'
    end
  into v_role_key;

  return exists (
    select 1
    from public.role_permissions rp
    where rp.org_id = p_org_id
      and rp.role_key = v_role_key
      and public.permission_matches(p_permission, rp.permission)
  );
end;
$$;

revoke all on function public.permission_matches(text, text) from public;
revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.permission_matches(text, text) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- --------
-- Tables (Postgres)
-- --------

create table if not exists public.billing_clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  address_zip text,
  address_city text,
  address_country text,
  vat_number text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_billing_clients_org_updated
  on public.billing_clients(org_id, updated_at desc);
create index if not exists idx_billing_clients_org_name
  on public.billing_clients(org_id, name);
create index if not exists idx_billing_clients_deleted
  on public.billing_clients(deleted_at);

create table if not exists public.billing_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.billing_clients(id) on delete restrict,
  number text not null,
  status text not null check (status in ('draft','sent','accepted','rejected','expired')),
  issue_date date not null,
  valid_until date,
  subtotal numeric not null default 0,
  tax_total numeric not null default 0,
  total numeric not null default 0,
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number)
);

create index if not exists idx_billing_quotes_org_updated
  on public.billing_quotes(org_id, updated_at desc);
create index if not exists idx_billing_quotes_org_status_updated
  on public.billing_quotes(org_id, status, updated_at desc);
create index if not exists idx_billing_quotes_org_client
  on public.billing_quotes(org_id, client_id);
create index if not exists idx_billing_quotes_deleted
  on public.billing_quotes(deleted_at);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.billing_clients(id) on delete restrict,
  quote_id uuid references public.billing_quotes(id) on delete set null,
  number text not null,
  status text not null check (status in ('draft','sent','paid','overdue','cancelled')),
  issue_date date not null,
  due_date date,
  subtotal numeric not null default 0,
  tax_total numeric not null default 0,
  total numeric not null default 0,
  paid_total numeric not null default 0,
  currency text not null default 'EUR',
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, number)
);

create index if not exists idx_billing_invoices_org_updated
  on public.billing_invoices(org_id, updated_at desc);
create index if not exists idx_billing_invoices_org_status_updated
  on public.billing_invoices(org_id, status, updated_at desc);
create index if not exists idx_billing_invoices_org_client
  on public.billing_invoices(org_id, client_id);
create index if not exists idx_billing_invoices_quote
  on public.billing_invoices(org_id, quote_id);
create index if not exists idx_billing_invoices_deleted
  on public.billing_invoices(deleted_at);

create table if not exists public.billing_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  parent_type text not null check (parent_type in ('quote','invoice')),
  parent_id uuid not null,
  label text not null,
  quantity numeric not null,
  unit_price numeric not null,
  tax_rate numeric not null,
  line_total numeric not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_billing_line_items_parent
  on public.billing_line_items(org_id, parent_type, parent_id, position);
create index if not exists idx_billing_line_items_deleted
  on public.billing_line_items(deleted_at);

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  amount numeric not null,
  method text not null check (method in ('transfer','card','cash','check','other')),
  paid_at date not null,
  reference text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_billing_payments_invoice_paid
  on public.billing_payments(org_id, invoice_id, paid_at desc);
create index if not exists idx_billing_payments_deleted
  on public.billing_payments(deleted_at);

create table if not exists public.billing_numbering (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  quote_prefix text not null default 'DV',
  invoice_prefix text not null default 'FA',
  quote_next_number integer not null default 1,
  invoice_next_number integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.billing_clients enable row level security;
alter table public.billing_quotes enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_line_items enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_numbering enable row level security;

-- --------
-- RLS policies (permissions)
-- --------

drop policy if exists billing_clients_read on public.billing_clients;
create policy billing_clients_read
on public.billing_clients
for select
to authenticated
using (public.has_permission(org_id, 'billing:read'));

drop policy if exists billing_clients_write on public.billing_clients;
create policy billing_clients_write
on public.billing_clients
for all
to authenticated
using (public.has_permission(org_id, 'billing:write'))
with check (public.has_permission(org_id, 'billing:write'));

drop policy if exists billing_quotes_read on public.billing_quotes;
create policy billing_quotes_read
on public.billing_quotes
for select
to authenticated
using (public.has_permission(org_id, 'billing:read'));

drop policy if exists billing_quotes_write on public.billing_quotes;
create policy billing_quotes_write
on public.billing_quotes
for all
to authenticated
using (public.has_permission(org_id, 'billing:write'))
with check (public.has_permission(org_id, 'billing:write'));

drop policy if exists billing_invoices_read on public.billing_invoices;
create policy billing_invoices_read
on public.billing_invoices
for select
to authenticated
using (public.has_permission(org_id, 'billing:read'));

drop policy if exists billing_invoices_write on public.billing_invoices;
create policy billing_invoices_write
on public.billing_invoices
for all
to authenticated
using (public.has_permission(org_id, 'billing:write'))
with check (public.has_permission(org_id, 'billing:write'));

drop policy if exists billing_line_items_read on public.billing_line_items;
create policy billing_line_items_read
on public.billing_line_items
for select
to authenticated
using (public.has_permission(org_id, 'billing:read'));

drop policy if exists billing_line_items_write on public.billing_line_items;
create policy billing_line_items_write
on public.billing_line_items
for all
to authenticated
using (public.has_permission(org_id, 'billing:write'))
with check (public.has_permission(org_id, 'billing:write'));

drop policy if exists billing_payments_read on public.billing_payments;
create policy billing_payments_read
on public.billing_payments
for select
to authenticated
using (public.has_permission(org_id, 'billing:read'));

drop policy if exists billing_payments_write on public.billing_payments;
create policy billing_payments_write
on public.billing_payments
for all
to authenticated
using (public.has_permission(org_id, 'billing:payments:write') or public.has_permission(org_id, 'billing:write'))
with check (public.has_permission(org_id, 'billing:payments:write') or public.has_permission(org_id, 'billing:write'));

drop policy if exists billing_numbering_admin_write on public.billing_numbering;
create policy billing_numbering_admin_write
on public.billing_numbering
for all
to authenticated
using (public.has_permission(org_id, 'billing:write'))
with check (public.has_permission(org_id, 'billing:write'));

grant select, insert, update, delete on public.billing_clients to authenticated;
grant select, insert, update, delete on public.billing_quotes to authenticated;
grant select, insert, update, delete on public.billing_invoices to authenticated;
grant select, insert, update, delete on public.billing_line_items to authenticated;
grant select, insert, update, delete on public.billing_payments to authenticated;
grant select, insert, update, delete on public.billing_numbering to authenticated;

-- --------
-- RPC: reserve billing numbers (range reservation, no collisions)
-- --------

create or replace function public.reserve_billing_numbers(
  p_org_id uuid,
  p_kind text,
  p_count integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_count integer := greatest(1, least(coalesce(p_count, 50), 500));
  v_row public.billing_numbering;
  v_prefix text;
  v_start integer;
  v_end integer;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_org_id is null then
    raise exception 'org_id is required';
  end if;

  if not public.has_permission(p_org_id, 'billing:write') then
    raise exception 'forbidden: missing billing:write';
  end if;

  if v_kind not in ('quote','invoice') then
    raise exception 'kind must be quote|invoice';
  end if;

  insert into public.billing_numbering(org_id)
  values (p_org_id)
  on conflict (org_id) do nothing;

  select *
  into v_row
  from public.billing_numbering
  where org_id = p_org_id
  for update;

  if v_kind = 'quote' then
    v_prefix := v_row.quote_prefix;
    v_start := v_row.quote_next_number;
    v_end := v_start + v_count - 1;

    update public.billing_numbering
    set quote_next_number = v_end + 1,
        updated_at = now()
    where org_id = p_org_id;
  else
    v_prefix := v_row.invoice_prefix;
    v_start := v_row.invoice_next_number;
    v_end := v_start + v_count - 1;

    update public.billing_numbering
    set invoice_next_number = v_end + 1,
        updated_at = now()
    where org_id = p_org_id;
  end if;

  insert into public.audit_logs(org_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    'billing.reserve_numbers',
    'billing_numbering',
    v_kind,
    jsonb_build_object('prefix', v_prefix, 'start_number', v_start, 'end_number', v_end, 'count', v_count)
  );

  return jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'prefix', v_prefix,
    'start_number', v_start,
    'end_number', v_end
  );
end;
$$;

revoke all on function public.reserve_billing_numbers(uuid, text, integer) from public;
grant execute on function public.reserve_billing_numbers(uuid, text, integer) to authenticated;

-- --------
-- Seed permissions for all existing orgs (idempotent)
-- --------

insert into public.role_permissions (org_id, role_key, permission)
select o.id, seed.role_key, seed.permission
from public.organizations o
cross join (
  values
    ('admin', 'billing:*'),
    ('manager', 'billing:*'),
    ('field', 'billing:read')
) as seed(role_key, permission)
on conflict (org_id, role_key, permission) do nothing;

