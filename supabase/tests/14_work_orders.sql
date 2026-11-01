-- Maintenance work orders: open, lines, close with the workshop's invoice, posting (migration 23).
-- Rolled back at the end; needs the seeds.

begin;

create function pg_temp.check(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end;
$$;

create function pg_temp.as_user_raises(uid uuid, stmt text) returns boolean
language plpgsql as $$
declare
  failed boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute stmt;
  exception when others then
    failed := true;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return failed;
end;
$$;

create function pg_temp.as_user(uid uuid, stmt text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute stmt;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text), pg_temp.as_user(uuid, text) to authenticated;

create function pg_temp.live(p_id uuid) returns setof public.journal_entries
language sql as $$
  select * from public.journal_entries e
  where e.source_type = 'work_order' and e.source_id = p_id and e.status = 'posted' and e.reverses_entry_id is null
$$;

create function pg_temp.bal(p_code text, p_supplier uuid default null) returns bigint
language sql as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
  from public.journal_lines l join public.accounts a on a.id = l.account_id
  where a.code = p_code and (p_supplier is null or l.supplier_id = p_supplier)
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000301', 'wo-manager@example.test'),
  ('00000000-0000-4000-8000-000000000302', 'wo-accountant@example.test'),
  ('00000000-0000-4000-8000-000000000303', 'wo-dispatcher@example.test');
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-000000000302';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000303';

-- What the seed left ------------------------------------------------------------------
select pg_temp.check(
  (select count(*) from public.work_orders where status = 'closed') > 0
  and not exists (
    select 1 from public.work_orders w
    where w.status = 'closed'
      and (select count(*) from pg_temp.live(w.id)) <> 1
  ),
  'every closed work order has one posted entry');
select pg_temp.check(
  not exists (
    select 1 from public.work_orders w
    join pg_temp.live(w.id) e on true
    where (select sum(l.debit_minor) from public.journal_lines l where l.entry_id = e.id) <> w.total_base_minor
       or e.entry_date <> w.closed_on
  ),
  'each entry carries the order''s total on the day it closed');
select pg_temp.check(
  not exists (select 1 from public.work_orders w where w.status = 'open' and exists (select 1 from pg_temp.live(w.id))),
  'open orders are not posted');
select pg_temp.check(
  (select coalesce(sum(amount_base_minor), 0) from public.truck_pnl_facts_v where kind = 'maintenance')
  = (select coalesce(sum(total_base_minor), 0) from public.work_orders where status = 'closed'),
  'truck profit counts closed orders only');

-- A new order ---------------------------------------------------------------------------
create temp table ctx as
select (select id from public.trucks where code = 'T-02') as truck_id,
       (select id from public.suppliers where kind = 'workshop' order by name limit 1) as workshop_id,
       (select max(odometer) from public.truck_overview_v where code = 'T-02') as odo;
grant select on ctx to authenticated;

select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000303', $q$
    insert into public.work_orders (truck_id, workshop_id, kind, status, opened_on, closed_on, description)
    select truck_id, workshop_id, 'repair', 'closed', current_date, current_date, 'x' from ctx
  $q$),
  'an order cannot be created already closed');

select pg_temp.as_user('00000000-0000-4000-8000-000000000303', $q$
  insert into public.work_orders (id, truck_id, workshop_id, kind, opened_on, odometer, description)
  select '00000000-0000-4000-8000-0000000003a1', truck_id, workshop_id, 'service', current_date - 3, odo + 100,
         'صيانة اختبار: زيت وإطارات' from ctx
$q$);
select pg_temp.as_user('00000000-0000-4000-8000-000000000303', $q$
  insert into public.work_order_lines (work_order_id, line_type, description, quantity, unit_price_minor) values
    ('00000000-0000-4000-8000-0000000003a1', 'part', 'زيت محرك', 40, 3250),
    ('00000000-0000-4000-8000-0000000003a1', 'labor', 'أجور', 1, 25000),
    ('00000000-0000-4000-8000-0000000003a1', 'tire', 'إطار أمامي', 2, 180000)
$q$);
select pg_temp.check(
  (select total_minor from public.work_orders where id = '00000000-0000-4000-8000-0000000003a1') = 40 * 3250 + 25000 + 360000,
  'a dispatcher opens an order and adds its lines; the total follows');
select pg_temp.check(
  (select status from public.truck_overview_v where code = 'T-02') = 'workshop',
  'the truck shows in the workshop');
select pg_temp.check(not exists (select 1 from pg_temp.live('00000000-0000-4000-8000-0000000003a1')), 'nothing is posted while it is open');

select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000303', $q$
    select public.close_work_order('00000000-0000-4000-8000-0000000003a1', current_date, 'credit')
  $q$),
  'a dispatcher cannot close it');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000303', $q$
    update public.work_orders set status = 'closed', closed_on = current_date, payment_method = 'credit'
    where id = '00000000-0000-4000-8000-0000000003a1'
  $q$),
  'not even by writing the row');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302', $q$
    select public.close_work_order('00000000-0000-4000-8000-0000000003a1', current_date - 10, 'credit')
  $q$),
  'it cannot close before it opened');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302', format($q$
    select public.close_work_order('00000000-0000-4000-8000-0000000003a1', current_date, 'credit', null, null, null,
      array[(select id from public.service_schedules where truck_id <> %L limit 1)])
  $q$, (select truck_id from ctx))),
  'a service of another truck cannot be marked done on it');

create temp table before_close as
select pg_temp.bal('2101', (select workshop_id from ctx)) as workshop_bal,
       (select id from public.service_schedules s where s.truck_id = (select truck_id from ctx)
        and s.service_name = 'تغيير زيت المحرك والفلاتر') as oil_id;
grant select on before_close to authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-000000000302', $q$
  select public.close_work_order('00000000-0000-4000-8000-0000000003a1', current_date, 'credit', 'WS-7781', null, null,
    array[(select oil_id from before_close)])
$q$);
select pg_temp.check(
  (select status = 'closed' and invoice_no = 'WS-7781' and closed_by = '00000000-0000-4000-8000-000000000302'
   from public.work_orders where id = '00000000-0000-4000-8000-0000000003a1'),
  'the accountant closes it with the workshop''s invoice');
select pg_temp.check(
  (select count(*) from public.journal_lines l join pg_temp.live('00000000-0000-4000-8000-0000000003a1') e on e.id = l.entry_id
   join public.accounts a on a.id = l.account_id
   where (a.code = '5102' and l.debit_minor = 40 * 3250 + 25000 and l.truck_id = (select truck_id from ctx))
      or (a.code = '5103' and l.debit_minor = 360000 and l.truck_id = (select truck_id from ctx))
      or (a.code = '2101' and l.credit_minor = 40 * 3250 + 25000 + 360000 and l.supplier_id = (select workshop_id from ctx))) = 3,
  'posted: Dr maintenance and tires on the truck, Cr the workshop');
select pg_temp.check(
  pg_temp.bal('2101', (select workshop_id from ctx)) = (select workshop_bal from before_close) - (40 * 3250 + 25000 + 360000),
  'the workshop is owed the invoice');
select pg_temp.check(
  (select last_done_on = current_date and last_done_odometer = (select odo + 100 from ctx)
          and last_work_order_id = '00000000-0000-4000-8000-0000000003a1'
   from public.service_schedules where id = (select oil_id from before_close)),
  'the oil change is marked done at the order''s odometer and date');
select pg_temp.check(
  (select sum(amount_base_minor) from public.truck_pnl_facts_v
   where source_id = '00000000-0000-4000-8000-0000000003a1' and kind = 'maintenance' and fact_date = current_date) = 40 * 3250 + 25000 + 360000,
  'it counts in the truck''s profit on the day it closed');

-- Closed means closed --------------------------------------------------------------------
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302', $q$
    insert into public.work_order_lines (work_order_id, line_type, description, quantity, unit_price_minor)
    values ('00000000-0000-4000-8000-0000000003a1', 'part', 'x', 1, 1000)
  $q$),
  'no lines are added to a closed order');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000301', $q$
    update public.work_order_lines set unit_price_minor = 1 where work_order_id = '00000000-0000-4000-8000-0000000003a1'
  $q$),
  'its lines do not change');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000301', $q$
    update public.work_orders set payment_method = 'cash' where id = '00000000-0000-4000-8000-0000000003a1'
  $q$),
  'nor how it was paid');
select pg_temp.as_user('00000000-0000-4000-8000-000000000303', $q$
  update public.work_orders set notes = 'تم الاستلام' where id = '00000000-0000-4000-8000-0000000003a1'
$q$);
select pg_temp.check(
  (select notes = 'تم الاستلام' from public.work_orders where id = '00000000-0000-4000-8000-0000000003a1')
  and (select count(*) from public.journal_entries where source_type = 'work_order' and source_id = '00000000-0000-4000-8000-0000000003a1') = 1,
  'notes can still be added, without re-posting');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000301', $q$
    delete from public.work_orders where id = '00000000-0000-4000-8000-0000000003a1'
  $q$),
  'a closed order cannot be deleted');

-- Reopen and close again in cash ----------------------------------------------------------
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000303', $q$
    update public.work_orders set status = 'open' where id = '00000000-0000-4000-8000-0000000003a1'
  $q$),
  'a dispatcher cannot reopen it');
select pg_temp.as_user('00000000-0000-4000-8000-000000000301', $q$
  update public.work_orders set status = 'open' where id = '00000000-0000-4000-8000-0000000003a1'
$q$);
select pg_temp.check(
  not exists (select 1 from pg_temp.live('00000000-0000-4000-8000-0000000003a1'))
  and pg_temp.bal('2101', (select workshop_id from ctx)) = (select workshop_bal from before_close),
  'reopening reverses its entry');
select pg_temp.as_user('00000000-0000-4000-8000-000000000303', $q$
  delete from public.work_order_lines where work_order_id = '00000000-0000-4000-8000-0000000003a1' and line_type = 'labor'
$q$);
select pg_temp.as_user('00000000-0000-4000-8000-000000000301', $q$
  select public.close_work_order('00000000-0000-4000-8000-0000000003a1', current_date, 'cash', null, 'WO-V-1')
$q$);
select pg_temp.check(
  (select count(*) from public.journal_lines l join pg_temp.live('00000000-0000-4000-8000-0000000003a1') e on e.id = l.entry_id
   join public.accounts a on a.id = l.account_id
   where a.code = '1101' and l.credit_minor = 40 * 3250 + 360000 and l.supplier_id is null) = 1,
  'closed again, paid in cash: Cr the cash box');
select pg_temp.check(
  (select voucher_no from public.ledger_lines_v l where l.source_type = 'work_order'
     and l.source_id = '00000000-0000-4000-8000-0000000003a1' and l.reverses_entry_id is null and l.account_code = '1101'
     and l.status = 'posted') = 'WO-V-1',
  'the ledger shows its voucher number');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302', $q$
    insert into public.expenses (expense_date, category_id, truck_id, description, amount_minor, voucher_no)
    select current_date, (select id from public.expense_categories where code = 'operating'), truck_id, 'x', 1000, 'WO-V-1' from ctx
  $q$),
  'its voucher number cannot be used again');

-- Cancelled orders ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000303', $q$
  insert into public.work_orders (id, truck_id, kind, opened_on, description)
  select '00000000-0000-4000-8000-0000000003a2', truck_id, 'repair', current_date, 'فحص كهرباء' from ctx
$q$);
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000303', $q$
    update public.work_orders set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000003a2'
  $q$),
  'cancelling needs a reason');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302', $q$
    select public.close_work_order('00000000-0000-4000-8000-0000000003a2', current_date, 'cash')
  $q$),
  'an order with no lines cannot be closed');
select pg_temp.as_user('00000000-0000-4000-8000-000000000303', $q$
  update public.work_orders set status = 'cancelled', cancel_reason = 'فُتح بالخطأ' where id = '00000000-0000-4000-8000-0000000003a2'
$q$);
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000301', $q$
    update public.work_orders set status = 'open' where id = '00000000-0000-4000-8000-0000000003a2'
  $q$),
  'a cancelled order stays cancelled');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302', $q$
    select public.close_work_order('00000000-0000-4000-8000-0000000003a1', current_date, 'credit')
  $q$),
  'a closed order cannot be closed twice');

-- An open order opened by mistake can be deleted, with its lines.
select pg_temp.as_user('00000000-0000-4000-8000-000000000303', $q$
  insert into public.work_orders (id, truck_id, kind, opened_on, description)
  select '00000000-0000-4000-8000-0000000003a3', truck_id, 'other', current_date, 'خطأ' from ctx;
  insert into public.work_order_lines (work_order_id, line_type, description, quantity, unit_price_minor)
  values ('00000000-0000-4000-8000-0000000003a3', 'labor', 'x', 1, 1000);
  delete from public.work_orders where id = '00000000-0000-4000-8000-0000000003a3'
$q$);
select pg_temp.check(
  not exists (select 1 from public.work_orders where id = '00000000-0000-4000-8000-0000000003a3'),
  'an open order can be deleted with its lines');

select pg_temp.check(
  not exists (
    select 1 from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
    where e.status <> 'draft' group by e.id having sum(l.debit_minor) <> sum(l.credit_minor)),
  'the journal still balances');
select pg_temp.check(
  (select sum(closing_minor) from public.trial_balance('2000-01-01', current_date + 1)) = 0,
  'the trial balance closes at zero');

rollback;
