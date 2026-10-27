-- Migration 16: diesel bought by the liter, the gallon (قلن) or the tank (تنكة).
--
-- A fill-up records its unit, the quantity in that unit and the price per
-- unit, which depends on the station. The cost is quantity x unit price. A
-- gallon or a tank is a unit of its own here: its size in liters is not
-- known, so only fill-ups in liters have liters, and km/L (and the abnormal
-- consumption check) is measured only where every fill-up involved is in
-- liters.
--
-- Older writers that still send liters and an amount (seeds, scripts) keep
-- working: their fill-up is in liters and the unit price is derived.

alter table public.fuel_fillups
  add column qty_unit text not null default 'liter',
  add column quantity numeric(10, 2),
  add column unit_price_minor bigint;

-- Existing fill-ups are in liters. Skip audit and updated_at for this backfill.
alter table public.fuel_fillups disable trigger fuel_fillups_audit;
alter table public.fuel_fillups disable trigger fuel_fillups_touch;
update public.fuel_fillups set quantity = liters, unit_price_minor = round(amount_minor / liters);
alter table public.fuel_fillups enable trigger fuel_fillups_audit;
alter table public.fuel_fillups enable trigger fuel_fillups_touch;

alter table public.fuel_fillups
  alter column quantity set not null,
  alter column unit_price_minor set not null,
  alter column liters drop not null;

alter table public.fuel_fillups
  add constraint fuel_fillups_qty_unit_check check (qty_unit in ('liter', 'gallon', 'tank')),
  add constraint fuel_fillups_quantity_check check (quantity > 0 and quantity <= 5000),
  add constraint fuel_fillups_unit_price_check check (unit_price_minor >= 0),
  add constraint fuel_fillups_liters_unit check (
    (qty_unit = 'liter' and liters = quantity) or (qty_unit <> 'liter' and liters is null));

comment on column public.fuel_fillups.qty_unit is 'liter, gallon (قلن) or tank (تنكة); gallons and tanks have no known size in liters.';
comment on column public.fuel_fillups.quantity is 'How many liters, gallons or tanks.';
comment on column public.fuel_fillups.unit_price_minor is 'Price per unit in the fill-up currency (minor units); the cost is quantity x unit price.';
comment on column public.fuel_fillups.liters is 'Liters, only for fill-ups in liters.';

-- Keep quantity, unit price, cost and liters consistent. Runs before the
-- base-amount trigger (names sort first), so the JOD amount follows the cost.
create function app.fuel_quantity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity is null then
      new.qty_unit := 'liter';
      new.quantity := new.liters;
    end if;
    if new.quantity is null or new.quantity <= 0 then
      raise exception 'أدخل الكمية' using errcode = 'check_violation';
    end if;
    if new.unit_price_minor is null then
      new.unit_price_minor := round(new.amount_minor / new.quantity);
    else
      new.amount_minor := round(new.quantity * new.unit_price_minor);
    end if;
  else
    -- An older writer changed the liters of a fill-up in liters.
    if new.qty_unit = 'liter' and old.qty_unit = 'liter' and new.liters is distinct from old.liters
       and new.quantity is not distinct from old.quantity then
      new.quantity := new.liters;
    end if;
    if (new.quantity, new.unit_price_minor, new.qty_unit) is distinct from (old.quantity, old.unit_price_minor, old.qty_unit) then
      if new.unit_price_minor is not distinct from old.unit_price_minor and new.amount_minor is distinct from old.amount_minor then
        -- An older writer sent a new amount with the new quantity: keep it, derive the price.
        new.unit_price_minor := round(new.amount_minor / new.quantity);
      else
        new.amount_minor := round(new.quantity * new.unit_price_minor);
      end if;
    elsif new.amount_minor is distinct from old.amount_minor then
      new.unit_price_minor := round(new.amount_minor / new.quantity);
    end if;
  end if;
  new.liters := case when new.qty_unit = 'liter' then new.quantity end;
  return new;
end;
$$;

create trigger fuel_fillups_a_quantity before insert or update on public.fuel_fillups
  for each row execute function app.fuel_quantity();

revoke execute on function app.fuel_quantity() from public, anon;

-- ---------------------------------------------------------------------------
-- Views: km/L only from fill-ups in liters; the efficiency view also returns
-- the unit, quantity and unit price.
-- ---------------------------------------------------------------------------
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
  select o.*,
         case when bool_and(o.liters is not null) over (partition by o.truck_id, o.seg)
              then sum(o.liters) over (partition by o.truck_id, o.seg) end as seg_liters
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
    case when fu.km > 0 and fu.seg_liters > 0 then fu.seg_liters end as measured_liters,
    case when fu.km > 0 and fu.seg_liters > 0 then round(fu.km / fu.seg_liters, 2) end as km_per_liter
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
  ) as is_abnormal,
  m.qty_unit,
  m.quantity,
  m.unit_price_minor
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
  select case when bool_and(f.liters is not null) then sum(f.liters) end as liters,
         sum(f.amount_base_minor) as cost
  from public.fuel_fillups f where f.trip_id = x.id and f.status = 'approved'
) fu on true
left join lateral (
  select sum(e.amount_base_minor) as cost
  from public.expenses e where e.trip_id = x.id and e.status = 'approved'
) ex on true;

