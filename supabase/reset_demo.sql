-- Remove all demo data before go-live. Keeps the chart of accounts, expense
-- categories, currencies, settings and user accounts (driver links are
-- cleared). Demo login users must be deleted in Supabase Auth separately.
-- TRUNCATE skips row triggers, so only run this as the database owner.

begin;

truncate
  public.invoice_lines,
  public.invoices,
  public.client_receipts,
  app.voucher_numbers,
  public.driver_advances,
  public.driver_settlements,
  public.journal_lines,
  public.journal_entries,
  public.financing_installments,
  public.truck_financing,
  public.work_order_lines,
  public.work_orders,
  public.fuel_fillups,
  public.expenses,
  public.trips,
  public.tire_installations,
  public.tires,
  public.service_schedules,
  public.truck_documents,
  public.truck_assets
restart identity;

update public.profiles set driver_id = null where driver_id is not null;
delete from public.drivers;
delete from public.trucks;
delete from public.clients;
delete from public.suppliers;
delete from public.locations;

truncate audit.log;

commit;
