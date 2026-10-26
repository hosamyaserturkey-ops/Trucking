-- File rules (migration 11): path layout, a driver's own folder, and receipts
-- frozen once reviewed or settled. Rolled back at the end; needs both seeds.

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

-- Runs a statement as a given user and reports whether it raised.
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
  return failed;
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'f-manager@example.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'f-accountant@example.test'),
  ('00000000-0000-4000-8000-0000000000c3', 'f-dispatcher@example.test'),
  ('00000000-0000-4000-8000-0000000000c4', 'f-driver@example.test');
update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-0000000000c1';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-0000000000c2';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-0000000000c3';
update public.profiles
set role = 'driver',
    driver_id = (
      select d.id from public.drivers d join public.trucks t on t.id = d.default_truck_id
      where t.code = 'T-04' and d.id not in (select p.driver_id from public.profiles p where p.driver_id is not null)
    )
where user_id = '00000000-0000-4000-8000-0000000000c4';

-- Paths: the driver's own folder, someone else's, and one outside the layout.
create temp table f as
select
  p.driver_id,
  d.default_truck_id as truck_id,
  (select id from public.expense_categories where code = 'meals') as meals,
  '00000000-0000-4000-8000-0000000000c4/2026-10/11111111-1111-4111-8111-111111111111.jpg'::text as own_path,
  '00000000-0000-4000-8000-0000000000c4/2026-10/22222222-2222-4222-8222-222222222222.pdf'::text as own_path2,
  '00000000-0000-4000-8000-0000000000c1/2026-10/33333333-3333-4333-8333-333333333333.jpg'::text as other_path,
  '../00000000-0000-4000-8000-0000000000c4/x.jpg'::text as bad_path
from public.profiles p
join public.drivers d on d.id = p.driver_id
where p.user_id = '00000000-0000-4000-8000-0000000000c4';
grant select on f to authenticated;

create function pg_temp.driver_expense(path text) returns text
language sql as $$
  select format(
    $s$insert into public.expenses (expense_date, category_id, cost_scope, truck_id, driver_id, description,
       amount_minor, payment_method, status, receipt_path)
     values (current_date, %L, 'truck', %L, %L, 'file rules test', 5000, 'driver_advance', 'submitted', %L)$s$,
    f.meals, f.truck_id, f.driver_id, path)
  from f
$$;

-- Driver: own folder only ------------------------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c4', pg_temp.driver_expense((select own_path from f))),
  'driver saves a receipt from his own folder');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c4', pg_temp.driver_expense((select other_path from f))),
  'driver cannot save a receipt from another user''s folder');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c4', pg_temp.driver_expense((select bad_path from f))),
  'driver cannot save a path outside the layout');

create temp table mine as
select id from public.expenses where description = 'file rules test' and receipt_path = (select own_path from f);
grant select on mine to authenticated;
select pg_temp.check((select count(*) from mine) = 1, 'the driver''s expense with receipt was saved');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c4',
  format('update public.expenses set receipt_path = %L where id = %L', (select other_path from f), (select id from mine))),
  'driver cannot switch his receipt to another user''s folder');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c4',
  format('update public.expenses set receipt_path = %L where id = %L', (select own_path2 from f), (select id from mine))),
  'driver can replace his receipt while the expense waits');

-- Staff: layout enforced for every table ---------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c2',
  format('update public.expenses set receipt_path = %L where id = %L', (select bad_path from f), (select id from mine))),
  'accountant cannot store a path outside the layout');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c3',
  format('update public.truck_documents set file_path = %L where id = (select id from public.truck_documents limit 1)', (select bad_path from f))),
  'truck document path must match the layout');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c3',
  format('update public.truck_documents set file_path = %L where id = (select id from public.truck_documents limit 1)', (select other_path from f))),
  'dispatcher can attach a scan to a truck document');
select pg_temp.check(exists (select 1 from public.truck_documents where file_path = (select other_path from f)),
  'the scan path was stored on the document');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c4',
  format($s$insert into public.fuel_fillups (truck_id, driver_id, filled_at, odometer, liters, amount_minor, payment_method, receipt_path)
            values (%L, %L, now(), 9999999, 10, 1000, 'driver_advance', %L)$s$, (select truck_id from f), (select driver_id from f), (select other_path from f))),
  'driver cannot save a fill-up receipt from another user''s folder');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c4',
  format($s$insert into public.fuel_fillups (truck_id, driver_id, filled_at, odometer, liters, amount_minor, payment_method, receipt_path)
            values (%L, %L, now(), 9999999, 10, 1000, 'driver_advance', %L)$s$, (select truck_id from f), (select driver_id from f), (select own_path from f))),
  'the same fill-up with a receipt from his own folder is accepted');

-- Reviewed or settled: receipt frozen ------------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c2',
  format('update public.expenses set status = ''approved'' where id = %L', (select id from mine))),
  'accountant approves the driver''s expense');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c2',
  format('update public.expenses set receipt_path = %L where id = %L', (select own_path from f), (select id from mine))),
  'after review the receipt cannot be replaced');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c1',
  format('update public.expenses set receipt_path = null where id = %L', (select id from mine))),
  'after review the receipt cannot be removed, even by the manager');
select pg_temp.check((select receipt_path from public.expenses where id = (select id from mine)) = (select own_path2 from f),
  'the reviewed expense still points at its receipt');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c1',
  format('update public.expenses set receipt_path = %L where id = (select id from public.expenses where settlement_id is not null limit 1)',
         (select other_path from f))),
  'a settled expense cannot get a different receipt');

-- Office expense (approved on entry, never reviewed): file can still be fixed until settled.
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000c2',
  format('update public.expenses set receipt_path = %L where id = (select id from public.expenses where settlement_id is null and reviewed_at is null and status = ''approved'' and driver_id is null limit 1)',
         (select other_path from f))),
  'an unsettled office expense can get its receipt attached');
select pg_temp.check(exists (select 1 from public.expenses where receipt_path = (select other_path from f) and driver_id is null),
  'the office expense now points at its receipt');

rollback;
