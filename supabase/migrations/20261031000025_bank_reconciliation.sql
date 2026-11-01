-- Migration 25: bank reconciliation (مطابقة كشف البنك).
--
-- The bank's statement is entered (imported from the bank's Excel or CSV
-- file, or typed): its period, the opening balance and one line per movement
-- (+ money into the account, − money out). Each line is matched with the
-- movements on the bank account (1102, or an account under it) in the
-- ledger: one to one, several to one (a deposit of several cheques), or a
-- journal line with its later reversal. A bank line the books do not have
-- yet (charges, interest) is posted from the statement in one step and
-- matched.
--
-- Reconciliation as of the statement's last day D:
--   book balance B      every posted line on the account up to D
--   outstanding O       book lines up to D the bank has not shown by D
--                       (cheques not presented, deposits in transit)
--   unrecorded U        bank lines up to D the books do not have by D
--   difference          bank closing balance − (B − O + U), zero when reconciled
-- Book lines before the first statement that were never matched are taken as
-- cleared before it; the opening entry is a balance, not a movement; an entry
-- reversed on its own day cancels out with its reversal.
--
-- A statement is closed when the difference is zero and every one of its
-- lines is matched; it then never changes, and neither do its matches: a
-- journal entry in one cannot be reversed until the statement is reopened.
-- While a statement is open, reversing an entry in one of its matches undoes
-- the match, so the line shows up again to be matched.

insert into public.accounts (code, name_ar, type, parent_id, is_postable)
select '5204', 'مصاريف وعمولات بنكية', 'expense', p.id, true
from public.accounts p
where p.code = '52' and not exists (select 1 from public.accounts where code = '5204');

-- The bank account itself or a bank account under it.
create function app.is_bank_account(p_account_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.is_postable and a.type = 'asset' and a.code like '1102%'
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. Statements, their lines, matches
-- ---------------------------------------------------------------------------
create table public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  statement_no bigint generated always as identity unique,
  account_id uuid not null references public.accounts (id) on delete restrict,
  period_from date not null,
  period_to date not null,
  opening_balance_minor bigint not null,
  closing_balance_minor bigint not null default 0,
  lines_count integer not null default 0,
  source_name text check (char_length(source_name) <= 200),
  notes text check (char_length(notes) <= 500),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (period_from <= period_to),
  check ((status = 'closed') = (closed_at is not null))
);

comment on table public.bank_statements is 'Bank statements as the bank issued them; amounts in JOD fils, + in the company''s favour.';
comment on column public.bank_statements.closing_balance_minor is 'Opening balance plus the lines; kept by the database.';

create index bank_statements_account_idx on public.bank_statements (account_id, period_from);

create table public.bank_matches (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.bank_statements (id) on delete cascade,
  kind text not null default 'match' check (kind in ('match', 'posted')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

comment on column public.bank_matches.kind is 'match: lines matched by hand or automatically. posted: an entry posted from the bank line.';

create index bank_matches_statement_idx on public.bank_matches (statement_id);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.bank_statements (id) on delete cascade,
  line_no integer not null check (line_no > 0),
  txn_date date not null,
  value_date date,
  description text not null default '' check (char_length(description) <= 300),
  reference text check (char_length(reference) <= 80),
  amount_minor bigint not null check (amount_minor <> 0),
  balance_minor bigint,
  match_id uuid references public.bank_matches (id) on delete set null,
  unique (statement_id, line_no)
);

comment on column public.bank_statement_lines.amount_minor is '+ deposit (money in), − withdrawal (money out), in JOD fils.';
comment on column public.bank_statement_lines.balance_minor is 'Running balance printed by the bank, when the file has it.';

create index bank_statement_lines_match_idx on public.bank_statement_lines (match_id);
create index bank_statement_lines_date_idx on public.bank_statement_lines (statement_id, txn_date);

-- The ledger side of a match.
create table public.bank_match_lines (
  journal_line_id uuid primary key references public.journal_lines (id) on delete restrict,
  match_id uuid not null references public.bank_matches (id) on delete cascade
);

create index bank_match_lines_match_idx on public.bank_match_lines (match_id);

-- Closing balance and line count follow the lines.
create function app.sync_bank_statement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st uuid := coalesce(new.statement_id, old.statement_id);
begin
  update public.bank_statements s
  set closing_balance_minor = s.opening_balance_minor + coalesce((select sum(l.amount_minor) from public.bank_statement_lines l where l.statement_id = st), 0),
      lines_count = (select count(*) from public.bank_statement_lines l where l.statement_id = st)
  where s.id = st;
  return null;
end;
$$;

create trigger bank_statement_lines_sync after insert or update or delete on public.bank_statement_lines
  for each row execute function app.sync_bank_statement();

create function app.guard_bank_statement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.opening_balance_minor is distinct from old.opening_balance_minor) then
    new.closing_balance_minor := new.opening_balance_minor
      + coalesce((select sum(l.amount_minor) from public.bank_statement_lines l where l.statement_id = new.id), 0);
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' and new.status = 'closed'
     and (new.account_id, new.period_from, new.period_to, new.opening_balance_minor, new.closing_balance_minor, new.lines_count)
         is distinct from (old.account_id, old.period_from, old.period_to, old.opening_balance_minor, old.closing_balance_minor, old.lines_count) then
    raise exception 'كشف البنك مطابَق ومغلق؛ أعد فتحه للتعديل' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' and old.status = 'closed' then
    raise exception 'لا يمكن حذف كشف بنك مغلق' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger bank_statements_guard before insert or update or delete on public.bank_statements
  for each row execute function app.guard_bank_statement();

-- A closed statement's lines and matches stay as they are.
create function app.guard_bank_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st text;
begin
  select s.status into st from public.bank_statements s where s.id = coalesce(new.statement_id, old.statement_id);
  if st = 'closed' then
    raise exception 'كشف البنك مطابَق ومغلق؛ أعد فتحه للتعديل' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger bank_statement_lines_guard before insert or update or delete on public.bank_statement_lines
  for each row execute function app.guard_bank_line();
create trigger bank_matches_guard before insert or update or delete on public.bank_matches
  for each row execute function app.guard_bank_line();

-- Reversing a matched entry: refused while its statement is closed, otherwise the match is undone.
create function app.bank_unmatch_reversed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'reversed' and old.status = 'posted' then
    if exists (
      select 1 from public.bank_match_lines ml
      join public.journal_lines l on l.id = ml.journal_line_id
      join public.bank_matches m on m.id = ml.match_id
      join public.bank_statements s on s.id = m.statement_id
      where l.entry_id = new.id and s.status = 'closed'
    ) then
      raise exception 'هذه الحركة مطابَقة مع كشف بنك مغلق؛ أعد فتح الكشف أولاً' using errcode = 'check_violation';
    end if;
    delete from public.bank_matches m
    where m.id in (
      select ml.match_id from public.bank_match_lines ml
      join public.journal_lines l on l.id = ml.journal_line_id
      where l.entry_id = new.id
    );
  end if;
  return new;
end;
$$;

create trigger journal_entries_bank_match before update on public.journal_entries
  for each row execute function app.bank_unmatch_reversed();

-- ---------------------------------------------------------------------------
-- 2. The two sides
-- ---------------------------------------------------------------------------
-- Ledger lines on bank accounts, with their documents and match.
create view public.bank_book_lines_v
with (security_invoker = on) as
select
  l.id,
  l.entry_id,
  l.entry_no,
  l.entry_date,
  l.entry_description,
  l.status,
  l.source_type,
  l.source_id,
  l.reverses_entry_id,
  l.account_id,
  (l.debit_minor - l.credit_minor) as amount_minor,
  l.voucher_no,
  l.notice_no,
  l.cheque_no,
  l.reference_no,
  l.receipt_no,
  l.payment_no,
  l.invoice_no,
  coalesce(l.client_name, l.supplier_name, l.driver_name) as party,
  ml.match_id,
  coalesce(l.source_type = 'opening', false) as is_opening,
  (
    (l.status = 'reversed' and exists (
      select 1 from public.journal_entries r where r.reverses_entry_id = l.entry_id and r.entry_date = l.entry_date))
    or (l.reverses_entry_id is not null and exists (
      select 1 from public.journal_entries o where o.id = l.reverses_entry_id and o.entry_date = l.entry_date))
  ) as is_cancelled
from public.ledger_lines_v l
left join public.bank_match_lines ml on ml.journal_line_id = l.id
where l.account_code like '1102%' and l.account_type = 'asset';

-- When each match is complete: the date of its latest line on either side.
create view public.bank_matches_v
with (security_invoker = on) as
select m.id, m.statement_id, m.kind, s.account_id,
       greatest(
         (select max(bl.txn_date) from public.bank_statement_lines bl where bl.match_id = m.id),
         (select max(e.entry_date) from public.bank_match_lines ml
            join public.journal_lines jl on jl.id = ml.journal_line_id
            join public.journal_entries e on e.id = jl.entry_id
          where ml.match_id = m.id)
       ) as done_on,
       coalesce((select sum(bl.amount_minor) from public.bank_statement_lines bl where bl.match_id = m.id), 0)::bigint as bank_minor,
       coalesce((select sum(jl.debit_minor - jl.credit_minor) from public.bank_match_lines ml
                   join public.journal_lines jl on jl.id = ml.journal_line_id where ml.match_id = m.id), 0)::bigint as book_minor,
       m.created_at
from public.bank_matches m
join public.bank_statements s on s.id = m.statement_id;

-- What is not cleared on one side or the other as of a day (see the header).
create function public.bank_outstanding(p_account_id uuid, p_as_of date)
returns table (
  side text,
  line_id uuid,
  line_date date,
  description text,
  reference text,
  amount_minor bigint,
  match_id uuid,
  entry_no bigint,
  source_type text,
  source_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with start as (
    select min(s.period_from) as d from public.bank_statements s where s.account_id = p_account_id
  )
  select 'book', b.id, b.entry_date, b.entry_description,
         coalesce(b.cheque_no, b.notice_no, b.voucher_no, b.reference_no),
         b.amount_minor, b.match_id, b.entry_no, b.source_type, b.source_id
  from public.bank_book_lines_v b
  left join public.bank_matches_v m on m.id = b.match_id
  where b.account_id = p_account_id and b.entry_date <= p_as_of and not b.is_opening and not b.is_cancelled
    and ((b.match_id is null and b.entry_date >= coalesce((select d from start), b.entry_date)) or m.done_on > p_as_of)
  union all
  select 'bank', l.id, l.txn_date, l.description, l.reference, l.amount_minor, l.match_id, null, null, null
  from public.bank_statement_lines l
  join public.bank_statements s on s.id = l.statement_id
  left join public.bank_matches_v m on m.id = l.match_id
  where s.account_id = p_account_id and l.txn_date <= p_as_of
    and (l.match_id is null or m.done_on > p_as_of)
$$;

-- The reconciliation of one statement, as of its last day.
create function public.bank_reconciliation(p_statement_id uuid)
returns table (
  account_id uuid,
  as_of date,
  bank_balance_minor bigint,
  book_balance_minor bigint,
  outstanding_in_minor bigint,
  outstanding_out_minor bigint,
  unrecorded_in_minor bigint,
  unrecorded_out_minor bigint,
  difference_minor bigint,
  unmatched_lines integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select * from public.bank_statements where id = p_statement_id
  ), o as (
    select x.side, x.amount_minor from s, public.bank_outstanding(s.account_id, s.period_to) x
  ), t as (
    select
      (select closing_balance_minor from s) as bank,
      public.account_balance_before(array[(select account_id from s)], (select period_to from s) + 1) as book,
      coalesce(sum(o.amount_minor) filter (where o.side = 'book' and o.amount_minor > 0), 0) as oin,
      coalesce(-sum(o.amount_minor) filter (where o.side = 'book' and o.amount_minor < 0), 0) as oout,
      coalesce(sum(o.amount_minor) filter (where o.side = 'bank' and o.amount_minor > 0), 0) as uin,
      coalesce(-sum(o.amount_minor) filter (where o.side = 'bank' and o.amount_minor < 0), 0) as uout
    from o
  )
  select (select account_id from s), (select period_to from s), t.bank::bigint, t.book::bigint,
         t.oin::bigint, t.oout::bigint, t.uin::bigint, t.uout::bigint,
         (t.bank - (t.book - (t.oin - t.oout) + (t.uin - t.uout)))::bigint,
         (select count(*) from public.bank_statement_lines l where l.statement_id = p_statement_id and l.match_id is null)::integer
  from t
  where exists (select 1 from s)
$$;

-- ---------------------------------------------------------------------------
-- 3. Entering, matching, posting, closing (manager and accountant)
-- ---------------------------------------------------------------------------
create function app.require_finance(p_message text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is not null and not app.has_role('manager', 'accountant') then
    raise exception '%', p_message using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create function app.open_statement(p_statement_id uuid)
returns public.bank_statements
language plpgsql
set search_path = ''
as $$
declare
  s public.bank_statements;
begin
  select * into s from public.bank_statements where id = p_statement_id for update;
  if not found then
    raise exception 'كشف البنك غير موجود' using errcode = 'no_data_found';
  end if;
  if s.status <> 'open' then
    raise exception 'كشف البنك مطابَق ومغلق؛ أعد فتحه للتعديل' using errcode = 'check_violation';
  end if;
  return s;
end;
$$;

-- A statement with its lines: [{txn_date, value_date, description, reference, amount_minor, balance_minor}, ...]
create function public.bank_statement_create(
  p_account_id uuid,
  p_period_from date,
  p_period_to date,
  p_opening_minor bigint,
  p_lines jsonb,
  p_source_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid := gen_random_uuid();
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  if not app.is_bank_account(p_account_id) then
    raise exception 'اختر حساب البنك' using errcode = 'check_violation';
  end if;
  if p_period_from is null or p_period_to is null or p_period_from > p_period_to or p_period_to > app.today() then
    raise exception 'فترة الكشف غير صحيحة' using errcode = 'check_violation';
  end if;
  if p_opening_minor is null then
    raise exception 'أدخل رصيد أول المدة كما في كشف البنك' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('bank_statement:' || p_account_id::text));
  if exists (
    select 1 from public.bank_statements s
    where s.account_id = p_account_id and s.period_from <= p_period_to and s.period_to >= p_period_from
  ) then
    raise exception 'فترة الكشف تتداخل مع كشف مُدخل سابقاً لنفس الحساب' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'سطور الكشف غير صحيحة' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) j
    where (j->>'txn_date')::date not between p_period_from and p_period_to
       or coalesce((j->>'amount_minor')::bigint, 0) = 0
  ) then
    raise exception 'كل حركة يجب أن تكون ضمن فترة الكشف وبمبلغ' using errcode = 'check_violation';
  end if;

  insert into public.bank_statements (id, account_id, period_from, period_to, opening_balance_minor, source_name, notes)
  values (sid, p_account_id, p_period_from, p_period_to, p_opening_minor,
          nullif(btrim(coalesce(p_source_name, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''));

  insert into public.bank_statement_lines (statement_id, line_no, txn_date, value_date, description, reference, amount_minor, balance_minor)
  select sid, j.ord, (j.v->>'txn_date')::date, (j.v->>'value_date')::date, left(btrim(coalesce(j.v->>'description', '')), 300),
         nullif(left(btrim(coalesce(j.v->>'reference', '')), 80), ''), (j.v->>'amount_minor')::bigint, (j.v->>'balance_minor')::bigint
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as j (v, ord);
  return sid;
end;
$$;

create function public.bank_statement_add_line(
  p_statement_id uuid, p_txn_date date, p_amount_minor bigint, p_description text default '', p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.bank_statements;
  lid uuid;
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  s := app.open_statement(p_statement_id);
  if p_txn_date is null or p_txn_date not between s.period_from and s.period_to then
    raise exception 'تاريخ الحركة خارج فترة الكشف' using errcode = 'check_violation';
  end if;
  if coalesce(p_amount_minor, 0) = 0 then
    raise exception 'أدخل مبلغ الحركة' using errcode = 'check_violation';
  end if;
  insert into public.bank_statement_lines (statement_id, line_no, txn_date, description, reference, amount_minor)
  values (s.id, coalesce((select max(l.line_no) from public.bank_statement_lines l where l.statement_id = s.id), 0) + 1,
          p_txn_date, left(btrim(coalesce(p_description, '')), 300), nullif(left(btrim(coalesce(p_reference, '')), 80), ''), p_amount_minor)
  returning id into lid;
  return lid;
end;
$$;

create function public.bank_statement_delete_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.bank_statement_lines;
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  select * into l from public.bank_statement_lines where id = p_line_id;
  if not found then
    raise exception 'الحركة غير موجودة' using errcode = 'no_data_found';
  end if;
  perform app.open_statement(l.statement_id);
  if l.match_id is not null then
    raise exception 'الحركة مطابَقة؛ ألغِ المطابقة أولاً' using errcode = 'check_violation';
  end if;
  delete from public.bank_statement_lines where id = p_line_id;
end;
$$;

create function public.bank_statement_delete(p_statement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  perform app.open_statement(p_statement_id);
  -- Entries posted from its lines stay in the books (they are real bank movements), unmatched.
  delete from public.bank_statements where id = p_statement_id;
end;
$$;

-- Match bank lines of the statement with ledger lines on the same account.
create function public.bank_match(p_statement_id uuid, p_bank_line_ids uuid[], p_journal_line_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.bank_statements;
  mid uuid := gen_random_uuid();
  nb int := coalesce(cardinality(p_bank_line_ids), 0);
  nj int := coalesce(cardinality(p_journal_line_ids), 0);
  bank_sum bigint;
  book_sum bigint;
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  s := app.open_statement(p_statement_id);
  if nb + nj < 2 then
    raise exception 'اختر حركة من الكشف وحركة من الدفاتر على الأقل' using errcode = 'check_violation';
  end if;
  if (select count(distinct x) from unnest(coalesce(p_bank_line_ids, '{}')) x) <> nb
     or (select count(distinct x) from unnest(coalesce(p_journal_line_ids, '{}')) x) <> nj then
    raise exception 'حركة مكررة في المطابقة' using errcode = 'check_violation';
  end if;
  perform 1 from public.bank_statement_lines where id = any (coalesce(p_bank_line_ids, '{}')) for update;
  if (select count(*) from public.bank_statement_lines l
      where l.id = any (coalesce(p_bank_line_ids, '{}')) and l.statement_id = s.id and l.match_id is null) <> nb then
    raise exception 'بعض حركات الكشف المختارة مطابَقة مسبقاً أو من كشف آخر' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.bank_book_lines_v b
      where b.id = any (coalesce(p_journal_line_ids, '{}')) and b.account_id = s.account_id and b.match_id is null and not b.is_opening) <> nj then
    raise exception 'بعض حركات الدفاتر المختارة مطابَقة مسبقاً أو ليست على حساب البنك' using errcode = 'check_violation';
  end if;
  select coalesce(sum(l.amount_minor), 0) into bank_sum from public.bank_statement_lines l where l.id = any (coalesce(p_bank_line_ids, '{}'));
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into book_sum from public.journal_lines l where l.id = any (coalesce(p_journal_line_ids, '{}'));
  if bank_sum <> book_sum then
    raise exception 'المبلغان غير متساويين: الكشف % والدفاتر %', round(bank_sum / 1000.0, 3), round(book_sum / 1000.0, 3)
      using errcode = 'check_violation';
  end if;

  insert into public.bank_matches (id, statement_id) values (mid, s.id);
  update public.bank_statement_lines set match_id = mid where id = any (coalesce(p_bank_line_ids, '{}'));
  insert into public.bank_match_lines (journal_line_id, match_id) select x, mid from unnest(coalesce(p_journal_line_ids, '{}')) x;
  return mid;
end;
$$;

-- Several one-to-one matches at once: [{"bank": "<line id>", "book": "<journal line id>"}, ...]
create function public.bank_match_pairs(p_statement_id uuid, p_pairs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb;
  n int := 0;
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  for p in select * from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    perform public.bank_match(p_statement_id, array[(p->>'bank')::uuid], array[(p->>'book')::uuid]);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Undo a match. One made by posting a bank line also reverses that entry.
create function public.bank_unmatch(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.bank_matches;
  posted uuid;
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  select * into m from public.bank_matches where id = p_match_id;
  if not found then
    raise exception 'المطابقة غير موجودة' using errcode = 'no_data_found';
  end if;
  perform app.open_statement(m.statement_id);
  select l.id into posted from public.bank_statement_lines l where l.match_id = m.id and m.kind = 'posted' limit 1;
  delete from public.bank_matches where id = m.id;
  if posted is not null then
    perform app.sync_source_entry('bank_line', posted, null, null, null, 'إلغاء قيد من كشف البنك');
  end if;
end;
$$;

-- Post a bank line the books do not have (charges, interest, ...) against an account, and match it.
create function public.bank_post_line(p_line_id uuid, p_account_id uuid, p_description text default null, p_truck_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.bank_statement_lines;
  s public.bank_statements;
  acc record;
  amt bigint;
  entry uuid;
  mid uuid := gen_random_uuid();
  descr text;
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  select * into l from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'الحركة غير موجودة' using errcode = 'no_data_found';
  end if;
  s := app.open_statement(l.statement_id);
  if l.match_id is not null then
    raise exception 'الحركة مطابَقة مسبقاً' using errcode = 'check_violation';
  end if;
  select a.id, a.code, a.is_postable, a.type into acc from public.accounts a where a.id = p_account_id;
  if acc.id is null or not acc.is_postable then
    raise exception 'اختر حساباً فرعياً يقبل القيود' using errcode = 'check_violation';
  end if;
  if acc.code like '1102%' or acc.code in ('1103', '1104', '1105', '2101', '2102') then
    raise exception 'حركات الزبائن والموردين والعهد والشيكات تُسجّل من أقسامها ثم تُطابق' using errcode = 'check_violation';
  end if;
  if p_truck_id is not null and not exists (select 1 from public.trucks t where t.id = p_truck_id) then
    raise exception 'الشاحنة غير موجودة' using errcode = 'check_violation';
  end if;

  amt := abs(l.amount_minor);
  descr := 'من كشف البنك رقم ' || s.statement_no || ' — '
           || coalesce(nullif(btrim(coalesce(p_description, '')), ''), nullif(l.description, ''), 'حركة بنكية');
  perform app.sync_source_entry(
    'bank_line', l.id, l.txn_date, left(descr, 300),
    case when l.amount_minor > 0 then
      jsonb_build_array(app.jline(s.account_id, amt, 0), app.jline(acc.id, 0, amt, p_truck_id => p_truck_id))
    else
      jsonb_build_array(app.jline(acc.id, amt, 0, p_truck_id => p_truck_id), app.jline(s.account_id, 0, amt))
    end,
    null);
  select e.id into entry from public.journal_entries e
  where e.source_type = 'bank_line' and e.source_id = l.id and e.status = 'posted' and e.reverses_entry_id is null
  order by e.entry_no desc limit 1;

  insert into public.bank_matches (id, statement_id, kind) values (mid, s.id, 'posted');
  update public.bank_statement_lines set match_id = mid where id = l.id;
  insert into public.bank_match_lines (journal_line_id, match_id)
  select jl.id, mid from public.journal_lines jl where jl.entry_id = entry and jl.account_id = s.account_id;
  return entry;
end;
$$;

create function public.bank_statement_close(p_statement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  perform app.open_statement(p_statement_id);
  select * into r from public.bank_reconciliation(p_statement_id);
  if r.unmatched_lines > 0 then
    raise exception 'بقيت % حركة في الكشف غير مطابَقة؛ طابقها أو سجّلها في الدفاتر', r.unmatched_lines using errcode = 'check_violation';
  end if;
  if r.difference_minor <> 0 then
    raise exception 'الفرق % دينار؛ لا يُغلق الكشف قبل أن يصبح الفرق صفراً', round(r.difference_minor / 1000.0, 3)
      using errcode = 'check_violation';
  end if;
  update public.bank_statements set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_statement_id;
end;
$$;

create function public.bank_statement_reopen(p_statement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_finance('مطابقة البنك للمدير والمحاسب فقط');
  update public.bank_statements set status = 'open', closed_at = null, closed_by = null
  where id = p_statement_id and status = 'closed';
  if not found then
    raise exception 'الكشف غير موجود أو مفتوح أصلاً' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS, grants, audit. Reads for the manager and the accountant; writes
--    only through the functions above.
-- ---------------------------------------------------------------------------
select app.staff_policies('public.bank_statements', '{manager,accountant}', '{}');
select app.staff_policies('public.bank_statement_lines', '{manager,accountant}', '{}');
select app.staff_policies('public.bank_matches', '{manager,accountant}', '{}');
select app.staff_policies('public.bank_match_lines', '{manager,accountant}', '{}');

select app.track('public.bank_statements');
select app.track('public.bank_statement_lines');
select app.track('public.bank_matches');
select app.track('public.bank_match_lines');

revoke execute on function
  app.sync_bank_statement(), app.guard_bank_statement(), app.guard_bank_line(), app.bank_unmatch_reversed(),
  app.require_finance(text), app.open_statement(uuid)
  from public, anon, authenticated;
grant execute on function app.is_bank_account(uuid) to authenticated;
revoke execute on function
  public.bank_outstanding(uuid, date), public.bank_reconciliation(uuid),
  public.bank_statement_create(uuid, date, date, bigint, jsonb, text, text),
  public.bank_statement_add_line(uuid, date, bigint, text, text), public.bank_statement_delete_line(uuid),
  public.bank_statement_delete(uuid), public.bank_match(uuid, uuid[], uuid[]), public.bank_match_pairs(uuid, jsonb),
  public.bank_unmatch(uuid), public.bank_post_line(uuid, uuid, text, uuid),
  public.bank_statement_close(uuid), public.bank_statement_reopen(uuid)
  from public, anon;
grant execute on function
  public.bank_outstanding(uuid, date), public.bank_reconciliation(uuid),
  public.bank_statement_create(uuid, date, date, bigint, jsonb, text, text),
  public.bank_statement_add_line(uuid, date, bigint, text, text), public.bank_statement_delete_line(uuid),
  public.bank_statement_delete(uuid), public.bank_match(uuid, uuid[], uuid[]), public.bank_match_pairs(uuid, jsonb),
  public.bank_unmatch(uuid), public.bank_post_line(uuid, uuid, text, uuid),
  public.bank_statement_close(uuid), public.bank_statement_reopen(uuid)
  to authenticated;
