#!/usr/bin/env node
/** Production-only, headless, read-only UI acceptance. No local asset proxy.
 * node scripts/verify-production.mjs [--force-cf] [--quick]
 * --force-cf explicitly permits ONE GET /api/cf/quota?force=1.
 * --quick navigates only dashboard/domains/accounts/cfquota.
 * --plan / --self-test perform no network access and read no credentials.
 * REVIEW_SESSION_FILE may point to an existing outside-repository JSON {origin, session_token}.
 * A validated saved session avoids login and credential reads; tokens are never saved here.
 * Session, raw API bodies and credentials stay in memory; no HAR/trace/profile.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readReviewSession, validateReviewSession } from './review-session.mjs';

const HERE = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(HERE), '..');
const ROOT = path.dirname(REPO);
const ORIGIN = process.env.REVIEW_ORIGIN || 'https://shydns.cc.cd';
assert(['https://shydns.cc.cd', 'https://1.shydns.cc.cd', 'https://2.shydns.cc.cd', 'https://3.shydns.cc.cd'].includes(ORIGIN), 'Only explicitly scoped DNSHE instances are allowed.');
const MARKER = 'production-review-memory-session-not-a-real-token';
const PAGES = [['dashboard', '概览'], ['domains', '域名列表'], ['cloudflare', 'Cloudflare'],
  ['assist', '域名助力'], ['accounts', '账号管理'], ['apikeys', 'API 密钥'],
  ['register', '注册 / 查重'], ['quota', '账户配额'], ['ddns', '动态 DNS'],
  ['cfquota', 'CF 免费额度'], ['logs', '运行日志'], ['settings', '设置']];
const READS = new Set(['/api/auth/status', '/api/auth/account', '/api/accounts', '/api/domains',
  '/api/overview', '/api/logs', '/api/settings', '/api/quota', '/api/ddns', '/api/cf/quota',
  '/api/assist/status', '/api/keys', '/api/expiry', '/api/dns/ns']);
const SENSITIVE = /(?:api[_-]?key|api[_-]?secret|password|passwd|secret|token|authorization|cookie|smtp[_-]?(?:pass|user)|admin[_-]?username|^username$)/i;
const args = new Set(process.argv.slice(2));
for (const value of args) if (!['--force-cf', '--quick', '--self-test', '--plan'].includes(value)) throw new Error('Unknown option.');
const forceEnabled = args.has('--force-cf');
const navigation = args.has('--quick') ? PAGES.filter(([key]) => ['dashboard', 'domains', 'accounts', 'cfquota'].includes(key)) : PAGES;
const STYLE_LABELS = { design: '设计风', data: '数据风', cards: '卡片风' };
const CARD_PAGES = new Set(['dashboard', 'domains', 'cloudflare', 'assist', 'accounts', 'apikeys', 'quota', 'ddns']);
const COMMON_PAGES = new Set(['register', 'logs', 'settings']);
const headerStyles = key => COMMON_PAGES.has(key) ? [] : CARD_PAGES.has(key) ? ['design', 'data', 'cards'] : ['design', 'data'];

function decision(raw, method, forceReads = 0) {
  const url = new URL(raw);
  if (url.origin !== ORIGIN) return 'external-origin';
  if (method !== 'GET') return 'business-write-blocked';
  if (!READS.has(url.pathname) && !/^\/api\/domains\/\d+\/dns$/.test(url.pathname)) return 'read-not-allowlisted';
  if (url.searchParams.has('force') || url.searchParams.has('refresh')) {
    return forceEnabled && forceReads === 0 && url.pathname === '/api/cf/quota' && url.search === '?force=1'
      ? 'force-cf' : 'forced-refresh-blocked';
  }
  return 'read';
}

function redact(value, secrets) {
  const mask = text => '•'.repeat(text.length);
  const visit = (node, key = '') => {
    if (Array.isArray(node)) return node.map(item => visit(item, key));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, visit(v, k)]));
    if (typeof node !== 'string') return node;
    if (SENSITIVE.test(key)) { if (node.length >= 4) secrets.add(node); return mask(node); }
    return node;
  };
  const scrub = node => {
    if (Array.isArray(node)) return node.map(scrub);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, scrub(v)]));
    if (typeof node !== 'string') return node;
    for (const secret of secrets) if (secret.length >= 4) node = node.split(secret).join(mask(secret));
    return node.replace(/Bearer\s+[^\s"'<>]+/gi, match => mask(match));
  };
  return scrub(visit(value));
}

if (args.has('--self-test')) {
  assert.equal(decision(`${ORIGIN}/api/domains/sync`, 'POST'), 'business-write-blocked');
  assert.equal(decision(`${ORIGIN}/api/keys/backfill`, 'POST'), 'business-write-blocked');
  assert.equal(decision(`${ORIGIN}/api/auth/logout`, 'GET'), 'read-not-allowlisted');
  assert.equal(decision('https://example.org/api/accounts', 'GET'), 'external-origin');
  assert.equal(decision(`${ORIGIN}/api/domains/1/dns`, 'GET'), 'read');
  assert.equal(decision(`${ORIGIN}/api/domains?refresh=1`, 'GET'), 'forced-refresh-blocked');
  assert.equal(decision(`${ORIGIN}/api/cf/quota?force=1`, 'GET', 1), 'forced-refresh-blocked');
  assert.equal(decision(`${ORIGIN}/api/cf/quota?force=1`, 'GET'), forceEnabled ? 'force-cf' : 'forced-refresh-blocked');
  assert.equal(navigation.length, args.has('--quick') ? 4 : 12);
  if (args.has('--quick')) assert(!navigation.some(([key]) => key === 'apikeys'));
  assert.deepEqual(headerStyles('domains'), ['design', 'data', 'cards']);
  assert.deepEqual(headerStyles('ddns'), ['design', 'data', 'cards']);
  assert.deepEqual(headerStyles('cfquota'), ['design', 'data']);
  for (const key of ['register', 'logs', 'settings']) assert.deepEqual(headerStyles(key), []);
  const secret = 'private-contract-test-only';
  const safe = redact({ api_key: secret, note: `text ${secret}`, nested: { has_secret: true } }, new Set());
  assert.equal(safe.api_key.length, secret.length); assert(!JSON.stringify(safe).includes(secret));
  assert.equal(safe.nested.has_secret, true);
  console.log('PASS production policy and equal-length redaction (offline).');
  process.exit(0);
}
if (args.has('--plan')) {
  console.log(JSON.stringify({ origin: ORIGIN, headless: true, forceCfOnce: forceEnabled,
    pages: navigation.map(([key]) => key), screenshots: 'supported peer design/data/cards modes; common pages once + targeted CF/mobile/dark',
    headerModes: Object.fromEntries(navigation.map(([key]) => [key, headerStyles(key)])),
    businessWrites: 'blocked', realSessionInPage: false, persistedSession: false, preferValidatedSessionFile: true, loginBudget: '0 when reused, otherwise at most 1' }, null, 2));
  process.exit(0);
}

const runName = `${ORIGIN === 'https://shydns.cc.cd' ? 'production' : `preview${new URL(ORIGIN).hostname.split('.')[0]}`}-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const out = path.join(ROOT, 'shots', 'takeover-current', runName);
fs.mkdirSync(out, { recursive: true });
let credentials;
const savedSession = readReviewSession(REPO, ORIGIN);
const secrets = new Set([savedSession, process.env.REVIEW_TOTP || ''].filter(Boolean));
const clean = value => redact(value, secrets);
let head = 'unknown';
try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', windowsHide: true }).trim(); } catch {}
const report = { startedAt: new Date().toISOString(), origin: ORIGIN, localSourceHead: head,
  harnessSha256: crypto.createHash('sha256').update(fs.readFileSync(HERE)).digest('hex'),
  policy: { headless: true, productionAssets: true, atMostOneLogin: true, preferExistingSession: true, realTokenKeptOutsidePage: true,
    apiSecretsMaskedBeforeRendering: true, forceCfExplicitlyEnabled: forceEnabled, noHarTraceOrStorageState: true,
    navigationPages: navigation.map(([key]) => key), transportRetries: 'one ECONNRESET retry for normal GET; none for login/CF force', encoding: 'identity' },
  loginAttempts: 0, sessionReused: false, forceReads: 0, screenshots: [], checks: [], network: [], blocked: [], console: [],
  pageErrors: [], failures: [], assets: [], cfDiagnostics: [] };
const cache = new Map();
let token = '', browser, context, page, active = 'startup', pending = 0, touched = Date.now();
const proxy = process.env.REVIEW_PROXY === 'none' ? undefined : { server: process.env.REVIEW_PROXY || 'http://127.0.0.1:7890' };
const check = (name, passed, details = {}) => {
  const entry = { page: active, name, passed: !!passed, ...details }; report.checks.push(entry);
  if (!passed) report.failures.push(entry);
};
const summarizeCf = (body, elapsedMs, forced) => ({ elapsedMs, forced, generatedAt: body.generated_at || null,
  success: body.success === true, refreshError: !!body.refresh_error,
  accounts: (body.accounts || []).map((account, index) => ({ ordinal: index + 1, error: !!account.error,
    readable: Object.fromEntries(['workers', 'd1', 'kv', 'r2_ops', 'r2_storage'].map(key => [key, account.traffic?.[key] !== null && account.traffic?.[key] !== undefined])),
    freshReadable: Object.fromEntries(['workers', 'd1', 'kv', 'r2_ops', 'r2_storage'].map(key => [key, account.traffic?.[key] !== null && account.traffic?.[key] !== undefined && !account.traffic?.issues?.[key]])),
    workersDays: account.traffic?.workers?.length ?? null, d1Days: account.traffic?.d1?.length ?? null,
    issueKinds: Object.fromEntries(Object.entries(account.traffic?.issues || {}).map(([key, issue]) => [key, { kind: issue.kind, cached: !!issue.cached_at }])),
    inventoryIssueKinds: Object.fromEntries(Object.entries(account.inventory_issues || {}).map(([key, issue]) => [key, { kind: issue.kind, cached: !!issue.cached_at }])) })) });

async function settle() {
  await page.locator('main').waitFor({ state: 'visible', timeout: 45_000 });
  const began = Date.now();
  while (Date.now() - began < 48_000 && (pending || Date.now() - touched < 350)) await page.waitForTimeout(100);
  if (pending) throw new Error('API did not settle within 48 seconds.');
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(180);
}
async function style(value) {
  const group = page.locator('header').getByRole('group', { name: '界面画风', exact: true });
  const button = group.getByRole('button', { name: STYLE_LABELS[value], exact: true });
  await button.click();
  await page.waitForFunction(v => document.documentElement.dataset.interfaceStyle === v, value); await settle();
  check('header-selected-peer-style', await button.getAttribute('aria-pressed') === 'true' && await group.getByRole('button', { pressed: true }).count() === 1, { style: value });
}
async function navigate(key) {
  active = key;
  if (new URL(page.url()).hash !== `#${key}`) {
    const menu = page.locator('button[aria-controls="app-nav-panel"]');
    if (page.viewportSize().width < 768 && await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
    const label = PAGES.find(([id]) => id === key)[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.locator('#app-nav-panel nav button').filter({ hasText: new RegExp(`^\\s*${label}(?:\\s*\\d+)?\\s*$`) }).click();
  }
  await page.locator(`main[data-workspace="${key}"]`).waitFor(); await settle();
  check(`route-${key}`, new URL(page.url()).hash === `#${key}`);
  await page.locator('main').evaluate(node => { node.scrollTop = 0; });
}
async function screenshot(label) {
  const viewport = page.viewportSize();
  const state = await page.evaluate(() => ({ theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', style: document.documentElement.dataset.interfaceStyle,
    documentOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    mainOverflow: Math.max(0, (document.querySelector('main')?.scrollWidth || 0) - (document.querySelector('main')?.clientWidth || 0)) }));
  const file = `${String(report.screenshots.length + 1).padStart(2, '0')}-${active}-${state.theme}-${state.style}-${viewport.width}-${label}.png`;
  const bytes = await page.screenshot({ path: path.join(out, file), animations: 'disabled', mask: [page.locator('input[type=password],input[autocomplete=one-time-code],[data-sensitive]')], maskColor: state.theme === 'dark' ? '#3f3f46' : '#d4d4d8' });
  const dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  report.screenshots.push({ file, page: active, ...state, dimensions });
  check('png-dimensions', dimensions.width === viewport.width && dimensions.height === viewport.height);
  check('document-horizontal-overflow', state.documentOverflow <= 2, { px: state.documentOverflow, file });
  // main may intentionally contain an inner horizontally scrollable table; record, do not hide it.
}
async function tooltip(label) {
  const hit = page.locator('[data-column-chart] [data-chart-hit]').first();
  check('cf-seven-date-hit-regions', await page.locator('[data-column-chart] [data-chart-hit]').count() === 7);
  if (await hit.count()) {
    await hit.hover(); check('cf-tooltip', await page.locator('[data-chart-tooltip]').count() === 1);
    await screenshot(label); await page.mouse.move(1, 1); await page.keyboard.press('Escape');
  }
}

function save() {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(clean(report), null, 2));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cards = report.screenshots.map(shot => `<figure><a href="${esc(shot.file)}"><img loading="lazy" src="${esc(shot.file)}"></a><figcaption>${esc(shot.file)}<br>${shot.dimensions.width} × ${shot.dimensions.height}</figcaption></figure>`).join('');
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DNSHE 生产只读验收</title><style>body{font:14px system-ui;margin:24px;color:#18181b;background:#f4f4f5}h1{font-size:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}figure{margin:0;background:white;border:1px solid #d4d4d8}img{width:100%;display:block}figcaption{padding:10px;overflow-wrap:anywhere;line-height:1.6}</style><h1>生产只读验收</h1><p>真实生产前后端 · 后台无可见窗口 · 一次登录 · 密钥等长遮罩 · 非登录业务写操作已阻断。</p><p>这不是生产写入功能验收，也不替代截图人工审美检查。${report.screenshots.length} 张截图，${report.failures.length} 项失败；<a href="audit.json">完整审计</a>。</p><main>${cards}</main></html>`);
}

try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true, ...(proxy ? { proxy } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
    colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false });
  // Existing explicit session is validated with GET before credentials are read.
  // The real session never enters a page or a response supplied to it.
  if (savedSession && await validateReviewSession(context.request, ORIGIN, savedSession)) {
    token = savedSession; report.sessionReused = true;
  } else {
    try { credentials = JSON.parse(fs.readFileSync(path.join(ROOT, 'credentials.json'), 'utf8')).shydns_console; }
    catch { throw new Error('Cannot read login configuration; contents suppressed.'); }
    if (!credentials?.ADMIN_USERNAME || !credentials?.ADMIN_PASSWORD) throw new Error('Missing login configuration.');
    secrets.add(credentials.ADMIN_USERNAME); secrets.add(credentials.ADMIN_PASSWORD);
    report.loginAttempts++;
    const login = await context.request.post(`${ORIGIN}/api/auth/login`, { data: { username: credentials.ADMIN_USERNAME, password: credentials.ADMIN_PASSWORD,
      ...(process.env.REVIEW_TOTP ? { token: process.env.REVIEW_TOTP } : {}) }, timeout: 45_000, maxRedirects: 0, maxRetries: 0 });
    const loginBody = await login.json();
    if (!loginBody.success || typeof loginBody.session_token !== 'string') throw new Error(`Unique login failed (HTTP ${login.status()}); not retried.`);
    token = loginBody.session_token; secrets.add(token); credentials = undefined; await login.dispose();
  }
  await context.addInitScript(({ origin, session }) => { if (location.origin !== origin) return;
    if (!localStorage.getItem('DNSHE_THEME')) localStorage.setItem('DNSHE_THEME', 'light');
    if (!localStorage.getItem('DNSHE_INTERFACE_STYLE')) localStorage.setItem('DNSHE_INTERFACE_STYLE', 'design');
    localStorage.setItem('DNSHE_BACKEND_URL', '/'); localStorage.setItem('DNSHE_SIDEBAR_COLLAPSED', '0'); sessionStorage.setItem('DNSHE_SESSION', session);
  }, { origin: ORIGIN, session: MARKER });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    const meta = { page: active, path: url.pathname, queryKeys: [...url.searchParams.keys()], method };
    if (!url.pathname.startsWith('/api/')) {
      if (url.origin === ORIGIN && method === 'GET') return route.continue();
      report.blocked.push({ ...meta, reason: 'external-or-write-resource' }); return route.abort('blockedbyclient');
    }
    const policy = decision(url.href, method, report.forceReads);
    if (!['read', 'force-cf'].includes(policy)) {
      report.blocked.push({ ...meta, reason: policy });
      return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ success: false, error_code: 'production_review_read_only', message: '只读验收已阻止此操作，未向生产发送。' }) });
    }
    if (policy === 'force-cf') report.forceReads++;
    const key = url.pathname + url.search;
    let cachedRead;
    pending++; touched = Date.now();
    try {
      if (url.pathname !== '/api/auth/status' && await request.headerValue('authorization') !== `Bearer ${MARKER}`) throw new Error('Unexpected page authorization; request refused.');
      const began = Date.now();
      const read = async () => {
        const response = await route.fetch({ headers: { accept: 'application/json', 'accept-encoding': 'identity', authorization: `Bearer ${token}`, origin: ORIGIN }, timeout: 45_000, maxRedirects: 0, maxRetries: policy === 'force-cf' ? 0 : 1 });
        const status = response.status();
        if (status >= 300 && status < 400) throw new Error('API redirect refused.');
        if (!/application\/json/i.test(response.headers()['content-type'] || '')) throw new Error(`API returned non-JSON (HTTP ${status}).`);
        const body = await response.json();
        if (url.pathname === '/api/cf/quota') report.cfDiagnostics.push(summarizeCf(body, Date.now() - began, policy === 'force-cf'));
        const result = { status, body: clean(body) }; await response.dispose(); return result;
      };
      const cached = cache.has(key);
      if (!cached) cache.set(key, read());
      cachedRead = cache.get(key);
      const result = await cachedRead;
      if (policy === 'force-cf') cache.set('/api/cf/quota', Promise.resolve(result));
      report.network.push({ ...meta, status: result.status, elapsedMs: Date.now() - began, source: cached ? 'memory-cache-of-production' : 'production' });
      if (result.status >= 400) report.failures.push({ ...meta, issue: 'api-http', status: result.status });
      return route.fulfill({ status: result.status, contentType: 'application/json; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(result.body) });
    } catch (error) {
      if (cache.get(key) === cachedRead) cache.delete(key);
      report.failures.push({ ...meta, issue: 'api-fetch', message: clean(String(error.message).split(/\r?\n/, 1)[0]) });
      return route.fulfill({ status: 502, contentType: 'application/json', body: '{"success":false,"message":"只读验收请求失败，未重试"}' });
    } finally { pending--; touched = Date.now(); }
  });
  await context.routeWebSocket(/.*/, socket => { report.blocked.push({ method: 'WEBSOCKET', reason: 'websocket-blocked' }); socket.close(); });
  page = await context.newPage(); page.setDefaultTimeout(15_000);
  page.on('dialog', dialog => void dialog.dismiss());
  context.on('page', popup => { if (popup !== page) void popup.close(); });
  page.on('pageerror', error => report.pageErrors.push({ page: active, message: clean(String(error.message).split(/\r?\n/, 1)[0]) }));
  page.on('console', message => { if (!['error', 'warning'].includes(message.type())) return;
    let pathname = ''; try { pathname = new URL(message.location().url).pathname; } catch {}
    report.console.push({ page: active, type: message.type(), path: pathname, policyBlocked: report.blocked.some(item => item.path === pathname), message: clean(message.text()).slice(0, 1000) }); });
  page.on('response', response => { const url = new URL(response.url()); if (url.origin === ORIGIN && url.pathname.startsWith('/assets/') && !report.assets.some(item => item.path === url.pathname)) report.assets.push({ path: url.pathname, status: response.status() }); });
  await page.goto(`${ORIGIN}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await settle();
  for (const [key] of navigation) {
    await navigate(key);
    if (key === 'cfquota' && forceEnabled) {
      await page.locator('.cf-quota-workspace').getByRole('button', { name: '刷新', exact: true }).click(); await settle();
      check('one-explicit-cf-force-read', report.forceReads === 1);
      const forced = report.cfDiagnostics.find(entry => entry.forced);
      check('cf-collector-not-global-network-failure', !!forced?.success && forced.accounts.every(account =>
        !['workers', 'd1', 'kv', 'r2_ops'].every(key => account.issueKinds[key]?.kind === 'network')));
    }
    const modes = headerStyles(key);
    const group = page.locator('header').getByRole('group', { name: '界面画风', exact: true });
    check('header-mode-contract', await group.count() === (modes.length ? 1 : 0), { supported: modes });
    check('no-nested-page-view-toggle', await page.locator('main .page-view-toggle').count() === 0);
    if (!modes.length) {
      check('common-workspace-no-header-style-toggle', await group.count() === 0);
      await screenshot('unified-top');
    } else {
      check('header-mode-count', await group.getByRole('button').count() === modes.length, { supported: modes });
      for (const value of modes) {
        await style(value); await screenshot('top');
        check('peer-style-retains-route', new URL(page.url()).hash === `#${key}` && await page.locator(`main[data-workspace="${key}"]`).count() === 1, { style: value });
      }
    }
    check('route-retains-session', await page.locator(`main[data-workspace="${key}"]`).count() === 1 && await page.evaluate(() => !!sessionStorage.getItem('DNSHE_SESSION')));
  }
  await navigate('cfquota'); await style('data');
  const accountRow = page.locator('.cf-account-desktop [data-cf-account-id]').first();
  if (await accountRow.count()) {
    await accountRow.locator('td').first().click();
    check('cf-row-opens-own-adjacent-detail', await accountRow.evaluate(node => node.getAttribute('aria-expanded') === 'true' && node.nextElementSibling?.classList.contains('cf-account-detail-row')));
    await screenshot('adjacent-account-detail');
    await page.keyboard.press('Escape');
    check('cf-escape-closes-detail', await page.locator('.cf-account-desktop .cf-account-detail-row').count() === 0);
  }
  await tooltip('tooltip');
  const scope = page.getByRole('combobox', { name: '账号范围', exact: true });
  const options = await scope.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
  if (options.length > 1) { await scope.selectOption(options[1]); await settle(); await screenshot('single-account'); await scope.selectOption('all'); await settle(); }
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate('cfquota'); await style('data'); await screenshot('mobile');
  await page.setViewportSize({ width: 1440, height: 1000 }); await navigate('cfquota');
  // Isolated context preference only; reload observes the deployed app's real theme boot path.
  await page.evaluate(() => { localStorage.setItem('DNSHE_THEME', 'dark'); localStorage.setItem('DNSHE_INTERFACE_STYLE', 'data'); });
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
  check('dark-theme', await page.locator('html').evaluate(node => node.classList.contains('dark'))); await style('data'); await screenshot('dark-top'); await tooltip('dark-tooltip');
  check('no-page-js-errors', report.pageErrors.length === 0);
  check('at-most-one-login', report.loginAttempts === (report.sessionReused ? 0 : 1));
  check('force-read-budget', report.forceReads === (forceEnabled ? 1 : 0));
  check('production-static-assets-loaded', report.assets.length >= 2 && report.assets.every(item => item.status === 200));
} catch (error) { report.failures.push({ page: active, issue: 'run', message: clean(String(error.message).split(/\r?\n/, 1)[0]) }); }
finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  save(); token = ''; credentials = undefined; cache.clear(); secrets.clear();
}
console.log(JSON.stringify({ evidence: out, screenshots: report.screenshots.length, failures: report.failures.length,
  pageErrors: report.pageErrors.length, loginAttempts: report.loginAttempts, forceReads: report.forceReads }));
if (report.failures.length) process.exitCode = 1;
