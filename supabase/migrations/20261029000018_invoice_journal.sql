-- Migration 18: customer invoices and receipts as journal entries.
--
--   invoice       Dr 1103 customers (the customer)   Cr 4101 transport revenue (per truck)
--                                                    Cr 2104 sales tax payable
--   receipt       Dr cash 1101 / bank 1102 / cheques under collection 1104 /
--                 discount allowed 4103              Cr 1103 customers (the customer)
--   cheque        cleared: Dr bank 1102, Cr 1104; bounced: Dr 1103 (the customer), Cr 1104
--
-- Cancelling an invoice reverses its entry. A cheque's status entry follows
-- its status (dated when it cleared or bounced) and is reversed if the status
-- changes again. Same rules as migration 17: posted entries never change.

-- Discount allowed to customers reduces revenue.
insert into public.accounts (code, name_ar, type, parent_id, is_postable)
select '4103', 'خصم مسموح به', 'revenue', p.id, true
from public.accounts p
where p.code = '4' and not exists (select 1 from public.accounts where code = '4103');

-- ---------------------------------------------------------------------------
-- 1. Invoices (posted by create_invoice() and cancel_invoice() themselves:
--    the lines are written after the invoice row)
-- ---------------------------------------------------------------------------
create function app.post_invoice_row(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  lines jsonb;
begin
  select * into i from public.invoices where id = p_invoice_id;
  if i.status <> 'issued' then
    perform app.sync_source_entry('invoice', i.id, null, null, null, p_reason);
    return;
  end if;

  -- Revenue per truck, from the loads on the invoice; tax on its own line.
  select jsonb_agg(app.jline(app.account_by_code('4101'), 0, r.amount, p_truck_id => r.truck_id) order by r.truck_id)
  into lines
  from (
    select x.truck_id, sum(l.amount_minor)::bigint as amount
    from public.invoice_lines l
    left join public.trips x on x.id = l.trip_id
    where l.invoice_id = i.id
    group by x.truck_id
  ) r;
  lines := jsonb_build_array(app.jline(app.account_by_code('1103'), i.total_minor, 0, p_client_id => i.client_id)) || lines;
  if i.vat_minor > 0 then
    lines := lines || jsonb_build_array(app.jline(app.account_by_code('2104'), 0, i.vat_minor));
  end if;

  perform app.sync_source_entry(
    'invoice', i.id, i.invoice_date,
    'فاتورة رقم ' || i.invoice_no || ' — ' || coalesce((select c.name from public.clients c where c.id = i.client_id), ''),
    lines, p_reason);
end;
$$;

-- Same as migration 15, plus posting at the end.
create or replace function public.create_invoice(
  p_client_id uuid,
  p_invoice_date date,
  p_trip_ids uuid[],
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv uuid := gen_random_uuid();
  c record;
  n integer;
  sub bigint;
  first_day date;
  last_day date;
  rate numeric;
  vat bigint;
begin
  -- API callers must be manager or accountant (the seed runs without a user).
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception 'الفوترة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  if p_trip_ids is null or cardinality(p_trip_ids) = 0 then
    raise exception 'اختر نقلة واحدة على الأقل' using errcode = 'check_violation';
  end if;
  if (select count(distinct t) from unnest(p_trip_ids) t) <> cardinality(p_trip_ids) then
    raise exception 'نقلة مكررة في الفاتورة' using errcode = 'check_violation';
  end if;
  if p_invoice_date is null or p_invoice_date > app.today() then
    raise exception 'تاريخ الفاتورة غير صحيح' using errcode = 'check_violation';
  end if;

  select x.id, x.payment_terms_days, x.vat_exempt into c from public.clients x where x.id = p_client_id;
  if not found then
    raise exception 'الزبون غير موجود' using errcode = 'no_data_found';
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice:' || p_client_id::text));
  perform 1 from public.trips x where x.id = any (p_trip_ids) for update;

  if exists (
    select 1
    from unnest(p_trip_ids) t (id)
    left join public.trips x on x.id = t.id
    where x.id is null or x.client_id is distinct from p_client_id or x.status <> 'completed'
       or x.is_empty_return or x.freight_base_minor <= 0 or x.invoice_id is not null
  ) then
    raise exception 'بعض النقلات المختارة لا تخص هذا الزبون، أو لم تنتهِ، أو مفوترة مسبقاً'
      using errcode = 'check_violation';
  end if;

  select count(*), sum(x.freight_base_minor), min(x.start_date), max(x.start_date)
  into n, sub, first_day, last_day
  from public.trips x
  where x.id = any (p_trip_ids);

  if p_invoice_date < last_day then
    raise exception 'تاريخ الفاتورة قبل تاريخ آخر نقلة فيها (%)', last_day using errcode = 'check_violation';
  end if;

  rate := case when c.vat_exempt then 0 else (select s.vat_rate_pct from public.company_settings s) end;
  vat := round(sub * rate / 100)::bigint;

  insert into public.invoices
    (id, client_id, invoice_date, due_date, period_from, period_to, lines_count,
     subtotal_minor, vat_rate_pct, vat_minor, total_minor, notes)
  values
    (inv, p_client_id, p_invoice_date, p_invoice_date + c.payment_terms_days, first_day, last_day, n,
     sub, rate, vat, sub + vat, nullif(btrim(coalesce(p_notes, '')), ''));

  insert into public.invoice_lines
    (invoice_id, trip_id, line_no, load_date, client_ref, client_doc_no, route, cargo_description,
     cargo_weight_tons, currency, freight_minor, fx_rate, amount_minor)
  select inv, x.id, row_number() over (order by x.start_date, x.client_ref_no, x.trip_no), x.start_date,
         x.client_ref, x.client_doc_no, concat_ws(' ← ', fl.name, tl.name), x.cargo_description,
         x.cargo_weight_tons, x.currency, x.freight_minor, x.fx_rate, x.freight_base_minor
  from public.trips x
  left join public.locations fl on fl.id = x.from_location_id
  left join public.locations tl on tl.id = x.to_location_id
  where x.id = any (p_trip_ids);

  perform set_config('app.invoicing', 'on', true);
  update public.trips set invoice_id = inv where id = any (p_trip_ids);
  perform set_config('app.invoicing', '', true);

  perform app.post_invoice_row(inv, null);
  return inv;
end;
$$;

create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
begin
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception 'إلغاء الفواتير للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'اكتب سبب الإلغاء' using errcode = 'check_violation';
  end if;

  select i.status into st from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'الفاتورة غير موجودة' using errcode = 'no_data_found';
  end if;
  if st <> 'issued' then
    raise exception 'الفاتورة ملغاة مسبقاً' using errcode = 'check_violation';
  end if;

  perform set_config('app.invoicing', 'on', true);
  update public.trips set invoice_id = null where invoice_id = p_invoice_id;
  perform set_config('app.invoicing', '', true);

  update public.invoices
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
  where id = p_invoice_id;

  perform app.post_invoice_row(p_invoice_id, 'إلغاء الفاتورة: ' || btrim(p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Receipts and cheques
-- ---------------------------------------------------------------------------
create function app.post_receipt_row(r public.client_receipts, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  client text := coalesce((select c.name from public.clients c where c.id = r.client_id), '');
  debit_code text := case r.method when 'cash' then '1101' when 'bank' then '1102' when 'cheque' then '1104' else '4103' end;
  cheques uuid := app.account_by_code('1104');
begin
  perform app.sync_source_entry(
    'receipt', r.id, r.received_on,
    'سند قبض رقم ' || r.receipt_no || ' — ' || client
      || case r.method when 'cash' then ' (نقداً)' when 'bank' then ' (تحويل بنكي)'
                       when 'cheque' then ' (شيك رقم ' || r.cheque_no || ')' else ' (خصم)' end,
    jsonb_build_array(
      app.jline(app.account_by_code(debit_code), r.amount_minor, 0),
      app.jline(app.account_by_code('1103'), 0, r.amount_minor, p_client_id => r.client_id)),
    p_reason);

  -- A cheque leaves "under collection" when it clears into the bank or bounces back onto the customer.
  perform app.sync_source_entry(
    'cheque', r.id, r.cheque_status_on,
    case r.cheque_status when 'cleared' then 'تحصيل شيك رقم ' else 'شيك مرتجع رقم ' end || coalesce(r.cheque_no, '') || ' — ' || client,
    case
      when r.method = 'cheque' and r.cheque_status = 'cleared' then
        jsonb_build_array(app.jline(app.account_by_code('1102'), r.amount_minor, 0), app.jline(cheques, 0, r.amount_minor))
      when r.method = 'cheque' and r.cheque_status = 'bounced' then
        jsonb_build_array(app.jline(app.account_by_code('1103'), r.amount_minor, 0, p_client_id => r.client_id),
                          app.jline(cheques, 0, r.amount_minor))
    end,
    coalesce(p_reason, 'تغيير حالة الشيك'));
end;
$$;

create function app.post_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.sync_source_entry('cheque', old.id, null, null, null, 'حذف سند القبض');
    perform app.sync_source_entry('receipt', old.id, null, null, null, 'حذف سند القبض');
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.client_id, new.received_on, new.method, new.amount_minor, new.cheque_no, new.cheque_status, new.cheque_status_on)
         is not distinct from
         (old.client_id, old.received_on, old.method, old.amount_minor, old.cheque_no, old.cheque_status, old.cheque_status_on) then
    return null;
  end if;
  perform app.post_receipt_row(new, case when tg_op = 'UPDATE' then 'تعديل سند القبض' end);
  return null;
end;
$$;

create trigger client_receipts_post after insert or update or delete on public.client_receipts
  for each row execute function app.post_receipt();

-- ---------------------------------------------------------------------------
-- 3. Post what already exists, in date order
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (
      select i.invoice_date as d, 1 as k, i.id from public.invoices i
      union all
      select x.received_on, 2, x.id from public.client_receipts x
    ) q
    order by d, k, id
  loop
    if r.k = 1 then
      perform app.post_invoice_row(r.id, null);
    else
      perform app.post_receipt_row((select x from public.client_receipts x where x.id = r.id), null);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The ledger shows invoice, receipt and cheque numbers (appended columns)
-- ---------------------------------------------------------------------------
create or replace view public.ledger_lines_v
with (security_invoker = on) as
select
  l.id,
  l.entry_id,
  e.entry_no,
  e.entry_date,
  e.description as entry_description,
  e.status,
  e.source_type,
  e.source_id,
  e.reverses_entry_id,
  l.line_no,
  l.account_id,
  a.code as account_code,
  a.name_ar as account_name,
  a.type as account_type,
  l.truck_id,
  t.code as truck_code,
  l.supplier_id,
  s.name as supplier_name,
  l.driver_id,
  d.full_name as driver_name,
  l.client_id,
  c.name as client_name,
  l.debit_minor,
  l.credit_minor,
  coalesce(xe.voucher_no, xf.voucher_no, xa.voucher_no) as voucher_no,
  xe.customs_declaration_no,
  coalesce(xe.notice_no, xf.notice_no, xa.notice_no, xr.reference_no) as notice_no,
  xe.reference_no,
  coalesce(xe.notes, xf.notes, xa.notes, xr.notes, xi.notes) as notes,
  xi.invoice_no,
  xr.receipt_no,
  xr.cheque_no
from public.journal_lines l
join public.journal_entries e on e.id = l.entry_id
join public.accounts a on a.id = l.account_id
left join public.trucks t on t.id = l.truck_id
left join public.suppliers s on s.id = l.supplier_id
left join public.drivers d on d.id = l.driver_id
left join public.clients c on c.id = l.client_id
left join public.expenses xe on e.source_type = 'expense' and xe.id = e.source_id
left join public.fuel_fillups xf on e.source_type = 'fuel' and xf.id = e.source_id
left join public.driver_advances xa on e.source_type = 'advance' and xa.id = e.source_id
left join public.invoices xi on e.source_type = 'invoice' and xi.id = e.source_id
left join public.client_receipts xr on e.source_type in ('receipt', 'cheque') and xr.id = e.source_id
where e.status <> 'draft';

revoke execute on function
  app.post_invoice_row(uuid, text), app.post_receipt_row(public.client_receipts, text), app.post_receipt()
  from public, anon, authenticated;
