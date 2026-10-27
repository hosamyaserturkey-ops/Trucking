-- Customer invoices, receipts and balances (migration 15). Rolled back at the
-- end; needs all three seeds.

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

-- Run a statement as a user and return one value it selects.
create function pg_temp.as_user_value(uid uuid, query text) returns text
language plpgsql as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute query into v;
  perform set_config('role', 'none', true);
  return v;
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text), pg_temp.as_user_value(uuid, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'inv-manager@example.test'),
  ('00000000-0000-4000-8000-0000000000f2', 'inv-accountant@example.test'),
  ('00000000-0000-4000-8000-0000000000f3', 'inv-dispatcher@example.test');
update public.profiles set role = 'manager' where user_id = '00000000-0000-4000-8000-0000000000f1';
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-0000000000f2';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-0000000000f3';

-- Two customers with finished loads; four old loads of the first, one of the second.
create temp table ix as
with a as (
  select client_id from public.trips
  where status = 'completed' and not is_empty_return and invoice_id is null and client_id is not null
  group by client_id order by count(*) desc limit 2
)
select
  (select client_id from a limit 1) as client_a,
  (select client_id from a offset 1 limit 1) as client_b;
alter table ix add column loads uuid[], add column other_load uuid, add column planned_load uuid;
update ix set
  loads = (select array_agg(id order by start_date) from (
             select id, start_date from public.trips
             where client_id = ix.client_a and status = 'completed' and not is_empty_return and invoice_id is null
             order by start_date limit 4) s),
  other_load = (select id from public.trips
                where client_id = ix.client_b and status = 'completed' and not is_empty_return and invoice_id is null
                order by start_date limit 1),
  planned_load = (select id from public.trips where client_id = ix.client_a and status = 'planned' limit 1);
grant select on ix to authenticated;

create function pg_temp.invoice(p_loads text, p_date text default 'app.today()', p_client text default '(select client_a from ix)')
returns text language sql as $$
  select format('select public.create_invoice(%s, %s, %s, ''invoice test'')', p_client, p_date, p_loads)
$$;

-- Issuing ----------------------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f3',
  pg_temp.invoice('(select loads[1:2] from ix)')), 'a dispatcher cannot issue invoices');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  $s$insert into public.invoices (client_id, invoice_date, due_date, period_from, period_to, lines_count,
     subtotal_minor, vat_rate_pct, vat_minor, total_minor)
     select client_a, current_date, current_date, current_date, current_date, 1, 1000, 0, 0, 1000 from ix$s$),
  'invoices cannot be written directly, only issued');

create temp table inv1 as
select pg_temp.as_user_value('00000000-0000-4000-8000-0000000000f2', pg_temp.invoice('(select loads[1:2] from ix)'))::uuid as id;
grant select on inv1 to authenticated;

select pg_temp.check(
  (select i.lines_count = 2 and i.status = 'issued' from public.invoices i join inv1 on inv1.id = i.id),
  'an accountant issues an invoice for two loads');
select pg_temp.check(
  (select i.subtotal_minor = (select sum(x.freight_base_minor) from public.trips x where x.id = any ((select loads[1:2] from ix)::uuid[]))
   from public.invoices i join inv1 on inv1.id = i.id),
  'the subtotal is the loads'' freight in JOD');
select pg_temp.check(
  (select i.vat_rate_pct = 16 and i.vat_minor = round(i.subtotal_minor * 0.16) and i.total_minor = i.subtotal_minor + i.vat_minor
   from public.invoices i join inv1 on inv1.id = i.id),
  'sales tax is 16% and the total adds up');
select pg_temp.check(
  (select i.due_date = i.invoice_date + c.payment_terms_days from public.invoices i join inv1 on inv1.id = i.id
   join public.clients c on c.id = i.client_id),
  'the due date follows the customer''s payment terms');
select pg_temp.check(
  (select count(*) = 2 from public.trips x join inv1 on x.invoice_id = inv1.id),
  'both loads now point at the invoice');
select pg_temp.check(
  (select count(*) = 2 and min(l.line_no) = 1 and bool_and(l.amount_minor > 0) from public.invoice_lines l join inv1 on inv1.id = l.invoice_id),
  'the invoice has its two lines');

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  pg_temp.invoice('(select loads[2:3] from ix)')), 'a load cannot be on two invoices');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  pg_temp.invoice('(select array[other_load] from ix)')), 'a load of another customer is refused');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  pg_temp.invoice('array[]::uuid[]')), 'an empty invoice is refused');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  pg_temp.invoice('(select loads[3:3] from ix)', 'app.today() + 1')), 'a future invoice date is refused');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  pg_temp.invoice('(select loads[3:3] from ix)', '''2000-01-01''')), 'an invoice dated before its loads is refused');
select pg_temp.check(
  (select planned_load is null from ix)
  or pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2', pg_temp.invoice('(select array[planned_load] from ix)')),
  'an unfinished trip cannot be invoiced');

-- Issued invoices and invoiced loads are frozen ---------------------------------
do $$
begin
  begin
    update public.invoices set total_minor = total_minor + 1, subtotal_minor = subtotal_minor + 1
    where id = (select id from inv1);
    raise exception 'FAIL: an issued invoice was changed';
  exception when check_violation then
    raise notice 'PASS: an issued invoice cannot be changed, even by the owner';
  end;
  begin
    delete from public.invoices where id = (select id from inv1);
    raise exception 'FAIL: an invoice was deleted';
  exception when check_violation then
    raise notice 'PASS: an invoice cannot be deleted';
  end;
end;
$$;

select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f1',
  format('update public.trips set freight_minor = freight_minor + 1000 where id = %L', (select loads[1] from ix))),
  'an invoiced load''s freight cannot change');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f1',
  format('update public.trips set invoice_id = null where id = %L', (select loads[1] from ix))),
  'a load cannot be taken off its invoice directly');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f1',
  format('delete from public.trips where id = %L', (select loads[1] from ix))),
  'an invoiced load cannot be deleted');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f1',
  format('update public.trips set notes = ''invoiced note'' where id = %L', (select loads[1] from ix))),
  'notes on an invoiced load can still be edited');

-- Tax-exempt customer
update public.clients set vat_exempt = true where id = (select client_b from ix);
create temp table inv2 as
select pg_temp.as_user_value('00000000-0000-4000-8000-0000000000f1',
  pg_temp.invoice('(select array[other_load] from ix)', 'app.today()', '(select client_b from ix)'))::uuid as id;
select pg_temp.check(
  (select i.vat_rate_pct = 0 and i.vat_minor = 0 and i.total_minor = i.subtotal_minor from public.invoices i join inv2 on inv2.id = i.id),
  'a tax-exempt customer''s invoice has no sales tax');

-- Cancelling --------------------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  format('select public.cancel_invoice(%L, %L)', (select id from inv1), '  ')), 'cancelling needs a reason');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f3',
  format('select public.cancel_invoice(%L, %L)', (select id from inv1), 'wrong customer')), 'a dispatcher cannot cancel');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  format('select public.cancel_invoice(%L, %L)', (select id from inv1), 'wrong loads')), 'an accountant cancels an invoice');
select pg_temp.check(
  (select status = 'cancelled' and cancel_reason = 'wrong loads' and cancelled_at is not null from public.invoices where id = (select id from inv1)),
  'it is kept, marked cancelled, with the reason');
select pg_temp.check(
  not exists (select 1 from public.trips where invoice_id = (select id from inv1)),
  'its loads are free again');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  format('select public.cancel_invoice(%L, %L)', (select id from inv1), 'again')), 'it cannot be cancelled twice');

create temp table inv3 as
select pg_temp.as_user_value('00000000-0000-4000-8000-0000000000f2', pg_temp.invoice('(select loads[1:3] from ix)'))::uuid as id;
select pg_temp.check(
  (select i3.invoice_no > i1.invoice_no and i3.lines_count = 3
   from public.invoices i3, public.invoices i1 where i3.id = (select id from inv3) and i1.id = (select id from inv1)),
  'the loads are invoiced again on a new invoice with the next number');

-- A load of a cancelled invoice can be deleted; the old line stays as history.
create temp table freed as
select l.trip_id from public.invoice_lines l
where l.invoice_id = (select id from inv1) and l.trip_id <> all ((select loads[1:3] from ix)::uuid[]);
select pg_temp.check((select count(*) = 0 from freed), 'every load of the cancelled invoice was re-invoiced (setup)');

-- Receipts ----------------------------------------------------------------------
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f3',
  format($s$insert into public.client_receipts (client_id, received_on, method, amount_minor) values (%L, current_date, 'cash', 1000)$s$,
         (select client_a from ix))), 'a dispatcher cannot record receipts');
select pg_temp.check(
  pg_temp.as_user_value('00000000-0000-4000-8000-0000000000f3', 'select count(*) from public.invoices') = '0',
  'a dispatcher sees no invoices');

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2', format(
  $s$insert into public.client_receipts (client_id, received_on, method, amount_minor, notes) values
     (%L, current_date, 'cash', 50000, 'r-cash'),
     (%L, current_date, 'bank', 30000, 'r-bank'),
     (%L, current_date, 'discount', 500, 'r-discount')$s$,
  (select client_a from ix), (select client_a from ix), (select client_a from ix))), 'cash, bank and discount receipts');
select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2', format(
  $s$insert into public.client_receipts (client_id, received_on, method, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status, notes)
     values (%L, current_date, 'cheque', 40000, '100123', 'Arab Bank', current_date + 30, 'in_hand', 'r-cheque')$s$,
  (select client_a from ix))), 'a post-dated cheque receipt');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2', format(
  $s$insert into public.client_receipts (client_id, received_on, method, amount_minor) values (%L, current_date, 'cheque', 1000)$s$,
  (select client_a from ix))), 'a cheque needs its number, due date and status');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2', format(
  $s$insert into public.client_receipts (client_id, received_on, method, amount_minor, cheque_status) values (%L, current_date, 'cash', 1000, 'in_hand')$s$,
  (select client_a from ix))), 'cash cannot carry a cheque status');
select pg_temp.check(pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  $s$update public.client_receipts set cheque_status = 'deposited' where notes = 'r-cheque'$s$),
  'changing a cheque''s status needs the day it happened');

create temp table bal_before as
select balance_minor, received_minor, overdue_minor, invoiced_minor from public.client_balance_v where client_id = (select client_a from ix);
select pg_temp.check(
  (select received_minor = (select coalesce(sum(amount_minor), 0) from public.client_receipts
                            where client_id = (select client_a from ix) and cheque_status is distinct from 'bounced')
          and balance_minor = invoiced_minor - received_minor from bal_before),
  'the balance is invoiced minus received');
select pg_temp.check(
  (select invoiced_minor = (select coalesce(sum(total_minor), 0) from public.invoices
                            where client_id = (select client_a from ix) and status = 'issued') from bal_before),
  'cancelled invoices do not count');

select pg_temp.check(not pg_temp.as_user_raises('00000000-0000-4000-8000-0000000000f2',
  $s$update public.client_receipts set cheque_status = 'bounced', cheque_status_on = current_date where notes = 'r-cheque'$s$),
  'a cheque bounces');
select pg_temp.check(
  (select v.balance_minor = b.balance_minor + 40000 from public.client_balance_v v, bal_before b where v.client_id = (select client_a from ix)),
  'a bounced cheque adds its amount back to the balance');
select pg_temp.check(
  exists (select 1 from public.client_statement_v s join public.client_receipts r on r.id = s.doc_id
          where r.notes = 'r-cheque' and s.kind = 'bounced' and s.debit_minor = 40000)
  and exists (select 1 from public.client_statement_v s join public.client_receipts r on r.id = s.doc_id
              where r.notes = 'r-cheque' and s.kind = 'receipt' and s.credit_minor = 40000),
  'the statement shows the cheque received and then bounced');
select pg_temp.check(
  (select sum(debit_minor) - sum(credit_minor) from public.client_statement_v where client_id = (select client_a from ix))
  = (select balance_minor from public.client_balance_v where client_id = (select client_a from ix)),
  'the statement adds up to the balance');

-- Overdue: an old invoice past its due date.
create temp table inv_old as
select pg_temp.as_user_value('00000000-0000-4000-8000-0000000000f2', pg_temp.invoice('(select loads[4:4] from ix)',
  format('%L::date', (select start_date + 1 from public.trips where id = (select loads[4] from ix)))))::uuid as id;
select pg_temp.check(
  (select due_date < current_date from public.invoices where id = (select id from inv_old)),
  'an invoice dated months ago is past due (setup)');
select pg_temp.check(
  (select v.overdue_minor = greatest(
            (select coalesce(sum(total_minor), 0) from public.invoices
             where client_id = v.client_id and status = 'issued' and due_date < app.today()) - v.received_minor, 0)
   from public.client_balance_v v where v.client_id = (select client_a from ix)),
  'overdue is past-due invoices minus what was received (oldest paid first)');
delete from public.client_receipts where notes in ('r-cash', 'r-bank');
select pg_temp.check(
  (select overdue_minor > 0 and overdue_minor <= balance_minor from public.client_balance_v where client_id = (select client_a from ix)),
  'without those receipts the old invoice shows as overdue');

select pg_temp.check(
  (select unbilled_loads = (select count(*) from public.trips where client_id = (select client_a from ix) and status = 'completed'
                            and not is_empty_return and invoice_id is null and freight_base_minor > 0)
   from public.client_balance_v where client_id = (select client_a from ix)),
  'the balance view counts loads not invoiced yet');

rollback;
