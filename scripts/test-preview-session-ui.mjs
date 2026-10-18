/** 候选403回归：合成登录/凭据，headless且仅允许本机夹具，不访问真人数据。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = new URL(process.env.BASE || "http://127.0.0.1:3012");
assert(["localhost", "127.0.0.1"].includes(base.hostname));
const evidence = path.resolve(repo, "../shots/takeover-current", "preview-session-" + new Date().toISOString().replaceAll(":", "-"));
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { passed: false, cases: [], pageErrors: [], requests: [], evidence };
const token = "synthetic-preview-session-only";

async function runCase(name, { knownReadOnly = false, authFailure = 0, seedSession = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
  let backfills = 0;
  let keyReads = 0;
  let loggedIn = seedSession;
  await context.addInitScript(({ seedSession, token }) => {
    localStorage.setItem("DNSHE_BACKEND_URL", "/");
    localStorage.setItem("DNSHE_INTERFACE_STYLE", "design");
    localStorage.setItem("DNSHE_THEME", "light");
    if (seedSession) sessionStorage.setItem("DNSHE_SESSION", token);
  }, { seedSession, token });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== base.origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    report.requests.push({ case: name, method: req.method(), path: url.pathname });
    if (url.pathname === "/api/auth/status") return route.fulfill({ json: { success: true, initialized: true, two_fa_enabled: false } });
    if (url.pathname === "/api/auth/login") {
      const input = req.postDataJSON();
      assert.equal(input.username, "synthetic-admin");
      assert.equal(input.password, "synthetic-password-not-real");
      loggedIn = true;
      return route.fulfill({ json: { success: true, session_token: token } });
    }
    assert(loggedIn, "登录前不应读取受保护数据");
    // 已在飞的读取遇认证退出后，后续快照回退请求也必须由鉴权阻断。
    if (!req.headers().authorization) return route.fulfill({ status: 401, json: { success: false, error_code: "unauthorized" } });
    assert.equal(req.headers().authorization, "Bearer " + token);
    if (url.pathname === "/api/keys/backfill") {
      backfills++;
      return route.fulfill({ status: 403, json: { success: false, error_code: "preview_read_only", message: "候选实例为只读预览，业务写入已阻断" } });
    }
    if (url.pathname === "/api/keys/reveal") return route.fulfill({ json: { success: true, api_secret: "synthetic-revealed-secret" } });
    if (req.method() !== "GET") throw new Error("夹具不应触发其他写操作：" + url.pathname);
    let body = { success: true };
    if (url.pathname === "/api/keys") {
      keyReads++;
      if (authFailure) return route.fulfill({ status: authFailure, json: { success: false, error_code: "unauthorized", message: "合成认证已过期" } });
      const key = { key_id: 9, key_name: "Preview Key", api_key: "synthetic-key", status: "active", request_count: 12, has_secret: true };
      const metadata = knownReadOnly ? { preview_read_only: true } : {};
      body = url.searchParams.get("account_id") === "1" ? { success: true, ...metadata, keys: [key] } : { success: true, ...metadata, groups: [{ account_id: 1, alias: "合成账号", keys: [key] }], keys: [] };
    } else if (url.pathname === "/api/accounts") body = { success: true, accounts: [{ id: 1, alias: "合成账号", provider: "dnshe", api_key: "synthetic-key" }] };
    else if (url.pathname === "/api/domains") body = { success: true, domains: [] };
    else if (url.pathname === "/api/cf/zones") body = { success: true, zones: [] };
    else if (url.pathname === "/api/overview") body = { success: true, domains: { total: 0, active: 0, expired: 0, expiring_soon: 0, delegated: 0, not_delegated: 0 }, accounts: { total: 1, dnshe: 1, cloudflare: 0 }, quota: { total: 0, used: 0, available: 0, failed: 0, accounts: [] }, assist: null };
    else if (url.pathname === "/api/auth/account") body = { success: true, username: "synthetic-admin", two_fa_enabled: false };
    else if (url.pathname === "/api/cf/quota") body = { success: true, accounts: [], limits: null };
    else if (url.pathname === "/api/logs") body = { success: true, logs: [] };
    else if (url.pathname === "/api/assist/status") body = { success: true, accounts: [], history: [] };
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  try {
    await page.goto(new URL("/#apikeys", base).href, { waitUntil: "networkidle" });
    if (!seedSession) {
      await page.getByPlaceholder("管理员用户名").fill("synthetic-admin");
      await page.getByPlaceholder("登录密码", { exact: true }).fill("synthetic-password-not-real");
      await page.locator('form button[type="submit"]').click();
    }
    if (authFailure) {
      await page.waitForFunction(() => !sessionStorage.getItem("DNSHE_SESSION"));
      await page.getByPlaceholder("登录密码", { exact: true }).waitFor();
      assert(keyReads > 0);
    } else {
      await page.getByRole("button", { name: "查看 Preview Key", exact: true }).waitFor();
      if (!knownReadOnly) await page.waitForFunction(() => document.querySelector("main[data-workspace='apikeys']") !== null);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => sessionStorage.getItem("DNSHE_SESSION")), token);
      assert.equal(backfills, knownReadOnly ? 0 : 1);
      assert(keyReads > 0);
      await page.getByRole("button", { name: "查看 Preview Key", exact: true }).click();
      await page.getByRole("button", { name: "显示 API Secret" }).click();
      await page.getByText("synthetic-revealed-secret", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => sessionStorage.getItem("DNSHE_SESSION")), token);
      await page.screenshot({ path: path.join(evidence, name + ".png"), animations: "disabled" });
    }
    report.cases.push({ name, passed: true, backfills, keyReads });
    console.log("PASS " + name);
  } catch (error) {
    report.cases.push({ name, passed: false, reason: error.message, backfills, keyReads });
    throw error;
  } finally { await context.close(); }
}
try {
  await runCase("preview-403-keeps-session");
  await runCase("known-readonly-skips-backfill", { knownReadOnly: true });
  await runCase("auth-401-clears-session", { authFailure: 401 });
  await runCase("auth-403-clears-session", { authFailure: 403 });
  await runCase("persisted-session-main-entry", { knownReadOnly: true, seedSession: true });
  report.passed = report.cases.length === 5 && report.cases.every((entry) => entry.passed) && !report.pageErrors.length;
} finally {
  await fs.writeFile(path.join(evidence, "audit.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, pageErrors: report.pageErrors, evidence }));
  if (!report.passed) process.exitCode = 1;
}
