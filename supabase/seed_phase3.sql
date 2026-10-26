-- Phase 3 demo data, run after seed.sql and seed_phase2.sql.
-- Diesel the drivers paid from their advance (عهدة): one approved fill-up since
-- the last settlement for 8 drivers, and 6 fill-ups waiting for approval.
-- Demo rows carry no receipt photo. All names and numbers are fictional.

do $$
declare
  r record;
  n integer := 0;
  odo integer;
  at_time timestamptz;
  approved_liters numeric;
  pending_liters numeric;
  km integer;
begin
  for r in
    select d.id as driver_id, d.default_truck_id as truck_id, t.code, t.expected_km_per_liter,
           (select x.id from public.trips x
             where x.driver_id = d.id and x.truck_id = d.default_truck_id
             order by (x.status = 'in_progress') desc, x.start_date desc limit 1) as trip_id,
           (select max(f.filled_at) from public.fuel_fillups f where f.truck_id = d.default_truck_id) as last_fill
    from public.drivers d
    join public.trucks t on t.id = d.default_truck_id
    where d.is_active
    order by t.code
    limit 8
  loop
    n := n + 1;
    select coalesce(o.odometer, 0) into odo from public.truck_overview_v o where o.truck_id = r.truck_id;
    -- After the truck's latest fill-up, so the odometer order stays right.
    at_time := greatest(now() - interval '30 hours', coalesce(r.last_fill, now() - interval '30 hours') + interval '1 hour');

    -- Approved, paid by the driver, not yet settled.
    km := 380 + (random() * 200)::integer;
    odo := odo + km;
    approved_liters := round(km / coalesce(r.expected_km_per_liter, 2.8), 2);
    insert into public.fuel_fillups (truck_id, driver_id, trip_id, filled_at, odometer, liters, is_full_tank,
                                     currency, amount_minor, fx_rate, payment_method, status, notes)
    values (r.truck_id, r.driver_id, r.trip_id, at_time, odo, approved_liters, true,
            'JOD', round(approved_liters * 650), 1, 'driver_advance', 'approved', 'دفعها السائق من العهدة');

    -- Waiting for approval (first 6 drivers), measured from the approved full tank
    -- above. The 3rd one burns far more than usual, so Approvals flags it.
    if n <= 6 then
      km := 300 + (random() * 150)::integer;
      pending_liters := round(km / (coalesce(r.expected_km_per_liter, 2.8) * case when n = 3 then 0.65 else 0.98 end), 2);
      insert into public.fuel_fillups (truck_id, driver_id, trip_id, filled_at, odometer, liters, is_full_tank,
                                       currency, amount_minor, fx_rate, payment_method, status, notes)
      values (r.truck_id, r.driver_id, r.trip_id, at_time + interval '20 hours', odo + km, pending_liters, true,
              'JOD', round(pending_liters * 650), 1, 'driver_advance', 'submitted', 'بانتظار موافقة المحاسب');
    end if;
  end loop;
end;
$$;

truncate audit.log;
