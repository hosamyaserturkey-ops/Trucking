-- Migration 20: payments to suppliers (سند صرف لمورد), and the cheques we issue.
--
-- Expenses and fill-ups bought on credit sit on 2101 suppliers payable, per
-- supplier. A payment settles that balance:
--   payment       Dr 2101 suppliers (the supplier)   Cr cash 1101 / bank 1102 /
--                                                    post-dated cheques 2102 (the supplier) /
--                                                    discount received 4104
--   cheque        cleared: Dr 2102, Cr bank 1102;
--                 bounced (not paid by our bank): Dr 2102, Cr 2101 (back on the supplier)
--
-- Same rules as migrations 17 and 18: posted entries never change; a change
-- reverses the old entry on its own date and posts a new one. The payment
-- voucher number from the paper book is shared with expenses, fill-ups and
-- advances, so one number is used once.

-- Discount a supplier gives us (خصم مكتسب) is other income.
insert into public.accounts (code, name_ar, type, parent_id, is_postable)
select '4104', 'خصم مكتسب', 'revenue', p.id, true
from public.accounts p
where p.code = '4' and not exists (select 1 from public.accounts where code = '4104');

-- ---------------------------------------------------------------------------
-- 1. Payments
-- ---------------------------------------------------------------------------
create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  payment_no bigint generated always as identity unique,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  paid_on date not null,
  method text not null check (method in ('cash', 'bank', 'cheque', 'discount')),
  amount_minor bigint not null check (amount_minor > 0),
  voucher_no text check (voucher_no = btrim(voucher_no) and char_length(voucher_no) between 1 and 30),
  reference_no text check (char_length(reference_no) <= 60),
  cheque_no text check (char_length(cheque_no) <= 30),
  cheque_bank text check (char_length(cheque_bank) <= 60),
  cheque_due_date date,
  cheque_status text check (cheque_status in ('issued', 'cleared', 'bounced')),
  cheque_status_on date,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check ((method = 'cheque') = (cheque_no is not null and cheque_due_date is not null and cheque_status is not null)),
  check (method = 'cheque' or (cheque_no is null and cheque_bank is null and cheque_due_date is null
                              and cheque_status is null and cheque_status_on is null)),
  check ((cheque_status is null or cheque_status = 'issued') = (cheque_status_on is null)),
  check (cheque_status_on is null or cheque_status_on >= paid_on)
);

comment on table public.supplier_payments is 'Payments to suppliers: cash, bank transfer, cheques we issue, discounts received.';
comment on column public.supplier_payments.amount_minor is 'Amount in JOD fils.';
comment on column public.supplier_payments.voucher_no is 'Payment voucher number (سند صرف) from the paper book; unique across expenses, fill-ups, advances and payments.';
comment on column public.supplier_payments.cheque_bank is 'Our bank the cheque is drawn on.';
comment on column public.supplier_payments.cheque_status_on is 'Day the cheque was paid by the bank or bounced.';

create index supplier_payments_supplier_date_idx on public.supplier_payments (supplier_id, paid_on);
create index supplier_payments_cheques_idx on public.supplier_payments (cheque_status, cheque_due_date) where method = 'cheque';

create trigger supplier_payments_voucher after insert or update or delete on public.supplier_payments
  for each row execute function app.track_voucher('supplier_payment');

-- ---------------------------------------------------------------------------
-- 2. Posting
-- ---------------------------------------------------------------------------
create function app.post_supplier_payment_row(p public.supplier_payments, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier text := coalesce((select s.name from public.suppliers s where s.id = p.supplier_id), '');
  credit_code text := case p.method when 'cash' then '1101' when 'bank' then '1102' when 'cheque' then '2102' else '4104' end;
  issued uuid := app.account_by_code('2102');
begin
  perform app.sync_source_entry(
    'supplier_payment', p.id, p.paid_on,
    'دفعة لمورد رقم ' || p.payment_no || ' — ' || supplier
      || case p.method when 'cash' then ' (نقداً)' when 'bank' then ' (تحويل بنكي)'
                       when 'cheque' then ' (شيك رقم ' || p.cheque_no || ')' else ' (خصم مكتسب)' end,
    jsonb_build_array(
      app.jline(app.account_by_code('2101'), p.amount_minor, 0, p_supplier_id => p.supplier_id),
      app.jline(app.account_by_code(credit_code), 0, p.amount_minor,
                p_supplier_id => case when p.method = 'cheque' then p.supplier_id end)),
    p_reason);

  -- A cheque leaves "post-dated cheques" when the bank pays it, or goes back
  -- onto the supplier's account when it bounces.
  perform app.sync_source_entry(
    'issued_cheque', p.id, p.cheque_status_on,
    case p.cheque_status when 'cleared' then 'صرف شيك صادر رقم ' else 'شيك صادر مرتجع رقم ' end
      || coalesce(p.cheque_no, '') || ' — ' || supplier,
    case
      when p.method = 'cheque' and p.cheque_status = 'cleared' then
        jsonb_build_array(app.jline(issued, p.amount_minor, 0, p_supplier_id => p.supplier_id),
                          app.jline(app.account_by_code('1102'), 0, p.amount_minor))
      when p.method = 'cheque' and p.cheque_status = 'bounced' then
        jsonb_build_array(app.jline(issued, p.amount_minor, 0, p_supplier_id => p.supplier_id),
                          app.jline(app.account_by_code('2101'), 0, p.amount_minor, p_supplier_id => p.supplier_id))
    end,
    coalesce(p_reason, 'تغيير حالة الشيك'));
end;
$$;

create function app.post_supplier_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.sync_source_entry('issued_cheque', old.id, null, null, null, 'حذف دفعة المورد');
    perform app.sync_source_entry('supplier_payment', old.id, null, null, null, 'حذف دفعة المورد');
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.supplier_id, new.paid_on, new.method, new.amount_minor, new.cheque_no, new.cheque_status, new.cheque_status_on)
         is not distinct from
         (old.supplier_id, old.paid_on, old.method, old.amount_minor, old.cheque_no, old.cheque_status, old.cheque_status_on) then
    return null;
  end if;
  perform app.post_supplier_payment_row(new, case when tg_op = 'UPDATE' then 'تعديل دفعة المورد' end);
  return null;
end;
$$;

create trigger supplier_payments_post after insert or update or delete on public.supplier_payments
  for each row execute function app.post_supplier_payment();

-- ---------------------------------------------------------------------------
-- 3. What we owe each supplier, from the ledger (2101): bought on credit
--    (expenses and fill-ups, net of reversals) less what was paid.
-- ---------------------------------------------------------------------------
create view public.supplier_balance_v
with (security_invoker = on) as
with led as (
  select l.supplier_id,
         sum(l.credit_minor - l.debit_minor)
           filter (where e.source_type is distinct from 'supplier_payment' and e.source_type is distinct from 'issued_cheque') as bought,
         sum(l.debit_minor - l.credit_minor)
           filter (where e.source_type in ('supplier_payment', 'issued_cheque')) as paid,
         max(e.entry_date)
           filter (where e.source_type is distinct from 'supplier_payment' and e.source_type is distinct from 'issued_cheque'
                   and l.credit_minor > 0) as last_purchase
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  join public.accounts a on a.id = l.account_id
  where a.code = '2101' and e.status <> 'draft' and l.supplier_id is not null
  group by l.supplier_id
), pay as (
  select p.supplier_id,
         sum(p.amount_minor) filter (where p.cheque_status = 'issued') as cheques_pending,
         count(*) filter (where p.cheque_status = 'issued') as cheques_count,
         max(p.paid_on) as last_payment
  from public.supplier_payments p
  group by p.supplier_id
)
select s.id as supplier_id,
       s.name,
       s.kind,
       s.is_active,
       coalesce(led.bought, 0)::bigint as bought_minor,
       coalesce(led.paid, 0)::bigint as paid_minor,
       (coalesce(led.bought, 0) - coalesce(led.paid, 0))::bigint as balance_minor,
       coalesce(pay.cheques_pending, 0)::bigint as cheques_pending_minor,
       coalesce(pay.cheques_count, 0)::integer as cheques_pending_count,
       led.last_purchase,
       pay.last_payment
from public.suppliers s
left join led on led.supplier_id = s.id
left join pay on pay.supplier_id = s.id;

-- ---------------------------------------------------------------------------
-- 4. The ledger shows payment and cheque numbers (same columns, plus one)
-- ---------------------------------------------------------------------------
create or replace view public.ledger_lines_v
with (security_invoker = on) as
select
  l.id,
  l.entry_id,
  e.entry_no,
  e.entry_date,
  e.description as entry_description,
  e.status,
  e.source_type,
  e.source_id,
  e.reverses_entry_id,
  l.line_no,
  l.account_id,
  a.code as account_code,
  a.name_ar as account_name,
  a.type as account_type,
  l.truck_id,
  t.code as truck_code,
  l.supplier_id,
  s.name as supplier_name,
  l.driver_id,
  d.full_name as driver_name,
  l.client_id,
  c.name as client_name,
  l.debit_minor,
  l.credit_minor,
  coalesce(xe.voucher_no, xf.voucher_no, xa.voucher_no, xp.voucher_no) as voucher_no,
  xe.customs_declaration_no,
  coalesce(xe.notice_no, xf.notice_no, xa.notice_no, xr.reference_no, xp.reference_no) as notice_no,
  xe.reference_no,
  coalesce(xe.notes, xf.notes, xa.notes, xr.notes, xi.notes, xp.notes) as notes,
  xi.invoice_no,
  xr.receipt_no,
  coalesce(xr.cheque_no, xp.cheque_no) as cheque_no,
  xp.payment_no
from public.journal_lines l
join public.journal_entries e on e.id = l.entry_id
join public.accounts a on a.id = l.account_id
left join public.trucks t on t.id = l.truck_id
left join public.suppliers s on s.id = l.supplier_id
left join public.drivers d on d.id = l.driver_id
left join public.clients c on c.id = l.client_id
left join public.expenses xe on e.source_type = 'expense' and xe.id = e.source_id
left join public.fuel_fillups xf on e.source_type = 'fuel' and xf.id = e.source_id
left join public.driver_advances xa on e.source_type = 'advance' and xa.id = e.source_id
left join public.invoices xi on e.source_type = 'invoice' and xi.id = e.source_id
left join public.client_receipts xr on e.source_type in ('receipt', 'cheque') and xr.id = e.source_id
left join public.supplier_payments xp on e.source_type in ('supplier_payment', 'issued_cheque') and xp.id = e.source_id
where e.status <> 'draft';

-- ---------------------------------------------------------------------------
-- 5. RLS, grants, audit
-- ---------------------------------------------------------------------------
select app.staff_policies('public.supplier_payments', '{manager,accountant}', '{manager,accountant}');
select app.track('public.supplier_payments');

revoke execute on function
  app.post_supplier_payment_row(public.supplier_payments, text), app.post_supplier_payment()
  from public, anon, authenticated;
