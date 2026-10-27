-- Daily loading sheet (migration 14): sheet lines are finished loads without
-- odometer readings, and every load with a customer gets a reference from
-- that customer's own series. Rolled back at the end; needs all three seeds.

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
  return failed;
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'ls-manager@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'ls-accountant@example.test'),
  ('00000000-0000-4000-8000-0000000000e3', 'ls-dispatcher@example.test');
update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-0000000000e1';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-0000000000e2';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-0000000000e3';

-- Two customers with loads, a truck, its driver and two places.
create temp table lx as
select
  (select id from public.clients where is_active order by name limit 1) as client_a,
  (select id from public.clients where is_active order by name offset 1 limit 1) as client_b,
  t.id as truck_id,
  d.id as driver_id,
  (select id from public.locations order by name limit 1) as from_id,
  (select id from public.locations order by name offset 1 limit 1) as to_id
from public.trucks t
join public.drivers d on d.default_truck_id = t.id
where t.code = 'T-07';
grant select on lx to authenticated;

-- A sheet line insert for a customer, with an optional status and reference.
create function pg_temp.sheet(p_client uuid, p_status text default 'completed', p_ref text default null)
returns text language sql as $$
  select format(
    $s$insert into public.trips (entry_source, status, truck_id, driver_id, client_id, from_location_id, to_location_id,
       start_date, cargo_description, cargo_weight_tons, currency, freight_minor, client_doc_no, client_ref, notes)
     values ('sheet', %L, %L, %L, %L, %L, %L, current_date, 'إسمنت', 32.5, 'JOD', 180000, 'BL-778', %L, 'loading sheet test')$s$,
    p_status, lx.truck_id, lx.driver_id, p_client, lx.from_id, lx.to_id, p_ref)
  from lx
$$;

-- Existing loads ----------------------------------------------------------------
select pg_temp.check(
  not exists (select 1 from public.trips where client_id is not null and not is_empty_return and client_ref is null),
  'every existing load with a customer has a reference');
select pg_temp.check(
  not exists (
    select client_id from public.trips where client_ref_no is not null
    group by client_id having count(*) <> max(client_ref_no)),
  'existing loads are numbered 1..n in each customer''s series');
select pg_temp.check(
  not exists (select 1 from public.trips where is_empty_return and client_ref is not null),
  'empty return legs have no reference');
select pg_temp.check(
  (select bool_and(x.client_ref = 'C' || lpad(c.client_no::text, 2, '0') || '-' || lpad(x.client_ref_no::text, 4, '0'))
   from public.trips x join public.clients c on c.id = x.client_id where x.client_ref is not null),
  'customers without a code use C<number>-0001');

-- Writing sheet lines ----------------------------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e3', pg_temp.sheet((select client_a from lx))),
  'a dispatcher adds a sheet line without odometer readings');

create temp table first_line as
select x.* from public.trips x where x.notes = 'loading sheet test' order by x.created_at desc limit 1;

select pg_temp.check((select status = 'completed' and end_date = start_date and start_odometer is null from first_line),
  'a sheet line is a finished load on its date');
select pg_temp.check(
  (select f.client_ref_no = (select max(client_ref_no) from public.trips where client_id = f.client_id) from first_line f),
  'it takes the next number in its customer''s series');
select pg_temp.check(
  exists (select 1 from public.trip_profit_v v join first_line f on f.id = v.trip_id where v.freight_base_minor = 180000),
  'its freight counts in trip profit');

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1', pg_temp.sheet((select client_a from lx))),
  'a manager adds a sheet line');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e2', pg_temp.sheet((select client_a from lx))),
  'an accountant cannot add sheet lines (read only, like trips)');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1', pg_temp.sheet((select client_a from lx), 'planned')),
  'a sheet line cannot be planned or running');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1', format(
  $s$insert into public.trips (status, truck_id, client_id, from_location_id, to_location_id, start_date, end_date, freight_minor)
     values ('completed', %L, %L, %L, %L, current_date, current_date, 1000)$s$,
  (select truck_id from lx), (select client_a from lx), (select from_id from lx), (select to_id from lx))),
  'a normal trip still needs odometer readings to be finished');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1',
  format($s$update public.trips set entry_source = 'trip' where id = %L$s$, (select id from first_line))),
  'a sheet line cannot be turned into a trip');

-- References are set by the database only ----------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1',
  pg_temp.sheet((select client_a from lx), 'completed', 'HACK-0001')), 'insert with a made-up reference');
select pg_temp.check(
  not exists (select 1 from public.trips where client_ref = 'HACK-0001'),
  'a made-up reference is replaced by the next real one');

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1',
  format($s$update public.trips set client_ref = 'X-9', client_ref_no = 999, cargo_weight_tons = 30 where id = %L$s$,
         (select id from first_line))), 'edit a sheet line');
select pg_temp.check(
  (select x.client_ref = f.client_ref and x.cargo_weight_tons = 30 from public.trips x join first_line f on f.id = x.id),
  'editing a line keeps its reference');

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1',
  format($s$update public.trips set client_id = %L where id = %L$s$, (select client_b from lx), (select id from first_line))),
  'move a line to another customer');
select pg_temp.check(
  (select x.client_ref_no = (select max(client_ref_no) from public.trips where client_id = x.client_id)
          and x.client_ref <> f.client_ref
   from public.trips x join first_line f on f.id = x.id),
  'it gets a new number from the new customer''s series');

-- Numbers are never reused
create temp table before_delete as
select max(client_ref_no) as top from public.trips where client_id = (select client_a from lx);
delete from public.trips
where id = (select id from public.trips where client_id = (select client_a from lx) and notes = 'loading sheet test'
            order by client_ref_no desc limit 1);
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1', pg_temp.sheet((select client_a from lx))),
  'add a line after deleting the last one');
select pg_temp.check(
  (select max(client_ref_no) from public.trips where client_id = (select client_a from lx)) = (select top + 1 from before_delete),
  'a deleted line''s number is not given out again');

-- Customer codes ----------------------------------------------------------------
update public.clients set ref_code = ' arb ' where id = (select client_a from lx);
select pg_temp.check((select ref_code = 'ARB' from public.clients where id = (select client_a from lx)),
  'a customer code is stored in capitals without spaces');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000e1', pg_temp.sheet((select client_a from lx))),
  'add a line for a customer with a code');
select pg_temp.check(
  (select client_ref like 'ARB-%' from public.trips where client_id = (select client_a from lx) order by client_ref_no desc limit 1),
  'new references use the customer code');
select pg_temp.check(
  exists (select 1 from public.trips where client_id = (select client_a from lx) and client_ref like 'C%'),
  'older references keep what was printed');

do $$
begin
  begin
    update public.clients set ref_code = 'عرب' where id = (select client_b from lx);
    raise exception 'FAIL: an Arabic code was accepted';
  exception when check_violation then
    raise notice 'PASS: a code must be 2-6 Latin letters or digits';
  end;
  begin
    update public.clients set ref_code = 'arb' where id = (select client_b from lx);
    raise exception 'FAIL: a duplicate code was accepted';
  exception when unique_violation then
    raise notice 'PASS: two customers cannot share a code';
  end;
end;
$$;

rollback;
