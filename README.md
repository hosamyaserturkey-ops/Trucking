# Trucking — نظام النقل

Arabic (RTL) accounting and fleet system for a trucking company. It is built around **Truck 360 (ملف الشاحنة)**: pick a truck and see everything about it for any date range.

**Stack:** Next.js 15, Supabase (Postgres, Auth, row-level security), Cloudflare R2 for files, Tailwind CSS v4. Hosted on Cloudflare Workers through the OpenNext adapter.

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

## What's in Phase 3

- **Diesel from the driver's phone (تعبئة ديزل):**
  - The driver records odometer, liters, full tank or not, amount and station, with a **required receipt photo**. The price per liter shows as they type.
  - The fill-up waits for approval and is paid from the driver's advance (عهدة).
  - It can be fixed or withdrawn until reviewed. **مصاريفي والديزل** lists both kinds with their status.
- **Approvals:**
  - A diesel section shows the receipt, odometer, liters and price per liter.
  - It also shows **the km/L this fill-up implies against the truck's normal**, and flags it when it is far off.
  - The accountant can correct liters, amount, odometer or full tank before approving, or reject with a reason.
- **Advances:** approved driver-paid diesel appears in the driver's ledger, the settlement preview and the A4 slip, and is settled with the expenses.
- **Diesel log (الديزل):**
  - Every fill-up with filters for date, truck, driver, status and abnormal only.
  - Totals for liters, cost, km/L and price per liter, and trucks and drivers ranked by km/L.
  - Office entry and editing. A dispatcher's entry goes to approval; the manager's or accountant's counts at once.
- **Expenses (المصاريف):**
  - The office enters an expense for one truck (optionally a trip and driver) or as overhead shared across the fleet, with category, supplier, currency, payment, reference and an optional receipt.
  - It can be edited or deleted until it is settled. Dispatchers can view the list but not enter expenses.
  - Expense categories are under master data (**أنواع المصاريف**).
- **Fuel alerts:** abnormal approved fill-ups from the last 60 days show on the fleet board. The Truck 360 Diesel tab lists fill-ups not counted yet.
- All receipts go through the R2 storage module. Diesel receipts open at `/files/fuel/<id>`.

## Daily loading sheet (كشف التحميل اليومي)

- **One line per load**, entered by hand, with no start/finish steps and no odometer readings. It's under الأسطول in the menu.
- **Each line has:** date, truck (its driver is filled in), customer, from, to, cargo, weight in tons, freight in JOD or USD, and the customer's own document number (waybill or bill of lading).
- **Internal reference number (رقم الإشارة):**
  - Every load gets the next number in its customer's own series, e.g. `ARB-0001`, `ARB-0002`.
  - The database assigns it when the line is saved; nobody types it.
  - A deleted line's number is never given out again.
  - If the customer is changed, the load takes the next number in the new customer's series.
- **Customer code:** set **رمز الإشارة** on the customer under العملاء (2–6 Latin letters or digits, e.g. `ARB`). Customers without a code use `C<number>`, e.g. `C07-0001`. Changing a code affects new loads only; printed references stay valid.
- **Freight counts as revenue:** a sheet line is stored as a finished trip, so it counts in truck profit, fleet totals and Truck 360.
- **In the trips list,** sheet lines are marked **كشف**. Normal trips (plan, start and finish with odometer) still work as before.
- **Totals and printing:** the sheet shows totals (loads, tons, freight) for a day or a period, filtered by truck or customer. It prints as an A4 landscape sheet with signature lines.
- **Who can do what:** the manager and the dispatcher add, edit and delete lines; the accountant views.

## Accuracy rules (enforced in the database)

- **Every cost has a truck, or is marked overhead.** Overhead is allocated to trucks by rule (`equal` or `by_km` in `company_settings`), exactly to the fils.
- **Posted journal entries can't be edited or deleted.** Corrections go through `reverse_journal_entry()`.
- **Money is stored as integer minor units** (JOD fils, USD cents) with the exchange rate. The JOD amount is fixed when the row is written.
- **Drivers see only their own rows** (RLS). Dispatchers can't see the journal, purchase values or financing.
- **Driver expenses and fill-ups count only once approved**, and only the accountant or manager can approve. Settled advances, expenses and fill-ups can't be changed, and settlements can't be edited or deleted.
- **A reviewed expense or fill-up can't be deleted**, and neither can its receipt. A wrong one is corrected or reversed with a new row.
- **Fill-ups must be plausible:** liters no more than the truck's tank, and the odometer between the truck's earlier and later fill-ups.

## Running it

```bash
pnpm install
cp .env.example .env.local   # Supabase URL and publishable key, R2 keys
pnpm dev                     # http://localhost:3000
```

Checks:

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit tests (money, dates, P&L, forms, advances, diesel, storage rules)
pnpm test:storage                          # live storage checks; needs the R2_* variables (R2 or a local MinIO)
PGHOST=/tmp PGPORT=54329 PGUSER=postgres pnpm db:test   # migrations + seed + SQL rule tests on a local Postgres
pnpm build && pnpm start &
E2E_MANAGER_EMAIL=… E2E_MANAGER_PASSWORD=… E2E_DRIVER_EMAIL=… E2E_DRIVER_PASSWORD=… BASE_URL=http://localhost:3000 pnpm e2e
```

Add `E2E_ACCOUNTANT_EMAIL/PASSWORD` and `E2E_DISPATCHER_EMAIL/PASSWORD` to also run the full flow. It covers:
- planning a trip, then the driver running it and sending expenses and a diesel fill-up with a receipt;
- approve and reject, with the fill-up's implied km/L;
- advance, settlement slip with diesel, and an empty return leg;
- office overhead and truck expenses, and the diesel log;
- what a driver and a dispatcher must not reach.

That flow writes rows and uploads receipts, so run it against demo data only. `E2E_STORAGE_ORIGIN` checks that receipts are served from the right place.

## File storage (Cloudflare R2)

Receipt photos and document scans live in one **private** R2 bucket; Supabase holds only each file's path.

- **One module:** `src/lib/storage.ts` is the only code with the R2 keys. It signs short-lived links with R2's S3 API (`aws4fetch`, works on Node and Cloudflare Workers).
- **Uploads go straight from the phone to R2:**
  - The phone shrinks the photo.
  - The server checks the user, role and record (`src/lib/file-access.ts`), picks the path `<user id>/<yyyy-mm>/<random>.<ext>`, and returns an upload link. The link lasts 5 minutes and accepts only that file type and exact size (JPEG, PNG, WebP, HEIC or PDF, at most 10 MB).
- **On save:**
  - The server checks that the file exists in the user's own folder with an allowed type and size, and moves it from `tmp/` into place.
  - A replaced or withdrawn receipt is deleted.
  - The database refuses another driver's folder, and freezes a receipt once its expense or fill-up is reviewed or settled (migrations 11 and 13).
- **Viewing:** pages link to `/files/<kind>/<id>`. The row is read with the user's own session, so RLS decides who sees it, and the redirect is to a link that expires after 10 minutes. A driver never gets a link to another driver's file.
- **Clean-up:** uploads never attached to a saved row stay under `tmp/`, and the bucket's lifecycle rule deletes them after a day.

### Setting up R2 (Cloudflare dashboard)
1. **R2 Object Storage** → enable R2. Cloudflare asks for a payment method even for the free 10 GB.
2. **Create bucket:** name `trucking-files`, location Automatic, Standard class. Keep public access **off** (no r2.dev subdomain, no custom domain).
3. Bucket → **Settings** → **CORS policy** → **Add**, and paste. Put the app's address in place of `YOUR-DOMAIN`, e.g. `trucking.<your-subdomain>.workers.dev` (see Hosting):
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

## Hosting (Cloudflare Workers)

The app runs as a Cloudflare Worker named `trucking`. It is built with `@opennextjs/cloudflare`; the settings are in `wrangler.jsonc` and `open-next.config.ts`. The build is 1.7 MB compressed, within the free plan's 3 MB limit.

**One-time setup in the Cloudflare dashboard:** go to **Workers & Pages** → **trucking** → **Settings**.
1. **Build** → **Build configuration**:
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
   - Non-production branch deploy command: `npx opennextjs-cloudflare upload`
   - Root directory: leave it as `/`.
2. **Build** → **Variables and secrets** (used while building): add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Next.js puts these two public values into the pages at build time.
3. **Variables and Secrets** (used while running): add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`, each as type **Secret**.
4. **Domains & Routes:** note the `workers.dev` address and add it to the R2 bucket's CORS rule (step 3 above), so phones can upload receipts from it.
5. **Retry the latest build**, or push a commit.

**Deploys:**
- A push to `main` deploys the live app.
- A push to another branch uploads a preview version, and its link shows on the pull request.
- Uploads work only from addresses listed in the CORS rule.

**Free plan limits:**
- A request may use about 10 ms of CPU.
- If heavy pages start showing "Error 1102 (Worker exceeded resource limits)", move to the Workers Paid plan (about $5 a month).

**Run the Worker locally:**
- Put the `R2_*` values in `.dev.vars`, which is gitignored and uses the same format as `.env.local`.
- Then run `pnpm cf:preview`.
- `pnpm cf:deploy` deploys from your machine after `wrangler login`.

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
  12. diesel approval and settlement, `driver_advance` payment, plausibility checks, fuel alerts
  13. reviewed expenses and fill-ups can't be deleted
  14. daily loading sheet: customer codes, per-customer reference numbers, sheet lines without odometer
- **Demo data:** run these in order:
  1. `supabase/seed.sql`: 15 trucks, about 6 months, all names fictional;
  2. `supabase/seed_phase2.sql`: advances, past settlements, expenses waiting for approval;
  3. `supabase/seed_phase3.sql`: driver-paid diesel, approved and waiting, one of them abnormal.
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

- **4:** work orders, documents and alerts (WhatsApp/SMS).
- **5:** invoicing, checks, JoFotara.
- **6:** auto-posted journal entries, period closing.
- **7:** payroll.
- **8:** reports and exports.
- **9:** hardening.
