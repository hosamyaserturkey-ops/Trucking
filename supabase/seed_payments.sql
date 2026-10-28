-- Supplier payments demo data, run after the other seeds. For each supplier
-- with something bought on credit, each month's purchases are paid on the
-- 10th of the next month:
--   - by bank transfer, except:
--   - last month's purchases: a post-dated cheque the bank has not paid yet;
--   - one supplier's purchases two months ago: a cheque already paid, less
--     a small discount the supplier gave.
-- This month's purchases stay owed. All names and numbers are fictional.

do $$
declare
  s record;
  m record;
  cleared_done boolean := false;
  v int := 7000;
  this_month date := date_trunc('month', app.today())::date;
  pay_day date;
begin
  for s in select supplier_id from public.supplier_balance_v where balance_minor > 0 order by name loop
    for m in
      select date_trunc('month', e.entry_date)::date as month, sum(l.credit_minor - l.debit_minor) as amount
      from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id
      join public.accounts a on a.id = l.account_id
      where a.code = '2101' and l.supplier_id = s.supplier_id
        and e.source_type in ('expense', 'fuel') and e.entry_date < this_month
      group by 1
      having sum(l.credit_minor - l.debit_minor) > 0
      order by 1
    loop
      pay_day := least((m.month + interval '1 month')::date + 9, app.today());
      v := v + 1;
      if m.month = (this_month - interval '1 month')::date then
        insert into public.supplier_payments
          (supplier_id, paid_on, method, amount_minor, voucher_no, cheque_no, cheque_bank, cheque_due_date, cheque_status, notes)
        values
          (s.supplier_id, pay_day, 'cheque', m.amount, v::text, (600000 + v)::text, 'البنك العربي', pay_day + 30, 'issued',
           'مشتريات شهر ' || to_char(m.month, 'MM/YYYY'));
      elsif not cleared_done and m.month = (this_month - interval '2 months')::date then
        cleared_done := true;
        insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, notes)
        values (s.supplier_id, pay_day, 'discount', 5000, 'خصم على مشتريات شهر ' || to_char(m.month, 'MM/YYYY'));
        insert into public.supplier_payments
          (supplier_id, paid_on, method, amount_minor, voucher_no, cheque_no, cheque_bank, cheque_due_date, cheque_status,
           cheque_status_on, notes)
        values
          (s.supplier_id, pay_day, 'cheque', m.amount - 5000, v::text, (600000 + v)::text, 'البنك العربي', pay_day + 15,
           'cleared', least(pay_day + 15, app.today()), 'مشتريات شهر ' || to_char(m.month, 'MM/YYYY'));
      else
        insert into public.supplier_payments (supplier_id, paid_on, method, amount_minor, voucher_no, reference_no, notes)
        values (s.supplier_id, pay_day, 'bank', m.amount, v::text, 'TRF-' || (200000 + v)::text,
                'مشتريات شهر ' || to_char(m.month, 'MM/YYYY'));
      end if;
    end loop;
  end loop;
end;
$$;

truncate audit.log;
