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
  - The driver records odometer, full tank or not, the station, and how much: **by the liter (لتر), the gallon (قلن) or the tank (تنكة)**, the quantity and the price per unit. The cost (quantity × price per unit) shows as they type. A **receipt photo is required**.
  - The fill-up waits for approval and is paid from the driver's advance (عهدة).
  - It can be fixed or withdrawn until reviewed. **مصاريفي والديزل** lists both kinds with their status.
- **Approvals:**
  - A diesel section shows the receipt, odometer, quantity with its unit, and the price per unit.
  - It also shows **the km/L this fill-up implies against the truck's normal**, and flags it when it is far off.
  - The accountant can correct the quantity, price per unit, odometer or full tank before approving (in the fill-up's own unit), or reject with a reason.
- **Advances:** approved driver-paid diesel appears in the driver's ledger, the settlement preview and the A4 slip, and is settled with the expenses.
- **Diesel log (الديزل):**
  - Every fill-up with date, truck, driver, station, quantity and unit, price per unit and cost in JOD. Filters for date, truck, driver, station, status and abnormal only.
  - Totals for quantity per unit, cost, km/L and price per liter, and trucks and drivers ranked by km/L.
  - Office entry and editing. A dispatcher's entry goes to approval; the manager's or accountant's counts at once.
- **Expenses (المصاريف):**
  - The office enters an expense for one truck (optionally a trip and driver) or as overhead shared across the fleet, with category, supplier, currency, payment, reference and an optional receipt.
  - It can be edited or deleted until it is settled. Dispatchers can view the list but not enter expenses.
  - Expense categories are under master data (**أنواع المصاريف**).
- **Fuel alerts:** abnormal approved fill-ups from the last 60 days show on the fleet board. The Truck 360 Diesel tab lists fill-ups not counted yet.
- All receipts go through the R2 storage module. Diesel receipts open at `/files/fuel/<id>`.
- **Diesel units:** a gallon (قلن) or a tank (تنكة) is a unit of its own with its own price, which depends on where it was bought. Its size in liters isn't known, so:
  - km/L (and the abnormal check) is measured only between full tanks where every fill-up in between was in liters;
  - the forms suggest the last price paid for that unit at the chosen station, and the user can change it.

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

## Journal entries and account statements (القيود وكشف الحساب)

- **Every expense, diesel fill-up, driver advance and settlement is posted automatically** as a journal entry once it counts (approved):

  | What | Debit | Credit |
  |---|---|---|
  | Expense | its category's expense account, on the truck | how it was paid |
  | Diesel fill-up | 5101 الديزل, on the truck | how it was paid |
  | Advance to a driver | 1105 عهد السائقين (the driver) | cash or bank |
  | Settlement | the difference, in cash: returned by the driver, or paid to him | 1105 or cash |

  "How it was paid": cash → 1101 الصندوق; bank transfer, card or cheque → 1102 البنك; on credit → 2101 ذمم الموردين (the supplier or station); from the driver's advance → 1105 (the driver).
- **Posted entries never change.** When an expense's amount, category, payment, date, truck or supplier changes, its entry is reversed on the same date and a new one is posted. A deleted or rejected one is reversed. Notes and document numbers don't re-post.
- **Documents on an expense:** payment voucher number (رقم سند الصرف, typed from the paper voucher book and never used twice across expenses, fill-ups and advances), customs declaration number (رقم البيان الجمركي), bank notice number (رقم الإشعار), the supplier's invoice number and notes. Fill-ups and advances take the voucher and notice numbers.
- **كشف الحسابات (`/ledger`):** the trial balance for a period (opening, debit, credit, closing per account). The totals always balance.
- **كشف حساب (`/ledger/<account>`):** one account, or **all expense accounts**, for a period, optionally for one truck, supplier or driver:
  - the opening balance, then each line with its date, entry number, description, truck or party, documents, debit, credit and the running balance (مدين / دائن);
  - an A4 print.
- **دفتر اليومية (`/journal`):** every entry with its lines, filtered by date and source, or one entry by its number. Each expense and fill-up page shows its entries.
- The ledger is for the manager and the accountant only.
- Invoices, receipts and cheques are posted too (see the next section). Truck profit still comes from the operations directly.

## Invoices, receipts and customer accounts (الفواتير والذمم)

- **فاتورة جديدة (`/invoices/new`):** pick a customer and a period; the finished loads not invoiced yet (loading-sheet lines and trips) are listed with their reference numbers. Tick the ones to invoice; the subtotal, sales tax and total follow the ticks.
  - Everything is in JOD; a USD load is invoiced at the rate stored with it.
  - Sales tax uses the company rate (16% by default, under **بيانات الشركة**) unless the customer is marked tax-exempt (**معفى من ضريبة المبيعات** on the customer).
  - The database numbers the invoice, sets the due date from the customer's payment terms and posts it: Dr 1103 the customer, Cr 4101 transport revenue (per truck), Cr 2104 sales tax.
- **An issued invoice never changes.** To correct one, cancel it with a reason: its entry is reversed and its loads become free to invoice again. Invoiced loads are locked on the loading sheet.
- **The invoice prints** as an A4 tax invoice with the company and customer tax numbers, the loads, tax, total and the amount in words.
- **المقبوضات (`/receipts`):** cash, bank transfer, cheque (number, bank, due date) or discount; each prints as a receipt voucher (سند قبض).
  - Posting: Dr cash, bank, cheques under collection (1104) or discount allowed (4103); Cr the customer.
  - Cheques waiting to be collected are listed by due date. Mark one deposited, cleared (moves to the bank) or bounced (back on the customer's account).
- **ذمم العملاء (`/receivables`):** each customer's balance, the overdue part (oldest invoices paid first), cheques not collected yet and loads not invoiced yet.
- **كشف حساب زبون (`/receivables/<customer>`):** invoices, receipts and bounced cheques with the running balance, an A4 print for the customer, and a receipt form.
- Invoices, receipts and customer accounts are for the manager and the accountant; company details are for the manager.

## Supplier payments (دفعات الموردين وذممهم)

- **ذمم الموردين (`/payables`):** what each supplier is owed: expenses and diesel bought on credit, less what was paid, from the ledger (account 2101). It also shows cheques the bank has not paid yet and the last purchase and payment. Each supplier opens his account statement.
- **دفعات الموردين (`/payments`):** pay a supplier in cash, by bank transfer (with its reference), with a cheque we issue (number, our bank, due date), or record a discount he gave (خصم مكتسب).
  - **Voucher number:** the payment voucher number (رقم سند الصرف) comes from the same paper book as expenses, diesel and advances, so each number can be used once.
  - **Posting:** Dr the supplier (2101); Cr cash 1101, bank 1102, post-dated cheques 2102, or discount received 4104.
  - **Issued cheques:** they wait in a list by due date. Mark each one paid by the bank (Dr 2102, Cr bank) or bounced (back on the supplier).
  - **Printing:** each payment prints as an A5 payment voucher (سند صرف).
  - **Mistakes:** delete the payment; its entries are reversed.
- Supplier payments and balances are for the manager and the accountant.

## Alerts and Excel export

- **Fleet board alerts:** truck documents and driving licences that have expired or end within 30 days (رخص سائقين تنتهي قريباً, from each active driver's licence expiry), maintenance due, and abnormal diesel.
- **«تصدير Excel»** on every statement and list:
  - which: the trial balance, account statements, customer statements, customer and supplier balances, receipts and payments with their cheque lists, invoices, expenses, diesel, the loading sheet, trips and driver advances;
  - what: the table as shown, with a title row (what, which period) and amounts as numbers. Balances are signed (debit +, credit −) and the action column is left out.
  - how: built in the browser (`src/components/export-button.tsx`, `src/lib/table-export.ts`), so it exports exactly what the filters show.

## Opening balances and Excel import (الأرصدة الافتتاحية والاستيراد)

- **الأرصدة الافتتاحية (`/opening`):** the balances on the first day in the system (manager and accountant).
  - **Opening date:** set the first day first. Balances are as at the start of that day; everything from that day on is entered as normal transactions. The date can be moved (everything moves with it) or removed while nothing depends on it.
  - **Accounts:** cash, bank, assets, loans, capital and so on, one balance each, debit or credit. Customer, supplier, advance and cheque accounts are refused here; they come from their own sections.
  - **Customers and suppliers:** one balance per party, net of the cheques below. It shows in their statements and balances (treated as due on the opening date).
  - **Driver advances:** what each driver still holds. It is settled later like any advance.
  - **Cheques:** customers' cheques still in hand, and our cheques the bank has not paid yet, one by one. They appear in the cheque lists to be marked cleared or bounced; a bounced one goes back onto the party.
  - **Posting:** the balances post as one entry («الأرصدة الافتتاحية») and the difference goes to capital (3101). Each advance and cheque posts its own entry against capital. Any change re-posts.
- **استيراد من Excel (`/import`):** trucks, drivers, customers and suppliers from a filled template.
  - **Template:** download the template (right-to-left, header row, an example row that is skipped), fill one row per record, and upload it.
  - **Checks:** every row is checked in the browser and again on the server with the same rules as the forms. Errors show by row number, and nothing is saved while any row has one.
  - **Existing records:** a record that already exists (same fleet number, name, or national ID for drivers) is left as it is; it only gets its opening balance if it has none yet.
  - **What each template can carry:**
    - customers and suppliers: an opening balance (positive on the usual side);
    - drivers: the advance they hold and their usual truck (by fleet number);
    - trucks: their licence number and expiry.
  - **Reading Excel files:** done in-house on top of `fflate` (`src/lib/xlsx.ts`), tested against a file written by openpyxl.

## Licences (الرخص)

- **Driver form:** when adding or editing a driver, attach a scan of the driving licence (PDF or photo, up to 10 MB) next to its number and expiry. Staff open it from the driver's page; the driver opens his own from his phone (**عرض رخصتي**).
- **Truck form:** when adding or editing a truck, enter the truck licence (رخصة المركبة) number and expiry, and attach its scan.
  - It is saved as the truck's registration document, so it appears in the truck's documents tab with the days left, and in the 60, 30 and 7-day expiry alerts.
  - A later edit updates the same document; the replaced scan is deleted.
  - Truck documents are filed by the manager and the dispatcher; the accountant sees the licence on the form.
- Files are private in R2 (`driver-documents/` and `truck-documents/`) and open through `/files/driver-license/<driver>` and `/files/truck-document/<document>`.

## Customs declarations (البيانات الجمركية)

- **فتح نظام الاستفسار الجمركي:** the button opens the customs inquiry system in a new tab of the user's own browser, where they sign in with the customs broker's account. **The broker's username and password are never stored in the app.** On a declaration's row, the button also copies its number, ready to paste into the search.
  - The link is set under **بيانات الشركة** (https only; `https://www.customs.gov.jo` until it is changed).
- **Attach the declaration (`/customs`):** print or save it as PDF from the customs system, then attach it here with its number, date, an optional load and notes. PDF or photo, at most 10 MB, stored in the private R2 bucket under `customs-documents/`.
  - **فتح / طباعة** opens the file through `/files/customs/<id>` (a link that expires after 10 minutes).
  - Search by declaration number. A declaration number typed on an expense links here.
  - Declarations typed on expenses in the last 6 months with no file yet are listed, each with **إرفاق الملف**.
  - The load's page lists its declarations, with **+ إرفاق بيان** filling in that load.
- Customs declarations are for the manager, the accountant and the dispatcher; drivers never get a link to them.

## Maintenance and work orders (الصيانة وأوامر العمل)

- **الصيانة (`/maintenance`):** trucks in the workshop now (open orders, oldest first, with days in the workshop), periodic services overdue or due soon, and every order opened or closed in a period, filtered by truck, workshop and status, with Excel export.
- **Opening an order (`/maintenance/new`):** truck, workshop or parts supplier, kind (periodic service, repair, tires, inspection, other), the day it went in, the odometer and the work to do. The truck shows **في الورشة** on the fleet board while an order is open. A due service on the list opens an order for it in one click.
- **Lines:** parts (with part number), labour, tires or other, each with quantity and unit price; the total follows. Lines change only while the order is open.
- **Closing (manager and accountant):** when the workshop's invoice is in, with its date and number and how it is paid:

  | Paid | Debit | Credit |
  |---|---|---|
  | on credit (default) | 5102 الصيانة والإصلاح and 5103 الإطارات (tire lines), on the truck | 2101 the workshop, so it shows in ذمم الموردين and is paid from دفعات الموردين |
  | cash | same | 1101, with the payment voucher number from the shared book |
  | bank transfer | same | 1102, with the notice number |

  Tick the periodic services done on the order; they are marked done at the order's odometer and closing date, so the next due point counts from there.
- **A closed order never changes.** Notes, the invoice number and the invoice scan can still be added. To correct one, the manager or accountant reopens it (its entry is reversed), fixes it and closes it again. An open order can be cancelled with a reason, or deleted if it was opened by mistake.
- **Truck profit counts closed orders only, on the day they closed**, so Truck 360, the fleet board and the reports agree with the ledger.
- **Workshop invoice scan:** attach the invoice (PDF or photo, up to 10 MB) on the order's page; it is stored with the truck documents in R2 and opens through `/files/work-order/<id>`.
- **الصيانة الدورية (`/maintenance/schedules`):** every truck's periodic services (every so many km and/or days), the last time done (and on which order), the next due point and what is left. The manager and the dispatcher add, change, pause or delete them.
- **Who:** the manager, accountant and dispatcher open orders and add lines; only the manager and accountant close or reopen them. Drivers see none of it.

## Truck and customer profit reports (تقارير الربح)

Both reports read the same figures as Truck 360 and the fleet board (closed work orders, approved expenses and fill-ups, overhead shares, depreciation, interest), for this month, this year or any range, with Excel export and A4 printing. Manager and accountant only.

- **ربح الشاحنات (`/reports/trucks`):** per truck: trips, km, revenue, diesel, maintenance, direct expenses, overhead share, depreciation, interest, total costs, net profit, margin, cost per km and profit per km, best first, with a totals line. For more than one month, a fleet chart and each truck's net profit month by month.
- **ربح الزبائن (`/reports/clients`):** per customer: loads, tons, revenue and share of revenue, direct costs, the trucks' costs shared to them, net profit, margin and profit per load.
  - **Direct costs:** diesel and expenses entered against one of the customer's loads (e.g. a border toll).
  - **Shared costs:** every other cost of a truck in a month is shared among that truck's loads of that month, **by revenue** (default), **by number of loads**, or **by km** (falls back to revenue when the loads have no km, as loading-sheet lines don't). Exact to the fils.
  - **Idle trucks:** a truck's costs in a month it carried nothing are shown on their own line, never charged to a customer. Loads with no customer have their own line too.
  - **The totals equal the fleet's net profit** in the truck report for the same period, whichever basis is chosen.
  - Each customer opens their loads (`/reports/clients/<id>`): date, reference, truck, route, cargo, freight, direct costs, share of the truck's costs, profit and margin per load.
- In the database: `truck_profit_report`, `truck_profit_monthly`, `client_profit_report` and `client_profit_trips` (migration 24), summed in Postgres because the API returns at most 1,000 rows.

## Bank reconciliation (مطابقة كشف البنك)

- **مطابقة البنك (`/bank`):** each bank statement with its period, opening and closing balances, lines, what is still unmatched and the difference. Manager and accountant only.
- **Entering a statement:**
  - Pick the bank's **Excel (.xlsx) or CSV** file. It is read in the browser: the header row is found by its names (التاريخ / البيان / المرجع / مدين / دائن / المبلغ / الرصيد, or Date / Description / Reference / Debit / Credit / Amount / Balance, and their usual variants), amounts like `1,250.500`, `(75.25)`, `75.25-` or `40 DR` are understood, Arabic CSV files saved as Windows-1256 are decoded, and a file listed newest first is put in order. Opening and closing balance rows are taken as balances, not movements.
  - Check the preview, the period (from the dates in the file), the opening balance (from the file or the previous statement's closing) and the bank's printed closing balance: the statement is not saved while the computed closing differs from it.
  - Or save an empty statement and type its lines. A blank template can be downloaded.
  - Statements of one account don't overlap; a gap or a different opening balance from the previous statement is pointed out.
- **Matching (`/bank/<id>`):**
  - **مطابقة تلقائية** pairs lines one to one with the same amount within 10 days, a line carrying the cheque, notice or voucher number first. Review what it did; any match can be undone.
  - By hand: tick lines on both sides with the same total (one deposit of several cheques, a payment split in two, or a ledger entry and its later reversal) and **مطابقة المحدد**. Ticking a bank line narrows the ledger side to the same amount.
  - A bank line the books don't have yet (charges, interest) is **posted from the statement** against an account (5204 مصاريف وعمولات بنكية, new; or 4102 for interest, or any other, optionally on a truck) and matched in one step. Customer, supplier, advance and cheque movements are entered in their own screens first, then matched.
- **The reconciliation, as of the statement's last day:** the bank's balance, plus deposits in the books not yet in the bank, minus payments and cheques not yet presented, against the book balance plus or minus bank movements not yet in the books. The difference does not depend on matching: if it isn't zero, the opening balance or a missing movement is the cause.
  - Ledger lines before the first statement that were never matched are taken as cleared before it; the opening entry is a balance, not a movement; an entry reversed on its own day cancels out.
- **Closing:** when the difference is zero and every bank line is matched, the statement is closed. It then never changes, and an entry matched in it cannot be reversed (e.g. by editing a bank receipt) until it is reopened. While a statement is open, reversing a matched entry undoes the match so its line shows up again.
- **Printing:** an A4 reconciliation statement with both sides, the outstanding items and signature lines (`/print/bank/<id>`).

## JoFotara e-invoicing (الفوترة الإلكترونية — جوفوترة)

Customer invoices are sent to the national e-invoicing system of the Income and Sales Tax Department, and the QR code it returns is printed on the tax invoice. Manager and accountant only.

- **Sending (`/invoices/<id>` → «إرسال الفاتورة إلى جوفوترة»):** the invoice becomes a UBL 2.1 file (a general sales tax invoice on account, `InvoiceTypeCode name="022"`, 388), base64-encoded and posted to `https://backend.jofotara.gov.jo/core/invoices/` with the `Client-Id` and `Secret-Key` headers.
  - **Accepted** (`SUBMITTED`, or `ALREADY_SUBMITTED` for a resend): JoFotara's number, its UUID and the QR code are kept for good, and the QR prints on the A4 tax invoice.
  - **Rejected:** its reasons show on the invoice; fix the data and send again. The same document (same UUID and invoice counter) is reused for every attempt.
  - **Before sending,** the page lists anything missing: the company's tax number and income source sequence, the customer's tax number.
  - **«ملف XML»** downloads the file to check it, before or after sending.
- **What goes in the file:** the invoice number, its own UUID, the invoice counter (ICV, one per document), the seller (tax number, name, income source sequence), the customer (tax number as `TN`, name, governorate code from the city, phone), and one line per load (route, cargo, references) with its tax. Amounts are JOD with 3 decimals; an exempt customer's lines are category `Z` at 0%.
- **Sales tax is now worked out line by line** (each load's tax rounded to the fils, then summed), because JoFotara checks that the invoice's tax is the sum of its lines' tax and that the totals are the sum of the lines' totals. Invoices issued before keep their totals; their tax is spread over the lines exactly when they are sent.
- **Cancelling a sent invoice** leaves a **credit note (فاتورة إرجاع, 381)** to send, numbered `R-<invoice number>`, referring to the original invoice and carrying the cancellation reason. An invoice cancelled before it was sent needs nothing.
- **The invoices list** shows each invoice's JoFotara status (مقبولة / لم تُرسل / مرفوضة / إرجاع لم يُرسل).
- **Setting it up:**
  1. On the JoFotara portal, register the company's activity and take its **income source sequence (تسلسل مصدر الدخل)**; enter it under **بيانات الشركة** with the company's tax number.
  2. On the portal, link a system (ربط الأنظمة) and take the **Client ID** and **Secret Key**.
  3. Set them where the app runs as **secrets**, never in the database or with a `NEXT_PUBLIC_` prefix: `JOFOTARA_CLIENT_ID` and `JOFOTARA_SECRET_KEY` (Cloudflare: Workers & Pages → trucking → Settings → Variables and Secrets, type Secret). `JOFOTARA_URL` changes the address only if ISTD gives another one.
  4. Every customer that is invoiced needs its tax number under العملاء.
  5. **Every accepted invoice is real and reported to the tax department.** There is no test mode: send a first real invoice, check it on the portal, then carry on.
- Built from ISTD's technical guide as published; the file and its rules (`src/lib/jofotara-xml.ts`) are unit-tested, but sending has not been tried against the live system from here. If JoFotara rejects the first invoice, its reason shows on the invoice page.

## Accuracy rules (enforced in the database)

- **Every cost has a truck, or is marked overhead.** Overhead is allocated to trucks by rule (`equal` or `by_km` in `company_settings`), exactly to the fils.
- **Posted journal entries can't be edited or deleted.** Corrections go through `reverse_journal_entry()`.
- **Money is stored as integer minor units** (JOD fils, USD cents) with the exchange rate. The JOD amount is fixed when the row is written.
- **Drivers see only their own rows** (RLS). Dispatchers can't see the journal, purchase values or financing.
- **Driver expenses and fill-ups count only once approved**, and only the accountant or manager can approve. Settled advances, expenses and fill-ups can't be changed, and settlements can't be edited or deleted.
- **A reviewed expense or fill-up can't be deleted**, and neither can its receipt. A wrong one is corrected or reversed with a new row.
- **Fill-ups must be plausible:** liters no more than the truck's tank (for fill-ups in liters), and the odometer between the truck's earlier and later fill-ups.
- **A fill-up's cost is always quantity × price per unit**; the database recomputes it on every write.

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
3. **Variables and Secrets** (used while running): add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`, each as type **Secret**; and, when the company is ready to send e-invoices, `JOFOTARA_CLIENT_ID` and `JOFOTARA_SECRET_KEY` (see JoFotara above).
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
  15. customer invoicing: invoices, receipts (cash, bank, cheque, discount), customer statement and balances
  16. diesel by the liter, gallon (قلن) or tank (تنكة): unit, quantity and price per unit
  17. expenses, diesel, advances and settlements posted as journal entries; voucher, customs declaration and notice numbers; account statement and trial balance
  18. invoices, receipts and cheques posted as journal entries; discount allowed account (4103)
  19. customs declarations on file (PDF or photo) and the customs inquiry system link
  20. supplier payments and issued cheques posted as journal entries; discount received account (4104); supplier balances
  21. driving licence scan on the driver
  22. opening balances: opening date, balances per account/customer/supplier posted as one entry, opening driver advances and cheques
  23. maintenance work orders: open → closed (manager or accountant, with the workshop invoice and payment) → posted; reopen and cancel; services marked done; truck profit counts closed orders
  24. truck and customer profit reports: per truck, per month, per customer (direct costs plus the truck-month's other costs shared by revenue, loads or km; idle trucks apart)
  25. bank reconciliation: bank statements and lines, matches with ledger lines on 1102, outstanding items as of a day, posting bank lines, closing and reopening; bank charges account (5204)
  26. JoFotara: e-invoice documents (invoice and credit note, UUID, invoice counter, JoFotara's answer and QR), sales tax per invoice line, income source sequence setting
- **Demo data:** run these in order:
  1. `supabase/seed.sql`: 15 trucks, about 6 months, all names fictional;
  2. `supabase/seed_phase2.sql`: advances, past settlements, expenses waiting for approval;
  3. `supabase/seed_phase3.sql`: driver-paid diesel, approved and waiting, one of them abnormal;
  4. `supabase/seed_invoices.sql`: monthly invoices with bank, cheque and bounced-cheque receipts (also loaded on the live demo).
  5. `supabase/seed_payments.sql`: monthly payments to suppliers by transfer, a paid cheque with a discount, and cheques not paid yet.
- **Before go-live:**
  - Run `supabase/reset_demo.sql`. It keeps the chart of accounts, categories and settings, and restarts the numbering (trips, invoices, receipts, journal entries) from 1.
  - Run `truncate audit.log;`.
  - Empty the R2 bucket `trucking-files` (demo receipt photos), and once R2 is confirmed, remove the old Supabase Storage buckets.
  - Delete the demo users in Supabase Auth.
  - Then: import trucks, drivers, customers and suppliers from Excel (`/import`), set the opening date and enter the opening balances (`/opening`).

## Users

1. Create users in the Supabase dashboard: **Authentication → Users → Add user**.
2. The very first user becomes **manager**. Everyone after that starts with no access until a manager assigns a role under **المستخدمون**.
3. Turn off public sign-ups in Supabase Auth settings; the app has no sign-up page.

## Next phases

- Done since: work orders, JoFotara, bank reconciliation, truck and customer profit reports.
- **Next:** tire stock and fitting from work orders, alerts by WhatsApp/SMS, manual journal entries and period closing, payroll, hardening.
