-- Driver and truck licence scans (migration 21). Rolled back at the end; needs the seeds.

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

create function pg_temp.as_user_count(uid uuid, stmt text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute stmt into n;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return n;
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text), pg_temp.as_user_count(uuid, text) to authenticated;

-- The first user becomes the manager.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000301', 'lc-manager@example.test'),
  ('00000000-0000-4000-8000-000000000302', 'lc-dispatcher@example.test'),
  ('00000000-0000-4000-8000-000000000303', 'lc-accountant@example.test'),
  ('00000000-0000-4000-8000-000000000304', 'lc-driver@example.test');
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000302';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-000000000303';
update public.profiles set role = 'driver', driver_id = (select id from public.drivers order by full_name limit 1)
where user_id = '00000000-0000-4000-8000-000000000304';

create temp table x as
select (select id from public.drivers order by full_name limit 1) as own_driver,
       (select id from public.drivers order by full_name offset 1 limit 1) as other_driver,
       (select id from public.trucks order by code limit 1) as truck_id,
       '00000000-0000-4000-8000-000000000302/2026-10/22222222-2222-4222-8222-222222222222.pdf'::text as path;
grant select on x to authenticated;

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302',
  $q$update public.drivers set license_file_path = (select path from x) where id = (select own_driver from x)$q$),
  'a dispatcher attaches a driver''s licence');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000303',
  $q$update public.drivers set license_file_path = (select path from x) where id = (select other_driver from x)$q$),
  'so does the accountant');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302',
  $q$update public.drivers set license_file_path = '../x.pdf' where id = (select own_driver from x)$q$),
  'the licence path must follow the storage layout');
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-000000000304',
    $q$select count(*) from public.drivers where license_file_path is not null$q$) = 1,
  'a driver sees only his own licence');
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-000000000304',
    $q$with u as (update public.drivers set license_file_path = null where id = (select own_driver from x) returning 1) select count(*) from u$q$) = 0,
  'and cannot change it');

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000302',
  $q$insert into public.truck_documents (truck_id, doc_type, doc_number, expiry_date, file_path)
     select truck_id, 'registration', 'LIC-1', current_date + 365, path from x$q$),
  'a dispatcher attaches a truck''s licence as its registration document');
select pg_temp.check(
  (select expiry_band from public.document_expiry_v where doc_number = 'LIC-1') = 'ok',
  'it counts in the expiry alerts');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000303',
  $q$insert into public.truck_documents (truck_id, doc_type, doc_number) select truck_id, 'registration', 'LIC-2' from x$q$),
  'the accountant does not file truck documents');

rollback;
