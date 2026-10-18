#!/usr/bin/env node
/**
 * CF 用量离线交互回归：仅访问已有本地前端，所有 API 为 synthetic fixture。
 * 不登录、不读取凭据、不转发远端、不写生产数据、不占前台键鼠。
 * 先启动 3012 前端，再执行 node scripts/test-cf-quota-ui.mjs。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.env.BASE || 'http://127.0.0.1:3012');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only a local frontend is allowed.');
assert(!base.username && !base.password && !base.search && !base.hash, 'BASE must not contain credentials or a route.');
const fixture = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fixtures/cf-quota-synthetic-20.json'), 'utf8'))['GET /api/cf/quota'].body;
const boundaryOnly = process.env.CF_UI_CASE === 'boundaries';
if (boundaryOnly) {
  const byId = (id) => fixture.accounts.find((account) => account.account_id === id);
  byId(900011).traffic.kv = null;
  byId(900012).traffic.kv = [{ date: '2026-10-16', read: 500 }];
  byId(900013).counts.kv_namespaces = 0;
  byId(900013).traffic.kv = [];
  byId(900014).counts.worker_scripts = 0;
  byId(900014).counts.d1_databases = 0;
  byId(900014).traffic.workers = [];
  byId(900014).traffic.d1 = [];
  byId(900014).storage = { d1_bytes: 0, d1_detail: [] };
  byId(900001).traffic.workers = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${11 + index}`, requests: index === 6 ? 0 : index === 2 ? 300 : 100 }));
  byId(900002).traffic.workers = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${11 + index}`, requests: index === 6 ? 300 : 100 }));
  byId(900015).traffic.issues = { workers: { kind: 'timeout', message: 'Synthetic timeout: Workers请求超时', cached_at: '2026-10-17T06:00:00.000Z' } };
  byId(900016).traffic.workers = null;
  byId(900016).traffic.issues = { workers: { kind: 'permission', message: 'Synthetic permission: 未授权Workers分析' } };
  byId(900018).counts.r2_buckets = 5;
  byId(900018).traffic.r2_storage = null;
}
const run = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(repo, '..', 'shots/takeover-current', `cf-offline-${run}`);
fs.mkdirSync(out, { recursive: true });
const { chromium } = await import(process.env.REVIEW_PLAYWRIGHT ? pathToFileURL(process.env.REVIEW_PLAYWRIGHT).href : 'playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light', serviceWorkers: 'block', reducedMotion: 'reduce' });
const report = { synthetic: true, source: 'current-local-frontend', base: base.origin, fixtureDate: '2026-10-17', viewport: { width: 1440, height: 1000 }, tests: [], screenshots: [], requests: [], errors: [], blockedExternal: [] };
await context.addInitScript(() => {
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-10-17T12:00:00.000Z'])); }
    static now() { return NativeDate.parse('2026-10-17T12:00:00.000Z'); }
  }
  globalThis.Date = FixedDate;
  localStorage.setItem('DNSHE_BACKEND_URL', '/');
  localStorage.setItem('DNSHE_THEME', 'light');
  sessionStorage.setItem('DNSHE_SESSION', 'synthetic-offline-session-not-valid-for-any-server');
});
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== base.origin) {
    report.blockedExternal.push({ method: request.method(), origin: url.origin, path: url.pathname });
    return route.abort('blockedbyclient');
  }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  report.requests.push({ method: request.method(), path: url.pathname, query: url.search });
  if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { success: false, message: 'Offline test blocks all writes and login.' } });
  if (url.pathname === '/api/cf/quota') {
    if (url.searchParams.has('force')) await new Promise((resolve) => setTimeout(resolve, 500));
    return route.fulfill({ json: fixture });
  }
  if (url.pathname === '/api/accounts') return route.fulfill({ json: { success: true, accounts: fixture.accounts.map((account) => ({ id: account.account_id, alias: account.alias, provider: 'cloudflare', enabled: 1 })) } });
  if (url.pathname === '/api/domains') return route.fulfill({ json: { success: true, domains: [] } });
  if (url.pathname === '/api/auth/status') return route.fulfill({ json: { success: true, initialized: true, two_fa_enabled: false } });
  return route.fulfill({ status: 404, json: { success: false, message: 'No synthetic fixture exists for this API.' } });
});
const page = await context.newPage();
page.setDefaultTimeout(6000);
page.on('pageerror', (error) => report.errors.push(error.message));
const check = async (name, callback) => {
  try { await callback(); report.tests.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { report.tests.push({ name, passed: false, reason: error.message }); console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`); }
};
const shot = async (name) => {
  const target = path.join(out, `${name}.png`);
  // scrollIntoView 可能同时移动外层文档；保留 main 的检查位置，但把宿主顶栏放回视口。
  await page.evaluate(() => window.scrollTo(0, 0));
  // App 的主滚动面是 main；fullPage 会把已滚动的内容与空白文档拼接成假长图。
  await page.screenshot({ path: target, fullPage: false, animations: 'disabled' });
  report.screenshots.push(target);
};
// 详情展开时摘要区与详情区同时包含同名指标；只读当前可见工作区的第一项。
const value = (key) => page.locator(`[data-cf-metric="${key}"]:visible`).first().locator('p').nth(1).innerText();
const rowIds = () => page.locator('[data-cf-account-id]').evaluateAll((rows) => rows.map((row) => Number(row.dataset.cfAccountId)));
const scope = page.getByLabel('账号范围', { exact: true });
const title = page.getByRole('heading', { name: 'Cloudflare 用量', exact: true });
const globalStyleToggle = () => page.getByRole('group', { name: '界面画风', exact: true });
async function setGlobalStyle(style) {
  const button = globalStyleToggle().getByRole('button', { name: style === 'data' ? '数据风' : '设计风', exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.waitForFunction((expected) => document.documentElement.dataset.interfaceStyle === expected, style);
}

try {
  await page.goto(new URL('/#cfquota', base).href, { waitUntil: 'networkidle' });
  await title.waitFor();
  await page.locator('[data-cf-account-id]').first().waitFor();

  if (boundaryOnly) {
    // 桌面表格与移动摘要保留同一语义的两套 DOM，由 CSS 按视口隐藏其一；断言必须限定当前可见副本。
    await check('KV不可读与今日缺失会影响结论、监控筛选和详情', async () => {
      await scope.selectOption('900011');
      assert((await page.locator('[data-cf-verdict]').innerText()).includes('数据尚不完整'));
      assert.equal(await page.locator('[data-cf-metric]').count(), 4);
      await setGlobalStyle('data');
      await page.getByLabel('账号状态筛选', { exact: true }).selectOption('issues');
      assert.deepEqual(await rowIds(), [900011]);
      assert((await page.locator('[data-cf-account-id="900011"]').innerText()).includes('数据未返回'));
      await page.locator('[data-cf-account-id="900011"] button').click();
      assert((await page.locator('[data-cf-kv-status]:visible').innerText()).includes('上游未返回数据'));
      await scope.selectOption('900012');
      assert((await page.locator('[data-cf-account-id="900012"]').innerText()).includes('今日无操作记录'));
      await page.locator('[data-cf-account-id="900012"] button').click();
      assert((await page.locator('[data-cf-kv-status]:visible').innerText()).includes('今日没有操作记录'));
      assert((await page.locator('[data-cf-kv-status]:visible').innerText()).includes('上游仅返回有操作记录的日期'));
      await page.locator('#cf-account-detail').scrollIntoViewIfNeeded();
    });
    await shot('boundary-01-kv-pending-detail');

    await check('KV无资源记录不假称缺权限', async () => {
      await scope.selectOption('900013');
      assert((await page.locator('[data-cf-account-id="900013"]').innerText()).includes('已读取'));
      await page.getByLabel('账号状态筛选', { exact: true }).selectOption('issues');
      assert.equal(await page.locator('[data-cf-account-id]').count(), 0);
      await scope.selectOption('900014');
      assert((await page.locator('[data-cf-account-id="900014"]').innerText()).includes('已读取'));
      assert.equal(await page.locator('[data-cf-max-metric]').innerText(), 'KV 读');
    });

    await check('历史峰基准排除未结束今日，今日峰明确截至采集', async () => {
      await setGlobalStyle('design');
      await scope.selectOption('900001');
      const insight = page.getByRole('heading', { name: '峰值与数据状态', exact: true }).locator('..');
      assert((await insight.innerText()).includes('3.0 倍'));
      assert((await insight.innerText()).includes('已结束且全部账号返回'));
      await scope.selectOption('900002');
      assert((await insight.innerText()).includes('今日未结束，截至采集'));
      assert((await insight.innerText()).includes('当前累计相当于'));
      assert((await page.locator('[data-chart-hit="6"]').getAttribute('aria-label')).includes('今日未结束，截至采集'));
    });
    await shot('boundary-02-today-peak');

    await check('最高使用率指标在表内直接可见，不依赖鼠标title', async () => {
      await setGlobalStyle('data');
      await scope.selectOption('900010');
      assert.equal(await page.locator('[data-cf-max-metric]').innerText(), 'KV 读');
      assert.equal(await page.locator('[data-cf-max-metric]').isVisible(), true);
      assert((await page.locator('[data-cf-account-id="900010"]').innerText()).includes('95.0%'));
      assert.deepEqual(report.errors, []);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      assert(report.requests.every((entry) => entry.method === 'GET'));
      assert.equal(report.blockedExternal.length, 0);
    });
    await shot('boundary-03-visible-kv-metric');
    await check('超时缓存与真实权限失败逐项可见，不能误报本次新读', async () => {
      await page.getByLabel('账号状态筛选', { exact: true }).selectOption('all');
      await scope.selectOption('900015');
      await page.locator('[data-cf-account-id="900015"] button').click();
      await page.locator('[aria-label="读取诊断与服务状态"]:visible').locator('summary').first().click();
      assert((await page.getByRole('region', { name: '当前用量摘要', exact: true }).first().innerText()).includes('缓存'));
      assert((await page.locator('[aria-label="读取诊断与服务状态"]:visible').innerText()).includes('Workers请求超时'));
      assert((await page.locator('[data-cf-metric="requests"]:visible').first().innerText()).includes('缓存'));
      await scope.selectOption('900016');
      assert.equal(await value('requests'), '—');
      await page.locator('[data-cf-account-id="900016"] button').click();
      await page.locator('[aria-label="读取诊断与服务状态"]:visible').locator('summary').first().click();
      assert((await page.locator('[aria-label="读取诊断与服务状态"]:visible').innerText()).includes('未授权Workers分析'));
      assert(!(await page.locator('[aria-label="读取诊断与服务状态"]:visible').innerText()).includes('缓存）'));
      await scope.selectOption('900018');
      await page.locator('[data-cf-account-id="900018"] button').click();
      assert((await page.locator('[data-cf-r2-status]:visible').innerText()).includes('当前存储快照尚未返回'));
      assert((await page.locator('[data-cf-account-id="900018"]').innerText()).includes('已读取'));
    });
    await shot('boundary-04-explicit-issues');
  } else {

  await check('设计为趋势摘要，全部范围不造共享额度百分比', async () => {
    assert.equal(await page.locator('[data-cf-quota-view]').getAttribute('data-cf-quota-view'), 'bold');
    assert.equal(await page.locator('.cf-design-hero').count(), 1);
    assert.equal(await page.locator('.cf-design-hero-facts > div').count(), 3);
    assert.equal(await page.locator('.cf-data-trend').count(), 0);
    assert.equal(await page.locator('[data-column-chart]').count(), 1);
    assert.equal(await page.locator('[data-cf-account-id]').count(), 10);
    assert(!(await page.getByRole('region', { name: '当前用量摘要', exact: true }).innerText()).includes('% 已用'));
    assert((await page.getByRole('region', { name: '当前用量摘要', exact: true }).innerText()).includes('最高单账号'));
    const expected = fixture.accounts.filter((account) => !account.error).reduce((sum, account) => sum + (account.traffic.workers?.find((day) => day.date === '2026-10-17')?.requests || 0), 0);
    assert.equal(await value('requests'), expected.toLocaleString('en-US'));
    const boxes = await page.locator('[data-cf-metric]').evaluateAll((nodes) => nodes.map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
    assert(Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width)) <= 1);
    assert(Math.max(...boxes.map((box) => box.height)) - Math.min(...boxes.map((box) => box.height)) <= 1);
  });
  await shot('01-design-all-20-synthetic');

  await check('多账号日期明细点按固定后可滚动，Escape可解除', async () => {
    await page.locator('[data-chart-hit="3"]').click();
    await page.mouse.move(1, 1);
    const tooltip = page.locator('[data-chart-tooltip]');
    assert.equal(await tooltip.count(), 1);
    assert(await tooltip.evaluate((node) => node.scrollHeight > node.clientHeight));
    await tooltip.hover();
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector('[data-chart-tooltip]')?.scrollTop > 0);
    await page.keyboard.press('Escape');
    assert.equal(await tooltip.count(), 0);
  });

  await check('账号范围同时驱动KPI与七日数据', async () => {
    await scope.selectOption('900001');
    assert.equal(await value('requests'), '1,000');
    assert((await page.locator('[data-cf-metric="requests"]').innerText()).includes('1.0% 已用'));
    assert((await page.locator('[data-chart-hit="3"]').getAttribute('aria-label')).includes('97,420'));
    await scope.selectOption('900002');
    assert.equal(await value('requests'), '90,000');
    assert((await page.locator('[data-cf-metric="requests"]').innerText()).includes('90.0% 已用'));
    assert((await page.locator('[data-chart-hit="6"]').getAttribute('aria-label')).includes('90,000'));
  });

  await check('七个日期中心区域均可连续悬停查看明细，真实0可读', async () => {
    await scope.selectOption('900001');
    await page.mouse.move(1, 1);
    for (let i = 0; i < 7; i++) {
      await page.locator(`[data-chart-hit="${i}"]`).hover();
      const tip = await page.locator('[data-chart-tooltip]').innerText();
      assert(tip.startsWith(`2026-10-${11 + i}`), `Wrong tooltip for index ${i}: ${tip}`);
      if (i === 0) assert(tip.includes('总请求数：0') && !tip.includes('未返回数据'));
    }
  });

  await check('键盘左右日期、Escape关闭提示并保留焦点', async () => {
    const first = page.locator('[data-chart-hit="0"]');
    await first.hover();
    await first.focus();
    await first.press('ArrowRight');
    assert.equal(await page.locator('[data-chart-hit="1"]').evaluate((node) => node === document.activeElement), true);
    assert((await page.locator('[data-chart-tooltip]').innerText()).startsWith('2026-10-12'));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-chart-tooltip]').count(), 0);
    assert.equal(await page.locator('[data-chart-hit="1"]').evaluate((node) => node === document.activeElement), true);
  });

  await check('缺少今日显示未返回，不能伪造0或偷用昨日', async () => {
    await scope.selectOption('900003');
    assert.equal(await value('requests'), '—');
    await page.mouse.move(1, 1);
    await page.locator('[data-chart-hit="6"]').hover();
    assert((await page.locator('[data-chart-tooltip]').innerText()).includes('请求数：未返回数据'));
    assert((await page.locator('[data-chart-tooltip]').innerText()).includes('覆盖 0/1 账号'));
  });
  await page.mouse.move(1, 1);
  await scope.selectOption('900001');
  await shot('02-design-single-synthetic');

  await check('数据风用紧凑状态带、关键用量和可交互小趋势，不铺四大诊断卡', async () => {
    await scope.selectOption('all');
    await setGlobalStyle('data');
    assert.equal(await page.locator('[data-cf-quota-view]').getAttribute('data-cf-quota-view'), 'clear');
    assert.equal(await page.locator('.cf-design-hero').count(), 0);
    assert.equal(await page.locator('.cf-data-trend').count(), 1);
    assert.equal(await page.locator('.cf-data-trend').getAttribute('open'), '');
    assert(await page.locator('.cf-account-collection--data').evaluate((node) => { const trend = node.parentElement?.querySelector('.cf-data-trend'); return Boolean(trend && (node.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING)); }));
    assert.equal(await page.locator('[data-column-chart]').count(), 1);
    assert.equal(await page.locator('.cf-trend-compact svg').getAttribute('height'), '124');
    assert((await page.getByRole('region', { name: '监控状态摘要' }).boundingBox()).height < 80);
    assert.equal(await page.locator('[data-cf-metric]').count(), 4);
    assert.equal(await page.locator('[data-cf-account-id]').count(), 10);
    assert.equal((await rowIds())[0], 900005);
    assert((await page.locator('[data-cf-account-id="900005"]').innerText()).includes('读取失败'));
  });
  await shot('03-monitor-all-20-synthetic');

  await check('数据风趋势可连续悬停，全局风格切换保留单账号范围', async () => {
    await scope.selectOption('900001');
    for (let i = 0; i < 7; i++) {
      await page.locator(`[data-chart-hit="${i}"]`).hover();
      assert((await page.locator('[data-chart-tooltip]').innerText()).startsWith(`2026-10-${11 + i}`));
    }
    assert(await page.locator('[data-chart-tooltip]').evaluate((tip) => {
      const box = tip.getBoundingClientRect();
      for (let node = tip.parentElement; node; node = node.parentElement) {
        const css = getComputedStyle(node), bounds = node.getBoundingClientRect();
        if (/(hidden|clip)/.test(css.overflowY) && (box.top < bounds.top || box.bottom > bounds.bottom)) return false;
      }
      return true;
    }), 'Tooltip must not be clipped by the compact trend panel.');
    await shot('07-data-single-tooltip-synthetic');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.locator('[data-chart-hit="3"]').hover();
    assert((await page.locator('[data-chart-tooltip]').innerText()).startsWith('2026-10-14'));
    await shot('08-data-dark-tooltip-synthetic');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await setGlobalStyle('design');
    assert.equal(await scope.inputValue(), '900001'); assert.equal(await value('requests'), '1,000');
    await setGlobalStyle('data');
    assert.equal(await scope.inputValue(), '900001'); assert.equal(await value('requests'), '1,000');
    assert.equal(await page.locator('[data-cf-pagination]').count(), 0);
    await scope.selectOption('all');
  });

  await check('20账号分页、名称排序、搜索与异常筛选真实改变列表', async () => {
    await page.getByLabel('账号排序', { exact: true }).selectOption('name');
    assert.deepEqual(await rowIds(), Array.from({ length: 10 }, (_, i) => 900001 + i));
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    assert.deepEqual(await rowIds(), Array.from({ length: 10 }, (_, i) => 900011 + i));
    await page.locator('header input').fill('Synthetic 20');
    assert.deepEqual(await rowIds(), [900020]);
    assert.equal(await page.locator('[data-cf-pagination]').count(), 0);
    await page.locator('header input').fill('');
    await page.getByLabel('账号状态筛选', { exact: true }).selectOption('failed');
    assert.deepEqual(await rowIds(), [900005]);
    await page.getByLabel('账号状态筛选', { exact: true }).selectOption('high');
    assert.deepEqual((await rowIds()).sort(), [900002, 900008, 900010]);
    await page.getByLabel('账号状态筛选', { exact: true }).selectOption('all');
    await page.getByLabel('账号排序', { exact: true }).selectOption('usage');
    assert.equal((await rowIds())[0], 900008);
  });

  await check('同时只有一个账号详情，Escape关闭后返回触发按钮', async () => {
    await page.getByLabel('账号排序', { exact: true }).selectOption('name');
    const first = page.locator('[data-cf-account-id="900001"] button');
    const second = page.locator('[data-cf-account-id="900002"] button');
    await first.click();
    assert.equal(await page.locator('#cf-account-detail').count(), 1);
    const scrollState = await page.evaluate(() => {
        const root = document.documentElement;
        const main = document.querySelector('main');
        const surfaces = ['html', 'body', '#root'].map((selector) => {
          const node = document.querySelector(selector);
          const style = node && getComputedStyle(node);
          return { selector, overflowY: style?.overflowY, overflowX: style?.overflowX };
        });
        const nested = [...document.querySelectorAll('[data-cf-account-detail] , #cf-account-detail')].filter((node) => {
          const style = getComputedStyle(node);
          return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        });
        return {
          document: { clientHeight: root.clientHeight, scrollHeight: root.scrollHeight },
          main: main ? { clientHeight: main.clientHeight, scrollHeight: main.scrollHeight, overflowY: getComputedStyle(main).overflowY } : null,
          surfaces,
          nested: nested.map((node) => ({ tag: node.tagName, className: node.className, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight })),
        };
      });
    assert(scrollState.surfaces.filter((surface) => surface.selector !== 'main').every((surface) => surface.overflowY === 'hidden'), `document/body/root must not create an outer scrollbar: ${JSON.stringify(scrollState.surfaces)}`);
    assert(scrollState.main && scrollState.main.scrollHeight >= scrollState.main.clientHeight, 'main must own the page scroll surface');
    assert.equal(scrollState.nested.length, 0, `account detail must not create a nested vertical scroll surface: ${JSON.stringify(scrollState.nested)}`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cf-account-detail').count(), 0);
    assert.equal(await first.evaluate((node) => node === document.activeElement), true);
    await first.press('Enter');
    assert((await page.locator('#cf-account-detail h4').innerText()).startsWith('Synthetic 01'));
    await second.click();
    assert.equal(await page.locator('#cf-account-detail').count(), 1);
    assert((await page.locator('#cf-account-detail h4').innerText()).startsWith('Synthetic 02'));
    assert.equal(await first.getAttribute('aria-expanded'), 'false');
    await page.getByRole('button', { name: '关闭详情', exact: true }).focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cf-account-detail').count(), 0);
    assert.equal(await second.evaluate((node) => node === document.activeElement), true);
    await second.press('Enter');
    assert.equal(await page.locator('#cf-account-detail').count(), 1);
    const hit = page.locator('#cf-account-detail [data-chart-hit="0"]');
    await hit.focus();
    assert.equal(await page.locator('[data-chart-tooltip]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-chart-tooltip]').count(), 0);
    assert.equal(await page.locator('#cf-account-detail').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cf-account-detail').count(), 0);
    assert.equal(await second.evaluate((node) => node === document.activeElement), true);
    await second.press('Enter');
  });
  await page.locator('#cf-account-detail').scrollIntoViewIfNeeded();
  await shot('04-monitor-single-detail-synthetic');

  await check('刷新仅重新读取本地fixture，不写远端', async () => {
    const before = report.requests.filter((entry) => entry.path === '/api/cf/quota').length;
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    assert((await page.locator('[data-cf-quota-view] header').innerText()).includes('保留当前快照'));
    assert.equal(await page.locator('[data-cf-account-id]').count(), 10);
    await page.waitForFunction(() => !document.querySelector('[data-cf-quota-view] header button')?.disabled);
    assert(report.requests.filter((entry) => entry.path === '/api/cf/quota').length > before);
    assert(report.requests.every((entry) => entry.method === 'GET'));
    assert.equal(report.blockedExternal.length, 0);
  });

  await check('390数据风使用可展开账号摘要卡，全部数字不贴边裁切', async () => {
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const scopeBox = await page.locator('.cf-scope-control').boundingBox();
    const styleBox = await globalStyleToggle().boundingBox();
    assert(styleBox && scopeBox.y >= styleBox.y + styleBox.height && scopeBox.width >= 360, 'Mobile account scope needs its own full-width row.');
    assert.equal(await page.locator('.cf-account-desktop').isVisible(), false);
    assert.equal(await page.locator('.cf-account-mobile').isVisible(), true);
    assert.equal(await page.locator('[data-cf-account-mobile]').count(), 10);
    const cards = await page.locator('[data-cf-account-mobile]').evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { right: box.right, overflow: node.scrollWidth - node.clientWidth,
        rightPadding: Math.min(...Array.from(node.querySelectorAll('dd')).map((dd) => box.right - dd.getBoundingClientRect().right)) };
    }));
    assert(cards.every((card) => card.right <= 390 && card.overflow <= 1 && card.rightPadding >= 15));
    const first = page.locator('[data-cf-account-mobile="900001"] button');
    await first.click();
    assert((await page.locator('#cf-account-detail h4').innerText()).startsWith('Synthetic 01'));
    assert((await page.locator('[data-cf-history-coverage]').innerText()).includes('未返回日期不补零'));
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    assert.equal(await first.evaluate((node) => node === document.activeElement), true);
    await page.locator('[data-chart-hit="0"]').focus();
    assert.equal(await page.locator('[data-chart-tooltip]').count(), 1);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[data-chart-tooltip]')?.textContent?.startsWith('2026-10-12'));
    assert((await page.locator('[data-chart-tooltip]').innerText()).startsWith('2026-10-12'));
    await page.keyboard.press('Escape');
  });
  await page.locator('.cf-account-mobile').evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await shot('05-data-mobile-cards-synthetic');
  await page.locator('main').evaluate((node) => node.scrollTo(0, 0));
  await shot('06-data-mobile-overview-synthetic');

  await check('没有页面JS异常或整页水平溢出', async () => {
    assert.deepEqual(report.errors, []);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  });
  }
} catch (error) {
  report.tests.push({ name: 'harness setup', passed: false, reason: error.message });
} finally {
  report.passed = report.tests.every((entry) => entry.passed);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, tests: report.tests.length, out }));
  if (!report.passed) process.exitCode = 1;
}
