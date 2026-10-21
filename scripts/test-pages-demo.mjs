import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = (process.env.PAGES_DEMO_BASE || "http://127.0.0.1:4174").replace(/\/$/, "");
const routes = ["dashboard", "domains", "cloudflare", "assist", "accounts", "apikeys", "register", "quota", "ddns", "renewal", "cfquota", "logs", "settings"];

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

await page.goto(`${base}/#renewal`, { waitUntil: "networkidle" });
const shotDir = process.env.PAGES_SHOT_DIR;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
for (const mode of ["design", "data", "cards"]) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("group", { name: "界面画风", exact: true })
    .getByRole("button", { name: `${{ design: "设计", data: "数据", cards: "卡片" }[mode]}风`, exact: true }).click();
  await page.locator(`[data-renewal-mode="${mode}"]`).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `renewal ${mode} ${width} overflows horizontally`);
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `renewal-${mode}-${width}.png`), fullPage: true, animations: "disabled" });
  }
}

assert.deepEqual(errors, [], `Pages demo emitted runtime errors: ${errors.join(" | ")}`);
assert.deepEqual(externalRequests, [], `Pages demo attempted external requests: ${externalRequests.join(" | ")}`);
await browser.close();
console.log(`Pages real frontend ${routes.length}/${routes.length} routes; renewal 3 modes × 2 widths; no external requests, no page/console errors`);
