-- Read models for the Truck 360 page and the fleet board.
-- All views run with the caller's rights (security_invoker) so RLS applies.

-- ---------------------------------------------------------------------------
-- Fleet overview: status, current driver, odometer
-- ---------------------------------------------------------------------------
create view public.truck_overview_v
with (security_invoker = on) as
select
  t.id as truck_id,
  t.code,
  t.plate_number,
  t.make,
  t.model,
  t.year,
  t.truck_type,
  t.is_active,
  t.expected_km_per_liter,
  cur.id as current_trip_id,
  wo.id as open_work_order_id,
  case
    when not t.is_active then 'inactive'
    when cur.id is not null then 'on_trip'
    when wo.id is not null then 'workshop'
    else 'idle'
  end as status,
  coalesce(cur.driver_id, dd.id) as current_driver_id,
  coalesce(cd.full_name, dd.full_name) as current_driver_name,
  nullif(greatest(
    coalesce((select max(greatest(x.start_odometer, coalesce(x.end_odometer, 0))) from public.trips x where x.truck_id = t.id), 0),
    coalesce((select max(f.odometer) from public.fuel_fillups f where f.truck_id = t.id), 0),
    coalesce((select max(w.odometer) from public.work_orders w where w.truck_id = t.id), 0)
  ), 0) as odometer
from public.trucks t
left join lateral (
  select x.id, x.driver_id from public.trips x
  where x.truck_id = t.id and x.status = 'in_progress'
  order by x.start_date desc limit 1
) cur on true
left join lateral (
  select w.id from public.work_orders w
  where w.truck_id = t.id and w.status = 'open'
  order by w.opened_on desc limit 1
) wo on true
left join public.drivers cd on cd.id = cur.driver_id
left join lateral (
  select d.id, d.full_name from public.drivers d
  where d.default_truck_id = t.id and d.is_active
  order by d.full_name limit 1
) dd on true;

-- ---------------------------------------------------------------------------
-- Diesel efficiency (full-tank method).
-- km/L for a full fill-up = km since the previous full fill-up divided by all
-- liters bought after it (partials included). Flagged when below the truck
-- baseline (expected km/L, else the truck's own average) by the threshold.
-- ---------------------------------------------------------------------------
create view public.fuel_efficiency_v
with (security_invoker = on) as
with ordered as (
  select
    f.*,
    coalesce(count(*) filter (where f.is_full_tank) over (
      partition by f.truck_id order by f.filled_at, f.odometer, f.id
      rows between unbounded preceding and 1 preceding
    ), 0) as seg
  from public.fuel_fillups f
),
segs as (
  select o.*, sum(o.liters) over (partition by o.truck_id, o.seg) as seg_liters
  from ordered o
),
fulls as (
  select
    s.id,
    s.seg_liters,
    s.odometer - lag(s.odometer) over (partition by s.truck_id order by s.filled_at, s.odometer, s.id) as km
  from segs s
  where s.is_full_tank
),
measured as (
  select
    s.*,
    fu.km,
    case when fu.km > 0 then fu.seg_liters end as measured_liters,
    case when fu.km > 0 then round(fu.km / fu.seg_liters, 2) end as km_per_liter
  from segs s
  left join fulls fu on fu.id = s.id
),
baseline as (
  select
    m.truck_id,
    round(sum(m.km) / nullif(sum(m.measured_liters), 0), 2) as avg_km_per_liter
  from measured m
  where m.km_per_liter is not null
  group by m.truck_id
)
select
  m.id,
  m.truck_id,
  m.driver_id,
  m.trip_id,
  m.station_id,
  m.filled_at,
  (m.filled_at at time zone coalesce((select s.timezone from public.company_settings s), 'Asia/Amman'))::date as filled_on,
  m.odometer,
  m.liters,
  m.is_full_tank,
  m.currency,
  m.amount_minor,
  m.amount_base_minor,
  round(m.amount_base_minor / m.liters) as price_per_liter_base_minor,
  m.payment_method,
  m.receipt_path,
  m.km as km_since_last_full,
  m.km_per_liter,
  coalesce(t.expected_km_per_liter, b.avg_km_per_liter) as baseline_km_per_liter,
  coalesce(
    m.km_per_liter < coalesce(t.expected_km_per_liter, b.avg_km_per_liter)
      * (1 - (select s.fuel_anomaly_threshold_pct from public.company_settings s) / 100),
    false
  ) as is_abnormal
from measured m
join public.trucks t on t.id = m.truck_id
left join baseline b on b.truck_id = m.truck_id;

-- ---------------------------------------------------------------------------
-- Trip profit: freight minus the fuel and expenses linked to the trip.
-- ---------------------------------------------------------------------------
create view public.trip_profit_v
with (security_invoker = on) as
select
  x.id as trip_id,
  x.trip_no,
  x.truck_id,
  x.driver_id,
  d.full_name as driver_name,
  x.client_id,
  c.name as client_name,
  fl.name as from_name,
  tl.name as to_name,
  x.start_date,
  x.end_date,
  x.status,
  x.cargo_description,
  x.is_empty_return,
  x.distance_km,
  x.currency,
  x.freight_minor,
  x.freight_base_minor,
  coalesce(fu.liters, 0) as fuel_liters,
  coalesce(fu.cost, 0)::bigint as fuel_base_minor,
  coalesce(ex.cost, 0)::bigint as expenses_base_minor,
  (x.freight_base_minor - coalesce(fu.cost, 0) - coalesce(ex.cost, 0))::bigint as profit_base_minor,
  case when x.distance_km > 0 and fu.liters > 0 then round(x.distance_km / fu.liters, 2) end as km_per_liter
from public.trips x
left join public.drivers d on d.id = x.driver_id
left join public.clients c on c.id = x.client_id
left join public.locations fl on fl.id = x.from_location_id
left join public.locations tl on tl.id = x.to_location_id
left join lateral (
  select sum(f.liters) as liters, sum(f.amount_base_minor) as cost
  from public.fuel_fillups f where f.trip_id = x.id
) fu on true
left join lateral (
  select sum(e.amount_base_minor) as cost
  from public.expenses e where e.trip_id = x.id
) ex on true;

-- ---------------------------------------------------------------------------
-- Truck P&L facts. One row per revenue/cost item per truck, in base currency.
-- Profit card, monthly chart and ranking all aggregate this view.
--   kind: revenue | fuel | maintenance | expense | depreciation | interest | overhead
-- ---------------------------------------------------------------------------
create view public.truck_pnl_facts_v
with (security_invoker = on) as
with settings as (
  select s.overhead_allocation, s.timezone from public.company_settings s
),
-- trucks eligible for overhead on a given date
fleet as (
  select t.id, t.code, a.purchase_date
  from public.trucks t
  left join public.truck_assets a on a.truck_id = t.id
  where t.is_active
),
overhead as (
  select e.id, e.expense_date, e.amount_base_minor, ec.name_ar as category_name
  from public.expenses e
  join public.expense_categories ec on ec.id = e.category_id
  where e.cost_scope = 'overhead'
),
truck_km_month as (
  select x.truck_id, date_trunc('month', coalesce(x.end_date, x.start_date))::date as month,
         sum(greatest(coalesce(x.distance_km, 0), 0)) as km
  from public.trips x
  where x.status in ('in_progress', 'completed')
  group by 1, 2
),
alloc_base as (
  select
    o.id as expense_id,
    o.expense_date,
    o.amount_base_minor,
    o.category_name,
    f.id as truck_id,
    f.code,
    case
      when (select overhead_allocation from settings) = 'by_km'
        and sum(coalesce(k.km, 0)) over (partition by o.id) > 0
      then coalesce(k.km, 0)::numeric
      else 1::numeric
    end as weight
  from overhead o
  join fleet f on f.purchase_date is null or f.purchase_date <= o.expense_date
  left join truck_km_month k
    on k.truck_id = f.id and k.month = date_trunc('month', o.expense_date)::date
),
alloc_floor as (
  select
    a.*,
    floor(a.amount_base_minor * a.weight / sum(a.weight) over (partition by a.expense_id))::bigint as base_share,
    (a.amount_base_minor * a.weight / sum(a.weight) over (partition by a.expense_id))
      - floor(a.amount_base_minor * a.weight / sum(a.weight) over (partition by a.expense_id)) as frac
  from alloc_base a
),
-- largest remainder: hand out the leftover minor units one by one
alloc as (
  select
    a.*,
    a.amount_base_minor - sum(a.base_share) over (partition by a.expense_id) as leftover,
    row_number() over (partition by a.expense_id order by a.frac desc, a.code) as rn
  from alloc_floor a
),
depreciation as (
  select
    a.truck_id,
    (date_trunc('month', a.purchase_date) + make_interval(months => g.i - 1))::date as month,
    (floor((a.purchase_cost_base_minor - a.salvage_value_base_minor)::numeric * g.i / a.useful_life_months)
      - floor((a.purchase_cost_base_minor - a.salvage_value_base_minor)::numeric * (g.i - 1) / a.useful_life_months))::bigint
      as amount
  from public.truck_assets a
  cross join lateral generate_series(1, a.useful_life_months) as g(i)
  where a.purchase_date is not null
    and a.useful_life_months is not null
    and a.purchase_cost_base_minor > a.salvage_value_base_minor
    and date_trunc('month', a.purchase_date) + make_interval(months => g.i - 1) <= date_trunc('month', app.today())
)
select x.truck_id, coalesce(x.end_date, x.start_date) as fact_date, 'revenue'::text as kind,
       'إيرادات النقل'::text as category_name, x.freight_base_minor as amount_base_minor,
       'trips'::text as source_table, x.id as source_id
from public.trips x
where x.status in ('in_progress', 'completed') and x.freight_base_minor > 0
union all
select f.truck_id, (f.filled_at at time zone (select timezone from settings))::date, 'fuel',
       'الديزل', f.amount_base_minor, 'fuel_fillups', f.id
from public.fuel_fillups f
union all
select w.truck_id, coalesce(w.closed_on, w.opened_on), 'maintenance',
       'الصيانة والإصلاح', w.total_base_minor, 'work_orders', w.id
from public.work_orders w
where w.status <> 'cancelled' and w.total_base_minor > 0
union all
select e.truck_id, e.expense_date, 'expense', ec.name_ar, e.amount_base_minor, 'expenses', e.id
from public.expenses e
join public.expense_categories ec on ec.id = e.category_id
where e.cost_scope = 'truck'
union all
select d.truck_id, d.month, 'depreciation', 'استهلاك الشاحنة', d.amount, 'truck_assets', d.truck_id
from depreciation d
where d.amount > 0
union all
select tf.truck_id, i.due_date, 'interest', 'فوائد التمويل', i.interest_base_minor, 'financing_installments', i.id
from public.financing_installments i
join public.truck_financing tf on tf.id = i.financing_id
where i.interest_base_minor > 0 and i.due_date <= app.today()
union all
select a.truck_id, a.expense_date, 'overhead', 'مصاريف عامة موزعة: ' || a.category_name,
       a.base_share + case when a.rn <= a.leftover then 1 else 0 end, 'expenses', a.expense_id
from alloc a
where a.base_share + case when a.rn <= a.leftover then 1 else 0 end > 0;

-- ---------------------------------------------------------------------------
-- Document expiry with 60/30/7-day bands
-- ---------------------------------------------------------------------------
create view public.document_expiry_v
with (security_invoker = on) as
select
  d.*,
  t.code as truck_code,
  t.plate_number,
  d.expiry_date - app.today() as days_left,
  case
    when d.expiry_date is null then 'none'
    when d.expiry_date < app.today() then 'expired'
    when d.expiry_date - app.today() <= 7 then 'd7'
    when d.expiry_date - app.today() <= 30 then 'd30'
    when d.expiry_date - app.today() <= 60 then 'd60'
    else 'ok'
  end as expiry_band
from public.truck_documents d
join public.trucks t on t.id = d.truck_id;

-- ---------------------------------------------------------------------------
-- Next service due (by km and/or date)
-- ---------------------------------------------------------------------------
create view public.service_due_v
with (security_invoker = on) as
select
  s.id,
  s.truck_id,
  s.service_name,
  s.interval_km,
  s.interval_days,
  s.last_done_odometer,
  s.last_done_on,
  o.odometer as current_odometer,
  s.last_done_odometer + s.interval_km as next_due_odometer,
  (s.last_done_odometer + s.interval_km) - o.odometer as km_left,
  (s.last_done_on + s.interval_days) as next_due_on,
  (s.last_done_on + s.interval_days) - app.today() as days_left,
  case
    when (s.last_done_odometer + s.interval_km) - o.odometer < 0
      or (s.last_done_on + s.interval_days) - app.today() < 0 then 'overdue'
    when (s.last_done_odometer + s.interval_km) - o.odometer <= 2000
      or (s.last_done_on + s.interval_days) - app.today() <= 14 then 'due_soon'
    else 'ok'
  end as due_status
from public.service_schedules s
join public.truck_overview_v o on o.truck_id = s.truck_id
where s.is_active;

-- ---------------------------------------------------------------------------
-- Journal lines with entry and account (truck ledger)
-- ---------------------------------------------------------------------------
create view public.journal_lines_v
with (security_invoker = on) as
select
  l.id,
  l.entry_id,
  e.entry_no,
  e.entry_date,
  e.description as entry_description,
  e.status,
  e.source_type,
  l.line_no,
  l.account_id,
  a.code as account_code,
  a.name_ar as account_name,
  a.type as account_type,
  l.truck_id,
  l.description,
  l.debit_minor,
  l.credit_minor
from public.journal_lines l
join public.journal_entries e on e.id = l.entry_id
join public.accounts a on a.id = l.account_id;

-- ---------------------------------------------------------------------------
-- Audit log for managers (RLS on audit.log decides who sees rows)
-- ---------------------------------------------------------------------------
create view public.audit_log_v
with (security_invoker = on) as
select l.id, l.at, l.user_id, p.full_name as user_name, p.email as user_email,
       l.table_name, l.record_id, l.action, l.old_data, l.new_data
from audit.log l
left join public.profiles p on p.user_id = l.user_id;
