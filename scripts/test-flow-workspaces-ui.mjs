#!/usr/bin/env node
/**
 * 注册查重 / DDNS 定向回归。
 * 仅使用本地 Vite 与 Playwright headless，所有 API 都在页面请求层拦截，
 * 不登录远端、不写业务数据、不占用前台键鼠。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.FLOW_WORKSPACES_PORT || 3021);
const base = new URL(process.env.BASE || `http://127.0.0.1:${port}`);
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));

let devServer = null;
if (!process.env.BASE) {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm --prefix frontend run dev -- --mode selfhost --host 127.0.0.1 --port ${port}`]
    : ["--prefix", "frontend", "run", "dev", "--", "--mode", "selfhost", "--host", "127.0.0.1", "--port", String(port)];
  devServer = spawn(command, args, {
    cwd: repo,
    stdio: "ignore",
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const res = await fetch(base);
      if (res.ok) break;
    } catch { /* Vite 尚未启动 */ }
    await delay(250);
  }
}

const { chromium } = await import(process.env.REVIEW_PLAYWRIGHT
  ? pathToFileURL(process.env.REVIEW_PLAYWRIGHT).href
  : "playwright");
const browser = await chromium.launch({ headless: true });
const evidence = path.resolve(repo, "../shots/takeover-current", "flow-workspaces-" + new Date().toISOString().replaceAll(":", "-"));
await fs.mkdir(evidence, { recursive: true });
const report = { passed: false, tests: [], requests: [], pageErrors: [], screenshots: [], evidence };
const accounts = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, alias: "合成账号-" + String(index + 1).padStart(3, "0"), provider: "dnshe", api_key: "synthetic" }));
const assistAccounts = accounts.map((account, index) => ({
  account_id: account.id, name: account.alias,
  ...(index === 98 ? {} : { helper_assist_remaining: index % 2 ? 0 : 4, helper_assist_limit: 6 }),
  ...(index === 99 ? { error: "合成读取失败" } : {}),
  domains: index < 2 ? Array.from({ length: 250 }, (_, offset) => ({ id: index * 250 + offset + 1, domain: "sample-" + index + "-" + String(offset).padStart(3, "0") + ".example.test", status: "normal", expires_at: "2026-12-01", assist_code: offset % 2 ? "TEST" + offset : undefined })) : [],
}));
const bindings = Array.from({ length: 40 }, (_, index) => ({ id: "binding-" + index, account_id: index + 1, label: "合成家庭网络-" + index, domain: "home-" + index + ".example.test", record_type: "A", token: "********", created_at: "2026-10-17T01:00:00Z", last_ip: "203.0.113." + (index + 1), last_status: index % 2 ? "nochg" : "good", last_at: "2026-10-17T02:00:00Z" }));
const makeLog = (id) => ({ id, type: id % 5 === 0 ? "success" : id % 3 ? "info" : "error", category: "sync", message: "合成日志事件-" + id, details: "合成详情-" + id + "\\n" + "detail".repeat(30), created_at: new Date(Date.UTC(2026, 9, 17, 0, 0, id)).toISOString() });
let logRows = Array.from({ length: 70 }, (_, index) => makeLog(70 - index));
let logsFail = false;
let logsDelay = 0;
let whoisMode = "success";
let whoisCalls = [];
let inFlight = 0, peakInFlight = 0;
let firstRateLimit = true;
const snapshot = async (name) => {
  await page.screenshot({ path: path.join(evidence, name + ".png"), fullPage: false, animations: "disabled" });
  report.screenshots.push({ name, width: page.viewportSize().width, height: page.viewportSize().height });
};
const assertGeometry = async () => {
  const geometry = await page.locator("main").evaluate((main) => ({ client: main.clientWidth, scroll: main.scrollWidth }));
  assert(geometry.scroll <= geometry.client + 2, JSON.stringify(geometry));
};
const assertLogTable = async (style) => {
  const table = page.locator(`.log-scan[data-log-view="${style}"]`);
  await table.waitFor();
  assert.equal(await page.locator(".log-journal").count(), 0);
  assert.deepEqual(await table.locator(".log-scan__head > span").allTextContents(), ["时间", "结果", "模块", "事件", "详情"]);
  const geometry = await table.evaluate((surface) => {
    const head = surface.querySelector(".log-scan__head");
    const row = surface.querySelector("article");
    const position = (node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, center: (rect.left + rect.right) / 2 }; };
    return {
      tableWidth: surface.getBoundingClientRect().width,
      workspaceWidth: surface.closest(".logs-workspace").getBoundingClientRect().width,
      headTracks: getComputedStyle(head).gridTemplateColumns,
      rowTracks: getComputedStyle(row).gridTemplateColumns,
      rowHeight: row.getBoundingClientRect().height,
      head: [...head.children].map(position), row: [...row.children].map(position),
    };
  });
  assert(Math.abs(geometry.tableWidth - geometry.workspaceWidth) < 2);
  assert.equal(geometry.headTracks, geometry.rowTracks);
  assert(geometry.rowHeight <= 64, "紧凑日志行过高: " + geometry.rowHeight);
  for (const [index, edge] of [[0, "left"], [1, "center"], [2, "center"], [3, "left"], [4, "right"]]) {
    assert(Math.abs(geometry.head[index][edge] - geometry.row[index][edge]) < 2, `日志列 ${index} 未对齐`);
  }
};

const check = async (name, action) => {
  try {
    await action();
    report.tests.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.tests.push({ name, passed: false, reason: error?.message || String(error) });
    console.log(`FAIL ${name}: ${error?.message || error}`);
    throw error;
  }
};

const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: "block",
  reducedMotion: "reduce",
});
await context.addInitScript(() => {
  localStorage.setItem("DNSHE_BACKEND_URL", "");
  localStorage.removeItem("DNSHE_REGISTER_HISTORY");
  sessionStorage.setItem("DNSHE_SESSION", "synthetic-register-ddns");
  window.__assistCopied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.__assistCopied.push(value); } } });
});
const page = await context.newPage();
page.setDefaultTimeout(9000);
page.on("pageerror", (error) => report.pageErrors.push(error.message));

await page.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== base.origin) return route.abort();
  if (!url.pathname.startsWith("/api/")) return route.continue();
  report.requests.push({ method: request.method(), path: url.pathname });
  if (url.pathname === "/api/auth/status") return route.fulfill({ json: { initialized: true, two_fa_enabled: false } });
  if (url.pathname === "/api/auth/account") return route.fulfill({ json: { success: true, username: "合成管理员", two_fa_enabled: false } });
  if (url.pathname === "/api/accounts") return route.fulfill({ json: { success: true, accounts } });
  if (url.pathname === "/api/domains") return route.fulfill({ json: { success: true, domains: [], last_sync: { at: null, type: "empty" } } });
  if (url.pathname === "/api/overview") return route.fulfill({ json: { success: true, domains: { total: 0, active: 0, expired: 0, expiring_soon: 0, delegated: 0, not_delegated: 0 }, accounts: { total: 1, dnshe: 1, cloudflare: 0 }, quota: { total: 0, used: 0, available: 0, failed: 0, accounts: [] }, assist: null } });
  if (url.pathname === "/api/quota") return route.fulfill({ json: { success: true, quotas: [] } });
  if (["/api/assist/status", "/api/assist/sync"].includes(url.pathname)) return route.fulfill({ json: { success: true, accounts: assistAccounts, history: [] } });
  if (url.pathname === "/api/assist/create") {
    const body = request.postDataJSON();
    assert.equal(body.account_id, 1);
    assert.equal(body.subdomain_id, 1);
    assistAccounts[0].domains[0].assist_code = "SYNTHETIC001";
    return route.fulfill({ json: { success: true, assist_code: "SYNTHETIC001" } });
  }
  if (url.pathname === "/api/keys") return route.fulfill({ json: { success: true, groups: [], keys: [] } });
  if (url.pathname === "/api/logs") {
    if (logsDelay) await delay(logsDelay);
    return route.fulfill({ status: logsFail ? 503 : 200, json: logsFail ? { success: false, message: "合成日志源暂不可用，保留旧列表" } : { success: true, logs: logRows } });
  }
  if (url.pathname === "/api/ddns") return route.fulfill({ json: { success: true, bindings } });
  if (url.pathname === "/api/ddns/binding-0/update") {
    assert.equal(request.method(), "POST");
    return route.fulfill({ json: { success: true, message: "合成更新完成", ip: "203.0.113.1" } });
  }
  if (url.pathname === "/api/ddns/binding-0/script") return route.fulfill({ json: { success: true, domain: "home-0.example.test", script: "# Synthetic DDNS script\necho test-only", filename: "synthetic-ddns.sh" } });
  if (url.pathname === "/api/ddns/binding-0") {
    assert.equal(request.method(), "DELETE");
    bindings.splice(bindings.findIndex(binding => binding.id === "binding-0"), 1);
    return route.fulfill({ json: { success: true } });
  }
  if (url.pathname === "/api/expiry") return route.fulfill({ json: { success: true, results: [] } });
  if (url.pathname === "/api/cf/quota") return route.fulfill({ json: { success: true, accounts: [], limits: null } });
  if (url.pathname === "/api/whois/pool") return route.fulfill({ json: { success: true, registered: [] } });
  if (url.pathname === "/api/whois") {
    const entry = { domain: url.searchParams.get("domain"), account: url.searchParams.get("account_id"), started: Date.now() };
    whoisCalls.push(entry); inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
    await delay(200);
    inFlight--;
    if (whoisMode === "rate" && firstRateLimit) {
      firstRateLimit = false;
      return route.fulfill({ status: 429, json: { success: false, error_code: "rate_limited" } });
    }
    return route.fulfill({ json: { success: true, whois: { registered: false, status: "available" } } });
  }
  return route.fulfill({ json: { success: true } });
});


const goto = async (tab) => {
  await page.goto(new URL("/#" + tab, base).href, { waitUntil: "networkidle" });
  await page.locator('main[data-workspace="' + tab + '"]').waitFor();
};
const mode = async (style) => {
  await page.evaluate((value) => localStorage.setItem("DNSHE_INTERFACE_STYLE", value), style);
  await page.reload({ waitUntil: "networkidle" });
};
try {
  await goto("assist");
  const assist = page.locator(".assist-directory");
  await check("100账号与500域名不默认铺开", async () => {
    await assist.waitFor();
    assert.equal(await assist.locator(".assist-domain-group").count(), 10);
    assert.equal(await assist.locator(".assist-domain-row").count(), 0);
    assert.equal(await assist.locator(".assist-queue-editorial__row").count(), 4);
    await assertGeometry();
    await snapshot("assist-design-1440");
  });
  await check("域名按账号渐进展开与搜索", async () => {
    await assist.locator(".assist-domain-group__head").first().click();
    assert.equal(await assist.locator(".assist-domain-row").count(), 20);
    await assist.getByRole("button", { name: /再显示 20 个/ }).click();
    assert.equal(await assist.locator(".assist-domain-row").count(), 40);
    await page.locator('header input[type=search]').fill("sample-0-220");
    assert.equal(await assist.locator(".assist-domain-row").count(), 1);
    await page.locator('header input[type=search]').fill("");
  });
  await check("可参与过滤与未知余额语义", async () => {
    // 过滤工具只属于数据风；设计风不再占用首行重复展示“只看可参与”。
    await mode("data");
    await assist.getByRole("checkbox", { name: "只看可参与" }).check();
    assert.match(await assist.locator(".flow-count").textContent(), /49 \/ 100/);
    await assist.getByRole("checkbox", { name: "只看可参与" }).uncheck();
    await mode("data");
    await page.locator(".assist-quota-grid").first().waitFor();
    await page.getByRole("button", { name: "收起账号额度", exact: true }).click();
    assert.equal(await page.locator(".assist-quota-grid").count(), 0);
    await page.getByRole("button", { name: "展开账号额度", exact: true }).click();
    await page.locator('header input[type=search]').fill("合成账号-099");
    assert.match(await page.locator(".assist-quota-panel").textContent(), /未读取/);
    await page.locator('header input[type=search]').fill("合成账号-100");
    assert.match(await page.locator(".assist-quota-panel").textContent(), /读取失败/);
    await snapshot("assist-data-1440");
  });
  await check("助力数据风卡片与表格切换保留搜索折叠且刷新恢复", async () => {
    await page.locator('header input[type=search]').fill("合成账号-001");
    const head = page.locator(".assist-domain-group__head").first();
    if (await head.getAttribute("aria-expanded") !== "true") await head.click();
    const toggle = page.getByRole("group", { name: "界面画风", exact: true });
    await toggle.getByRole("button", { name: "卡片风", exact: true }).click();
    assert.equal(await page.locator(".assist-directory").getAttribute("data-view"), "cards");
    assert.equal(await page.locator(".assist-account-card").count(), 1);
    assert.equal(await page.locator(".assist-domain-card").count(), 20);
    assert.equal(await page.locator('header input[type=search]').inputValue(), "合成账号-001");
    assert.equal(await page.locator(".assist-domain-group__head").first().getAttribute("aria-expanded"), "true");
    await assertGeometry();
    await page.locator(".assist-domain-card").first().getByRole("button", { name: "生成助力码", exact: true }).click();
    const copy = page.locator(".assist-domain-card").first().getByRole("button", { name: "复制 SYNTHETIC001", exact: true });
    await copy.waitFor();
    await copy.click();
    assert.deepEqual(await page.evaluate(() => window.__assistCopied), ["SYNTHETIC001"]);
    await page.locator(".assist-domain-card").first().scrollIntoViewIfNeeded();
    await snapshot("assist-data-cards-domain-1440");
    await toggle.getByRole("button", { name: "数据风", exact: true }).click();
    assert.equal(await page.locator(".assist-domain-card").count(), 0);
    assert.equal(await page.locator(".assist-domain-row").count(), 20);
    await toggle.getByRole("button", { name: "卡片风", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".assist-directory").getAttribute("data-view"), "cards");
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertGeometry();
      await snapshot(`assist-data-cards-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await goto("ddns");
  await check("40条真实DDNS绑定分页与三种独立结构", async () => {
    await mode("data");
    await page.locator('[data-ddns-view="data"]').waitFor();
    assert.equal(await page.locator(".ddns-scan__row:not(.ddns-scan__head)").count(), 10);
    await page.getByRole("navigation", { name: "DDNS 分页" }).getByRole("button", { name: "下一页" }).click();
    assert.match(await page.locator(".ddns-scan").textContent(), /home-10/);
    await mode("design");
    assert.equal(await page.locator(".ddns-roster__item").count(), 10);
    await page.locator(".ddns-roster__item").nth(2).click();
    assert.match(await page.locator(".ddns-inspector").textContent(), /home-2.example.test/);
    assert.equal(await page.locator(".ddns-inspector").getByRole("button").count(), 3);
    await snapshot("ddns-design-1440");
    await mode("cards");
    await page.locator('[data-ddns-view="cards"]').waitFor();
    assert.equal(await page.locator(".ddns-binding-card").count(), 10);
    assert.equal(await page.locator(".ddns-binding-card").first().getByRole("button").count(), 3);
    assert.equal(await page.locator(".ddns-scan,.ddns-editorial").count(), 0);
    await page.getByPlaceholder("搜索绑定域名或账号").fill("home-2.example.test");
    assert.equal(await page.locator(".ddns-binding-card").count(), 1);
    await page.getByPlaceholder("搜索绑定域名或账号").fill("");
    const firstCard = page.locator('[data-ddns-id="binding-0"]');
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/ddns"), firstCard.getByRole("button", { name: "立即更新", exact: true }).click()]);
    assert(report.requests.some(request => request.path === "/api/ddns/binding-0/update" && request.method === "POST"));
    await firstCard.getByRole("button", { name: "设备脚本", exact: true }).click();
    await page.getByRole("dialog").getByText(/Synthetic DDNS script/).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    page.once("dialog", dialog => dialog.accept());
    await firstCard.getByRole("button", { name: "删除", exact: true }).click();
    await firstCard.waitFor({ state: "hidden" });
    assert(report.requests.some(request => request.path === "/api/ddns/binding-0" && request.method === "DELETE"));
    await page.locator(".fixed.bottom-5.right-5").waitFor({ state: "hidden" });
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertGeometry();
      await snapshot(`ddns-cards-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mode("design");
  });
  await check("模拟可关闭且不与真实绑定混排", async () => {
    await page.getByRole("button", { name: "查看模拟预览" }).click();
    await page.getByText("模拟数据 · 不会写入 DNS", { exact: true }).waitFor();
    assert.equal(await page.locator(".ddns-actions").count(), 0);
    assert.equal(await page.locator(".ddns-roster__item").count(), 2);
    await page.getByRole("button", { name: "关闭模拟预览" }).click();
    assert.equal(await page.locator(".ddns-roster__item").count(), 10);
  });
  await goto("logs");
  await check("日志状态色只表达结果且成功保留绿色语义", async () => {
    const success = page.locator('[data-log-id="70"] .log-result');
    const info = page.locator('[data-log-id="68"] .log-result');
    assert.equal(await success.getAttribute("class"), "log-result is-success");
    assert.notEqual(await success.evaluate((node) => getComputedStyle(node).color), await info.evaluate((node) => getComputedStyle(node).color));
    const activeTab = page.getByRole("button", { name: "全部", exact: true });
    assert.notEqual(await activeTab.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
  });
  await check("刷新中保留旧日志且刷新获取新条目", async () => {
    await page.locator('[data-log-id="70"]').waitFor();
    logsDelay = 700;
    logRows = [makeLog(71), ...logRows];
    await page.getByRole("button", { name: "刷新运行日志" }).click();
    assert.equal(await page.getByRole("button", { name: "刷新运行日志", exact: true }).isDisabled(), true);
    assert.equal(await page.locator('[data-log-id="70"]').count(), 1);
    await page.locator('[data-log-id="71"]').waitFor();
    logsDelay = 0;
  });
  await check("读旧日志时新条目不抢位置", async () => {
    await page.locator("main").evaluate((main) => { main.scrollTop = 650; });
    const before = await page.locator("main").evaluate((main) => main.scrollTop);
    logRows = [makeLog(72), ...logRows];
    await page.getByRole("button", { name: "刷新运行日志" }).click();
    await page.getByRole("button", { name: /有 1 条新日志/ }).waitFor();
    assert.equal(await page.locator('[data-log-id="72"]').count(), 0);
    const after = await page.locator("main").evaluate((main) => main.scrollTop);
    assert(Math.abs(after - before) < 5, before + " -> " + after);
    await page.getByRole("button", { name: /有 1 条新日志/ }).click();
    await page.locator('[data-log-id="72"]').waitFor();
    assert((await page.locator("main").evaluate((main) => main.scrollTop)) < 5);
  });
  await check("刷新失败保旧列表与可展开详情", async () => {
    logsFail = true;
    await page.getByRole("button", { name: "刷新运行日志" }).click();
    await page.locator(".logs-workspace").getByRole("alert").waitFor();
    assert.equal(await page.locator('[data-log-id="72"]').count(), 1);
    await page.locator('[data-log-id="72"] summary').click();
    assert.match(await page.locator('[data-log-id="72"] pre').textContent(), /合成详情-72/);
    logsFail = false;
    await mode("design");
    assert.equal(await page.locator('[data-log-view="design"]').count(), 1);
    assert.equal(await page.locator('[data-log-id="72"]').count(), 1);
    await assertLogTable("design");
    await snapshot("logs-design-1440");
    await page.getByTitle("切换到亮色", { exact: true }).click();
    await snapshot("logs-design-light-1440");
    await page.getByTitle("切换到暗色", { exact: true }).click();
    await mode("data");
    assert.equal(await page.locator('[data-log-view="data"]').count(), 1);
    await assertLogTable("data");
    await snapshot("logs-data-1440");
  });
  await goto("register");
  const register = page.locator('main[data-workspace="register"]');
  const accountScope = register.getByRole("button", { name: "查重账号范围", exact: true });
  const accountOptions = register.getByRole("group", { name: "可用查重账号", exact: true });
  const setAccountScopeOpen = async (open) => {
    if ((await accountScope.getAttribute("aria-expanded") === "true") !== open) await accountScope.click();
    await accountOptions.waitFor({ state: open ? "visible" : "detached" });
  };
  await check("00到99为100个前缀且预览范围随后缀变化", async () => {
    await register.getByRole("button", { name: /规则多域名查重/ }).click();
    assert(await register.getByRole("region", { name: "规则与过滤", exact: true }).isVisible(), "高级规则直接常驻，不再依赖展开控件");
    assert.equal(await register.locator(".flow-advanced").count(), 0);
    const controls = register.getByRole("region", { name: "字符组合规则", exact: true });
    await controls.getByRole("checkbox", { name: "按字符组合顺序查询", exact: true }).check();
    await controls.getByLabel("组合字符集", { exact: true }).selectOption("数字");
    await controls.getByLabel("组合长度", { exact: true }).fill("2");
    await register.getByRole("checkbox", { name: ".us.ci", exact: true }).check();
    assert.equal(await register.locator(".batch-plan-summary").getAttribute("data-batch-preview"), "100");
    await register.getByRole("button", { name: /^全选 \(/ }).click();
    assert(Number(await register.locator(".batch-plan-summary").getAttribute("data-batch-preview")) > 100);
    await controls.getByRole("checkbox", { name: "按字符组合顺序查询", exact: true }).uncheck();
    await snapshot("register-data-1440");
  });
  await check("100账号全局并发上限4且同账号间隔大于1.2秒", async () => {
    assert.equal(await accountScope.getAttribute("aria-expanded"), "false", "账号选项默认收进范围列表");
    assert.equal(await accountOptions.count(), 0);
    await setAccountScopeOpen(true);
    assert(await accountOptions.getByRole("checkbox", { name: "全部账号轮转", exact: true }).isChecked(), "查重账号范围默认应全选");
    assert.equal(await accountOptions.getByRole("checkbox", { name: /^查重账号：/ }).count(), 100);
    assert.equal(await accountOptions.locator('input[aria-label^="查重账号："]:checked').count(), 100);
    await setAccountScopeOpen(false);
    await register.getByPlaceholder(/例如: \{字母\}/).fill("aa,ab,ac,ad,ae,af");
    for (const checkbox of await register.locator('input[type="checkbox"]').all()) {
      const label = await checkbox.evaluate((input) => input.closest("label")?.textContent || "");
      if (label.trim().startsWith(".")) await checkbox.uncheck();
    }
    await register.getByRole("checkbox", { name: ".us.ci", exact: true }).check();
    whoisCalls = []; peakInFlight = 0;
    await register.getByRole("button", { name: "开始查询", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("DNSHE_REGISTER_HISTORY") || "[]").some((entry) => entry.status === "批量完成"));
    assert.equal(whoisCalls.length, 6);
    assert(peakInFlight <= 4, "peak=" + peakInFlight);
    const byAccount = new Map();
    for (const call of whoisCalls) {
      if (byAccount.has(call.account)) assert(call.started - byAccount.get(call.account) >= 1175);
      byAccount.set(call.account, call.started);
    }
    await register.getByRole("button", { name: "重新开始", exact: true }).click();
    await register.getByPlaceholder(/例如: \{字母\}/).fill("ba,bb,bc");
    await setAccountScopeOpen(true);
    // 主动取消全部是真正空选；不得偷偷替使用者选择第一个账号。
    await accountOptions.getByRole("checkbox", { name: "全部账号轮转", exact: true }).uncheck();
    assert.equal(await accountOptions.locator('input[aria-label^="查重账号："]:checked').count(), 0);
    assert.equal(await register.getByRole("button", { name: "开始查询", exact: true }).isDisabled(), true);
    await register.getByText("请至少勾选一个查重账号", { exact: true }).waitFor();
    await accountOptions.getByRole("checkbox", { name: "查重账号：合成账号-001", exact: true }).check();
    assert.equal(await accountOptions.locator('input[aria-label^="查重账号："]:checked').count(), 1);
    await setAccountScopeOpen(false);
    assert.equal(await register.getByRole("button", { name: "开始查询", exact: true }).isDisabled(), false);
    whoisCalls = [];
    await register.getByRole("button", { name: "开始查询", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("DNSHE_REGISTER_HISTORY") || "[]").some((entry) => entry.status === "批量完成" && entry.config?.rule === "ba,bb,bc"));
    assert.equal(whoisCalls.length, 3);
    assert(whoisCalls.every(call => call.account === "1"), "单账号运行只能调用显式勾选的账号");
    for (let index = 1; index < whoisCalls.length; index++) assert(whoisCalls[index].started - whoisCalls[index - 1].started >= 1175);
  });
  await check("429暂停后同一候选可恢复且不漏查", async () => {
    await register.getByRole("button", { name: "重新开始", exact: true }).click();
    await register.getByPlaceholder(/例如: \{字母\}/).fill("zz");
    await setAccountScopeOpen(true);
    assert(await accountOptions.getByRole("checkbox", { name: "查重账号：合成账号-001", exact: true }).isChecked());
    await setAccountScopeOpen(false);
    whoisMode = "rate"; whoisCalls = []; firstRateLimit = true;
    await register.getByRole("button", { name: "开始查询", exact: true }).click();
    await register.getByRole("button", { name: "恢复查询", exact: true }).waitFor();
    await register.getByRole("button", { name: "恢复查询", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("DNSHE_REGISTER_HISTORY") || "[]").some((entry) => entry.status === "批量完成" && entry.config?.rule === "zz"));
    assert.equal(whoisCalls.length, 2);
    assert(whoisCalls[1].started - whoisCalls[0].started >= 1175);
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("DNSHE_REGISTER_HISTORY")));
    assert.equal(history[0].config.accountIds[0], 1);
    assert.deepEqual(history[0].config.roots, ["us.ci"]);
    const before = whoisCalls.length;
    await register.getByRole("button", { name: /批量完成/ }).filter({ hasText: "zz" }).click();
    await setAccountScopeOpen(true);
    assert(await accountOptions.getByRole("checkbox", { name: "查重账号：合成账号-001", exact: true }).isChecked());
    await setAccountScopeOpen(false);
    await page.waitForTimeout(400);
    assert.equal(whoisCalls.length, before);
    whoisMode = "success";
  });
  await check("390与768窄屏四工作面不横向溢出", async () => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const tab of ["assist", "ddns", "logs", "register"]) {
        await goto(tab);
        await assertGeometry();
        if (width === 390) {
          // 清掉前一工作面的短 toast，避免把注册／复制反馈当成日志布局证据。
          if (tab === "logs") await delay(4200);
          await snapshot(tab + "-390");
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => { localStorage.setItem("DNSHE_THEME", "dark"); document.documentElement.classList.add("dark"); });
    await snapshot("register-dark-1440");
    await page.getByTitle("切换到亮色", { exact: true }).click();
    for (const tab of ["assist", "ddns", "logs", "register"]) {
      await goto(tab);
      await assertGeometry();
      await snapshot(tab + "-light-1440");
    }
  });
} finally {
  report.passed = report.tests.length === 14 && report.tests.every((test) => test.passed) && report.pageErrors.length === 0;
  const ownedFiles = ["frontend/src/App.tsx", "frontend/src/AssistPanels.tsx", "frontend/src/FlowWorkspaces.tsx", "frontend/src/BatchScanModel.ts", "frontend/src/flow-workspaces.css", "frontend/src/assist-workspace.css", "frontend/src/RuleDomainWorkbench.tsx", "frontend/src/DomainCheckResults.tsx", "frontend/src/DomainCheckCacheModel.ts", "frontend/src/register-rule-tools.css"];
  report.sourceHashes = Object.fromEntries(await Promise.all(ownedFiles.map(async (file) => [file, crypto.createHash("sha256").update(await fs.readFile(path.join(repo, file))).digest("hex")])));
  await fs.writeFile(path.join(evidence, "audit.json"), JSON.stringify(report, null, 2));
  await browser.close();
  if (devServer?.pid && process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(devServer.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else { devServer?.kill("SIGTERM"); }
  console.log(JSON.stringify({ passed: report.passed, tests: report.tests.length, requests: report.requests.length, pageErrors: report.pageErrors, evidence }));
  if (!report.passed) process.exitCode = 1;
}
