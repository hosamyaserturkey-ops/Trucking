-- Core: roles, settings, currencies, profiles, helpers, audit log.
-- Every function sets search_path = '' and fully qualifies names.

create schema if not exists app;
create schema if not exists audit;

grant usage on schema app to authenticated;
grant usage on schema audit to authenticated;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('manager', 'accountant', 'dispatcher', 'driver');

-- ---------------------------------------------------------------------------
-- Currencies and company settings
-- ---------------------------------------------------------------------------
create table public.currencies (
  code char(3) primary key,
  name_ar text not null,
  minor_units smallint not null check (minor_units between 0 and 4)
);

comment on table public.currencies is 'Money is stored as bigint in minor units (JOD fils = 3, USD cents = 2).';

insert into public.currencies (code, name_ar, minor_units) values
  ('JOD', 'دينار أردني', 3),
  ('USD', 'دولار أمريكي', 2);

create table public.company_settings (
  id boolean primary key default true check (id),
  company_name text not null default 'شركة النقل',
  base_currency char(3) not null default 'JOD' references public.currencies (code),
  timezone text not null default 'Asia/Amman',
  fuel_anomaly_threshold_pct numeric(5, 2) not null default 15
    check (fuel_anomaly_threshold_pct between 1 and 90),
  overhead_allocation text not null default 'equal'
    check (overhead_allocation in ('equal', 'by_km')),
  updated_at timestamptz not null default now()
);

comment on table public.company_settings is 'Single-row settings table.';

insert into public.company_settings default values;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user). role null = pending, no access.
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  role public.app_role,
  driver_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_driver_role check (driver_id is null or role = 'driver')
);

-- ---------------------------------------------------------------------------
-- Helpers used by RLS policies
-- ---------------------------------------------------------------------------
create function app.user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.user_id = auth.uid()
$$;

create function app.has_role(variadic roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.user_role() = any (roles), false)
$$;

create function app.user_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.driver_id from public.profiles p
  where p.user_id = auth.uid() and p.role = 'driver'
$$;

create function app.today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select s.timezone from public.company_settings s), 'Asia/Amman'))::date
$$;

create function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- New auth user -> profile. The very first user becomes manager; everyone
-- after that is pending until a manager assigns a role.
-- ---------------------------------------------------------------------------
create function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('app.handle_new_user'));
  insert into public.profiles (user_id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when not exists (select 1 from public.profiles) then 'manager'::public.app_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- The company must always keep at least one manager.
create function app.keep_one_manager()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'manager'
     and (tg_op = 'DELETE' or new.role is distinct from 'manager')
     and not exists (
       select 1 from public.profiles p
       where p.role = 'manager' and p.user_id <> old.user_id
     ) then
    raise exception 'لا يمكن إزالة آخر مدير في النظام'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger profiles_keep_one_manager
  before update or delete on public.profiles
  for each row execute function app.keep_one_manager();

-- ---------------------------------------------------------------------------
-- Money: fill <prefix>_base_minor from <prefix>_minor, currency and fx_rate.
-- Trigger argument = column prefix (default 'amount').
-- ---------------------------------------------------------------------------
create function app.set_base_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prefix text := coalesce(tg_argv[0], 'amount');
  rec jsonb := to_jsonb(new);
  amount bigint := (rec ->> (prefix || '_minor'))::bigint;
  cur text := rec ->> 'currency';
  rate numeric := (rec ->> 'fx_rate')::numeric;
  base text;
  cur_units int;
  base_units int;
begin
  select s.base_currency into base from public.company_settings s;
  if cur = base and rate <> 1 then
    raise exception 'سعر الصرف يجب أن يكون 1 لعملة الأساس %', base
      using errcode = 'check_violation';
  end if;
  select c.minor_units into cur_units from public.currencies c where c.code = cur;
  select c.minor_units into base_units from public.currencies c where c.code = base;
  new := jsonb_populate_record(
    new,
    jsonb_build_object(
      prefix || '_base_minor',
      round(amount * rate * power(10::numeric, base_units - cur_units))
    )
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log: insert-only, filled by trigger, readable by managers.
-- ---------------------------------------------------------------------------
create table audit.log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb
);

create index audit_log_table_record_idx on audit.log (table_name, record_id);
create index audit_log_at_idx on audit.log (at desc);

create function audit.capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_j jsonb;
  new_j jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then old_j := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then new_j := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and old_j = new_j then
    return null;
  end if;
  insert into audit.log (user_id, table_name, record_id, action, old_data, new_data)
  values (
    auth.uid(),
    tg_table_name,
    coalesce(new_j ->> 'id', old_j ->> 'id', new_j ->> 'user_id', old_j ->> 'user_id'),
    tg_op,
    old_j,
    new_j
  );
  return null;
end;
$$;

-- Attach the audit trigger (and updated_at trigger when the column exists).
create function app.track(tbl regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  rel text := tbl::text;
  short text := (select c.relname from pg_catalog.pg_class c where c.oid = tbl);
begin
  execute format(
    'create trigger %I after insert or update or delete on %s for each row execute function audit.capture()',
    short || '_audit', rel);
  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = tbl and a.attname = 'updated_at' and not a.attisdropped
  ) and short <> 'profiles' then
    execute format(
      'create trigger %I before update on %s for each row execute function app.touch_updated_at()',
      short || '_touch', rel);
  end if;
end;
$$;

select app.track('public.profiles');
select app.track('public.company_settings');
select app.track('public.currencies');

-- Generate the standard RLS policies for a staff table:
-- read_roles may select, write_roles may insert/update/delete.
create function app.staff_policies(
  tbl regclass,
  read_roles public.app_role[],
  write_roles public.app_role[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  short text := (select c.relname from pg_catalog.pg_class c where c.oid = tbl);
  reads text := array_to_string(array(select quote_literal(r) from unnest(read_roles) r), ',');
  writes text := array_to_string(array(select quote_literal(r) from unnest(write_roles) r), ',');
begin
  execute format('alter table %s enable row level security', tbl);
  if reads <> '' then
    execute format(
      'create policy %I on %s for select to authenticated using ((select app.has_role(%s)))',
      short || '_staff_read', tbl, reads);
  end if;
  if writes <> '' then
    execute format(
      'create policy %I on %s for insert to authenticated with check ((select app.has_role(%s)))',
      short || '_staff_insert', tbl, writes);
    execute format(
      'create policy %I on %s for update to authenticated using ((select app.has_role(%s))) with check ((select app.has_role(%s)))',
      short || '_staff_update', tbl, writes, writes);
    execute format(
      'create policy %I on %s for delete to authenticated using ((select app.has_role(%s)))',
      short || '_staff_delete', tbl, writes);
  end if;
end;
$$;
