-- Extend sync sink to materialize billing entities into dedicated tables.
-- Keeps existing behavior (sync_shadow + audit_logs) for all entities.

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
  v_data jsonb;

  v_uuid uuid;
  v_client_id uuid;
  v_quote_id uuid;
  v_invoice_id uuid;
  v_parent_type text;
  v_parent_id uuid;
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

  v_data := coalesce(p_payload->'data', p_payload);

  -- Special-case: legacy inspections support.
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

  -- Materialize billing entities.
  if p_entity in ('billing_clients', 'billing_quotes', 'billing_invoices', 'billing_line_items', 'billing_payments') then
    if not public.has_permission(v_org_id, 'billing:write') then
      raise exception 'forbidden: missing billing:write';
    end if;

    v_uuid := v_target_id::uuid;

    if p_entity = 'billing_clients' then
      if p_action = 'delete' then
        update public.billing_clients
        set deleted_at = v_now,
            updated_at = v_now
        where org_id = v_org_id and id = v_uuid;
      else
        insert into public.billing_clients(
          id, org_id, name, email, phone,
          address_line1, address_line2, address_zip, address_city, address_country,
          vat_number,
          created_by, created_at, updated_at, deleted_at
        )
        values (
          v_uuid,
          v_org_id,
          coalesce(nullif(v_data->>'name',''), 'Client'),
          nullif(v_data->>'email',''),
          nullif(v_data->>'phone',''),
          nullif(v_data->>'address_line1',''),
          nullif(v_data->>'address_line2',''),
          nullif(v_data->>'address_zip',''),
          nullif(v_data->>'address_city',''),
          nullif(v_data->>'address_country',''),
          nullif(v_data->>'vat_number',''),
          coalesce(nullif(v_data->>'created_by','')::uuid, v_user_id),
          coalesce(nullif(v_data->>'created_at','')::timestamptz, v_now),
          v_now,
          nullif(v_data->>'deleted_at','')::timestamptz
        )
        on conflict (id)
        do update set
          org_id = excluded.org_id,
          name = excluded.name,
          email = excluded.email,
          phone = excluded.phone,
          address_line1 = excluded.address_line1,
          address_line2 = excluded.address_line2,
          address_zip = excluded.address_zip,
          address_city = excluded.address_city,
          address_country = excluded.address_country,
          vat_number = excluded.vat_number,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at;
      end if;
    elsif p_entity = 'billing_quotes' then
      v_client_id := nullif(v_data->>'client_id','')::uuid;
      if v_client_id is null then
        raise exception 'billing_quotes.client_id is required';
      end if;

      if not exists (select 1 from public.billing_clients c where c.org_id = v_org_id and c.id = v_client_id and c.deleted_at is null) then
        raise exception 'billing_quotes.client_id not found';
      end if;

      if p_action = 'delete' then
        update public.billing_quotes
        set deleted_at = v_now,
            updated_at = v_now
        where org_id = v_org_id and id = v_uuid;
      else
        insert into public.billing_quotes(
          id, org_id, client_id, number, status,
          issue_date, valid_until,
          subtotal, tax_total, total,
          notes,
          created_by, created_at, updated_at, deleted_at
        )
        values (
          v_uuid,
          v_org_id,
          v_client_id,
          coalesce(nullif(v_data->>'number',''), 'DV-000000'),
          coalesce(nullif(v_data->>'status',''), 'draft'),
          coalesce(nullif(v_data->>'issue_date','')::date, current_date),
          nullif(v_data->>'valid_until','')::date,
          coalesce((v_data->>'subtotal')::numeric, 0),
          coalesce((v_data->>'tax_total')::numeric, 0),
          coalesce((v_data->>'total')::numeric, 0),
          nullif(v_data->>'notes',''),
          coalesce(nullif(v_data->>'created_by','')::uuid, v_user_id),
          coalesce(nullif(v_data->>'created_at','')::timestamptz, v_now),
          v_now,
          nullif(v_data->>'deleted_at','')::timestamptz
        )
        on conflict (id)
        do update set
          org_id = excluded.org_id,
          client_id = excluded.client_id,
          number = excluded.number,
          status = excluded.status,
          issue_date = excluded.issue_date,
          valid_until = excluded.valid_until,
          subtotal = excluded.subtotal,
          tax_total = excluded.tax_total,
          total = excluded.total,
          notes = excluded.notes,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at;
      end if;
    elsif p_entity = 'billing_invoices' then
      v_client_id := nullif(v_data->>'client_id','')::uuid;
      if v_client_id is null then
        raise exception 'billing_invoices.client_id is required';
      end if;

      if not exists (select 1 from public.billing_clients c where c.org_id = v_org_id and c.id = v_client_id and c.deleted_at is null) then
        raise exception 'billing_invoices.client_id not found';
      end if;

      v_quote_id := nullif(v_data->>'quote_id','')::uuid;
      if v_quote_id is not null then
        if not exists (select 1 from public.billing_quotes q where q.org_id = v_org_id and q.id = v_quote_id and q.deleted_at is null) then
          raise exception 'billing_invoices.quote_id not found';
        end if;
      end if;

      if p_action = 'delete' then
        update public.billing_invoices
        set deleted_at = v_now,
            updated_at = v_now
        where org_id = v_org_id and id = v_uuid;
      else
        insert into public.billing_invoices(
          id, org_id, client_id, quote_id, number, status,
          issue_date, due_date,
          subtotal, tax_total, total, paid_total,
          currency, notes,
          created_by, created_at, updated_at, deleted_at
        )
        values (
          v_uuid,
          v_org_id,
          v_client_id,
          v_quote_id,
          coalesce(nullif(v_data->>'number',''), 'FA-000000'),
          coalesce(nullif(v_data->>'status',''), 'draft'),
          coalesce(nullif(v_data->>'issue_date','')::date, current_date),
          nullif(v_data->>'due_date','')::date,
          coalesce((v_data->>'subtotal')::numeric, 0),
          coalesce((v_data->>'tax_total')::numeric, 0),
          coalesce((v_data->>'total')::numeric, 0),
          coalesce((v_data->>'paid_total')::numeric, 0),
          coalesce(nullif(v_data->>'currency',''), 'EUR'),
          nullif(v_data->>'notes',''),
          coalesce(nullif(v_data->>'created_by','')::uuid, v_user_id),
          coalesce(nullif(v_data->>'created_at','')::timestamptz, v_now),
          v_now,
          nullif(v_data->>'deleted_at','')::timestamptz
        )
        on conflict (id)
        do update set
          org_id = excluded.org_id,
          client_id = excluded.client_id,
          quote_id = excluded.quote_id,
          number = excluded.number,
          status = excluded.status,
          issue_date = excluded.issue_date,
          due_date = excluded.due_date,
          subtotal = excluded.subtotal,
          tax_total = excluded.tax_total,
          total = excluded.total,
          paid_total = excluded.paid_total,
          currency = excluded.currency,
          notes = excluded.notes,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at;
      end if;
    elsif p_entity = 'billing_line_items' then
      v_parent_type := lower(trim(coalesce(v_data->>'parent_type', v_data->>'parentType', '')));
      if v_parent_type not in ('quote','invoice') then
        raise exception 'billing_line_items.parent_type must be quote|invoice';
      end if;

      v_parent_id := nullif(coalesce(v_data->>'parent_id', v_data->>'parentId', ''), '')::uuid;
      if v_parent_id is null then
        raise exception 'billing_line_items.parent_id is required';
      end if;

      if v_parent_type = 'quote' then
        if not exists (select 1 from public.billing_quotes q where q.org_id = v_org_id and q.id = v_parent_id and q.deleted_at is null) then
          raise exception 'billing_line_items parent quote not found';
        end if;
      else
        if not exists (select 1 from public.billing_invoices i where i.org_id = v_org_id and i.id = v_parent_id and i.deleted_at is null) then
          raise exception 'billing_line_items parent invoice not found';
        end if;
      end if;

      if p_action = 'delete' then
        update public.billing_line_items
        set deleted_at = v_now,
            updated_at = v_now
        where org_id = v_org_id and id = v_uuid;
      else
        insert into public.billing_line_items(
          id, org_id, parent_type, parent_id,
          label, quantity, unit_price, tax_rate, line_total,
          position,
          created_at, updated_at, deleted_at
        )
        values (
          v_uuid,
          v_org_id,
          v_parent_type,
          v_parent_id,
          coalesce(nullif(v_data->>'label',''), 'Ligne'),
          coalesce((v_data->>'quantity')::numeric, 0),
          coalesce((v_data->>'unit_price')::numeric, 0),
          coalesce((v_data->>'tax_rate')::numeric, 0),
          coalesce((v_data->>'line_total')::numeric, 0),
          coalesce((v_data->>'position')::integer, 0),
          coalesce(nullif(v_data->>'created_at','')::timestamptz, v_now),
          v_now,
          nullif(v_data->>'deleted_at','')::timestamptz
        )
        on conflict (id)
        do update set
          org_id = excluded.org_id,
          parent_type = excluded.parent_type,
          parent_id = excluded.parent_id,
          label = excluded.label,
          quantity = excluded.quantity,
          unit_price = excluded.unit_price,
          tax_rate = excluded.tax_rate,
          line_total = excluded.line_total,
          position = excluded.position,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at;
      end if;
    elsif p_entity = 'billing_payments' then
      if not (public.has_permission(v_org_id, 'billing:payments:write') or public.has_permission(v_org_id, 'billing:write')) then
        raise exception 'forbidden: missing billing:payments:write';
      end if;

      v_invoice_id := nullif(v_data->>'invoice_id','')::uuid;
      if v_invoice_id is null then
        raise exception 'billing_payments.invoice_id is required';
      end if;

      if not exists (select 1 from public.billing_invoices i where i.org_id = v_org_id and i.id = v_invoice_id and i.deleted_at is null) then
        raise exception 'billing_payments.invoice_id not found';
      end if;

      if p_action = 'delete' then
        update public.billing_payments
        set deleted_at = v_now,
            updated_at = v_now
        where org_id = v_org_id and id = v_uuid;
      else
        insert into public.billing_payments(
          id, org_id, invoice_id,
          amount, method, paid_at, reference,
          created_by, created_at, updated_at, deleted_at
        )
        values (
          v_uuid,
          v_org_id,
          v_invoice_id,
          coalesce((v_data->>'amount')::numeric, 0),
          coalesce(nullif(v_data->>'method',''), 'transfer'),
          coalesce(nullif(v_data->>'paid_at','')::date, current_date),
          nullif(v_data->>'reference',''),
          coalesce(nullif(v_data->>'created_by','')::uuid, v_user_id),
          coalesce(nullif(v_data->>'created_at','')::timestamptz, v_now),
          v_now,
          nullif(v_data->>'deleted_at','')::timestamptz
        )
        on conflict (id)
        do update set
          org_id = excluded.org_id,
          invoice_id = excluded.invoice_id,
          amount = excluded.amount,
          method = excluded.method,
          paid_at = excluded.paid_at,
          reference = excluded.reference,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at;
      end if;
    end if;
  end if;

  -- Keep generic shadow + audit log for all entities (including billing).
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

