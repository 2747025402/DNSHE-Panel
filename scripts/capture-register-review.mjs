// Current full App review, local synthetic fixtures only; never opens a headed window.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = new URL(process.env.BASE || "http://127.0.0.1:3012");
assert(["127.0.0.1", "localhost"].includes(base.hostname));
const evidence = path.resolve(repo, "../shots/takeover-current", "register-current-review-" + new Date().toISOString().replaceAll(":", "-"));
await fs.mkdir(evidence, { recursive: true });
const owned = ["frontend/src/App.tsx", "frontend/src/RuleDomainWorkbench.tsx", "frontend/src/DomainCheckResults.tsx", "frontend/src/DomainCheckCacheModel.ts", "frontend/src/register-rule-tools.css", "frontend/src/RegisterHistoryPanel.tsx", "frontend/src/FlowWorkspaces.tsx"];
const hash = async () => Object.fromEntries(await Promise.all(owned.map(async name => [name, crypto.createHash("sha256").update(await fs.readFile(path.join(repo, name))).digest("hex")])));
const before = await hash();
const browser = await chromium.launch({ headless: true });
const report = { screenshots: [], pageErrors: [], requests: [], sourceHashes: before, passed: false, evidence };
const checkedAt = new Date().toISOString();
const records = [
  { domain: "a1.us.ci", subdomain: "a1", rootdomain: "us.ci", checkedAt, outcome: "available", registered: false, upstreamStatus: "available", message: "" },
  { domain: "ai.us.ci", subdomain: "ai", rootdomain: "us.ci", checkedAt, outcome: "reserved", registered: false, upstreamStatus: "reserved", message: "上游明确返回保留状态" },
  { domain: "z8.us.ci", subdomain: "z8", rootdomain: "us.ci", checkedAt, outcome: "error", registered: null, upstreamStatus: "", message: "合成网络故障；未作注册政策判断", lastConfirmed: { outcome: "available", checkedAt, upstreamStatus: "available" } },
];
const logRows = ["success", "error", "warning", "info"].map((type, index) => ({ id: 4 - index, type, category: ["sync", "api", "renew", "system"][index], message: ["域名状态同步完成", "上游请求暂不可用，已保留缓存", "待续期域名需要关注", "手动读取当前日志"][index], details: "合成数据，不涉及真实账号", created_at: new Date(Date.now() - index * 60000).toISOString() }));
try {
  for (const width of [1440, 390]) {
    const theme = width === 1440 ? "light" : "dark";
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.addInitScript(({ records, checkedAt, theme }) => {
      localStorage.setItem("DNSHE_BACKEND_URL", "");
      localStorage.setItem("DNSHE_THEME", theme);
      localStorage.setItem("DNSHE_INTERFACE_STYLE", "data");
      localStorage.setItem("DNSHE_STYLE_SCHEMA", "3");
      localStorage.setItem("DNSHE_DOMAIN_CHECK_CACHE_V1", JSON.stringify({ version: 1, records }));
      localStorage.setItem("DNSHE_REGISTER_HISTORY", JSON.stringify([{ id: "synthetic-single", kind: "single", domain: "a1.us.ci", subdomain: "a1", rootdomain: "us.ci", checkedAt, registered: false, status: "可注册" }]));
      sessionStorage.setItem("DNSHE_SESSION", "synthetic-review-only");
    }, { records, checkedAt, theme });
    const page = await context.newPage();
    page.setDefaultTimeout(9000);
    page.on("pageerror", error => report.pageErrors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      report.requests.push({ method: route.request().method(), path: url.pathname });
      const fixtures = {
        "/api/auth/status": { initialized: true, two_fa_enabled: false },
        "/api/auth/account": { success: true, username: "合成审查账号", two_fa_enabled: false },
        "/api/accounts": { success: true, accounts: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, alias: `合成查重账号 ${index + 1} · review-${index + 1}@example.test`, provider: "dnshe", api_key: "synthetic" })) },
        "/api/domains": { success: true, domains: [], last_sync: { at: null, type: "empty" } },
        "/api/overview": { success: true, domains: { total: 0, active: 0, expired: 0, expiring_soon: 0, delegated: 0, not_delegated: 0 }, accounts: { total: 1, dnshe: 1, cloudflare: 0 }, quota: { total: 0, used: 0, available: 0, failed: 0, accounts: [] }, assist: null },
        "/api/logs": { success: true, logs: logRows }, "/api/quota": { success: true, quotas: [] },
        "/api/assist/status": { success: true, accounts: [], history: [] },
        "/api/keys": { success: true, groups: [], keys: [] }, "/api/ddns": { success: true, bindings: [] },
        "/api/expiry": { success: true, results: [] }, "/api/cf/quota": { success: true, accounts: [], limits: null },
        "/api/dns/ns": { success: true, nameservers: [] },
      };
      assert(fixtures[url.pathname], "No fixture for " + url.pathname);
      return route.fulfill({ json: fixtures[url.pathname] });
    });
    const shot = async (name, target) => {
      await page.locator(".fixed.bottom-5.right-5").waitFor({ state: "hidden" });
      assert.equal(await page.locator("html").getAttribute("data-interface-style"), "data");
      assert.equal(await page.locator("html").evaluate(element => element.classList.contains("dark")), theme === "dark");
      assert.equal(await page.locator("main").getAttribute("data-workspace"), target);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const dimensions = page.viewportSize();
      await page.screenshot({ path: path.join(evidence, name + ".png"), animations: "disabled" });
      report.screenshots.push({ name, theme, style: "data", target, ...dimensions, toast: false });
    };
    await page.goto(new URL("/#register", base).href, { waitUntil: "networkidle" });
    const main = page.locator('main[data-workspace="register"]');
    await main.getByRole("region", { name: "查询历史", exact: true }).getByRole("button", { name: /a1.us.ci/ }).click();
    await main.getByRole("button", { name: "一键注册该域名", exact: true }).waitFor();
    await main.evaluate(element => { element.scrollTop = 0; });
    await shot(`register-single-${theme}-${width}`, "register");
    await main.getByRole("button", { name: /规则多域名查重/ }).click();
    assert.equal(await main.locator(".flow-advanced").count(), 0);
    await main.getByRole("region", { name: "规则与过滤", exact: true }).waitFor();
    const controls = main.getByRole("region", { name: "字符组合规则", exact: true });
    await controls.getByRole("checkbox", { name: /按字符组合顺序查询/ }).check();
    await controls.getByLabel("组合字符集", { exact: true }).selectOption("字母数字");
    await controls.getByLabel("组合长度", { exact: true }).fill("2");
    await main.getByRole("checkbox", { name: ".us.ci", exact: true }).check();
    const scope = main.getByRole("button", { name: "查重账号范围", exact: true });
    assert.equal(await scope.getAttribute("aria-expanded"), "false");
    await main.evaluate(element => { element.scrollTop = 0; });
    await shot(`register-rule-${theme}-${width}`, "register");
    await scope.click();
    const accounts = main.getByRole("group", { name: "可用查重账号", exact: true });
    assert.equal(await accounts.getByRole("checkbox").count(), 7);
    assert.equal(await accounts.locator('input:checked').count(), 7);
    await shot(`register-accounts-${theme}-${width}`, "register");
    await accounts.getByRole("checkbox", { name: "全部账号轮转", exact: true }).focus();
    await page.keyboard.press("Escape");
    assert.equal(await scope.evaluate(element => element === document.activeElement), true);
    const maintenance = main.locator(".register-maintenance-grid");
    await maintenance.scrollIntoViewIfNeeded();
    assert.equal(await maintenance.locator("summary").count(), 0);
    await shot(`register-options-${theme}-${width}`, "register");
    const results = main.getByRole("region", { name: "已查询结果", exact: true });
    await results.scrollIntoViewIfNeeded();
    await results.getByRole("button", { name: /ai.us.ci，官方保留/ }).waitFor();
    await shot(`register-cache-${theme}-${width}`, "register");
    await page.goto(new URL("/#logs", base).href, { waitUntil: "networkidle" });
    await page.locator(".log-result").first().waitFor();
    assert.deepEqual(await page.locator(".log-result").allTextContents(), ["success", "error", "warning", "info"]);
    await shot(`logs-english-${theme}-${width}`, "logs");
    await context.close();
  }
  assert.equal(report.requests.some(request => request.path === "/api/whois"), false);
  assert.deepEqual(await hash(), before, "Source changed while capturing");
  assert.equal(report.pageErrors.length, 0);
  report.passed = true;
} finally {
  await browser.close();
  await fs.writeFile(path.join(evidence, "audit.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, screenshots: report.screenshots.length, pageErrors: report.pageErrors, evidence }));
}
