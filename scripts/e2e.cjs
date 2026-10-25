// End-to-end check against a running app (pnpm build && pnpm start).
//   E2E_MANAGER_EMAIL=... E2E_MANAGER_PASSWORD=... E2E_DRIVER_EMAIL=... E2E_DRIVER_PASSWORD=... pnpm e2e
// Optional: BASE_URL (default http://localhost:3000), E2E_OUT (default test-results/e2e).
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

  await browser.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
  console.log(`Screenshots and PDF: ${OUT}`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
