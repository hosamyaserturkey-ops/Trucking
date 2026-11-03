-- Migration 27: the driver's pay for each load (أجرة السائق للنقلة).
--
-- The office prices each finished load for its driver by hand (the work
-- varies too much for a fixed rate). The pay is an approved expense on the
-- load, of the kind «أجور ومكافآت السائقين» (5106), charged to the driver's
-- account like an expense he paid from his advance:
--
--   Dr 5106 أجور ومكافآت السائقين (the truck)    Cr 1105 عهد السائقين (the driver)
--
-- So it lowers what the driver holds (or raises what he is owed) at once, is
-- settled with his advances and expenses, and counts in the load's and the
-- truck's profit and in the profit reports, all through the existing rules.
--
-- One pay per load. Its truck, driver, date and description always follow the
-- load; only the amount and the notes are typed. Once settled it can't change,
-- and neither can the load's driver, truck, date or status.

alter table public.expenses add column is_load_pay boolean not null default false;

alter table public.expenses add constraint expenses_load_pay_shape check (
  not is_load_pay
  or (trip_id is not null and driver_id is not null and cost_scope = 'truck'
      and payment_method = 'driver_advance' and status = 'approved' and currency = 'JOD')
);

create unique index expenses_load_pay_trip_key on public.expenses (trip_id) where is_load_pay;

comment on column public.expenses.is_load_pay is
  'The driver''s pay for the load trip_id, priced by hand; charged to the driver''s account (1105).';

-- ---------------------------------------------------------------------------
-- 1. A pay row is always shaped from its load. Fires before the other row
--    triggers (names sort first), so the base amount and checks see the result.
-- ---------------------------------------------------------------------------
create function app.shape_load_pay()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  t record;
  cat uuid;
  -- The load's own edits re-shape its pay through app.sync_load_pay().
  syncing boolean := current_setting('app.load_pay_sync', true) = 'on';
begin
  if tg_op = 'UPDATE' and old.is_load_pay is distinct from new.is_load_pay then
    raise exception 'لا يمكن تحويل أجرة نقلة إلى مصروف عادي أو العكس' using errcode = 'check_violation';
  end if;
  if not new.is_load_pay then
    return new;
  end if;

  if auth.uid() is not null and not syncing and not app.has_role('manager', 'accountant')
     and (tg_op = 'INSERT' or (new.amount_minor, new.notes) is distinct from (old.amount_minor, old.notes)) then
    raise exception 'تسعير النقلات للسائقين للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;

  select x.status, x.truck_id, x.driver_id, x.start_date, x.end_date, x.trip_no, x.client_ref
  into t
  from public.trips x
  where x.id = new.trip_id;
  if not found then
    raise exception 'النقلة غير موجودة' using errcode = 'no_data_found';
  end if;
  if t.status <> 'completed' then
    raise exception 'تُسعّر النقلة للسائق بعد انتهائها' using errcode = 'check_violation';
  end if;
  if t.driver_id is null then
    raise exception 'النقلة بدون سائق' using errcode = 'check_violation';
  end if;

  select c.id into cat from public.expense_categories c where c.code = 'driver_pay';
  if cat is null then
    raise exception 'نوع المصروف «أجور ومكافآت السائقين» (driver_pay) غير موجود' using errcode = 'no_data_found';
  end if;

  new.category_id := cat;
  new.cost_scope := 'truck';
  new.truck_id := t.truck_id;
  new.driver_id := t.driver_id;
  new.supplier_id := null;
  new.expense_date := coalesce(t.end_date, t.start_date);
  new.description := 'أجرة نقلة ' || coalesce(t.client_ref, 'رحلة ' || t.trip_no);
  new.payment_method := 'driver_advance';
  new.status := 'approved';
  new.currency := 'JOD';
  new.fx_rate := 1;
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  return new;
end;
$$;

create trigger expenses_a_load_pay before insert or update on public.expenses
  for each row execute function app.shape_load_pay();

-- Only the office, or the load's own deletion, removes a pay row.
create function app.guard_load_pay_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_load_pay and auth.uid() is not null
     and current_setting('app.load_pay_sync', true) is distinct from 'on'
     and not app.has_role('manager', 'accountant') then
    raise exception 'تسعير النقلات للسائقين للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

create trigger expenses_a_load_pay_delete before delete on public.expenses
  for each row execute function app.guard_load_pay_delete();

-- ---------------------------------------------------------------------------
-- 2. The pay follows its load
-- ---------------------------------------------------------------------------
-- Editing the load (truck, driver, date, reference) re-shapes its pay; a load
-- that is no longer finished or has no driver loses it. A settled pay locks
-- the load's truck, driver, date and status.
create function app.sync_load_pay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay_id uuid;
  settled uuid;
begin
  select e.id, e.settlement_id into pay_id, settled
  from public.expenses e
  where e.trip_id = new.id and e.is_load_pay;
  if pay_id is null then
    return null;
  end if;
  if (new.truck_id, new.driver_id, new.start_date, new.end_date, new.status, new.client_ref)
     is not distinct from (old.truck_id, old.driver_id, old.start_date, old.end_date, old.status, old.client_ref) then
    return null;
  end if;
  if settled is not null then
    if (new.truck_id, new.driver_id, new.start_date, new.end_date, new.status)
       is distinct from (old.truck_id, old.driver_id, old.start_date, old.end_date, old.status) then
      raise exception 'أجرة السائق لهذه النقلة داخلة في تسوية؛ لا يمكن تغيير الشاحنة أو السائق أو التاريخ'
        using errcode = 'check_violation';
    end if;
    return null;
  end if;

  perform set_config('app.load_pay_sync', 'on', true);
  if new.status <> 'completed' or new.driver_id is null then
    delete from public.expenses where id = pay_id;
  else
    update public.expenses set updated_at = now() where id = pay_id;
  end if;
  perform set_config('app.load_pay_sync', '', true);
  return null;
end;
$$;

create trigger trips_load_pay_sync after update on public.trips
  for each row execute function app.sync_load_pay();

-- Deleting a load deletes its pay, unless the pay is settled.
create function app.delete_load_pay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.expenses e where e.trip_id = old.id and e.is_load_pay and e.settlement_id is not null) then
    raise exception 'أجرة السائق لهذه النقلة داخلة في تسوية؛ لا يمكن حذف النقلة' using errcode = 'check_violation';
  end if;
  perform set_config('app.load_pay_sync', 'on', true);
  delete from public.expenses e where e.trip_id = old.id and e.is_load_pay;
  perform set_config('app.load_pay_sync', '', true);
  return old;
end;
$$;

create trigger trips_load_pay_delete before delete on public.trips
  for each row execute function app.delete_load_pay();

-- ---------------------------------------------------------------------------
-- 3. Pricing a load: set, change or clear (0 or null) its driver's pay
-- ---------------------------------------------------------------------------
create function public.set_load_driver_pay(p_trip_id uuid, p_amount_minor bigint, p_notes text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  pay_id uuid;
  settled uuid;
  new_id uuid;
begin
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception 'تسعير النقلات للسائقين للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  if p_amount_minor < 0 then
    raise exception 'المبلغ غير صحيح' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('load_pay:' || p_trip_id::text));

  select e.id, e.settlement_id into pay_id, settled
  from public.expenses e
  where e.trip_id = p_trip_id and e.is_load_pay
  for update;
  if settled is not null then
    raise exception 'أجرة هذه النقلة داخلة في تسوية ولا تُعدّل' using errcode = 'check_violation';
  end if;

  if coalesce(p_amount_minor, 0) = 0 then
    if pay_id is not null then
      delete from public.expenses where id = pay_id;
    end if;
    return null;
  end if;

  if pay_id is not null then
    update public.expenses set amount_minor = p_amount_minor, notes = p_notes where id = pay_id;
    return pay_id;
  end if;

  -- Everything else comes from the load (app.shape_load_pay).
  insert into public.expenses (is_load_pay, trip_id, amount_minor, notes, expense_date, category_id, description, truck_id)
  select true, x.id, p_amount_minor, p_notes, coalesce(x.end_date, x.start_date),
         (select c.id from public.expense_categories c where c.code = 'driver_pay'), 'أجرة نقلة', x.truck_id
  from public.trips x
  where x.id = p_trip_id
  returning id into new_id;
  if new_id is null then
    raise exception 'النقلة غير موجودة' using errcode = 'no_data_found';
  end if;
  return new_id;
end;
$$;

revoke execute on function public.set_load_driver_pay(uuid, bigint, text) from public, anon;
grant execute on function public.set_load_driver_pay(uuid, bigint, text) to authenticated;
revoke execute on function app.shape_load_pay(), app.guard_load_pay_delete(), app.sync_load_pay(), app.delete_load_pay()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A driver's finished loads with their pay, for pricing
-- ---------------------------------------------------------------------------
create view public.driver_loads_v
with (security_invoker = on) as
select
  x.id as trip_id,
  x.trip_no,
  x.driver_id,
  x.truck_id,
  t.code as truck_code,
  x.client_id,
  c.name as client_name,
  x.client_ref,
  x.entry_source,
  x.is_empty_return,
  coalesce(x.end_date, x.start_date) as load_date,
  fl.name as from_name,
  tl.name as to_name,
  x.cargo_description,
  x.cargo_weight_tons,
  x.distance_km,
  x.currency,
  x.freight_minor,
  x.freight_base_minor,
  p.id as pay_id,
  p.amount_minor as pay_minor,
  p.notes as pay_notes,
  p.settlement_id as pay_settlement_id
from public.trips x
join public.trucks t on t.id = x.truck_id
left join public.clients c on c.id = x.client_id
left join public.locations fl on fl.id = x.from_location_id
left join public.locations tl on tl.id = x.to_location_id
left join public.expenses p on p.trip_id = x.id and p.is_load_pay
where x.status = 'completed' and x.driver_id is not null;

comment on view public.driver_loads_v is
  'Finished loads with a driver and the driver''s pay for each (null: not priced yet).';

-- Loads waiting to be priced, per driver: finished since his last settlement
-- (and since the opening date), with no pay yet.
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
  coalesce(pf.n, 0)::integer as pending_fuel_count,
  coalesce(lp.total, 0)::bigint as open_load_pay_base_minor,
  coalesce(lp.n, 0)::integer as open_load_pay_count,
  coalesce(up.n, 0)::integer as unpriced_loads
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
) s on true
left join lateral (
  select sum(x.amount_base_minor) as total, count(*) as n from public.expenses x
  where x.driver_id = d.id and x.settlement_id is null and x.is_load_pay
) lp on true
left join lateral (
  select count(*) as n from public.trips x
  where x.driver_id = d.id and x.status = 'completed'
    and coalesce(x.end_date, x.start_date) > coalesce(s.last_settled_on, '-infinity'::date)
    and coalesce(x.end_date, x.start_date) >= coalesce((select cs.opening_date from public.company_settings cs), '-infinity'::date)
    and not exists (select 1 from public.expenses e2 where e2.trip_id = x.id and e2.is_load_pay)
) up on true;

comment on column public.driver_advance_balance_v.open_expenses_base_minor is
  'Everything charged to the driver''s account and not settled yet: expenses and diesel he paid, and his load pay.';
comment on column public.driver_advance_balance_v.unpriced_loads is
  'Finished loads since his last settlement (and the opening date) with no pay yet.';
