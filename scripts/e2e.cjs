// End-to-end check against a running app (pnpm build && pnpm start).
//   E2E_MANAGER_EMAIL=... E2E_MANAGER_PASSWORD=... E2E_DRIVER_EMAIL=... E2E_DRIVER_PASSWORD=... pnpm e2e
// With E2E_ACCOUNTANT_* and E2E_DISPATCHER_* as well, it also runs the trip ->
// driver expense -> approval -> advance -> settlement flow. That flow writes
// demo data (a trip, two expenses, an advance, a settlement), so run it against
// demo data only.
// Optional: BASE_URL (default http://localhost:3000), E2E_OUT (default test-results/e2e),
// E2E_TRUCK_CODE (truck to use when the driver has no current trip, default T-01).
// Uses the Playwright that is installed globally; `npx playwright` works too.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? path.join("test-results", "e2e");
const TABS = ["", "trips", "diesel", "maintenance", "documents", "expenses", "financials"];
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };

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
  const context = await browser.newContext({ viewport, locale: "ar-JO", timezoneId: "Asia/Amman" });
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
  await drv.page.setInputFiles("input[name=photo]", { name: "receipt.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await drv.page.screenshot({ path: path.join(OUT, "driver-expense-form.png"), fullPage: true });
  await Promise.all([
    drv.page.waitForURL(/\/my\?saved=1/, { timeout: 30000 }),
    drv.page.getByRole("button", { name: "إرسال للموافقة" }).click(),
  ]);
  const sent = drv.page.locator("li", { hasText: `${stamp} receipt` });
  check((await sent.innerText()).includes("بانتظار الموافقة"), "driver's expense waits for approval");
  check((await sent.locator("[aria-label='مرفق إيصال']").count()) === 1, "receipt photo is attached");
  await drv.page.click('a[href^="/my/expense/new"]');
  await drv.page.waitForURL(/\/my\/expense\/new/);
  await drv.page.selectOption("#category_id", { label: "إعاشة" });
  await drv.page.fill("#amount", "4");
  await drv.page.fill("#description", `${stamp} reject`);
  await Promise.all([
    drv.page.waitForURL(/\/my\?saved=1/, { timeout: 30000 }),
    drv.page.getByRole("button", { name: "إرسال للموافقة" }).click(),
  ]);

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
  await acc.page.screenshot({ path: path.join(OUT, "approvals.png"), fullPage: true });
  await toApprove.getByRole("button", { name: "اعتماد" }).click();
  await toApprove.waitFor({ state: "detached", timeout: 20000 });
  const toReject = acc.page.locator("li[data-expense-id]", { hasText: `${stamp} reject` });
  await toReject.getByRole("button", { name: "رفض" }).click();
  await toReject.locator("input[name=reason]").fill("e2e: لا يوجد إيصال");
  await toReject.getByRole("button", { name: "تأكيد الرفض" }).click();
  await toReject.waitFor({ state: "detached", timeout: 20000 });
  check(true, "accountant approves one expense and rejects the other");

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

  for (const s of [drv, disp, acc]) await s.context.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

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
