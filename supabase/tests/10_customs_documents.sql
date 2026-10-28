-- Customs declarations on file (migration 19). Rolled back at the end; needs the seeds.

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
  ('00000000-0000-4000-8000-000000000101', 'cd-manager@example.test'),
  ('00000000-0000-4000-8000-000000000102', 'cd-dispatcher@example.test'),
  ('00000000-0000-4000-8000-000000000103', 'cd-driver@example.test');
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000102';
update public.profiles set role = 'driver', driver_id = (select id from public.drivers order by full_name limit 1)
where user_id = '00000000-0000-4000-8000-000000000103';

create temp table p as
select '00000000-0000-4000-8000-000000000102/2026-10/11111111-1111-4111-8111-111111111111.pdf'::text as path,
       (select id from public.trips where status = 'completed' order by start_date desc limit 1) as trip_id;
grant select on p to authenticated;

select pg_temp.check(
  (select customs_portal_url like 'https://%' from public.company_settings),
  'the customs inquiry link has a default');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000102',
  $q$insert into public.customs_documents (declaration_no, declaration_date, trip_id, file_path, notes)
     select 'CD-2026/1234', current_date, trip_id, path, 'cd test' from p$q$),
  'a dispatcher files a customs declaration on a load');
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-000000000102',
    $q$select count(*) from public.customs_documents where declaration_no = 'CD-2026/1234'$q$) = 1,
  'staff see it');
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-000000000103', 'select count(*) from public.customs_documents') = 0,
  'drivers see no customs documents');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000103',
  $q$insert into public.customs_documents (declaration_no, file_path) select 'X', path from p$q$),
  'drivers cannot file them');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000102',
  $q$insert into public.customs_documents (declaration_no, file_path) values ('X', '../etc/passwd')$q$),
  'the file path must follow the storage layout');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000102',
  $q$insert into public.customs_documents (declaration_no, file_path) select ' X ', path from p$q$),
  'the declaration number is stored trimmed');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000101',
  $q$update public.company_settings set customs_portal_url = 'javascript:alert(1)'$q$),
  'the inquiry link must be an https address');

rollback;
