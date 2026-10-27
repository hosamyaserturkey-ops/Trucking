-- Diesel by the liter, gallon (قلن) or tank (تنكة) (migration 16). Rolled back
-- at the end; needs all seeds.

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

-- A truck and its highest odometer reading so far.
create temp table ux as
select t.id as truck_id, d.id as driver_id,
       greatest(coalesce((select max(f.odometer) from public.fuel_fillups f where f.truck_id = t.id), 0),
                coalesce((select max(greatest(coalesce(x.start_odometer, 0), coalesce(x.end_odometer, 0)))
                          from public.trips x where x.truck_id = t.id), 0)) as top_odo,
       greatest(now(), (select max(f.filled_at) from public.fuel_fillups f where f.truck_id = t.id)) as top_time
from public.trucks t
join public.drivers d on d.default_truck_id = t.id
where t.code = 'T-09';

create function pg_temp.fill(p_unit text, p_qty numeric, p_price bigint, p_odo_add integer, p_hours integer,
                             p_full boolean default true, p_note text default 'units test')
returns uuid language sql as $$
  insert into public.fuel_fillups (truck_id, driver_id, filled_at, odometer, qty_unit, quantity, unit_price_minor,
                                   is_full_tank, payment_method, notes)
  select truck_id, driver_id, top_time + make_interval(hours => p_hours), top_odo + p_odo_add, p_unit, p_qty, p_price,
         p_full, 'cash', p_note
  from ux
  returning id
$$;

-- Existing fill-ups ---------------------------------------------------------------
select pg_temp.check(
  not exists (select 1 from public.fuel_fillups where qty_unit = 'liter' and (quantity is distinct from liters)),
  'existing fill-ups are in liters, quantity = liters');
select pg_temp.check(
  (select bool_and(abs(unit_price_minor * quantity - amount_minor) <= quantity) from public.fuel_fillups),
  'their unit price times the quantity gives back the cost (to the fils)');

-- New fill-ups in each unit --------------------------------------------------------
create temp table f_liter as select pg_temp.fill('liter', 200.5, 650, 100, 1, true) as id;
create temp table f_gallon as select pg_temp.fill('gallon', 30, 3000, 400, 2, false) as id;
create temp table f_full as select pg_temp.fill('liter', 150, 650, 700, 3, true) as id;
create temp table f_tank as select pg_temp.fill('tank', 6, 13000, 900, 4, false) as id;

select pg_temp.check(
  (select liters = 200.5 and amount_minor = round(200.5 * 650) and amount_base_minor = amount_minor
   from public.fuel_fillups where id = (select id from f_liter)),
  'a fill-up in liters: cost = liters x price per liter, in JOD');
select pg_temp.check(
  (select liters is null and quantity = 30 and amount_minor = 90000 from public.fuel_fillups where id = (select id from f_gallon)),
  'a fill-up in gallons: cost = gallons x price per gallon, liters unknown');
select pg_temp.check(
  (select qty_unit = 'tank' and liters is null and amount_minor = 78000 from public.fuel_fillups where id = (select id from f_tank)),
  'a fill-up in tanks: cost = tanks x price per tank');

do $$
begin
  begin
    update public.fuel_fillups set liters = 50 where id = (select id from f_gallon);
    if (select liters from public.fuel_fillups where id = (select id from f_gallon)) is not null then
      raise exception 'FAIL: a gallon fill-up got liters';
    end if;
    raise notice 'PASS: a gallon fill-up never has liters';
  end;
  begin
    insert into public.fuel_fillups (truck_id, filled_at, odometer, qty_unit, quantity, unit_price_minor, payment_method)
    select truck_id, top_time, top_odo, 'barrel', 1, 1000, 'cash' from ux;
    raise exception 'FAIL: an unknown unit was accepted';
  exception when check_violation then
    raise notice 'PASS: only liter, gallon and tank are accepted';
  end;
end;
$$;

update public.fuel_fillups set quantity = 32 where id = (select id from f_gallon);
select pg_temp.check((select amount_minor = 96000 from public.fuel_fillups where id = (select id from f_gallon)),
  'changing the quantity recomputes the cost');
update public.fuel_fillups set unit_price_minor = 3100 where id = (select id from f_gallon);
select pg_temp.check((select amount_minor = 99200 from public.fuel_fillups where id = (select id from f_gallon)),
  'changing the unit price recomputes the cost');

-- km/L only where every fill-up is in liters ------------------------------------------
select pg_temp.check(
  (select km_per_liter is null and qty_unit = 'liter' from public.fuel_efficiency_v where id = (select id from f_full)),
  'a full tank after a gallon fill-up gives no km/L (the gallon''s liters are unknown)');
select pg_temp.check(
  (select quantity = 32 and qty_unit = 'gallon' and unit_price_minor = 3100 from public.fuel_efficiency_v where id = (select id from f_gallon)),
  'the efficiency view returns the unit, quantity and unit price');

create temp table f_next as select pg_temp.fill('liter', 120, 650, 1300, 5, true) as id;
select pg_temp.check(
  (select km_per_liter is null from public.fuel_efficiency_v where id = (select id from f_next)),
  'the tank in between also hides km/L for the next full tank');
create temp table f_clean as select pg_temp.fill('liter', 100, 650, 1700, 6, true) as id;
select pg_temp.check(
  (select km_per_liter = round(400 / 100.0, 2) from public.fuel_efficiency_v where id = (select id from f_clean)),
  'a full tank after only liter fill-ups gets its km/L again');

rollback;
