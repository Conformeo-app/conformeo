-- Billing v1.1: add invoice status `issued` + align default prefixes with spec.
-- Safe to run multiple times (idempotent).

-- 1) Invoice status: extend check constraint to include `issued`.
do $$
declare
  v_constraint_name text;
begin
  select conname
  into v_constraint_name
  from pg_constraint
  where conrelid = 'public.billing_invoices'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.billing_invoices drop constraint %I', v_constraint_name);
  end if;
exception
  when undefined_table then
    -- billing not installed yet
    null;
end $$;

do $$
begin
  alter table public.billing_invoices
    add constraint billing_invoices_status_check
    check (status in ('draft','issued','sent','paid','overdue','cancelled'));
exception
  when duplicate_object then
    null;
  when undefined_table then
    null;
end $$;

-- 2) Default prefixes: DEV / FAC (can still be customized per org).
do $$
begin
  alter table public.billing_numbering
    alter column quote_prefix set default 'DEV';
  alter table public.billing_numbering
    alter column invoice_prefix set default 'FAC';

  update public.billing_numbering
  set quote_prefix = 'DEV'
  where quote_prefix = 'DV';

  update public.billing_numbering
  set invoice_prefix = 'FAC'
  where invoice_prefix = 'FA';
exception
  when undefined_table then
    null;
end $$;
