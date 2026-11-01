-- Demo data for presenting the system. All names are fictional.
-- Deterministic (setseed) and relative to the day it runs: about six months
-- of history ending today. Remove with supabase/reset_demo.sql before go-live.

select setseed(0.4242);

create function pg_temp.rint(lo integer, hi integer) returns integer
language sql volatile as $$ select lo + floor(random() * (hi - lo + 1))::integer $$;

create function pg_temp.rnum(lo numeric, hi numeric) returns numeric
language sql volatile as $$ select lo + (hi - lo) * random()::numeric $$;

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
insert into public.locations (name, country, is_border_crossing) values
  ('عمّان', 'الأردن', false),
  ('الزرقاء', 'الأردن', false),
  ('إربد', 'الأردن', false),
  ('العقبة', 'الأردن', false),
  ('المفرق', 'الأردن', false),
  ('معان', 'الأردن', false),
  ('الكرك', 'الأردن', false),
  ('مركز حدود العمري', 'الأردن', true),
  ('الرياض', 'السعودية', false),
  ('الدمام', 'السعودية', false);

insert into public.clients (name, tax_number, phone, city, payment_terms_days, default_currency) values
  ('شركة السهل الأخضر للأغذية',      '10010001', '0790000101', 'عمّان',   30, 'JOD'),
  ('مصنع الفجر للبلاستيك',           '10010002', '0790000102', 'الزرقاء', 45, 'JOD'),
  ('شركة الراية لتجارة الحديد',       '10010003', '0790000103', 'العقبة',  30, 'JOD'),
  ('مؤسسة الجسر للتخليص',            '10010004', '0790000104', 'العقبة',  15, 'JOD'),
  ('شركة البوادي لمواد البناء',       '10010005', '0790000105', 'معان',    60, 'JOD'),
  ('شركة نسيم للمنظفات',             '10010006', '0790000106', 'إربد',    30, 'JOD'),
  ('مجموعة الأفق للتجارة الدولية',    '10010007', '0790000107', 'عمّان',   30, 'USD'),
  ('شركة الميناء الذهبي للاستيراد',   '10010008', '0790000108', 'الزرقاء', 45, 'USD');

insert into public.suppliers (name, kind, phone, city) values
  ('محطة وقود الطريق الصحراوي',     'fuel_station', '0790000201', 'القطرانة'),
  ('محطة وقود الزرقاء الشمالية',    'fuel_station', '0790000202', 'الزرقاء'),
  ('محطة وقود ميناء العقبة',        'fuel_station', '0790000203', 'العقبة'),
  ('محطة وقود حدودية (السعودية)',   'fuel_station', '0790000204', 'الحديثة'),
  ('ورشة الأمانة لصيانة الشاحنات',  'workshop',     '0790000205', 'الزرقاء'),
  ('مركز الخبراء للصيانة الثقيلة',  'workshop',     '0790000206', 'عمّان'),
  ('قطع غيار الشاحنات الحديثة',     'parts',        '0790000207', 'الزرقاء'),
  ('شركة الإطار الذهبي',            'tires',        '0790000208', 'عمّان');

insert into public.trucks (code, plate_number, make, model, year, vin, truck_type, expected_km_per_liter, fuel_tank_liters)
select
  'T-' || lpad(i::text, 2, '0'),
  (array['50', '51', '52'])[1 + (i % 3)] || '-' || (10000 + i * 731)::text,
  m.make,
  m.model,
  2016 + (i % 9),
  'DEMO' || lpad((i * 7919)::text, 13, '0'),
  case when i <= 4 then 'رأس تريلا - نقل دولي' else 'رأس تريلا' end,
  case when i % 3 = 0 then null else round(pg_temp.rnum(2.5, 3.1), 2) end,
  case when i <= 4 then 1000 else 600 end
from generate_series(1, 15) as i
cross join lateral (
  select (array['Mercedes-Benz', 'Volvo', 'MAN', 'Scania', 'DAF'])[1 + (i % 5)] as make,
         (array['Actros 1845', 'FH 460', 'TGX 18.480', 'R 450', 'XF 480'])[1 + (i % 5)] as model
) m;

insert into public.truck_assets (truck_id, purchase_date, purchase_cost_base_minor, salvage_value_base_minor, useful_life_months)
select t.id,
       make_date(t.year, 1 + (t.year % 12), 15),
       c.cost,
       round(c.cost * 0.15),
       120
from public.trucks t
cross join lateral (select (pg_temp.rint(55, 95) * 1000 * 1000)::bigint as cost) c;

insert into public.drivers (full_name, phone, national_id, license_number, license_expiry, default_truck_id, hire_date)
select n.full_name,
       '07' || (77000000 + n.i * 1373)::text,
       (9861000000 + n.i * 7)::text,
       'DL-' || (400000 + n.i * 91)::text,
       current_date + pg_temp.rint(20, 900),
       t.id,
       current_date - pg_temp.rint(200, 2500)
from (values
  (1, 'محمد سالم العبادي'), (2, 'أحمد خليل الحوراني'), (3, 'خالد يوسف الزعبي'),
  (4, 'عمر فايز الخطيب'), (5, 'يوسف عادل السعدي'), (6, 'إبراهيم نايف الشرع'),
  (7, 'سامر حسين المومني'), (8, 'رامي جمال العمري'), (9, 'حسن محمود البطاينة'),
  (10, 'علي عبدالله الربابعة'), (11, 'مازن راتب الحمود'), (12, 'طارق سليم الشياب'),
  (13, 'فادي نبيل القضاة'), (14, 'بلال منصور الدويري'), (15, 'وليد عيسى الصمادي')
) as n (i, full_name)
join public.trucks t on t.code = 'T-' || lpad(n.i::text, 2, '0');

-- ---------------------------------------------------------------------------
-- Six months of operations per truck
-- ---------------------------------------------------------------------------
do $$
declare
  win_start date := (date_trunc('month', current_date) - interval '5 months')::date;
  today date := current_date;
  t record;
  drv uuid;
  idx integer;
  stop_day date;
  d date;
  odo integer;
  next_service integer;
  kmpl numeric;
  r record;
  days integer;
  km integer;
  trip_id uuid;
  wo_id uuid;
  client_ids uuid[];
  station_ids uuid[];
  workshop_ids uuid[];
  loc jsonb := '{}'::jsonb;
  cat jsonb := '{}'::jsonb;
  usd numeric := 0.709;
  leg integer;
  is_empty boolean;
  liters numeric;
  partial numeric;
  freight bigint;
  cur text;
  last_service_odo integer;
  last_service_on date;
  brake_odo integer;
  want_intl boolean;
  start_odo integer;
  swap_odo integer;
  saudi_station uuid;
  off integer[];
begin
  select array_agg(id order by name) into client_ids from public.clients;
  select array_agg(id order by name) into station_ids from public.suppliers
  where kind = 'fuel_station' and city <> 'الحديثة';
  select id into saudi_station from public.suppliers where city = 'الحديثة';
  select array_agg(id order by name) into workshop_ids from public.suppliers where kind = 'workshop';
  select jsonb_object_agg(name, id) into loc from public.locations;
  select jsonb_object_agg(code, id) into cat from public.expense_categories;

  create temp table routes (
    id serial, from_name text, to_name text, km integer, intl boolean,
    freight_out numeric, freight_back numeric
  );
  insert into routes (from_name, to_name, km, intl, freight_out, freight_back) values
    ('الزرقاء', 'العقبة', 340, false, 390, 330),
    ('عمّان', 'العقبة', 330, false, 375, 320),
    ('عمّان', 'إربد', 85, false, 115, 95),
    ('الزرقاء', 'المفرق', 55, false, 85, 70),
    ('عمّان', 'معان', 215, false, 250, 210),
    ('الكرك', 'العقبة', 260, false, 300, 260),
    ('الزرقاء', 'الرياض', 1350, true, 2150, 1750),
    ('عمّان', 'الدمام', 1560, true, 2450, 1950);

  for t in
    select tr.id, tr.code, tr.expected_km_per_liter, row_number() over (order by tr.code)::integer as n
    from public.trucks tr order by tr.code
  loop
    idx := t.n;
    select id into drv from public.drivers where default_truck_id = t.id;
    kmpl := coalesce(t.expected_km_per_liter, round(pg_temp.rnum(2.5, 3.0), 2));
    odo := pg_temp.rint(150, 600) * 1000 + pg_temp.rint(0, 999);
    next_service := (odo / 20000 + 1) * 20000;
    last_service_odo := next_service - 20000;
    last_service_on := win_start - pg_temp.rint(10, 60);
    brake_odo := odo - pg_temp.rint(5000, 35000);
    start_odo := odo;
    swap_odo := null;
    stop_day := case
      when idx in (3, 9) then today - 5          -- in the workshop now
      when idx in (1, 5, 7, 12, 14) then today - 1  -- on a trip now
      else today
    end;
    d := win_start + pg_temp.rint(0, 3);

    loop
      want_intl := idx <= 4 and random() < 0.5;
      select * into r from routes where intl = want_intl order by random() limit 1;
      days := case when r.km > 1000 then pg_temp.rint(4, 6) when r.km > 150 then pg_temp.rint(1, 2) else 1 end;

      for leg in 1 .. 2 loop
        exit when d + days - 1 >= stop_day;
        km := round(r.km * pg_temp.rnum(1.0, 1.03));
        is_empty := leg = 2 and random() < 0.35;
        cur := case when r.intl then 'USD' else 'JOD' end;
        freight := case
          when is_empty then 0
          when leg = 1 then round(r.freight_out * pg_temp.rnum(0.92, 1.1)) * case when r.intl then 100 else 1000 end
          else round(r.freight_back * pg_temp.rnum(0.92, 1.1)) * case when r.intl then 100 else 1000 end
        end;

        insert into public.trips (
          truck_id, driver_id, client_id, from_location_id, to_location_id,
          start_date, end_date, status, cargo_description, cargo_weight_tons, is_empty_return,
          start_odometer, end_odometer, currency, freight_minor, fx_rate
        ) values (
          t.id, drv,
          case when is_empty then null
               when r.intl then client_ids[(array[1, 7, 8])[pg_temp.rint(1, 3)]]
               else client_ids[pg_temp.rint(1, 6)] end,
          (loc ->> case when leg = 1 then r.from_name else r.to_name end)::uuid,
          (loc ->> case when leg = 1 then r.to_name else r.from_name end)::uuid,
          d, d + days - 1, 'completed',
          case when is_empty then 'عودة فارغة'
               else (array['مواد غذائية', 'حديد تسليح', 'إسمنت', 'حبيبات بلاستيك', 'حاويات مبردة', 'مواد تنظيف', 'أخشاب'])[pg_temp.rint(1, 7)] end,
          case when is_empty then null else pg_temp.rint(18, 28) end,
          is_empty,
          odo, odo + km,
          cur, freight,
          case when cur = 'USD' then usd else 1 end
        ) returning id into trip_id;

        -- Diesel: long legs get a partial fill in Saudi Arabia (USD), every
        -- leg ends with a full tank. About 4% of legs burn abnormally high.
        liters := km / (kmpl * case when random() < 0.04 then 0.68 else pg_temp.rnum(0.94, 1.06) end);
        partial := 0;
        if r.intl then
          partial := round(liters * 0.45, 2);
          insert into public.fuel_fillups (truck_id, driver_id, trip_id, station_id, filled_at, odometer, liters,
                                           is_full_tank, currency, amount_minor, fx_rate, payment_method)
          values (t.id, drv, trip_id, saudi_station,
                  ((d + days / 2) + time '10:00') at time zone 'Asia/Amman',
                  odo + km / 2, partial, false, 'USD', round(partial * 44), usd, 'cash');
        end if;
        insert into public.fuel_fillups (truck_id, driver_id, trip_id, station_id, filled_at, odometer, liters,
                                         is_full_tank, currency, amount_minor, fx_rate, payment_method)
        values (t.id, drv, trip_id, station_ids[pg_temp.rint(1, 3)],
                ((d + days - 1) + time '18:00') at time zone 'Asia/Amman',
                odo + km, round(liters - partial, 2), true, 'JOD', round((liters - partial) * 640), 1,
                (array['cash', 'card', 'credit'])[pg_temp.rint(1, 3)]);

        -- Trip expenses
        insert into public.expenses (expense_date, category_id, truck_id, trip_id, driver_id, description,
                                     currency, amount_minor, fx_rate, payment_method)
        values (d + days - 1, (cat ->> 'driver_pay')::uuid, t.id, trip_id, drv,
                'مكافأة رحلة للسائق', 'JOD',
                case when r.intl then 75000 else pg_temp.rint(12, 20) * 1000 end, 1, 'cash');
        if r.intl then
          insert into public.expenses (expense_date, category_id, truck_id, trip_id, driver_id, description,
                                       currency, amount_minor, fx_rate, payment_method)
          values (d, (cat ->> 'tolls')::uuid, t.id, trip_id, drv, 'رسوم عبور حدود العمري', 'USD', 4500, usd, 'driver_advance');
        elsif r.to_name = 'العقبة' or r.from_name = 'العقبة' then
          insert into public.expenses (expense_date, category_id, truck_id, trip_id, driver_id, description,
                                       currency, amount_minor, fx_rate, payment_method)
          values (d, (cat ->> 'tolls')::uuid, t.id, trip_id, drv, 'رسوم دخول ميناء العقبة', 'JOD', 6000, 1, 'cash');
        end if;
        if random() < 0.03 then
          insert into public.expenses (expense_date, category_id, truck_id, trip_id, driver_id, description,
                                       currency, amount_minor, fx_rate, payment_method)
          values (d + days - 1, (cat ->> 'fines')::uuid, t.id, trip_id, drv,
                  (array['مخالفة سرعة', 'مخالفة حمولة زائدة', 'مخالفة وقوف'])[pg_temp.rint(1, 3)],
                  'JOD', pg_temp.rint(2, 10) * 10000, 1, 'cash');
        end if;

        odo := odo + km;
        d := d + days;
        if swap_odo is null and d >= win_start + 60 then
          swap_odo := odo;
        end if;

        -- Periodic service every 20,000 km
        if odo >= next_service then
          -- Opened, its lines added, then closed with the workshop's invoice (on credit).
          insert into public.work_orders (truck_id, workshop_id, kind, status, opened_on, odometer,
                                          description, invoice_no)
          values (t.id, workshop_ids[pg_temp.rint(1, 2)], 'service', 'open', d, odo,
                  'صيانة دورية: تغيير زيت وفلاتر', 'INV-' || pg_temp.rint(10000, 99999))
          returning id into wo_id;
          insert into public.work_order_lines (work_order_id, line_type, description, part_number, quantity, unit_price_minor) values
            (wo_id, 'part', 'زيت محرك 15W-40', 'OIL-1540', 40, 3200),
            (wo_id, 'part', 'فلتر زيت', 'FLT-OIL', 2, 9500),
            (wo_id, 'part', 'فلتر ديزل', 'FLT-DSL', 2, 12000),
            (wo_id, 'part', 'فلتر هواء', 'FLT-AIR', 1, 35000),
            (wo_id, 'labor', 'أجور فني', null, 1, 25000);
          update public.work_orders set status = 'closed', closed_on = d, payment_method = 'credit' where id = wo_id;
          last_service_odo := odo;
          last_service_on := d;
          next_service := next_service + 20000;
          d := d + 1;
        end if;

        -- Occasional repair
        if random() < 0.04 then
          insert into public.work_orders (truck_id, workshop_id, kind, status, opened_on, odometer,
                                          description, invoice_no)
          values (t.id, workshop_ids[pg_temp.rint(1, 2)], 'repair', 'open', d, odo,
                  'إصلاح أعطال', 'INV-' || pg_temp.rint(10000, 99999))
          returning id into wo_id;
          case pg_temp.rint(1, 4)
            when 1 then
              insert into public.work_order_lines (work_order_id, line_type, description, quantity, unit_price_minor) values
                (wo_id, 'part', 'فحمات فرامل', 8, 14000), (wo_id, 'labor', 'أجور تركيب', 1, 40000);
              update public.work_orders set description = 'تبديل فحمات الفرامل' where id = wo_id;
              brake_odo := odo;
            when 2 then
              insert into public.work_order_lines (work_order_id, line_type, description, quantity, unit_price_minor) values
                (wo_id, 'part', 'طقم كلتش كامل', 1, 650000), (wo_id, 'labor', 'أجور فك وتركيب', 1, 120000);
              update public.work_orders set description = 'تبديل الكلتش' where id = wo_id;
            when 3 then
              insert into public.work_order_lines (work_order_id, line_type, description, quantity, unit_price_minor) values
                (wo_id, 'part', 'دينمو شحن', 1, 280000), (wo_id, 'labor', 'أجور كهربائي', 1, 35000);
              update public.work_orders set description = 'إصلاح كهرباء: دينمو' where id = wo_id;
            else
              insert into public.work_order_lines (work_order_id, line_type, description, quantity, unit_price_minor) values
                (wo_id, 'part', 'إصلاح تيربو', 1, 900000), (wo_id, 'labor', 'أجور فني', 1, 150000);
              update public.work_orders set description = 'إصلاح التيربو' where id = wo_id;
          end case;
          update public.work_orders set status = 'closed', closed_on = least(d + 1, today), payment_method = 'credit' where id = wo_id;
          d := d + 2;
        end if;
      end loop;

      exit when d + 1 >= stop_day;
      d := d + pg_temp.rint(0, 2);
    end loop;

    -- Current state
    if idx in (1, 5, 7, 12, 14) then
      select * into r from routes where intl = (idx = 1) order by random() limit 1;
      insert into public.trips (truck_id, driver_id, client_id, from_location_id, to_location_id,
                                start_date, status, cargo_description, cargo_weight_tons,
                                start_odometer, currency, freight_minor, fx_rate)
      values (t.id, drv, client_ids[case when r.intl then 7 else pg_temp.rint(1, 6) end],
              (loc ->> r.from_name)::uuid, (loc ->> r.to_name)::uuid,
              today - case when r.intl then 1 else 0 end, 'in_progress', 'مواد غذائية', 24,
              odo, case when r.intl then 'USD' else 'JOD' end,
              case when r.intl then 215000 else 380000 end,
              case when r.intl then usd else 1 end);
    elsif idx in (3, 9) then
      insert into public.work_orders (truck_id, workshop_id, kind, status, opened_on, odometer, description)
      values (t.id, workshop_ids[2], 'repair', 'open', today - 2, odo,
              case when idx = 3 then 'عطل في علبة السرعة — بانتظار قطعة' else 'إصلاح نظام التبريد' end)
      returning id into wo_id;
      insert into public.work_order_lines (work_order_id, line_type, description, quantity, unit_price_minor)
      values (wo_id, 'labor', 'أجور فحص وتشخيص', 1, 30000);
    end if;

    -- Service schedules
    insert into public.service_schedules (truck_id, service_name, interval_km, interval_days, last_done_odometer, last_done_on) values
      (t.id, 'تغيير زيت المحرك والفلاتر', 20000, 180, last_service_odo, last_service_on),
      (t.id, 'فحص وتبديل الفرامل', 40000, null,
       case when idx = 6 then odo - 41500 else greatest(brake_odo, odo - pg_temp.rint(8000, 30000)) end, null),
      (t.id, 'تشحيم وفحص الهيكل', 10000, 90,
       odo - case when idx = 11 then 9200 else pg_temp.rint(1000, 7000) end,
       today - case when idx = 11 then 85 else pg_temp.rint(10, 60) end);

    -- Documents: days until expiry, some expiring soon on purpose
    off := array[
      case when idx = 2 then 5 else pg_temp.rint(30, 330) end,
      case idx when 6 then 20 when 10 then -3 else pg_temp.rint(40, 300) end,
      case when idx = 11 then 45 else pg_temp.rint(61, 340) end,
      case when idx = 4 then 25 else pg_temp.rint(70, 170) end
    ];
    insert into public.truck_documents (truck_id, doc_type, title, doc_number, issuer, issue_date, expiry_date) values
      (t.id, 'registration', 'رخصة المركبة', 'REG-' || (500000 + idx * 37), 'إدارة الترخيص',
       today + off[1] - 365, today + off[1]),
      (t.id, 'insurance', 'تأمين شامل', 'POL-' || (700000 + idx * 53), 'شركة تأمين (تجريبية)',
       today + off[2] - 365, today + off[2]),
      (t.id, 'inspection', 'الفحص الفني', 'INSP-' || (900000 + idx * 11), 'مركز الفحص الفني',
       today + off[3] - 365, today + off[3]);
    if idx <= 4 then
      insert into public.truck_documents (truck_id, doc_type, title, doc_number, issuer, issue_date, expiry_date)
      values (t.id, 'permit', 'تصريح نقل دولي', 'TIR-' || (300000 + idx * 17), 'هيئة تنظيم النقل البري',
              today + off[4] - 180, today + off[4]);
    end if;

    -- Annual insurance and licensing fees inside the window
    insert into public.expenses (expense_date, category_id, truck_id, description, currency, amount_minor, fx_rate, payment_method)
    select greatest(dd.issue_date, win_start), (cat ->> 'insurance_license')::uuid, t.id,
           case dd.doc_type when 'insurance' then 'قسط التأمين السنوي' else 'رسوم ترخيص المركبة' end,
           'JOD', case dd.doc_type when 'insurance' then pg_temp.rint(1050, 1300) * 1000 else pg_temp.rint(380, 460) * 1000 end,
           1, 'bank'
    from public.truck_documents dd
    where dd.truck_id = t.id and dd.doc_type in ('insurance', 'registration') and dd.issue_date >= win_start - 30;

    -- Tires: 10 positions, two replaced during the window
    insert into public.tires (serial_no, brand, size, purchase_date, status, retread_count)
    select 'TR' || lpad(idx::text, 2, '0') || '-' || p.code, (array['Michelin', 'Bridgestone', 'Continental', 'Goodyear'])[1 + (idx % 4)],
           case when p.code like 'F-%' then '385/65R22.5' else '315/80R22.5' end,
           win_start - pg_temp.rint(60, 500), 'installed', case when p.code like 'D2-%' and idx % 2 = 0 then 1 else 0 end
    from unnest(array['F-L', 'F-R', 'D1-LO', 'D1-LI', 'D1-RI', 'D1-RO', 'D2-LO', 'D2-LI', 'D2-RI', 'D2-RO']) as p(code);
    insert into public.tire_installations (tire_id, truck_id, position_code, installed_on, installed_odometer)
    select ti.id, t.id, split_part(ti.serial_no, '-', 2) || coalesce('-' || nullif(split_part(ti.serial_no, '-', 3), ''), ''),
           ti.purchase_date + 3, greatest(start_odo - pg_temp.rint(5000, 60000), 0)
    from public.tires ti where ti.serial_no like 'TR' || lpad(idx::text, 2, '0') || '-%';

    -- Replace both steer tires mid-window
    update public.tire_installations ti
    set removed_on = win_start + 60, removed_odometer = coalesce(swap_odo, odo),
        removal_reason = 'تآكل'
    where ti.truck_id = t.id and ti.position_code in ('F-L', 'F-R');
    update public.tires set status = 'scrapped'
    where id in (select tire_id from public.tire_installations where truck_id = t.id and removed_on is not null);
    insert into public.tires (serial_no, brand, size, purchase_date, status)
    select 'TR' || lpad(idx::text, 2, '0') || '-N' || p.code, 'Michelin', '385/65R22.5', win_start + 59, 'installed'
    from unnest(array['F-L', 'F-R']) as p(code);
    insert into public.tire_installations (tire_id, truck_id, position_code, installed_on, installed_odometer)
    select ti.id, t.id, right(ti.serial_no, 3), win_start + 60, x.removed_odometer
    from public.tires ti
    join public.tire_installations x on x.truck_id = t.id and x.position_code = right(ti.serial_no, 3) and x.removed_on is not null
    where ti.serial_no like 'TR' || lpad(idx::text, 2, '0') || '-N%';
    insert into public.expenses (expense_date, category_id, truck_id, supplier_id, description, currency, amount_minor, fx_rate, payment_method)
    values (win_start + 59, (cat ->> 'tires')::uuid, t.id, (select id from public.suppliers where kind = 'tires'),
            'إطاران أماميان جديدان', 'JOD', 2 * 265000, 1, 'credit');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Overhead (not tied to a truck; allocated by rule in truck_pnl_facts_v)
-- ---------------------------------------------------------------------------
insert into public.expenses (expense_date, category_id, cost_scope, description, currency, amount_minor, fx_rate, payment_method)
select m.month + o.day_offset, ec.id, 'overhead', o.description, 'JOD',
       o.amount + case when o.code = 'admin' then pg_temp.rint(0, 80) * 1000 else 0 end, 1, 'bank'
from (
  select gs::date as month
  from generate_series(
    date_trunc('month', current_date) - interval '5 months',
    date_trunc('month', current_date),
    interval '1 month'
  ) as gs
) as m
cross join (values
  ('rent', 0, 'إيجار المكتب والساحة', 750000),
  ('admin', 9, 'كهرباء وماء واتصالات', 180000),
  ('admin_salaries', 27, 'رواتب الموظفين الإداريين', 2400000)
) as o (code, day_offset, description, amount)
join public.expense_categories ec on ec.code = o.code
where m.month + o.day_offset <= current_date;

-- ---------------------------------------------------------------------------
-- Financing for three trucks
-- ---------------------------------------------------------------------------
insert into public.truck_financing (truck_id, kind, lender, contract_no, start_date, term_months, principal_base_minor, annual_rate_pct)
select t.id, v.kind, v.lender, v.contract_no, (date_trunc('month', current_date) - make_interval(months => v.months_ago))::date + 4,
       v.term, v.principal, v.rate
from (values
  ('T-02', 'loan', 'البنك التجاري (تجريبي)', 'LN-2024-118', 22, 48, 62000000::bigint, 7.5),
  ('T-08', 'loan', 'البنك التجاري (تجريبي)', 'LN-2025-041', 14, 48, 70000000::bigint, 7.25),
  ('T-13', 'lease', 'شركة التأجير التمويلي (تجريبية)', 'LS-2023-077', 30, 60, 58000000::bigint, 8.0)
) as v (code, kind, lender, contract_no, months_ago, term, principal, rate)
join public.trucks t on t.code = v.code;

select public.generate_installments(id) from public.truck_financing;

update public.financing_installments
set paid_on = due_date + (installment_no % 4), paid_amount_base_minor = amount_base_minor
where due_date <= current_date;

update public.truck_assets a
set purchase_date = f.start_date - 10
from public.truck_financing f
where f.truck_id = a.truck_id;

-- ---------------------------------------------------------------------------
-- Journal: monthly depreciation per truck for completed months, plus one
-- entry that was posted and then reversed.
-- ---------------------------------------------------------------------------
do $$
declare
  m date;
  e uuid;
  adj uuid;
begin
  for m in
    select generate_series(
      (date_trunc('month', current_date) - interval '5 months')::date,
      (date_trunc('month', current_date) - interval '1 month')::date,
      interval '1 month'
    )::date
  loop
    insert into public.journal_entries (entry_date, description, source_type)
    values ((m + interval '1 month - 1 day')::date, 'استهلاك الشاحنات لشهر ' || to_char(m, 'YYYY-MM'), 'depreciation')
    returning id into e;
    insert into public.journal_lines (entry_id, line_no, account_id, truck_id, description, debit_minor, credit_minor)
    select e, 1, (select id from public.accounts where code = '5301'), f.truck_id, 'استهلاك ' || t.code, f.amount_base_minor, 0
    from public.truck_pnl_facts_v f join public.trucks t on t.id = f.truck_id
    where f.kind = 'depreciation' and f.fact_date = m
    union all
    select e, 2, (select id from public.accounts where code = '1209'), f.truck_id, 'مجمع استهلاك ' || t.code, 0, f.amount_base_minor
    from public.truck_pnl_facts_v f join public.trucks t on t.id = f.truck_id
    where f.kind = 'depreciation' and f.fact_date = m;
    perform public.post_journal_entry(e);
  end loop;

  insert into public.journal_entries (entry_date, description)
  values (current_date - 20, 'تسوية رسوم ترخيص (أُدخلت بالخطأ)')
  returning id into adj;
  insert into public.journal_lines (entry_id, line_no, account_id, truck_id, description, debit_minor, credit_minor)
  select adj, 1, a.id, t.id, 'رسوم ترخيص', 125000, 0
  from public.accounts a, public.trucks t where a.code = '5107' and t.code = 'T-05'
  union all
  select adj, 2, a.id, t.id, 'نقداً', 0, 125000
  from public.accounts a, public.trucks t where a.code = '1101' and t.code = 'T-05';
  perform public.post_journal_entry(adj);
  perform public.reverse_journal_entry(adj, 'إدخال مكرر', current_date - 19);
end;
$$;

-- Demo rows should not clutter the audit log.
truncate audit.log;
