-- Migration 13: reviewed rows are kept, with their receipts.
--
-- Settled expenses and fill-ups could already not be deleted. A reviewed one
-- (approved or rejected by the accountant or manager) now cannot be deleted
-- either, so its receipt file can never be removed with it. Rows entered by
-- the office, which are never reviewed, can still be deleted until settled.

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
    -- A reviewed expense stays, with its receipt; correct it, or reverse it with a new row.
    if old.reviewed_at is not null then
      raise exception 'لا يمكن حذف مصروف تمت مراجعته' using errcode = 'check_violation';
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

create or replace function app.guard_fuel_fillup()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  finance boolean := auth.uid() is null or app.has_role('manager', 'accountant');
  b record;
begin
  if tg_op = 'DELETE' then
    if old.settlement_id is not null then
      raise exception 'التعبئة داخلة في تسوية ولا يمكن حذفها' using errcode = 'check_violation';
    end if;
    -- A reviewed fill-up stays, with its receipt.
    if old.reviewed_at is not null then
      raise exception 'لا يمكن حذف تعبئة تمت مراجعتها' using errcode = 'check_violation';
    end if;
    if not finance and old.status <> 'submitted' then
      raise exception 'حذف التعبئات المعتمدة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Only the manager or accountant record fill-ups that count straight away.
    if not finance then
      new.status := 'submitted';
    end if;
    if new.status = 'submitted' then
      new.submitted_by := coalesce(new.submitted_by, auth.uid());
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
    if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_reason, '')), '') is null then
      raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation';
    end if;
    if new.settlement_id is not null and not app.settling_allows(null, new.settlement_id) then
      raise exception 'لا يمكن إنشاء تعبئة مسوّاة' using errcode = 'check_violation';
    end if;
  else
    -- UPDATE
    if (old.reviewed_at is not null or old.settlement_id is not null)
       and new.receipt_path is distinct from old.receipt_path then
      raise exception 'لا يمكن تغيير إيصال تعبئة تمت مراجعتها أو تسويتها' using errcode = 'check_violation';
    end if;

    if old.settlement_id is not null then
      if (new.driver_id, new.truck_id, new.filled_at, new.odometer, new.liters, new.is_full_tank, new.currency,
          new.amount_minor, new.fx_rate, new.status, new.payment_method, new.settlement_id)
         is distinct from (old.driver_id, old.truck_id, old.filled_at, old.odometer, old.liters, old.is_full_tank, old.currency,
          old.amount_minor, old.fx_rate, old.status, old.payment_method, old.settlement_id) then
        raise exception 'التعبئة داخلة في تسوية ولا يمكن تعديلها' using errcode = 'check_violation';
      end if;
      return new;
    end if;

    if new.settlement_id is not null and not app.settling_allows(old.settlement_id, new.settlement_id) then
      raise exception 'التسوية تتم من شاشة التسويات فقط' using errcode = 'check_violation';
    end if;

    if not finance and old.status <> 'submitted' then
      raise exception 'تعديل التعبئات المعتمدة أو المرفوضة للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
    end if;

    if new.status is distinct from old.status then
      if not app.has_role('manager', 'accountant') then
        raise exception 'اعتماد التعبئات أو رفضها للمدير والمحاسب فقط' using errcode = 'insufficient_privilege';
      end if;
      if new.status = 'submitted' then
        raise exception 'لا يمكن إرجاع التعبئة إلى حالة الانتظار' using errcode = 'check_violation';
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
  end if;

  -- Plausibility, unless the fill-up is being rejected anyway.
  if new.status <> 'rejected' and (
       tg_op = 'INSERT'
       or (new.truck_id, new.filled_at, new.odometer, new.liters, new.status)
          is distinct from (old.truck_id, old.filled_at, old.odometer, old.liters, old.status)) then
    select * into b from app.fuel_odometer_bounds(new.truck_id, new.filled_at, new.id);
    if b.tank_liters is not null and new.liters > b.tank_liters then
      raise exception 'الكمية (% لتر) أكبر من سعة خزان الشاحنة (% لتر)', new.liters, b.tank_liters
        using errcode = 'check_violation';
    end if;
    if b.prev_odometer is not null and new.odometer < b.prev_odometer then
      raise exception 'قراءة العداد (%) أقل من قراءة تعبئة سابقة لهذه الشاحنة (%)', new.odometer, b.prev_odometer
        using errcode = 'check_violation';
    end if;
    if b.next_odometer is not null and new.odometer > b.next_odometer then
      raise exception 'قراءة العداد (%) أعلى من قراءة تعبئة لاحقة لهذه الشاحنة (%)', new.odometer, b.next_odometer
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
