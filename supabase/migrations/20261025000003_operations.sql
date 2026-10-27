-- Operations: trips, fuel, expenses, maintenance, tires, documents.
-- Every operational row carries a truck. Expenses may instead be marked
-- 'overhead' and are then allocated across trucks by rule (see views).

-- ---------------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------------
create type public.trip_status as enum ('planned', 'in_progress', 'completed', 'cancelled');

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  trip_no bigint generated always as identity unique,
  truck_id uuid not null references public.trucks (id) on delete restrict,
  driver_id uuid references public.drivers (id) on delete restrict,
  client_id uuid references public.clients (id) on delete restrict,
  from_location_id uuid references public.locations (id) on delete restrict,
  to_location_id uuid references public.locations (id) on delete restrict,
  start_date date not null,
  end_date date,
  status public.trip_status not null default 'planned',
  cargo_description text,
  cargo_weight_tons numeric(8, 2) check (cargo_weight_tons >= 0),
  is_empty_return boolean not null default false,
  start_odometer integer check (start_odometer >= 0),
  end_odometer integer,
  distance_km integer generated always as (end_odometer - start_odometer) stored,
  currency char(3) not null default 'JOD' references public.currencies (code),
  freight_minor bigint not null default 0 check (freight_minor >= 0),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  freight_base_minor bigint not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (end_date is null or end_date >= start_date),
  check (end_odometer is null or end_odometer >= start_odometer),
  check (not is_empty_return or freight_minor = 0)
);

comment on column public.trips.is_empty_return is 'Return leg with no load (no freight). Loaded return legs are normal trips.';

create index trips_truck_date_idx on public.trips (truck_id, start_date);
create index trips_driver_idx on public.trips (driver_id);
create index trips_client_idx on public.trips (client_id);

create trigger trips_base_amount before insert or update on public.trips
  for each row execute function app.set_base_amount('freight');

-- A cost row linked to a trip must belong to the trip's truck.
create function app.check_trip_truck()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trip_id is not null and not exists (
    select 1 from public.trips t where t.id = new.trip_id and t.truck_id = new.truck_id
  ) then
    raise exception 'الرحلة المرتبطة لا تخص نفس الشاحنة'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Diesel fill-ups
-- ---------------------------------------------------------------------------
create table public.fuel_fillups (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks (id) on delete restrict,
  driver_id uuid references public.drivers (id) on delete restrict,
  trip_id uuid references public.trips (id) on delete set null,
  station_id uuid references public.suppliers (id) on delete restrict,
  filled_at timestamptz not null,
  odometer integer not null check (odometer >= 0),
  liters numeric(10, 2) not null check (liters > 0),
  is_full_tank boolean not null default true,
  currency char(3) not null default 'JOD' references public.currencies (code),
  amount_minor bigint not null check (amount_minor >= 0),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  amount_base_minor bigint not null default 0,
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'card', 'credit', 'own_tank')),
  receipt_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index fuel_fillups_truck_time_idx on public.fuel_fillups (truck_id, filled_at);
create index fuel_fillups_trip_idx on public.fuel_fillups (trip_id);
create index fuel_fillups_driver_idx on public.fuel_fillups (driver_id);

create trigger fuel_fillups_base_amount before insert or update on public.fuel_fillups
  for each row execute function app.set_base_amount('amount');
create trigger fuel_fillups_trip_truck before insert or update on public.fuel_fillups
  for each row execute function app.check_trip_truck();

-- ---------------------------------------------------------------------------
-- Expenses (tolls, fines, driver pay, tires bought outside a work order,
-- admin overhead, ...)
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category_id uuid not null references public.expense_categories (id) on delete restrict,
  cost_scope text not null default 'truck' check (cost_scope in ('truck', 'overhead')),
  truck_id uuid references public.trucks (id) on delete restrict,
  trip_id uuid references public.trips (id) on delete set null,
  driver_id uuid references public.drivers (id) on delete restrict,
  supplier_id uuid references public.suppliers (id) on delete restrict,
  description text not null,
  currency char(3) not null default 'JOD' references public.currencies (code),
  amount_minor bigint not null check (amount_minor > 0),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  amount_base_minor bigint not null default 0,
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'bank', 'check', 'credit', 'driver_advance')),
  reference_no text,
  receipt_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint expenses_truck_or_overhead check ((cost_scope = 'truck') = (truck_id is not null)),
  constraint expenses_overhead_no_trip check (cost_scope = 'truck' or trip_id is null)
);

comment on constraint expenses_truck_or_overhead on public.expenses is
  'Every expense belongs to a truck, or is marked overhead and allocated by rule.';

create index expenses_truck_date_idx on public.expenses (truck_id, expense_date);
create index expenses_scope_date_idx on public.expenses (cost_scope, expense_date);
create index expenses_trip_idx on public.expenses (trip_id);
create index expenses_driver_idx on public.expenses (driver_id);

create trigger expenses_base_amount before insert or update on public.expenses
  for each row execute function app.set_base_amount('amount');
create trigger expenses_trip_truck before insert or update on public.expenses
  for each row execute function app.check_trip_truck();

-- ---------------------------------------------------------------------------
-- Maintenance: work orders and their lines
-- ---------------------------------------------------------------------------
create type public.work_order_status as enum ('open', 'closed', 'cancelled');
create type public.work_order_kind as enum ('service', 'repair', 'tires', 'inspection', 'other');

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  wo_no bigint generated always as identity unique,
  truck_id uuid not null references public.trucks (id) on delete restrict,
  workshop_id uuid references public.suppliers (id) on delete restrict,
  kind public.work_order_kind not null default 'repair',
  status public.work_order_status not null default 'open',
  opened_on date not null,
  closed_on date,
  odometer integer check (odometer >= 0),
  description text not null,
  invoice_no text,
  invoice_path text,
  currency char(3) not null default 'JOD' references public.currencies (code),
  fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0),
  total_minor bigint not null default 0,
  total_base_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (closed_on is null or closed_on >= opened_on),
  check (status <> 'closed' or closed_on is not null)
);

create index work_orders_truck_idx on public.work_orders (truck_id, opened_on);

create trigger work_orders_base_amount before insert or update on public.work_orders
  for each row execute function app.set_base_amount('total');

create table public.work_order_lines (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  line_type text not null check (line_type in ('part', 'labor', 'tire', 'other')),
  description text not null,
  part_number text,
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint generated always as (round(quantity * unit_price_minor)::bigint) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index work_order_lines_wo_idx on public.work_order_lines (work_order_id);

-- Keep work_orders.total_minor equal to the sum of its lines.
create function app.sync_work_order_total()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  wo uuid := coalesce(new.work_order_id, old.work_order_id);
begin
  update public.work_orders w
  set total_minor = coalesce((
    select sum(l.line_total_minor) from public.work_order_lines l where l.work_order_id = wo
  ), 0)
  where w.id = wo;
  if tg_op = 'UPDATE' and new.work_order_id <> old.work_order_id then
    update public.work_orders w
    set total_minor = coalesce((
      select sum(l.line_total_minor) from public.work_order_lines l where l.work_order_id = old.work_order_id
    ), 0)
    where w.id = old.work_order_id;
  end if;
  return null;
end;
$$;

create trigger work_order_lines_sync after insert or update or delete on public.work_order_lines
  for each row execute function app.sync_work_order_total();

-- Service schedules (by km and/or by days)
create table public.service_schedules (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks (id) on delete cascade,
  service_name text not null,
  interval_km integer check (interval_km > 0),
  interval_days integer check (interval_days > 0),
  last_done_odometer integer check (last_done_odometer >= 0),
  last_done_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (interval_km is not null or interval_days is not null),
  unique (truck_id, service_name)
);

-- ---------------------------------------------------------------------------
-- Tires
-- ---------------------------------------------------------------------------
create table public.tires (
  id uuid primary key default gen_random_uuid(),
  serial_no text not null unique,
  brand text,
  size text,
  purchase_date date,
  supplier_id uuid references public.suppliers (id) on delete restrict,
  retread_count smallint not null default 0 check (retread_count >= 0),
  status text not null default 'in_stock'
    check (status in ('in_stock', 'installed', 'retreading', 'scrapped')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tire_installations (
  id uuid primary key default gen_random_uuid(),
  tire_id uuid not null references public.tires (id) on delete restrict,
  truck_id uuid not null references public.trucks (id) on delete restrict,
  position_code text not null,
  installed_on date not null,
  installed_odometer integer not null check (installed_odometer >= 0),
  removed_on date,
  removed_odometer integer,
  removal_reason text,
  km_run integer generated always as (removed_odometer - installed_odometer) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (removed_on is null or removed_on >= installed_on),
  check (removed_odometer is null or removed_odometer >= installed_odometer),
  check ((removed_on is null) = (removed_odometer is null))
);

comment on column public.tire_installations.position_code is
  'F-L/F-R steer; D1-LO/D1-LI/D1-RI/D1-RO and D2-.. drive axles; T.. trailer.';

create unique index tire_installations_one_truck on public.tire_installations (tire_id)
  where removed_on is null;
create unique index tire_installations_one_position on public.tire_installations (truck_id, position_code)
  where removed_on is null;

-- ---------------------------------------------------------------------------
-- Truck documents
-- ---------------------------------------------------------------------------
create type public.document_type as enum ('registration', 'insurance', 'inspection', 'permit', 'other');

create table public.truck_documents (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks (id) on delete cascade,
  doc_type public.document_type not null,
  title text,
  doc_number text,
  issuer text,
  issue_date date,
  expiry_date date,
  file_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);

create index truck_documents_truck_idx on public.truck_documents (truck_id, expiry_date);

select app.track('public.trips');
select app.track('public.fuel_fillups');
select app.track('public.expenses');
select app.track('public.work_orders');
select app.track('public.work_order_lines');
select app.track('public.service_schedules');
select app.track('public.tires');
select app.track('public.tire_installations');
select app.track('public.truck_documents');
