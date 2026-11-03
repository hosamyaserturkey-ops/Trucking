-- Driver pay per load (migration 27): priced by hand by the office, charged to
-- the driver's account, follows its load, settled with the advance.
-- Rolled back at the end; needs the seeds.

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

grant execute on function pg_temp.as_user_raises(uuid, text) to authenticated;

-- Net effect of all entries of an expense on an account (debit minus credit), optionally for one driver.
create function pg_temp.net(p_id uuid, p_code text, p_driver uuid default null) returns bigint
language sql as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  join public.accounts a on a.id = l.account_id
  where e.source_type = 'expense' and e.source_id = p_id and a.code = p_code
    and (p_driver is null or l.driver_id = p_driver)
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000101', 'lp-manager@example.test'),
  ('00000000-0000-4000-8000-000000000102', 'lp-accountant@example.test'),
  ('00000000-0000-4000-8000-000000000103', 'lp-dispatcher@example.test'),
  ('00000000-0000-4000-8000-000000000104', 'lp-driver@example.test');
update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-000000000101';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-000000000102';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000103';

-- Two drivers with no open settlement items of the test's own, a truck, a customer, a route.
create temp table lx as
select
  (select id from public.drivers order by full_name limit 1) as driver_a,
  (select id from public.drivers order by full_name offset 1 limit 1) as driver_b,
  (select id from public.trucks where code = 'T-04') as truck_id,
  (select id from public.clients order by name limit 1) as client_id,
  (select id from public.locations order by name limit 1) as from_id,
  (select id from public.locations order by name offset 1 limit 1) as to_id;
grant select on lx to authenticated;

update public.profiles set role = 'driver', driver_id = (select driver_a from lx)
where user_id = '00000000-0000-4000-8000-000000000104';

insert into public.trips (entry_source, status, truck_id, driver_id, client_id, from_location_id, to_location_id,
                          start_date, currency, freight_minor, notes)
select 'sheet', 'completed', truck_id, driver_a, client_id, from_id, to_id, current_date - 2, 'JOD', 250000, 'load pay test'
from lx;
create temp table load1 as select id, client_ref from public.trips where notes = 'load pay test';
grant select on load1 to authenticated;

create temp table before_bal as
select balance_base_minor as bal, unpriced_loads from public.driver_advance_balance_v where driver_id = (select driver_a from lx);

-- Who may price -------------------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000103',
  format('select public.set_load_driver_pay(%L, 40000)', (select id from load1))), 'a dispatcher cannot price a load');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000104',
  format('select public.set_load_driver_pay(%L, 40000)', (select id from load1))), 'a driver cannot price a load');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000104',
  format($q$insert into public.expenses (is_load_pay, trip_id, amount_minor, expense_date, category_id, description, truck_id, driver_id, payment_method, status)
            select true, %L, 99000, current_date, (select id from public.expense_categories where code = 'meals'), 'x', %L, %L, 'driver_advance', 'submitted'$q$,
         (select id from load1), (select truck_id from lx), (select driver_a from lx))), 'a driver cannot add a pay row for himself');

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000102',
  format('select public.set_load_driver_pay(%L, 40000, %L)', (select id from load1), ' اتفاق خاص ')), 'the accountant prices a load');

create temp table pay1 as select * from public.expenses where trip_id = (select id from load1) and is_load_pay;

select pg_temp.check((select count(*) from pay1) = 1, 'one pay row for the load');
select pg_temp.check(
  (select p.driver_id = lx.driver_a and p.truck_id = lx.truck_id and p.expense_date = current_date - 2
          and p.payment_method = 'driver_advance' and p.status = 'approved' and p.amount_base_minor = 40000
          and p.description = 'أجرة نقلة ' || l.client_ref and p.notes = 'اتفاق خاص'
          and p.category_id = (select id from public.expense_categories where code = 'driver_pay')
   from pay1 p, lx, load1 l),
  'the pay takes its driver, truck, date and description from the load');
select pg_temp.check(
  pg_temp.net((select id from pay1), '5106') = 40000
  and pg_temp.net((select id from pay1), '1105', (select driver_a from lx)) = -40000,
  'posted: Dr 5106 driver pay, Cr 1105 the driver');
select pg_temp.check(
  (select balance_base_minor from public.driver_advance_balance_v where driver_id = (select driver_a from lx))
    = (select bal from before_bal) - 40000,
  'the driver''s balance moves by the pay at once');
select pg_temp.check(
  (select unpriced_loads from public.driver_advance_balance_v where driver_id = (select driver_a from lx))
    = (select unpriced_loads from before_bal) - 1,
  'the load is no longer waiting to be priced');
select pg_temp.check(
  (select expenses_base_minor from public.trip_profit_v where trip_id = (select id from load1)) = 40000,
  'the pay counts as a cost of the load');
select pg_temp.check(
  (select pay_minor from public.driver_loads_v where trip_id = (select id from load1)) = 40000,
  'the pricing list shows the pay');

-- One pay per load
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000102',
  format($q$insert into public.expenses (is_load_pay, trip_id, amount_minor, expense_date, category_id, description, truck_id)
            select true, %L, 1000, current_date, (select id from public.expense_categories where code = 'driver_pay'), 'x', %L$q$,
         (select id from load1), (select truck_id from lx))), 'a second pay for the same load is refused');

-- Re-pricing re-posts
select public.set_load_driver_pay((select id from load1), 45000);
select pg_temp.check(
  (select amount_minor from public.expenses where id = (select id from pay1)) = 45000
  and pg_temp.net((select id from pay1), '1105', (select driver_a from lx)) = -45000,
  'changing the price re-posts the new amount');

-- An office edit of the row can only change the amount and notes
update public.expenses set payment_method = 'cash', category_id = (select id from public.expense_categories where code = 'meals')
where id = (select id from pay1);
select pg_temp.check(
  (select payment_method = 'driver_advance' and category_id = (select id from public.expense_categories where code = 'driver_pay')
   from public.expenses where id = (select id from pay1)),
  'the pay keeps its kind and account whatever an edit sends');

-- The pay follows its load
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000103',
  format('update public.trips set driver_id = %L, start_date = current_date - 1 where id = %L', (select driver_b from lx), (select id from load1))),
  'a dispatcher can still change the load''s driver and date');
select pg_temp.check(
  (select driver_id = (select driver_b from lx) and expense_date = current_date - 1 from public.expenses where id = (select id from pay1)),
  'the pay moves to the new driver and date');
select pg_temp.check(
  pg_temp.net((select id from pay1), '1105', (select driver_a from lx)) = 0
  and pg_temp.net((select id from pay1), '1105', (select driver_b from lx)) = -45000,
  'the first driver''s account is cleared and the new one credited');
update public.trips set driver_id = (select driver_a from lx) where id = (select id from load1);

-- Clearing the price
select public.set_load_driver_pay((select id from load1), 0);
select pg_temp.check(
  not exists (select 1 from public.expenses where id = (select id from pay1))
  and pg_temp.net((select id from pay1), '5106') = 0 and pg_temp.net((select id from pay1), '1105') = 0,
  'a price of 0 removes the pay and reverses its entry');

-- Settled pay is locked --------------------------------------------------------------
select public.set_load_driver_pay((select id from load1), 30000);
select public.settle_driver_advance((select driver_a from lx), current_date, 'load pay test');
select pg_temp.check(
  (select settlement_id is not null from public.expenses where trip_id = (select id from load1) and is_load_pay),
  'the settlement takes the pay with the advances and expenses');
select pg_temp.check(
  (select balance_base_minor from public.driver_advance_balance_v where driver_id = (select driver_a from lx)) = 0,
  'nothing is left open after the settlement');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000102',
  format('select public.set_load_driver_pay(%L, 31000)', (select id from load1))), 'a settled pay cannot be re-priced');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000101',
  format('update public.trips set driver_id = %L where id = %L', (select driver_b from lx), (select id from load1))),
  'a load with settled pay keeps its driver');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000101',
  format('delete from public.trips where id = %L', (select id from load1))), 'a load with settled pay cannot be deleted');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000101',
  format('update public.trips set cargo_description = %L where id = %L', 'إسمنت', (select id from load1))),
  'other details of the load can still change');

-- Deleting a priced load deletes its pay ----------------------------------------------
insert into public.trips (entry_source, status, truck_id, driver_id, client_id, from_location_id, to_location_id,
                          start_date, currency, freight_minor, notes)
select 'sheet', 'completed', truck_id, driver_a, client_id, from_id, to_id, current_date, 'JOD', 100000, 'load pay test 2'
from lx;
create temp table load2 as select id from public.trips where notes = 'load pay test 2';
grant select on load2 to authenticated;
select public.set_load_driver_pay((select id from load2), 20000);
create temp table pay2 as select id from public.expenses where trip_id = (select id from load2) and is_load_pay;
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000103',
  format('delete from public.trips where id = %L', (select id from load2))), 'a dispatcher deletes a priced sheet line');
select pg_temp.check(
  not exists (select 1 from public.expenses where id = (select id from pay2))
  and pg_temp.net((select id from pay2), '1105') = 0,
  'its pay goes with it and the driver''s account is cleared');

-- Only finished loads with a driver
insert into public.trips (status, truck_id, client_id, from_location_id, to_location_id, start_date, freight_minor, notes)
select 'planned', truck_id, client_id, from_id, to_id, current_date, 1000, 'load pay test 3' from lx;
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000102',
  format('select public.set_load_driver_pay(%L, 1000)', (select id from public.trips where notes = 'load pay test 3'))),
  'a load that is not finished cannot be priced');

-- The books still balance
select pg_temp.check(
  (select sum(debit_minor) = sum(credit_minor) from public.journal_lines),
  'the journal balances');

rollback;
