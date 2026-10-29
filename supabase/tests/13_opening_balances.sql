-- Opening balances (migration 22). Rolled back at the end; needs the seeds.

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

create function pg_temp.live() returns setof public.journal_entries
language sql as $$
  select * from public.journal_entries e
  where e.source_type = 'opening' and e.status = 'posted' and e.reverses_entry_id is null
$$;

-- Balance (debit - credit) of an account, optionally for one party.
create function pg_temp.bal(p_code text, p_client uuid default null, p_supplier uuid default null, p_driver uuid default null) returns bigint
language sql as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
  from public.journal_lines l join public.accounts a on a.id = l.account_id
  where a.code = p_code and (p_client is null or l.client_id = p_client)
    and (p_supplier is null or l.supplier_id = p_supplier) and (p_driver is null or l.driver_id = p_driver)
$$;

-- The first user becomes the manager.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000401', 'ob-manager@example.test'),
  ('00000000-0000-4000-8000-000000000402', 'ob-accountant@example.test'),
  ('00000000-0000-4000-8000-000000000403', 'ob-dispatcher@example.test');
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-000000000402';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000403';

create temp table x as
select (select id from public.clients order by name limit 1) as client_id,
       (select id from public.suppliers order by name limit 1) as supplier_id,
       (select id from public.drivers order by full_name limit 1) as driver_id,
       (select id from public.accounts where code = '1101') as cash,
       (select id from public.accounts where code = '1102') as bank,
       (select id from public.accounts where code = '2201') as loans,
       (select id from public.accounts where code = '1103') as customers,
       app.today() - 3 as d;
grant select on x to authenticated;

-- The date comes first -----------------------------------------------------------------
select pg_temp.check((select opening_date from public.company_settings) is null, 'no opening date to start with');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000402',
  $q$insert into public.opening_balances (kind, account_id, debit_minor) select 'account', cash, 1000 from x$q$),
  'no opening balance before the opening date is set');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000403',
  $q$select public.set_opening_date((select d from x))$q$),
  'a dispatcher cannot set the opening date');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000402',
  $q$select public.set_opening_date((select d from x))$q$),
  'the accountant sets the opening date');

create temp table before as
select (select balance_minor from public.client_balance_v where client_id = (select client_id from x)) as client_bal,
       (select balance_minor from public.supplier_balance_v where supplier_id = (select supplier_id from x)) as supplier_bal,
       (select coalesce(balance_base_minor, 0) from public.driver_advance_balance_v where driver_id = (select driver_id from x)) as driver_bal,
       pg_temp.bal('3101') as capital, pg_temp.bal('1104') as cheques, pg_temp.bal('2102') as issued;

-- Accounts, a customer and a supplier ---------------------------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000402',
  $q$insert into public.opening_balances (kind, account_id, debit_minor, credit_minor) select 'account', cash, 5000000, 0 from x
     union all select 'account', bank, 20000000, 0 from x
     union all select 'account', loans, 0, 15000000 from x$q$),
  'the accountant enters cash, bank and a loan');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000402',
  $q$insert into public.opening_balances (kind, account_id, debit_minor) select 'account', customers, 1000 from x$q$),
  'customer balances are not entered as a plain account');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000402',
  $q$insert into public.opening_balances (kind, account_id, debit_minor) select 'account', cash, 1000 from x$q$),
  'one balance per account');
insert into public.opening_balances (kind, client_id, debit_minor) select 'client', client_id, 3000000 from x;
insert into public.opening_balances (kind, supplier_id, credit_minor) select 'supplier', supplier_id, 2000000 from x;

select pg_temp.check(
  (select count(*) from pg_temp.live()) = 1
  and (select entry_date from pg_temp.live()) = (select d from x)
  and (select sum(l.debit_minor) = sum(l.credit_minor) from public.journal_lines l where l.entry_id = (select id from pg_temp.live())),
  'one balanced opening entry on the opening date');
select pg_temp.check(
  pg_temp.bal('3101') = (select capital from before) - (5000000 + 20000000 + 3000000 - 15000000 - 2000000),
  'what is left over goes to capital');
select pg_temp.check(
  (select balance_minor from public.client_balance_v where client_id = (select client_id from x)) = (select client_bal from before) + 3000000
  and (select opening_minor from public.client_balance_v where client_id = (select client_id from x)) = 3000000
  and (select balance_minor from public.client_balance_v where client_id = (select client_id from x)) = pg_temp.bal('1103', (select client_id from x)),
  'the customer owes his opening balance, and the ledger agrees');
select pg_temp.check(
  exists (select 1 from public.client_statement_v v where v.client_id = (select client_id from x) and v.kind = 'opening'
          and v.entry_date = (select d from x) and v.debit_minor = 3000000),
  'his statement starts with the opening balance');
select pg_temp.check(
  (select balance_minor from public.supplier_balance_v where supplier_id = (select supplier_id from x)) = (select supplier_bal from before) + 2000000,
  'the supplier is owed his opening balance');

update public.opening_balances set debit_minor = 3500000 where kind = 'client';
select pg_temp.check(
  (select count(*) from pg_temp.live()) = 1
  and pg_temp.bal('1103', (select client_id from x)) = (select balance_minor from public.client_balance_v where client_id = (select client_id from x)),
  'a corrected balance re-posts the opening entry');

-- Cheques and advances held on the opening date -------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000402',
  $q$insert into public.client_receipts (client_id, received_on, method, amount_minor, cheque_no, cheque_due_date, cheque_status, is_opening)
     select client_id, d + 1, 'cheque', 1000000, 'OB-1', d + 20, 'in_hand', true from x$q$),
  'an opening cheque is dated the opening date');
insert into public.client_receipts (client_id, received_on, method, amount_minor, cheque_no, cheque_due_date, cheque_status, is_opening)
select client_id, d, 'cheque', 1000000, 'OB-1', d + 20, 'in_hand', true from x;
create temp table cb as select (select balance_minor from public.client_balance_v where client_id = (select client_id from x)) as b;
select pg_temp.check(
  pg_temp.bal('1104') = (select cheques from before) + 1000000
  and (select b from cb) = pg_temp.bal('1103', (select client_id from x))
  and (select cheques_pending_minor from public.client_balance_v where client_id = (select client_id from x)) >= 1000000
  and not exists (select 1 from public.client_statement_v v where v.client_id = (select client_id from x) and v.kind = 'receipt'
                  and v.doc_id = (select id from public.client_receipts where cheque_no = 'OB-1')),
  'a customer cheque in hand is under collection without touching his balance');
update public.client_receipts set cheque_status = 'bounced', cheque_status_on = app.today() where cheque_no = 'OB-1';
select pg_temp.check(
  (select balance_minor from public.client_balance_v where client_id = (select client_id from x)) = (select b from cb) + 1000000
  and (select balance_minor from public.client_balance_v where client_id = (select client_id from x)) = pg_temp.bal('1103', (select client_id from x)),
  'if it bounces, he owes it again');

insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, cheque_no, cheque_due_date, cheque_status, is_opening)
select supplier_id, d, 'cheque', 500000, 'OBP-1', d + 30, 'issued', true from x;
select pg_temp.check(
  pg_temp.bal('2102') = (select issued from before) - 500000
  and (select balance_minor from public.supplier_balance_v where supplier_id = (select supplier_id from x)) = (select supplier_bal from before) + 2000000,
  'our cheque not yet paid is owed to the bank, not again to the supplier');

insert into public.driver_advances (driver_id, issued_on, amount_minor, method) select driver_id, d, 250000, 'opening' from x;
select pg_temp.check(
  (select coalesce(balance_base_minor, 0) from public.driver_advance_balance_v where driver_id = (select driver_id from x)) = (select driver_bal from before) + 250000
  and (select coalesce(balance_base_minor, 0) from public.driver_advance_balance_v where driver_id = (select driver_id from x)) = pg_temp.bal('1105', null, null, (select driver_id from x)),
  'an advance the driver holds on the opening date is his to settle, and the ledger agrees');

-- Moving or clearing the date ---------------------------------------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000402',
  $q$select public.set_opening_date((select d - 5 from x))$q$),
  'the accountant moves the opening date earlier');
select pg_temp.check(
  (select entry_date from pg_temp.live()) = (select d - 5 from x)
  and (select received_on from public.client_receipts where cheque_no = 'OB-1') = (select d - 5 from x)
  and (select paid_on from public.supplier_payments where cheque_no = 'OBP-1') = (select d - 5 from x)
  and (select issued_on from public.driver_advances where method = 'opening') = (select d - 5 from x),
  'moving the opening date moves the entry, the cheques and the advances');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000402', $q$select public.set_opening_date(null)$q$),
  'the date cannot be cleared while opening balances hang on it');
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-000000000403', 'select count(*) from public.opening_balances') = 0,
  'a dispatcher sees no opening balances');

delete from public.opening_balances;
select pg_temp.check((select count(*) from pg_temp.live()) = 0, 'removing every balance reverses the opening entry');
select pg_temp.check((select sum(debit_minor) = sum(credit_minor) from public.journal_lines), 'the journal still balances');
select pg_temp.check((select sum(closing_minor) from public.trial_balance('2000-01-01', '2100-01-01')) = 0, 'the trial balance closes at zero');

rollback;
