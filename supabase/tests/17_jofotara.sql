-- JoFotara: per-line sales tax and the e-invoice records (migration 26).
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

create function pg_temp.as_user_value(uid uuid, query text) returns text
language plpgsql as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute query into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;

grant execute on function pg_temp.as_user_raises(uuid, text), pg_temp.as_user_value(uuid, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000601', 'jo-manager@example.test'),
  ('00000000-0000-4000-8000-000000000602', 'jo-accountant@example.test'),
  ('00000000-0000-4000-8000-000000000603', 'jo-dispatcher@example.test');
update public.profiles set role = 'accountant' where user_id = '00000000-0000-4000-8000-000000000602';
update public.profiles set role = 'dispatcher' where user_id = '00000000-0000-4000-8000-000000000603';

-- Per-line tax --------------------------------------------------------------------------
-- A customer's finished loads, with odd amounts so rounding matters: 100.003 + 100.003 at 16%.
create temp table ix as
select client_id, array_agg(id order by start_date) as loads
from (
  select client_id, id, start_date, row_number() over (partition by client_id order by start_date) as rn
  from public.trips
  where status = 'completed' and not is_empty_return and invoice_id is null and client_id is not null
) t
where rn <= 2
group by client_id
having count(*) = 2
order by client_id
limit 1;
grant select on ix to authenticated;
alter table public.trips disable trigger trips_guard_invoiced;
update public.trips set currency = 'JOD', fx_rate = 1, freight_minor = 100003 where id = any ((select loads from ix)::uuid[]);
alter table public.trips enable trigger trips_guard_invoiced;
update public.clients set vat_exempt = false where id = (select client_id from ix);

create temp table inv as
select pg_temp.as_user_value('00000000-0000-4000-8000-000000000602',
  'select public.create_invoice((select client_id from ix), app.today(), (select loads from ix))')::uuid as id;
grant select on inv to authenticated;

select pg_temp.check(
  (select array_agg(vat_minor order by line_no) from public.invoice_lines where invoice_id = (select id from inv)) = array[16000, 16000]::bigint[]
  and (select vat_minor from public.invoices where id = (select id from inv)) = 32000,
  'tax is worked out line by line: 16.000 + 16.000, not 16% of the total (32.001)');
select pg_temp.check(
  (select total_minor = subtotal_minor + vat_minor from public.invoices where id = (select id from inv)),
  'the total still adds up');
select pg_temp.check(
  (select sum(credit_minor) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
   join public.accounts a on a.id = l.account_id
   where e.source_type = 'invoice' and e.source_id = (select id from inv) and e.status = 'posted' and a.code = '2104') = 32000,
  'and that is the tax posted');

-- The document sent to JoFotara ---------------------------------------------------------------
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000603', $q$ select public.einvoice_prepare((select id from inv), 'invoice') $q$),
  'a dispatcher cannot send invoices');
create temp table doc as
select (public.einvoice_prepare((select id from inv), 'invoice')).*;
grant select on doc to authenticated;
select pg_temp.check(
  (select status = 'pending' and doc_no = (select invoice_no::text from public.invoices where id = (select id from inv)) and icv > 0 from doc),
  'preparing it numbers it with the invoice number and the next counter');
select pg_temp.check(
  pg_temp.as_user_value('00000000-0000-4000-8000-000000000602', $q$ select (public.einvoice_prepare((select id from inv), 'invoice')).id $q$)::uuid
  = (select id from doc),
  'preparing it again gives the same document (same UUID and counter)');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000602', $q$ select public.einvoice_prepare((select id from inv), 'credit_note') $q$),
  'no credit note for an invoice that was neither sent nor cancelled');

select pg_temp.as_user_value('00000000-0000-4000-8000-000000000602', $q$
  select (public.einvoice_record((select id from doc), false, 'Buyer tax number is not valid', p_response => '{"EINV_STATUS":"NOT_SUBMITTED"}'::jsonb)).status
$q$);
select pg_temp.check(
  (select status = 'pending' and attempts = 1 and last_error = 'Buyer tax number is not valid' from public.einvoices where id = (select id from doc)),
  'a rejection is kept with its reason, still to send');

select pg_temp.as_user_value('00000000-0000-4000-8000-000000000602', $q$
  select (public.einvoice_record((select id from doc), true, null, 'f6c3-uuid', 'EIN-777', 'QR-BASE64', '{"EINV_STATUS":"SUBMITTED"}'::jsonb)).status
$q$);
select pg_temp.check(
  (select status = 'submitted' and attempts = 2 and last_error is null and einv_num = 'EIN-777' and einv_qr = 'QR-BASE64'
          and submitted_by = '00000000-0000-4000-8000-000000000602'
   from public.einvoices where id = (select id from doc)),
  'accepted: JoFotara''s number and QR code are kept');
select pg_temp.as_user_value('00000000-0000-4000-8000-000000000602', $q$
  select (public.einvoice_record((select id from doc), false, 'late error')).status
$q$);
select pg_temp.check(
  (select status = 'submitted' and einv_qr = 'QR-BASE64' from public.einvoices where id = (select id from doc)),
  'an accepted document never goes back');
-- No write policy: the update touches nothing (RLS), and the owner's would be refused by the guard.
select pg_temp.as_user_raises('00000000-0000-4000-8000-000000000601', $q$ update public.einvoices set einv_qr = 'x' $q$);
select pg_temp.check(
  (select einv_qr from public.einvoices where id = (select id from doc)) = 'QR-BASE64'
  and pg_temp.as_user_raises('00000000-0000-4000-8000-000000000601', $q$ select public.einvoice_record((select id from doc), true, null, 'x', 'x', 'x') $q$) = false
  and (select einv_qr from public.einvoices where id = (select id from doc)) = 'QR-BASE64',
  'and cannot be written directly');
do $$
begin
  update public.einvoices set einv_qr = 'x' where einv_qr = 'QR-BASE64';
  raise exception 'FAIL: the guard let an accepted document change';
exception when check_violation then
  raise notice 'PASS: even the database owner cannot change an accepted document';
end;
$$;
select pg_temp.check(
  pg_temp.as_user_value('00000000-0000-4000-8000-000000000603', 'select count(*) from public.einvoices')::int = 0,
  'a dispatcher sees no e-invoices');

-- Cancelling a sent invoice ----------------------------------------------------------------------
select pg_temp.as_user_value('00000000-0000-4000-8000-000000000602', $q$
  select public.cancel_invoice((select id from inv), 'خطأ في الأجرة')::text
$q$);
select pg_temp.check(
  (select status = 'pending' and doc_no = 'R-' || (select invoice_no from public.invoices where id = (select id from inv)) and reason = 'خطأ في الأجرة'
   from public.einvoices where invoice_id = (select id from inv) and kind = 'credit_note'),
  'cancelling a sent invoice leaves a credit note to send, with the reason');
select pg_temp.check(
  pg_temp.as_user_value('00000000-0000-4000-8000-000000000602', $q$ select (public.einvoice_prepare((select id from inv), 'credit_note')).kind $q$) = 'credit_note',
  'which is the one prepared for sending');
select pg_temp.check(
  pg_temp.as_user_raises('00000000-0000-4000-8000-000000000602', $q$ select public.einvoice_prepare((select id from inv), 'other') $q$),
  'only invoices and credit notes');

rollback;
