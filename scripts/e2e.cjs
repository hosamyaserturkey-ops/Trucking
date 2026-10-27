// End-to-end check against a running app (pnpm build && pnpm start).
//   E2E_MANAGER_EMAIL=... E2E_MANAGER_PASSWORD=... E2E_DRIVER_EMAIL=... E2E_DRIVER_PASSWORD=... pnpm e2e
// With E2E_ACCOUNTANT_* and E2E_DISPATCHER_* as well, it also runs the trip ->
// driver expense -> approval -> advance -> settlement flow. That flow writes
// demo data (a trip, two expenses, an advance, a settlement), so run it against
// demo data only.
// Optional: BASE_URL (default http://localhost:3000), E2E_OUT (default test-results/e2e),
// E2E_TRUCK_CODE (truck to use when the driver has no current trip, default T-01),
// E2E_STORAGE_ORIGIN (where receipt links must point, e.g. http://127.0.0.1:9000 for a
// local MinIO or https://<account>.r2.cloudflarestorage.com), E2E_BROWSER_PROXY (an
// HTTPS proxy the browser must use to reach R2; its certificate is then not checked).
// Uses the Playwright that is installed globally; `npx playwright` works too.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? path.join("test-results", "e2e");
const TABS = ["", "trips", "diesel", "maintenance", "documents", "expenses", "financials"];
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };

const PROXY = process.env.E2E_BROWSER_PROXY;
const failures = [];
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
  return value;
}

async function login(browser, email, password, viewport) {
  const context = await browser.newContext({ viewport, locale: "ar-JO", timezoneId: "Asia/Amman", ignoreHTTPSErrors: !!PROXY });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 }), page.click("button[type=submit]")]);
  await page.waitForLoadState("networkidle");
  return { context, page };
}

async function layoutOk(page) {
  return page.evaluate(() => ({
    rtl: document.documentElement.dir === "rtl",
    noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    loadError: document.body.innerText.includes("تعذر"),
  }));
}


const UUID_PATH = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Click and wait until `done` appears; on a form error, return its text instead of hanging. */
async function clickAndWait(page, button, done, timeout = 20000) {
  await button.click();
  const alert = page.locator("main [role=alert]").first();
  await Promise.race([done.waitFor({ timeout }), alert.waitFor({ timeout })]).catch(() => {});
  if (await done.count()) return null;
  return (await alert.count()) ? await alert.innerText() : "timed out";
}

const odometerIn = (text, label) => Number((new RegExp(`${label}: ([\\d,]+)`).exec(text)?.[1] ?? "0").replace(/,/g, ""));

// Phase 2: dispatcher plans a trip, the driver runs it from the phone and sends
// expenses, the accountant reviews them, issues an advance and settles.
async function tripAndAdvanceFlow(browser) {
  const stamp = `e2e-${Date.now().toString(36)}`;
  const drv = await login(browser, need("E2E_DRIVER_EMAIL"), need("E2E_DRIVER_PASSWORD"), VIEWPORTS.mobile);
  drv.page.on("dialog", (d) => d.accept());
  const driverName = (await drv.page.locator("h1").innerText()).replace(/^أهلاً\s*/, "").trim();
  let card = await drv.page.locator("main section").first().innerText();
  const truckCode = /الشاحنة\s+(\S+)/.exec(card)?.[1] ?? process.env.E2E_TRUCK_CODE ?? "T-01";

  // 1. Driver finishes whatever trip is still running.
  const finish = drv.page.getByRole("button", { name: "إنهاء الرحلة" });
  if (await finish.count()) {
    await drv.page.fill("input[name=odometer]", String(odometerIn(card, "قراءة البداية") + 410));
    const err = await clickAndWait(drv.page, finish, drv.page.getByText(/الرحلة القادمة|لا توجد رحلة مخططة/));
    check(!err, `driver finishes the running trip${err ? `: ${err}` : ""}`);
  }

  // 2. Dispatcher plans a new trip for this driver and truck.
  const disp = await login(browser, need("E2E_DISPATCHER_EMAIL"), need("E2E_DISPATCHER_PASSWORD"), VIEWPORTS.desktop);
  disp.page.on("dialog", (d) => d.accept());
  await disp.page.goto(`${BASE}/approvals`);
  check(new URL(disp.page.url()).pathname === "/", "dispatcher is kept out of approvals");
  await disp.page.goto(`${BASE}/trips/new`);
  const truckId = await disp.page.locator("#truck_id option", { hasText: truckCode }).first().getAttribute("value");
  await disp.page.selectOption("#truck_id", truckId);
  await disp.page.selectOption("#driver_id", { label: driverName });
  await disp.page.selectOption("#from_location_id", { index: 1 });
  await disp.page.selectOption("#to_location_id", { index: 2 });
  await disp.page.selectOption("#client_id", { index: 1 });
  await disp.page.fill("#cargo_description", stamp);
  await disp.page.fill("#freight", "640");
  await Promise.all([
    disp.page.waitForURL(UUID_PATH, { timeout: 20000 }),
    disp.page.getByRole("button", { name: "حفظ الرحلة" }).click(),
  ]);
  const tripId = new URL(disp.page.url()).pathname.split("/")[2];
  const tripNo = /(\d+)/.exec(await disp.page.locator("h1").innerText())?.[1];
  check(!!tripNo, `dispatcher creates trip ${tripNo} for ${truckCode}`);

  // 3. Driver starts it with the odometer the phone suggests.
  await drv.page.goto(`${BASE}/my`);
  card = await drv.page.locator("main section").first().innerText();
  check(card.includes(`رحلة رقم ${tripNo}`), "driver sees the new trip as the next trip");
  const start = drv.page.getByRole("button", { name: "بدء الرحلة" });
  let err = await clickAndWait(drv.page, start, finish);
  const atLeast = err && /\(([\d,]+)\)/.exec(err)?.[1];
  if (atLeast) {
    // The phone only sees this driver's readings; the database knows the truck's latest one.
    await drv.page.fill("input[name=odometer]", atLeast.replace(/,/g, ""));
    err = await clickAndWait(drv.page, start, finish);
  }
  check(!err, `driver starts the trip${err ? `: ${err}` : ""}`);

  // 4. Driver sends one expense with a receipt photo and one without.
  const jpeg = await drv.page.screenshot({ type: "jpeg", quality: 70 });
  await drv.page.click('a[href^="/my/expense/new"]');
  await drv.page.waitForURL(/\/my\/expense\/new/);
  check((await drv.page.inputValue("#trip_id")) === tripId, "expense form defaults to the running trip");
  await drv.page.selectOption("#category_id", { label: "موازين ومواقف" });
  await drv.page.fill("#amount", "7.250");
  await drv.page.fill("#description", `${stamp} receipt`);

  // Files storage refuses anything but images/PDF, and anything over 10 MB, before uploading.
  const send = drv.page.getByRole("button", { name: "إرسال للموافقة" });
  const formAlert = drv.page.locator("main [role=alert]");
  await drv.page.setInputFiles("input[name=photo]", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a receipt") });
  await send.click();
  await formAlert.waitFor({ timeout: 15000 });
  check((await formAlert.innerText()).includes("نوع الملف غير مسموح"), "a text file is refused as a receipt");
  await drv.page.setInputFiles("input[name=photo]", {
    name: "big.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(11 * 1024 * 1024)]),
  });
  await send.click();
  await drv.page.getByText("10 ميغابايت").waitFor({ timeout: 15000 });
  check(true, "a receipt over 10 MB is refused");
  check(/\/my\/expense\/new/.test(drv.page.url()), "nothing was saved after the refused files");
  await drv.page.setInputFiles("input[name=photo]", { name: "receipt.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await drv.page.screenshot({ path: path.join(OUT, "driver-expense-form.png"), fullPage: true });
  await Promise.all([
    drv.page.waitForURL(/\/my\?saved=1/, { timeout: 30000 }),
    drv.page.getByRole("button", { name: "إرسال للموافقة" }).click(),
  ]);
  const sent = drv.page.locator("li", { hasText: `${stamp} receipt` });
  check((await sent.innerText()).includes("بانتظار الموافقة"), "driver's expense waits for approval");
  check((await sent.locator("[aria-label='مرفق إيصال']").count()) === 1, "receipt photo is attached");

  // The receipt opens through /files/…: a redirect to a short-lived link on the file storage, not Supabase.
  const receiptHref = await sent.locator("a[href^='/files/expense/']").getAttribute("href");
  const opened = await drv.page.request.get(`${BASE}${receiptHref}`, { maxRedirects: 0 });
  const location = opened.headers()["location"] ?? "";
  check(opened.status() === 302 && !/supabase\.co/.test(location), "driver's receipt link redirects to the file storage");
  if (process.env.E2E_STORAGE_ORIGIN) {
    check(location.startsWith(`${process.env.E2E_STORAGE_ORIGIN}/`), `receipt is served from ${process.env.E2E_STORAGE_ORIGIN}`);
  }
  const signed = new URL(location);
  check(Number(signed.searchParams.get("X-Amz-Expires")) <= 1800, "view link expires within 30 minutes");
  const photo = await drv.page.request.get(location);
  check(photo.status() === 200 && /^image\//.test(photo.headers()["content-type"] ?? ""), "the stored receipt photo downloads");
  const receiptExpenseId = receiptHref.split("/").pop();
  await drv.page.click('a[href^="/my/expense/new"]');
  await drv.page.waitForURL(/\/my\/expense\/new/);
  await drv.page.selectOption("#category_id", { label: "إعاشة" });
  await drv.page.fill("#amount", "4");
  await drv.page.fill("#description", `${stamp} reject`);
  await Promise.all([
    drv.page.waitForURL(/\/my\?saved=1/, { timeout: 30000 }),
    drv.page.getByRole("button", { name: "إرسال للموافقة" }).click(),
  ]);

  // 4b. Driver sends a diesel fill-up paid from the advance, with its receipt photo.
  await drv.page.click('a[href^="/my/fuel/new"]');
  await drv.page.waitForURL(/\/my\/fuel\/new/);
  check((await drv.page.inputValue("#trip_id")) === tripId, "diesel form defaults to the running trip");
  const lastOdo = Number((/([\d,]+) كم/.exec(await drv.page.locator("text=آخر قراءة مسجلة").innerText())?.[1] ?? "0").replace(/,/g, ""));
  await drv.page.fill("#odometer", String(lastOdo + 300));
  await drv.page.fill("#liters", "120");
  await drv.page.fill("#amount", "78");
  await drv.page.fill("#notes", `${stamp} fuel`);
  check((await drv.page.locator("text=سعر اللتر").innerText()).includes("0.650"), "diesel form shows the price per liter");
  const fuelSend = drv.page.getByRole("button", { name: "إرسال للموافقة" });
  await fuelSend.click();
  await drv.page.locator("main [role=alert]").waitFor({ timeout: 15000 });
  check((await drv.page.locator("main [role=alert]").innerText()).includes("صوّر إيصال التعبئة"), "a fill-up without its receipt photo is refused");
  await drv.page.setInputFiles("input[name=photo]", { name: "fuel.jpg", mimeType: "image/jpeg", buffer: jpeg });
  const fuelForm = await layoutOk(drv.page);
  check(fuelForm.rtl && fuelForm.noSideScroll, "diesel form is RTL without sideways scroll on a phone");
  await drv.page.screenshot({ path: path.join(OUT, "driver-fuel-form.png"), fullPage: true });
  await Promise.all([drv.page.waitForURL(/\/my\?saved=fuel/, { timeout: 30000 }), fuelSend.click()]);
  const sentFuel = drv.page.locator("li", { hasText: "ديزل · 120.00 لتر" }).filter({ hasText: "بانتظار الموافقة" }).first();
  check((await sentFuel.count()) === 1, "driver's fill-up waits for approval");
  check((await sentFuel.locator("a[href^='/files/fuel/']").count()) === 1, "fill-up receipt is attached");

  // 5. Driver finishes the trip.
  card = await drv.page.locator("main section").first().innerText();
  await drv.page.fill("input[name=odometer]", String(odometerIn(card, "قراءة البداية") + 320));
  err = await clickAndWait(drv.page, finish, drv.page.getByText(/الرحلة القادمة|لا توجد رحلة مخططة/));
  check(!err, `driver finishes the trip${err ? `: ${err}` : ""}`);
  await drv.page.screenshot({ path: path.join(OUT, "driver-my-after-trip.png"), fullPage: true });

  // 6. Accountant approves one, rejects the other.
  const acc = await login(browser, need("E2E_ACCOUNTANT_EMAIL"), need("E2E_ACCOUNTANT_PASSWORD"), VIEWPORTS.desktop);
  acc.page.on("dialog", (d) => d.accept());
  await acc.page.goto(`${BASE}/approvals`);
  const toApprove = acc.page.locator("li[data-expense-id]", { hasText: `${stamp} receipt` });
  check((await toApprove.count()) === 1, "accountant sees the expense in approvals");
  const photoWidth = await toApprove.locator("img").evaluate((img) =>
    img.complete ? img.naturalWidth : new Promise((resolve) => (img.onload = () => resolve(img.naturalWidth))),
  );
  check(photoWidth > 0, "receipt photo loads from private storage");
  const accView = await acc.page.request.get(`${BASE}/files/expense/${receiptExpenseId}`, { maxRedirects: 0 });
  check(accView.status() === 302, "accountant can open the driver's receipt");

  // Another driver's expense: hidden by RLS, so the driver gets no link at all.
  const foreignId = await acc.page
    .locator("li[data-expense-id]")
    .filter({ hasNotText: driverName })
    .first()
    .getAttribute("data-expense-id");
  const foreign = await drv.page.request.get(`${BASE}/files/expense/${foreignId}`, { maxRedirects: 0 });
  check(foreign.status() === 404 && !foreign.headers()["location"], "a driver gets no link to another driver's expense file");
  for (const odd of [`/files/secrets/${receiptExpenseId}`, "/files/expense/not-an-id", "/files/expense/%2e%2e%2fsecret"]) {
    const res = await drv.page.request.get(`${BASE}${odd}`, { maxRedirects: 0 });
    check(res.status() === 404 && !res.headers()["location"], `no link for ${odd}`);
  }
  await acc.page.screenshot({ path: path.join(OUT, "approvals.png"), fullPage: true });
  await toApprove.getByRole("button", { name: "اعتماد" }).click();
  await toApprove.waitFor({ state: "detached", timeout: 20000 });
  const toReject = acc.page.locator("li[data-expense-id]", { hasText: `${stamp} reject` });
  await toReject.getByRole("button", { name: "رفض" }).click();
  await toReject.locator("input[name=reason]").fill("e2e: لا يوجد إيصال");
  await toReject.getByRole("button", { name: "تأكيد الرفض" }).click();
  await toReject.waitFor({ state: "detached", timeout: 20000 });
  check(true, "accountant approves one expense and rejects the other");

  // The fill-up: receipt, implied km/L next to the truck's usual figure, then approve.
  const fillRow = acc.page.locator("li[data-fillup-id]", { hasText: `${stamp} fuel` });
  check((await fillRow.count()) === 1, "accountant sees the fill-up in approvals");
  const fuelPhoto = await fillRow.locator("img").evaluate((img) =>
    img.complete ? img.naturalWidth : new Promise((resolve) => (img.onload = () => resolve(img.naturalWidth))),
  );
  check(fuelPhoto > 0, "fill-up receipt photo loads from private storage");
  check(/كم\/لتر/.test(await fillRow.innerText()), "approvals shows the km/L the fill-up implies");
  await fillRow.getByRole("button", { name: "اعتماد" }).click();
  await fillRow.waitFor({ state: "detached", timeout: 20000 });
  check(true, "accountant approves the fill-up");
  await acc.page.goto(`${BASE}/trucks/${truckId}/diesel?range=month`);
  check((await acc.page.locator("tr", { hasText: "120.00" }).count()) >= 1, "approved fill-up shows on the truck's Diesel tab");

  await acc.page.goto(`${BASE}/trucks/${truckId}/expenses?range=month`);
  const row = acc.page.locator("tr", { hasText: `${stamp} receipt` });
  check((await row.count()) === 1 && (await row.innerText()).includes("معتمد"), "approved expense shows on the truck's Expenses tab");
  check((await acc.page.locator("tr", { hasText: `${stamp} reject` }).count()) === 0 || (await acc.page.locator("tr", { hasText: `${stamp} reject` }).innerText()).includes("مرفوض"), "rejected expense is not counted as approved");

  await drv.page.goto(`${BASE}/my`);
  check((await drv.page.locator("li", { hasText: `${stamp} reject` }).innerText()).includes("سبب الرفض: e2e: لا يوجد إيصال"), "driver sees the rejection reason");

  // 7. Accountant issues an advance for the trip, then settles the driver.
  await acc.page.goto(`${BASE}/advances`);
  await acc.page.locator("table a", { hasText: driverName }).click();
  await acc.page.waitForURL(UUID_PATH);
  await acc.page.selectOption("#adv_trip", tripId);
  await acc.page.fill("#adv_amount", "50");
  await acc.page.fill("#adv_notes", stamp);
  err = await clickAndWait(acc.page, acc.page.getByRole("button", { name: "تسجيل العهدة" }), acc.page.getByText("تم تسجيل العهدة."));
  check(!err, `accountant issues an advance${err ? `: ${err}` : ""}`);
  check((await acc.page.locator("tr", { hasText: stamp }).count()) === 2, "advance and approved expense are open movements");
  check((await acc.page.locator("tr", { hasText: "ديزل · 120.00 لتر" }).count()) >= 1, "driver-paid diesel is an open movement");
  await acc.page.screenshot({ path: path.join(OUT, "advance-driver.png"), fullPage: true });
  await Promise.all([
    acc.page.waitForURL(/settled=/, { timeout: 20000 }),
    acc.page.getByRole("button", { name: "تسوية", exact: true }).click(),
  ]);
  // The redirect after a server action is a client-side navigation; wait for the new content.
  const closed = await acc.page.getByText("لا توجد حركات مفتوحة.").waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(closed, "settlement closes every open movement");
  const slipHref = await acc.page.getByRole("link", { name: "طباعة سند التسوية" }).getAttribute("href");
  const slip = await acc.context.newPage();
  await slip.goto(`${BASE}${slipHref}`);
  const slipText = await slip.locator("main").innerText();
  check(slipText.includes(`${stamp} receipt`) && slipText.includes(stamp), "settlement slip lists the advance and the expense");
  check(slipText.includes("ديزل دفعه السائق") && slipText.includes("120.00"), "settlement slip lists the diesel");
  await slip.pdf({ path: path.join(OUT, "settlement.pdf"), format: "A4", printBackground: true });
  check(fs.statSync(path.join(OUT, "settlement.pdf")).size > 10000, "settlement slip exports to PDF");

  // 8. Dispatcher adds the empty return leg, then cancels it so the next run starts clean.
  await disp.page.goto(`${BASE}/trips/${tripId}`);
  await disp.page.getByRole("link", { name: "رحلة العودة" }).click();
  await disp.page.waitForURL(/return_of=/);
  await disp.page.check("input[name=is_empty_return]");
  await Promise.all([
    disp.page.waitForURL(UUID_PATH, { timeout: 20000 }),
    disp.page.getByRole("button", { name: "حفظ الرحلة" }).click(),
  ]);
  check((await disp.page.locator("main").innerText()).includes("عودة فارغة"), "dispatcher creates the empty return leg");
  await disp.page.screenshot({ path: path.join(OUT, "return-leg.png"), fullPage: true });
  err = await clickAndWait(disp.page, disp.page.getByRole("button", { name: "إلغاء الرحلة" }), disp.page.locator("main").getByText("ملغاة").first());
  check(!err, `dispatcher cancels the return leg${err ? `: ${err}` : ""}`);

  // 9. Office expenses: an overhead cost, and a truck cost with a receipt on another driver.
  await acc.page.goto(`${BASE}/expenses/new`);
  await acc.page.check("input[name=cost_scope][value=overhead]");
  await acc.page.selectOption("#category_id", { index: 1 });
  await acc.page.fill("#description", `${stamp} overhead`);
  await acc.page.fill("#amount", "25");
  await acc.page.selectOption("#payment_method", "bank");
  await Promise.all([acc.page.waitForURL(/\/expenses\?saved=1/, { timeout: 30000 }), acc.page.getByRole("button", { name: "حفظ المصروف" }).click()]);
  check((await acc.page.locator("tr", { hasText: `${stamp} overhead` }).innerText()).includes("عام"), "accountant records an overhead expense");

  await acc.page.goto(`${BASE}/expenses/new`);
  const otherTruck = await acc.page.locator("#truck_id option").filter({ hasNotText: truckCode }).nth(4).getAttribute("value");
  await acc.page.selectOption("#truck_id", otherTruck);
  check((await acc.page.inputValue("#driver_id")) !== "", "the truck's driver is filled in");
  await acc.page.selectOption("#category_id", { index: 2 });
  await acc.page.fill("#description", `${stamp} foreign`);
  await acc.page.fill("#amount", "12");
  await acc.page.setInputFiles("input[name=photo]", { name: "invoice.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await Promise.all([acc.page.waitForURL(/\/expenses\?saved=1/, { timeout: 30000 }), acc.page.getByRole("button", { name: "حفظ المصروف" }).click()]);
  const foreignHref = await acc.page.locator("tr", { hasText: `${stamp} foreign` }).locator("a[href^='/files/expense/']").getAttribute("href");
  const accForeign = await acc.page.request.get(`${BASE}${foreignHref}`, { maxRedirects: 0 });
  check(accForeign.status() === 302, "accountant can open the receipt on the other truck's expense");
  const drvForeign = await drv.page.request.get(`${BASE}${foreignHref}`, { maxRedirects: 0 });
  check(drvForeign.status() === 404 && !drvForeign.headers()["location"], "a driver gets no link to a receipt on another driver's expense");

  for (const [label, url] of [
    ["expenses list", "/expenses"],
    ["diesel log", "/diesel"],
    ["abnormal diesel", "/diesel?abnormal=1"],
    ["expense categories", "/master/expense_categories"],
  ]) {
    const res = await acc.page.goto(`${BASE}${url}`);
    const ok = await layoutOk(acc.page);
    check(res.ok() && ok.rtl && ok.noSideScroll && !ok.loadError, `accountant opens the ${label}`);
  }
  await acc.page.goto(`${BASE}/diesel`);
  await acc.page.screenshot({ path: path.join(OUT, "diesel.png"), fullPage: true });
  await acc.page.goto(`${BASE}/expenses`);
  await acc.page.screenshot({ path: path.join(OUT, "expenses.png"), fullPage: true });

  const phone = await login(browser, need("E2E_ACCOUNTANT_EMAIL"), need("E2E_ACCOUNTANT_PASSWORD"), VIEWPORTS.mobile);
  for (const url of ["/diesel", "/expenses", "/approvals"]) {
    await phone.page.goto(`${BASE}${url}`);
    const ok = await layoutOk(phone.page);
    check(ok.rtl && ok.noSideScroll, `${url} fits a phone`);
  }
  await phone.context.close();

  await disp.page.goto(`${BASE}/expenses`);
  check(new URL(disp.page.url()).pathname === "/expenses" && (await disp.page.getByRole("link", { name: "مصروف جديد" }).count()) === 0,
    "dispatcher sees expenses but cannot add them");
  await disp.page.goto(`${BASE}/expenses/new`);
  check(new URL(disp.page.url()).pathname !== "/expenses/new", "dispatcher is kept out of the expense form");

  // 10. Daily loading sheet: one line per load, references from the customer's own series.
  // The dispatcher's page already accepts confirmation dialogs (step 2).
  const sheetUrl = disp.page.url.bind(disp.page);
  const addLoad = async (label, tons) => {
    await disp.page.goto(`${BASE}/loading`);
    const truckValue = await disp.page.locator("#truck_id option").filter({ hasText: truckCode }).first().getAttribute("value");
    await disp.page.selectOption("#truck_id", truckValue);
    await disp.page.selectOption("#client_id", { index: 1 });
    await disp.page.selectOption("#from_location_id", { index: 1 });
    await disp.page.selectOption("#to_location_id", { index: 2 });
    await disp.page.fill("#cargo_description", `${stamp} ${label}`);
    await disp.page.fill("#cargo_weight_tons", tons);
    await disp.page.fill("#freight", "210");
    await disp.page.fill("#client_doc_no", `BL-${label}`);
    const driverFilled = (await disp.page.inputValue("#driver_id")) !== "";
    await Promise.all([
      disp.page.waitForURL(/\/loading\?.*saved=/, { timeout: 30000 }),
      disp.page.getByRole("button", { name: "حفظ النقلة" }).click(),
    ]);
    return { ref: new URL(sheetUrl()).searchParams.get("saved") ?? "", driverFilled };
  };
  const refNo = (ref) => Number(ref.split("-").pop());

  const first = await addLoad("sheet A", "30.5");
  check(first.driverFilled, "the loading sheet fills in the truck's driver");
  check(/^[A-Z0-9]{2,6}-\d{4}$/.test(first.ref), `a sheet line gets a customer reference (${first.ref})`);
  check((await disp.page.locator("tr", { hasText: `${stamp} sheet A` }).innerText()).includes(first.ref), "the line shows its reference on the sheet");
  const second = await addLoad("sheet B", "28");
  check(second.ref.split("-")[0] === first.ref.split("-")[0] && refNo(second.ref) === refNo(first.ref) + 1,
    "the next load for the same customer takes the next number");

  await disp.page.locator("tr", { hasText: `${stamp} sheet A` }).getByRole("link", { name: "تعديل" }).click();
  await disp.page.waitForURL(/\/loading\/[0-9a-f-]{36}\/edit/);
  await disp.page.fill("#cargo_weight_tons", "31");
  await Promise.all([
    disp.page.waitForURL(/\/loading\?.*saved=/, { timeout: 30000 }),
    disp.page.getByRole("button", { name: "حفظ التعديلات" }).click(),
  ]);
  check(new URL(sheetUrl()).searchParams.get("saved") === first.ref, "editing a line keeps its reference");

  await Promise.all([
    disp.page.waitForURL(/\/loading\?.*deleted=1/, { timeout: 30000 }),
    disp.page.locator("tr", { hasText: `${stamp} sheet B` }).getByRole("button").click(),
  ]);
  check((await disp.page.locator("tr", { hasText: `${stamp} sheet B` }).count()) === 0, "a line typed by mistake can be deleted");
  const third = await addLoad("sheet C", "29");
  check(refNo(third.ref) === refNo(second.ref) + 1, "a deleted line's number is not given out again");

  await disp.page.goto(`${BASE}/trips`);
  const sheetTrip = disp.page.locator("tr", { hasText: first.ref });
  check((await sheetTrip.count()) === 1 && (await sheetTrip.innerText()).includes("كشف"), "sheet lines also show in the trips list, marked كشف");

  await disp.page.goto(`${BASE}/print/loading`);
  check((await disp.page.content()).includes(third.ref), "the printable loading sheet lists the day's loads");
  await disp.page.pdf({ path: path.join(OUT, "loading-sheet.pdf"), format: "A4", landscape: true, printBackground: true });
  check(fs.statSync(path.join(OUT, "loading-sheet.pdf")).size > 10000, "the loading sheet exports to PDF");

  await acc.page.goto(`${BASE}/loading`);
  check((await acc.page.locator("tr", { hasText: first.ref }).count()) === 1 && (await acc.page.locator("#truck_id").count()) === 0,
    "the accountant sees the sheet but cannot add lines");
  await acc.page.screenshot({ path: path.join(OUT, "loading.png"), fullPage: true });

  const sheetPhone = await login(browser, need("E2E_DISPATCHER_EMAIL"), need("E2E_DISPATCHER_PASSWORD"), VIEWPORTS.mobile);
  await sheetPhone.page.goto(`${BASE}/loading`);
  const sheetFits = await layoutOk(sheetPhone.page);
  check(sheetFits.rtl && sheetFits.noSideScroll, "/loading fits a phone");
  await sheetPhone.context.close();

  // Leave the demo data as it was: remove this run's sheet lines.
  for (const label of ["sheet A", "sheet C"]) {
    await disp.page.goto(`${BASE}/loading`);
    await Promise.all([
      disp.page.waitForURL(/\/loading\?.*deleted=1/, { timeout: 30000 }),
      disp.page.locator("tr", { hasText: `${stamp} ${label}` }).getByRole("button").click(),
    ]);
  }

  for (const s of [drv, disp, acc]) await s.context.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(PROXY ? { proxy: { server: PROXY, bypass: "localhost,127.0.0.1" } } : {});

  // Manager: fleet board and every Truck 360 tab, desktop and phone width.
  let truckId = null;
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const { context, page } = await login(browser, need("E2E_MANAGER_EMAIL"), need("E2E_MANAGER_PASSWORD"), viewport);
    check(new URL(page.url()).pathname === "/", `manager lands on the fleet board (${name})`);
    const cards = page.locator('a[href^="/trucks/"]');
    check((await cards.count()) > 0, `fleet board lists trucks (${name})`);
    await page.screenshot({ path: path.join(OUT, `fleet-${name}.png`), fullPage: true });
    truckId ??= (await cards.first().getAttribute("href")).split("/")[2];

    for (const tab of TABS) {
      const url = `${BASE}/trucks/${truckId}${tab ? `/${tab}` : ""}?range=year`;
      const res = await page.goto(url);
      const ok = await layoutOk(page);
      const label = `${tab || "overview"} (${name})`;
      check(res.ok(), `${label} loads`);
      check(ok.rtl && ok.noSideScroll, `${label} is RTL without sideways scroll`);
      check(!ok.loadError, `${label} has no load errors`);
      await page.screenshot({ path: path.join(OUT, `truck-${tab || "overview"}-${name}.png`), fullPage: true });
    }

    if (name === "desktop") {
      await page.goto(`${BASE}/print/trucks/${truckId}?range=year`);
      await page.pdf({ path: path.join(OUT, "truck-statement.pdf"), format: "A4", printBackground: true });
      check(fs.statSync(path.join(OUT, "truck-statement.pdf")).size > 10000, "truck statement exports to PDF");
      for (const p of ["/master/trucks", "/master/accounts", "/settings/users", "/audit"]) {
        const res = await page.goto(`${BASE}${p}`);
        check(res.ok() && new URL(page.url()).pathname === p, `manager opens ${p}`);
      }
    }
    await context.close();
  }

  // Driver: own page only; staff pages redirect back to /my.
  const { context, page } = await login(browser, need("E2E_DRIVER_EMAIL"), need("E2E_DRIVER_PASSWORD"), VIEWPORTS.mobile);
  check(new URL(page.url()).pathname === "/my", "driver lands on /my");
  await page.screenshot({ path: path.join(OUT, "driver-my.png"), fullPage: true });
  for (const p of [`/trucks/${truckId}`, `/trucks/${truckId}/financials`, "/master/trucks", "/audit", "/"]) {
    await page.goto(`${BASE}${p}`);
    check(new URL(page.url()).pathname === "/my", `driver is kept out of ${p}`);
  }
  await context.close();

  if (process.env.E2E_ACCOUNTANT_EMAIL && process.env.E2E_DISPATCHER_EMAIL) {
    await tripAndAdvanceFlow(browser);
  } else {
    console.log("SKIP  trip and advance flow (set E2E_ACCOUNTANT_* and E2E_DISPATCHER_*)");
  }

  await browser.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
  console.log(`Screenshots and PDF: ${OUT}`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
