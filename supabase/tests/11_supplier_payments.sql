-- Payments to suppliers and the cheques we issue (migration 20).
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

create function pg_temp.live(p_type text, p_id uuid) returns setof public.journal_entries
language sql as $$
  select * from public.journal_entries e
  where e.source_type = p_type and e.source_id = p_id and e.status = 'posted' and e.reverses_entry_id is null
$$;

-- Balance (debit - credit) of an account, optionally for one supplier.
create function pg_temp.bal(p_code text, p_supplier uuid default null) returns bigint
language sql as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
  from public.journal_lines l join public.accounts a on a.id = l.account_id
  where a.code = p_code and (p_supplier is null or l.supplier_id = p_supplier)
$$;

-- The first user becomes the manager.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000201', 'sp-manager@example.test'),
  ('00000000-0000-4000-8000-000000000202', 'sp-accountant@example.test'),
  ('00000000-0000-4000-8000-000000000203', 'sp-dispatcher@example.test');
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-000000000202';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000203';

-- What we owe comes from the ledger ----------------------------------------------------
select pg_temp.check(exists (select 1 from public.accounts where code = '4104' and type = 'revenue'), 'discount received account 4104 exists');
select pg_temp.check(
  (select count(*) from public.supplier_balance_v where balance_minor > 0) > 0,
  'the seed leaves suppliers with something owed');
select pg_temp.check(
  not exists (select 1 from public.supplier_balance_v b where b.balance_minor <> -pg_temp.bal('2101', b.supplier_id)),
  'each supplier''s balance is his account on 2101');

create temp table sup as
select supplier_id as id, balance_minor as owed from public.supplier_balance_v order by balance_minor desc limit 1;
grant select on sup to authenticated;

-- A cash payment -------------------------------------------------------------------------
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000202',
  $q$insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, voucher_no, notes)
     select id, current_date, 'cash', 150000, 'SP-T1', 'sp cash' from sup$q$),
  'the accountant records a cash payment');
create temp table cash as select id, payment_no from public.supplier_payments where notes = 'sp cash';
select pg_temp.check(
  (select count(*) = 2 from public.journal_lines l join pg_temp.live('supplier_payment', (select id from cash)) e on e.id = l.entry_id)
  and exists (select 1 from public.ledger_lines_v v where v.source_id = (select id from cash) and v.account_code = '2101'
              and v.debit_minor = 150000 and v.supplier_id = (select id from sup))
  and exists (select 1 from public.ledger_lines_v v where v.source_id = (select id from cash) and v.account_code = '1101'
              and v.credit_minor = 150000),
  'a cash payment: Dr the supplier, Cr cash');
select pg_temp.check(
  (select balance_minor from public.supplier_balance_v where supplier_id = (select id from sup)) = (select owed from sup) - 150000
  and (select paid_minor from public.supplier_balance_v where supplier_id = (select id from sup)) >= 150000,
  'the supplier is owed that much less');
select pg_temp.check(
  exists (select 1 from public.ledger_lines_v v where v.source_id = (select id from cash)
          and v.voucher_no = 'SP-T1' and v.payment_no = (select payment_no from cash) and v.notes = 'sp cash'),
  'the ledger shows the voucher and payment numbers');

-- Who may ---------------------------------------------------------------------------------
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-000000000203', 'select count(*) from public.supplier_payments') = 0,
  'a dispatcher sees no supplier payments');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000203',
  $q$insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor) select id, current_date, 'cash', 1000 from sup$q$),
  'a dispatcher cannot pay suppliers');

-- Voucher numbers are used once ---------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000202',
  $q$insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, voucher_no) select id, current_date, 'bank', 1000, 'SP-T1' from sup$q$),
  'a voucher number already used is refused');
insert into app.voucher_numbers (voucher_no, source_type, source_id) values ('SP-T2', 'expense', gen_random_uuid());
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000202',
  $q$insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, voucher_no) select id, current_date, 'bank', 1000, 'SP-T2' from sup$q$),
  'including one used on an expense, fill-up or advance');

-- Bank transfer and discount ---------------------------------------------------------------
insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, reference_no, notes)
select id, app.today(), 'bank', 20000, 'TRX-77', 'sp bank' from sup;
select pg_temp.check(
  exists (select 1 from public.ledger_lines_v v where v.source_id = (select id from public.supplier_payments where notes = 'sp bank')
          and v.account_code = '1102' and v.credit_minor = 20000 and v.notice_no = 'TRX-77'),
  'a transfer comes out of the bank, with its reference');
insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, notes)
select id, app.today(), 'discount', 3000, 'sp discount' from sup;
select pg_temp.check(
  (select v.account_code from public.ledger_lines_v v
   where v.source_id = (select id from public.supplier_payments where notes = 'sp discount') and v.credit_minor > 0) = '4104',
  'a discount is credited to discount received');

-- An issued cheque -------------------------------------------------------------------------
insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status, notes)
select id, app.today(), 'cheque', 80000, 'OUT-1', 'البنك العربي', app.today() + 30, 'issued', 'sp cheque' from sup;
create temp table chq as
select id, (select cheques_pending_minor from public.supplier_balance_v where supplier_id = (select id from sup)) - 80000 as pending_before
from public.supplier_payments where notes = 'sp cheque';
create temp table cb as select pg_temp.bal('2101', (select id from sup)) as s, pg_temp.bal('2102') as pdc, pg_temp.bal('1102') as bank;
select pg_temp.check(
  exists (select 1 from public.ledger_lines_v v where v.source_id = (select id from chq) and v.account_code = '2102'
          and v.credit_minor = 80000 and v.supplier_id = (select id from sup) and v.cheque_no = 'OUT-1')
  and (select count(*) from pg_temp.live('issued_cheque', (select id from chq))) = 0,
  'an issued cheque is owed as a post-dated cheque until the bank pays it');
select pg_temp.check(
  (select cheques_pending_minor from public.supplier_balance_v where supplier_id = (select id from sup)) = (select pending_before from chq) + 80000
  and (select pending_before from chq) = (select coalesce(sum(amount_minor), 0) from public.supplier_payments
                                          where supplier_id = (select id from sup) and cheque_status = 'issued' and notes <> 'sp cheque'),
  'the supplier shows the cheque waiting');

update public.supplier_payments set cheque_status = 'cleared', cheque_status_on = app.today() where id = (select id from chq);
select pg_temp.check(
  pg_temp.bal('2102') = (select pdc from cb) + 80000 and pg_temp.bal('1102') = (select bank from cb) - 80000
  and pg_temp.bal('2101', (select id from sup)) = (select s from cb),
  'a cleared cheque moves from post-dated cheques to the bank');

update public.supplier_payments set cheque_status = 'bounced' where id = (select id from chq);
select pg_temp.check(
  pg_temp.bal('2102') = (select pdc from cb) + 80000 and pg_temp.bal('1102') = (select bank from cb)
  and pg_temp.bal('2101', (select id from sup)) = (select s from cb) - 80000,
  'if it bounces instead, the bank is undone and the supplier is owed it again');
select pg_temp.check(
  (select balance_minor from public.supplier_balance_v where supplier_id = (select id from sup)) = -pg_temp.bal('2101', (select id from sup))
  and (select cheques_pending_minor from public.supplier_balance_v where supplier_id = (select id from sup)) = (select pending_before from chq),
  'the balance view and the account still agree');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000202',
  $q$update public.supplier_payments set cheque_status_on = paid_on - 1 where notes = 'sp cheque'$q$),
  'a cheque cannot clear or bounce before it was issued');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-000000000202',
  $q$insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, cheque_no, cheque_status)
     select id, current_date, 'cheque', 1000, 'OUT-2', 'issued' from sup$q$),
  'a cheque needs its due date');

-- Deleting reverses everything and frees the voucher number ------------------------------------
delete from public.supplier_payments where id = (select id from chq);
select pg_temp.check(
  (select count(*) from pg_temp.live('supplier_payment', (select id from chq))) = 0
  and (select count(*) from pg_temp.live('issued_cheque', (select id from chq))) = 0
  and pg_temp.bal('2102') = (select pdc from cb) + 80000,
  'deleting a payment reverses all its entries');
delete from public.supplier_payments where id = (select id from cash);
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-000000000202',
  $q$insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, voucher_no) select id, current_date, 'cash', 1000, 'SP-T1' from sup$q$),
  'its voucher number can be used again');

select pg_temp.check((select sum(debit_minor) = sum(credit_minor) from public.journal_lines), 'the journal still balances');
select pg_temp.check((select sum(closing_minor) from public.trial_balance('2000-01-01', '2100-01-01')) = 0,
  'the trial balance closes at zero');

rollback;
