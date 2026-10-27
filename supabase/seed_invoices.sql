-- Invoicing demo data, run after seed.sql, seed_phase2.sql and seed_phase3.sql.
-- Monthly invoices per customer for every month up to three months ago, then
-- receipts:
--   - older invoices paid by bank transfer;
--   - each customer's latest invoice part-paid with a post-dated cheque;
--   - one customer's oldest invoice paid with a cheque that bounced.
-- The last two months and this month stay unbilled, so the "new invoice"
-- screen has loads to work with. All names and numbers are fictional.

do $$
declare
  m date;
  c record;
  ids uuid[];
  inv record;
  last_month date := (date_trunc('month', app.today()) - interval '3 months')::date;
  first_month date := (select date_trunc('month', min(start_date))::date from public.trips);
  bounced_done boolean := false;
begin
  for c in select id from public.clients where is_active order by name loop
    m := first_month;
    while m <= last_month loop
      select array_agg(x.id order by x.start_date) into ids
      from public.trips x
      where x.client_id = c.id and x.status = 'completed' and not x.is_empty_return and x.invoice_id is null
        and x.freight_base_minor > 0 and x.start_date >= m and x.start_date < (m + interval '1 month')::date;
      if ids is not null then
        perform public.create_invoice(c.id, ((m + interval '1 month')::date - 1), ids, 'فاتورة شهرية');
      end if;
      m := (m + interval '1 month')::date;
    end loop;

    for inv in
      select i.id, i.invoice_date, i.total_minor,
             row_number() over (order by i.invoice_date) as n,
             count(*) over () as total_n
      from public.invoices i
      where i.client_id = c.id and i.status = 'issued'
      order by i.invoice_date
    loop
      if inv.n = inv.total_n then
        -- Latest invoice: 60% with a post-dated cheque still in hand.
        insert into public.client_receipts
          (client_id, received_on, method, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status, notes)
        values
          (c.id, least(inv.invoice_date + 15, app.today()), 'cheque', round(inv.total_minor * 0.6),
           (300000 + floor(random() * 99999))::text, 'البنك العربي', app.today() + 20, 'in_hand', 'دفعة على الحساب');
      elsif inv.n = 1 and not bounced_done then
        -- One customer's oldest invoice: a cheque that bounced.
        insert into public.client_receipts
          (client_id, received_on, method, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status,
           cheque_status_on, notes)
        values
          (c.id, inv.invoice_date + 10, 'cheque', inv.total_minor, (400000 + floor(random() * 99999))::text,
           'بنك الإسكان', inv.invoice_date + 25, 'bounced', inv.invoice_date + 27, 'شيك مرتجع - رصيد غير كافٍ');
        bounced_done := true;
      else
        insert into public.client_receipts (client_id, received_on, method, amount_minor, reference_no, notes)
        values (c.id, least(inv.invoice_date + 20, app.today()), 'bank', inv.total_minor,
                'TRF-' || (100000 + floor(random() * 899999))::text, 'تحويل بنكي');
      end if;
    end loop;
  end loop;
end;
$$;

truncate audit.log;
