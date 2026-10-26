-- Phase 3 rules (migration 12): driver fill-ups with approval, plausibility,
-- only approved diesel counts, and driver-paid diesel in advances and
-- settlements. Rolled back at the end; needs all three seeds.

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
  return failed;
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'fu-manager@example.test'),
  ('00000000-0000-4000-8000-0000000000d2', 'fu-accountant@example.test'),
  ('00000000-0000-4000-8000-0000000000d3', 'fu-dispatcher@example.test'),
  ('00000000-0000-4000-8000-0000000000d4', 'fu-driver@example.test');
update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-0000000000d1';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-0000000000d2';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-0000000000d3';
update public.profiles
set role = 'driver',
    driver_id = (
      select d.id from public.drivers d join public.trucks t on t.id = d.default_truck_id
      where t.code = 'T-06' and d.id not in (select p.driver_id from public.profiles p where p.driver_id is not null)
    )
where user_id = '00000000-0000-4000-8000-0000000000d4';

create temp table fx as
select
  p.driver_id,
  d.default_truck_id as truck_id,
  t.fuel_tank_liters as tank,
  '00000000-0000-4000-8000-0000000000d4/2026-10/66666666-6666-4666-8666-666666666666.jpg'::text as receipt,
  '00000000-0000-4000-8000-0000000000d3/2026-10/77777777-7777-4777-8777-777777777777.jpg'::text as disp_receipt,
  (select max(f.odometer) from public.fuel_fillups f where f.truck_id = d.default_truck_id) as top_odo
from public.profiles p
join public.drivers d on d.id = p.driver_id
join public.trucks t on t.id = d.default_truck_id
where p.user_id = '00000000-0000-4000-8000-0000000000d4';
grant select on fx to authenticated;

-- A driver fill-up statement: (odometer offset above the truck's top reading, hours from now, liters, status, payment, receipt)
-- Parameters are prefixed so they never resolve to a column of fx.
create function pg_temp.fill(p_odo_add integer, p_hours integer, p_liters numeric, p_status text, p_pay text,
                             p_receipt text, p_truck uuid default null)
returns text language sql as $$
  select format(
    $s$insert into public.fuel_fillups (truck_id, driver_id, filled_at, odometer, liters, is_full_tank, amount_minor,
       payment_method, status, receipt_path, notes)
     values (%L, %L, now() + %L::interval, %s, %s, true, %s, %L, %L, %L, 'phase3 test')$s$,
    coalesce(p_truck, fx.truck_id), fx.driver_id, p_hours || ' hours', fx.top_odo + p_odo_add, p_liters,
    round(p_liters * 650), p_pay, p_status, p_receipt)
  from fx
$$;

-- Seed ------------------------------------------------------------------------
select pg_temp.check((select count(*) from public.fuel_fillups where status = 'submitted' and payment_method = 'driver_advance') >= 6,
  'seed has driver fill-ups waiting for approval');
select pg_temp.check(exists (select 1 from public.fuel_fillups where status = 'approved' and payment_method = 'driver_advance' and settlement_id is null),
  'seed has approved driver-paid diesel not yet settled');

-- Driver submits ----------------------------------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  pg_temp.fill(400, 48, 150, 'approved', 'driver_advance', (select receipt from fx))),
  'driver sends a fill-up with a receipt from his own folder');
create temp table mine as select id, status, submitted_by from public.fuel_fillups where notes = 'phase3 test';
grant select on mine to authenticated;
select pg_temp.check((select count(*) from mine) = 1 and (select status from mine) = 'submitted',
  'a driver''s fill-up always waits for approval, even if sent as approved');
select pg_temp.check((select submitted_by from mine) = '00000000-0000-4000-8000-0000000000d4', 'the sender is recorded');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  pg_temp.fill(500, 49, 100, 'submitted', 'driver_advance', null)),
  'driver cannot send a fill-up without a receipt');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  pg_temp.fill(500, 49, 100, 'submitted', 'cash', (select receipt from fx))),
  'driver fill-ups are paid from the advance only');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  pg_temp.fill(500, 49, 100, 'submitted', 'driver_advance', (select receipt from fx),
               (select id from public.trucks where code = 'T-14'))),
  'driver cannot send a fill-up for another truck');

-- Dispatcher entries go to approval too.
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d3',
  replace(pg_temp.fill(450, 50, 120, 'approved', 'cash', (select disp_receipt from fx)), 'phase3 test', 'phase3 dispatcher')),
  'dispatcher records a fill-up');
select pg_temp.check((select status from public.fuel_fillups where notes = 'phase3 dispatcher') = 'submitted',
  'a dispatcher''s fill-up waits for approval');

-- Plausibility ------------------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  pg_temp.fill(600, 52, (select tank + 1 from fx), 'submitted', 'driver_advance', (select receipt from fx))),
  'more liters than the truck''s tank holds is refused');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  pg_temp.fill(-100000, 60, 100, 'submitted', 'driver_advance', (select receipt from fx))),
  'an odometer lower than an earlier fill-up is refused');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d1',
  format($s$insert into public.fuel_fillups (truck_id, filled_at, odometer, liters, amount_minor)
            select f.truck_id, f.filled_at - interval '1 minute', f.odometer + 50000, 50, 1000
            from public.fuel_fillups f where f.truck_id = %L and f.status = 'approved' order by f.filled_at limit 1$s$,
         (select truck_id from fx))),
  'a back-dated fill-up above a later reading is refused, even for the manager');

-- Review ------------------------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  format('update public.fuel_fillups set status = ''approved'' where id = %L', (select id from mine))),
  'driver cannot approve his own fill-up');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d3',
  format('update public.fuel_fillups set status = ''approved'' where id = %L', (select id from mine))),
  'dispatcher cannot approve a fill-up');
select pg_temp.check((select count(*) from public.fuel_efficiency_v where id = (select id from mine)) = 0,
  'a waiting fill-up is not in the km/L figures');
select pg_temp.check((select count(*) from public.truck_pnl_facts_v where source_id = (select id from mine)) = 0,
  'a waiting fill-up is not in the truck P&L');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d2',
  format('update public.fuel_fillups set status = ''approved'' where id = %L', (select id from mine))),
  'accountant approves the fill-up');
select pg_temp.check((select reviewed_by from public.fuel_fillups where id = (select id from mine)) = '00000000-0000-4000-8000-0000000000d2',
  'the reviewer is recorded');
select pg_temp.check((select count(*) from public.fuel_efficiency_v where id = (select id from mine)) = 1
  and (select count(*) from public.truck_pnl_facts_v where source_id = (select id from mine) and kind = 'fuel') = 1,
  'once approved it counts in km/L and the P&L');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d2',
  'update public.fuel_fillups set status = ''rejected'' where notes = ''phase3 dispatcher'''),
  'a rejection needs a reason');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d2',
  'update public.fuel_fillups set status = ''rejected'', rejection_reason = ''الإيصال غير واضح'' where notes = ''phase3 dispatcher'''),
  'accountant rejects with a reason');
select pg_temp.check((select odometer from public.truck_overview_v where truck_id = (select truck_id from fx))
  < (select odometer from public.fuel_fillups where notes = 'phase3 dispatcher'),
  'a rejected fill-up does not move the truck''s odometer');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d3',
  format('update public.fuel_fillups set liters = 1 where id = %L', (select id from mine))),
  'dispatcher cannot change an approved fill-up');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d1',
  format('update public.fuel_fillups set receipt_path = null where id = %L', (select id from mine))),
  'the receipt of a reviewed fill-up is frozen, even for the manager');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  format('update public.fuel_fillups set receipt_path = null where id = %L', (select id from mine)))
  and (select receipt_path from public.fuel_fillups where id = (select id from mine)) = (select receipt from fx),
  'a driver cannot touch a fill-up once it is reviewed');

-- Withdraw while waiting ------------------------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  replace(pg_temp.fill(700, 70, 90, 'submitted', 'driver_advance', (select receipt from fx)), 'phase3 test', 'phase3 withdraw')),
  'driver sends another fill-up');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d4',
  'delete from public.fuel_fillups where notes = ''phase3 withdraw'''),
  'driver withdraws a waiting fill-up');
select pg_temp.check((select count(*) from public.fuel_fillups where notes = 'phase3 withdraw') = 0, 'the withdrawn fill-up is gone');

-- Advances and settlement -------------------------------------------------------
create temp table before_settle as
select b.*, (select coalesce(sum(f.amount_base_minor), 0) from public.fuel_fillups f
              where f.driver_id = b.driver_id and f.status = 'approved' and f.payment_method = 'driver_advance'
                and f.settlement_id is null) as fuel_open
from public.driver_advance_balance_v b where b.driver_id = (select driver_id from fx);
select pg_temp.check((select open_fuel_base_minor from before_settle) = (select fuel_open from before_settle)
  and (select fuel_open from before_settle) > 0,
  'the advance balance includes approved diesel the driver paid');
select pg_temp.check((select balance_base_minor from before_settle)
  = (select open_advances_base_minor - open_expenses_base_minor from before_settle),
  'balance = advances − (expenses + diesel)');

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d2',
  format('select public.settle_driver_advance(%L, (current_date + 5)::date, ''phase3 settle'')', (select driver_id from fx))),
  'accountant settles the driver');
create temp table st as select * from public.driver_settlements where notes = 'phase3 settle';
select pg_temp.check((select fuel_base_minor from st) = (select fuel_open from before_settle) and (select fuel_count from st) > 0,
  'the settlement closes the driver-paid diesel');
select pg_temp.check((select difference_base_minor from st) = (select advances_base_minor - expenses_base_minor from st)
  and (select expenses_base_minor from st) >= (select fuel_base_minor from st),
  'difference = advances − (expenses + diesel), exactly');
select pg_temp.check(not exists (select 1 from public.fuel_fillups where driver_id = (select driver_id from fx)
  and status = 'approved' and payment_method = 'driver_advance' and settlement_id is null),
  'no driver-paid diesel left open');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d1',
  format('update public.fuel_fillups set liters = liters + 1 where id = %L', (select id from mine))),
  'a settled fill-up cannot be changed, even by the manager');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d1',
  format('delete from public.fuel_fillups where id = %L', (select id from mine))),
  'a settled fill-up cannot be deleted');

-- Reviewed rows are kept (migration 13) -----------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d1',
  'delete from public.fuel_fillups where notes = ''phase3 dispatcher'''),
  'a rejected (reviewed) fill-up cannot be deleted, even by the manager');
create temp table reviewed_exp as
select id from public.expenses where status = 'submitted' and settlement_id is null limit 1;
grant select on reviewed_exp to authenticated;
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d2',
  'update public.expenses set status = ''approved'' where id = (select id from reviewed_exp)'),
  'accountant approves a driver expense');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d2',
  'delete from public.expenses where id = (select id from reviewed_exp)')
  and exists (select 1 from public.expenses where id = (select id from reviewed_exp)),
  'a reviewed expense cannot be deleted');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000d2',
  'delete from public.expenses where id = (select id from public.expenses where reviewed_at is null and settlement_id is null and status = ''approved'' and driver_id is null limit 1)'),
  'an office expense that was never reviewed can still be deleted');

-- Alerts --------------------------------------------------------------------------
select pg_temp.check(not exists (select 1 from public.fuel_alerts_v where km_per_liter >= baseline_km_per_liter
  or filled_on < current_date - 60),
  'fuel alerts list only recent abnormal consumption');

rollback;
