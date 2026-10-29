-- Migration 22: opening balances (الأرصدة الافتتاحية) on the day the company
-- starts using the system.
--
--   company_settings.opening_date   the first day in the system; balances are as
--                                   at the start of that day
--   opening_balances                one balance per account, customer or supplier,
--                                   posted together as one entry ('opening') dated
--                                   the opening date; the difference goes to
--                                   capital (3101 رأس المال)
--   opening driver advances         driver_advances with method 'opening':
--                                   Dr 1105 (the driver), Cr 3101; settled like any
--                                   advance
--   opening cheques                 cheques still in hand from customers and our
--                                   cheques not yet paid by the bank, one by one,
--                                   so they can be followed to the bank:
--                                     customer cheque (is_opening)  Dr 1104, Cr 3101
--                                     issued cheque (is_opening)    Dr 3101, Cr 2102
--                                   A customer's or supplier's opening balance is
--                                   entered net of these cheques; a bounced opening
--                                   cheque goes back onto the party as usual.
-- Customer, supplier, advance and cheque balances come only from their own
-- sections, never as plain account balances, so nothing is counted twice.

alter table public.company_settings add column opening_date date;
comment on column public.company_settings.opening_date is 'First day in the system; opening balances are as at the start of this day.';

-- ---------------------------------------------------------------------------
-- 1. Balances per account, customer, supplier
-- ---------------------------------------------------------------------------
create table public.opening_balances (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('account', 'client', 'supplier')),
  account_id uuid references public.accounts (id) on delete restrict,
  client_id uuid references public.clients (id) on delete restrict,
  supplier_id uuid references public.suppliers (id) on delete restrict,
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  notes text check (char_length(notes) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check ((debit_minor > 0) <> (credit_minor > 0)),
  check ((kind = 'account') = (account_id is not null)),
  check ((kind = 'client') = (client_id is not null)),
  check ((kind = 'supplier') = (supplier_id is not null))
);

comment on table public.opening_balances is 'Opening balance per account, customer or supplier (JOD fils); posted as one entry.';

create unique index opening_balances_account_key on public.opening_balances (account_id) where kind = 'account';
create unique index opening_balances_client_key on public.opening_balances (client_id) where kind = 'client';
create unique index opening_balances_supplier_key on public.opening_balances (supplier_id) where kind = 'supplier';

create function app.guard_opening_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acc record;
begin
  if (select s.opening_date from public.company_settings s) is null then
    raise exception 'حدد تاريخ بدء العمل أولاً' using errcode = 'check_violation';
  end if;
  if new.kind = 'account' then
    select a.code, a.is_postable into acc from public.accounts a where a.id = new.account_id;
    if not acc.is_postable then
      raise exception 'اختر حساباً فرعياً يقبل القيود' using errcode = 'check_violation';
    end if;
    if acc.code in ('1103', '1104', '1105', '2101', '2102') then
      raise exception 'أرصدة العملاء والموردين والعهد والشيكات تُدخل من أقسامها' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger opening_balances_guard before insert or update on public.opening_balances
  for each row execute function app.guard_opening_balance();

-- The single opening entry.
create function app.opening_source_id()
returns uuid
language sql
immutable
set search_path = ''
as $$ select '0e0e0e0e-0000-4000-8000-000000000001'::uuid $$;

create function app.post_opening_entry()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date := (select s.opening_date from public.company_settings s);
  lines jsonb;
  diff bigint;
begin
  select coalesce(jsonb_agg(app.jline(
           case o.kind when 'client' then app.account_by_code('1103')
                       when 'supplier' then app.account_by_code('2101')
                       else o.account_id end,
           o.debit_minor, o.credit_minor, p_supplier_id => o.supplier_id, p_client_id => o.client_id)
           order by o.kind, o.created_at, o.id), '[]'::jsonb),
         coalesce(sum(o.debit_minor - o.credit_minor), 0)
    into lines, diff
  from public.opening_balances o;

  if d is null or jsonb_array_length(lines) = 0 then
    perform app.sync_source_entry('opening', app.opening_source_id(), null, null, null, 'حذف الأرصدة الافتتاحية');
    return;
  end if;
  -- What the balances leave over is the owners' capital.
  if diff <> 0 then
    lines := lines || jsonb_build_array(app.jline(app.account_by_code('3101'), greatest(-diff, 0), greatest(diff, 0)));
  end if;
  perform app.sync_source_entry('opening', app.opening_source_id(), d, 'الأرصدة الافتتاحية', lines, 'تعديل الأرصدة الافتتاحية');
end;
$$;

create function app.post_opening()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.post_opening_entry();
  return null;
end;
$$;

create trigger opening_balances_post after insert or update or delete on public.opening_balances
  for each statement execute function app.post_opening();

-- ---------------------------------------------------------------------------
-- 2. Opening driver advances and opening cheques
-- ---------------------------------------------------------------------------
alter table public.driver_advances drop constraint driver_advances_method_check;
alter table public.driver_advances add constraint driver_advances_method_check check (method in ('cash', 'bank', 'opening'));

alter table public.client_receipts
  add column is_opening boolean not null default false,
  add constraint client_receipts_opening_cheque check (not is_opening or method = 'cheque');
alter table public.supplier_payments
  add column is_opening boolean not null default false,
  add constraint supplier_payments_opening_cheque check (not is_opening or method = 'cheque');

comment on column public.client_receipts.is_opening is 'A customer cheque still in hand on the opening date; not credited to the customer.';
comment on column public.supplier_payments.is_opening is 'Our cheque not yet paid by the bank on the opening date; not debited to the supplier.';

-- Opening documents are dated the opening date.
create function app.guard_opening_doc()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d date := (select s.opening_date from public.company_settings s);
  opening boolean;
  on_date date;
begin
  if tg_table_name = 'client_receipts' then
    opening := new.is_opening; on_date := new.received_on;
  elsif tg_table_name = 'supplier_payments' then
    opening := new.is_opening; on_date := new.paid_on;
  else
    opening := new.method = 'opening'; on_date := new.issued_on;
  end if;
  if opening and d is null then
    raise exception 'حدد تاريخ بدء العمل أولاً' using errcode = 'check_violation';
  end if;
  if opening and on_date <> d then
    raise exception 'الرصيد الافتتاحي يكون بتاريخ بدء العمل' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger client_receipts_opening before insert or update on public.client_receipts
  for each row execute function app.guard_opening_doc();
create trigger supplier_payments_opening before insert or update on public.supplier_payments
  for each row execute function app.guard_opening_doc();
create trigger driver_advances_opening before insert or update on public.driver_advances
  for each row execute function app.guard_opening_doc();

-- An opening advance comes out of capital, not the cash box.
create or replace function app.payment_account(p_method text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select app.account_by_code(case p_method
    when 'cash' then '1101'
    when 'bank' then '1102'
    when 'card' then '1102'
    when 'check' then '1102'
    when 'credit' then '2101'
    when 'driver_advance' then '1105'
    when 'own_tank' then '1106'
    when 'opening' then '3101'
  end)
$$;

create or replace function app.post_advance_row(a public.driver_advances, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.sync_source_entry(
    'advance', a.id, a.issued_on,
    case when a.method = 'opening' then 'عهدة افتتاحية مع السائق ' else 'عهدة للسائق ' end
      || coalesce((select d.full_name from public.drivers d where d.id = a.driver_id), ''),
    jsonb_build_array(
      app.jline(app.account_by_code('1105'), a.amount_base_minor, 0, p_driver_id => a.driver_id),
      app.jline(app.payment_account(a.method), 0, a.amount_base_minor)),
    p_reason);
end;
$$;

-- Customer receipts: an opening cheque is an asset against capital.
create or replace function app.post_receipt_row(r public.client_receipts, p_reason text)
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
    case when r.is_opening then 'شيك افتتاحي رقم ' || r.cheque_no || ' — ' || client
         else 'سند قبض رقم ' || r.receipt_no || ' — ' || client
              || case r.method when 'cash' then ' (نقداً)' when 'bank' then ' (تحويل بنكي)'
                               when 'cheque' then ' (شيك رقم ' || r.cheque_no || ')' else ' (خصم)' end end,
    case when r.is_opening then
      jsonb_build_array(app.jline(cheques, r.amount_minor, 0), app.jline(app.account_by_code('3101'), 0, r.amount_minor))
    else
      jsonb_build_array(
        app.jline(app.account_by_code(debit_code), r.amount_minor, 0),
        app.jline(app.account_by_code('1103'), 0, r.amount_minor, p_client_id => r.client_id))
    end,
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

create or replace function app.post_receipt()
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
     and (new.client_id, new.received_on, new.method, new.amount_minor, new.cheque_no, new.cheque_status, new.cheque_status_on, new.is_opening)
         is not distinct from
         (old.client_id, old.received_on, old.method, old.amount_minor, old.cheque_no, old.cheque_status, old.cheque_status_on, old.is_opening) then
    return null;
  end if;
  perform app.post_receipt_row(new, case when tg_op = 'UPDATE' then 'تعديل سند القبض' end);
  return null;
end;
$$;

-- Supplier payments: an opening cheque is owed by the bank against capital.
create or replace function app.post_supplier_payment_row(p public.supplier_payments, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier text := coalesce((select s.name from public.suppliers s where s.id = p.supplier_id), '');
  credit_code text := case p.method when 'cash' then '1101' when 'bank' then '1102' when 'cheque' then '2102' else '4104' end;
  issued uuid := app.account_by_code('2102');
begin
  perform app.sync_source_entry(
    'supplier_payment', p.id, p.paid_on,
    case when p.is_opening then 'شيك صادر افتتاحي رقم ' || p.cheque_no || ' — ' || supplier
         else 'دفعة لمورد رقم ' || p.payment_no || ' — ' || supplier
              || case p.method when 'cash' then ' (نقداً)' when 'bank' then ' (تحويل بنكي)'
                               when 'cheque' then ' (شيك رقم ' || p.cheque_no || ')' else ' (خصم مكتسب)' end end,
    jsonb_build_array(
      case when p.is_opening then app.jline(app.account_by_code('3101'), p.amount_minor, 0)
           else app.jline(app.account_by_code('2101'), p.amount_minor, 0, p_supplier_id => p.supplier_id) end,
      app.jline(app.account_by_code(credit_code), 0, p.amount_minor,
                p_supplier_id => case when p.method = 'cheque' then p.supplier_id end)),
    p_reason);

  -- A cheque leaves "post-dated cheques" when the bank pays it, or goes back
  -- onto the supplier's account when it bounces.
  perform app.sync_source_entry(
    'issued_cheque', p.id, p.cheque_status_on,
    case p.cheque_status when 'cleared' then 'صرف شيك صادر رقم ' else 'شيك صادر مرتجع رقم ' end
      || coalesce(p.cheque_no, '') || ' — ' || supplier,
    case
      when p.method = 'cheque' and p.cheque_status = 'cleared' then
        jsonb_build_array(app.jline(issued, p.amount_minor, 0, p_supplier_id => p.supplier_id),
                          app.jline(app.account_by_code('1102'), 0, p.amount_minor))
      when p.method = 'cheque' and p.cheque_status = 'bounced' then
        jsonb_build_array(app.jline(issued, p.amount_minor, 0, p_supplier_id => p.supplier_id),
                          app.jline(app.account_by_code('2101'), 0, p.amount_minor, p_supplier_id => p.supplier_id))
    end,
    coalesce(p_reason, 'تغيير حالة الشيك'));
end;
$$;

create or replace function app.post_supplier_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.sync_source_entry('issued_cheque', old.id, null, null, null, 'حذف دفعة المورد');
    perform app.sync_source_entry('supplier_payment', old.id, null, null, null, 'حذف دفعة المورد');
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.supplier_id, new.paid_on, new.method, new.amount_minor, new.cheque_no, new.cheque_status, new.cheque_status_on, new.is_opening)
         is not distinct from
         (old.supplier_id, old.paid_on, old.method, old.amount_minor, old.cheque_no, old.cheque_status, old.cheque_status_on, old.is_opening) then
    return null;
  end if;
  perform app.post_supplier_payment_row(new, case when tg_op = 'UPDATE' then 'تعديل دفعة المورد' end);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The opening date: setting it (manager or accountant) moves the opening
--    documents with it; it can be cleared only once nothing hangs on it.
-- ---------------------------------------------------------------------------
create function public.set_opening_date(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_role('manager', 'accountant') then
    raise exception 'لا تملك صلاحية تحديد تاريخ بدء العمل' using errcode = 'insufficient_privilege';
  end if;
  if p_date is null and (exists (select 1 from public.opening_balances)
                         or exists (select 1 from public.client_receipts where is_opening)
                         or exists (select 1 from public.supplier_payments where is_opening)
                         or exists (select 1 from public.driver_advances where method = 'opening')) then
    raise exception 'احذف الأرصدة الافتتاحية قبل إزالة تاريخ البدء' using errcode = 'check_violation';
  end if;
  update public.company_settings set opening_date = p_date where id;
  update public.client_receipts set received_on = p_date where is_opening and received_on <> p_date;
  update public.supplier_payments set paid_on = p_date where is_opening and paid_on <> p_date;
  update public.driver_advances set issued_on = p_date where method = 'opening' and settlement_id is null and issued_on <> p_date;
  perform app.post_opening_entry();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Customer balance and statement include the opening balance; opening
--    cheques are not receipts (the balance was entered net of them)
-- ---------------------------------------------------------------------------
create or replace view public.client_statement_v
with (security_invoker = on) as
select o.client_id, s.opening_date as entry_date, 'opening'::text as kind, o.id as doc_id, 0::bigint as doc_no,
       null::text as method, null::integer as lines_count, null::date as period_from, null::date as period_to,
       o.debit_minor, o.credit_minor, 0 as kind_order, o.created_at
from public.opening_balances o
cross join public.company_settings s
where o.kind = 'client' and s.opening_date is not null
union all
select i.client_id, i.invoice_date, 'invoice', i.id, i.invoice_no,
       null, i.lines_count, i.period_from, i.period_to,
       i.total_minor, 0::bigint, 1, i.created_at
from public.invoices i
where i.status = 'issued'
union all
select r.client_id, r.received_on, 'receipt', r.id, r.receipt_no, r.method, null, null, null,
       0, r.amount_minor, 2, r.created_at
from public.client_receipts r
where not r.is_opening
union all
select r.client_id, r.cheque_status_on, 'bounced', r.id, r.receipt_no, r.method, null, null, null,
       r.amount_minor, 0, 3, r.updated_at
from public.client_receipts r
where r.cheque_status = 'bounced';

create or replace view public.client_balance_v
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
         sum(r.amount_minor) filter (where r.cheque_status is distinct from 'bounced' and not r.is_opening) as received,
         sum(r.amount_minor) filter (where r.cheque_status = 'bounced' and r.is_opening) as bounced_opening,
         sum(r.amount_minor) filter (where r.cheque_status in ('in_hand', 'deposited')) as cheques_pending,
         max(r.received_on) filter (where not r.is_opening) as last_receipt
  from public.client_receipts r
  group by r.client_id
), unbilled as (
  select x.client_id, count(*) as loads, sum(x.freight_base_minor) as amount
  from public.trips x
  where x.status = 'completed' and not x.is_empty_return and x.invoice_id is null
    and x.client_id is not null and x.freight_base_minor > 0
  group by x.client_id
), opening as (
  -- Owed on the opening date; treated as due from that day.
  select o.client_id, sum(o.debit_minor - o.credit_minor) as amount
  from public.opening_balances o
  where o.kind = 'client'
  group by o.client_id
)
select c.id as client_id,
       c.name,
       c.ref_code,
       c.is_active,
       coalesce(inv.invoiced, 0)::bigint as invoiced_minor,
       coalesce(rec.received, 0)::bigint as received_minor,
       (coalesce(opening.amount, 0) + coalesce(inv.invoiced, 0) - coalesce(rec.received, 0) + coalesce(rec.bounced_opening, 0))::bigint as balance_minor,
       greatest(coalesce(opening.amount, 0) + coalesce(inv.due, 0) + coalesce(rec.bounced_opening, 0) - coalesce(rec.received, 0), 0)::bigint as overdue_minor,
       coalesce(rec.cheques_pending, 0)::bigint as cheques_pending_minor,
       coalesce(unbilled.loads, 0)::integer as unbilled_loads,
       coalesce(unbilled.amount, 0)::bigint as unbilled_minor,
       inv.last_invoice,
       rec.last_receipt,
       coalesce(opening.amount, 0)::bigint as opening_minor
from public.clients c
left join inv on inv.client_id = c.id
left join rec on rec.client_id = c.id
left join unbilled on unbilled.client_id = c.id
left join opening on opening.client_id = c.id;

-- ---------------------------------------------------------------------------
-- 5. RLS, grants, audit
-- ---------------------------------------------------------------------------
select app.staff_policies('public.opening_balances', '{manager,accountant}', '{manager,accountant}');
select app.track('public.opening_balances');

revoke execute on function
  app.guard_opening_balance(), app.opening_source_id(), app.post_opening_entry(), app.post_opening(), app.guard_opening_doc()
  from public, anon, authenticated;
revoke execute on function public.set_opening_date(date) from public, anon;
grant execute on function public.set_opening_date(date) to authenticated;
