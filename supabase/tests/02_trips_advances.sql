-- Phase 2 rules: driver expense submission and approval, advances and
-- settlements, trip start/finish. Rolled back at the end; needs both seeds.

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

-- Runs a statement as a given user and reports whether it raised.
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
  return failed;
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'p2-manager@example.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'p2-accountant@example.test'),
  ('00000000-0000-4000-8000-0000000000b3', 'p2-dispatcher@example.test'),
  ('00000000-0000-4000-8000-0000000000b4', 'p2-driver@example.test');
update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-0000000000b1';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-0000000000b2';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-0000000000b3';
update public.profiles
set role = 'driver',
    driver_id = (
      select d.id from public.drivers d join public.trucks t on t.id = d.default_truck_id
      where t.code = 'T-02' and d.id not in (select p.driver_id from public.profiles p where p.driver_id is not null)
    )
where user_id = '00000000-0000-4000-8000-0000000000b4';

create temp table ctx as
select
  p.driver_id,
  d.default_truck_id as truck_id,
  (select id from public.trucks where code = 'T-05') as other_truck,
  (select id from public.expense_categories where code = 'meals') as meals,
  (select x.id from public.trips x where x.driver_id = p.driver_id and x.status = 'completed'
   order by x.start_date desc limit 1) as trip_id
from public.profiles p
join public.drivers d on d.id = p.driver_id
where p.user_id = '00000000-0000-4000-8000-0000000000b4';
grant select on ctx to authenticated;

-- Driver expense submission ---------------------------------------------------
do $$
declare
  c record;
  driver uuid := '00000000-0000-4000-8000-0000000000b4';
  e_id uuid;
  st text;
  by_user uuid;
begin
  select * into c from ctx;

  perform pg_temp.check(not pg_temp.as_user_raises(driver, format(
    $q$insert into public.expenses (expense_date, category_id, truck_id, trip_id, driver_id, description, amount_minor, payment_method, status)
       values (current_date, %L, %L, %L, %L, 'p2 test meal', 12000, 'driver_advance', 'submitted')$q$,
    c.meals, c.truck_id, c.trip_id, c.driver_id)), 'driver submits an expense for own truck');
  select id, status, submitted_by into e_id, st, by_user from public.expenses where description = 'p2 test meal';
  perform pg_temp.check(st = 'submitted' and by_user = driver, 'submitted expense records who submitted it');

  perform pg_temp.check(pg_temp.as_user_raises(driver, format(
    $q$insert into public.expenses (expense_date, category_id, truck_id, driver_id, description, amount_minor, payment_method, status)
       values (current_date, %L, %L, %L, 'x', 1000, 'driver_advance', 'approved')$q$,
    c.meals, c.truck_id, c.driver_id)), 'driver cannot insert an already approved expense');
  perform pg_temp.check(pg_temp.as_user_raises(driver, format(
    $q$insert into public.expenses (expense_date, category_id, truck_id, driver_id, description, amount_minor, payment_method, status)
       values (current_date, %L, %L, %L, 'x', 1000, 'driver_advance', 'submitted')$q$,
    c.meals, c.other_truck, c.driver_id)), 'driver cannot submit for another truck');

  perform pg_temp.as_user_raises(driver, format($q$update public.expenses set amount_minor = 15000 where id = %L$q$, e_id));
  perform pg_temp.check((select amount_minor from public.expenses where id = e_id) = 15000,
    'driver can correct a submitted expense');
  perform pg_temp.check(pg_temp.as_user_raises(driver, format(
    $q$update public.expenses set status = 'approved' where id = %L$q$, e_id)), 'driver cannot approve');

  perform pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000b3',
    format($q$update public.expenses set status = 'approved' where id = %L$q$, e_id));
  perform pg_temp.check((select status from public.expenses where id = e_id) = 'submitted', 'dispatcher cannot approve');

  perform pg_temp.check(not exists (select 1 from public.truck_pnl_facts_v where source_id = e_id),
    'submitted expense does not count in the P&L');

  perform pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000b2',
    format($q$update public.expenses set status = 'rejected' where id = %L$q$, e_id)), 'rejection needs a reason');
  perform pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000b2',
    format($q$update public.expenses set status = 'approved' where id = %L$q$, e_id)), 'accountant approves');
  perform pg_temp.check(
    (select reviewed_by from public.expenses where id = e_id) = '00000000-0000-4000-8000-0000000000b2',
    'approval records the reviewer');
  perform pg_temp.check(exists (select 1 from public.truck_pnl_facts_v where source_id = e_id and kind = 'expense'),
    'approved expense counts in the P&L');
  perform pg_temp.check(pg_temp.as_user_raises(driver, format(
    $q$update public.expenses set amount_minor = 1 where id = %L and status = 'submitted' returning 1/0$q$, e_id))
    or (select amount_minor from public.expenses where id = e_id) = 15000,
    'driver cannot change an approved expense');
end;
$$;

-- Advances and settlements -----------------------------------------------------
do $$
declare
  c record;
  acct uuid := '00000000-0000-4000-8000-0000000000b2';
  expected bigint;
  s record;
  s2 record;
  open_after integer;
  sid uuid;
begin
  select * into c from ctx;

  perform pg_temp.check(not pg_temp.as_user_raises(acct, format(
    $q$insert into public.driver_advances (driver_id, issued_on, amount_minor, method) values (%L, current_date, 100000, 'cash')$q$,
    c.driver_id)), 'accountant issues an advance');
  perform pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000b3', format(
    $q$insert into public.driver_advances (driver_id, issued_on, amount_minor) values (%L, current_date, 1000)$q$,
    c.driver_id)), 'dispatcher cannot issue advances');
  perform pg_temp.check(pg_temp.as_user_raises(acct, format(
    $q$insert into public.driver_advances (driver_id, trip_id, issued_on, amount_minor)
       values (%L, (select id from public.trips where driver_id <> %L limit 1), current_date, 1000)$q$,
    c.driver_id, c.driver_id)), 'an advance cannot point at another driver''s trip');

  select balance_base_minor into expected from public.driver_advance_balance_v where driver_id = c.driver_id;

  perform pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000b4',
    format($q$select public.settle_driver_advance(%L)$q$, c.driver_id)), 'driver cannot settle');
  perform pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000b3',
    format($q$select public.settle_driver_advance(%L)$q$, c.driver_id)), 'dispatcher cannot settle');
  perform pg_temp.check(not pg_temp.as_user_raises(acct,
    format($q$select public.settle_driver_advance(%L, current_date, 'p2 test')$q$, c.driver_id)), 'accountant settles');

  select * into s from public.driver_settlements where driver_id = c.driver_id and notes = 'p2 test';
  perform pg_temp.check(s.difference_base_minor = expected,
    format('settlement difference equals the open balance (%s)', expected));
  select count(*) into open_after from public.driver_advances where driver_id = c.driver_id and settlement_id is null;
  perform pg_temp.check(open_after = 0
    and (select balance_base_minor from public.driver_advance_balance_v where driver_id = c.driver_id) = 0,
    'settled items are closed and the balance is zero');

  perform pg_temp.check(pg_temp.as_user_raises(acct, format(
    $q$update public.expenses set amount_minor = amount_minor + 1 where settlement_id = %L$q$, s.id)),
    'settled expenses cannot be changed');
  perform pg_temp.check(pg_temp.as_user_raises(acct, format(
    $q$update public.driver_advances set amount_minor = amount_minor + 1 where settlement_id = %L$q$, s.id)),
    'settled advances cannot be changed');
  perform pg_temp.check(pg_temp.as_user_raises(acct, format(
    $q$update public.driver_settlements set notes = 'x' where id = %L$q$, s.id)), 'settlements are immutable');
  perform pg_temp.check(pg_temp.as_user_raises(acct,
    format($q$select public.settle_driver_advance(%L)$q$, c.driver_id)), 'nothing left to settle is refused');
  insert into public.expenses (expense_date, category_id, truck_id, driver_id, description, amount_minor, payment_method)
  values (current_date, c.meals, c.truck_id, c.driver_id, 'p2 unsettled', 3000, 'driver_advance');
  perform pg_temp.check(pg_temp.as_user_raises(acct, format(
    $q$update public.expenses set settlement_id = %L where description = 'p2 unsettled'$q$, s.id)),
    'settlement links can only be set by the settle function');

  perform pg_temp.as_user_raises(acct, format(
    $q$insert into public.driver_advances (driver_id, issued_on, amount_minor) values (%L, current_date, 25000)$q$, c.driver_id));
  perform pg_temp.as_user_raises(acct, format($q$select public.settle_driver_advance(%L, current_date, 'p2 second')$q$, c.driver_id));
  select * into s2 from public.driver_settlements where driver_id = c.driver_id and notes = 'p2 second';
  perform pg_temp.check(s2.advances_count = 1 and s2.expenses_count = 1 and s2.difference_base_minor = 22000,
    'a second settlement picks up only the new items (25.000 advance - 3.000 expense)');
end;
$$;

-- Trips ------------------------------------------------------------------------
do $$
declare
  c record;
  driver uuid := '00000000-0000-4000-8000-0000000000b4';
  running uuid;
  planned uuid;
  others uuid;
  last_odo integer;
begin
  select * into c from ctx;
  select id into running from public.trips where truck_id = c.truck_id and status = 'in_progress';
  last_odo := app.truck_last_odometer(c.truck_id);

  -- Give the driver a running trip if the seed did not.
  if running is null then
    insert into public.trips (truck_id, driver_id, start_date, status, start_odometer)
    values (c.truck_id, c.driver_id, current_date, 'in_progress', last_odo + 10)
    returning id into running;
    last_odo := last_odo + 10;
  end if;

  perform pg_temp.check(
    (select count(*) from public.trips where truck_id = c.truck_id and status = 'in_progress') = 1,
    'test truck has exactly one running trip');
  begin
    insert into public.trips (truck_id, start_date, status, start_odometer) values (c.truck_id, current_date, 'in_progress', last_odo);
    perform pg_temp.check(false, 'second running trip on one truck is rejected');
  exception when unique_violation then
    perform pg_temp.check(true, 'second running trip on one truck is rejected');
  end;
  begin
    update public.trips set status = 'completed', end_date = null where id = running;
    perform pg_temp.check(false, 'completing without end readings is rejected');
  exception when check_violation then
    perform pg_temp.check(true, 'completing without end readings is rejected');
  end;

  insert into public.trips (truck_id, driver_id, start_date, status) values (c.truck_id, c.driver_id, current_date, 'planned')
  returning id into planned;
  insert into public.trips (truck_id, driver_id, start_date, status)
  values (c.other_truck, (select id from public.drivers where default_truck_id = c.other_truck), current_date, 'planned')
  returning id into others;

  perform pg_temp.check(pg_temp.as_user_raises(driver,
    format($q$select public.driver_trip_action(%L, 'start', %s)$q$, planned, last_odo + 100)),
    'driver cannot start a second trip while one is running');
  perform pg_temp.check(pg_temp.as_user_raises(driver,
    format($q$select public.driver_trip_action(%L, 'finish', %s)$q$, running, 1)),
    'finish odometer below the start reading is rejected');
  perform pg_temp.check(not pg_temp.as_user_raises(driver,
    format($q$select public.driver_trip_action(%L, 'finish', %s)$q$, running, last_odo + 300)),
    'driver finishes the running trip');
  perform pg_temp.check((select status from public.trips where id = running) = 'completed'
    and (select end_odometer from public.trips where id = running) = last_odo + 300,
    'finish stores status and end odometer');
  perform pg_temp.check(pg_temp.as_user_raises(driver,
    format($q$select public.driver_trip_action(%L, 'start', %s)$q$, planned, last_odo)),
    'start odometer below the truck''s last reading is rejected');
  perform pg_temp.check(not pg_temp.as_user_raises(driver,
    format($q$select public.driver_trip_action(%L, 'start', %s)$q$, planned, last_odo + 350)),
    'driver starts the planned trip');
  perform pg_temp.check(pg_temp.as_user_raises(driver,
    format($q$select public.driver_trip_action(%L, 'start', 1)$q$, others)),
    'driver cannot touch another driver''s trip');
  perform pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000b3',
    format($q$select public.driver_trip_action(%L, 'finish', %s)$q$, planned, last_odo + 400)),
    'staff use the trip screens, not the driver action');
  perform pg_temp.check(pg_temp.as_user_raises(driver,
    format($q$update public.trips set freight_minor = 1 where id = %L returning 1/0$q$, planned))
    or (select freight_minor from public.trips where id = planned) = 0,
    'driver cannot edit trip fields directly');
end;
$$;

rollback;
