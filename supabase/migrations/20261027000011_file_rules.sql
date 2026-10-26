-- Migration 11: rules for attached files.
--
-- Files moved from Supabase Storage to a private Cloudflare R2 bucket
-- (src/lib/storage.ts). The database keeps only the relative path
-- <user id>/<yyyy-mm>/<uuid>.<ext>, and these rules hold whatever the storage:
--   1. A reviewed or settled expense keeps its receipt (like the row).
--   2. Paths must match the layout exactly.
--   3. A driver can only save a receipt from his own folder.
-- The old Supabase buckets and their policies stay until R2 is confirmed.

-- 1. Receipt frozen once reviewed or settled -------------------------------
create or replace function app.guard_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.settlement_id is not null then
      raise exception 'المصروف داخل في تسوية ولا يمكن حذفه' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.submitted_by := coalesce(new.submitted_by, auth.uid());
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
    if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
      raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation';
    end if;
    if new.settlement_id is not null and not app.settling_allows(null, new.settlement_id) then
      raise exception 'لا يمكن إنشاء مصروف مسوّى' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  -- A reviewed or settled expense keeps its receipt, like the row itself.
  if (old.reviewed_at is not null or old.settlement_id is not null)
     and new.receipt_path is distinct from old.receipt_path then
    raise exception 'لا يمكن تغيير إيصال مصروف تمت مراجعته أو تسويته' using errcode = 'check_violation';
  end if;

  if old.settlement_id is not null then
    if (new.driver_id, new.truck_id, new.expense_date, new.currency, new.amount_minor, new.fx_rate,
        new.status, new.payment_method, new.settlement_id)
       is distinct from (old.driver_id, old.truck_id, old.expense_date, old.currency, old.amount_minor, old.fx_rate,
        old.status, old.payment_method, old.settlement_id) then
      raise exception 'المصروف داخل في تسوية ولا يمكن تعديله' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.settlement_id is not null and not app.settling_allows(old.settlement_id, new.settlement_id) then
    raise exception 'التسوية تتم من شاشة التسويات فقط' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if not app.has_role('manager', 'accountant') then
      raise exception 'اعتماد المصاريف أو رفضها للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'submitted' then
      raise exception 'لا يمكن إرجاع المصروف إلى حالة الانتظار' using errcode = 'check_violation';
    end if;
    if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
      raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation';
    end if;
    if new.status = 'approved' then
      new.rejection_reason := null;
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

-- 2. Path layout --------------------------------------------------------------
alter table public.expenses add constraint expenses_receipt_path_format
  check (receipt_path is null or receipt_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|pdf)$');
alter table public.fuel_fillups add constraint fuel_fillups_receipt_path_format
  check (receipt_path is null or receipt_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|pdf)$');
alter table public.truck_documents add constraint truck_documents_file_path_format
  check (file_path is null or file_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|pdf)$');

-- 3. Drivers: own folder only -------------------------------------------------
alter policy expenses_driver_insert on public.expenses
  with check (
    driver_id = (select app.user_driver_id())
    and cost_scope = 'truck'
    and status = 'submitted'
    and settlement_id is null
    and truck_id in (select app.driver_truck_ids())
    and (receipt_path is null or split_part(receipt_path, '/', 1) = (select auth.uid())::text)
  );

alter policy expenses_driver_update on public.expenses
  using (driver_id = (select app.user_driver_id()) and status = 'submitted' and settlement_id is null)
  with check (
    driver_id = (select app.user_driver_id())
    and cost_scope = 'truck'
    and status = 'submitted'
    and settlement_id is null
    and truck_id in (select app.driver_truck_ids())
    and (receipt_path is null or split_part(receipt_path, '/', 1) = (select auth.uid())::text)
  );

alter policy fuel_fillups_driver_insert on public.fuel_fillups
  with check (
    driver_id = (select app.user_driver_id())
    and truck_id in (select app.driver_truck_ids())
    and (receipt_path is null or split_part(receipt_path, '/', 1) = (select auth.uid())::text)
  );
