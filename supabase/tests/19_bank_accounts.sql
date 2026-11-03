-- Several bank accounts and the bank's other movements (migration 28).
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

grant execute on function pg_temp.as_user_raises(uuid, text) to authenticated;

-- Posted balance of an account (debit minus credit).
create function pg_temp.bal(p_account uuid) returns bigint
language sql as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
  where l.account_id = p_account and e.status <> 'draft'
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000111', 'ba-manager@example.test'),
  ('00000000-0000-4000-8000-000000000112', 'ba-accountant@example.test'),
  ('00000000-0000-4000-8000-000000000113', 'ba-dispatcher@example.test');
update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-000000000111';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-000000000112';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000113';

create temp table k as
select
  app.account_by_code('1102') as main_bank,
  app.account_by_code('1101') as cash,
  app.account_by_code('3301') as owner,
  app.account_by_code('5204') as charges,
  app.account_by_code('1103') as customers,
  (select id from public.clients order by name limit 1) as client_id,
  (select id from public.suppliers order by name limit 1) as supplier_id,
  (select id from public.trucks where code = 'T-01') as truck_id,
  (select id from public.drivers order by full_name limit 1) as driver_id,
  (select id from public.expense_categories where code = 'tolls') as tolls;
grant select on k to authenticated;

-- Bank accounts ---------------------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000113',
  $q$select public.create_bank_account('بنك الإسكان')$q$), 'a dispatcher cannot add a bank account');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000112',
  $q$select public.create_bank_account(' البنك العربي ', 'JO71ARAB1234')$q$), 'the accountant adds a bank account');
create temp table b as select id, code from public.accounts where name_ar = 'البنك العربي';
grant select on b to authenticated;
select pg_temp.check(
  (select a.code ~ '^1102[0-9]{2}$' and a.parent_id = k.main_bank and a.is_postable and a.type = 'asset' and a.bank_account_no = 'JO71ARAB1234'
   from public.accounts a, k where a.id = (select id from b)),
  'it is numbered 1102NN under the main bank account, with its number');
select pg_temp.check(app.is_bank_account((select id from b)), 'it counts as a bank account');
select public.create_bank_account('بنك الإسكان');
select pg_temp.check(
  (select code from public.accounts where name_ar = 'بنك الإسكان') = '1102' || lpad((substr((select code from b), 5)::integer + 1)::text, 2, '0'),
  'the next one takes the next number');
select public.update_bank_account((select id from b), 'البنك العربي — جاري', 'JO71ARAB9999');
select pg_temp.check(
  (select name_ar = 'البنك العربي — جاري' and bank_account_no = 'JO71ARAB9999' from public.accounts where id = (select id from b)),
  'a bank account can be renamed');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000112',
  format($q$select public.update_bank_account(%L, 'x')$q$, (select cash from k))), 'only bank accounts are edited there');

create temp table start as select pg_temp.bal((select id from b)) as bb, pg_temp.bal((select main_bank from k)) as mb, pg_temp.bal((select cash from k)) as cb;

-- Documents post to the bank they name ---------------------------------------------
insert into public.expenses (expense_date, category_id, truck_id, description, amount_minor, payment_method, bank_account_id, notes)
select current_date, tolls, truck_id, 'ba toll', 10000, 'bank', (select id from b), 'ba test' from k;
select pg_temp.check(pg_temp.bal((select id from b)) = (select bb from start) - 10000, 'an expense paid by bank leaves the bank it names');

insert into public.expenses (expense_date, category_id, truck_id, description, amount_minor, payment_method, notes)
select current_date, tolls, truck_id, 'ba toll 2', 7000, 'bank', 'ba test 2' from k;
select pg_temp.check(pg_temp.bal((select main_bank from k)) = (select mb from start) - 7000, 'with no bank named it is the main account, as before');

update public.expenses set bank_account_id = (select id from b) where notes = 'ba test 2';
select pg_temp.check(
  pg_temp.bal((select main_bank from k)) = (select mb from start) and pg_temp.bal((select id from b)) = (select bb from start) - 17000,
  'changing the bank re-posts it');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000112',
  format($q$update public.expenses set bank_account_id = %L where notes = 'ba test'$q$, (select cash from k))),
  'a document can only name a bank account');

insert into public.driver_advances (driver_id, issued_on, amount_minor, method, bank_account_id, notes)
select driver_id, current_date, 20000, 'bank', (select id from b), 'ba advance' from k;
select pg_temp.check(pg_temp.bal((select id from b)) = (select bb from start) - 37000, 'an advance by bank transfer too');

insert into public.client_receipts (client_id, received_on, method, amount_minor, bank_account_id, notes)
select client_id, current_date, 'bank', 50000, (select id from b), 'ba transfer in' from k;
select pg_temp.check(pg_temp.bal((select id from b)) = (select bb from start) + 13000, 'a customer''s transfer comes into its bank');

insert into public.client_receipts (client_id, received_on, method, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status, bank_account_id, notes)
select client_id, current_date, 'cheque', 30000, 'BA-1', 'بنك القاهرة', current_date + 20, 'in_hand', (select id from b), 'ba cheque in' from k;
select pg_temp.check(
  (select cheques_in_minor >= 30000 and cheques_in_count >= 1 from public.bank_accounts_v where account_id = (select id from b)),
  'a cheque in hand waits to be collected into its bank');
update public.client_receipts set cheque_status = 'cleared', cheque_status_on = current_date where notes = 'ba cheque in';
select pg_temp.check(pg_temp.bal((select id from b)) = (select bb from start) + 43000, 'when it clears it lands in that bank');

insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, cheque_no, cheque_due_date, cheque_status, bank_account_id, notes)
select supplier_id, current_date, 'cheque', 25000, 'OUT-1', current_date + 10, 'issued', (select id from b), 'ba cheque out' from k;
select pg_temp.check(
  (select cheques_out_minor >= 25000 from public.bank_accounts_v where account_id = (select id from b)),
  'our cheque waits to be paid from its bank');
update public.supplier_payments set cheque_status = 'cleared', cheque_status_on = current_date where notes = 'ba cheque out';
select pg_temp.check(pg_temp.bal((select id from b)) = (select bb from start) + 18000, 'when the bank pays it, it leaves that bank');

-- Other movements ------------------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000113',
  format($q$insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor)
            values (current_date, %L, 'in', 'cash', %L, 1000)$q$, (select id from b), (select cash from k))),
  'a dispatcher cannot record bank movements');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000112',
  format($q$insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor, reference_no, description)
            values (current_date, %L, 'in', 'cash', %L, 100000, ' DEP-9 ', 'ba deposit')$q$, (select id from b), (select cash from k))),
  'the accountant records cash deposited in the bank');
select pg_temp.check(
  pg_temp.bal((select id from b)) = (select bb from start) + 118000 and pg_temp.bal((select cash from k)) = (select cb from start) - 100000,
  'a deposit: Dr the bank, Cr the cash box');

insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor, description)
select current_date, (select id from b), 'out', 'transfer', main_bank, 40000, 'ba transfer' from k;
select pg_temp.check(
  pg_temp.bal((select id from b)) = (select bb from start) + 78000 and pg_temp.bal((select main_bank from k)) = (select mb from start) + 40000,
  'a transfer between two banks moves the money from one to the other');

insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor, truck_id, description)
select current_date, (select id from b), 'out', 'charges', charges, 1500, truck_id, 'ba charges' from k;
select pg_temp.check(
  (select l.truck_id is not null from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
   where e.source_type = 'bank_movement' and e.status = 'posted' and e.reverses_entry_id is null
     and l.account_id = (select charges from k) and e.source_id = (select id from public.bank_movements where description = 'ba charges')),
  'bank charges post to their account, on the truck when one is given');

insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor, truck_id, description)
select current_date, (select id from b), 'in', 'owner', owner, 60000, truck_id, 'ba owner' from k;
select pg_temp.check(
  (select truck_id is null from public.bank_movements where description = 'ba owner'),
  'a truck is kept only on income and expense accounts');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000112',
  format($q$insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor)
            values (current_date, %L, 'in', 'other', %L, 1000)$q$, (select id from b), (select customers from k))),
  'customers, suppliers, advances and cheques are not moved here');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000112',
  format($q$insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor)
            values (current_date, %L, 'out', 'transfer', %L, 1000)$q$, (select id from b), (select cash from k))),
  'a transfer must be to another bank account');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000112',
  format($q$insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor)
            values (current_date, %L, 'out', 'other', %L, 1000)$q$, (select id from b), (select main_bank from k))),
  'money between two banks is recorded as a transfer');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000112',
  format($q$insert into public.bank_movements (moved_on, bank_account_id, direction, kind, counter_account_id, amount_minor)
            values (current_date + 1, %L, 'in', 'cash', %L, 1000)$q$, (select id from b), (select cash from k))),
  'no movement dated in the future');

update public.bank_movements set amount_minor = 120000 where description = 'ba deposit';
select pg_temp.check(pg_temp.bal((select cash from k)) = (select cb from start) - 120000, 'changing a movement re-posts it');
delete from public.bank_movements where description = 'ba deposit';
select pg_temp.check(pg_temp.bal((select cash from k)) = (select cb from start), 'deleting it reverses its entry');

select pg_temp.check(
  (select balance_minor = pg_temp.bal((select id from b)) from public.bank_accounts_v where account_id = (select id from b)),
  'the bank list shows the book balance');
select pg_temp.check(
  (select count(*) from public.bank_accounts_v where account_id in ((select main_bank from k), (select id from b))) = 2,
  'the main account and the new ones are listed');

select pg_temp.check((select sum(debit_minor) = sum(credit_minor) from public.journal_lines), 'the journal balances');

rollback;
