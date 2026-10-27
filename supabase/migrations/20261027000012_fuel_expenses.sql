-- Migration 12: Phase 3 — diesel fill-ups from the driver's phone.
--
-- Drivers pay diesel cash from their advance (عهدة) and send each fill-up with
-- a receipt photo; the accountant or manager approves it before it counts.
--   1. Review and settlement columns on fill-ups, and "driver_advance" payment.
--   2. app.guard_fuel_fillup(): review rights, frozen rows, and plausibility
--      (tank capacity, odometer between the truck's neighbouring fill-ups).
--   3. Driver RLS: submit own fill-ups with a receipt from his own folder,
--      fix or withdraw them while waiting.
--   4. Only approved fill-ups count in km/L, trip profit and the truck P&L;
--      rejected ones no longer move the truck's odometer.
--   5. Settlements and advance balances include driver-paid diesel.
--   6. fuel_alerts_v: abnormal consumption in the last 60 days.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.fuel_fillups
  add column status text not null default 'approved'
    constraint fuel_fillups_status_check check (status in ('submitted', 'approved', 'rejected')),
  add column submitted_by uuid,
  add column reviewed_by uuid,
  add column reviewed_at timestamptz,
  add column rejection_reason text,
  add column settlement_id uuid
    constraint fuel_fillups_settlement_fk references public.driver_settlements (id) on delete restrict deferrable initially deferred;

comment on column public.fuel_fillups.status is
  'submitted (by a driver or dispatcher, waiting) | approved (counts) | rejected (with a reason).';

-- Drivers pay diesel from their advance.
alter table public.fuel_fillups
  drop constraint fuel_fillups_payment_method_check,
  add constraint fuel_fillups_payment_method_check
    check (payment_method in ('cash', 'card', 'credit', 'own_tank', 'driver_advance'));

create index fuel_fillups_submitted_idx on public.fuel_fillups (created_at) where status = 'submitted';
create index fuel_fillups_settlement_idx on public.fuel_fillups (settlement_id);
create index fuel_fillups_driver_open_idx on public.fuel_fillups (driver_id) where settlement_id is null;

-- ---------------------------------------------------------------------------
-- 2. Guard
-- ---------------------------------------------------------------------------
-- The truck's tank size and the odometer readings of its fill-ups just before
-- and after a moment. Runs as the owner so a driver's check sees every
-- fill-up of the truck, not only his own.
create function app.fuel_odometer_bounds(p_truck_id uuid, p_filled_at timestamptz, p_except uuid)
returns table (tank_liters integer, prev_odometer integer, next_odometer integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select t.fuel_tank_liters from public.trucks t where t.id = p_truck_id),
    (select max(f.odometer) from public.fuel_fillups f
      where f.truck_id = p_truck_id and f.id is distinct from p_except
        and f.status <> 'rejected' and f.filled_at < p_filled_at),
    (select min(f.odometer) from public.fuel_fillups f
      where f.truck_id = p_truck_id and f.id is distinct from p_except
        and f.status <> 'rejected' and f.filled_at > p_filled_at)
$$;

create function app.guard_fuel_fillup()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  finance boolean := auth.uid() is null or app.has_role('manager', 'accountant');
  b record;
begin
  if tg_op = 'DELETE' then
    if old.settlement_id is not null then
      raise exception 'التعبئة داخلة في تسوية ولا يمكن حذفها' using errcode = 'check_violation';
    end if;
    if not finance and old.status <> 'submitted' then
      raise exception 'حذف التعبئات المعتمدة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Only the manager or accountant record fill-ups that count straight away.
    if not finance then
      new.status := 'submitted';
    end if;
    if new.status = 'submitted' then
      new.submitted_by := coalesce(new.submitted_by, auth.uid());
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
    if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
      raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation';
    end if;
    if new.settlement_id is not null and not app.settling_allows(null, new.settlement_id) then
      raise exception 'لا يمكن إنشاء تعبئة مسوّاة' using errcode = 'check_violation';
    end if;
  else
    -- UPDATE
    if (old.reviewed_at is not null or old.settlement_id is not null)
       and new.receipt_path is distinct from old.receipt_path then
      raise exception 'لا يمكن تغيير إيصال تعبئة تمت مراجعتها أو تسويتها' using errcode = 'check_violation';
    end if;

    if old.settlement_id is not null then
      if (new.driver_id, new.truck_id, new.filled_at, new.odometer, new.liters, new.is_full_tank, new.currency,
          new.amount_minor, new.fx_rate, new.status, new.payment_method, new.settlement_id)
         is distinct from (old.driver_id, old.truck_id, old.filled_at, old.odometer, old.liters, old.is_full_tank, old.currency,
          old.amount_minor, old.fx_rate, old.status, old.payment_method, old.settlement_id) then
        raise exception 'التعبئة داخلة في تسوية ولا يمكن تعديلها' using errcode = 'check_violation';
      end if;
      return new;
    end if;

    if new.settlement_id is not null and not app.settling_allows(old.settlement_id, new.settlement_id) then
      raise exception 'التسوية تتم من شاشة التسويات فقط' using errcode = 'check_violation';
    end if;

    if not finance and old.status <> 'submitted' then
      raise exception 'تعديل التعبئات المعتمدة أو المرفوضة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
    end if;

    if new.status is distinct from old.status then
      if not app.has_role('manager', 'accountant') then
        raise exception 'اعتماد التعبئات أو رفضها للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
      end if;
      if new.status = 'submitted' then
        raise exception 'لا يمكن إرجاع التعبئة إلى حالة الانتظار' using errcode = 'check_violation';
      end if;
      if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
        raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation';
      end if;
      if new.status = 'approved' then
        new.rejection_reason := null;
      end if;
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  end if;

  -- Plausibility, unless the fill-up is being rejected anyway.
  if new.status <> 'rejected' and (
       tg_op = 'INSERT'
       or (new.truck_id, new.filled_at, new.odometer, new.liters, new.status)
          is distinct from (old.truck_id, old.filled_at, old.odometer, old.liters, old.status)) then
    select * into b from app.fuel_odometer_bounds(new.truck_id, new.filled_at, new.id);
    if b.tank_liters is not null and new.liters > b.tank_liters then
      raise exception 'الكمية (% لتر) أكبر من سعة خزان الشاحنة (% لتر)', new.liters, b.tank_liters
        using errcode = 'check_violation';
    end if;
    if b.prev_odometer is not null and new.odometer < b.prev_odometer then
      raise exception 'قراءة العداد (%) أقل من قراءة تعبئة سابقة لهذه الشاحنة (%)', new.odometer, b.prev_odometer
        using errcode = 'check_violation';
    end if;
    if b.next_odometer is not null and new.odometer > b.next_odometer then
      raise exception 'قراءة العداد (%) أعلى من قراءة تعبئة لاحقة لهذه الشاحنة (%)', new.odometer, b.next_odometer
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger fuel_fillups_guard
  before insert or update or delete on public.fuel_fillups
  for each row execute function app.guard_fuel_fillup();

-- ---------------------------------------------------------------------------
-- 3. Drivers: submit with a receipt from their own folder; fix or withdraw while waiting
-- ---------------------------------------------------------------------------
alter policy fuel_fillups_driver_insert on public.fuel_fillups
  with check (
    driver_id = (select app.user_driver_id())
    and truck_id in (select app.driver_truck_ids())
    and status = 'submitted'
    and payment_method = 'driver_advance'
    and settlement_id is null
    and receipt_path is not null
    and split_part(receipt_path, '/', 1) = (select auth.uid())::text
  );

create policy fuel_fillups_driver_update on public.fuel_fillups for update to authenticated
  using (driver_id = (select app.user_driver_id()) and status = 'submitted' and settlement_id is null)
  with check (
    driver_id = (select app.user_driver_id())
    and truck_id in (select app.driver_truck_ids())
    and status = 'submitted'
    and payment_method = 'driver_advance'
    and settlement_id is null
    and receipt_path is not null
    and split_part(receipt_path, '/', 1) = (select auth.uid())::text
  );

create policy fuel_fillups_driver_remove on public.fuel_fillups for delete to authenticated
  using (driver_id = (select app.user_driver_id()) and status = 'submitted' and settlement_id is null);

-- ---------------------------------------------------------------------------
-- 4. Only approved fill-ups count (column lists unchanged)
-- ---------------------------------------------------------------------------
create or replace view public.truck_overview_v
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
    coalesce((select max(f.odometer) from public.fuel_fillups f where f.truck_id = t.id and f.status <> 'rejected'), 0),
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

create or replace view public.fuel_efficiency_v
with (security_invoker = on) as
with ordered as (
  select
    f.*,
    coalesce(count(*) filter (where f.is_full_tank) over (
      partition by f.truck_id order by f.filled_at, f.odometer, f.id
      rows between unbounded preceding and 1 preceding
    ), 0) as seg
  from public.fuel_fillups f
  where f.status = 'approved'
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

create or replace view public.trip_profit_v
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
  from public.fuel_fillups f where f.trip_id = x.id and f.status = 'approved'
) fu on true
left join lateral (
  select sum(e.amount_base_minor) as cost
  from public.expenses e where e.trip_id = x.id and e.status = 'approved'
) ex on true;

create or replace view public.truck_pnl_facts_v
with (security_invoker = on) as
with settings as (
  select s.overhead_allocation, s.timezone from public.company_settings s
),
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
  where e.cost_scope = 'overhead' and e.status = 'approved'
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
where f.status = 'approved'
union all
select w.truck_id, coalesce(w.closed_on, w.opened_on), 'maintenance',
       'الصيانة والإصلاح', w.total_base_minor, 'work_orders', w.id
from public.work_orders w
where w.status <> 'cancelled' and w.total_base_minor > 0
union all
select e.truck_id, e.expense_date, 'expense', ec.name_ar, e.amount_base_minor, 'expenses', e.id
from public.expenses e
join public.expense_categories ec on ec.id = e.category_id
where e.cost_scope = 'truck' and e.status = 'approved'
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

create or replace function app.truck_last_odometer(p_truck_id uuid, p_except_trip uuid default null)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce((select max(greatest(coalesce(x.start_odometer, 0), coalesce(x.end_odometer, 0)))
              from public.trips x
              where x.truck_id = p_truck_id and x.id is distinct from p_except_trip), 0),
    coalesce((select max(f.odometer) from public.fuel_fillups f where f.truck_id = p_truck_id and f.status <> 'rejected'), 0),
    coalesce((select max(w.odometer) from public.work_orders w where w.truck_id = p_truck_id), 0)
  )
$$;

-- ---------------------------------------------------------------------------
-- 5. Settlements and balances include driver-paid diesel
-- ---------------------------------------------------------------------------
-- Diesel is part of expenses_base_minor (everything the driver paid), so the
-- existing difference check still holds; these columns show the diesel share.
alter table public.driver_settlements
  add column fuel_base_minor bigint not null default 0 check (fuel_base_minor >= 0),
  add column fuel_count integer not null default 0 check (fuel_count >= 0),
  add constraint driver_settlements_fuel_within_expenses check (fuel_base_minor <= expenses_base_minor);

comment on column public.driver_settlements.expenses_base_minor is
  'Everything the driver paid from the advance: approved expenses plus approved diesel (fuel_base_minor).';

create or replace function public.settle_driver_advance(
  p_driver_id uuid,
  p_settled_on date default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  on_date date := coalesce(p_settled_on, app.today());
  tz text := coalesce((select s.timezone from public.company_settings s), 'Asia/Amman');
  sid uuid := gen_random_uuid();
  adv bigint;
  adv_n integer;
  exp bigint;
  exp_n integer;
  fuel bigint;
  fuel_n integer;
begin
  -- API callers must be manager or accountant (the seed runs without a user).
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception 'التسوية للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext('settle:' || p_driver_id::text));
  perform set_config('app.settling', sid::text, true);

  with marked as (
    update public.driver_advances a set settlement_id = sid
    where a.driver_id = p_driver_id and a.settlement_id is null and a.issued_on <= on_date
    returning a.amount_base_minor
  )
  select coalesce(sum(amount_base_minor), 0), count(*) into adv, adv_n from marked;

  with marked as (
    update public.expenses e set settlement_id = sid
    where e.driver_id = p_driver_id and e.settlement_id is null and e.status = 'approved'
      and e.payment_method = 'driver_advance' and e.expense_date <= on_date
    returning e.amount_base_minor
  )
  select coalesce(sum(amount_base_minor), 0), count(*) into exp, exp_n from marked;

  with marked as (
    update public.fuel_fillups f set settlement_id = sid
    where f.driver_id = p_driver_id and f.settlement_id is null and f.status = 'approved'
      and f.payment_method = 'driver_advance' and (f.filled_at at time zone tz)::date <= on_date
    returning f.amount_base_minor
  )
  select coalesce(sum(amount_base_minor), 0), count(*) into fuel, fuel_n from marked;

  perform set_config('app.settling', '', true);

  if adv_n + exp_n + fuel_n = 0 then
    raise exception 'لا توجد حركات غير مسوّاة لهذا السائق حتى هذا التاريخ' using errcode = 'no_data_found';
  end if;

  insert into public.driver_settlements
    (id, driver_id, settled_on, advances_base_minor, expenses_base_minor, difference_base_minor,
     advances_count, expenses_count, fuel_base_minor, fuel_count, notes)
  values
    (sid, p_driver_id, on_date, adv, exp + fuel, adv - exp - fuel, adv_n, exp_n, fuel, fuel_n,
     nullif(btrim(coalesce(p_notes, '')), ''));
  return sid;
end;
$$;

create or replace view public.driver_advance_balance_v
with (security_invoker = on) as
select
  d.id as driver_id,
  d.full_name,
  d.is_active,
  coalesce(a.total, 0)::bigint as open_advances_base_minor,
  (coalesce(e.total, 0) + coalesce(f.total, 0))::bigint as open_expenses_base_minor,
  (coalesce(a.total, 0) - coalesce(e.total, 0) - coalesce(f.total, 0))::bigint as balance_base_minor,
  (coalesce(p.total, 0) + coalesce(pf.total, 0))::bigint as pending_base_minor,
  (coalesce(p.n, 0) + coalesce(pf.n, 0))::integer as pending_count,
  s.last_settled_on,
  coalesce(f.total, 0)::bigint as open_fuel_base_minor,
  coalesce(pf.n, 0)::integer as pending_fuel_count
from public.drivers d
left join lateral (
  select sum(x.amount_base_minor) as total from public.driver_advances x
  where x.driver_id = d.id and x.settlement_id is null
) a on true
left join lateral (
  select sum(x.amount_base_minor) as total from public.expenses x
  where x.driver_id = d.id and x.settlement_id is null and x.status = 'approved' and x.payment_method = 'driver_advance'
) e on true
left join lateral (
  select sum(x.amount_base_minor) as total from public.fuel_fillups x
  where x.driver_id = d.id and x.settlement_id is null and x.status = 'approved' and x.payment_method = 'driver_advance'
) f on true
left join lateral (
  select sum(x.amount_base_minor) as total, count(*) as n from public.expenses x
  where x.driver_id = d.id and x.status = 'submitted'
) p on true
left join lateral (
  select sum(x.amount_base_minor) as total, count(*) as n from public.fuel_fillups x
  where x.driver_id = d.id and x.status = 'submitted'
) pf on true
left join lateral (
  select max(x.settled_on) as last_settled_on from public.driver_settlements x where x.driver_id = d.id
) s on true;

-- ---------------------------------------------------------------------------
-- 6. Abnormal consumption alerts (last 60 days, approved fill-ups)
-- ---------------------------------------------------------------------------
create view public.fuel_alerts_v
with (security_invoker = on) as
select
  e.id,
  e.truck_id,
  t.code as truck_code,
  e.driver_id,
  dr.full_name as driver_name,
  e.trip_id,
  e.filled_on,
  e.odometer,
  e.liters,
  e.km_since_last_full,
  e.km_per_liter,
  e.baseline_km_per_liter
from public.fuel_efficiency_v e
join public.trucks t on t.id = e.truck_id
left join public.drivers dr on dr.id = e.driver_id
where e.is_abnormal and e.filled_on >= app.today() - 60;

grant select on public.fuel_alerts_v to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Grants: helpers are for triggers, not API callers. The guard runs as the
-- signed-in user, so it needs EXECUTE on the bounds helper (app is not exposed).
-- ---------------------------------------------------------------------------
revoke execute on function
  app.guard_fuel_fillup(), app.fuel_odometer_bounds(uuid, timestamptz, uuid)
  from public, anon;
grant execute on function app.fuel_odometer_bounds(uuid, timestamptz, uuid) to authenticated;
