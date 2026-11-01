-- Migration 24: truck and customer profit reports (تقارير ربح الشاحنة والزبون).
--
-- Both read truck_pnl_facts_v, so they agree with Truck 360 and the fleet board
-- (closed work orders, approved expenses and fill-ups, overhead shares,
-- depreciation and interest), and both add up to the same fleet profit.
--
-- Truck report: per truck, revenue and each kind of cost, trips, km, tons.
--
-- Customer report: what each customer's loads earned and what they cost.
--   direct cost     fuel and expenses entered against one of the customer's
--                   loads (by trip)
--   allocated cost  every other cost of the truck in the same month (fuel,
--                   maintenance, expenses, overhead share, depreciation,
--                   interest) shared among that truck's loads of that month,
--                   by revenue (default), by number of loads, or by km
--                   (falls back to revenue when the loads have no km, e.g.
--                   loading-sheet lines). Exact to the fils (largest remainder).
--   idle cost       a truck's costs in a month it carried no load: shown on
--                   its own line, never pushed onto a customer.
-- Ranges are half-open [p_from, p_to). All functions run with the caller's
-- rights, so RLS applies; the screens are for the manager and the accountant.

-- ---------------------------------------------------------------------------
-- 1. Trucks
-- ---------------------------------------------------------------------------
create function public.truck_profit_report(p_from date, p_to date)
returns table (
  truck_id uuid,
  revenue_minor bigint,
  fuel_minor bigint,
  maintenance_minor bigint,
  expense_minor bigint,
  overhead_minor bigint,
  depreciation_minor bigint,
  interest_minor bigint,
  costs_minor bigint,
  profit_minor bigint,
  trips integer,
  loaded_trips integer,
  km bigint,
  tons numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select f.truck_id,
           sum(f.amount_base_minor) filter (where f.kind = 'revenue') as revenue,
           sum(f.amount_base_minor) filter (where f.kind = 'fuel') as fuel,
           sum(f.amount_base_minor) filter (where f.kind = 'maintenance') as maintenance,
           sum(f.amount_base_minor) filter (where f.kind = 'expense') as expense,
           sum(f.amount_base_minor) filter (where f.kind = 'overhead') as overhead,
           sum(f.amount_base_minor) filter (where f.kind = 'depreciation') as depreciation,
           sum(f.amount_base_minor) filter (where f.kind = 'interest') as interest,
           sum(f.amount_base_minor) filter (where f.kind <> 'revenue') as costs
    from public.truck_pnl_facts_v f
    where f.fact_date >= p_from and f.fact_date < p_to
    group by f.truck_id
  ), t as (
    -- Trips count where their revenue does: on the end date, or the start date while running.
    select x.truck_id,
           count(*) as trips,
           count(*) filter (where x.freight_base_minor > 0) as loaded,
           sum(greatest(coalesce(x.distance_km, 0), 0)) as km,
           sum(coalesce(x.cargo_weight_tons, 0)) filter (where not x.is_empty_return) as tons
    from public.trips x
    where x.status in ('in_progress', 'completed')
      and coalesce(x.end_date, x.start_date) >= p_from and coalesce(x.end_date, x.start_date) < p_to
    group by x.truck_id
  )
  select k.id,
         coalesce(f.revenue, 0)::bigint, coalesce(f.fuel, 0)::bigint, coalesce(f.maintenance, 0)::bigint,
         coalesce(f.expense, 0)::bigint, coalesce(f.overhead, 0)::bigint, coalesce(f.depreciation, 0)::bigint,
         coalesce(f.interest, 0)::bigint, coalesce(f.costs, 0)::bigint,
         (coalesce(f.revenue, 0) - coalesce(f.costs, 0))::bigint,
         coalesce(t.trips, 0)::integer, coalesce(t.loaded, 0)::integer, coalesce(t.km, 0)::bigint, coalesce(t.tons, 0)::numeric
  from public.trucks k
  left join f on f.truck_id = k.id
  left join t on t.truck_id = k.id
  where k.is_active or f.truck_id is not null or t.truck_id is not null
$$;

-- Revenue and costs per truck per month, for the month-by-month table.
create function public.truck_profit_monthly(p_from date, p_to date)
returns table (truck_id uuid, month date, revenue_minor bigint, costs_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.truck_id, date_trunc('month', f.fact_date)::date,
         coalesce(sum(f.amount_base_minor) filter (where f.kind = 'revenue'), 0)::bigint,
         coalesce(sum(f.amount_base_minor) filter (where f.kind <> 'revenue'), 0)::bigint
  from public.truck_pnl_facts_v f
  where f.fact_date >= p_from and f.fact_date < p_to
  group by 1, 2
  order by 2, 1
$$;

-- ---------------------------------------------------------------------------
-- 2. Customers: one row per load (and per idle truck-month)
-- ---------------------------------------------------------------------------
create function app.client_profit_rows(p_from date, p_to date, p_basis text)
returns table (
  trip_id uuid,
  truck_id uuid,
  client_id uuid,
  fact_date date,
  revenue_minor bigint,
  direct_minor bigint,
  allocated_minor bigint,
  is_idle boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with facts as (
    select f.truck_id, f.fact_date, f.kind, f.amount_base_minor, f.source_table, f.source_id,
           date_trunc('month', f.fact_date)::date as month
    from public.truck_pnl_facts_v f
    where f.fact_date >= p_from and f.fact_date < p_to and f.amount_base_minor <> 0
  ),
  rev as (
    select f.source_id as trip_id, f.truck_id, f.fact_date, f.month, f.amount_base_minor as revenue,
           x.client_id, x.trip_no, greatest(coalesce(x.distance_km, 0), 0) as km
    from facts f
    join public.trips x on x.id = f.source_id
    where f.kind = 'revenue'
  ),
  costs as (
    select f.truck_id, f.month, f.amount_base_minor, coalesce(e.trip_id, fu.trip_id) as linked_trip
    from facts f
    left join public.expenses e on f.kind = 'expense' and f.source_table = 'expenses' and e.id = f.source_id
    left join public.fuel_fillups fu on f.kind = 'fuel' and f.source_table = 'fuel_fillups' and fu.id = f.source_id
    where f.kind <> 'revenue'
  ),
  direct as (
    select c.linked_trip as trip_id, sum(c.amount_base_minor)::bigint as amount
    from costs c
    where c.linked_trip in (select r.trip_id from rev r)
    group by c.linked_trip
  ),
  pool as (
    select c.truck_id, c.month, sum(c.amount_base_minor)::bigint as amount
    from costs c
    where c.linked_trip is null or c.linked_trip not in (select r.trip_id from rev r)
    group by c.truck_id, c.month
  ),
  weighted as (
    select r.*, coalesce(p.amount, 0) as pool_amount,
           case
             when p_basis = 'loads' then 1::numeric
             when p_basis = 'km' and sum(r.km) over (partition by r.truck_id, r.month) > 0 then r.km::numeric
             else r.revenue::numeric
           end as w
    from rev r
    left join pool p on p.truck_id = r.truck_id and p.month = r.month
  ),
  shared as (
    select w.*, w.pool_amount * w.w / nullif(sum(w.w) over (partition by w.truck_id, w.month), 0) as exact
    from weighted w
  ),
  floored as (
    select s.*, floor(coalesce(s.exact, 0))::bigint as base, coalesce(s.exact, 0) - floor(coalesce(s.exact, 0)) as frac
    from shared s
  ),
  -- Largest remainder: the fils left over go one by one to the largest fractions.
  ranked as (
    select f.*,
           f.pool_amount - sum(f.base) over (partition by f.truck_id, f.month) as leftover,
           row_number() over (partition by f.truck_id, f.month order by f.frac desc, f.trip_no) as rn
    from floored f
  )
  select r.trip_id, r.truck_id, r.client_id, r.fact_date, r.revenue::bigint, coalesce(d.amount, 0)::bigint,
         (r.base + case when r.rn <= r.leftover then 1 else 0 end)::bigint, false
  from ranked r
  left join direct d on d.trip_id = r.trip_id
  union all
  select null::uuid, p.truck_id, null::uuid, p.month, 0::bigint, 0::bigint, p.amount, true
  from pool p
  where p.amount <> 0
    and not exists (select 1 from rev r where r.truck_id = p.truck_id and r.month = p.month)
$$;

-- Per customer. client_id null: loads with no customer (is_idle false), or
-- trucks' costs in months they carried nothing (is_idle true).
create function public.client_profit_report(p_from date, p_to date, p_basis text default 'revenue')
returns table (
  client_id uuid,
  is_idle boolean,
  loads integer,
  tons numeric,
  km bigint,
  revenue_minor bigint,
  direct_minor bigint,
  allocated_minor bigint,
  profit_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.client_id, r.is_idle,
         count(r.trip_id)::integer,
         coalesce(sum(x.cargo_weight_tons), 0)::numeric,
         coalesce(sum(greatest(coalesce(x.distance_km, 0), 0)), 0)::bigint,
         sum(r.revenue_minor)::bigint, sum(r.direct_minor)::bigint, sum(r.allocated_minor)::bigint,
         (sum(r.revenue_minor) - sum(r.direct_minor) - sum(r.allocated_minor))::bigint
  from app.client_profit_rows(p_from, p_to, p_basis) r
  left join public.trips x on x.id = r.trip_id
  group by r.client_id, r.is_idle
$$;

-- One customer's loads (p_client_id null: loads with no customer).
create function public.client_profit_trips(p_from date, p_to date, p_basis text, p_client_id uuid)
returns table (
  trip_id uuid,
  trip_no bigint,
  entry_source text,
  fact_date date,
  truck_id uuid,
  client_ref text,
  client_doc_no text,
  route text,
  cargo_description text,
  tons numeric,
  km integer,
  revenue_minor bigint,
  direct_minor bigint,
  allocated_minor bigint,
  profit_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.trip_id, x.trip_no, x.entry_source, r.fact_date, r.truck_id, x.client_ref, x.client_doc_no,
         concat_ws(' ← ', fl.name, tl.name), x.cargo_description, x.cargo_weight_tons, x.distance_km,
         r.revenue_minor, r.direct_minor, r.allocated_minor,
         r.revenue_minor - r.direct_minor - r.allocated_minor
  from app.client_profit_rows(p_from, p_to, p_basis) r
  join public.trips x on x.id = r.trip_id
  left join public.locations fl on fl.id = x.from_location_id
  left join public.locations tl on tl.id = x.to_location_id
  where not r.is_idle and r.client_id is not distinct from p_client_id
  order by r.fact_date, x.trip_no
$$;

revoke execute on function
  public.truck_profit_report(date, date), public.truck_profit_monthly(date, date),
  app.client_profit_rows(date, date, text),
  public.client_profit_report(date, date, text), public.client_profit_trips(date, date, text, uuid)
  from public, anon;
grant execute on function
  public.truck_profit_report(date, date), public.truck_profit_monthly(date, date),
  app.client_profit_rows(date, date, text),
  public.client_profit_report(date, date, text), public.client_profit_trips(date, date, text, uuid)
  to authenticated;
