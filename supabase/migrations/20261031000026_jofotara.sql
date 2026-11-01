-- Migration 26: JoFotara (نظام الفوترة الوطني الإلكتروني) — sending customer
-- invoices to the Income and Sales Tax Department.
--
--   einvoices     one row per document sent (or to send) to JoFotara: the
--                 invoice itself, and a credit note (فاتورة إرجاع) if a sent
--                 invoice is cancelled. Its id is the UUID sent with it; icv is
--                 the invoice counter (عداد الفواتير). Once accepted
--                 (submitted), JoFotara's number, UUID and QR code are kept and
--                 the row never changes.
--   per-line tax  JoFotara checks that the invoice's tax is the sum of its
--                 lines' tax. New invoices now compute tax line by line
--                 (round(line × rate) per line, summed) and keep each line's
--                 tax; invoices issued before keep their totals and their tax
--                 is spread over the lines exactly when they are sent.
--
-- The API credentials (Client-Id, Secret-Key) are never stored in the
-- database: they are secrets of the server (JOFOTARA_CLIENT_ID,
-- JOFOTARA_SECRET_KEY). The income source sequence (تسلسل مصدر الدخل) from the
-- JoFotara portal is a company setting.

alter table public.company_settings
  add column jofotara_income_source text check (jofotara_income_source ~ '^[0-9]{1,20}$');
comment on column public.company_settings.jofotara_income_source is 'Income source sequence (تسلسل مصدر الدخل) from the JoFotara portal.';

-- ---------------------------------------------------------------------------
-- 1. Tax line by line
-- ---------------------------------------------------------------------------
alter table public.invoice_lines add column vat_minor bigint check (vat_minor >= 0);
comment on column public.invoice_lines.vat_minor is 'Sales tax on this line (JOD fils); null on invoices issued before migration 26.';

-- Same as migration 18, with the tax computed per line.
create or replace function public.create_invoice(
  p_client_id uuid,
  p_invoice_date date,
  p_trip_ids uuid[],
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv uuid := gen_random_uuid();
  c record;
  n integer;
  sub bigint;
  first_day date;
  last_day date;
  rate numeric;
  vat bigint;
begin
  -- API callers must be manager or accountant (the seed runs without a user).
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception 'الفوترة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  if p_trip_ids is null or cardinality(p_trip_ids) = 0 then
    raise exception 'اختر نقلة واحدة على الأقل' using errcode = 'check_violation';
  end if;
  if (select count(distinct t) from unnest(p_trip_ids) t) <> cardinality(p_trip_ids) then
    raise exception 'نقلة مكررة في الفاتورة' using errcode = 'check_violation';
  end if;
  if p_invoice_date is null or p_invoice_date > app.today() then
    raise exception 'تاريخ الفاتورة غير صحيح' using errcode = 'check_violation';
  end if;

  select x.id, x.payment_terms_days, x.vat_exempt into c from public.clients x where x.id = p_client_id;
  if not found then
    raise exception 'الزبون غير موجود' using errcode = 'no_data_found';
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice:' || p_client_id::text));
  perform 1 from public.trips x where x.id = any (p_trip_ids) for update;

  if exists (
    select 1
    from unnest(p_trip_ids) t (id)
    left join public.trips x on x.id = t.id
    where x.id is null or x.client_id is distinct from p_client_id or x.status <> 'completed'
       or x.is_empty_return or x.freight_base_minor <= 0 or x.invoice_id is not null
  ) then
    raise exception 'بعض النقلات المختارة لا تخص هذا الزبون، أو لم تنتهِ، أو مفوترة مسبقاً'
      using errcode = 'check_violation';
  end if;

  rate := case when c.vat_exempt then 0 else (select s.vat_rate_pct from public.company_settings s) end;

  select count(*), sum(x.freight_base_minor), min(x.start_date), max(x.start_date),
         sum(round(x.freight_base_minor * rate / 100))::bigint
  into n, sub, first_day, last_day, vat
  from public.trips x
  where x.id = any (p_trip_ids);

  if p_invoice_date < last_day then
    raise exception 'تاريخ الفاتورة قبل تاريخ آخر نقلة فيها (%)', last_day using errcode = 'check_violation';
  end if;

  insert into public.invoices
    (id, client_id, invoice_date, due_date, period_from, period_to, lines_count,
     subtotal_minor, vat_rate_pct, vat_minor, total_minor, notes)
  values
    (inv, p_client_id, p_invoice_date, p_invoice_date + c.payment_terms_days, first_day, last_day, n,
     sub, rate, vat, sub + vat, nullif(btrim(coalesce(p_notes, '')), ''));

  insert into public.invoice_lines
    (invoice_id, trip_id, line_no, load_date, client_ref, client_doc_no, route, cargo_description,
     cargo_weight_tons, currency, freight_minor, fx_rate, amount_minor, vat_minor)
  select inv, x.id, row_number() over (order by x.start_date, x.client_ref_no, x.trip_no), x.start_date,
         x.client_ref, x.client_doc_no, concat_ws(' ← ', fl.name, tl.name), x.cargo_description,
         x.cargo_weight_tons, x.currency, x.freight_minor, x.fx_rate, x.freight_base_minor,
         round(x.freight_base_minor * rate / 100)::bigint
  from public.trips x
  left join public.locations fl on fl.id = x.from_location_id
  left join public.locations tl on tl.id = x.to_location_id
  where x.id = any (p_trip_ids);

  perform set_config('app.invoicing', 'on', true);
  update public.trips set invoice_id = inv where id = any (p_trip_ids);
  perform set_config('app.invoicing', '', true);

  perform app.post_invoice_row(inv, null);
  return inv;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Documents sent to JoFotara
-- ---------------------------------------------------------------------------
create table public.einvoices (
  id uuid primary key default gen_random_uuid(),
  icv bigint generated always as identity unique,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  kind text not null check (kind in ('invoice', 'credit_note')),
  doc_no text not null unique check (char_length(doc_no) between 1 and 50),
  issue_date date not null,
  reason text check (char_length(reason) <= 300),
  status text not null default 'pending' check (status in ('pending', 'submitted')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text check (char_length(last_error) <= 4000),
  submitted_at timestamptz,
  submitted_by uuid,
  einv_uuid text check (char_length(einv_uuid) <= 100),
  einv_num text check (char_length(einv_num) <= 100),
  einv_qr text check (char_length(einv_qr) <= 8000),
  response jsonb,
  xml_sha256 text check (xml_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (invoice_id, kind),
  check ((status = 'submitted') = (submitted_at is not null)),
  check (kind = 'invoice' or nullif(btrim(coalesce(reason, '')), '') is not null)
);

comment on table public.einvoices is 'Invoices and credit notes sent to JoFotara; id is the UUID sent, icv the invoice counter.';
comment on column public.einvoices.einv_qr is 'QR code text returned by JoFotara, printed on the invoice.';

create index einvoices_status_idx on public.einvoices (status);

-- An accepted document never changes.
create function app.guard_einvoice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'لا يُحذف سجل الفوترة الإلكترونية' using errcode = 'check_violation';
  end if;
  if old.status = 'submitted' then
    raise exception 'الفاتورة مقبولة في نظام الفوترة الوطني ولا تتغير' using errcode = 'check_violation';
  end if;
  if (new.id, new.icv, new.invoice_id, new.kind, new.doc_no, new.issue_date)
     is distinct from (old.id, old.icv, old.invoice_id, old.kind, old.doc_no, old.issue_date) then
    raise exception 'بيانات المستند الإلكتروني ثابتة' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger einvoices_guard before update or delete on public.einvoices
  for each row execute function app.guard_einvoice();

-- The document to send for an invoice: created on first use, then reused (same UUID and counter).
create function public.einvoice_prepare(p_invoice_id uuid, p_kind text)
returns public.einvoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invoices;
  d public.einvoices;
begin
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception 'الفوترة الإلكترونية للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  select * into i from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'الفاتورة غير موجودة' using errcode = 'no_data_found';
  end if;
  select * into d from public.einvoices where invoice_id = i.id and kind = p_kind;
  if found then
    return d;
  end if;
  if p_kind = 'invoice' then
    if i.status <> 'issued' then
      raise exception 'الفاتورة ملغاة؛ لا تُرسل' using errcode = 'check_violation';
    end if;
    insert into public.einvoices (invoice_id, kind, doc_no, issue_date)
    values (i.id, 'invoice', i.invoice_no::text, i.invoice_date)
    returning * into d;
  elsif p_kind = 'credit_note' then
    if i.status <> 'cancelled' or not exists (
      select 1 from public.einvoices x where x.invoice_id = i.id and x.kind = 'invoice' and x.status = 'submitted'
    ) then
      raise exception 'إشعار الإرجاع لفاتورة أُرسلت ثم أُلغيت فقط' using errcode = 'check_violation';
    end if;
    insert into public.einvoices (invoice_id, kind, doc_no, issue_date, reason)
    values (i.id, 'credit_note', 'R-' || i.invoice_no, (i.cancelled_at at time zone
              coalesce((select s.timezone from public.company_settings s), 'Asia/Amman'))::date, i.cancel_reason)
    returning * into d;
  else
    raise exception 'نوع المستند غير صحيح' using errcode = 'check_violation';
  end if;
  return d;
end;
$$;

-- What JoFotara answered. Accepted: its number, UUID and QR are kept for good.
create function public.einvoice_record(
  p_einvoice_id uuid,
  p_accepted boolean,
  p_error text default null,
  p_einv_uuid text default null,
  p_einv_num text default null,
  p_einv_qr text default null,
  p_response jsonb default null,
  p_xml_sha256 text default null
)
returns public.einvoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.einvoices;
begin
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception 'الفوترة الإلكترونية للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
  end if;
  select * into d from public.einvoices where id = p_einvoice_id for update;
  if not found then
    raise exception 'المستند غير موجود' using errcode = 'no_data_found';
  end if;
  if d.status = 'submitted' then
    return d;
  end if;
  update public.einvoices
  set attempts = attempts + 1,
      last_attempt_at = now(),
      last_error = case when p_accepted then null else left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'رُفضت'), 4000) end,
      status = case when p_accepted then 'submitted' else 'pending' end,
      submitted_at = case when p_accepted then now() end,
      submitted_by = case when p_accepted then auth.uid() end,
      einv_uuid = case when p_accepted then left(p_einv_uuid, 100) end,
      einv_num = case when p_accepted then left(p_einv_num, 100) end,
      einv_qr = case when p_accepted then left(p_einv_qr, 8000) end,
      response = p_response,
      xml_sha256 = coalesce(p_xml_sha256, xml_sha256)
  where id = d.id
  returning * into d;
  return d;
end;
$$;

-- Cancelling an invoice already accepted by JoFotara needs a credit note there too.
create function app.einvoice_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status = 'issued' and exists (
    select 1 from public.einvoices x where x.invoice_id = new.id and x.kind = 'invoice' and x.status = 'submitted'
  ) then
    insert into public.einvoices (invoice_id, kind, doc_no, issue_date, reason)
    values (new.id, 'credit_note', 'R-' || new.invoice_no, app.today(), new.cancel_reason)
    on conflict (invoice_id, kind) do nothing;
  end if;
  return null;
end;
$$;

create trigger invoices_einvoice_cancel after update on public.invoices
  for each row execute function app.einvoice_on_cancel();

-- ---------------------------------------------------------------------------
-- 3. RLS, grants, audit: finance reads; writes only through the functions
-- ---------------------------------------------------------------------------
select app.staff_policies('public.einvoices', '{manager,accountant}', '{}');
select app.track('public.einvoices');

revoke execute on function app.guard_einvoice(), app.einvoice_on_cancel() from public, anon, authenticated;
revoke execute on function
  public.einvoice_prepare(uuid, text),
  public.einvoice_record(uuid, boolean, text, text, text, text, jsonb, text)
  from public, anon;
grant execute on function
  public.einvoice_prepare(uuid, text),
  public.einvoice_record(uuid, boolean, text, text, text, text, jsonb, text)
  to authenticated;
