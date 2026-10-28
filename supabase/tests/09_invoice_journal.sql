-- Invoices, receipts and cheques as journal entries (migration 18).
-- Rolled back at the end; needs all seeds (seed_invoices included).

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

create function pg_temp.live(p_type text, p_id uuid) returns setof public.journal_entries
language sql as $$
  select * from public.journal_entries e
  where e.source_type = p_type and e.source_id = p_id and e.status = 'posted' and e.reverses_entry_id is null
$$;

-- Balance (debit - credit) of an account, optionally for one customer.
create function pg_temp.bal(p_code text, p_client uuid default null) returns bigint
language sql as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint
  from public.journal_lines l join public.accounts a on a.id = l.account_id
  where a.code = p_code and (p_client is null or l.client_id = p_client)
$$;

-- Seeded invoices and receipts are posted ----------------------------------------
select pg_temp.check((select count(*) from public.invoices) > 0, 'the seed has invoices');
select pg_temp.check(
  not exists (select 1 from public.invoices i
              where (select count(*) from pg_temp.live('invoice', i.id)) <> (case when i.status = 'issued' then 1 else 0 end)),
  'every issued invoice has one entry');
select pg_temp.check(
  not exists (select 1 from public.client_balance_v b where b.balance_minor <> pg_temp.bal('1103', b.client_id)),
  'each customer''s account equals his balance (invoiced - received, bounced cheques count again)');
select pg_temp.check(
  pg_temp.bal('1104') = (select coalesce(sum(amount_minor), 0) from public.client_receipts
                         where method = 'cheque' and cheque_status in ('in_hand', 'deposited')),
  'cheques under collection are the cheques in hand or deposited');
select pg_temp.check(
  pg_temp.bal('2104') = -(select coalesce(sum(vat_minor), 0) from public.invoices where status = 'issued'),
  'sales tax payable is the tax on issued invoices');
select pg_temp.check(
  (select coalesce(sum(l.credit_minor - l.debit_minor), 0) from public.journal_lines l
   join public.journal_entries e on e.id = l.entry_id join public.accounts a on a.id = l.account_id
   where a.code = '4101' and e.source_type = 'invoice')
  = (select coalesce(sum(subtotal_minor), 0) from public.invoices where status = 'issued'),
  'transport revenue is the invoiced amount before tax');
select pg_temp.check(
  not exists (
    select 1 from (
      select x.truck_id, sum(l.amount_minor) as invoiced
      from public.invoice_lines l join public.invoices i on i.id = l.invoice_id and i.status = 'issued'
      join public.trips x on x.id = l.trip_id group by x.truck_id
    ) t
    where t.invoiced <> (select coalesce(sum(jl.credit_minor - jl.debit_minor), 0) from public.journal_lines jl
                         join public.journal_entries e on e.id = jl.entry_id join public.accounts a on a.id = jl.account_id
                         where a.code = '4101' and e.source_type = 'invoice' and jl.truck_id = t.truck_id)),
  'revenue is booked on each truck for its own loads');
select pg_temp.check((select sum(debit_minor) = sum(credit_minor) from public.journal_lines), 'the journal still balances');

-- Cancelling reverses ----------------------------------------------------------------
create temp table inv as
select i.id, i.client_id, i.total_minor from public.invoices i
where i.status = 'issued' order by i.invoice_date desc limit 1;
create temp table before as select pg_temp.bal('1103', (select client_id from inv)) as b;
select public.cancel_invoice((select id from inv), 'خطأ في الأجرة');
select pg_temp.check(
  (select count(*) from pg_temp.live('invoice', (select id from inv))) = 0
  and pg_temp.bal('1103', (select client_id from inv)) = (select b from before) - (select total_minor from inv),
  'a cancelled invoice is reversed off the customer''s account');
select pg_temp.check(
  (select description like 'عكس القيد رقم % — إلغاء الفاتورة: خطأ في الأجرة' from public.journal_entries
   where source_type = 'invoice' and source_id = (select id from inv) and reverses_entry_id is not null),
  'the reversal says why');

-- Receipts -----------------------------------------------------------------------------
create temp table cl as select (select id from inv) as inv_id, (select client_id from inv) as client_id;

insert into public.client_receipts (client_id, received_on, method, amount_minor, notes)
select client_id, app.today(), 'cash', 100000, 'jr cash' from cl;
select pg_temp.check(
  (select count(*) = 2 and sum(l.debit_minor) = 100000 from public.journal_lines l
   join pg_temp.live('receipt', (select id from public.client_receipts where notes = 'jr cash')) e on e.id = l.entry_id)
  and exists (select 1 from public.ledger_lines_v v where v.receipt_no = (select receipt_no from public.client_receipts where notes = 'jr cash')
              and v.account_code = '1101' and v.debit_minor = 100000),
  'a cash receipt: Dr cash, Cr the customer');

insert into public.client_receipts (client_id, received_on, method, amount_minor, notes)
select client_id, app.today(), 'discount', 5000, 'jr discount' from cl;
select pg_temp.check(
  (select v.account_code from public.ledger_lines_v v
   where v.source_id = (select id from public.client_receipts where notes = 'jr discount') and v.debit_minor > 0) = '4103',
  'a discount is debited to discount allowed');

insert into public.client_receipts (client_id, received_on, method, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status, notes)
select client_id, app.today(), 'cheque', 70000, 'JR-1', 'البنك العربي', app.today() + 30, 'in_hand', 'jr cheque' from cl;
create temp table chq as select id from public.client_receipts where notes = 'jr cheque';
create temp table cb as select pg_temp.bal('1103', (select client_id from cl)) as b, pg_temp.bal('1104') as u, pg_temp.bal('1102') as bank;
select pg_temp.check(
  (select count(*) from pg_temp.live('cheque', (select id from chq))) = 0,
  'a cheque in hand stays under collection');

update public.client_receipts set cheque_status = 'cleared', cheque_status_on = app.today() where id = (select id from chq);
select pg_temp.check(
  pg_temp.bal('1104') = (select u from cb) - 70000 and pg_temp.bal('1102') = (select bank from cb) + 70000,
  'a cleared cheque moves from under collection to the bank');

update public.client_receipts set cheque_status = 'bounced' where id = (select id from chq);
select pg_temp.check(
  pg_temp.bal('1104') = (select u from cb) - 70000 and pg_temp.bal('1102') = (select bank from cb)
  and pg_temp.bal('1103', (select client_id from cl)) = (select b from cb) + 70000,
  'if it bounces instead, the bank is undone and the customer owes it again');
select pg_temp.check(
  (select balance_minor from public.client_balance_v where client_id = (select client_id from cl))
  = pg_temp.bal('1103', (select client_id from cl)),
  'the customer balance view and his account still agree');

delete from public.client_receipts where id = (select id from chq);
select pg_temp.check(
  (select count(*) from pg_temp.live('receipt', (select id from chq))) = 0
  and (select count(*) from pg_temp.live('cheque', (select id from chq))) = 0
  and pg_temp.bal('1104') = (select u from cb) - 70000,
  'deleting the receipt reverses all its entries');

select pg_temp.check((select sum(closing_minor) from public.trial_balance('2000-01-01', '2100-01-01')) = 0,
  'the trial balance closes at zero');

-- A new invoice is posted as it is issued -------------------------------------------------
create temp table loads as
select x.client_id, array_agg(x.id) as ids, sum(x.freight_base_minor) as sub, max(x.start_date) as last_day
from public.trips x
where x.status = 'completed' and not x.is_empty_return and x.invoice_id is null and x.freight_base_minor > 0
  and x.client_id = (select client_id from cl)
group by x.client_id;
create temp table newinv as
select public.create_invoice((select client_id from loads), app.today(), (select ids from loads), 'jr test') as id;
select pg_temp.check(
  (select count(*) from pg_temp.live('invoice', (select id from newinv))) = 1
  and (select sum(l.debit_minor) from public.journal_lines l join pg_temp.live('invoice', (select id from newinv)) e on e.id = l.entry_id)
      = (select total_minor from public.invoices where id = (select id from newinv)),
  'a new invoice is posted for its total');

rollback;
