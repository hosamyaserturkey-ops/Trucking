-- Migration 28: several bank accounts, and the bank's other movements.
--
-- 1. Bank accounts are 1102 (the main one) and its sub-accounts 1102NN, each
--    with its own statement, reconciliation and balance. The statement of 1102
--    covers them all.
-- 2. Every document paid into or out of a bank (expense, diesel by card,
--    advance, receipt and its cheque, supplier payment and its cheque, work
--    order) says which bank; empty means the main account 1102, as before.
-- 3. Other movements on a bank account (cash deposited or withdrawn, a
--    transfer between banks, the owner's money, charges, interest, anything
--    else) are entered on their own and posted.

-- ---------------------------------------------------------------------------
-- 1. Bank accounts
-- ---------------------------------------------------------------------------
alter table public.accounts add column bank_account_no text
  check (bank_account_no = btrim(bank_account_no) and char_length(bank_account_no) between 1 and 60);

comment on column public.accounts.bank_account_no is 'For a bank account (1102 and its sub-accounts): the account number or IBAN.';

-- The bank a document uses: the one it names, or the main account 1102.
create function app.bank_account(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_id is not null and app.is_bank_account(p_id) then p_id else app.account_by_code('1102') end
$$;

-- The account a payment method posts to, with the bank the document names.
create function app.payment_account(p_method text, p_bank uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when p_method in ('bank', 'card', 'check') then app.bank_account(p_bank) else app.payment_account(p_method) end
$$;

-- A new bank account under 1102, numbered 1102NN (manager and accountant).
create function public.create_bank_account(p_name text, p_account_no text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent uuid := app.account_by_code('1102');
  n integer;
  new_id uuid;
begin
  perform app.require_finance('الحسابات البنكية للمدير والمحاسب فقط');
  if nullif(btrim(coalesce(p_name, '')), '') is null or char_length(btrim(p_name)) > 100 then
    raise exception 'اكتب اسم الحساب البنكي' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('bank_account_code'));
  select coalesce(max(substr(a.code, 5)::integer), 0) + 1 into n
  from public.accounts a
  where a.code ~ '^1102[0-9]{2}$';
  if n > 99 then
    raise exception 'لا يمكن إضافة أكثر من 99 حساباً بنكياً' using errcode = 'check_violation';
  end if;
  insert into public.accounts (code, name_ar, type, parent_id, is_postable, bank_account_no)
  values ('1102' || lpad(n::text, 2, '0'), btrim(p_name), 'asset', parent, true, nullif(btrim(coalesce(p_account_no, '')), ''))
  returning id into new_id;
  return new_id;
end;
$$;

-- Rename a bank account or change its number (manager and accountant).
create function public.update_bank_account(p_account_id uuid, p_name text, p_account_no text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_finance('الحسابات البنكية للمدير والمحاسب فقط');
  if not app.is_bank_account(p_account_id) then
    raise exception 'هذا ليس حساباً بنكياً' using errcode = 'check_violation';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or char_length(btrim(p_name)) > 100 then
    raise exception 'اكتب اسم الحساب البنكي' using errcode = 'check_violation';
  end if;
  update public.accounts
  set name_ar = btrim(p_name), bank_account_no = nullif(btrim(coalesce(p_account_no, '')), ''), updated_at = now()
  where id = p_account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Which bank each document uses
-- ---------------------------------------------------------------------------
alter table public.expenses add column bank_account_id uuid references public.accounts (id) on delete restrict;
alter table public.fuel_fillups add column bank_account_id uuid references public.accounts (id) on delete restrict;
alter table public.driver_advances add column bank_account_id uuid references public.accounts (id) on delete restrict;
alter table public.client_receipts add column bank_account_id uuid references public.accounts (id) on delete restrict;
alter table public.supplier_payments add column bank_account_id uuid references public.accounts (id) on delete restrict;
alter table public.work_orders add column bank_account_id uuid references public.accounts (id) on delete restrict;

comment on column public.client_receipts.bank_account_id is 'The bank a transfer came into, or a cheque is deposited in. Empty: 1102.';
comment on column public.supplier_payments.bank_account_id is 'The bank a transfer went out of, or a cheque is drawn on. Empty: 1102.';

create index expenses_bank_idx on public.expenses (bank_account_id) where bank_account_id is not null;
create index fuel_fillups_bank_idx on public.fuel_fillups (bank_account_id) where bank_account_id is not null;
create index driver_advances_bank_idx on public.driver_advances (bank_account_id) where bank_account_id is not null;
create index client_receipts_bank_idx on public.client_receipts (bank_account_id) where bank_account_id is not null;
create index supplier_payments_bank_idx on public.supplier_payments (bank_account_id) where bank_account_id is not null;
create index work_orders_bank_idx on public.work_orders (bank_account_id) where bank_account_id is not null;

create function app.check_bank_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.bank_account_id is not null and not app.is_bank_account(new.bank_account_id) then
    raise exception 'اختر حساباً بنكياً' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger expenses_bank_account before insert or update of bank_account_id on public.expenses
  for each row execute function app.check_bank_account();
create trigger fuel_fillups_bank_account before insert or update of bank_account_id on public.fuel_fillups
  for each row execute function app.check_bank_account();
create trigger driver_advances_bank_account before insert or update of bank_account_id on public.driver_advances
  for each row execute function app.check_bank_account();
create trigger client_receipts_bank_account before insert or update of bank_account_id on public.client_receipts
  for each row execute function app.check_bank_account();
create trigger supplier_payments_bank_account before insert or update of bank_account_id on public.supplier_payments
  for each row execute function app.check_bank_account();
create trigger work_orders_bank_account before insert or update of bank_account_id on public.work_orders
  for each row execute function app.check_bank_account();

-- The posting rules, as before, with the document's bank.

create or replace function app.post_expense_row(x public.expenses, p_reason text)
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
      app.jline(app.payment_account(x.payment_method, x.bank_account_id), 0, amt,
                p_supplier_id => case when x.payment_method = 'credit' then x.supplier_id end,
                p_driver_id => case when x.payment_method = 'driver_advance' then x.driver_id end)),
    p_reason);
end;
$$;

create or replace function app.post_expense()
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
          new.driver_id, new.expense_date, new.description, new.bank_account_id)
         is not distinct from
         (old.status, old.amount_base_minor, old.category_id, old.payment_method, old.truck_id, old.supplier_id,
          old.driver_id, old.expense_date, old.description, old.bank_account_id) then
    return null;
  end if;
  perform app.post_expense_row(new, case when new.status = 'rejected' then 'رفض المصروف' else 'تعديل المصروف' end);
  return null;
end;
$$;

create or replace function app.post_fuel_row(f public.fuel_fillups, p_reason text)
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
      app.jline(app.payment_account(f.payment_method, f.bank_account_id), 0, amt,
                p_supplier_id => case when f.payment_method = 'credit' then f.station_id end,
                p_driver_id => case when f.payment_method = 'driver_advance' then f.driver_id end)),
    p_reason);
end;
$$;

create or replace function app.post_fuel()
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
          new.filled_at, new.quantity, new.qty_unit, new.bank_account_id)
         is not distinct from
         (old.status, old.amount_base_minor, old.payment_method, old.truck_id, old.station_id, old.driver_id,
          old.filled_at, old.quantity, old.qty_unit, old.bank_account_id) then
    return null;
  end if;
  perform app.post_fuel_row(new, case when new.status = 'rejected' then 'رفض التعبئة' else 'تعديل التعبئة' end);
  return null;
end;
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
      app.jline(app.payment_account(a.method, a.bank_account_id), 0, a.amount_base_minor)),
    p_reason);
end;
$$;

create or replace function app.post_advance()
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
     and (new.amount_base_minor, new.method, new.driver_id, new.issued_on, new.bank_account_id)
         is not distinct from (old.amount_base_minor, old.method, old.driver_id, old.issued_on, old.bank_account_id) then
    return null;
  end if;
  perform app.post_advance_row(new, 'تعديل العهدة');
  return null;
end;
$$;

create or replace function app.post_receipt_row(r public.client_receipts, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  client text := coalesce((select c.name from public.clients c where c.id = r.client_id), '');
  debit_account uuid := case r.method
    when 'cash' then app.account_by_code('1101')
    when 'bank' then app.bank_account(r.bank_account_id)
    when 'cheque' then app.account_by_code('1104')
    else app.account_by_code('4103') end;
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
        app.jline(debit_account, r.amount_minor, 0),
        app.jline(app.account_by_code('1103'), 0, r.amount_minor, p_client_id => r.client_id))
    end,
    p_reason);

  -- A cheque leaves "under collection" when it clears into its bank or bounces back onto the customer.
  perform app.sync_source_entry(
    'cheque', r.id, r.cheque_status_on,
    case r.cheque_status when 'cleared' then 'تحصيل شيك رقم ' else 'شيك مرتجع رقم ' end || coalesce(r.cheque_no, '') || ' — ' || client,
    case
      when r.method = 'cheque' and r.cheque_status = 'cleared' then
        jsonb_build_array(app.jline(app.bank_account(r.bank_account_id), r.amount_minor, 0), app.jline(cheques, 0, r.amount_minor))
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
     and (new.client_id, new.received_on, new.method, new.amount_minor, new.cheque_no, new.cheque_status, new.cheque_status_on,
          new.is_opening, new.bank_account_id)
         is not distinct from
         (old.client_id, old.received_on, old.method, old.amount_minor, old.cheque_no, old.cheque_status, old.cheque_status_on,
          old.is_opening, old.bank_account_id) then
    return null;
  end if;
  perform app.post_receipt_row(new, case when tg_op = 'UPDATE' then 'تعديل سند القبض' end);
  return null;
end;
$$;

create or replace function app.post_supplier_payment_row(p public.supplier_payments, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier text := coalesce((select s.name from public.suppliers s where s.id = p.supplier_id), '');
  credit_account uuid := case p.method
    when 'cash' then app.account_by_code('1101')
    when 'bank' then app.bank_account(p.bank_account_id)
    when 'cheque' then app.account_by_code('2102')
    else app.account_by_code('4104') end;
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
      app.jline(credit_account, 0, p.amount_minor,
                p_supplier_id => case when p.method = 'cheque' then p.supplier_id end)),
    p_reason);

  -- A cheque leaves "post-dated cheques" when its bank pays it, or goes back
  -- onto the supplier's account when it bounces.
  perform app.sync_source_entry(
    'issued_cheque', p.id, p.cheque_status_on,
    case p.cheque_status when 'cleared' then 'صرف شيك صادر رقم ' else 'شيك صادر مرتجع رقم ' end
      || coalesce(p.cheque_no, '') || ' — ' || supplier,
    case
      when p.method = 'cheque' and p.cheque_status = 'cleared' then
        jsonb_build_array(app.jline(issued, p.amount_minor, 0, p_supplier_id => p.supplier_id),
                          app.jline(app.bank_account(p.bank_account_id), 0, p.amount_minor))
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
     and (new.supplier_id, new.paid_on, new.method, new.amount_minor, new.cheque_no, new.cheque_status, new.cheque_status_on,
          new.is_opening, new.bank_account_id)
         is not distinct from
         (old.supplier_id, old.paid_on, old.method, old.amount_minor, old.cheque_no, old.cheque_status, old.cheque_status_on,
          old.is_opening, old.bank_account_id) then
    return null;
  end if;
  perform app.post_supplier_payment_row(new, case when tg_op = 'UPDATE' then 'تعديل دفعة المورد' end);
  return null;
end;
$$;

create or replace function app.post_work_order_row(w public.work_orders, p_reason text)
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
    app.jline(case w.payment_method
                when 'cash' then app.account_by_code('1101')
                when 'bank' then app.bank_account(w.bank_account_id)
                else app.account_by_code('2101') end,
              0, w.total_base_minor,
              p_supplier_id => case when w.payment_method = 'credit' then w.workshop_id end));

  perform app.sync_source_entry(
    'work_order', w.id, w.closed_on,
    'أمر صيانة رقم ' || w.wo_no || ' — ' || w.description || coalesce(' — ' || workshop, ''),
    lines, p_reason);
end;
$$;

create or replace function app.post_work_order()
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
     and (new.status, new.total_base_minor, new.payment_method, new.truck_id, new.workshop_id, new.closed_on, new.description,
          new.bank_account_id)
         is not distinct from
         (old.status, old.total_base_minor, old.payment_method, old.truck_id, old.workshop_id, old.closed_on, old.description,
          old.bank_account_id) then
    return null;
  end if;
  perform app.post_work_order_row(new, case
    when new.status = 'open' and tg_op = 'UPDATE' and old.status = 'closed' then 'إعادة فتح أمر الصيانة'
    when new.status = 'cancelled' then 'إلغاء أمر الصيانة'
    else 'تعديل أمر الصيانة' end);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Other movements on a bank account
-- ---------------------------------------------------------------------------
create table public.bank_movements (
  id uuid primary key default gen_random_uuid(),
  movement_no bigint generated always as identity unique,
  moved_on date not null,
  bank_account_id uuid not null references public.accounts (id) on delete restrict,
  -- in: money into the bank; out: money out of it.
  direction text not null check (direction in ('in', 'out')),
  kind text not null check (kind in ('cash', 'transfer', 'owner', 'charges', 'interest', 'other')),
  counter_account_id uuid not null references public.accounts (id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  truck_id uuid references public.trucks (id) on delete restrict,
  reference_no text check (reference_no = btrim(reference_no) and char_length(reference_no) between 1 and 60),
  description text check (char_length(description) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (counter_account_id <> bank_account_id)
);

comment on table public.bank_movements is
  'A bank account''s movements that no other document makes: cash in or out, transfers between banks, the owner''s money, charges, interest. In JOD fils.';

create index bank_movements_bank_idx on public.bank_movements (bank_account_id, moved_on);
create index bank_movements_counter_idx on public.bank_movements (counter_account_id);
create index bank_movements_truck_idx on public.bank_movements (truck_id) where truck_id is not null;

create function app.guard_bank_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acc record;
begin
  if not app.is_bank_account(new.bank_account_id) then
    raise exception 'اختر الحساب البنكي' using errcode = 'check_violation';
  end if;
  if new.moved_on > app.today() then
    raise exception 'لا يمكن تسجيل حركة بتاريخ لاحق' using errcode = 'check_violation';
  end if;
  select a.code, a.is_postable, a.type into acc from public.accounts a where a.id = new.counter_account_id;
  if acc.code is null or not acc.is_postable then
    raise exception 'اختر حساباً فرعياً يقبل القيود' using errcode = 'check_violation';
  end if;
  -- Customers, suppliers, advances and cheques move through their own screens.
  if acc.code in ('1103', '1104', '1105', '2101', '2102') then
    raise exception 'حركات الزبائن والموردين والعهد والشيكات تُسجّل من أقسامها' using errcode = 'check_violation';
  end if;
  if new.kind = 'transfer' and not app.is_bank_account(new.counter_account_id) then
    raise exception 'التحويل يكون إلى حساب بنكي آخر أو منه' using errcode = 'check_violation';
  end if;
  if new.kind <> 'transfer' and app.is_bank_account(new.counter_account_id) then
    raise exception 'الحركة بين حسابين بنكيين تُسجّل كتحويل' using errcode = 'check_violation';
  end if;
  if new.truck_id is not null and acc.type not in ('expense', 'revenue') then
    new.truck_id := null;
  end if;
  new.reference_no := nullif(btrim(coalesce(new.reference_no, '')), '');
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  return new;
end;
$$;

create trigger bank_movements_guard before insert or update on public.bank_movements
  for each row execute function app.guard_bank_movement();

create function app.post_bank_movement_row(m public.bank_movements, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bank text := (select a.name_ar from public.accounts a where a.id = m.bank_account_id);
  counter text := (select a.name_ar from public.accounts a where a.id = m.counter_account_id);
  what text := case m.kind
    when 'cash' then case m.direction when 'in' then 'إيداع نقدي من ' else 'سحب نقدي إلى ' end || counter
    when 'transfer' then case m.direction when 'in' then 'تحويل من ' else 'تحويل إلى ' end || counter
    when 'owner' then case m.direction when 'in' then 'إيداع من المالك' else 'سحب للمالك' end
    when 'charges' then 'عمولات ومصاريف بنكية'
    when 'interest' then 'فوائد بنكية'
    else case m.direction when 'in' then 'إيداع — ' else 'سحب — ' end || counter
  end;
begin
  perform app.sync_source_entry(
    'bank_movement', m.id, m.moved_on,
    left('حركة بنكية رقم ' || m.movement_no || ' — ' || bank || ' — ' || what
         || coalesce(' — ' || m.description, '') || coalesce(' (إشعار ' || m.reference_no || ')', ''), 300),
    case m.direction
      when 'in' then jsonb_build_array(
        app.jline(m.bank_account_id, m.amount_minor, 0),
        app.jline(m.counter_account_id, 0, m.amount_minor, p_truck_id => m.truck_id))
      else jsonb_build_array(
        app.jline(m.counter_account_id, m.amount_minor, 0, p_truck_id => m.truck_id),
        app.jline(m.bank_account_id, 0, m.amount_minor))
    end,
    p_reason);
end;
$$;

create function app.post_bank_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.sync_source_entry('bank_movement', old.id, null, null, null, 'حذف الحركة البنكية');
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.moved_on, new.bank_account_id, new.direction, new.kind, new.counter_account_id, new.amount_minor, new.truck_id,
          new.reference_no, new.description)
         is not distinct from
         (old.moved_on, old.bank_account_id, old.direction, old.kind, old.counter_account_id, old.amount_minor, old.truck_id,
          old.reference_no, old.description) then
    return null;
  end if;
  perform app.post_bank_movement_row(new, case when tg_op = 'UPDATE' then 'تعديل الحركة البنكية' end);
  return null;
end;
$$;

create trigger bank_movements_post after insert or update or delete on public.bank_movements
  for each row execute function app.post_bank_movement();

select app.staff_policies('public.bank_movements', '{manager,accountant}', '{manager,accountant}');
select app.track('public.bank_movements');

-- ---------------------------------------------------------------------------
-- 4. Each bank account: its balance in the books and the cheques still on the way
-- ---------------------------------------------------------------------------
create view public.bank_accounts_v
with (security_invoker = on) as
select
  a.id as account_id,
  a.code,
  a.name_ar,
  a.bank_account_no,
  a.is_active,
  coalesce(b.balance, 0)::bigint as balance_minor,
  b.last_movement_on,
  coalesce(ci.total, 0)::bigint as cheques_in_minor,
  coalesce(ci.n, 0)::integer as cheques_in_count,
  coalesce(co.total, 0)::bigint as cheques_out_minor,
  coalesce(co.n, 0)::integer as cheques_out_count,
  (coalesce(b.balance, 0) + coalesce(ci.total, 0) - coalesce(co.total, 0))::bigint as expected_minor
from public.accounts a
left join lateral (
  select sum(l.debit_minor - l.credit_minor) as balance, max(e.entry_date) as last_movement_on
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  -- Reversed entries count with their reversals (they cancel out); drafts don't count.
  where l.account_id = a.id and e.status <> 'draft'
) b on true
-- Customers' cheques in hand or deposited, to be collected into this bank.
left join lateral (
  select sum(r.amount_minor) as total, count(*) as n
  from public.client_receipts r
  where r.method = 'cheque' and r.cheque_status in ('in_hand', 'deposited')
    and app.bank_account(r.bank_account_id) = a.id
) ci on true
-- Our cheques the bank has not paid yet.
left join lateral (
  select sum(p.amount_minor) as total, count(*) as n
  from public.supplier_payments p
  where p.method = 'cheque' and p.cheque_status = 'issued'
    and app.bank_account(p.bank_account_id) = a.id
) co on true
where a.is_postable and a.type = 'asset' and a.code like '1102%';

comment on view public.bank_accounts_v is
  'Bank accounts with their book balance, cheques to collect into them and cheques to be paid from them, and the balance once those clear.';

revoke execute on function
  app.bank_account(uuid), app.payment_account(text, uuid), app.check_bank_account(), app.guard_bank_movement(),
  app.post_bank_movement_row(public.bank_movements, text), app.post_bank_movement()
  from public, anon;
grant execute on function app.bank_account(uuid) to authenticated;
revoke execute on function public.create_bank_account(text, text), public.update_bank_account(uuid, text, text) from public, anon;
grant execute on function public.create_bank_account(text, text), public.update_bank_account(uuid, text, text) to authenticated;
