-- Row level security. Roles:
--   manager     everything
--   accountant  reads everything; writes finance, master data, fuel, expenses
--   dispatcher  operations: trucks, drivers, trips, fuel, maintenance, tires, documents
--   driver      only rows tied to their own driver record
--   pending     (role null) nothing
-- anon has no policies anywhere, so it sees nothing.

-- Trucks a driver may see: their default truck and trucks on their trips.
create function app.driver_truck_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.default_truck_id from public.drivers d
  where d.id = app.user_driver_id() and d.default_truck_id is not null
  union
  select x.truck_id from public.trips x where x.driver_id = app.user_driver_id()
$$;

-- ---------------------------------------------------------------------------
-- Reference and settings
-- ---------------------------------------------------------------------------
select app.staff_policies('public.currencies',
  '{manager,accountant,dispatcher,driver}', '{manager}');
select app.staff_policies('public.company_settings',
  '{manager,accountant,dispatcher,driver}', '{manager}');

-- Profiles: everyone reads their own row; managers read and manage all.
alter table public.profiles enable row level security;
create policy profiles_read_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_manager_read on public.profiles for select to authenticated
  using ((select app.has_role('manager')));
create policy profiles_manager_update on public.profiles for update to authenticated
  using ((select app.has_role('manager'))) with check ((select app.has_role('manager')));
create policy profiles_manager_delete on public.profiles for delete to authenticated
  using ((select app.has_role('manager')));

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
select app.staff_policies('public.trucks',
  '{manager,accountant,dispatcher}', '{manager,accountant,dispatcher}');
create policy trucks_driver_read on public.trucks for select to authenticated
  using (id in (select app.driver_truck_ids()));

select app.staff_policies('public.truck_assets',
  '{manager,accountant}', '{manager,accountant}');

select app.staff_policies('public.drivers',
  '{manager,accountant,dispatcher}', '{manager,accountant,dispatcher}');
create policy drivers_driver_read on public.drivers for select to authenticated
  using (id = (select app.user_driver_id()));

select app.staff_policies('public.clients',
  '{manager,accountant,dispatcher}', '{manager,accountant}');
create policy clients_driver_read on public.clients for select to authenticated
  using (id in (
    select x.client_id from public.trips x where x.driver_id = (select app.user_driver_id())
  ));

select app.staff_policies('public.suppliers',
  '{manager,accountant,dispatcher,driver}', '{manager,accountant,dispatcher}');
select app.staff_policies('public.locations',
  '{manager,accountant,dispatcher,driver}', '{manager,accountant,dispatcher}');
select app.staff_policies('public.accounts',
  '{manager,accountant}', '{manager,accountant}');
select app.staff_policies('public.expense_categories',
  '{manager,accountant,dispatcher,driver}', '{manager,accountant}');

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
select app.staff_policies('public.trips',
  '{manager,accountant,dispatcher}', '{manager,dispatcher}');
create policy trips_driver_read on public.trips for select to authenticated
  using (driver_id = (select app.user_driver_id()));

select app.staff_policies('public.fuel_fillups',
  '{manager,accountant,dispatcher}', '{manager,accountant,dispatcher}');
create policy fuel_fillups_driver_read on public.fuel_fillups for select to authenticated
  using (driver_id = (select app.user_driver_id()));
create policy fuel_fillups_driver_insert on public.fuel_fillups for insert to authenticated
  with check (
    driver_id = (select app.user_driver_id())
    and truck_id in (select app.driver_truck_ids())
  );

select app.staff_policies('public.expenses',
  '{manager,accountant,dispatcher}', '{manager,accountant}');
create policy expenses_driver_read on public.expenses for select to authenticated
  using (driver_id = (select app.user_driver_id()));
create policy expenses_driver_insert on public.expenses for insert to authenticated
  with check (
    driver_id = (select app.user_driver_id())
    and cost_scope = 'truck'
    and truck_id in (select app.driver_truck_ids())
  );

select app.staff_policies('public.work_orders',
  '{manager,accountant,dispatcher}', '{manager,dispatcher}');
select app.staff_policies('public.work_order_lines',
  '{manager,accountant,dispatcher}', '{manager,dispatcher}');
select app.staff_policies('public.service_schedules',
  '{manager,accountant,dispatcher}', '{manager,dispatcher}');
select app.staff_policies('public.tires',
  '{manager,accountant,dispatcher}', '{manager,dispatcher}');
select app.staff_policies('public.tire_installations',
  '{manager,accountant,dispatcher}', '{manager,dispatcher}');
select app.staff_policies('public.truck_documents',
  '{manager,accountant,dispatcher}', '{manager,dispatcher}');

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
select app.staff_policies('public.journal_entries',
  '{manager,accountant}', '{manager,accountant}');
select app.staff_policies('public.journal_lines',
  '{manager,accountant}', '{manager,accountant}');
select app.staff_policies('public.truck_financing',
  '{manager,accountant}', '{manager,accountant}');
select app.staff_policies('public.financing_installments',
  '{manager,accountant}', '{manager,accountant}');

-- ---------------------------------------------------------------------------
-- Audit: managers read; nobody writes except the trigger.
-- ---------------------------------------------------------------------------
alter table audit.log enable row level security;
grant select on audit.log to authenticated;
create policy audit_manager_read on audit.log for select to authenticated
  using ((select app.has_role('manager')));

-- Helper functions are for policies and triggers, not for API callers.
revoke execute on all functions in schema app from public, anon;
grant execute on function
  app.user_role(), app.has_role(public.app_role[]), app.user_driver_id(),
  app.today(), app.driver_truck_ids()
  to authenticated;
revoke execute on function public.post_journal_entry(uuid) from public, anon;
revoke execute on function public.reverse_journal_entry(uuid, text, date) from public, anon;
revoke execute on function public.generate_installments(uuid) from public, anon;
grant execute on function public.post_journal_entry(uuid) to authenticated;
grant execute on function public.reverse_journal_entry(uuid, text, date) to authenticated;
grant execute on function public.generate_installments(uuid) to authenticated;
