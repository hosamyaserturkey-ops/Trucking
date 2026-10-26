# Trucking — نظام النقل

Arabic (RTL) accounting and fleet system for a trucking company. It is built around **Truck 360 (ملف الشاحنة)**: pick a truck and see everything about it for any date range.

**Stack:** Next.js 15, Supabase (Postgres, Auth, row-level security), Cloudflare R2 for files, Tailwind CSS v4.

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

## What's in Phase 2

- **Trips (الرحلات):** dispatchers plan, start, finish and cancel trips. The odometer is required at start and finish, and each truck and each driver can have only one running trip. **رحلة العودة** opens a return leg with the route reversed, optionally as an empty return.
- **Driver phone (رحلاتي):**
  - Start and finish their own trip with the odometer reading.
  - See their advance balance.
  - Send expenses with a receipt photo. The photo is shrunk on the phone and uploaded to the driver's private folder.
  - Fix or withdraw an expense until it is reviewed; see the reason if it is rejected.
- **Approvals (الموافقات):** the accountant or manager approves driver expenses (optionally correcting category, amount or rate) or rejects them with a reason. Only approved expenses count in profit and in advances.
- **Advances (العهد):**
  - A running balance per driver.
  - Issue cash or bank advances, optionally linked to a trip.
  - Settle up to a date with a live preview. A settlement locks its rows for good.
  - An A4 settlement slip with signature lines.

## Accuracy rules (enforced in the database)

- **Every cost has a truck, or is marked overhead.** Overhead is allocated to trucks by rule (`equal` or `by_km` in `company_settings`), exactly to the fils.
- **Posted journal entries can't be edited or deleted.** Corrections go through `reverse_journal_entry()`.
- **Money is stored as integer minor units** (JOD fils, USD cents) with the exchange rate. The JOD amount is fixed when the row is written.
- **Drivers see only their own rows** (RLS). Dispatchers can't see the journal, purchase values or financing.
- **Driver expenses count only once approved**, and only the accountant or manager can approve. Settled advances and expenses can't be changed, and settlements can't be edited or deleted.

## Running it

```bash
pnpm install
cp .env.example .env.local   # Supabase URL and publishable key, R2 keys
pnpm dev                     # http://localhost:3000
```

Checks:

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit tests (money, dates, P&L, forms, advances, storage rules)
pnpm test:storage                          # live storage checks; needs the R2_* variables (R2 or a local MinIO)
PGHOST=/tmp PGPORT=54329 PGUSER=postgres pnpm db:test   # migrations + seed + SQL rule tests on a local Postgres
pnpm build && pnpm start &
E2E_MANAGER_EMAIL=… E2E_MANAGER_PASSWORD=… E2E_DRIVER_EMAIL=… E2E_DRIVER_PASSWORD=… BASE_URL=http://localhost:3000 pnpm e2e
```

Add `E2E_ACCOUNTANT_EMAIL/PASSWORD` and `E2E_DISPATCHER_EMAIL/PASSWORD` to also run the full Phase 2 flow (plan a trip → driver runs it and sends expenses → approve/reject → advance → settlement slip → empty return leg). That flow writes rows and uploads a receipt, so run it against demo data only. `E2E_STORAGE_ORIGIN` checks that receipts are served from the right place.

## File storage (Cloudflare R2)

Receipt photos and document scans live in one **private** R2 bucket; Supabase holds only each file's path.

- **One module:** `src/lib/storage.ts` is the only code with the R2 keys. It signs short-lived links with R2's S3 API (`aws4fetch`, works on Node and Cloudflare Workers).
- **Uploads go straight from the phone to R2:**
  - The phone shrinks the photo.
  - The server checks the user, role and record (`src/lib/file-access.ts`), picks the path `<user id>/<yyyy-mm>/<random>.<ext>`, and returns an upload link. The link lasts 5 minutes and accepts only that file type and exact size (JPEG, PNG, WebP, HEIC or PDF, at most 10 MB).
- **On save:**
  - The server checks that the file exists in the user's own folder with an allowed type and size, and moves it from `tmp/` into place.
  - A replaced or withdrawn receipt is deleted.
  - The database refuses another driver's folder, and freezes a receipt once its expense is reviewed or settled (migration 11).
- **Viewing:** pages link to `/files/<kind>/<id>`. The row is read with the user's own session, so RLS decides who sees it, and the redirect is to a link that expires after 10 minutes. A driver never gets a link to another driver's file.
- **Clean-up:** uploads never attached to a saved row stay under `tmp/`, and the bucket's lifecycle rule deletes them after a day.

### Setting up R2 (Cloudflare dashboard)
1. **R2 Object Storage** → enable R2. Cloudflare asks for a payment method even for the free 10 GB.
2. **Create bucket:** name `trucking-files`, location Automatic, Standard class. Keep public access **off** (no r2.dev subdomain, no custom domain).
3. Bucket → **Settings** → **CORS policy** → **Add**, and paste (put your real domain in place of `YOUR-DOMAIN` when you have one):
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://YOUR-DOMAIN"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. Bucket → **Settings** → **Object lifecycle rules** → **Add rule**: name `delete unattached uploads`, prefix `tmp/`, delete objects 1 day after upload.
5. R2 overview → **Manage API tokens** → **Create API token**:
   - permission **Object Read & Write**;
   - **Apply to specific buckets only** → `trucking-files`;
   - TTL: forever, or a year.
   - Copy the **Access Key ID** and **Secret Access Key**; they are shown once.
   - The **Account ID** is on the R2 overview page.
6. **Set the variables** wherever the app runs (`.env.local` locally, or the host's environment settings):
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=trucking-files`;
   - leave `R2_ENDPOINT` empty;
   - never prefix them with `NEXT_PUBLIC_`.
7. **Move the old demo files**, once only:
   ```bash
   COPY_EMAIL=<a manager's email> COPY_PASSWORD=<their password> node --conditions=react-server scripts/copy-supabase-storage-to-r2.mts --dry-run
   ```
   - Run it again without `--dry-run` to copy.
   - It copies only files that rows point to, skips files already in R2, and never deletes from Supabase.

The old Supabase buckets (`receipts`, `truck-documents`) and their policies are still in place; remove them only after R2 is confirmed in use.

**Local testing without R2:**
- Any S3-compatible server works. For MinIO:
  - set `R2_ENDPOINT=http://127.0.0.1:9000` and the MinIO user and password as the R2 keys;
  - `pnpm test:storage` creates the bucket there and checks uploads, type/size locks, expiry and folder ownership.

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
  10. trips, driver advances, expense approval and settlements
  11. file rules: path layout, a driver's own folder, receipts frozen once reviewed or settled
- **Demo data:** `supabase/seed.sql` (15 trucks, about 6 months, all names fictional), then `supabase/seed_phase2.sql` (advances, past settlements, expenses waiting for approval).
- **Before go-live:**
  - Run `supabase/reset_demo.sql`. It keeps the chart of accounts, categories and settings.
  - Run `truncate audit.log;`.
  - Empty the R2 bucket `trucking-files` (demo receipt photos), and once R2 is confirmed, remove the old Supabase Storage buckets.
  - Delete the demo users in Supabase Auth.

## Users

1. Create users in the Supabase dashboard: **Authentication → Users → Add user**.
2. The very first user becomes **manager**. Everyone after that starts with no access until a manager assigns a role under **المستخدمون**.
3. Turn off public sign-ups in Supabase Auth settings; the app has no sign-up page.

## Next phases

- **3:** diesel fill-up entry with receipts and tank stock.
- **4:** work orders, documents and alerts (WhatsApp/SMS).
- **5:** invoicing, checks, JoFotara.
- **6:** auto-posted journal entries, period closing.
- **7:** payroll.
- **8:** reports and exports.
- **9:** hardening.
