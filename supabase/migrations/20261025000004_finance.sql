-- Finance: journal (immutable once posted), truck financing.

create type public.journal_status as enum ('draft', 'posted', 'reversed');

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no bigint generated always as identity unique,
  entry_date date not null,
  description text not null,
  status public.journal_status not null default 'draft',
  source_type text,
  source_id uuid,
  reverses_entry_id uuid unique references public.journal_entries (id) on delete restrict,
  reversed_by_entry_id uuid unique references public.journal_entries (id) on delete restrict,
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

comment on column public.journal_entries.source_type is
  'Origin of an auto-posted entry (trip, invoice, expense, payment...). Null for manual entries.';

create index journal_entries_date_idx on public.journal_entries (entry_date);
create index journal_entries_source_idx on public.journal_entries (source_type, source_id);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries (id) on delete cascade,
  line_no smallint not null default 1,
  account_id uuid not null references public.accounts (id) on delete restrict,
  truck_id uuid references public.trucks (id) on delete restrict,
  description text,
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  created_at timestamptz not null default now(),
  constraint journal_lines_one_side check ((debit_minor = 0) <> (credit_minor = 0))
);

comment on table public.journal_lines is 'Amounts in base currency minor units. truck_id null = general (not tied to a truck).';

create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index journal_lines_truck_idx on public.journal_lines (truck_id);
create index journal_lines_account_idx on public.journal_lines (account_id);

-- ---------------------------------------------------------------------------
-- Posting rules
--  * Entries are created as draft.
--  * draft -> posted only when balanced (checked here, whatever the caller).
--  * Posted entries never change, except posted -> reversed when a posted
--    reversal entry points back at them.
--  * Lines can only change while the entry is draft.
-- ---------------------------------------------------------------------------
create function app.guard_journal_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  dr bigint;
  cr bigint;
  n int;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'القيد يُنشأ كمسودة ثم يُرحّل' using errcode = 'check_violation';
    end if;
    new.posted_at := null;
    new.posted_by := null;
    new.reversed_by_entry_id := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'لا يمكن حذف قيد مرحّل؛ استخدم قيد عكسي' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'draft' then
    if new.status = 'reversed' then
      raise exception 'لا يمكن عكس قيد غير مرحّل' using errcode = 'check_violation';
    end if;
    if new.status = 'posted' then
      select coalesce(sum(l.debit_minor), 0), coalesce(sum(l.credit_minor), 0), count(*)
        into dr, cr, n
      from public.journal_lines l where l.entry_id = new.id;
      if n < 2 or dr <> cr or dr = 0 then
        raise exception 'القيد غير متوازن (مدين % / دائن %)', dr, cr using errcode = 'check_violation';
      end if;
      -- A reversal must mirror its original exactly.
      if new.reverses_entry_id is not null and (
        not exists (
          select 1 from public.journal_entries o
          where o.id = new.reverses_entry_id and o.status = 'posted'
        )
        or exists (
          (select l.account_id, l.truck_id, l.debit_minor, l.credit_minor
             from public.journal_lines l where l.entry_id = new.id
           except all
           select o.account_id, o.truck_id, o.credit_minor, o.debit_minor
             from public.journal_lines o where o.entry_id = new.reverses_entry_id)
          union all
          (select o.account_id, o.truck_id, o.credit_minor, o.debit_minor
             from public.journal_lines o where o.entry_id = new.reverses_entry_id
           except all
           select l.account_id, l.truck_id, l.debit_minor, l.credit_minor
             from public.journal_lines l where l.entry_id = new.id)
        )
      ) then
        raise exception 'القيد العكسي يجب أن يطابق القيد الأصلي' using errcode = 'check_violation';
      end if;
      new.posted_at := now();
      new.posted_by := auth.uid();
    end if;
    return new;
  end if;

  if old.status = 'posted'
     and new.status = 'reversed'
     and new.reversed_by_entry_id is not null
     and (to_jsonb(new) - 'status' - 'reversed_by_entry_id')
         = (to_jsonb(old) - 'status' - 'reversed_by_entry_id')
     and exists (
       select 1 from public.journal_entries r
       where r.id = new.reversed_by_entry_id
         and r.reverses_entry_id = old.id
         and r.status = 'posted'
     ) then
    return new;
  end if;

  raise exception 'القيد المرحّل لا يُعدّل؛ استخدم قيد عكسي' using errcode = 'check_violation';
end;
$$;

create trigger journal_entries_guard
  before insert or update or delete on public.journal_entries
  for each row execute function app.guard_journal_entry();

create function app.guard_journal_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st public.journal_status;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select e.status into st from public.journal_entries e where e.id = old.entry_id;
    if st is not null and st <> 'draft' then
      raise exception 'سطور القيد المرحّل لا تُعدّل' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select e.status into st from public.journal_entries e where e.id = new.entry_id;
    if st <> 'draft' then
      raise exception 'لا يمكن إضافة سطور إلى قيد مرحّل' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.accounts a where a.id = new.account_id and a.is_postable) then
      raise exception 'الحساب غير قابل للترحيل (حساب رئيسي)' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  return old;
end;
$$;

create trigger journal_lines_guard
  before insert or update or delete on public.journal_lines
  for each row execute function app.guard_journal_line();

create function public.post_journal_entry(p_entry_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.journal_entries set status = 'posted'
  where id = p_entry_id and status = 'draft';
  if not found then
    raise exception 'القيد غير موجود أو ليس مسودة' using errcode = 'no_data_found';
  end if;
end;
$$;

create function public.reverse_journal_entry(
  p_entry_id uuid,
  p_reason text default null,
  p_date date default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  e public.journal_entries;
  new_id uuid;
begin
  select * into e from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'القيد غير موجود' using errcode = 'no_data_found';
  end if;
  if e.status <> 'posted' then
    raise exception 'يمكن عكس القيود المرحّلة فقط' using errcode = 'check_violation';
  end if;

  insert into public.journal_entries (entry_date, description, reverses_entry_id, source_type, source_id)
  values (
    coalesce(p_date, app.today()),
    'عكس القيد رقم ' || e.entry_no || coalesce(' — ' || nullif(p_reason, ''), ''),
    e.id,
    e.source_type,
    e.source_id
  )
  returning id into new_id;

  insert into public.journal_lines (entry_id, line_no, account_id, truck_id, description, debit_minor, credit_minor)
  select new_id, l.line_no, l.account_id, l.truck_id, l.description, l.credit_minor, l.debit_minor
  from public.journal_lines l where l.entry_id = e.id;

  update public.journal_entries set status = 'posted' where id = new_id;
  update public.journal_entries set status = 'reversed', reversed_by_entry_id = new_id where id = e.id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Truck financing (loans / leasing), base currency
-- ---------------------------------------------------------------------------
create table public.truck_financing (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks (id) on delete restrict,
  kind text not null check (kind in ('loan', 'lease')),
  lender text not null,
  contract_no text,
  start_date date not null,
  term_months integer not null check (term_months > 0),
  principal_base_minor bigint not null check (principal_base_minor > 0),
  annual_rate_pct numeric(6, 3) not null default 0 check (annual_rate_pct >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.financing_installments (
  id uuid primary key default gen_random_uuid(),
  financing_id uuid not null references public.truck_financing (id) on delete cascade,
  installment_no integer not null check (installment_no > 0),
  due_date date not null,
  amount_base_minor bigint not null check (amount_base_minor >= 0),
  principal_base_minor bigint not null check (principal_base_minor >= 0),
  interest_base_minor bigint not null check (interest_base_minor >= 0),
  paid_on date,
  paid_amount_base_minor bigint check (paid_amount_base_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (financing_id, installment_no),
  check (amount_base_minor = principal_base_minor + interest_base_minor)
);

create index financing_installments_due_idx on public.financing_installments (due_date);

-- Build an annuity schedule. Principal parts sum exactly to the principal:
-- the last installment absorbs rounding.
create function public.generate_installments(p_financing_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  f public.truck_financing;
  r numeric;
  payment numeric;
  balance bigint;
  interest bigint;
  principal bigint;
  i integer;
begin
  select * into f from public.truck_financing where id = p_financing_id;
  if not found then
    raise exception 'عقد التمويل غير موجود' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.financing_installments x where x.financing_id = f.id and x.paid_on is not null) then
    raise exception 'لا يمكن إعادة توليد الأقساط بعد تسديد بعضها' using errcode = 'check_violation';
  end if;
  delete from public.financing_installments where financing_id = f.id;

  r := f.annual_rate_pct / 100 / 12;
  if r = 0 then
    payment := f.principal_base_minor::numeric / f.term_months;
  else
    payment := f.principal_base_minor * r / (1 - power(1 + r, -f.term_months));
  end if;

  balance := f.principal_base_minor;
  for i in 1 .. f.term_months loop
    interest := round(balance * r);
    if i = f.term_months then
      principal := balance;
    else
      principal := least(balance, round(payment) - interest);
    end if;
    balance := balance - principal;
    insert into public.financing_installments
      (financing_id, installment_no, due_date, amount_base_minor, principal_base_minor, interest_base_minor)
    values
      (f.id, i, (f.start_date + make_interval(months => i))::date, principal + interest, principal, interest);
  end loop;
  return f.term_months;
end;
$$;

select app.track('public.journal_entries');
select app.track('public.journal_lines');
select app.track('public.truck_financing');
select app.track('public.financing_installments');
