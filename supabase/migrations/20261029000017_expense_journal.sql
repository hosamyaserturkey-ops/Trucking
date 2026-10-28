-- Migration 17: expenses, diesel, driver advances and settlements as journal
-- entries, with the documents behind them.
--
-- Every approved expense and fill-up, every advance and every settlement is
-- posted automatically as a journal entry:
--   expense      Dr the category's expense account (on the truck)  Cr how it was paid
--   fill-up      Dr 5101 diesel (on the truck)                     Cr how it was paid
--   advance      Dr 1105 driver advances (the driver)              Cr cash or bank
--   settlement   the difference between the driver's advances and what he paid,
--                returned in cash (Dr cash, Cr 1105) or paid to him (Dr 1105, Cr cash)
-- "How it was paid": cash 1101, bank / card / cheque 1102, on credit 2101 (the
-- supplier), from the driver's advance 1105 (the driver).
--
-- Posted entries never change. When the row behind an entry changes in a way
-- that matters (amount, account, date, truck, party), its entry is reversed
-- on its own date and a new one is posted; when the row is deleted, rejected
-- or otherwise stops counting, its entry is only reversed. Document numbers
-- (payment voucher, customs declaration, bank notice) and notes live on the
-- row and show in the ledger without re-posting.
--
-- Journal lines also carry the supplier, driver or customer, so a statement
-- can be taken for one of them.

-- ---------------------------------------------------------------------------
-- 1. Document numbers and notes
-- ---------------------------------------------------------------------------
alter table public.expenses
  add column voucher_no text check (voucher_no = btrim(voucher_no) and char_length(voucher_no) between 1 and 30),
  add column customs_declaration_no text
    check (customs_declaration_no = btrim(customs_declaration_no) and char_length(customs_declaration_no) between 1 and 40),
  add column notice_no text check (notice_no = btrim(notice_no) and char_length(notice_no) between 1 and 40),
  add column notes text check (char_length(notes) <= 500);

alter table public.fuel_fillups
  add column voucher_no text check (voucher_no = btrim(voucher_no) and char_length(voucher_no) between 1 and 30),
  add column notice_no text check (notice_no = btrim(notice_no) and char_length(notice_no) between 1 and 40);

alter table public.driver_advances
  add column voucher_no text check (voucher_no = btrim(voucher_no) and char_length(voucher_no) between 1 and 30),
  add column notice_no text check (notice_no = btrim(notice_no) and char_length(notice_no) between 1 and 40);

comment on column public.expenses.voucher_no is 'Payment voucher number (سند صرف) from the paper voucher book; unique across expenses, fill-ups and advances.';
comment on column public.expenses.customs_declaration_no is 'Customs declaration number (رقم البيان الجمركي).';
comment on column public.expenses.notice_no is 'Bank notice number (رقم الإشعار).';

-- One voucher number is used once, whichever kind of payment it is on.
create table app.voucher_numbers (
  voucher_no text primary key,
  source_type text not null,
  source_id uuid not null,
  unique (source_type, source_id)
);

create function app.track_voucher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text := tg_argv[0];
begin
  if tg_op in ('UPDATE', 'DELETE') and old.voucher_no is not null
     and (tg_op = 'DELETE' or new.voucher_no is distinct from old.voucher_no) then
    delete from app.voucher_numbers where source_type = kind and source_id = old.id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.voucher_no is not null
     and (tg_op = 'INSERT' or new.voucher_no is distinct from old.voucher_no) then
    if exists (select 1 from app.voucher_numbers v where v.voucher_no = new.voucher_no) then
      raise exception 'رقم سند الصرف % مستخدم مسبقاً', new.voucher_no using errcode = 'check_violation';
    end if;
    insert into app.voucher_numbers (voucher_no, source_type, source_id) values (new.voucher_no, kind, new.id);
  end if;
  return null;
end;
$$;

create trigger expenses_voucher after insert or update or delete on public.expenses
  for each row execute function app.track_voucher('expense');
create trigger fuel_fillups_voucher after insert or update or delete on public.fuel_fillups
  for each row execute function app.track_voucher('fuel');
create trigger driver_advances_voucher after insert or update or delete on public.driver_advances
  for each row execute function app.track_voucher('advance');

-- ---------------------------------------------------------------------------
-- 2. Journal lines name their supplier, driver or customer
-- ---------------------------------------------------------------------------
alter table public.journal_lines
  add column supplier_id uuid references public.suppliers (id) on delete restrict,
  add column driver_id uuid references public.drivers (id) on delete restrict,
  add column client_id uuid references public.clients (id) on delete restrict;

create index journal_lines_supplier_idx on public.journal_lines (supplier_id) where supplier_id is not null;
create index journal_lines_driver_idx on public.journal_lines (driver_id) where driver_id is not null;
create index journal_lines_client_idx on public.journal_lines (client_id) where client_id is not null;

-- Same rules as before; a reversal must now also mirror the parties.
create or replace function app.guard_journal_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  dr bigint;
  cr bigint;
  n int;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'القيد يُنشأ كمسودة ثم يُرحّل' using errcode = 'check_violation';
    end if;
    new.posted_at := null;
    new.posted_by := null;
    new.reversed_by_entry_id := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'لا يمكن حذف قيد مرحّل؛ استخدم قيد عكسي' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'draft' then
    if new.status = 'reversed' then
      raise exception 'لا يمكن عكس قيد غير مرحّل' using errcode = 'check_violation';
    end if;
    if new.status = 'posted' then
      select coalesce(sum(l.debit_minor), 0), coalesce(sum(l.credit_minor), 0), count(*)
        into dr, cr, n
      from public.journal_lines l where l.entry_id = new.id;
      if n < 2 or dr <> cr or dr = 0 then
        raise exception 'القيد غير متوازن (مدين % / دائن %)', dr, cr using errcode = 'check_violation';
      end if;
      -- A reversal must mirror its original exactly.
      if new.reverses_entry_id is not null and (
        not exists (
          select 1 from public.journal_entries o
          where o.id = new.reverses_entry_id and o.status = 'posted'
        )
        or exists (
          (select l.account_id, l.truck_id, l.supplier_id, l.driver_id, l.client_id, l.debit_minor, l.credit_minor
             from public.journal_lines l where l.entry_id = new.id
           except all
           select o.account_id, o.truck_id, o.supplier_id, o.driver_id, o.client_id, o.credit_minor, o.debit_minor
             from public.journal_lines o where o.entry_id = new.reverses_entry_id)
          union all
          (select o.account_id, o.truck_id, o.supplier_id, o.driver_id, o.client_id, o.credit_minor, o.debit_minor
             from public.journal_lines o where o.entry_id = new.reverses_entry_id
           except all
           select l.account_id, l.truck_id, l.supplier_id, l.driver_id, l.client_id, l.debit_minor, l.credit_minor
             from public.journal_lines l where l.entry_id = new.id)
        )
      ) then
        raise exception 'القيد العكسي يجب أن يطابق القيد الأصلي' using errcode = 'check_violation';
      end if;
      new.posted_at := now();
      new.posted_by := auth.uid();
    end if;
    return new;
  end if;

  if old.status = 'posted'
     and new.status = 'reversed'
     and new.reversed_by_entry_id is not null
     and (to_jsonb(new) - 'status' - 'reversed_by_entry_id')
         = (to_jsonb(old) - 'status' - 'reversed_by_entry_id')
     and exists (
       select 1 from public.journal_entries r
       where r.id = new.reversed_by_entry_id
         and r.reverses_entry_id = old.id
         and r.status = 'posted'
     ) then
    return new;
  end if;

  raise exception 'القيد المرحّل لا يُعدّل؛ استخدم قيد عكسي' using errcode = 'check_violation';
end;
$$;

create or replace function public.reverse_journal_entry(
  p_entry_id uuid,
  p_reason text default null,
  p_date date default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  e public.journal_entries;
  new_id uuid;
begin
  select * into e from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'القيد غير موجود' using errcode = 'no_data_found';
  end if;
  if e.status <> 'posted' then
    raise exception 'يمكن عكس القيود المرحّلة فقط' using errcode = 'check_violation';
  end if;

  insert into public.journal_entries (entry_date, description, reverses_entry_id, source_type, source_id)
  values (
    coalesce(p_date, app.today()),
    'عكس القيد رقم ' || e.entry_no || coalesce(' — ' || nullif(p_reason, ''), ''),
    e.id,
    e.source_type,
    e.source_id
  )
  returning id into new_id;

  insert into public.journal_lines
    (entry_id, line_no, account_id, truck_id, supplier_id, driver_id, client_id, description, debit_minor, credit_minor)
  select new_id, l.line_no, l.account_id, l.truck_id, l.supplier_id, l.driver_id, l.client_id, l.description,
         l.credit_minor, l.debit_minor
  from public.journal_lines l where l.entry_id = e.id;

  update public.journal_entries set status = 'posted' where id = new_id;
  update public.journal_entries set status = 'reversed', reversed_by_entry_id = new_id where id = e.id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Posting
-- ---------------------------------------------------------------------------
create function app.account_by_code(p_code text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  id uuid;
begin
  select a.id into id from public.accounts a where a.code = p_code;
  if id is null then
    raise exception 'الحساب % غير موجود في دليل الحسابات', p_code using errcode = 'no_data_found';
  end if;
  return id;
end;
$$;

-- The account a payment comes out of.
create function app.payment_account(p_method text)
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
  end)
$$;

-- One journal line as jsonb, for app.sync_source_entry().
create function app.jline(
  p_account_id uuid, p_debit bigint, p_credit bigint,
  p_truck_id uuid default null, p_supplier_id uuid default null, p_driver_id uuid default null, p_client_id uuid default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('account_id', p_account_id, 'debit_minor', p_debit, 'credit_minor', p_credit,
                            'truck_id', p_truck_id, 'supplier_id', p_supplier_id, 'driver_id', p_driver_id,
                            'client_id', p_client_id)
$$;

-- Make a source row's posted entry match what it should be now: nothing to do
-- when it already does; otherwise reverse the current entry (on its own
-- date) and post the new one. p_lines null: the row no longer counts.
create function app.sync_source_entry(
  p_source_type text, p_source_id uuid, p_date date, p_description text, p_lines jsonb, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  live public.journal_entries;
  new_id uuid;
begin
  select e.* into live
  from public.journal_entries e
  where e.source_type = p_source_type and e.source_id = p_source_id
    and e.status = 'posted' and e.reverses_entry_id is null
  order by e.entry_no desc
  limit 1;

  if live.id is not null and p_lines is not null
     and live.entry_date = p_date and live.description = p_description
     and not exists (
       (select l.account_id, l.truck_id, l.supplier_id, l.driver_id, l.client_id, l.debit_minor, l.credit_minor
          from public.journal_lines l where l.entry_id = live.id
        except all
        select (j->>'account_id')::uuid, (j->>'truck_id')::uuid, (j->>'supplier_id')::uuid, (j->>'driver_id')::uuid,
               (j->>'client_id')::uuid, (j->>'debit_minor')::bigint, (j->>'credit_minor')::bigint
          from jsonb_array_elements(p_lines) j)
       union all
       (select (j->>'account_id')::uuid, (j->>'truck_id')::uuid, (j->>'supplier_id')::uuid, (j->>'driver_id')::uuid,
               (j->>'client_id')::uuid, (j->>'debit_minor')::bigint, (j->>'credit_minor')::bigint
          from jsonb_array_elements(p_lines) j
        except all
        select l.account_id, l.truck_id, l.supplier_id, l.driver_id, l.client_id, l.debit_minor, l.credit_minor
          from public.journal_lines l where l.entry_id = live.id)
     ) then
    return;
  end if;

  if live.id is not null then
    perform public.reverse_journal_entry(live.id, p_reason, live.entry_date);
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return;
  end if;

  insert into public.journal_entries (entry_date, description, source_type, source_id)
  values (p_date, p_description, p_source_type, p_source_id)
  returning id into new_id;

  insert into public.journal_lines
    (entry_id, line_no, account_id, truck_id, supplier_id, driver_id, client_id, debit_minor, credit_minor)
  select new_id, j.ord, (j.v->>'account_id')::uuid, (j.v->>'truck_id')::uuid, (j.v->>'supplier_id')::uuid,
         (j.v->>'driver_id')::uuid, (j.v->>'client_id')::uuid, (j.v->>'debit_minor')::bigint, (j.v->>'credit_minor')::bigint
  from jsonb_array_elements(p_lines) with ordinality as j (v, ord);

  update public.journal_entries set status = 'posted' where id = new_id;
end;
$$;

-- Expenses: only approved ones count.
create function app.post_expense_row(x public.expenses, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat record;
  amt bigint := x.amount_base_minor;
begin
  if x.status <> 'approved' then
    perform app.sync_source_entry('expense', x.id, null, null, null, p_reason);
    return;
  end if;
  select c.account_id, c.name_ar into cat from public.expense_categories c where c.id = x.category_id;
  perform app.sync_source_entry(
    'expense', x.id, x.expense_date,
    cat.name_ar || coalesce(' — ' || nullif(btrim(x.description), ''), ''),
    jsonb_build_array(
      app.jline(cat.account_id, amt, 0, p_truck_id => x.truck_id),
      app.jline(app.payment_account(x.payment_method), 0, amt,
                p_supplier_id => case when x.payment_method = 'credit' then x.supplier_id end,
                p_driver_id => case when x.payment_method = 'driver_advance' then x.driver_id end)),
    p_reason);
end;
$$;

create function app.post_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.sync_source_entry('expense', old.id, null, null, null, 'حذف المصروف');
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.status, new.amount_base_minor, new.category_id, new.payment_method, new.truck_id, new.supplier_id,
          new.driver_id, new.expense_date, new.description)
         is not distinct from
         (old.status, old.amount_base_minor, old.category_id, old.payment_method, old.truck_id, old.supplier_id,
          old.driver_id, old.expense_date, old.description) then
    return null;
  end if;
  perform app.post_expense_row(new, case when new.status = 'rejected' then 'رفض المصروف' else 'تعديل المصروف' end);
  return null;
end;
$$;

create trigger expenses_post after insert or update or delete on public.expenses
  for each row execute function app.post_expense();

-- Fill-ups: only approved ones count.
create function app.post_fuel_row(f public.fuel_fillups, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  amt bigint := f.amount_base_minor;
  station text;
begin
  if f.status <> 'approved' then
    perform app.sync_source_entry('fuel', f.id, null, null, null, p_reason);
    return;
  end if;
  select s.name into station from public.suppliers s where s.id = f.station_id;
  perform app.sync_source_entry(
    'fuel', f.id,
    (f.filled_at at time zone coalesce((select s.timezone from public.company_settings s), 'Asia/Amman'))::date,
    'ديزل ' || trim_scale(f.quantity)::text || ' '
      || case f.qty_unit when 'gallon' then 'قلن' when 'tank' then 'تنكة' else 'لتر' end
      || coalesce(' — ' || station, ''),
    jsonb_build_array(
      app.jline(app.account_by_code('5101'), amt, 0, p_truck_id => f.truck_id),
      app.jline(app.payment_account(f.payment_method), 0, amt,
                p_supplier_id => case when f.payment_method = 'credit' then f.station_id end,
                p_driver_id => case when f.payment_method = 'driver_advance' then f.driver_id end)),
    p_reason);
end;
$$;

create function app.post_fuel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.sync_source_entry('fuel', old.id, null, null, null, 'حذف التعبئة');
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.status, new.amount_base_minor, new.payment_method, new.truck_id, new.station_id, new.driver_id,
          new.filled_at, new.quantity, new.qty_unit)
         is not distinct from
         (old.status, old.amount_base_minor, old.payment_method, old.truck_id, old.station_id, old.driver_id,
          old.filled_at, old.quantity, old.qty_unit) then
    return null;
  end if;
  perform app.post_fuel_row(new, case when new.status = 'rejected' then 'رفض التعبئة' else 'تعديل التعبئة' end);
  return null;
end;
$$;

create trigger fuel_fillups_post after insert or update or delete on public.fuel_fillups
  for each row execute function app.post_fuel();

-- Advances to drivers.
create function app.post_advance_row(a public.driver_advances, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.sync_source_entry(
    'advance', a.id, a.issued_on,
    'عهدة للسائق ' || coalesce((select d.full_name from public.drivers d where d.id = a.driver_id), ''),
    jsonb_build_array(
      app.jline(app.account_by_code('1105'), a.amount_base_minor, 0, p_driver_id => a.driver_id),
      app.jline(app.payment_account(a.method), 0, a.amount_base_minor)),
    p_reason);
end;
$$;

create function app.post_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.sync_source_entry('advance', old.id, null, null, null, 'حذف العهدة');
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.amount_base_minor, new.method, new.driver_id, new.issued_on)
         is not distinct from (old.amount_base_minor, old.method, old.driver_id, old.issued_on) then
    return null;
  end if;
  perform app.post_advance_row(new, 'تعديل العهدة');
  return null;
end;
$$;

create trigger driver_advances_post after insert or update or delete on public.driver_advances
  for each row execute function app.post_advance();

-- Settlements (never changed once made): the difference, in cash.
create function app.post_settlement_row(s public.driver_settlements)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  diff bigint := s.difference_base_minor;
  cash uuid := app.account_by_code('1101');
  adv uuid := app.account_by_code('1105');
begin
  if diff = 0 then
    return;
  end if;
  perform app.sync_source_entry(
    'settlement', s.id, s.settled_on,
    'تسوية عهدة رقم ' || s.settlement_no || ' — '
      || coalesce((select d.full_name from public.drivers d where d.id = s.driver_id), '')
      || case when diff > 0 then ' (أعاد السائق الفرق)' else ' (دُفع الفرق للسائق)' end,
    case when diff > 0
      then jsonb_build_array(app.jline(cash, diff, 0), app.jline(adv, 0, diff, p_driver_id => s.driver_id))
      else jsonb_build_array(app.jline(adv, -diff, 0, p_driver_id => s.driver_id), app.jline(cash, 0, -diff))
    end,
    null);
end;
$$;

create function app.post_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.post_settlement_row(new);
  return null;
end;
$$;

create trigger driver_settlements_post after insert on public.driver_settlements
  for each row execute function app.post_settlement();

-- ---------------------------------------------------------------------------
-- 4. Post what already exists, in date order (audit skipped for the backfill)
-- ---------------------------------------------------------------------------
alter table public.journal_entries disable trigger journal_entries_audit;
alter table public.journal_lines disable trigger journal_lines_audit;

do $$
declare
  r record;
begin
  for r in
    select * from (
      select a.issued_on as d, 1 as k, a.id from public.driver_advances a
      union all
      select x.expense_date, 2, x.id from public.expenses x where x.status = 'approved'
      union all
      select (f.filled_at at time zone coalesce((select s.timezone from public.company_settings s), 'Asia/Amman'))::date,
             3, f.id
      from public.fuel_fillups f where f.status = 'approved'
      union all
      select s.settled_on, 4, s.id from public.driver_settlements s
    ) q
    order by d, k, id
  loop
    case r.k
      when 1 then perform app.post_advance_row((select a from public.driver_advances a where a.id = r.id), null);
      when 2 then perform app.post_expense_row((select x from public.expenses x where x.id = r.id), null);
      when 3 then perform app.post_fuel_row((select f from public.fuel_fillups f where f.id = r.id), null);
      else perform app.post_settlement_row((select s from public.driver_settlements s where s.id = r.id));
    end case;
  end loop;
end;
$$;

alter table public.journal_entries enable trigger journal_entries_audit;
alter table public.journal_lines enable trigger journal_lines_audit;

-- ---------------------------------------------------------------------------
-- 5. Ledger: lines with their documents, opening balances, trial balance
-- ---------------------------------------------------------------------------
create view public.ledger_lines_v
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
  coalesce(xe.notice_no, xf.notice_no, xa.notice_no) as notice_no,
  xe.reference_no,
  coalesce(xe.notes, xf.notes, xa.notes) as notes
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
where e.status <> 'draft';

-- Balance (debit minus credit) of the given accounts before a date, optionally
-- for one truck, supplier, driver or customer.
create function public.account_balance_before(
  p_account_ids uuid[],
  p_before date,
  p_truck_id uuid default null,
  p_supplier_id uuid default null,
  p_driver_id uuid default null,
  p_client_id uuid default null
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  where l.account_id = any (p_account_ids)
    and e.entry_date < p_before
    and e.status <> 'draft'
    and (p_truck_id is null or l.truck_id = p_truck_id)
    and (p_supplier_id is null or l.supplier_id = p_supplier_id)
    and (p_driver_id is null or l.driver_id = p_driver_id)
    and (p_client_id is null or l.client_id = p_client_id)
$$;

-- Trial balance for [p_from, p_to): opening, movements and closing per account.
create function public.trial_balance(p_from date, p_to date)
returns table (
  account_id uuid,
  code text,
  name_ar text,
  type public.account_type,
  opening_minor bigint,
  debit_minor bigint,
  credit_minor bigint,
  closing_minor bigint
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.code, a.name_ar, a.type,
         coalesce(sum(l.debit_minor - l.credit_minor) filter (where e.entry_date < p_from), 0)::bigint,
         coalesce(sum(l.debit_minor) filter (where e.entry_date >= p_from and e.entry_date < p_to), 0)::bigint,
         coalesce(sum(l.credit_minor) filter (where e.entry_date >= p_from and e.entry_date < p_to), 0)::bigint,
         coalesce(sum(l.debit_minor - l.credit_minor) filter (where e.entry_date < p_to), 0)::bigint
  from public.accounts a
  left join public.journal_lines l on l.account_id = a.id
  left join public.journal_entries e on e.id = l.entry_id and e.status <> 'draft'
  where a.is_postable
  group by a.id, a.code, a.name_ar, a.type
  order by a.code
$$;

-- The truck ledger view gains the parties (appended columns).
create or replace view public.journal_lines_v
with (security_invoker = on) as
select
  l.id,
  l.entry_id,
  e.entry_no,
  e.entry_date,
  e.description as entry_description,
  e.status,
  e.source_type,
  l.line_no,
  l.account_id,
  a.code as account_code,
  a.name_ar as account_name,
  a.type as account_type,
  l.truck_id,
  l.description,
  l.debit_minor,
  l.credit_minor,
  l.supplier_id,
  l.driver_id,
  l.client_id
from public.journal_lines l
join public.journal_entries e on e.id = l.entry_id
join public.accounts a on a.id = l.account_id;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
revoke all on app.voucher_numbers from public, anon, authenticated;
revoke execute on function
  app.track_voucher(), app.account_by_code(text), app.payment_account(text),
  app.jline(uuid, bigint, bigint, uuid, uuid, uuid, uuid),
  app.sync_source_entry(text, uuid, date, text, jsonb, text),
  app.post_expense_row(public.expenses, text), app.post_expense(),
  app.post_fuel_row(public.fuel_fillups, text), app.post_fuel(),
  app.post_advance_row(public.driver_advances, text), app.post_advance(),
  app.post_settlement_row(public.driver_settlements), app.post_settlement()
  from public, anon, authenticated;
revoke execute on function
  public.account_balance_before(uuid[], date, uuid, uuid, uuid, uuid), public.trial_balance(date, date)
  from public, anon;
grant execute on function
  public.account_balance_before(uuid[], date, uuid, uuid, uuid, uuid), public.trial_balance(date, date)
  to authenticated;
