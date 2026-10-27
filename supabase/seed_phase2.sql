-- Phase 2 demo data. Runs after seed.sql. All amounts fictional.
--  * Monthly cash advances (عهدة) per driver.
--  * Small costs drivers paid on the road (loading, weighing, meals).
--  * One settlement per driver as of 30 days ago; later items stay open.
--  * Six expenses submitted from drivers' phones, waiting for approval.

select setseed(0.2626);

do $$
declare
  d record;
  t record;
  m date;
  cat jsonb;
  win_start date := (date_trunc('month', current_date) - interval '5 months')::date;
  cutoff date := current_date - 30;
  n integer := 0;
begin
  select jsonb_object_agg(code, id) into cat from public.expense_categories;

  for d in
    select dr.id, dr.default_truck_id, tr.code, tr.code <= 'T-04' as intl
    from public.drivers dr
    join public.trucks tr on tr.id = dr.default_truck_id
    order by tr.code
  loop
    n := n + 1;

    -- Cash advance on the first of every month.
    for m in
      select gs::date from generate_series(win_start, current_date, interval '1 month') as gs
    loop
      insert into public.driver_advances (driver_id, issued_on, amount_minor, method, notes)
      values (d.id, m, case when d.intl then 150000 else 60000 end, 'cash', 'عهدة شهرية');
    end loop;

    -- Costs paid by the driver on roughly a third of their completed trips.
    for t in
      select x.id, x.truck_id, coalesce(x.end_date, x.start_date) as day
      from public.trips x
      where x.driver_id = d.id and x.status = 'completed' and not x.is_empty_return
      order by x.start_date
    loop
      if random() < 0.35 then
        insert into public.expenses (expense_date, category_id, truck_id, trip_id, driver_id, description,
                                     currency, amount_minor, fx_rate, payment_method)
        values (
          t.day,
          (cat ->> (array['loading', 'weighing_parking', 'meals'])[1 + floor(random() * 3)::int])::uuid,
          t.truck_id, t.id, d.id,
          (array['أجور تنزيل البضاعة', 'رسوم ميزان', 'وجبات الطريق'])[1 + floor(random() * 3)::int],
          'JOD', (5 + floor(random() * 21)::int) * 1000, 1, 'driver_advance'
        );
      end if;
    end loop;

    -- Settle everything up to 30 days ago.
    perform public.settle_driver_advance(d.id, cutoff, 'تسوية شهرية');

    -- Six drivers have an expense waiting for approval on their latest trip.
    if n <= 6 then
      select x.id, x.truck_id into t
      from public.trips x
      where x.driver_id = d.id and x.status in ('in_progress', 'completed')
      order by x.start_date desc
      limit 1;
      insert into public.expenses (expense_date, category_id, truck_id, trip_id, driver_id, description,
                                   currency, amount_minor, fx_rate, payment_method, status)
      values (
        current_date - (n % 3),
        (cat ->> (array['loading', 'meals', 'weighing_parking', 'tolls', 'loading', 'fines'])[n])::uuid,
        t.truck_id, t.id, d.id,
        (array['أجور تحميل في الميناء', 'وجبات الطريق', 'رسوم ميزان ومواقف', 'رسوم عبور', 'أجور تنزيل', 'مخالفة وقوف'])[n],
        case when n = 4 then 'USD' else 'JOD' end,
        case when n = 4 then 4500 else (8 + n * 3) * 1000 end,
        case when n = 4 then 0.709 else 1 end,
        'driver_advance',
        'submitted'
      );
    end if;
  end loop;
end;
$$;

-- Demo rows should not clutter the audit log.
truncate audit.log;
