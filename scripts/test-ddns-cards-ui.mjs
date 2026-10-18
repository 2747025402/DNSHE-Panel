#!/usr/bin/env node
// DDNS cards-only regression; uses the fixed local build and synthetic GET fixtures.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = new URL(process.env.BASE || "http://127.0.0.1:3028");
assert(["127.0.0.1", "localhost"].includes(base.hostname));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
await context.addInitScript(() => { localStorage.setItem("DNSHE_BACKEND_URL", ""); localStorage.setItem("DNSHE_INTERFACE_STYLE", "cards"); sessionStorage.setItem("DNSHE_SESSION", "synthetic-ddns-cards"); });
const page = await context.newPage();
const bindings = Array.from({ length: 12 }, (_, index) => ({ id: `card-${index}`, account_id: 1, label: `工作节点 ${index}`, domain: `home-${index}.example.test`, record_type: "A", token: "********", created_at: "2026-10-17T01:00:00Z", last_ip: `203.0.113.${index + 1}`, last_status: index % 2 ? "nochg" : "good", last_at: "2026-10-17T02:00:00Z" }));
let currentBindings = [...bindings];
const requests = [];
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base.origin) return route.abort();
  if (!url.pathname.startsWith("/api/")) return route.continue();
  requests.push({ method: route.request().method(), path: url.pathname });
  const payload = {
    "/api/auth/status": { initialized: true, two_fa_enabled: false }, "/api/auth/account": { success: true, username: "synthetic" },
    "/api/accounts": { success: true, accounts: [{ id: 1, alias: "合成账号" }] }, "/api/domains": { success: true, domains: [] },
    "/api/overview": { success: true, domains: {}, accounts: {}, quota: {}, assist: null }, "/api/quota": { success: true, quotas: [] },
    "/api/assist/status": { success: true, accounts: [], history: [] }, "/api/keys": { success: true, groups: [], keys: [] },
    "/api/logs": { success: true, logs: [] }, "/api/expiry": { success: true, results: [] }, "/api/cf/quota": { success: true, accounts: [] },
    "/api/ddns": { success: true, bindings: currentBindings },
    "/api/dns/ns": { success: true, nameservers: [] },
  };
  if (url.pathname === "/api/ddns/card-0/update") return route.fulfill({ json: { success: true, message: "updated", ip: "203.0.113.1" } });
  if (url.pathname === "/api/ddns/card-0/script") return route.fulfill({ json: { success: true, domain: "home-0.example.test", script: "echo synthetic", filename: "test.sh" } });
  if (url.pathname === "/api/ddns/card-0") { currentBindings = currentBindings.filter(binding => binding.id !== "card-0"); return route.fulfill({ json: { success: true } }); }
  assert(payload[url.pathname], `fixture ${url.pathname}`);
  return route.fulfill({ json: payload[url.pathname] });
});
const report = { passed: false, checks: [], pageErrors: [] };
page.on("pageerror", error => report.pageErrors.push(error.message));
const check = async (name, fn) => { await fn(); report.checks.push(name); };
try {
  await page.goto(new URL("/#ddns", base).href, { waitUntil: "networkidle" });
  const main = page.locator('main[data-workspace="ddns"]'); await main.waitFor();
  await check("cards render and share global search", async () => { await main.locator('[data-ddns-view="cards"]').waitFor(); assert.equal(await main.locator(".ddns-binding-card").count(), 10); await page.getByPlaceholder("搜索绑定域名或账号").fill("home-2.example.test"); assert.equal(await main.locator(".ddns-binding-card").count(), 1); await page.getByPlaceholder("搜索绑定域名或账号").fill(""); });
  await check("card actions invoke update script and delete", async () => { const card = main.locator('[data-ddns-id="card-0"]'); await card.getByRole("button", { name: "立即更新", exact: true }).click(); await page.waitForTimeout(100); assert(requests.some(request => request.path === "/api/ddns/card-0/update" && request.method === "POST")); await card.getByRole("button", { name: "设备脚本", exact: true }).click(); await main.getByRole("dialog").waitFor(); await page.keyboard.press("Escape"); await main.getByRole("dialog").waitFor({ state: "hidden" }); page.once("dialog", dialog => dialog.accept()); await card.getByRole("button", { name: "删除", exact: true }).click(); await card.waitFor({ state: "hidden" }); assert(requests.some(request => request.path === "/api/ddns/card-0" && request.method === "DELETE")); });
  await check("cards stay within viewport at 390/768/1440/1920", async () => { for (const width of [390, 768, 1440, 1920]) { await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); assert((await main.locator(".ddns-binding-card").count()) >= 1); } });
  report.passed = report.checks.length === 3 && report.pageErrors.length === 0;
} finally { await browser.close(); console.log(JSON.stringify({ ...report, requests: requests.length })); if (!report.passed) process.exitCode = 1; }
