#!/usr/bin/env node
/* 运行日志刷新回归：失败反馈、手动刷新成功、重复提交保护。仅本地合成接口。 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = new URL(process.env.BASE || "http://127.0.0.1:3012");
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
let logReads = 0;
let allowSuccess = false;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
await context.addInitScript(() => {
  localStorage.setItem("DNSHE_BACKEND_URL", "/");
  localStorage.setItem("DNSHE_INTERFACE_STYLE", "data");
  localStorage.setItem("DNSHE_THEME", "light");
  sessionStorage.setItem("DNSHE_SESSION", "synthetic-logs-session");
});
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== base.origin) return route.abort();
  if (!url.pathname.startsWith("/api/")) return route.continue();
  if (request.method() !== "GET") return route.fulfill({ status: 405, json: { success: false, message: "offline" } });
  if (url.pathname === "/api/logs") {
    logReads += 1;
    if (!allowSuccess) return route.fulfill({ status: 503, json: { success: false, message: "日志源暂时不可用" } });
    await new Promise((resolve) => setTimeout(resolve, 180));
    return route.fulfill({ json: { success: true, logs: [{ id: 1, category: "system", level: "info", message: "刷新成功", created_at: "2026-10-17T12:00:00.000Z" }] } });
  }
  const empty = { success: true };
  if (url.pathname === "/api/auth/status") return route.fulfill({ json: { ...empty, initialized: true, two_fa_enabled: false } });
  if (url.pathname === "/api/auth/account") return route.fulfill({ json: { ...empty, username: "synthetic" } });
  if (url.pathname === "/api/accounts") return route.fulfill({ json: { ...empty, accounts: [] } });
  if (url.pathname === "/api/overview") return route.fulfill({ json: { ...empty, domains: { total: 0, active: 0, expired: 0, expiring_soon: 0, delegated: 0, not_delegated: 0 }, accounts: { total: 0, dnshe: 0, cloudflare: 0 }, quota: { total: 0, used: 0, available: 0, failed: 0, accounts: [] }, assist: null } });
  if (url.pathname === "/api/settings") return route.fulfill({ json: { ...empty, settings: {}, configured: {} } });
  return route.fulfill({ json: empty });
});
const page = await context.newPage();
page.setDefaultTimeout(7000);
await page.goto(new URL("/#logs", base).href, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: /运行日志/ }).waitFor();
assert(logReads >= 1);
assert((await page.getByRole("alert").innerText()).includes("日志源暂时不可用"));
allowSuccess = true;
const refresh = page.getByRole("button", { name: "刷新运行日志", exact: true });
const request = page.waitForRequest((req) => new URL(req.url()).pathname === "/api/logs");
await refresh.click();
assert.equal(await refresh.isDisabled(), true);
await request;
await page.waitForFunction(() => !document.querySelector('button[aria-label="刷新运行日志"]')?.disabled);
assert(logReads >= 2);
assert((await page.getByRole("status").innerText()).includes("最近读取"));
assert((await page.getByText("刷新成功", { exact: true }).count()) > 0);
await browser.close();
console.log("日志刷新回归通过：失败反馈、手动刷新、重复提交保护、更新时间均正常");
