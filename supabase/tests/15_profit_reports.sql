-- Truck and customer profit reports (migration 24).
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

-- The seed's period: the last six months.
create temp table p as select (current_date - 200) as f, (current_date + 1) as t;

-- Trucks --------------------------------------------------------------------------------
select pg_temp.check(
  not exists (
    select 1
    from public.truck_profit_report((select f from p), (select t from p)) r
    full join (
      select s.truck_id,
             sum(s.amount_base_minor) filter (where s.kind = 'revenue') as revenue,
             sum(s.amount_base_minor) filter (where s.kind <> 'revenue') as costs,
             sum(s.amount_base_minor) filter (where s.kind = 'maintenance') as maintenance
      from public.truck_pnl_summary((select f from p), (select t from p)) s
      group by s.truck_id
    ) s on s.truck_id = r.truck_id
    where coalesce(r.revenue_minor, 0) <> coalesce(s.revenue, 0)
       or coalesce(r.costs_minor, 0) <> coalesce(s.costs, 0)
       or coalesce(r.maintenance_minor, 0) <> coalesce(s.maintenance, 0)
  ),
  'the truck report agrees with Truck 360, truck by truck');
select pg_temp.check(
  not exists (
    select 1 from public.truck_profit_report((select f from p), (select t from p))
    where profit_minor <> revenue_minor - costs_minor
       or costs_minor <> fuel_minor + maintenance_minor + expense_minor + overhead_minor + depreciation_minor + interest_minor
  ),
  'profit is revenue less every kind of cost');
select pg_temp.check(
  (select sum(trips) from public.truck_profit_report((select f from p), (select t from p))) > 0
  and (select sum(km) from public.truck_profit_report((select f from p), (select t from p))) > 0,
  'trips and km are counted');
select pg_temp.check(
  (select sum(revenue_minor - costs_minor) from public.truck_profit_monthly((select f from p), (select t from p)))
  = (select sum(profit_minor) from public.truck_profit_report((select f from p), (select t from p))),
  'the months add up to the period');

-- Customers ---------------------------------------------------------------------------
select pg_temp.check(
  (select bool_and(
     (select sum(profit_minor) from public.client_profit_report((select f from p), (select t from p), b))
     = (select sum(profit_minor) from public.truck_profit_report((select f from p), (select t from p)))
     and (select sum(revenue_minor) from public.client_profit_report((select f from p), (select t from p), b))
     = (select sum(revenue_minor) from public.truck_profit_report((select f from p), (select t from p)))
   ) from unnest(array['revenue', 'loads', 'km']) b),
  'customers, loads without a customer and idle trucks add up to the fleet''s profit, on every basis');
select pg_temp.check(
  (select count(*) from public.client_profit_report((select f from p), (select t from p), 'revenue') where client_id is not null) > 1,
  'the seed''s customers are on the report');
select pg_temp.check(
  not exists (
    select 1 from public.client_profit_report((select f from p), (select t from p), 'loads') c
    where c.client_id is not null
      and row(c.revenue_minor, c.direct_minor, c.allocated_minor, c.profit_minor, c.loads::bigint)
          is distinct from (
            select row(sum(t.revenue_minor)::bigint, sum(t.direct_minor)::bigint, sum(t.allocated_minor)::bigint,
                       sum(t.profit_minor)::bigint, count(*))
            from public.client_profit_trips((select f from p), (select t from p), 'loads', c.client_id) t)
  ),
  'each customer''s loads add up to his line');

-- A small case worked by hand, in a month the seed does not touch -------------------------
insert into public.trucks (id, code, plate_number) values ('00000000-0000-4000-8000-0000000004a1', 'T-PR', '99-0001');
insert into public.clients (id, name) values
  ('00000000-0000-4000-8000-0000000004c1', 'زبون التقرير أ'),
  ('00000000-0000-4000-8000-0000000004c2', 'زبون التقرير ب');
create temp table loc as
select (select id from public.locations order by name limit 1) as a, (select id from public.locations order by name offset 1 limit 1) as b;

-- Two loads in January 2020: 300 JOD for A, 100 JOD for B; a third for A in February.
insert into public.trips (id, entry_source, status, truck_id, client_id, from_location_id, to_location_id, start_date, currency, freight_minor) values
  ('00000000-0000-4000-8000-0000000004d1', 'sheet', 'completed', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004c1',
   (select a from loc), (select b from loc), '2020-01-10', 'JOD', 300000),
  ('00000000-0000-4000-8000-0000000004d2', 'sheet', 'completed', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004c2',
   (select b from loc), (select a from loc), '2020-01-12', 'JOD', 100000);
-- January costs: a toll of 40.000 on A's load (direct), and 100.001 not tied to a load.
insert into public.expenses (expense_date, category_id, truck_id, trip_id, description, amount_minor, payment_method, status) values
  ('2020-01-10', (select id from public.expense_categories where code = 'tolls'), '00000000-0000-4000-8000-0000000004a1',
   '00000000-0000-4000-8000-0000000004d1', 'رسوم معبر', 40000, 'cash', 'approved'),
  ('2020-01-20', (select id from public.expense_categories where code = 'operating'), '00000000-0000-4000-8000-0000000004a1',
   null, 'غسيل وتشحيم', 100001, 'cash', 'approved');
-- March: the truck carried nothing but had a 25 JOD expense.
insert into public.expenses (expense_date, category_id, truck_id, description, amount_minor, payment_method, status) values
  ('2020-03-05', (select id from public.expense_categories where code = 'operating'), '00000000-0000-4000-8000-0000000004a1',
   'ترخيص', 25000, 'cash', 'approved');

select pg_temp.check(
  (select (direct_minor, allocated_minor, revenue_minor) = (40000, 75001, 300000)
   from public.client_profit_trips('2020-01-01', '2020-04-01', 'revenue', '00000000-0000-4000-8000-0000000004c1'))
  and (select (direct_minor, allocated_minor) = (0, 25000)
   from public.client_profit_trips('2020-01-01', '2020-04-01', 'revenue', '00000000-0000-4000-8000-0000000004c2')),
  'by revenue: the toll goes to its load, the rest is shared 3 : 1, the odd fils to the larger share');
select pg_temp.check(
  (select array_agg(allocated_minor order by revenue_minor desc)
   from public.client_profit_trips('2020-01-01', '2020-04-01', 'loads', null)
   ) is null
  and (select allocated_minor from public.client_profit_trips('2020-01-01', '2020-04-01', 'loads', '00000000-0000-4000-8000-0000000004c1'))
      + (select allocated_minor from public.client_profit_trips('2020-01-01', '2020-04-01', 'loads', '00000000-0000-4000-8000-0000000004c2')) = 100001
  and abs((select allocated_minor from public.client_profit_trips('2020-01-01', '2020-04-01', 'loads', '00000000-0000-4000-8000-0000000004c1'))
        - (select allocated_minor from public.client_profit_trips('2020-01-01', '2020-04-01', 'loads', '00000000-0000-4000-8000-0000000004c2'))) <= 1,
  'by loads: shared equally, exact to the fils');
select pg_temp.check(
  (select sum(allocated_minor) from app.client_profit_rows('2020-01-01', '2020-04-01', 'revenue')
   where is_idle and truck_id = '00000000-0000-4000-8000-0000000004a1') = 25000,
  'a month with no load is idle cost, not any customer''s');
select pg_temp.check(
  (select sum(revenue_minor - direct_minor - allocated_minor) from app.client_profit_rows('2020-01-01', '2020-04-01', 'km')
   where truck_id = '00000000-0000-4000-8000-0000000004a1')
  = 400000 - 40000 - 100001 - 25000,
  'by km with no km on the loads it falls back to revenue, and still adds up');
select pg_temp.check(
  (select (revenue_minor, costs_minor, profit_minor, trips) = (400000::bigint, 165001::bigint, 234999::bigint, 2)
   from public.truck_profit_report('2020-01-01', '2020-04-01') where truck_id = '00000000-0000-4000-8000-0000000004a1'),
  'the truck report shows the same truck');

rollback;
