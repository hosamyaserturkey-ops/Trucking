-- Indexes for foreign keys used in joins and filters (Supabase performance
-- advisor). Currency foreign keys are left out: currencies is a tiny lookup.

create index if not exists trips_from_location_idx on public.trips (from_location_id);
create index if not exists trips_to_location_idx on public.trips (to_location_id);
create index if not exists expenses_category_idx on public.expenses (category_id);
create index if not exists expenses_supplier_idx on public.expenses (supplier_id);
create index if not exists fuel_fillups_station_idx on public.fuel_fillups (station_id);
create index if not exists work_orders_workshop_idx on public.work_orders (workshop_id);
create index if not exists truck_financing_truck_idx on public.truck_financing (truck_id);
create index if not exists drivers_default_truck_idx on public.drivers (default_truck_id);
create index if not exists accounts_parent_idx on public.accounts (parent_id);
create index if not exists tires_supplier_idx on public.tires (supplier_id);
create index if not exists expense_categories_account_idx on public.expense_categories (account_id);
