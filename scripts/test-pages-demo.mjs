import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.env.PAGES_DEMO_BASE || "http://127.0.0.1:4174").replace(/\/$/, "");
const routes = ["dashboard", "domains", "cloudflare", "assist", "accounts", "apikeys", "register", "quota", "ddns", "cfquota", "logs", "settings"];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const externalRequests = [];
page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
page.on("request", (request) => {
  const url = request.url();
  if (!url.startsWith(base) && !url.startsWith("data:") && !url.startsWith("blob:")) externalRequests.push(url);
});

for (const route of routes) {
  await page.goto(`${base}/#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(180);
  assert.equal(await page.locator("[data-workspace]").count(), 1, `${route} did not render a workspace`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${route} overflows horizontally`);
}

assert.deepEqual(errors, [], `Pages demo emitted runtime errors: ${errors.join(" | ")}`);
assert.deepEqual(externalRequests, [], `Pages demo attempted external requests: ${externalRequests.join(" | ")}`);
await browser.close();
console.log(`Pages real frontend ${routes.length}/${routes.length} routes, no external requests, no page/console errors`);
