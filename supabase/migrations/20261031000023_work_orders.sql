-- Migration 23: maintenance work orders (أوامر الصيانة) as a workflow, posted
-- to the journal when the workshop's invoice is in.
--
--   open        the truck is in the workshop: staff (manager, accountant,
--               dispatcher) open the order and add its lines (parts, labour,
--               tires) while it is open
--   closed      the manager or accountant closes it with the workshop's
--               invoice and how it is paid; the order then counts:
--                 Dr 5102 maintenance (on the truck)   Cr 2101 the workshop (on credit)
--                 Dr 5103 tires (on the truck)           / 1101 cash / 1102 bank
--               The services done on it (oil change, brakes, ...) are marked
--               done at the order's odometer and date.
--   cancelled   with a reason; never counted, never posted
--
-- A closed order's lines and amounts never change; to correct one, the
-- manager or accountant reopens it (its entry is reversed) and closes it
-- again. Truck profit counts closed orders only, on the day they closed, so
-- it agrees with the ledger.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.work_orders
  add column payment_method text check (payment_method in ('credit', 'cash', 'bank')),
  add column voucher_no text check (voucher_no = btrim(voucher_no) and char_length(voucher_no) between 1 and 30),
  add column notice_no text check (notice_no = btrim(notice_no) and char_length(notice_no) between 1 and 40),
  add column notes text check (char_length(notes) <= 500),
  add column cancel_reason text check (char_length(cancel_reason) <= 300),
  add column closed_by uuid;

comment on column public.work_orders.payment_method is 'How the workshop invoice is paid: credit (on the workshop''s account), cash or bank.';
comment on column public.work_orders.voucher_no is 'Payment voucher number (سند صرف) when paid in cash; shared with expenses, fill-ups, advances and payments.';
comment on column public.work_orders.invoice_path is 'Scan of the workshop invoice in R2 (truck-documents/<path>).';

-- Orders closed before this migration were bought from their workshop on credit.
update public.work_orders
set payment_method = case when workshop_id is not null then 'credit' else 'cash' end
where status = 'closed' and payment_method is null;

update public.work_orders
set cancel_reason = 'ملغى قبل تفعيل سير العمل'
where status = 'cancelled' and nullif(btrim(coalesce(cancel_reason, '')), '') is null;

alter table public.work_orders
  add constraint work_orders_closed_paid check (status <> 'closed' or payment_method is not null),
  add constraint work_orders_credit_workshop check (payment_method is distinct from 'credit' or workshop_id is not null),
  add constraint work_orders_cancel_reason check (status <> 'cancelled' or nullif(btrim(coalesce(cancel_reason, '')), '') is not null),
  add constraint work_orders_description_length check (char_length(description) between 1 and 200),
  add constraint work_orders_invoice_no_length check (char_length(invoice_no) <= 40),
  add constraint work_orders_invoice_path_format
    check (invoice_path is null or invoice_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|pdf)$');

alter table public.work_order_lines
  add constraint work_order_lines_description_length check (char_length(description) between 1 and 200),
  add constraint work_order_lines_part_number_length check (char_length(part_number) <= 40);

create index work_orders_status_idx on public.work_orders (status, opened_on);

-- The order a service was last done on.
alter table public.service_schedules
  add column last_work_order_id uuid references public.work_orders (id) on delete set null;

create index service_schedules_work_order_idx on public.service_schedules (last_work_order_id);

-- ---------------------------------------------------------------------------
-- 2. Rules
-- ---------------------------------------------------------------------------
create function app.guard_work_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- The seed and migrations run without a user.
  finance boolean := auth.uid() is null or app.has_role('manager', 'accountant');
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'أمر الصيانة يُفتح أولاً ثم يُغلق' using errcode = 'check_violation';
    end if;
    new.closed_on := null;
    new.closed_by := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'open' then
      raise exception 'لا يمكن حذف أمر صيانة مغلق أو ملغى' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'cancelled' then
    raise exception 'أمر الصيانة ملغى ولا يُعدّل' using errcode = 'check_violation';
  end if;

  if old.status = 'open' and new.status = 'open' then
    new.closed_on := null;
    return new;
  end if;

  if old.status = 'open' and new.status = 'closed' then
    if not finance then
      raise exception 'إغلاق أوامر الصيانة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
    end if;
    if new.total_minor <= 0 then
      raise exception 'أضف بنود أمر الصيانة قبل إغلاقه' using errcode = 'check_violation';
    end if;
    if new.closed_on is null or new.closed_on > app.today() then
      raise exception 'تاريخ الإغلاق غير صحيح' using errcode = 'check_violation';
    end if;
    new.closed_by := auth.uid();
    new.cancel_reason := null;
    return new;
  end if;

  if old.status = 'open' and new.status = 'cancelled' then
    new.closed_on := null;
    return new;
  end if;

  if old.status = 'closed' and new.status = 'open' then
    if not finance then
      raise exception 'إعادة فتح أوامر الصيانة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
    end if;
    new.closed_on := null;
    new.closed_by := null;
    return new;
  end if;

  if old.status = 'closed' and new.status = 'closed' then
    -- Only the paperwork can change: invoice number and scan, voucher and notice numbers, notes.
    if (new.truck_id, new.workshop_id, new.kind, new.opened_on, new.closed_on, new.odometer, new.description,
        new.currency, new.fx_rate, new.total_minor, new.payment_method, new.wo_no)
       is distinct from
       (old.truck_id, old.workshop_id, old.kind, old.opened_on, old.closed_on, old.odometer, old.description,
        old.currency, old.fx_rate, old.total_minor, old.payment_method, old.wo_no) then
      raise exception 'أمر الصيانة مغلق؛ أعد فتحه للتعديل' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  raise exception 'لا يمكن نقل أمر الصيانة من "%" إلى "%"', old.status, new.status using errcode = 'check_violation';
end;
$$;

create trigger work_orders_guard before insert or update or delete on public.work_orders
  for each row execute function app.guard_work_order();

-- Lines change only while their order is open.
create function app.guard_work_order_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st public.work_order_status;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select w.status into st from public.work_orders w where w.id = old.work_order_id;
    -- st is null while the order itself is being deleted (cascade).
    if st is not null and st <> 'open' then
      raise exception 'بنود أمر الصيانة لا تتغير بعد إغلاقه أو إلغائه' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select w.status into st from public.work_orders w where w.id = new.work_order_id;
    if st is distinct from 'open' then
      raise exception 'بنود أمر الصيانة لا تتغير بعد إغلاقه أو إلغائه' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  return old;
end;
$$;

create trigger work_order_lines_guard before insert or update or delete on public.work_order_lines
  for each row execute function app.guard_work_order_line();

-- One voucher number is used once, across every kind of payment.
create trigger work_orders_voucher after insert or update or delete on public.work_orders
  for each row execute function app.track_voucher('work_order');

-- ---------------------------------------------------------------------------
-- 3. Posting
-- ---------------------------------------------------------------------------
create function app.post_work_order_row(w public.work_orders, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tires_minor bigint;
  tires bigint;
  rest bigint;
  workshop text;
  lines jsonb;
begin
  if w.status <> 'closed' or w.total_base_minor <= 0 then
    perform app.sync_source_entry('work_order', w.id, null, null, null, p_reason);
    return;
  end if;

  -- Tires go to 5103, everything else to 5102 (both on the truck).
  select coalesce(sum(l.line_total_minor), 0) into tires_minor
  from public.work_order_lines l where l.work_order_id = w.id and l.line_type = 'tire';
  tires := case when w.total_minor > 0 then round(tires_minor::numeric * w.total_base_minor / w.total_minor)::bigint else 0 end;
  rest := w.total_base_minor - tires;
  select s.name into workshop from public.suppliers s where s.id = w.workshop_id;

  lines := '[]'::jsonb;
  if rest > 0 then
    lines := lines || jsonb_build_array(app.jline(app.account_by_code('5102'), rest, 0, p_truck_id => w.truck_id));
  end if;
  if tires > 0 then
    lines := lines || jsonb_build_array(app.jline(app.account_by_code('5103'), tires, 0, p_truck_id => w.truck_id));
  end if;
  lines := lines || jsonb_build_array(
    app.jline(app.account_by_code(case w.payment_method when 'cash' then '1101' when 'bank' then '1102' else '2101' end),
              0, w.total_base_minor,
              p_supplier_id => case when w.payment_method = 'credit' then w.workshop_id end));

  perform app.sync_source_entry(
    'work_order', w.id, w.closed_on,
    'أمر صيانة رقم ' || w.wo_no || ' — ' || w.description || coalesce(' — ' || workshop, ''),
    lines, p_reason);
end;
$$;

create function app.post_work_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.sync_source_entry('work_order', old.id, null, null, null, 'حذف أمر الصيانة');
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.status, new.total_base_minor, new.payment_method, new.truck_id, new.workshop_id, new.closed_on, new.description)
         is not distinct from
         (old.status, old.total_base_minor, old.payment_method, old.truck_id, old.workshop_id, old.closed_on, old.description) then
    return null;
  end if;
  perform app.post_work_order_row(new, case
    when new.status = 'open' and tg_op = 'UPDATE' and old.status = 'closed' then 'إعادة فتح أمر الصيانة'
    when new.status = 'cancelled' then 'إلغاء أمر الصيانة'
    else 'تعديل أمر الصيانة' end);
  return null;
end;
$$;

create trigger work_orders_post after insert or update or delete on public.work_orders
  for each row execute function app.post_work_order();

-- Close an order with the workshop's invoice, and mark the services done on it.
create function public.close_work_order(
  p_work_order_id uuid,
  p_closed_on date,
  p_payment_method text,
  p_invoice_no text default null,
  p_voucher_no text default null,
  p_notice_no text default null,
  p_schedule_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders;
begin
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception 'إغلاق أوامر الصيانة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'أمر الصيانة غير موجود' using errcode = 'no_data_found';
  end if;
  if w.status <> 'open' then
    raise exception 'أمر الصيانة ليس مفتوحاً' using errcode = 'check_violation';
  end if;
  if p_closed_on is null or p_closed_on < w.opened_on then
    raise exception 'تاريخ الإغلاق قبل تاريخ فتح الأمر' using errcode = 'check_violation';
  end if;
  if p_payment_method = 'credit' and w.workshop_id is null then
    raise exception 'اختر الورشة لتسجيل الفاتورة على حسابها' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_schedule_ids, '{}')) s (id)
    left join public.service_schedules x on x.id = s.id
    where x.id is null or x.truck_id <> w.truck_id
  ) then
    raise exception 'الصيانة الدورية المختارة لا تخص هذه الشاحنة' using errcode = 'check_violation';
  end if;
  if w.odometer is null and exists (
    select 1 from public.service_schedules x where x.id = any (coalesce(p_schedule_ids, '{}')) and x.interval_km is not null
  ) then
    raise exception 'أدخل قراءة العداد في أمر الصيانة لتسجيل الصيانة الدورية' using errcode = 'check_violation';
  end if;

  update public.work_orders
  set status = 'closed',
      closed_on = p_closed_on,
      payment_method = p_payment_method,
      invoice_no = coalesce(nullif(btrim(coalesce(p_invoice_no, '')), ''), invoice_no),
      voucher_no = case when p_payment_method = 'cash' then nullif(btrim(coalesce(p_voucher_no, '')), '') end,
      notice_no = case when p_payment_method = 'bank' then nullif(btrim(coalesce(p_notice_no, '')), '') end
  where id = w.id;

  update public.service_schedules
  set last_done_on = p_closed_on,
      last_done_odometer = coalesce(w.odometer, last_done_odometer),
      last_work_order_id = w.id
  where id = any (coalesce(p_schedule_ids, '{}'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Truck profit counts closed orders, on the day they closed
-- ---------------------------------------------------------------------------
create or replace view public.truck_pnl_facts_v
with (security_invoker = on) as
with settings as (
  select s.overhead_allocation, s.timezone from public.company_settings s
),
fleet as (
  select t.id, t.code, a.purchase_date
  from public.trucks t
  left join public.truck_assets a on a.truck_id = t.id
  where t.is_active
),
overhead as (
  select e.id, e.expense_date, e.amount_base_minor, ec.name_ar as category_name
  from public.expenses e
  join public.expense_categories ec on ec.id = e.category_id
  where e.cost_scope = 'overhead' and e.status = 'approved'
),
truck_km_month as (
  select x.truck_id, date_trunc('month', coalesce(x.end_date, x.start_date))::date as month,
         sum(greatest(coalesce(x.distance_km, 0), 0)) as km
  from public.trips x
  where x.status in ('in_progress', 'completed')
  group by 1, 2
),
alloc_base as (
  select
    o.id as expense_id,
    o.expense_date,
    o.amount_base_minor,
    o.category_name,
    f.id as truck_id,
    f.code,
    case
      when (select overhead_allocation from settings) = 'by_km'
        and sum(coalesce(k.km, 0)) over (partition by o.id) > 0
      then coalesce(k.km, 0)::numeric
      else 1::numeric
    end as weight
  from overhead o
  join fleet f on f.purchase_date is null or f.purchase_date <= o.expense_date
  left join truck_km_month k
    on k.truck_id = f.id and k.month = date_trunc('month', o.expense_date)::date
),
alloc_floor as (
  select
    a.*,
    floor(a.amount_base_minor * a.weight / sum(a.weight) over (partition by a.expense_id))::bigint as base_share,
    (a.amount_base_minor * a.weight / sum(a.weight) over (partition by a.expense_id))
      - floor(a.amount_base_minor * a.weight / sum(a.weight) over (partition by a.expense_id)) as frac
  from alloc_base a
),
alloc as (
  select
    a.*,
    a.amount_base_minor - sum(a.base_share) over (partition by a.expense_id) as leftover,
    row_number() over (partition by a.expense_id order by a.frac desc, a.code) as rn
  from alloc_floor a
),
depreciation as (
  select
    a.truck_id,
    (date_trunc('month', a.purchase_date) + make_interval(months => g.i - 1))::date as month,
    (floor((a.purchase_cost_base_minor - a.salvage_value_base_minor)::numeric * g.i / a.useful_life_months)
      - floor((a.purchase_cost_base_minor - a.salvage_value_base_minor)::numeric * (g.i - 1) / a.useful_life_months))::bigint
      as amount
  from public.truck_assets a
  cross join lateral generate_series(1, a.useful_life_months) as g(i)
  where a.purchase_date is not null
    and a.useful_life_months is not null
    and a.purchase_cost_base_minor > a.salvage_value_base_minor
    and date_trunc('month', a.purchase_date) + make_interval(months => g.i - 1) <= date_trunc('month', app.today())
)
select x.truck_id, coalesce(x.end_date, x.start_date) as fact_date, 'revenue'::text as kind,
       'إيرادات النقل'::text as category_name, x.freight_base_minor as amount_base_minor,
       'trips'::text as source_table, x.id as source_id
from public.trips x
where x.status in ('in_progress', 'completed') and x.freight_base_minor > 0
union all
select f.truck_id, (f.filled_at at time zone (select timezone from settings))::date, 'fuel',
       'الديزل', f.amount_base_minor, 'fuel_fillups', f.id
from public.fuel_fillups f
where f.status = 'approved'
union all
select w.truck_id, w.closed_on, 'maintenance',
       'الصيانة والإصلاح', w.total_base_minor, 'work_orders', w.id
from public.work_orders w
where w.status = 'closed' and w.total_base_minor > 0
union all
select e.truck_id, e.expense_date, 'expense', ec.name_ar, e.amount_base_minor, 'expenses', e.id
from public.expenses e
join public.expense_categories ec on ec.id = e.category_id
where e.cost_scope = 'truck' and e.status = 'approved'
union all
select d.truck_id, d.month, 'depreciation', 'استهلاك الشاحنة', d.amount, 'truck_assets', d.truck_id
from depreciation d
where d.amount > 0
union all
select tf.truck_id, i.due_date, 'interest', 'فوائد التمويل', i.interest_base_minor, 'financing_installments', i.id
from public.financing_installments i
join public.truck_financing tf on tf.id = i.financing_id
where i.interest_base_minor > 0 and i.due_date <= app.today()
union all
select a.truck_id, a.expense_date, 'overhead', 'مصاريف عامة موزعة: ' || a.category_name,
       a.base_share + case when a.rn <= a.leftover then 1 else 0 end, 'expenses', a.expense_id
from alloc a
where a.base_share + case when a.rn <= a.leftover then 1 else 0 end > 0;

-- ---------------------------------------------------------------------------
-- 5. The ledger shows the order number and its documents (one column appended)
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
  coalesce(xe.voucher_no, xf.voucher_no, xa.voucher_no, xp.voucher_no, xw.voucher_no) as voucher_no,
  xe.customs_declaration_no,
  coalesce(xe.notice_no, xf.notice_no, xa.notice_no, xr.reference_no, xp.reference_no, xw.notice_no) as notice_no,
  coalesce(xe.reference_no, xw.invoice_no) as reference_no,
  coalesce(xe.notes, xf.notes, xa.notes, xr.notes, xi.notes, xp.notes, xw.notes) as notes,
  xi.invoice_no,
  xr.receipt_no,
  coalesce(xr.cheque_no, xp.cheque_no) as cheque_no,
  xp.payment_no,
  xw.wo_no
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
left join public.supplier_payments xp on e.source_type in ('supplier_payment', 'issued_cheque') and xp.id = e.source_id
left join public.work_orders xw on e.source_type = 'work_order' and xw.id = e.source_id
where e.status <> 'draft';

-- ---------------------------------------------------------------------------
-- 6. Post the orders already closed, in date order (audit skipped)
-- ---------------------------------------------------------------------------
alter table public.journal_entries disable trigger journal_entries_audit;
alter table public.journal_lines disable trigger journal_lines_audit;

do $$
declare
  r record;
begin
  for r in select w.* from public.work_orders w where w.status = 'closed' order by w.closed_on, w.wo_no loop
    perform app.post_work_order_row(r, null);
  end loop;
end;
$$;

alter table public.journal_entries enable trigger journal_entries_audit;
alter table public.journal_lines enable trigger journal_lines_audit;

-- ---------------------------------------------------------------------------
-- 7. RLS and grants: the accountant now writes work orders too (closing them
--    is for the manager and the accountant, see the guard)
-- ---------------------------------------------------------------------------
drop policy work_orders_staff_read on public.work_orders;
drop policy work_orders_staff_insert on public.work_orders;
drop policy work_orders_staff_update on public.work_orders;
drop policy work_orders_staff_delete on public.work_orders;
select app.staff_policies('public.work_orders', '{manager,accountant,dispatcher}', '{manager,accountant,dispatcher}');

drop policy work_order_lines_staff_read on public.work_order_lines;
drop policy work_order_lines_staff_insert on public.work_order_lines;
drop policy work_order_lines_staff_update on public.work_order_lines;
drop policy work_order_lines_staff_delete on public.work_order_lines;
select app.staff_policies('public.work_order_lines', '{manager,accountant,dispatcher}', '{manager,accountant,dispatcher}');

revoke execute on function
  app.guard_work_order(), app.guard_work_order_line(),
  app.post_work_order_row(public.work_orders, text), app.post_work_order()
  from public, anon, authenticated;
revoke execute on function public.close_work_order(uuid, date, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.close_work_order(uuid, date, text, text, text, text, uuid[]) to authenticated;
