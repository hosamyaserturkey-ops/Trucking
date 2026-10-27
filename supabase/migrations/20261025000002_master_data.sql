-- Master data: trucks, truck assets, drivers, clients, suppliers, locations,
-- chart of accounts, expense categories.

create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plate_number text not null unique,
  make text,
  model text,
  year smallint check (year between 1980 and 2100),
  vin text unique,
  truck_type text,
  expected_km_per_liter numeric(5, 2) check (expected_km_per_liter > 0),
  fuel_tank_liters integer check (fuel_tank_liters > 0),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

comment on column public.trucks.code is 'Fleet number shown in the UI, e.g. T-01.';

-- Financial data about the truck lives apart so drivers and dispatchers
-- never see purchase price or book value.
create table public.truck_assets (
  truck_id uuid primary key references public.trucks (id) on delete cascade,
  purchase_date date,
  purchase_cost_base_minor bigint not null default 0 check (purchase_cost_base_minor >= 0),
  salvage_value_base_minor bigint not null default 0 check (salvage_value_base_minor >= 0),
  useful_life_months integer check (useful_life_months > 0),
  updated_at timestamptz not null default now(),
  check (salvage_value_base_minor <= purchase_cost_base_minor)
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  national_id text unique,
  license_number text,
  license_expiry date,
  default_truck_id uuid references public.trucks (id) on delete set null,
  hire_date date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

alter table public.profiles
  add constraint profiles_driver_fk foreign key (driver_id)
  references public.drivers (id) on delete set null;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tax_number text,
  phone text,
  email text,
  city text,
  address text,
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  credit_limit_base_minor bigint check (credit_limit_base_minor >= 0),
  default_currency char(3) not null default 'JOD' references public.currencies (code),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('fuel_station', 'workshop', 'parts', 'tires', 'other')),
  phone text,
  tax_number text,
  city text,
  address text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  country text not null default 'الأردن',
  is_border_crossing boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create type public.account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  type public.account_type not null,
  parent_id uuid references public.accounts (id) on delete restrict,
  is_postable boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.accounts (code, name_ar, type, is_postable) values
  ('1',    'الأصول',                              'asset',     false),
  ('11',   'الأصول المتداولة',                    'asset',     false),
  ('1101', 'الصندوق',                             'asset',     true),
  ('1102', 'البنك',                               'asset',     true),
  ('1103', 'ذمم العملاء',                         'asset',     true),
  ('1104', 'شيكات برسم التحصيل',                  'asset',     true),
  ('1105', 'عهد السائقين',                        'asset',     true),
  ('1106', 'مخزون الديزل',                        'asset',     true),
  ('1107', 'مخزون قطع الغيار والإطارات',          'asset',     true),
  ('12',   'الأصول الثابتة',                      'asset',     false),
  ('1201', 'الشاحنات',                            'asset',     true),
  ('1209', 'مجمع استهلاك الشاحنات',               'asset',     true),
  ('2',    'الخصوم',                              'liability', false),
  ('21',   'الخصوم المتداولة',                    'liability', false),
  ('2101', 'ذمم الموردين',                        'liability', true),
  ('2102', 'شيكات مؤجلة الدفع',                   'liability', true),
  ('2103', 'رواتب وأجور مستحقة',                  'liability', true),
  ('2104', 'ضريبة المبيعات المستحقة',             'liability', true),
  ('2105', 'الضمان الاجتماعي المستحق',            'liability', true),
  ('22',   'الخصوم طويلة الأجل',                  'liability', false),
  ('2201', 'قروض الشاحنات',                       'liability', true),
  ('2202', 'التزامات التأجير التمويلي',           'liability', true),
  ('3',    'حقوق الملكية',                        'equity',    false),
  ('3101', 'رأس المال',                           'equity',    true),
  ('3201', 'الأرباح المحتجزة',                    'equity',    true),
  ('3301', 'جاري المالك',                         'equity',    true),
  ('4',    'الإيرادات',                           'revenue',   false),
  ('4101', 'إيرادات النقل',                       'revenue',   true),
  ('4102', 'إيرادات أخرى',                        'revenue',   true),
  ('5',    'المصاريف',                            'expense',   false),
  ('51',   'مصاريف تشغيل الشاحنات',               'expense',   false),
  ('5101', 'الديزل',                              'expense',   true),
  ('5102', 'الصيانة والإصلاح',                    'expense',   true),
  ('5103', 'الإطارات',                            'expense',   true),
  ('5104', 'رسوم الطرق والمعابر',                 'expense',   true),
  ('5105', 'المخالفات',                           'expense',   true),
  ('5106', 'أجور ومكافآت السائقين',               'expense',   true),
  ('5107', 'التأمين والترخيص',                    'expense',   true),
  ('5108', 'مصاريف تشغيل أخرى',                   'expense',   true),
  ('52',   'المصاريف الإدارية والعمومية',         'expense',   false),
  ('5201', 'رواتب الموظفين الإداريين',            'expense',   true),
  ('5202', 'الإيجارات',                           'expense',   true),
  ('5203', 'مصاريف إدارية عامة',                  'expense',   true),
  ('53',   'مصاريف أخرى',                         'expense',   false),
  ('5301', 'استهلاك الشاحنات',                    'expense',   true),
  ('5302', 'فوائد القروض والتأجير',               'expense',   true);

-- Parent = the account with the longest code that prefixes this one.
update public.accounts c
set parent_id = (
  select p.id from public.accounts p
  where p.code <> c.code and c.code like p.code || '%'
  order by length(p.code) desc
  limit 1
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  account_id uuid not null references public.accounts (id),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.expense_categories (code, name_ar, account_id, sort_order)
select v.code, v.name_ar, a.id, v.sort_order
from (values
  ('tolls',             'رسوم طرق ومعابر',  '5104', 10),
  ('fines',             'مخالفات',          '5105', 20),
  ('driver_pay',        'أجور ومكافآت السائقين', '5106', 30),
  ('tires',             'إطارات',           '5103', 40),
  ('insurance_license', 'تأمين وترخيص',     '5107', 50),
  ('operating',         'مصاريف تشغيل',     '5108', 60),
  ('admin_salaries',    'رواتب إدارية',     '5201', 70),
  ('rent',              'إيجار',            '5202', 80),
  ('admin',             'مصاريف إدارية',    '5203', 90),
  ('other',             'أخرى',             '5108', 100)
) as v (code, name_ar, account_code, sort_order)
join public.accounts a on a.code = v.account_code;

select app.track('public.trucks');
select app.track('public.truck_assets');
select app.track('public.drivers');
select app.track('public.clients');
select app.track('public.suppliers');
select app.track('public.locations');
select app.track('public.accounts');
select app.track('public.expense_categories');
