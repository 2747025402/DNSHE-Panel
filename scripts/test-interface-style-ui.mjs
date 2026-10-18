#!/usr/bin/env node
/** 整站画风回归：当前本地界面、合成业务数据、全部请求本地拦截；零真实登录/远端写入。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.env.BASE || 'http://127.0.0.1:3012');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && ['http:', 'https:'].includes(base.protocol));
const out = path.resolve(repo, '..', 'shots/takeover-current', `interface-style-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const source = () => Object.fromEntries(fs.readdirSync(path.join(repo, 'frontend/src'), { recursive: true }).filter((file) => /\.(tsx?|css)$/.test(file)).sort().map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'frontend/src', file))).digest('hex')]));
const report = { synthetic: true, sourceBefore: source(), tests: [], shots: [], requests: [], pageErrors: [], blockedExternal: [] };
const cf = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fixtures/cf-quota-synthetic-20.json'), 'utf8'))['GET /api/cf/quota'].body;
const accounts = [1, 2, 3].map((id) => ({ id, alias: `示例账号 ${id}`, api_key: 'synthetic-not-a-secret', provider: 'dnshe', created_at: '2026-09-01' }));
accounts.push(...cf.accounts.slice(0, 2).map((a) => ({ id: a.account_id, alias: a.alias, api_key: 'synthetic-cf-token', provider: 'cloudflare', created_at: '2026-09-01' })));
const domains = Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, account_id: 1 + i % 3, account_alias: `示例账号 ${1 + i % 3}`, full_domain: `example-${i}.cc.cd`, subdomain: `example-${i}`, rootdomain: 'cc.cd', status: 'active', has_dns: i % 2 === 0 ? 1 : 0, created_at: '2026-09-01', expires_at: '2027-09-01', ns1: i % 2 ? 'a.cloudflare.com' : 'a.ns.dnshe.org', ns2: i % 2 ? 'b.cloudflare.com' : 'b.ns.dnshe.org' }));
// 夹具沿用当前API的系统NS识别约定，不用第三方NS伪装系统默认。
domains.forEach((d, i) => { if (i % 2 === 0) { d.ns1 = 'a.dnshe.com'; d.ns2 = 'b.dnshe.com'; } });
const zones = domains.slice(0, 6).map((d, i) => ({ ...d, id: d.id + 100, account_id: accounts[3 + i % 2].id, account_alias: accounts[3 + i % 2].alias, account_provider: 'cloudflare', provider_account_id: 'synthetic-account', status: 'active' }));
const quotas = accounts.slice(0, 3).map((a) => ({ account_id: a.id, alias: a.alias, used: 3, total: 16, base: 16, available: 13, invite_bonus: 0 }));
const pages = [['dashboard', '概览'], ['domains', '域名列表'], ['cloudflare', 'Cloudflare'], ['assist', '域名助力'], ['accounts', '账号管理'], ['apikeys', 'API 密钥'], ['register', '注册 / 查重'], ['quota', '账户配额'], ['ddns', '动态 DNS'], ['cfquota', 'CF 免费额度'], ['logs', '运行日志'], ['settings', '设置']];
const { chromium } = await import(process.env.REVIEW_PLAYWRIGHT ? pathToFileURL(process.env.REVIEW_PLAYWRIGHT).href : 'playwright');
const browser = await chromium.launch({ headless: true });
async function makePage(stored = null, denyStorage = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(({ stored, denyStorage }) => {
    if (!localStorage.getItem('STYLE_TEST_SEEDED')) {
      localStorage.setItem('DNSHE_BACKEND_URL', '/'); localStorage.setItem('DNSHE_THEME', 'light');
      localStorage.setItem('DNSHE_CF_COLS_V2', '2'); localStorage.setItem('DNSHE_DOMAIN_VIEW', 'list');
      if (stored !== null) localStorage.setItem('DNSHE_INTERFACE_STYLE', stored);
      localStorage.setItem('STYLE_TEST_SEEDED', '1');
    }
    sessionStorage.setItem('DNSHE_SESSION', 'synthetic-not-valid-for-any-server');
    if (denyStorage) {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) { if (key === 'DNSHE_INTERFACE_STYLE') throw new Error('Synthetic blocked storage'); return get.call(this, key); };
      Storage.prototype.setItem = function (key, value) { if (key === 'DNSHE_INTERFACE_STYLE') throw new Error('Synthetic blocked storage'); return set.call(this, key, value); };
    }
  }, { stored, denyStorage });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base.origin) { report.blockedExternal.push(url.origin + url.pathname); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    report.requests.push({ method: req.method(), path: url.pathname });
    if (req.method() !== 'GET') return route.fulfill({ status: 405, json: { success: false, message: 'Offline test prevents all writes.' } });
    let body = {};
    if (url.pathname === '/api/auth/status') body = { initialized: true, two_fa_enabled: false };
    else if (url.pathname === '/api/auth/account') body = { username: '示例管理员', two_fa_enabled: false };
    else if (url.pathname === '/api/accounts') body = { accounts };
    else if (url.pathname === '/api/domains') {
      let list = url.searchParams.get('provider') === 'cloudflare' ? zones : domains;
      if (url.searchParams.has('account_id')) list = list.filter((d) => d.account_id === Number(url.searchParams.get('account_id')));
      body = { domains: list, last_sync: { at: '2026-10-17T00:00:00Z', type: 'success' } };
    } else if (url.pathname === '/api/cf/quota') body = cf;
    else if (url.pathname === '/api/quota') body = { quotas };
    else if (url.pathname === '/api/settings') body = { settings: { auto_renew: 'false', renew_threshold_days: '7' }, configured: {} };
    else if (url.pathname === '/api/assist/status') body = { accounts: accounts.slice(0, 3).map(a => ({ account_id: a.id, name: a.alias, helper_assist_remaining: 6, helper_assist_limit: 15, domains: domains.filter(d => d.account_id === a.id).map(d => ({ id: d.id, domain: d.full_domain, status: 'normal', expires_at: d.expires_at, assist_code: 'SYNTH123' })) })), history: [] };
    else if (url.pathname === '/api/keys') {
      const groups = accounts.slice(0, 3).map(a => ({ account_id: a.id, alias: a.alias, keys: [{ key_id: a.id, key_name: '示例密钥 ' + a.id, api_key: 'synthetic-key-' + a.id, status: 'active', request_count: a.id * 100, last_used_at: '2026-10-18 09:00', has_secret: true }] }));
      body = { groups, keys: groups.find(g => g.account_id === Number(url.searchParams.get('account_id')))?.keys || [], preview_read_only: true };
    }
    else if (url.pathname === '/api/logs') body = { logs: [] };
    else if (url.pathname === '/api/ddns') body = { bindings: [] };
    else if (url.pathname === '/api/overview') body = { domains: { total: 9, active: 9, expired: 0, expiring_soon: 0, delegated: 4, not_delegated: 5 }, accounts: { total: 5, dnshe: 3, cloudflare: 2 }, quota: { total: 48, used: 9, available: 39, failed: 0, accounts: quotas }, assist: null };
    else if (url.pathname === '/api/expiry') body = { results: [] };
    return route.fulfill({ json: { success: true, ...body } });
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  return { page, context };
}
const check = async (name, action) => { try { await action(); report.tests.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (error) { report.tests.push({ name, passed: false, reason: error.message }); console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`); } };
const state = await makePage(); const page = state.page;
const styleGroup = () => page.getByRole('group', { name: '界面画风', exact: true });
const labels = { design: '设计风', data: '数据风', cards: '卡片风' };
async function style(value) {
  const width = page.viewportSize().width;
  if (width < 640) {
    const cycle = styleGroup().getByRole('button', { name: /切换界面画风/ });
    for (let i = 0; i < 3 && await page.locator('html').getAttribute('data-interface-style') !== value; i += 1) {
      await cycle.click();
      await page.waitForTimeout(20);
    }
  } else {
    await styleGroup().getByRole('button', { name: labels[value], exact: true }).click();
  }
  await page.waitForFunction(v => document.documentElement.dataset.interfaceStyle === v, value);
}
async function navigate(key) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#app-nav-panel nav button').filter({ hasText: pages.find(p => p[0] === key)[1] }).click();
  await page.locator('main[data-workspace="' + key + '"]').waitFor();
  await page.waitForTimeout(100);
}
const search = () => page.locator('header input[type=search]');
async function shot(file) {
  // The DOM, not the filename, proves the selected view. Never reset style during reload.
  if (page.viewportSize().width < 640) {
    assert.equal(await styleGroup().getByRole('button', { name: /切换界面画风/ }).count(), 1, '移动端使用单按钮画风切换');
  } else {
    assert.equal(await styleGroup().getByRole('button', { pressed: true }).count(), 1);
  }
  const bytes = await page.screenshot({ path: path.join(out, file), animations: 'disabled' });
  report.shots.push({ file, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    style: await page.locator('html').getAttribute('data-interface-style') });
}
try {
  await page.goto(new URL('/#domains', base).href, { waitUntil: 'networkidle' });
  await check('三个平级入口，移除页内二级切换，保留DNS筛选排序与身份', async () => {
    assert.equal(await styleGroup().getByRole('button').count(), 3);
    assert.equal(await page.locator('.page-view-toggle').count(), 0);
    await page.getByLabel('筛选 DNS 类型', { exact: true }).selectOption('external');
    await page.getByLabel('域名列表排序方式').selectOption('name-desc');
    await style('data'); assert.equal(await page.locator('.asset-record').count(), 4);
    await style('cards'); assert.equal(await page.locator('[data-asset-card=domain]').count(), 4);
    await style('design'); assert.equal(await page.locator('.editorial-atlas').count(), 1);
    assert.equal(await page.getByLabel('筛选 DNS 类型', { exact: true }).inputValue(), 'external');
    assert.equal(await page.getByLabel('域名列表排序方式').inputValue(), 'name-desc');
    await page.getByLabel('筛选 DNS 类型', { exact: true }).selectOption('all');
  });
  await check('顶栏搜索跨三种风格共享，无重复搜索框，切页各保留自己的词', async () => {
    await search().fill('example-0');
    for (const mode of ['design', 'data', 'cards']) {
      await style(mode);
      assert.equal(await search().inputValue(), 'example-0');
      assert.equal(await page.locator('main input[type=search]').count(), 0);
      if (mode === 'design') assert.equal(await page.locator('.editorial-domain-node').count(), 1);
      else if (mode === 'data') assert.equal(await page.locator('.asset-record').count(), 1);
      else assert.equal(await page.locator('[data-asset-card=domain]').count(), 1);
    }
    await navigate('accounts'); assert.equal(await search().inputValue(), '');
    await search().fill('示例账号 2'); await style('design');
    assert.equal(await page.locator('.ew-connection-row').count(), 1);
    assert.equal(await page.locator('main input[type=search]').count(), 0);
    await navigate('domains'); assert.equal(await search().inputValue(), 'example-0');
    await search().fill('');
    await navigate('accounts'); assert.equal(await search().inputValue(), '示例账号 2'); await search().fill('');
  });
  await check('账号弹窗Esc取消、草稿不提交、焦点归还', async () => {
    const bind = page.getByRole('button', { name: /^(?:＋\s*)?绑定 DNSHE 账号$/ });
    await bind.click(); await page.locator('[data-app-modal=bind]').waitFor();
    const input = page.locator('[data-app-modal=bind] input').first();
    await input.fill('未提交的绑定草稿');
    const before = report.requests.filter(r => r.method !== 'GET').length;
    await page.keyboard.press('Escape');
    await page.locator('[data-app-modal=bind]').waitFor({ state: 'detached' });
    assert.equal(report.requests.filter(r => r.method !== 'GET').length, before);
    assert(await bind.evaluate(el => el === document.activeElement));
    await bind.click(); assert.equal(await page.locator('[data-app-modal=bind] input').first().inputValue(), '未提交的绑定草稿');
    await page.keyboard.press('Escape');
  });
  await check('设置三模式同源、刷新恢复、切换不丢未保存输入', async () => {
    await navigate('settings');
    assert.equal(await page.locator('header').getByRole('group', { name: '界面画风', exact: true }).count(), 0);
    await page.getByRole('radio', { name: '卡片风', exact: true }).check();
    assert.equal(await page.locator('[data-page-style-matrix]').count(), 1, '设置页必须提供页面级样式矩阵');
    const domainStyleRow = page.locator('[data-page-style-row="domains"]');
    assert.equal(await domainStyleRow.getByRole('group', { name: '域名列表页面样式', exact: true }).count(), 1, 'row group');
    await domainStyleRow.getByRole('button', { name: '域名列表：数据风', exact: true }).click();
    assert.equal(await domainStyleRow.getByRole('button', { name: '域名列表：数据风', exact: true }).getAttribute('aria-pressed'), 'true', 'domain data override');
    await navigate('domains');
    assert.equal(await page.locator('html').getAttribute('data-interface-style'), 'data', '单页覆盖应在进入页面时生效');
    await navigate('settings');
    await page.locator('[data-page-style-row="domains"]').getByRole('button', { name: '跟随全局', exact: true }).click();
    assert.equal(await page.locator('[data-page-style-row="domains"]').getByRole('button', { name: '跟随全局', exact: true }).getAttribute('aria-pressed'), 'true', 'domain follows global');
    await page.reload({ waitUntil: 'networkidle' });
    assert(await page.getByRole('radio', { name: '卡片风', exact: true }).isChecked());
    await page.locator('#settings-backend').getByRole('button', { name: '修改', exact: true }).click();
    const input = page.getByPlaceholder('https://dnshe-panel.<子域>.workers.dev');
    await input.fill('https://draft.example.test');
    await page.getByRole('radio', { name: '数据风', exact: true }).check();
    assert.equal(await input.inputValue(), 'https://draft.example.test');
    await page.locator('#settings-backend').getByRole('button', { name: '取消', exact: true }).click();
  });
  await check('概览三个来源骨架实际独立，刷新读取同屏三来源', async () => {
    await navigate('dashboard'); await style('design');
    assert.equal(await page.locator('[data-mode=design]').count(), 1);
    await style('data'); assert.equal(await page.locator('.source-overview--list').count(), 1);
    await style('cards'); assert.equal(await page.locator('.source-overview-metric-card').count(), 10);
    await style('data');
    const reads = ['/api/overview', '/api/domains', '/api/cf/quota'];
    const before = reads.map(p => report.requests.filter(r => r.path === p).length);
    await page.getByRole('button', { name: '刷新概览摘要', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="刷新概览摘要"]')?.disabled);
    reads.forEach((p, i) => assert(report.requests.filter(r => r.path === p).length > before[i], p));
  });
  await check('API卡片自适应多列，保留完整Key/Secret入口和组折叠', async () => {
    await navigate('apikeys'); await style('cards');
    const groups = page.locator('.mapped-key-account-group');
    assert.equal(await groups.count(), 3);
    for (const button of await groups.locator('> button').all()) if (await button.getAttribute('aria-expanded') === 'false') await button.click();
    assert.equal(await page.locator('[data-key-card]').count(), 3);
    assert(await page.locator('[data-key-card]').first().innerText().then(text => text.includes('synthetic-key-1')));
    const rects = await groups.evaluateAll(nodes => nodes.map(n => { const r=n.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width}; }));
    assert(new Set(rects.map(r => Math.round(r.x))).size >= 2, JSON.stringify(rects));
    await style('data');
    await page.locator('.mapped-key-directory').waitFor({ state: 'attached' });
    assert(await page.locator('.mapped-key-directory').isVisible());
    assert.equal(await page.locator('.mapped-key-directory input').count(), 0, 'API 数据风不保留页内重复搜索');
    await search().fill('示例密钥 1');
    assert.equal(await page.locator('.mapped-key-row:not(.is-head)').count(), 1, 'API 数据风必须实际使用顶栏搜索');
    await search().fill('');
    await page.getByRole('button', { name: '查看凭据', exact: true }).first().click();
    await page.waitForTimeout(240);
    assert.equal(await page.locator('.editorial-key-inspector').count(), 1);
    assert(await page.locator('.editorial-key-inspector').isVisible());
    assert.equal(await page.locator('.editorial-key-inspector').getByText('synthetic-key-1', { exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.locator('.editorial-key-inspector').waitFor({state:'detached'});
  });
  await check('CF仅两种布局，搜索共用顶栏且切换保留范围', async () => {
    await navigate('cfquota'); await style('data');
    assert.equal(await styleGroup().getByRole('button').count(), 2);
    assert.equal(await page.locator('main input[type=search]').count(), 0);
    await search().fill('01'); const ids = await page.locator('[data-cf-account-id]').evaluateAll(nodes => nodes.map(n => n.dataset.cfAccountId));
    await style('design'); await style('data');
    assert.equal(await search().inputValue(), '01');
    assert.deepEqual(await page.locator('[data-cf-account-id]').evaluateAll(nodes => nodes.map(n => n.dataset.cfAccountId)), ids);
    await search().fill('');
  });
  await check('查重/日志不显示无效开关，助力标题不再被孤立切换占行', async () => {
    await navigate('assist'); await style('cards');
    assert.equal(await page.locator('.page-view-toggle').count(), 0);
    await search().fill('example-0'); assert.equal(await page.locator('main input[type=search]').count(), 0);
    await search().fill('');
    await navigate('register'); assert.equal(await styleGroup().count(), 0);
    assert.equal(await page.getByRole('region', { name: '短域名发现', exact: true }).count(), 0);
    await navigate('logs'); assert.equal(await styleGroup().count(), 0);
    const before = report.requests.filter(r => r.path === '/api/logs').length;
    await page.getByRole('button', { name: '刷新运行日志', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="刷新运行日志"]')?.disabled);
    assert(report.requests.filter(r => r.path === '/api/logs').length > before);
  });
  await check('12页当前模式路由/正文身份和几何，不用截图名充当模式证据', async () => {
    for (const [key] of pages) {
      await navigate(key);
      const modes = ['register','logs','settings'].includes(key) ? [] : ['design','data',...(key==='cfquota'?[]:['cards'])];
      for (const mode of modes) {
        await style(mode); assert.equal(new URL(page.url()).hash, '#' + key);
        assert.equal(await page.locator('main').getAttribute('data-workspace'), key);
        assert(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 2));
        await shot(key + '-' + mode + '-1440-light.png');
      }
    }
  });
  await check('四视口浅深三态：顶栏/控件不越界，资产表头不悬空', async () => {
    await navigate('domains');
    for (const width of [390,768,1440,1920]) for (const dark of [false,true]) for (const mode of ['design','data','cards']) {
      await page.setViewportSize({width,height:width===390?844:1000});
      await page.evaluate(v => document.documentElement.classList.toggle('dark',v),dark);
      await style(mode);
      const dims=await page.evaluate(() => ({overflow:document.documentElement.scrollWidth-innerWidth,
        header:document.querySelector('header').scrollWidth-document.querySelector('header').clientWidth,
        controls:[...document.querySelector('header').querySelectorAll('button,input')].filter(el=>el.getClientRects().length&&!el.closest('.interface-style-switch')).map(el=>el.getBoundingClientRect().height)}));
      assert(dims.overflow<=2 && dims.header<=2, JSON.stringify({width,mode,dims}));
      assert(dims.controls.every(h=>Math.abs(h-40)<=1),JSON.stringify(dims));
      if (width === 390) {
        assert.equal(await page.locator('.interface-style-switch__segments').isVisible(), false, '移动端隐藏三段式画风控件');
        assert(await page.getByRole('button', { name: /切换界面画风/ }).isVisible(), '移动端保留单按钮画风切换');
        assert((await search().boundingBox())?.width >= 100, '移动端搜索框必须保留可用宽度');
      }
      if (width === 390 && mode === 'data') {
        const name = page.locator('[data-asset-record] .asset-domain-name').first();
        const style = await name.evaluate((el) => {
          const computed = getComputedStyle(el);
          return { whiteSpace: computed.whiteSpace, overflowWrap: computed.overflowWrap, textOverflow: computed.textOverflow };
        });
        assert.equal(style.whiteSpace, 'normal', JSON.stringify(style));
        assert.equal(style.textOverflow, 'clip', JSON.stringify(style));
      }
      if(mode==='data') assert(await page.locator('.asset-column-head').first().evaluate(el=>getComputedStyle(el).position!=='sticky'));
      if(!dark && [390,1440].includes(width)) await shot('domains-'+mode+'-'+width+'-light.png');
    }
  });
  await check('Cloudflare 移动数据风完整展示 Zone 名称，不强制省略', async () => {
    await navigate('cloudflare');
    await page.setViewportSize({ width: 390, height: 844 });
    await style('data');
    const name = page.locator('[data-asset-record] .asset-domain-name').first();
    assert(await name.isVisible());
    const computed = await name.evaluate((el) => {
      const s = getComputedStyle(el);
      return { whiteSpace: s.whiteSpace, textOverflow: s.textOverflow };
    });
    assert.equal(computed.whiteSpace, 'normal', JSON.stringify(computed));
    assert.equal(computed.textOverflow, 'clip', JSON.stringify(computed));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await style('data');
    const desktopComputed = await name.evaluate((el) => {
      const s = getComputedStyle(el);
      return { whiteSpace: s.whiteSpace, textOverflow: s.textOverflow, overflow: s.overflow };
    });
    assert.equal(desktopComputed.textOverflow, 'clip', JSON.stringify(desktopComputed));
  });
  await check('CF 用量移动设计风的 2×2 指标共享左右边缘', async () => {
    await navigate('cfquota');
    await page.setViewportSize({ width: 390, height: 844 });
    await style('design');
    const padding = await page.locator('.cf-design-capacity-rail > div').evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { left: style.paddingLeft, right: style.paddingRight };
    }));
    assert.equal(padding[0].left, padding[2].left, JSON.stringify(padding));
    assert.equal(padding[1].right, padding[3].right, JSON.stringify(padding));
  });
  await check('旧偏好迁移一次，非法值/存储受限仍可切换，无业务写入', async () => {
    for(const denied of [false,true]) {
      const other=await makePage('invalid-value',denied);
      await other.page.goto(new URL('/#domains',base).href,{waitUntil:'networkidle'});
      const group=other.page.getByRole('group',{name:'界面画风',exact:true});
      assert.equal(await group.getByRole('button',{name:'设计风',exact:true}).getAttribute('aria-pressed'),'true');
      await group.getByRole('button',{name:'卡片风',exact:true}).click();
      assert.equal(await other.page.locator('html').getAttribute('data-interface-style'),'cards');
      await other.context.close();
    }
    const other=await makePage('data');
    await other.context.addInitScript(()=>localStorage.setItem('DNSHE_DOMAIN_VIEW','cards'));
    await other.page.goto(new URL('/#domains',base).href,{waitUntil:'networkidle'});
    assert.equal(await other.page.locator('html').getAttribute('data-interface-style'),'cards');
    await other.page.getByRole('button',{name:'数据风',exact:true}).click();
    await other.page.reload({waitUntil:'networkidle'});
    assert.equal(await other.page.locator('html').getAttribute('data-interface-style'),'data');
    await other.context.close();
    assert.equal(report.pageErrors.length,0);
    assert(report.requests.every(r=>r.method==='GET'),'No login/backfill/business writes permitted');
  });
} finally {
  await browser.close(); report.sourceAfter=source(); report.sourceChanged=JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter);
  report.passed=report.tests.length===13&&report.tests.every(test=>test.passed)&&!report.sourceChanged&&!report.pageErrors.length;
  fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,'index.html'),'<meta charset="utf-8"><title>三种平级风格回归</title><style>body{font:15px system-ui;margin:24px;background:#eee}section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}img{width:100%}figure{margin:0;background:white}figcaption{padding:10px}</style><h1>本地当前构建 · 合成数据</h1><section>'+report.shots.map(s=>'<figure><a href="'+s.file+'"><img src="'+s.file+'" loading="lazy"></a><figcaption>'+s.file+' · '+s.width+'×'+s.height+'</figcaption></figure>').join('')+'</section>');
  console.log(JSON.stringify({passed:report.passed,tests:report.tests.length,out})); process.exitCode=report.passed?0:1;
}
