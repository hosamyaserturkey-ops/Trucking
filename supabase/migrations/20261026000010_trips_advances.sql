-- Phase 2: trip lifecycle, driver advances (عهدة) and settlements, and driver
-- expenses that wait for approval before they count.
-- Additive only: columns, tables, functions, policies and `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. Default exchange rates (forms pre-fill fx_rate from here)
-- ---------------------------------------------------------------------------
alter table public.currencies add column rate_to_base numeric(18, 8)
  constraint currencies_rate_positive check (rate_to_base is null or rate_to_base > 0);
update public.currencies set rate_to_base = 1 where code = 'JOD';
update public.currencies set rate_to_base = 0.709 where code = 'USD';

-- ---------------------------------------------------------------------------
-- 2. Driver settlements (immutable once written)
-- ---------------------------------------------------------------------------
create table public.driver_settlements (
  id uuid primary key default gen_random_uuid(),
  settlement_no bigint generated always as identity unique,
  driver_id uuid not null references public.drivers (id) on delete restrict,
  settled_on date not null,
  advances_base_minor bigint not null check (advances_base_minor >= 0),
  expenses_base_minor bigint not null check (expenses_base_minor >= 0),
  difference_base_minor bigint not null,
  advances_count integer not null default 0,
  expenses_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint driver_settlements_difference check (difference_base_minor = advances_base_minor - expenses_base_minor)
);

comment on column public.driver_settlements.difference_base_minor is
  'Advances minus driver-paid expenses. Positive: driver returns cash. Negative: company pays the driver.';

create index driver_settlements_driver_idx on public.driver_settlements (driver_id, settled_on);

create function app.guard_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'التسوية لا تُعدّل ولا تُحذف؛ سجّل حركة جديدة للتصحيح' using errcode = 'check_violation';
end;
$$;

create trigger driver_settlements_guard
  before update or delete on public.driver_settlements
  for each row execute function app.guard_settlement();

-- ---------------------------------------------------------------------------
-- 3. Driver advances (عهدة)
-- ---------------------------------------------------------------------------
create table public.driver_advances (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id) on delete restrict,
  trip_id uuid references public.trips (id) on delete set null,
  issued_on date not null,
  currency char(3) not null default 'JOD' references public.currencies (code),
  amount_minor bigint not null check (amount_minor > 0),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  amount_base_minor bigint not null default 0,
  method text not null default 'cash' check (method in ('cash', 'bank')),
  notes text,
  settlement_id uuid references public.driver_settlements (id) on delete restrict deferrable initially deferred,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index driver_advances_driver_idx on public.driver_advances (driver_id, issued_on);
create index driver_advances_open_idx on public.driver_advances (driver_id) where settlement_id is null;
create index driver_advances_trip_idx on public.driver_advances (trip_id);
create index driver_advances_settlement_idx on public.driver_advances (settlement_id);

create trigger driver_advances_base_amount before insert or update on public.driver_advances
  for each row execute function app.set_base_amount('amount');

-- settlement_id is only ever set by settle_driver_advance(), which marks the
-- transaction with app.settling = <settlement id>. API callers cannot set it.
create function app.settling_allows(old_id uuid, new_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select old_id is null and new_id is not null
     and current_setting('app.settling', true) = new_id::text
$$;

create function app.guard_advance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.settlement_id is not null then
      raise exception 'العهدة داخلة في تسوية ولا يمكن حذفها' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if new.trip_id is not null and not exists (
    select 1 from public.trips t where t.id = new.trip_id and t.driver_id = new.driver_id
  ) then
    raise exception 'الرحلة المرتبطة ليست لهذا السائق' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.settlement_id is not null and not app.settling_allows(null, new.settlement_id) then
      raise exception 'لا يمكن إنشاء عهدة مسوّاة' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.settlement_id is not null then
    if (new.driver_id, new.issued_on, new.currency, new.amount_minor, new.fx_rate, new.settlement_id)
       is distinct from (old.driver_id, old.issued_on, old.currency, old.amount_minor, old.fx_rate, old.settlement_id) then
      raise exception 'العهدة داخلة في تسوية ولا يمكن تعديلها' using errcode = 'check_violation';
    end if;
  elsif new.settlement_id is not null and not app.settling_allows(old.settlement_id, new.settlement_id) then
    raise exception 'التسوية تتم من شاشة التسويات فقط' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger driver_advances_guard
  before insert or update or delete on public.driver_advances
  for each row execute function app.guard_advance();

-- ---------------------------------------------------------------------------
-- 4. Expense review: drivers submit, accountant or manager approves
-- ---------------------------------------------------------------------------
alter table public.expenses
  add column status text not null default 'approved'
    constraint expenses_status_check check (status in ('submitted', 'approved', 'rejected')),
  add column submitted_by uuid,
  add column reviewed_by uuid,
  add column reviewed_at timestamptz,
  add column rejection_reason text,
  add column settlement_id uuid
    constraint expenses_settlement_fk references public.driver_settlements (id) on delete restrict deferrable initially deferred;

comment on column public.expenses.status is
  'submitted (by a driver, waiting) | approved (counts in profit and advances) | rejected (with a reason).';

create index expenses_submitted_idx on public.expenses (created_at) where status = 'submitted';
create index expenses_settlement_idx on public.expenses (settlement_id);
create index expenses_driver_open_idx on public.expenses (driver_id) where settlement_id is null;

create function app.guard_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.settlement_id is not null then
      raise exception 'المصروف داخل في تسوية ولا يمكن حذفه' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.submitted_by := coalesce(new.submitted_by, auth.uid());
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
    if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
      raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation';
    end if;
    if new.settlement_id is not null and not app.settling_allows(null, new.settlement_id) then
      raise exception 'لا يمكن إنشاء مصروف مسوّى' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.settlement_id is not null then
    if (new.driver_id, new.truck_id, new.expense_date, new.currency, new.amount_minor, new.fx_rate,
        new.status, new.payment_method, new.settlement_id)
       is distinct from (old.driver_id, old.truck_id, old.expense_date, old.currency, old.amount_minor, old.fx_rate,
        old.status, old.payment_method, old.settlement_id) then
      raise exception 'المصروف داخل في تسوية ولا يمكن تعديله' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.settlement_id is not null and not app.settling_allows(old.settlement_id, new.settlement_id) then
    raise exception 'التسوية تتم من شاشة التسويات فقط' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if not app.has_role('manager', 'accountant') then
      raise exception 'اعتماد المصاريف أو رفضها للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'submitted' then
      raise exception 'لا يمكن إرجاع المصروف إلى حالة الانتظار' using errcode = 'check_violation';
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
  return new;
end;
$$;

create trigger expenses_guard
  before insert or update or delete on public.expenses
  for each row execute function app.guard_expense();

-- Drivers: submit for their own trucks, fix or withdraw while still waiting.
alter policy expenses_driver_insert on public.expenses
  with check (
    driver_id = (select app.user_driver_id())
    and cost_scope = 'truck'
    and status = 'submitted'
    and settlement_id is null
    and truck_id in (select app.driver_truck_ids())
  );

create policy expenses_driver_update on public.expenses for update to authenticated
  using (driver_id = (select app.user_driver_id()) and status = 'submitted' and settlement_id is null)
  with check (
    driver_id = (select app.user_driver_id())
    and cost_scope = 'truck'
    and status = 'submitted'
    and settlement_id is null
    and truck_id in (select app.driver_truck_ids())
  );

create policy expenses_driver_remove on public.expenses for delete to authenticated
  using (driver_id = (select app.user_driver_id()) and status = 'submitted' and settlement_id is null);

-- New categories for costs drivers pay on the road.
insert into public.expense_categories (code, name_ar, account_id, sort_order)
select v.code, v.name_ar, a.id, v.sort_order
from (values
  ('loading', 'أجور تحميل وتنزيل', '5108', 65),
  ('weighing_parking', 'موازين ومواقف', '5104', 15),
  ('meals', 'إعاشة', '5108', 67)
) as v (code, name_ar, account_code, sort_order)
join public.accounts a on a.code = v.account_code
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Only approved expenses count in trip profit and the truck P&L
-- ---------------------------------------------------------------------------
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
  from public.fuel_fillups f where f.trip_id = x.id
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

-- ---------------------------------------------------------------------------
-- 6. Settling a driver's advance balance
-- ---------------------------------------------------------------------------
-- Closes every unsettled advance and every unsettled, approved expense the
-- driver paid ("driver_advance"), dated up to p_settled_on. Runs with the
-- caller's rights, so RLS limits it to manager and accountant.
create function public.settle_driver_advance(
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
  sid uuid := gen_random_uuid();
  adv bigint;
  adv_n integer;
  exp bigint;
  exp_n integer;
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

  perform set_config('app.settling', '', true);

  if adv_n + exp_n = 0 then
    raise exception 'لا توجد حركات غير مسوّاة لهذا السائق حتى هذا التاريخ' using errcode = 'no_data_found';
  end if;

  insert into public.driver_settlements
    (id, driver_id, settled_on, advances_base_minor, expenses_base_minor, difference_base_minor,
     advances_count, expenses_count, notes)
  values
    (sid, p_driver_id, on_date, adv, exp, adv - exp, adv_n, exp_n, nullif(btrim(coalesce(p_notes, '')), ''));
  return sid;
end;
$$;

-- Balance per driver: what is still open since the last settlement.
create view public.driver_advance_balance_v
with (security_invoker = on) as
select
  d.id as driver_id,
  d.full_name,
  d.is_active,
  coalesce(a.total, 0)::bigint as open_advances_base_minor,
  coalesce(e.total, 0)::bigint as open_expenses_base_minor,
  (coalesce(a.total, 0) - coalesce(e.total, 0))::bigint as balance_base_minor,
  coalesce(p.total, 0)::bigint as pending_base_minor,
  coalesce(p.n, 0)::integer as pending_count,
  s.last_settled_on
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
  select sum(x.amount_base_minor) as total, count(*) as n from public.expenses x
  where x.driver_id = d.id and x.status = 'submitted'
) p on true
left join lateral (
  select max(x.settled_on) as last_settled_on from public.driver_settlements x where x.driver_id = d.id
) s on true;

-- ---------------------------------------------------------------------------
-- 7. Trips: one running trip per truck and per driver; status needs readings
-- ---------------------------------------------------------------------------
create unique index trips_one_running_per_truck on public.trips (truck_id) where status = 'in_progress';
create unique index trips_one_running_per_driver on public.trips (driver_id)
  where status = 'in_progress' and driver_id is not null;

create function app.guard_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('in_progress', 'completed') and new.start_odometer is null then
    raise exception 'أدخل قراءة العداد عند بدء الرحلة' using errcode = 'check_violation';
  end if;
  if new.status = 'completed' and (new.end_date is null or new.end_odometer is null) then
    raise exception 'أدخل تاريخ وقراءة العداد عند انتهاء الرحلة' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trips_guard before insert or update on public.trips
  for each row execute function app.guard_trip();

-- Highest odometer reading recorded for a truck, ignoring one trip.
create function app.truck_last_odometer(p_truck_id uuid, p_except_trip uuid default null)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce((select max(greatest(coalesce(x.start_odometer, 0), coalesce(x.end_odometer, 0)))
              from public.trips x
              where x.truck_id = p_truck_id and x.id is distinct from p_except_trip), 0),
    coalesce((select max(f.odometer) from public.fuel_fillups f where f.truck_id = p_truck_id), 0),
    coalesce((select max(w.odometer) from public.work_orders w where w.truck_id = p_truck_id), 0)
  )
$$;

-- A driver starts or finishes their own trip. Runs as the owner so it can
-- touch exactly these columns and nothing else; lives in the unexposed `app`
-- schema and is reached through the public wrapper below.
create function app.driver_trip_action(p_trip_id uuid, p_action text, p_odometer integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := app.user_driver_id();
  t public.trips;
  last_odo integer;
  today date := app.today();
begin
  if me is null then
    raise exception 'هذه العملية للسائقين فقط' using errcode = 'insufficient_privilege';
  end if;
  select * into t from public.trips where id = p_trip_id for update;
  if not found or t.driver_id is distinct from me then
    raise exception 'الرحلة غير موجودة' using errcode = 'no_data_found';
  end if;
  if p_odometer is null or p_odometer < 0 then
    raise exception 'قراءة العداد غير صحيحة' using errcode = 'check_violation';
  end if;

  if p_action = 'start' then
    if t.status <> 'planned' then
      raise exception 'لا يمكن بدء هذه الرحلة لأنها ليست مخططة' using errcode = 'check_violation';
    end if;
    last_odo := app.truck_last_odometer(t.truck_id, t.id);
    if p_odometer < last_odo then
      raise exception 'قراءة العداد أقل من آخر قراءة مسجلة للشاحنة (%)', last_odo using errcode = 'check_violation';
    end if;
    begin
      update public.trips
      set status = 'in_progress', start_odometer = p_odometer, start_date = today
      where id = t.id;
    exception when unique_violation then
      raise exception 'توجد رحلة جارية أخرى لك أو لهذه الشاحنة؛ أنهِها أولاً' using errcode = 'check_violation';
    end;
    return 'in_progress';
  elsif p_action = 'finish' then
    if t.status <> 'in_progress' then
      raise exception 'الرحلة ليست جارية' using errcode = 'check_violation';
    end if;
    if p_odometer < t.start_odometer then
      raise exception 'قراءة العداد عند الانتهاء أقل من قراءة البداية (%)', t.start_odometer using errcode = 'check_violation';
    end if;
    update public.trips
    set status = 'completed', end_odometer = p_odometer, end_date = greatest(today, t.start_date)
    where id = t.id;
    return 'completed';
  end if;

  raise exception 'إجراء غير معروف' using errcode = 'check_violation';
end;
$$;

create function public.driver_trip_action(p_trip_id uuid, p_action text, p_odometer integer)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app.driver_trip_action(p_trip_id, p_action, p_odometer)
$$;

-- ---------------------------------------------------------------------------
-- 8. RLS, grants, audit
-- ---------------------------------------------------------------------------
select app.staff_policies('public.driver_advances',
  '{manager,accountant,dispatcher}', '{manager,accountant}');
create policy driver_advances_driver_read on public.driver_advances for select to authenticated
  using (driver_id = (select app.user_driver_id()));

select app.staff_policies('public.driver_settlements',
  '{manager,accountant,dispatcher}', '{manager,accountant}');
create policy driver_settlements_driver_read on public.driver_settlements for select to authenticated
  using (driver_id = (select app.user_driver_id()));

revoke execute on function
  app.guard_settlement(), app.settling_allows(uuid, uuid), app.guard_advance(), app.guard_expense(),
  app.guard_trip(), app.truck_last_odometer(uuid, uuid), app.driver_trip_action(uuid, text, integer),
  public.settle_driver_advance(uuid, date, text), public.driver_trip_action(uuid, text, integer)
  from public, anon;
-- Trigger helpers run as the signed-in user, so they need EXECUTE.
grant execute on function
  app.settling_allows(uuid, uuid),
  app.driver_trip_action(uuid, text, integer),
  public.settle_driver_advance(uuid, date, text),
  public.driver_trip_action(uuid, text, integer)
  to authenticated;

select app.track('public.driver_advances');
select app.track('public.driver_settlements');
