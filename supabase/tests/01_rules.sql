-- Accuracy rules, posting rules and RLS. Runs inside a transaction that is
-- rolled back, so it is safe against a live database. Needs the demo seed.
-- Prints NOTICE 'PASS: ...' per check and raises on the first failure.

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

create function pg_temp.raises(stmt text, label text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS: % [%]', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', label;
end;
$$;

-- Test users -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'test-manager@example.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'test-accountant@example.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'test-dispatcher@example.test'),
  ('00000000-0000-4000-8000-0000000000a4', 'test-driver@example.test'),
  ('00000000-0000-4000-8000-0000000000a5', 'test-pending@example.test');

update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-0000000000a1';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-0000000000a2';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-0000000000a3';
update public.profiles
set role = 'driver',
    driver_id = (
      select d.id from public.drivers d
      where d.id not in (select p.driver_id from public.profiles p where p.driver_id is not null)
        and exists (select 1 from public.trips x where x.driver_id = d.id)
      order by d.full_name limit 1
    )
where user_id = '00000000-0000-4000-8000-0000000000a4';

-- Accuracy rules --------------------------------------------------------------
do $$
declare
  cat uuid := (select id from public.expense_categories where code = 'tolls');
  truck_a uuid := (select id from public.trucks where code = 'T-01');
  truck_b uuid := (select id from public.trucks where code = 'T-02');
  trip_b uuid := (select id from public.trips where truck_id = (select id from public.trucks where code = 'T-02') limit 1);
  e uuid;
  base bigint;
begin
  perform pg_temp.raises(format(
    $q$insert into public.expenses (expense_date, category_id, cost_scope, description, amount_minor)
       values (current_date, %L, 'truck', 'x', 1000)$q$, cat),
    'truck expense without a truck is rejected');
  perform pg_temp.raises(format(
    $q$insert into public.expenses (expense_date, category_id, cost_scope, truck_id, description, amount_minor)
       values (current_date, %L, 'overhead', %L, 'x', 1000)$q$, cat, truck_a),
    'overhead expense with a truck is rejected');
  perform pg_temp.raises(format(
    $q$insert into public.expenses (expense_date, category_id, truck_id, trip_id, description, amount_minor)
       values (current_date, %L, %L, %L, 'x', 1000)$q$, cat, truck_a, trip_b),
    'expense linked to another truck''s trip is rejected');
  perform pg_temp.raises(format(
    $q$insert into public.expenses (expense_date, category_id, truck_id, description, currency, amount_minor, fx_rate)
       values (current_date, %L, %L, 'x', 'JOD', 1000, 1.2)$q$, cat, truck_a),
    'base currency with fx_rate <> 1 is rejected');

  insert into public.expenses (expense_date, category_id, truck_id, description, currency, amount_minor, fx_rate)
  values (current_date, cat, truck_b, 'USD test', 'USD', 10000, 0.709)
  returning amount_base_minor into base;
  perform pg_temp.check(base = 70900, 'USD 100.00 at 0.709 = 70.900 JOD (70900 fils)');
end;
$$;

-- Journal posting rules -------------------------------------------------------
do $$
declare
  cash uuid := (select id from public.accounts where code = '1101');
  fuel uuid := (select id from public.accounts where code = '5101');
  header uuid := (select id from public.accounts where code = '51');
  truck_a uuid := (select id from public.trucks where code = 'T-01');
  e uuid;
  rev uuid;
  st public.journal_status;
begin
  perform pg_temp.raises(
    $q$insert into public.journal_entries (entry_date, description, status) values (current_date, 'x', 'posted')$q$,
    'entries cannot be created as posted');

  insert into public.journal_entries (entry_date, description) values (current_date, 'test entry') returning id into e;
  insert into public.journal_lines (entry_id, line_no, account_id, truck_id, debit_minor) values (e, 1, fuel, truck_a, 50000);
  insert into public.journal_lines (entry_id, line_no, account_id, credit_minor) values (e, 2, cash, 40000);
  perform pg_temp.raises(format('select public.post_journal_entry(%L)', e), 'unbalanced entry cannot be posted');
  perform pg_temp.raises(format(
    $q$insert into public.journal_lines (entry_id, account_id, debit_minor) values (%L, %L, 1)$q$, e, header),
    'header account cannot take postings');

  update public.journal_lines set credit_minor = 50000 where entry_id = e and line_no = 2;
  perform public.post_journal_entry(e);
  select status into st from public.journal_entries where id = e;
  perform pg_temp.check(st = 'posted', 'balanced entry posts');

  perform pg_temp.raises(format($q$update public.journal_entries set description = 'changed' where id = %L$q$, e),
    'posted entry cannot be edited');
  perform pg_temp.raises(format($q$update public.journal_lines set debit_minor = 1 where entry_id = %L and line_no = 1$q$, e),
    'posted entry lines cannot be edited');
  perform pg_temp.raises(format($q$delete from public.journal_entries where id = %L$q$, e),
    'posted entry cannot be deleted');
  perform pg_temp.raises(format(
    $q$insert into public.journal_lines (entry_id, account_id, debit_minor) values (%L, %L, 1)$q$, e, cash),
    'lines cannot be added to a posted entry');
  perform pg_temp.raises(format($q$update public.journal_entries set status = 'reversed' where id = %L$q$, e),
    'posted -> reversed requires a real reversal entry');

  rev := public.reverse_journal_entry(e, 'test');
  select status into st from public.journal_entries where id = e;
  perform pg_temp.check(st = 'reversed', 'original is marked reversed');
  perform pg_temp.check(
    (select sum(debit_minor) - sum(credit_minor) from public.journal_lines
     where entry_id in (e, rev) and account_id = fuel) = 0,
    'original + reversal net to zero per account');
  perform pg_temp.raises(format('select public.reverse_journal_entry(%L)', e), 'an entry can be reversed only once');
end;
$$;

-- Derived numbers -------------------------------------------------------------
do $$
declare
  t uuid;
  kmpl numeric;
begin
  perform pg_temp.check(not exists (
    select 1 from public.work_orders w
    where w.total_minor <> coalesce((select sum(l.line_total_minor) from public.work_order_lines l where l.work_order_id = w.id), 0)
  ), 'work order totals equal the sum of their lines');

  perform pg_temp.check(not exists (
    select 1 from public.expenses e
    left join (
      select source_id, sum(amount_base_minor) as s from public.truck_pnl_facts_v
      where kind = 'overhead' group by source_id
    ) a on a.source_id = e.id
    where e.cost_scope = 'overhead' and coalesce(a.s, 0) <> e.amount_base_minor
  ), 'overhead allocations add up exactly to each overhead expense');

  update public.company_settings set overhead_allocation = 'by_km';
  perform pg_temp.check(not exists (
    select 1 from public.expenses e
    left join (
      select source_id, sum(amount_base_minor) as s from public.truck_pnl_facts_v
      where kind = 'overhead' group by source_id
    ) a on a.source_id = e.id
    where e.cost_scope = 'overhead' and coalesce(a.s, 0) <> e.amount_base_minor
  ), 'by_km overhead allocations also add up exactly');
  update public.company_settings set overhead_allocation = 'equal';

  perform pg_temp.check(not exists (
    select 1 from public.truck_financing f
    where f.principal_base_minor <> (select sum(i.principal_base_minor) from public.financing_installments i where i.financing_id = f.id)
  ), 'installment principal sums to the financed amount');

  perform pg_temp.check(
    (select sum(amount_base_minor) from public.truck_pnl_summary(current_date - 200, current_date + 1))
      = (select sum(amount_base_minor) from public.truck_pnl_facts_v
         where fact_date >= current_date - 200 and fact_date < current_date + 1),
    'P&L summary function matches the facts it aggregates');
  perform pg_temp.check(
    (select sum(amount_base_minor) from public.truck_pnl_monthly(
       (select id from public.trucks where code = 'T-01'), current_date - 200, current_date + 1))
      = (select sum(amount_base_minor) from public.truck_pnl_facts_v
         where truck_id = (select id from public.trucks where code = 'T-01')
           and fact_date >= current_date - 200 and fact_date < current_date + 1),
    'monthly P&L function matches the facts for one truck');

  -- km/L, full-tank method: 500 km on 50 + 100 liters = 3.33
  insert into public.trucks (code, plate_number) values ('TEST-1', 'TEST-0001') returning id into t;
  insert into public.fuel_fillups (truck_id, filled_at, odometer, liters, is_full_tank, amount_minor) values
    (t, now() - interval '3 days', 1000, 80, true, 1),
    (t, now() - interval '2 days', 1200, 50, false, 1),
    (t, now() - interval '1 day', 1500, 100, true, 1);
  select km_per_liter into kmpl from public.fuel_efficiency_v where truck_id = t and odometer = 1500;
  perform pg_temp.check(kmpl = 3.33, 'km/L uses all liters since the previous full tank');

  perform pg_temp.check(
    exists (select 1 from audit.log where table_name = 'trucks' and record_id = t::text and action = 'INSERT'),
    'inserting a truck writes an audit row');
end;
$$;

-- Row level security ----------------------------------------------------------
do $$
declare
  drv uuid := (select driver_id from public.profiles where user_id = '00000000-0000-4000-8000-0000000000a4');
  own_trips bigint := (select count(*) from public.trips where driver_id = drv);
  all_trips bigint := (select count(*) from public.trips);
  all_trucks bigint := (select count(*) from public.trucks);
  own_truck uuid := (select default_truck_id from public.drivers where id = drv);
  other_truck uuid := (select id from public.trucks where id <> own_truck
                         and id not in (select truck_id from public.trips where driver_id = drv) limit 1);
  n bigint;
  n2 bigint;
  n3 bigint;
  n4 bigint;
  n5 bigint;
  n6 bigint;
  role_after public.app_role;
  ok_insert boolean;
  blocked_insert boolean;
  blocked_overhead boolean;
begin
  -- driver
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.trips;
  select count(*) into n2 from public.truck_assets;
  select count(*) into n3 from public.journal_entries;
  select count(*) into n4 from public.trucks;
  select count(*) into n5 from public.accounts;
  select count(*) into n6 from public.profiles;
  update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-0000000000a4';
  -- Phase 3: drivers send fill-ups paid from the advance, with a receipt from their own folder.
  begin
    insert into public.fuel_fillups (truck_id, driver_id, filled_at, odometer, liters, amount_minor, payment_method, receipt_path)
    values (own_truck, drv, now(), 9999999, 10, 6400, 'driver_advance',
            '00000000-0000-4000-8000-0000000000a4/2026-10/44444444-4444-4444-8444-444444444444.jpg');
    ok_insert := true;
  exception when others then ok_insert := false;
  end;
  begin
    insert into public.fuel_fillups (truck_id, driver_id, filled_at, odometer, liters, amount_minor, payment_method, receipt_path)
    values (other_truck, drv, now(), 9999999, 10, 6400, 'driver_advance',
            '00000000-0000-4000-8000-0000000000a4/2026-10/55555555-5555-4555-8555-555555555555.jpg');
    blocked_insert := false;
  exception when insufficient_privilege then blocked_insert := true;
  end;
  begin
    insert into public.expenses (expense_date, category_id, cost_scope, driver_id, description, amount_minor)
    values (current_date, (select id from public.expense_categories where code = 'admin'), 'overhead', drv, 'x', 1000);
    blocked_overhead := false;
  exception when others then blocked_overhead := true;
  end;
  perform set_config('role', 'none', true);

  select role into role_after from public.profiles where user_id = '00000000-0000-4000-8000-0000000000a4';
  perform pg_temp.check(own_trips > 0 and n = own_trips, format('driver sees only own trips (%s of %s)', n, all_trips));
  perform pg_temp.check(n2 = 0, 'driver cannot see truck purchase values');
  perform pg_temp.check(n3 = 0, 'driver cannot see the journal');
  perform pg_temp.check(n4 between 1 and 3, format('driver sees only own trucks (%s)', n4));
  perform pg_temp.check(n5 = 0, 'driver cannot see the chart of accounts');
  perform pg_temp.check(n6 = 1, 'driver sees only own profile');
  perform pg_temp.check(role_after = 'driver', 'driver cannot promote themselves');
  perform pg_temp.check(ok_insert, 'driver can record a fill-up for own truck');
  perform pg_temp.check(blocked_insert, 'driver cannot record a fill-up for another truck');
  perform pg_temp.check(blocked_overhead, 'driver cannot record overhead expenses');

  -- pending
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.trips;
  select count(*) into n2 from public.trucks;
  select count(*) into n3 from public.clients;
  perform set_config('role', 'none', true);
  perform pg_temp.check(n = 0 and n2 = 0 and n3 = 0, 'pending user sees nothing');

  -- dispatcher
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.trips;
  select count(*) into n2 from public.journal_entries;
  select count(*) into n3 from public.truck_assets;
  select count(*) into n4 from public.truck_financing;
  select count(*) into n5 from public.trucks;
  perform set_config('role', 'none', true);
  perform pg_temp.check(n = all_trips, 'dispatcher sees all trips');
  perform pg_temp.check(n2 = 0 and n3 = 0 and n4 = 0, 'dispatcher cannot see journal, asset values or financing');
  perform pg_temp.check(n5 = all_trucks, 'dispatcher sees all trucks');

  -- accountant
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.journal_entries;
  select count(*) into n2 from audit.log;
  begin
    insert into public.trips (truck_id, start_date) values (own_truck, current_date);
    blocked_insert := false;
  exception when insufficient_privilege then blocked_insert := true;
  end;
  perform set_config('role', 'none', true);
  perform pg_temp.check(n > 0, 'accountant sees the journal');
  perform pg_temp.check(n2 = 0, 'accountant cannot read the audit log');
  perform pg_temp.check(blocked_insert, 'accountant cannot create trips');

  -- manager
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from audit.log;
  select count(*) into n2 from public.profiles;
  perform set_config('role', 'none', true);
  perform pg_temp.check(n > 0, 'manager reads the audit log');
  perform pg_temp.check(n2 >= 5, 'manager sees all profiles');

  -- anonymous
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  select count(*) into n from public.trips;
  select count(*) into n2 from public.trucks;
  perform set_config('role', 'none', true);
  perform pg_temp.check(n = 0 and n2 = 0, 'anonymous sees nothing');
end;
$$;

-- The company always keeps a manager -----------------------------------------
do $$
begin
  update public.profiles set role = 'accountant'
  where role = 'manager' and user_id <> '00000000-0000-4000-8000-0000000000a1';
  perform pg_temp.raises(
    $q$update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-0000000000a1'$q$,
    'the last manager cannot be demoted');
end;
$$;

rollback;
