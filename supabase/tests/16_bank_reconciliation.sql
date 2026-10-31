-- Bank reconciliation (migration 25). Rolled back at the end; needs the seeds.

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

create function pg_temp.as_user(uid uuid, stmt text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute stmt;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
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

grant execute on function pg_temp.as_user_raises(uuid, text), pg_temp.as_user(uuid, text), pg_temp.as_user_count(uuid, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000501', 'bk-manager@example.test'),
  ('00000000-0000-4000-8000-000000000502', 'bk-accountant@example.test'),
  ('00000000-0000-4000-8000-000000000503', 'bk-dispatcher@example.test');
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-000000000502';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000503';

-- Last month's bank movements in the books ----------------------------------------------
create temp table ctx as
select (date_trunc('month', current_date) - interval '1 month')::date as f,
       (date_trunc('month', current_date) - interval '1 day')::date as t,
       (select id from public.accounts where code = '1102') as bank;
grant select on ctx to authenticated;

create temp table bk as
select b.id, b.entry_date, b.amount_minor, b.entry_description, b.cheque_no,
       row_number() over (order by b.entry_date, b.entry_no, b.id) as rn
from public.bank_book_lines_v b, ctx
where b.account_id = ctx.bank and b.entry_date between ctx.f and ctx.t and not b.is_cancelled and not b.is_opening;
grant select on bk to authenticated;

select pg_temp.check((select count(*) from bk) >= 3, 'the seed has bank movements last month');

-- The bank shows all of them but one payment (a cheque not yet presented), plus 5 JOD of charges.
create temp table outst as select * from bk where amount_minor < 0 order by rn desc limit 1;
create temp table stmt_lines as
select jsonb_agg(x.j order by x.ord) as lines
from (
  select bk.rn as ord, jsonb_build_object('txn_date', bk.entry_date, 'amount_minor', bk.amount_minor,
                                         'description', bk.entry_description, 'reference', bk.cheque_no) as j
  from bk where bk.id not in (select id from outst)
  union all
  select 1000000, jsonb_build_object('txn_date', (select t from ctx), 'amount_minor', -5000, 'description', 'عمولة بنكية')
) x;
grant select on stmt_lines, outst to authenticated;

create temp table opening as
select public.account_balance_before(array[(select bank from ctx)], (select f from ctx)) as amount;
grant select on opening to authenticated;

select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000503', $q$
    select public.bank_statement_create((select bank from ctx), (select f from ctx), (select t from ctx), 0, '[]'::jsonb)
  $q$),
  'a dispatcher cannot enter a bank statement');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000502', $q$
    select public.bank_statement_create((select id from public.accounts where code = '1101'), (select f from ctx), (select t from ctx), 0, '[]'::jsonb)
  $q$),
  'only a bank account can be reconciled');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000502', $q$
    select public.bank_statement_create((select bank from ctx), (select f from ctx), (select t from ctx), 0,
      jsonb_build_array(jsonb_build_object('txn_date', (select f from ctx) - 1, 'amount_minor', 1000)))
  $q$),
  'a movement outside the statement''s period is refused');

select pg_temp.as_user('00000000-0000-4000-8000-000000000502', $q$
  select public.bank_statement_create((select bank from ctx), (select f from ctx), (select t from ctx),
    (select amount from opening), (select lines from stmt_lines), 'statement.xlsx')
$q$);
create temp table st as select * from public.bank_statements where source_name = 'statement.xlsx';
grant select on st to authenticated;

select pg_temp.check(
  (select closing_balance_minor from st)
  = (select amount from opening) + (select sum(amount_minor) from bk where id not in (select id from outst)) - 5000
  and (select lines_count from st) = (select count(*) from bk) ,
  'the accountant enters it; its closing balance is the opening plus its lines');
select pg_temp.check(
  pg_temp.as_user_count('00000000-0000-4000-8000-000000000503', 'select count(*) from public.bank_statements') = 0,
  'a dispatcher sees no bank statements');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000502', $q$
    select public.bank_statement_create((select bank from ctx), (select t from ctx), (select t from ctx), 0, '[]'::jsonb)
  $q$),
  'a statement overlapping another of the same account is refused');

select pg_temp.check(
  (select difference_minor = 0 and unmatched_lines = (select count(*)::integer from bk)
   from public.bank_reconciliation((select id from st))),
  'nothing matched yet: the difference is already zero (it does not depend on matching)');

-- Match them one to one -------------------------------------------------------------------
create temp table pairs as
select jsonb_agg(jsonb_build_object('bank', l.id, 'book', bk.id)) as p
from public.bank_statement_lines l
join bk on bk.rn = (select array_agg(rn order by rn) from bk where id not in (select id from outst))[l.line_no]
where l.statement_id = (select id from st);
grant select on pairs to authenticated;

select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000502', $q$
    select public.bank_match((select id from st),
      array[(select id from public.bank_statement_lines where statement_id = (select id from st) and description = 'عمولة بنكية')],
      array[(select id from bk order by rn limit 1)])
  $q$),
  'amounts that differ cannot be matched');

select pg_temp.as_user('00000000-0000-4000-8000-000000000502', $q$
  select public.bank_match_pairs((select id from st), (select p from pairs))
$q$);
select pg_temp.check(
  (select count(*) from public.bank_statement_lines where statement_id = (select id from st) and match_id is null) = 1,
  'every bank line but the charges is matched');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000502', $q$
    select public.bank_match_pairs((select id from st), (select p from pairs))
  $q$),
  'a line cannot be matched twice');

select pg_temp.check(
  (select array_agg(side || ':' || amount_minor order by side) from public.bank_outstanding((select bank from ctx), (select t from ctx)))
  = array['bank:-5000', 'book:' || (select amount_minor from outst)],
  'outstanding: the cheque not yet presented in the books, the charges on the bank side');
select pg_temp.check(
  (select difference_minor = 0 and outstanding_out_minor = -(select amount_minor from outst) and unrecorded_out_minor = 5000 and unmatched_lines = 1
   from public.bank_reconciliation((select id from st))),
  'the reconciliation explains the difference');

select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000502', $q$ select public.bank_statement_close((select id from st)) $q$),
  'it cannot be closed while a bank line is not in the books');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000502', $q$
    select public.bank_post_line((select id from public.bank_statement_lines where statement_id = (select id from st) and description = 'عمولة بنكية'),
      (select id from public.accounts where code = '1103'))
  $q$),
  'a bank line is not posted straight to a customer''s account');

select pg_temp.as_user('00000000-0000-4000-8000-000000000502', $q$
  select public.bank_post_line((select id from public.bank_statement_lines where statement_id = (select id from st) and description = 'عمولة بنكية'),
    (select id from public.accounts where code = '5204'), 'عمولة الكشف')
$q$);
select pg_temp.check(
  (select count(*) from public.ledger_lines_v l
   where l.source_type = 'bank_line' and l.status = 'posted' and l.entry_date = (select t from ctx)
     and ((l.account_code = '5204' and l.debit_minor = 5000) or (l.account_code = '1102' and l.credit_minor = 5000))) = 2,
  'the charges are posted from the statement: Dr bank charges, Cr bank');
select pg_temp.check(
  (select difference_minor = 0 and unmatched_lines = 0 and unrecorded_out_minor = 0 from public.bank_reconciliation((select id from st))),
  'and matched; nothing is unrecorded any more');

select pg_temp.as_user('00000000-0000-4000-8000-000000000502', $q$ select public.bank_statement_close((select id from st)) $q$);
select pg_temp.check((select status from public.bank_statements where id = (select id from st)) = 'closed', 'the statement is closed');

-- Closed means closed --------------------------------------------------------------------------
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000501', $q$
    select public.bank_unmatch((select match_id from public.bank_statement_lines where statement_id = (select id from st) and match_id is not null limit 1))
  $q$),
  'its matches stay');
create temp table matched_entry as
select l.entry_id from public.journal_lines l
join public.bank_match_lines ml on ml.journal_line_id = l.id
join public.journal_entries e on e.id = l.entry_id
where e.source_type <> 'bank_line'
limit 1;
grant select on matched_entry to authenticated;
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000501', $q$
    select public.reverse_journal_entry((select entry_id from matched_entry), 'test')
  $q$),
  'an entry matched on a closed statement cannot be reversed');

-- Reopened, a reversal undoes the match ---------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000501', $q$ select public.bank_statement_reopen((select id from st)) $q$);
select pg_temp.as_user('00000000-0000-4000-8000-000000000501', $q$
  select public.reverse_journal_entry((select entry_id from matched_entry), 'test')
$q$);
select pg_temp.check(
  (select count(*) from public.bank_statement_lines where statement_id = (select id from st) and match_id is null) = 1,
  'reopened, reversing a matched entry puts its bank line back to be matched');

create temp table posted_match as
select match_id from public.bank_statement_lines where statement_id = (select id from st) and description = 'عمولة بنكية';
grant select on posted_match to authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000502', $q$ select public.bank_unmatch((select match_id from posted_match)) $q$);
select pg_temp.check(
  (select match_id is null from public.bank_statement_lines where statement_id = (select id from st) and description = 'عمولة بنكية')
  and not exists (select 1 from public.journal_entries where source_type = 'bank_line' and status = 'posted' and reverses_entry_id is null),
  'undoing a posted bank line also reverses its entry');

select pg_temp.as_user('00000000-0000-4000-8000-000000000502', $q$ select public.bank_statement_delete((select id from st)) $q$);
select pg_temp.check(not exists (select 1 from public.bank_statements where id = (select id from st)), 'an open statement can be deleted');

select pg_temp.check(
  not exists (
    select 1 from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
    where e.status <> 'draft' group by e.id having sum(l.debit_minor) <> sum(l.credit_minor)),
  'the journal still balances');
select pg_temp.check(
  (select sum(closing_minor) from public.trial_balance('2000-01-01', current_date + 1)) = 0,
  'the trial balance closes at zero');

rollback;
