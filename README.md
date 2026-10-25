# Trucking — نظام النقل

Arabic (RTL) accounting and fleet system for a trucking company. It is built around **Truck 360 (ملف الشاحنة)**: pick a truck and see everything about it for any date range.

**Stack:** Next.js 15, Supabase (Postgres, Auth, Storage, row-level security), Tailwind CSS v4.

## What's in Phase 1

- **Fleet board:** trucks on a trip, idle or in the workshop; the month's fleet P&L; expiring documents and services due.
- **Truck 360**, with a date filter (this month / this year / custom range):
  - Overview: profit card, trips, km, diesel, km/L.
  - Trips: freight, fuel, expenses and profit per trip.
  - Diesel: fill-up log and abnormal-consumption flags.
  - Maintenance: services due, work orders, tire map.
  - Documents: expiry countdown.
  - Expenses: direct costs plus the truck's share of overhead.
  - Financials: monthly P&L chart, depreciation, loans and leasing, truck ledger.
  - A printable A4 statement.
- **Master data:** trucks, drivers, clients, suppliers, locations, chart of accounts.
- **Users and roles:** manager, accountant, dispatcher, driver.
- **Audit log** of every change.

## Accuracy rules (enforced in the database)

- **Every cost has a truck, or is marked overhead.** Overhead is allocated to trucks by rule (`equal` or `by_km` in `company_settings`), exactly to the fils.
- **Posted journal entries can't be edited or deleted.** Corrections go through `reverse_journal_entry()`.
- **Money is stored as integer minor units** (JOD fils, USD cents) with the exchange rate. The JOD amount is fixed when the row is written.
- **Drivers see only their own rows** (RLS). Dispatchers can't see the journal, purchase values or financing.

## Running it

```bash
pnpm install
cp .env.example .env.local   # Supabase URL and publishable key
pnpm dev                     # http://localhost:3000
```

Checks:

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit tests (money, dates, P&L, forms)
PGHOST=/tmp PGPORT=54329 PGUSER=postgres pnpm db:test   # migrations + seed + SQL rule tests on a local Postgres
pnpm build && pnpm start &
E2E_MANAGER_EMAIL=… E2E_MANAGER_PASSWORD=… E2E_DRIVER_EMAIL=… E2E_DRIVER_PASSWORD=… BASE_URL=http://localhost:3000 pnpm e2e
```

## Database

- **Migrations:** apply the files in `supabase/migrations/` in order:
  1. core, roles, audit log
  2. master data and chart of accounts
  3. operations
  4. finance
  5. views
  6. RLS
  7. storage
  8. foreign-key indexes
  9. P&L summary functions
- **Demo data:** `supabase/seed.sql` (15 trucks, about 6 months, all names fictional).
- **Before go-live:**
  - Run `supabase/reset_demo.sql`. It keeps the chart of accounts, categories and settings.
  - Run `truncate audit.log;`.
  - Delete the demo users in Supabase Auth.

## Users

1. Create users in the Supabase dashboard: **Authentication → Users → Add user**.
2. The very first user becomes **manager**. Everyone after that starts with no access until a manager assigns a role under **المستخدمون**.
3. Turn off public sign-ups in Supabase Auth settings; the app has no sign-up page.

## Next phases

- **2–4:** entry forms for trips, driver cash advances, mobile expense entry with receipt photos, fill-ups, work orders and documents; WhatsApp/SMS alerts.
- **5:** invoicing, checks, JoFotara.
- **6:** auto-posted journal entries, period closing.
- **7:** payroll.
- **8:** reports and exports.
- **9:** hardening.
