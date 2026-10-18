/** 本地CF诊断交互：全部API为合成响应；后台headless、不登录、不触碰真人远端或前台键鼠。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.env.BASE || 'http://127.0.0.1:3012');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const fixture = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fixtures/cf-quota-synthetic-20.json'), 'utf8'))['GET /api/cf/quota'].body;
fixture.accounts = fixture.accounts.slice(0, 2);
fixture.accounts.forEach((account) => { account.cf_account_id = `synthetic-${account.account_id}`; });
fixture.accounts[0].alias = 'Synthetic Pages';
fixture.accounts[0].inventory_issues = { pages_projects: { kind: 'permission', message: 'Synthetic Authentication error', http_status: 403, code: 10000, cached_at: '2026-10-17T06:00:00.000Z' } };
fixture.accounts[1].alias = 'Synthetic R2';
fixture.accounts[1].inventory_issues = { r2_buckets: { kind: 'not_enabled', message: 'Please enable R2 through the Cloudflare Dashboard.', http_status: 403, code: 10042 } };
const out = path.resolve(repo, '..', 'shots/takeover-current', `cf-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(6000);
const errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
await context.addInitScript(() => {
  localStorage.setItem('DNSHE_BACKEND_URL', '/'); localStorage.setItem('DNSHE_THEME', 'light'); localStorage.setItem('DNSHE_INTERFACE_STYLE', 'data'); localStorage.setItem('DNSHE_STYLE_SCHEMA', '3');
  sessionStorage.setItem('DNSHE_SESSION', 'synthetic-not-a-real-session');
});
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== base.origin) { external.push(url.origin); return route.abort('blockedbyclient'); }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { success: false } });
  if (url.pathname === '/api/cf/quota') return route.fulfill({ json: fixture });
  if (url.pathname === '/api/accounts') return route.fulfill({ json: { success: true, accounts: fixture.accounts.map(account => ({ id: account.account_id, alias: account.alias, provider: 'cloudflare', enabled: 1 })) } });
  if (url.pathname === '/api/auth/status') return route.fulfill({ json: { success: true, initialized: true, two_fa_enabled: false } });
  return route.fulfill({ json: { success: true, domains: [] } });
});
const report = { synthetic: true, base: base.origin, tests: [], screenshots: [] };
const check = async (name, callback) => { await callback(); report.tests.push(name); console.log(`PASS ${name}`); };
const shot = async name => { const file = path.join(out, `${name}.png`); await page.screenshot({ path: file, fullPage: false, animations: 'disabled' }); report.screenshots.push(file); };
try {
  await page.goto(new URL('/#cfquota', base).href, { waitUntil: 'networkidle' });
  const row = page.locator('[data-cf-account-id]').filter({ hasText: 'Synthetic Pages' });
  await row.waitFor();
  await check('整行打开对应账号；短事实默认可读，原始诊断按需展开', async () => {
    await row.locator('td').first().click(); assert.equal(await row.getAttribute('aria-expanded'), 'true');
    assert.equal(await row.evaluate(element => element.nextElementSibling.classList.contains('cf-account-detail-row')), true);
    const scrollState = await page.evaluate(() => {
      const main = document.querySelector('main');
      const detail = document.querySelector('#cf-account-detail');
      const body = document.body;
      const root = document.documentElement;
      const inspect = (element) => element ? { overflowY: getComputedStyle(element).overflowY, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight } : null;
      return { main: inspect(main), detail: inspect(detail), body: inspect(body), root: inspect(root) };
    });
    assert.equal(scrollState.main?.overflowY, 'auto');
    assert.notEqual(scrollState.detail?.overflowY, 'auto');
    assert.notEqual(scrollState.detail?.overflowY, 'scroll');
    assert.notEqual(scrollState.body?.overflowY, 'auto');
    assert.notEqual(scrollState.body?.overflowY, 'scroll');
    assert.notEqual(scrollState.root?.overflowY, 'auto');
    assert.notEqual(scrollState.root?.overflowY, 'scroll');
    const item = page.locator('#cf-account-detail [data-cf-diagnostic="pages_projects"]');
    assert((await item.locator('summary').innerText()).includes('权限或范围待核对'));
    assert((await item.locator('summary').innerText()).includes('保留缓存'));
    assert.equal(await item.locator('.cf-diagnostic-body').isVisible(), false);
    await item.locator('summary').click();
    assert((await item.locator('.cf-diagnostic-body').innerText()).includes('HTTP 403 / code 10000'));
    assert((await item.locator('.cf-diagnostic-body').innerText()).includes('Synthetic Authentication error'));
    assert((await item.locator('.cf-diagnostic-body').innerText()).includes('GET /accounts/{account_id}/pages/projects'));
    assert((await item.locator('a[href*="/pages"]').count()) > 0, 'Pages 资源应提供就近管理入口');
    assert.equal(await row.getAttribute('aria-expanded'), 'true');
    await item.locator('a[href*="/pages"]').evaluate(element => element.addEventListener('click', event => event.preventDefault()));
    await item.locator('a[href*="/pages"]').click(); assert.equal(await row.getAttribute('aria-expanded'), 'true');
  });
  await shot('01-desktop-expanded-permission');
  await check('排序后详情仍对应稳定ID；Esc关闭并归焦原行', async () => {
    await page.getByLabel('账号排序', { exact: true }).selectOption('name');
    assert.equal(await row.evaluate(element => element.nextElementSibling.querySelector('h4').textContent), 'Synthetic Pages');
    await page.locator('#cf-account-detail summary').first().focus(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cf-account-detail').count(), 0);
    assert.equal(await row.evaluate(element => document.activeElement === element), true);
  });
  await check('R2未启用是服务事实，不显示缺权限结论', async () => {
    const disabledRow = page.locator('[data-cf-account-id]').filter({ hasText: 'Synthetic R2' });
    assert(!(await disabledRow.innerText()).includes('部分不可读'));
    await disabledRow.locator('td').first().click();
    const item = page.locator('#cf-account-detail [data-cf-diagnostic="r2_buckets"]');
    assert((await item.locator('summary').innerText()).includes('未启用'));
    assert(!(await item.locator('summary').innerText()).includes('权限'));
    assert((await item.locator('a[href*="/r2"]').count()) > 0, 'R2 未启用应提供开通入口');
    assert(!(await page.locator('#cf-account-detail').locator('h4 + p').innerText()).includes('读取需关注'));
    assert((await page.locator('[data-cf-account-id]').filter({ hasText: 'Synthetic Pages' }).innerText()).includes('权限待核对'));
  });
  await check('390移动诊断展开/链接不触发父行收起，长接口不横溢', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const item = page.locator('#cf-account-detail-mobile [data-cf-diagnostic="r2_buckets"]');
    await item.locator('summary').focus(); await page.keyboard.press('Space');
    assert.equal(await item.getAttribute('open'), '');
    assert.equal(await page.locator('[data-cf-account-mobile]').filter({ hasText: 'Synthetic R2' }).getAttribute('aria-expanded'), 'true');
    await item.locator('.cf-diagnostic-raw').click();
    assert.equal(await page.locator('#cf-account-detail-mobile').count(), 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  });
  await shot('02-mobile-r2-not-enabled');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.tests.length}/4 通过；证据 ${out}`);
} finally { await browser.close(); }
