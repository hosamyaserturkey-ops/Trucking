-- Migration 15: customer invoices, receipts (cash, bank, cheques, discounts)
-- and statements.
--
-- An invoice is issued for one customer from loads that are finished and not
-- yet invoiced (loading sheet lines and trips alike). It is final once
-- issued: to correct one, cancel it (with a reason) and its loads become
-- free to invoice again. Invoices and their lines are written only by
-- create_invoice() and cancel_invoice(), never directly through the API.
--
-- Everything is in JOD: a USD load is invoiced at the rate stored with it.
-- Sales tax uses the company rate (16% by default) unless the customer is
-- marked tax-exempt. A customer's balance is what was invoiced minus what was
-- received; a bounced cheque counts again from the day it bounced.

-- ---------------------------------------------------------------------------
-- 1. Settings and customers
-- ---------------------------------------------------------------------------
alter table public.company_settings
  add column vat_rate_pct numeric(5, 2) not null default 16 check (vat_rate_pct between 0 and 50),
  add column tax_number text,
  add column address text,
  add column phone text;

alter table public.clients
  add column vat_exempt boolean not null default false;

comment on column public.clients.vat_exempt is 'Invoices for this customer carry no sales tax.';

-- ---------------------------------------------------------------------------
-- 2. Invoices and their lines
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no bigint generated always as identity unique,
  client_id uuid not null references public.clients (id) on delete restrict,
  invoice_date date not null,
  due_date date not null,
  period_from date not null,
  period_to date not null,
  lines_count integer not null check (lines_count > 0),
  subtotal_minor bigint not null check (subtotal_minor > 0),
  vat_rate_pct numeric(5, 2) not null check (vat_rate_pct >= 0),
  vat_minor bigint not null check (vat_minor >= 0),
  total_minor bigint not null,
  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  notes text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (total_minor = subtotal_minor + vat_minor),
  check (period_from <= period_to and period_to <= invoice_date),
  check (due_date >= invoice_date),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (status <> 'cancelled' or nullif(btrim(coalesce(cancel_reason, '')), '') is not null)
);

create index invoices_client_date_idx on public.invoices (client_id, invoice_date);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  -- Kept as history if a load of a cancelled invoice is deleted later.
  trip_id uuid references public.trips (id) on delete set null,
  line_no integer not null check (line_no > 0),
  load_date date not null,
  client_ref text,
  client_doc_no text,
  route text,
  cargo_description text,
  cargo_weight_tons numeric(8, 2),
  currency char(3) not null references public.currencies (code),
  freight_minor bigint not null check (freight_minor > 0),
  fx_rate numeric(18, 8) not null check (fx_rate > 0),
  amount_minor bigint not null check (amount_minor > 0),
  unique (invoice_id, line_no)
);

comment on column public.invoice_lines.amount_minor is 'Line amount in JOD fils, fixed when the invoice is issued.';

create index invoice_lines_trip_idx on public.invoice_lines (trip_id);

-- The invoice a load is on now. Cleared again if that invoice is cancelled.
alter table public.trips
  add column invoice_id uuid references public.invoices (id) on delete restrict;

create index trips_invoice_idx on public.trips (invoice_id);

-- An issued invoice never changes, except to be cancelled; nothing is deleted.
create function app.guard_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'لا يمكن حذف فاتورة؛ ألغها بدلاً من ذلك' using errcode = 'check_violation';
  end if;
  if (new.invoice_no, new.client_id, new.invoice_date, new.due_date, new.period_from, new.period_to,
      new.lines_count, new.subtotal_minor, new.vat_rate_pct, new.vat_minor, new.total_minor, new.notes)
     is distinct from
     (old.invoice_no, old.client_id, old.invoice_date, old.due_date, old.period_from, old.period_to,
      old.lines_count, old.subtotal_minor, old.vat_rate_pct, old.vat_minor, old.total_minor, old.notes) then
    raise exception 'الفاتورة الصادرة لا تُعدّل؛ ألغها وأصدر فاتورة جديدة' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and not (old.status = 'issued' and new.status = 'cancelled') then
    raise exception 'لا يمكن إعادة فاتورة ملغاة' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger invoices_guard before update or delete on public.invoices
  for each row execute function app.guard_invoice();

create function app.guard_invoice_line()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The one change allowed: a load of a cancelled invoice was deleted (on delete set null).
  if tg_op = 'UPDATE' and new.trip_id is null and old.trip_id is not null
     and (to_jsonb(new) - 'trip_id') = (to_jsonb(old) - 'trip_id') then
    return new;
  end if;
  raise exception 'سطور الفاتورة لا تُعدّل ولا تُحذف' using errcode = 'check_violation';
end;
$$;

create trigger invoice_lines_guard before update or delete on public.invoice_lines
  for each row execute function app.guard_invoice_line();

-- An invoiced load keeps what was invoiced: customer, date, amount, status.
-- Only create_invoice() and cancel_invoice() set or clear its invoice.
create function app.guard_invoiced_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then
      raise exception 'النقلة مفوترة ولا يمكن حذفها؛ ألغِ الفاتورة أولاً' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if new.invoice_id is distinct from old.invoice_id
     and coalesce(current_setting('app.invoicing', true), '') <> 'on' then
    raise exception 'الفوترة تتم من شاشة الفواتير فقط' using errcode = 'check_violation';
  end if;

  if old.invoice_id is not null and new.invoice_id is not distinct from old.invoice_id
     and (new.client_id, new.start_date, new.currency, new.freight_minor, new.fx_rate, new.status, new.is_empty_return)
         is distinct from
         (old.client_id, old.start_date, old.currency, old.freight_minor, old.fx_rate, old.status, old.is_empty_return) then
    raise exception 'النقلة مفوترة؛ لا يمكن تغيير الزبون أو التاريخ أو الأجرة. ألغِ الفاتورة أولاً'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trips_guard_invoiced before update or delete on public.trips
  for each row execute function app.guard_invoiced_trip();

-- ---------------------------------------------------------------------------
-- 3. Issuing and cancelling invoices
-- ---------------------------------------------------------------------------
create function public.create_invoice(
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

  return inv;
end;
$$;

create function public.cancel_invoice(p_invoice_id uuid, p_reason text)
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
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Receipts: cash, bank transfer, cheque, discount
-- ---------------------------------------------------------------------------
create table public.client_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint generated always as identity unique,
  client_id uuid not null references public.clients (id) on delete restrict,
  received_on date not null,
  method text not null check (method in ('cash', 'bank', 'cheque', 'discount')),
  amount_minor bigint not null check (amount_minor > 0),
  reference_no text check (char_length(reference_no) <= 60),
  cheque_no text check (char_length(cheque_no) <= 30),
  cheque_bank text check (char_length(cheque_bank) <= 60),
  cheque_due_date date,
  cheque_status text check (cheque_status in ('in_hand', 'deposited', 'cleared', 'bounced')),
  cheque_status_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check ((method = 'cheque') = (cheque_no is not null and cheque_due_date is not null and cheque_status is not null)),
  check (method = 'cheque' or (cheque_no is null and cheque_bank is null and cheque_due_date is null
                              and cheque_status is null and cheque_status_on is null)),
  check ((cheque_status is null or cheque_status = 'in_hand') = (cheque_status_on is null)),
  check (cheque_status_on is null or cheque_status_on >= received_on)
);

comment on column public.client_receipts.amount_minor is 'Amount in JOD fils.';
comment on column public.client_receipts.cheque_status_on is 'Day the cheque was deposited, cleared or bounced.';

create index client_receipts_client_date_idx on public.client_receipts (client_id, received_on);
create index client_receipts_cheques_idx on public.client_receipts (cheque_status, cheque_due_date) where method = 'cheque';

-- Statement lines per customer: issued invoices (debit), receipts (credit),
-- and a bounced cheque again as a debit on the day it bounced.
create view public.client_statement_v
with (security_invoker = on) as
select i.client_id, i.invoice_date as entry_date, 'invoice'::text as kind, i.id as doc_id, i.invoice_no as doc_no,
       null::text as method, i.lines_count, i.period_from, i.period_to,
       i.total_minor as debit_minor, 0::bigint as credit_minor, 1 as kind_order, i.created_at
from public.invoices i
where i.status = 'issued'
union all
select r.client_id, r.received_on, 'receipt', r.id, r.receipt_no, r.method, null, null, null,
       0, r.amount_minor, 2, r.created_at
from public.client_receipts r
union all
select r.client_id, r.cheque_status_on, 'bounced', r.id, r.receipt_no, r.method, null, null, null,
       r.amount_minor, 0, 3, r.updated_at
from public.client_receipts r
where r.cheque_status = 'bounced';

-- What each customer owes. Overdue: invoices past their due date not yet
-- covered by what was received (oldest invoices are paid first).
create view public.client_balance_v
with (security_invoker = on) as
with inv as (
  select i.client_id,
         sum(i.total_minor) as invoiced,
         sum(i.total_minor) filter (where i.due_date < app.today()) as due,
         max(i.invoice_date) as last_invoice
  from public.invoices i
  where i.status = 'issued'
  group by i.client_id
), rec as (
  select r.client_id,
         sum(r.amount_minor) filter (where r.cheque_status is distinct from 'bounced') as received,
         sum(r.amount_minor) filter (where r.cheque_status in ('in_hand', 'deposited')) as cheques_pending,
         max(r.received_on) as last_receipt
  from public.client_receipts r
  group by r.client_id
), unbilled as (
  select x.client_id, count(*) as loads, sum(x.freight_base_minor) as amount
  from public.trips x
  where x.status = 'completed' and not x.is_empty_return and x.invoice_id is null
    and x.client_id is not null and x.freight_base_minor > 0
  group by x.client_id
)
select c.id as client_id,
       c.name,
       c.ref_code,
       c.is_active,
       coalesce(inv.invoiced, 0)::bigint as invoiced_minor,
       coalesce(rec.received, 0)::bigint as received_minor,
       (coalesce(inv.invoiced, 0) - coalesce(rec.received, 0))::bigint as balance_minor,
       greatest(coalesce(inv.due, 0) - coalesce(rec.received, 0), 0)::bigint as overdue_minor,
       coalesce(rec.cheques_pending, 0)::bigint as cheques_pending_minor,
       coalesce(unbilled.loads, 0)::integer as unbilled_loads,
       coalesce(unbilled.amount, 0)::bigint as unbilled_minor,
       inv.last_invoice,
       rec.last_receipt
from public.clients c
left join inv on inv.client_id = c.id
left join rec on rec.client_id = c.id
left join unbilled on unbilled.client_id = c.id;

-- ---------------------------------------------------------------------------
-- 5. RLS, grants, audit
-- ---------------------------------------------------------------------------
-- Invoices and lines: finance reads; writes only through the functions above.
select app.staff_policies('public.invoices', '{manager,accountant}', '{}');
select app.staff_policies('public.invoice_lines', '{manager,accountant}', '{}');
select app.staff_policies('public.client_receipts', '{manager,accountant}', '{manager,accountant}');

revoke execute on function
  app.guard_invoice(), app.guard_invoice_line(), app.guard_invoiced_trip(),
  public.create_invoice(uuid, date, uuid[], text), public.cancel_invoice(uuid, text)
  from public, anon;
grant execute on function
  public.create_invoice(uuid, date, uuid[], text), public.cancel_invoice(uuid, text)
  to authenticated;

select app.track('public.invoices');
select app.track('public.invoice_lines');
select app.track('public.client_receipts');
