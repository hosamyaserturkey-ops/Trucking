-- Expenses, diesel, advances and settlements as journal entries (migration 17).
-- Rolled back at the end; needs all seeds.

begin;

create function pg_temp.check(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end;
$$;

create function pg_temp.as_user_raises(uid uuid, stmt text) returns boolean
language plpgsql as $$
declare
  failed boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute stmt;
  exception when others then
    failed := true;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return failed;
end;
$$;

create function pg_temp.as_user_count(uid uuid, stmt text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute stmt into n;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return n;
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text), pg_temp.as_user_count(uuid, text) to authenticated;

-- The first user becomes the manager.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'je-manager@example.test'),
  ('00000000-0000-4000-8000-0000000000f2', 'je-accountant@example.test'),
  ('00000000-0000-4000-8000-0000000000f3', 'je-dispatcher@example.test');
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-0000000000f2';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-0000000000f3';

-- The live (posted, not reversed, not a reversal) entries of a source row.
create function pg_temp.live(p_type text, p_id uuid) returns setof public.journal_entries
language sql as $$
  select * from public.journal_entries e
  where e.source_type = p_type and e.source_id = p_id and e.status = 'posted' and e.reverses_entry_id is null
$$;

-- Net effect of all entries of a source row on an account: debit minus credit.
create function pg_temp.net(p_type text, p_id uuid, p_code text) returns bigint
language sql as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  join public.accounts a on a.id = l.account_id
  where e.source_type = p_type and e.source_id = p_id and a.code = p_code
$$;

-- Seeds are posted ---------------------------------------------------------------
select pg_temp.check(
  not exists (select 1 from public.expenses x
              where (select count(*) from pg_temp.live('expense', x.id)) <> (case when x.status = 'approved' then 1 else 0 end)),
  'every approved expense has one entry, the others none');
select pg_temp.check(
  not exists (select 1 from public.fuel_fillups f
              where (select count(*) from pg_temp.live('fuel', f.id)) <> (case when f.status = 'approved' then 1 else 0 end)),
  'every approved fill-up has one entry, the others none');
select pg_temp.check(
  not exists (select 1 from public.driver_advances a where (select count(*) from pg_temp.live('advance', a.id)) <> 1),
  'every advance has one entry');
select pg_temp.check(
  (select sum(l.debit_minor - l.credit_minor) from public.journal_lines l
   join public.journal_entries e on e.id = l.entry_id join public.accounts a on a.id = l.account_id
   where e.source_type = 'expense' and a.type = 'expense')
  = (select sum(amount_base_minor) from public.expenses where status = 'approved'),
  'expense accounts carry exactly the approved expenses');
select pg_temp.check(
  (select sum(debit_minor) = sum(credit_minor) from public.journal_lines),
  'the whole journal balances');
select pg_temp.check(
  (select sum(closing_minor) from public.trial_balance('2000-01-01', '2100-01-01')) = 0,
  'the trial balance closes at zero');
-- Each driver's advance account = open advances - open approved items he paid.
select pg_temp.check(
  not exists (
    select 1 from public.drivers d
    where coalesce((select sum(l.debit_minor - l.credit_minor) from public.journal_lines l
                    join public.accounts a on a.id = l.account_id
                    where a.code = '1105' and l.driver_id = d.id), 0)
          <> coalesce((select sum(amount_base_minor) from public.driver_advances where driver_id = d.id and settlement_id is null), 0)
           - coalesce((select sum(amount_base_minor) from public.expenses
                       where driver_id = d.id and payment_method = 'driver_advance' and status = 'approved' and settlement_id is null), 0)
           - coalesce((select sum(amount_base_minor) from public.fuel_fillups
                       where driver_id = d.id and payment_method = 'driver_advance' and status = 'approved' and settlement_id is null), 0)),
  'each driver''s advance account equals his open advances minus what he paid (settled ones net to zero)');

-- An office expense --------------------------------------------------------------
create temp table k as
select (select c.id from public.expense_categories c join public.accounts a on a.id = c.account_id
        where c.is_active and a.code = '5104' limit 1) as category_id,
       (select t.id from public.trucks t where t.code = 'T-04') as truck_id,
       (select s.id from public.suppliers s where s.kind = 'workshop' limit 1) as supplier_id,
       (select d.id from public.drivers d join public.trucks t on t.id = d.default_truck_id where t.code = 'T-04') as driver_id;

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2', format(
  $q$insert into public.expenses (expense_date, category_id, truck_id, description, amount_minor, payment_method, status,
                                  voucher_no, customs_declaration_no, notice_no, notes)
     values (current_date - 3, %L, %L, 'je cash repair', 45000, 'cash', 'approved', 'V-9001', 'CD-77/2026', 'N-5', 'je note')$q$,
  (select category_id from k), (select truck_id from k))), 'accountant records a cash expense with its documents');

create temp table e1 as select id from public.expenses where description = 'je cash repair';

select pg_temp.check(
  (select count(*) = 1 and bool_and(entry_date = current_date - 3) from pg_temp.live('expense', (select id from e1))),
  'the expense is posted on its date');
select pg_temp.check(
  pg_temp.net('expense', (select id from e1), '5104') = 45000 and pg_temp.net('expense', (select id from e1), '1101') = -45000,
  'Dr tolls 45.000, Cr cash 45.000');
select pg_temp.check(
  (select l.truck_id = (select truck_id from k) from public.journal_lines l join pg_temp.live('expense', (select id from e1)) e
   on e.id = l.entry_id where l.debit_minor > 0),
  'the expense line is on the truck');
select pg_temp.check(
  (select voucher_no = 'V-9001' and customs_declaration_no = 'CD-77/2026' and notice_no = 'N-5' and notes = 'je note'
   from public.ledger_lines_v where source_id = (select id from e1) and account_code = '1101'),
  'the ledger shows the voucher, customs declaration, notice and notes');

-- Documents alone don't re-post.
update public.expenses set notes = 'je note 2', notice_no = 'N-6' where id = (select id from e1);
select pg_temp.check(
  (select count(*) from public.journal_entries where source_type = 'expense' and source_id = (select id from e1)) = 1,
  'changing notes or document numbers does not touch the entry');

-- A change that matters: the old entry is reversed, a new one posted.
update public.expenses set amount_minor = 50000 where id = (select id from e1);
select pg_temp.check(
  (select count(*) from public.journal_entries where source_type = 'expense' and source_id = (select id from e1)) = 3
  and (select count(*) from pg_temp.live('expense', (select id from e1))) = 1,
  'a new amount reverses the entry and posts a new one');
select pg_temp.check(
  pg_temp.net('expense', (select id from e1), '5104') = 50000 and pg_temp.net('expense', (select id from e1), '1101') = -50000,
  'the net effect is the new amount');
select pg_temp.check(
  (select bool_and(r.entry_date = current_date - 3) from public.journal_entries r
   where r.source_type = 'expense' and r.source_id = (select id from e1) and r.reverses_entry_id is not null),
  'the reversal is dated like the entry it reverses');

-- On credit: the supplier is credited.
update public.expenses set payment_method = 'credit', supplier_id = (select supplier_id from k) where id = (select id from e1);
select pg_temp.check(
  (select l.supplier_id = (select supplier_id from k) and a.code = '2101'
   from public.journal_lines l join public.accounts a on a.id = l.account_id
   join pg_temp.live('expense', (select id from e1)) e on e.id = l.entry_id where l.credit_minor > 0),
  'an expense on credit credits the supplier''s account');
select pg_temp.check(
  public.account_balance_before(array[(select id from public.accounts where code = '2101')], current_date + 1,
                                p_supplier_id => (select supplier_id from k)) <= -50000,
  'the supplier''s statement shows what we owe');

-- Deleting reverses it.
delete from public.expenses where id = (select id from e1);
select pg_temp.check(
  (select count(*) from pg_temp.live('expense', (select id from e1))) = 0
  and pg_temp.net('expense', (select id from e1), '5104') = 0 and pg_temp.net('expense', (select id from e1), '2101') = 0,
  'a deleted expense is reversed to zero');

-- Voucher numbers are unique across expenses, fill-ups and advances ---------------
insert into public.expenses (expense_date, category_id, truck_id, description, amount_minor, payment_method, status, voucher_no)
select current_date, category_id, truck_id, 'je voucher', 1000, 'cash', 'approved', 'V-9002' from k;
do $$
begin
  begin
    insert into public.driver_advances (driver_id, issued_on, amount_minor, method, voucher_no)
    select driver_id, current_date, 1000, 'cash', 'V-9002' from k;
    raise exception 'FAIL: a voucher number was used twice';
  exception when check_violation then
    raise notice 'PASS: a voucher number is used once, across expenses and advances';
  end;
end;
$$;
select pg_temp.check((select count(*) from public.expenses where voucher_no = 'V-9001') = 0, 'a deleted expense frees its voucher number');
insert into public.driver_advances (driver_id, issued_on, amount_minor, method, voucher_no)
select driver_id, current_date, 1000, 'cash', 'V-9001' from k;
select pg_temp.check(true, 'a freed voucher number can be used again');

-- Driver expenses: nothing until approved ------------------------------------------
insert into public.expenses (expense_date, category_id, truck_id, driver_id, description, amount_minor, payment_method, status)
select current_date, category_id, truck_id, driver_id, 'je driver meal', 7000, 'driver_advance', 'submitted' from k;
create temp table e2 as select id from public.expenses where description = 'je driver meal';
select pg_temp.check((select count(*) from pg_temp.live('expense', (select id from e2))) = 0, 'a waiting driver expense is not posted');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  format($q$update public.expenses set status = 'approved' where id = %L$q$, (select id from e2))), 'the accountant approves it');
select pg_temp.check(
  (select l.driver_id = (select driver_id from k) and a.code = '1105'
   from public.journal_lines l join public.accounts a on a.id = l.account_id
   join pg_temp.live('expense', (select id from e2)) e on e.id = l.entry_id where l.credit_minor > 0),
  'once approved, it credits the driver''s advance account');

-- Fill-ups: a gallon fill-up on the station's account --------------------------------
insert into public.fuel_fillups (truck_id, filled_at, odometer, qty_unit, quantity, unit_price_minor, payment_method,
                                 station_id, voucher_no, notes)
select f.truck_id, greatest(max(f.filled_at), now() - interval '1 hour') + interval '1 minute', max(f.odometer) + 100,
       'gallon', 30, 3000, 'credit', (select s.id from public.suppliers s where s.kind = 'fuel_station' limit 1), 'V-9003',
       'je gallon'
from public.fuel_fillups f where f.truck_id = (select truck_id from k) group by f.truck_id;
create temp table f1 as select id from public.fuel_fillups where notes = 'je gallon';
select pg_temp.check(
  pg_temp.net('fuel', (select id from f1), '5101') = 90000 and pg_temp.net('fuel', (select id from f1), '2101') = -90000,
  'a gallon fill-up on credit: Dr diesel 90.000, Cr the station');
select pg_temp.check(
  (select entry_description like 'ديزل 30 قلن — %' from public.ledger_lines_v where source_id = (select id from f1) limit 1),
  'its description names the quantity, the unit and the station');

-- Advances and settlement --------------------------------------------------------------
select pg_temp.check(
  pg_temp.net('advance', (select id from public.driver_advances where voucher_no = 'V-9001'), '1105') = 1000,
  'an advance debits the driver''s advance account');
select public.settle_driver_advance((select driver_id from k), current_date, 'je settle');
select pg_temp.check(
  (select sum(l.debit_minor - l.credit_minor) from public.journal_lines l join public.accounts a on a.id = l.account_id
   where a.code = '1105' and l.driver_id = (select driver_id from k)) = 0,
  'after settling, the driver''s advance account is zero');
select pg_temp.check(
  (select count(*) = 1 from public.journal_entries e join public.driver_settlements s on s.id = e.source_id
   where e.source_type = 'settlement' and s.notes = 'je settle'),
  'the settlement difference is posted');

-- Reversals mirror the parties ------------------------------------------------------------
select pg_temp.check(
  not exists (
    select 1 from public.journal_entries r
    join public.journal_entries o on o.id = r.reverses_entry_id
    where exists (
      select l.account_id, l.supplier_id, l.driver_id, l.debit_minor from public.journal_lines l where l.entry_id = o.id
      except
      select l.account_id, l.supplier_id, l.driver_id, l.credit_minor from public.journal_lines l where l.entry_id = r.id)),
  'every reversal mirrors its original, parties included');

-- Who can see the ledger -------------------------------------------------------------------
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-0000000000f3', 'select count(*) from public.ledger_lines_v') = 0,
  'a dispatcher sees no ledger lines');
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-0000000000f2', 'select count(*) from public.ledger_lines_v') > 0,
  'the accountant sees the ledger');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2', $q$select app.sync_source_entry('expense', gen_random_uuid(), current_date, 'x', '[]'::jsonb, null)$q$),
  'the posting function cannot be called through the API');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2', $q$select count(*) from app.voucher_numbers$q$),
  'the voucher register is not readable through the API');

rollback;
