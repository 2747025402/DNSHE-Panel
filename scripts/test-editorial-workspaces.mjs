#!/usr/bin/env node
/** Component boundary regression: synthetic data, in-memory build, no server/network or foreground input. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(repo, '../shots/takeover-current', `editorial-modules-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const tracked = ['frontend/src/EditorialViews.tsx', 'frontend/src/editorial-workspace.css', 'frontend/src/interface-style.css', 'frontend/src/DomainPresentation.ts', 'frontend/src/PageSearch.tsx'];
const source = () => Object.fromEntries(tracked.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const code = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorialDomainAtlas, EditorialZoneConstellation, EditorialAccountSwitchboard, EditorialQuotaPressure, EditorialKeyLedger } from './src/EditorialViews.tsx';
import { PageSearchContext } from './src/PageSearch.tsx';
const make = (n = 20) => Array.from({ length: n }, (_, i) => ({
  accountId: i + 1, alias: '账号 ' + String(i + 1).padStart(3, '0') + ' / 长名称示例',
  domains: Array.from({ length: 25 }, (_, j) => ({
    id: i * 100 + j + 1, full_domain: 'domain-' + (i + 1) + '-' + j + '.example.invalid',
    status: j === 2 ? 'expired' : ['已解析', '未解析', '已委派'][j % 3], has_dns: j % 2,
    provider_account_id: j === 0 ? 'synthetic-cf-account' : null,
    created_at: '2026-10-01', expires_at: '2027-10-01', ns1: 'a.example.invalid', ns2: 'b.example.invalid',
  })),
}));
const accounts = (n = 20) => make(n).map(g => ({ id: g.accountId, alias: g.alias, api_key: 'synthetic-not-a-key', created_at: '2026-10-01' }));
function Harness() {
  const [view, setView] = useState('quota'), [scale, setScale] = useState(20);
  const [queries, setQueries] = useState({});
  const query = queries[view] || '', setQuery = value => setQueries(previous => ({ ...previous, [view]: value }));
  const [selected, setSelected] = useState(null), [selectedKey, setSelectedKey] = useState(null);
  const [removedKey, setRemovedKey] = useState(null), [controlled, setControlled] = useState(null), [zeroTotal, setZeroTotal] = useState(false);
  window.choose = (v, n = 20) => { setView(v); setScale(n); setSelected(null); setSelectedKey(null); setRemovedKey(null); setControlled(null); setZeroTotal(false); };
  window.removeSelected = () => setRemovedKey(selectedKey);
  window.setZeroQuota = () => setZeroTotal(true);
  window.setCollapsed = ids => setControlled(new Set(ids));
  const control = controlled === null ? {} : {
    collapsedAccounts: controlled,
    onToggleAccount: id => setControlled(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }),
  };
  const groups = make(scale).map(g => view !== 'zone' ? g : g.accountId === 3 ? { ...g, domains: [], error: '合成读取失败，Zone 数量未知' } : { ...g, domains: g.domains.map((d, i) => ({ ...d, status: i === 2 ? 'pending' : 'active', ...(i === 0 ? { ns1: null, ns2: null } : {}) })) });
  const keys = groups.map(g => ({ account_id: g.accountId, alias: g.alias, keys: Array.from({ length: 3 }, (_, j) => ({
    key_id: g.accountId * 10 + j, key_name: 'Key ' + g.accountId + '-' + j, api_key: 'synthetic-key-' + g.accountId + '-' + j,
    status: 'active', request_count: j === 2 ? null : j * 130, last_used_at: j === 2 ? null : '2026-10-17 12:20', has_secret: j !== 2,
  })).filter(k => k.api_key !== removedKey) }));
  const quotas = groups.map((g, i) => ({ account_id: g.accountId, alias: g.alias, used: i === 0 ? 110 : i === 1 ? 0 : i * 3,
    total: zeroTotal && i === 3 ? 0 : 100, available: i === 0 ? -10 : i === 1 ? 100 : 100 - i * 3, base: 80, invite_bonus: 20,
    error: i === 2 ? '合成读取失败' : undefined,
  }));
  const inspect = item => { window.events.dns = item.id; };
  const closeKey = () => { window.events.closed++; setSelectedKey(null); };
  return <PageSearchContext.Provider value={{ query, setQuery }}><input type="search" aria-label="工作面搜索" value={query} onChange={event => setQuery(event.target.value)} />{view === 'domain' ? <EditorialDomainAtlas groups={groups} selected={selected} onSelect={setSelected} onClose={() => setSelected(null)} onDns={inspect} {...control} />
    : view === 'zone' ? <EditorialZoneConstellation groups={groups} selected={selected} onSelect={setSelected} onClose={() => setSelected(null)} onDns={inspect} onPropagation={item => { window.events.propagation = item.id; }} />
    : view === 'account' ? <EditorialAccountSwitchboard dnshe={accounts(scale)} cloudflare={accounts(scale).map(a => ({ ...a, id: a.id + 10000 }))}
      usageByAccount={{ 1: { domains: 0, readState: 'readable', readLabel: '配额快照可读' }, 2: { readState: 'error', readLabel: '权限受限' } }}
      onBindDnshe={() => window.events.bind = 'dnshe'} onBindCf={() => window.events.bind = 'cf'} onDnsheEdit={() => {}} onDnsheDelete={() => {}} onCfEdit={() => {}} onCfDelete={() => {}} />
    : view === 'key' ? <><EditorialKeyLedger groups={keys} onCreate={() => {}} selectedKey={selectedKey} onClose={closeKey}
      onInspect={k => { window.events.inspects++; setSelectedKey(k.api_key); }}
      renderKey={k => <button className="ew-quiet-button" onClick={() => window.events.revoked = k.api_key}>撤销</button>} />
      {selectedKey && <div data-testid="inspector">{selectedKey}</div>}</>
    : <EditorialQuotaPressure quotas={quotas} />}</PageSearchContext.Provider>;
}
window.events = { closed: 0, inspects: 0 };
createRoot(document.getElementById('root')).render(<Harness />);
`;
const bundle = await build({
  stdin: { contents: code, loader: 'tsx', resolveDir: path.join(repo, 'frontend') },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(5000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => route.abort());
const report = { synthetic: true, boundary: 'Standalone components; not full App or external account verification.', sourceBefore: source(), tests: [], shots: [], errors };
const baseCss = `
:root { --text-primary:#18181b; --text-secondary:#3f3f46; --text-muted:#71717a; --border-base:#e4e4e7; --border-soft:#eeeeef; --bg-surface:#fff; --bg-elevated:#f4f4f5; }
.dark { --text-primary:#fafafa; --text-secondary:#d4d4d8; --text-muted:#a1a1aa; --border-base:#3f3f46; --border-soft:#27272a; --bg-surface:#18181b; --bg-elevated:#27272a; }
body { margin:0; padding:28px; background:#f7f7f8; font:14px Arial,sans-serif; }
html.dark body { background:#101012; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
`;
// Deliberately load legacy CSS last to catch equal-specificity responsive collisions.
await page.setContent(`<style>${baseCss}</style><style>${fs.readFileSync(path.join(repo, tracked[1]), 'utf8')}</style><style>${fs.readFileSync(path.join(repo, tracked[2]), 'utf8')}</style><div id="root"></div>`);
await page.addScriptTag({ content: bundle.outputFiles[0].text });
async function test(name, fn) {
  try { await fn(); report.tests.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { report.tests.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function choose(view, count = 20) {
  await page.evaluate(([view, count]) => window.choose(view, count), [view, count]);
  await page.waitForTimeout(240);
}
try {
  await test('配额110%保真、0值、未知优先、真实详情与排序', async () => {
    await choose('quota');
    const rows = page.locator('.ew-pressure-select');
    assert((await rows.first().innerText()).includes('账号 003'));
    const over = rows.filter({ hasText: '账号 001' });
    assert.equal(await over.locator('.ew-pressure-number strong').innerText(), '110%');
    assert.equal(await over.locator('i').evaluate(element => element.style.width), '100%');
    await over.click();
    assert.equal(await page.locator('.ew-quota-detail dt', { hasText: '基础额度' }).count(), 1);
    assert((await page.locator('.ew-quota-detail').innerText()).includes('80'));
    await page.getByLabel('配额排序').selectOption('available');
    assert((await rows.first().innerText()).includes('账号 002'));
    assert.equal(await rows.first().locator('.ew-pressure-number strong').innerText(), '0%');
    await page.getByLabel('配额排序').selectOption('name');
    assert((await rows.first().innerText()).includes('账号 001'));
  });
  await test('Key整行选择、内部动作隔离、过滤和删除清理检查器', async () => {
    await choose('key');
    await page.locator('.ew-key-row').first().click();
    assert.equal(await page.getByTestId('inspector').count(), 1);
    const count = await page.evaluate(() => window.events.inspects);
    await page.getByRole('button', { name: '撤销', exact: true }).first().click();
    assert.equal(await page.evaluate(() => window.events.inspects), count);
    assert((await page.locator('.ew-key-row').nth(2).innerText()).includes('未返回'));
    assert(!(await page.locator('.ew-key-row').nth(2).innerText()).includes('从未使用'));
    await page.getByRole('searchbox').fill('no-matching-key');
    await page.getByTestId('inspector').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('inspector').count(), 0);
    await page.getByRole('searchbox').fill('');
    await page.locator('.ew-key-row').first().focus();
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.removeSelected());
    await page.getByTestId('inspector').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('inspector').count(), 0);
    assert((await page.evaluate(() => window.events.closed)) >= 2);
    assert.equal(await page.locator('.ew-key-row').count(), 2);
  });
  await test('本地资产筛选失配后清理检查器', async () => {
    await choose('domain');
    await page.locator('.ew-object-row').first().click();
    await page.locator('.ew-inspector').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.ew-inspector').count(), 1);
    await page.getByRole('searchbox').fill('domain-20-24');
    await page.waitForTimeout(220);
    assert.equal(await page.locator('.ew-inspector').count(), 0);
    assert.equal(await page.locator('.ew-object-row').count(), 1);
  });
  await test('100账号2500对象分页、末对象定位、旧动作及Esc归焦', async () => {
    await choose('domain', 100);
    // Local query correctly persists when only the dataset size changes.
    await page.getByRole('searchbox').fill('');
    assert.equal(await page.locator('.ew-asset-group').count(), 12);
    assert.equal(await page.locator('.ew-group-toggle[aria-expanded=true]').count(), 1);
    await page.locator('nav[aria-label="账号分页"]').getByRole('button', { name: '下一页' }).click();
    assert((await page.locator('.ew-asset-group').first().innerText()).includes('账号 013'));
    await page.getByRole('searchbox').fill('domain-100-24');
    const row = page.locator('.ew-object-row');
    await row.click();
    await page.locator('.ew-inspector').waitFor({ state: 'attached' });
    await page.waitForTimeout(220);
    assert((await page.locator('.ew-inspector').innerText()).includes('domain-100-24'));
    await page.getByRole('button', { name: 'DNS 解析', exact: true }).click();
    assert.equal(await page.evaluate(() => window.events.dns), 9925);
    await page.keyboard.press('Escape');
    await page.locator('.ew-inspector').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.ew-inspector').count(), 0);
    assert(await row.evaluate(element => element === document.activeElement));
  });
  await test('受控账号折叠不覆盖用户偏好', async () => {
    await page.getByRole('searchbox').fill('');
    await page.evaluate(() => window.setCollapsed(Array.from({ length: 100 }, (_, i) => i + 1)));
    await page.waitForTimeout(60);
    assert.equal(await page.locator('.ew-group-toggle[aria-expanded=true]').count(), 0);
    await page.locator('.ew-group-toggle').first().click();
    await page.waitForTimeout(60);
    assert.equal(await page.locator('.ew-group-toggle[aria-expanded=true]').count(), 1);
    await page.evaluate(() => window.setCollapsed([]));
    await page.waitForTimeout(60);
    assert.equal(await page.locator('.ew-group-toggle[aria-expanded=true]').count(), 12);
  });
  await test('Zone按需详情与双绑定实际回调', async () => {
    await choose('zone');
    assert.equal(await page.locator('.ew-inspector').count(), 0);
    await page.locator('.ew-object-row').first().click();
    await page.locator('.ew-inspector').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.ew-inspector').count(), 1);
    await page.getByRole('button', { name: '关闭 Zone 详情', exact: true }).click();
    await page.waitForTimeout(220);
    assert.equal(await page.locator('.ew-inspector').count(), 0);
    await choose('account');
    await page.getByRole('button', { name: '＋ 绑定 DNSHE 账号', exact: true }).click();
    assert.equal(await page.evaluate(() => window.events.bind), 'dnshe');
    await page.getByRole('button', { name: '＋ 绑定 Cloudflare 账号', exact: true }).click();
    assert.equal(await page.evaluate(() => window.events.bind), 'cf');
    assert(!(await page.locator('.ew-connection-meta').first().innerText()).includes('验证'));
    assert.equal(await page.locator('.ew-connection-group').first().locator('.ew-connection-row').count(), 12);
  });
  await test('Zone缺失NS、失败账号与就近详情不伪造零', async () => {
    await choose('zone');
    await page.getByLabel('Zone 状态筛选').selectOption('failed');
    const failed = page.locator('.ew-zone-group');
    assert.equal(await failed.count(), 1);
    assert((await failed.innerText()).includes('Zone 数量未知'));
    assert(!(await failed.locator('.ew-group-toggle').innerText()).includes('0 个 Zone'));
    await page.getByLabel('Zone 状态筛选').selectOption('ns');
    const row = page.locator('.ew-object-row').first();
    assert((await row.innerText()).includes('未返回'));
    await row.click();
    const detail = page.getByLabel('Cloudflare Zone 检查器', { exact: true });
    await detail.waitFor({ state: 'attached' });
    assert.equal(await detail.evaluate(element => getComputedStyle(element).position), 'fixed');
    assert((await detail.innerText()).includes('名称服务器 1 未返回'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(220);
    assert.equal(await detail.count(), 0);
    assert(await row.evaluate(element => element === document.activeElement));
  });
  await test('Zone控制台精确深链、无账号回退与原有DNS传播动作', async () => {
    await choose('zone');
    await page.getByRole('searchbox').fill('');
    await page.getByLabel('Zone 状态筛选').selectOption('all');
    const rows = page.locator('.ew-object-row');
    await rows.first().click();
    const detail = page.getByLabel('Cloudflare Zone 检查器', { exact: true });
    await detail.waitFor({ state: 'attached' });
    const consoleLink = detail.getByRole('link', { name: '控制台', exact: true });
    assert.equal(await consoleLink.count(), 1, '设计检查器必须保留真实控制台链接');
    assert.equal(await consoleLink.getAttribute('href'), 'https://dash.cloudflare.com/synthetic-cf-account/domain-1-0.example.invalid/dns/records');
    assert.equal(await consoleLink.getAttribute('target'), '_blank');
    assert.equal(await consoleLink.getAttribute('rel'), 'noreferrer');
    await detail.getByRole('button', { name: '关闭 Zone 详情', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert(await consoleLink.evaluate(element => element === document.activeElement));
    assert.equal(await consoleLink.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await detail.getByRole('button', { name: 'DNS 解析', exact: true }).click();
    assert.equal(await page.evaluate(() => window.events.dns), 1);
    await detail.getByRole('button', { name: '传播检查', exact: true }).click();
    assert.equal(await page.evaluate(() => window.events.propagation), 1);
    assert.equal(await detail.count(), 1, '既有动作不应关闭或切换所选Zone');
    await rows.nth(1).click();
    await page.waitForTimeout(220);
    assert((await consoleLink.getAttribute('href'))?.startsWith('https://dash.cloudflare.com/'));
    assert((await detail.innerText()).includes('domain-1-1.example.invalid'));
    await detail.getByRole('button', { name: 'DNS 解析', exact: true }).click();
    assert.equal(await page.evaluate(() => window.events.dns), 2);
    await detail.getByRole('button', { name: '传播检查', exact: true }).click();
    assert.equal(await page.evaluate(() => window.events.propagation), 2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(220);
    assert.equal(await detail.count(), 0);
    assert(await rows.nth(1).evaluate(element => element === document.activeElement));
  });
  for (const theme of ['light', 'dark']) for (const width of [1440, 390, 768, 1920]) {
    await test(`Zone三动作 ${theme} ${width} 同材质等高与边界`, async () => {
      await choose('zone');
      await page.getByRole('searchbox').fill('');
      await page.getByLabel('Zone 状态筛选').selectOption('all');
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await page.locator('.ew-object-row').first().click();
      const detail = page.getByLabel('Cloudflare Zone 检查器', { exact: true });
      await detail.scrollIntoViewIfNeeded();
      const geometry = await detail.locator('.ew-inspector-actions > *').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return { text: element.textContent, x: rect.x, right: rect.right, y: rect.y, height: rect.height, width: rect.width, clipped: element.scrollWidth > element.clientWidth + 1,
          material: [style.borderTopWidth, style.borderTopStyle, style.borderTopColor, style.borderRadius, style.backgroundColor, style.color, style.fontSize, style.fontWeight, style.whiteSpace] };
      }));
      assert.deepEqual(geometry.map(item => item.text), ['控制台', 'DNS 解析', '传播检查']);
      assert(geometry.every(item => item.height >= 40 && item.width >= 40 && item.x >= 0 && item.right <= width && !item.clipped), JSON.stringify(geometry));
      assert(Math.max(...geometry.map(item => item.height)) - Math.min(...geometry.map(item => item.height)) <= 1, JSON.stringify(geometry));
      assert(Math.max(...geometry.map(item => item.y)) - Math.min(...geometry.map(item => item.y)) <= 1, JSON.stringify(geometry));
      assert.deepEqual(geometry[0].material, geometry[1].material);
      assert.deepEqual(geometry[0].material, geometry[2].material);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert(dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions));
      const filename = `zone-actions-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(out, filename) });
      report.shots.push({ filename, theme, width, height: 1000, scenario: 'selected Zone with console, DNS and propagation', geometry });
      await page.keyboard.press('Escape');
    });
  }
  await test('账号绑定、接口读取、资源快照分别保真且操作不串行', async () => {
    await choose('account');
    const rows = page.locator('.ew-connection-group').first().locator('.ew-connection-row');
    assert((await rows.nth(0).innerText()).includes('0 个域名'));
    assert((await rows.nth(0).innerText()).includes('配额快照可读'));
    assert((await rows.nth(1).innerText()).includes('权限受限'));
    assert((await rows.nth(1).innerText()).includes('资源未读取'));
    assert(!(await rows.nth(2).innerText()).includes('验证未读取'));
    assert(!(await rows.nth(2).innerText()).includes('凭据已验证'));
    await rows.first().locator('.ew-connection-select').click();
    // 账号设计页不再打开与卡片重复的“详情”检查器；行内动作保留且不制造空白面板。
    assert.equal(await page.getByLabel('账号连接详情', { exact: true }).count(), 0);
  });
  await test('配额零总额保持未知，单账号展开和筛选不替换全账户总览', async () => {
    await choose('quota');
    await page.evaluate(() => window.setZeroQuota());
    const zero = page.locator('.ew-pressure-select').filter({ hasText: '账号 004' });
    assert.equal(await zero.locator('.ew-pressure-number strong').innerText(), '—');
    await zero.click();
    const overview = page.getByLabel('全部账户配额总览');
    const original = await overview.innerText();
    assert(original.includes('账户域名配额总览'));
    const over = page.locator('.ew-pressure-select').filter({ hasText: '账号 001' });
    await over.click();
    assert.equal(await overview.innerText(), original);
    await page.getByRole('searchbox').fill('账号 001');
    assert.equal(await page.locator('.ew-pressure-select').count(), 1);
    assert.equal(await overview.innerText(), original);
    await page.getByRole('searchbox').fill('');
  });
  await test('密钥请求未知不补零，设计目录不直接渲染完整凭据', async () => {
    await choose('key');
    assert.equal(await page.locator('.ew-key-row').nth(2).locator('.ew-key-count b').innerText(), '未返回');
    assert(!(await page.locator('.editorial-ledger').innerText()).includes('synthetic-key-1-0'));
    assert.equal(await page.locator('.ew-key-row').first().locator('.ew-key-count b').innerText(), '0');
  });
  for (const theme of ['light', 'dark']) for (const view of ['domain', 'zone', 'account', 'quota', 'key']) for (const width of [1440, 390, 768, 1920]) {
    await test(`${view} ${theme} ${width} 几何与当前截图`, async () => {
      await choose(view);
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(20);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert(dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions));
      if (view === 'key' && width === 390) {
        const row = page.locator('.ew-key-row').first();
        const rect = await row.boundingBox();
        assert(rect.height < 190, '密钥行意外过高 ' + rect.height);
        assert.equal(await row.locator('.ew-key-status').evaluate(element => getComputedStyle(element).gridColumnStart), '2');
      }
      const filename = `${view}-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(out, filename) });
      report.shots.push({ filename, theme, width, height: 1000, accounts: 20, objectsPerAssetAccount: 25 });
    });
  }
  await test('单账号不展示无效账号分页', async () => {
    for (const view of ['domain', 'zone', 'account', 'quota', 'key']) {
      await choose(view, 1);
      assert.equal(await page.locator('nav.ew-pager[aria-label="账号分页"]').count(), 0);
    }
  });
  await test('组件无JS异常', async () => assert.deepEqual(errors, []));
  report.sourceAfter = source();
  await test('证据期间源码固定', async () => assert.deepEqual(report.sourceAfter, report.sourceBefore));
} finally {
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ out, passed: report.tests.filter(test => test.passed).length, total: report.tests.length }));
if (report.tests.some(test => !test.passed)) process.exitCode = 1;
