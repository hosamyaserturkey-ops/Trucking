-- Migration 14: daily loading sheet (كشف التحميل اليومي).
--
-- The office enters each load as one line: date, truck, driver, customer,
-- from/to, cargo, weight, freight and the customer's own document number. A
-- line is stored as a completed trip with entry_source = 'sheet', so its
-- freight counts in truck profit and fleet totals like any trip, but it needs
-- no start/finish steps and no odometer readings.
--
-- Every load with a customer gets an internal reference number from that
-- customer's own series: <customer code>-0001, -0002, ... The code is a short
-- code set on the customer (e.g. ARB); customers without one use C<number>.

-- ---------------------------------------------------------------------------
-- 1. Customers: a number and an optional short code for references
-- ---------------------------------------------------------------------------
alter table public.clients
  add column client_no integer generated always as identity,
  add column ref_code text;

alter table public.clients
  add constraint clients_client_no_key unique (client_no),
  add constraint clients_ref_code_key unique (ref_code),
  add constraint clients_ref_code_format check (ref_code ~ '^[A-Z0-9]{2,6}$');

comment on column public.clients.ref_code is
  'Short code that starts this customer''s internal load references, e.g. ARB -> ARB-0001. Empty: C<client_no>.';

-- Codes are stored in capitals without spaces, so "arb " and "ARB" are the same code.
create function app.normalize_client_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.ref_code := nullif(upper(btrim(coalesce(new.ref_code, ''))), '');
  return new;
end;
$$;

create trigger clients_normalize_code before insert or update on public.clients
  for each row execute function app.normalize_client_code();

-- ---------------------------------------------------------------------------
-- 2. Trips: where the row came from, the customer's document, the reference
-- ---------------------------------------------------------------------------
alter table public.trips
  add column entry_source text not null default 'trip',
  add column client_doc_no text,
  add column client_ref_no integer,
  add column client_ref text;

alter table public.trips
  add constraint trips_entry_source_check check (entry_source in ('trip', 'sheet')),
  add constraint trips_client_doc_no_length check (char_length(client_doc_no) <= 60),
  add constraint trips_client_ref_pair check ((client_ref is null) = (client_ref_no is null));

comment on column public.trips.entry_source is
  'trip: planned, started and finished with odometer readings. sheet: one line on the daily loading sheet.';
comment on column public.trips.client_ref is
  'Internal reference from the customer''s own series, e.g. ARB-0007. Set by the database, never by the app.';

create unique index trips_client_ref_no_key on public.trips (client_id, client_ref_no) where client_ref_no is not null;
create index trips_source_date_idx on public.trips (entry_source, start_date);

-- Last reference number given out per customer. Numbers are never reused,
-- even when a load is deleted, so a printed reference always means one load.
create table app.client_ref_counters (
  client_id uuid primary key references public.clients (id) on delete cascade,
  last_no integer not null check (last_no >= 0)
);
-- Only the trigger below (security definer) touches it.
alter table app.client_ref_counters enable row level security;

-- Number the loads that already exist, oldest first, per customer.
with numbered as (
  select x.id,
         row_number() over (partition by x.client_id order by x.start_date, x.trip_no) as n,
         coalesce(c.ref_code, 'C' || lpad(c.client_no::text, 2, '0')) as prefix
  from public.trips x
  join public.clients c on c.id = x.client_id
  where not x.is_empty_return
)
update public.trips x
set client_ref_no = n.n,
    client_ref = n.prefix || '-' || lpad(n.n::text, 4, '0')
from numbered n
where n.id = x.id;

insert into app.client_ref_counters (client_id, last_no)
select client_id, max(client_ref_no)
from public.trips
where client_ref_no is not null
group by client_id;

-- Give a load its reference: on insert, and again from the new customer's
-- series if the customer changes. Otherwise the reference never changes.
create function app.assign_client_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  prefix text;
begin
  if new.client_id is null or new.is_empty_return then
    new.client_ref_no := null;
    new.client_ref := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id and old.client_ref_no is not null then
    new.client_ref_no := old.client_ref_no;
    new.client_ref := old.client_ref;
    return new;
  end if;

  insert into app.client_ref_counters as k (client_id, last_no)
  values (new.client_id, 1)
  on conflict (client_id) do update set last_no = k.last_no + 1
  returning k.last_no into n;

  select coalesce(c.ref_code, 'C' || lpad(c.client_no::text, 2, '0')) into prefix
  from public.clients c
  where c.id = new.client_id;

  new.client_ref_no := n;
  new.client_ref := prefix || '-' || lpad(n::text, 4, '0');
  return new;
end;
$$;

revoke all on function app.assign_client_ref() from public, anon, authenticated;

create trigger trips_client_ref before insert or update on public.trips
  for each row execute function app.assign_client_ref();

-- ---------------------------------------------------------------------------
-- 3. Trip rules: a sheet line is a finished load without odometer readings
-- ---------------------------------------------------------------------------
create or replace function app.guard_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.entry_source is distinct from old.entry_source then
    raise exception 'لا يمكن تحويل الرحلة إلى سطر في كشف التحميل أو العكس' using errcode = 'check_violation';
  end if;

  if new.entry_source = 'sheet' then
    if new.status <> 'completed' then
      raise exception 'سطر كشف التحميل يُسجَّل كنقلة منتهية' using errcode = 'check_violation';
    end if;
    new.end_date := new.start_date;
    return new;
  end if;

  if new.status in ('in_progress', 'completed') and new.start_odometer is null then
    raise exception 'أدخل قراءة العداد عند بدء الرحلة' using errcode = 'check_violation';
  end if;
  if new.status = 'completed' and (new.end_date is null or new.end_odometer is null) then
    raise exception 'أدخل تاريخ وقراءة العداد عند انتهاء الرحلة' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
