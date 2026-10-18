#!/usr/bin/env node
/** 资产工具带回归：实际容器几何、旧三排负例、筛选/导出/折叠；合成数据，headless。
 * 零真实登录、零外部网络、零业务写入。先启动3012 Vite，再执行本脚本。 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.env.BASE || 'http://127.0.0.1:3012');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only localhost is permitted.');
assert(!base.username && !base.password && !base.search && !base.hash, 'BASE must not contain credentials, query, or hash.');
const source = () => Object.fromEntries(['frontend/src/App.tsx', 'frontend/src/asset-collection.css', 'frontend/src/interface-style.css', 'frontend/src/EditorialViews.tsx', 'frontend/src/editorial-workspace.css'].map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const out = path.resolve(repo, '..', 'shots/takeover-current', `asset-layout-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
fs.mkdirSync(out, { recursive: true });
const report = { synthetic: true, base: base.origin, sourceBefore: source(), tests: [], shots: [], blockedExternal: [], blockedWrites: [], pageErrors: [] };
const accounts = [1, 2, 3].map((id) => ({ id, alias: `布局测试账号 ${id}`, api_key: 'synthetic-not-a-secret', provider: id === 3 ? 'cloudflare' : 'dnshe', created_at: '2026-09-01' }));
const domains = Array.from({ length: 4 }, (_, i) => ({ id: 900100 + i, account_id: 1 + i % 2, account_alias: `布局测试账号 ${1 + i % 2}`, full_domain: `layout-${i}.cc.cd`, subdomain: `layout-${i}`, rootdomain: 'cc.cd', status: 'active', has_dns: i % 2 === 0 ? 1 : 0, created_at: '2026-09-01', expires_at: '2027-09-01', ns1: i % 2 ? 'a.cloudflare.com' : 'a.dnshe.com', ns2: i % 2 ? 'b.cloudflare.com' : 'b.dnshe.com' }));
const zones = domains.slice(0, 2).map((domain) => ({ ...domain, id: domain.id + 100, account_id: 3, account_alias: accounts[2].alias, account_provider: 'cloudflare', status: 'active' }));
const { chromium } = await import(process.env.REVIEW_PLAYWRIGHT ? pathToFileURL(process.env.REVIEW_PLAYWRIGHT).href : 'playwright');
const browser = await chromium.launch({ headless: true });
let lastGeometry;
const check = async (name, run) => {
  lastGeometry = undefined;
  const test = { name, passed: false };
  try { Object.assign(test, await run()); test.passed = true; }
  catch (error) { test.reason = error.message; }
  if (lastGeometry) test.geometry = lastGeometry;
  report.tests.push(test); console.log(`${test.passed ? 'PASS' : 'FAIL'} ${name}${test.reason ? `; ${test.reason}` : ''}`);
};
const alignedFooter = (geometry) => Math.abs((geometry.summary.y + geometry.summary.height / 2) - (geometry.actions.y + geometry.actions.height / 2)) <= 1;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: 'reduce', acceptDownloads: true });
  await context.addInitScript(() => {
    localStorage.setItem('DNSHE_BACKEND_URL', '/'); localStorage.setItem('DNSHE_THEME', 'light');
    localStorage.setItem('DNSHE_SIDEBAR_COLLAPSED', '0');
    sessionStorage.setItem('DNSHE_SESSION', 'offline-layout-fixture-not-a-real-session');
  });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base.origin) {
      report.blockedExternal.push({ method: request.method(), origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (request.method() !== 'GET') {
      report.blockedWrites.push({ method: request.method(), path: url.pathname });
      return route.fulfill({ status: 405, json: { success: false, message: 'Offline layout test blocks all writes and login.' } });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data = {};
    if (url.pathname === '/api/auth/status') data = { initialized: true, two_fa_enabled: false };
    else if (url.pathname === '/api/accounts') data = { accounts };
    else if (url.pathname === '/api/domains') {
      let list = url.searchParams.get('provider') === 'cloudflare' ? zones : domains;
      if (url.searchParams.has('account_id')) list = list.filter((domain) => domain.account_id === Number(url.searchParams.get('account_id')));
      data = { domains: list, last_sync: { at: '2026-10-17T00:00:00Z', type: 'success' } };
    } else if (url.pathname === '/api/quota') data = { quotas: [] };
    else if (url.pathname === '/api/logs') data = { logs: [] };
    return route.fulfill({ json: { success: true, ...data } });
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.goto(new URL('/#domains', base).href, { waitUntil: 'networkidle' });
  await page.locator('.asset-filter-controls').waitFor();
  const setStyle = async (value) => {
    const names = { design: '设计风', data: '数据风', cards: '卡片风' };
    if (await page.locator('html').getAttribute('data-interface-style') !== value) await page.getByRole('group', { name: '界面画风', exact: true }).getByRole('button', { name: names[value], exact: true }).click();
    await page.waitForFunction((mode) => document.documentElement.dataset.interfaceStyle === mode, value);
  };
  const navigate = async (key) => {
    await page.evaluate((tab) => { location.hash = tab; }, key);
    await page.locator(`main[data-workspace="${key}"] .asset-filter-footer`).waitFor();
  };
  const measure = async () => lastGeometry = await page.locator('.asset-filter-bar').evaluate((container) => {
    const rect = (node) => { const bounds = node.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, right: bounds.right, width: bounds.width, height: bounds.height }; };
    const style = getComputedStyle(container), footer = container.querySelector('.asset-filter-footer'), footerStyle = footer ? getComputedStyle(footer) : null, filters = container.querySelector('.asset-filter-controls');
    const actions = container.querySelector('.asset-filter-actions');
    return {
      viewport: innerWidth, container: rect(container), contentWidth: container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      containerName: style.containerName, containerType: style.containerType,
      gridTemplateColumns: filters ? getComputedStyle(filters).gridTemplateColumns : null,
      groups: filters ? [...filters.children].map(rect) : [],
      summary: rect(container.querySelector('.asset-filter-summary')), actions: rect(actions),
      footerPaddingTop: footerStyle ? parseFloat(footerStyle.paddingTop) : 0,
      footerSeparator: footerStyle ? getComputedStyle(footer, '::before').borderTopStyle : 'none',
      controls: [...container.querySelectorAll('select, .asset-filter-actions > button')].filter((node) => node.getBoundingClientRect().height > 0).map((node) => ({ ...rect(node), name: node.getAttribute('aria-label') || node.textContent.trim(), overflow: node.scrollWidth - node.clientWidth })),
      actionWidths: [...actions.children].map((node) => node.getBoundingClientRect().width),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  for (const key of ['domains', 'cloudflare']) {
    await navigate(key);
    for (const mode of ['design', 'data', 'cards']) {
      await setStyle(mode);
      for (const width of [390, 768, 1440, 1920]) {
        await check(`${key}/${mode}/${width}：筛选、统计与动作按容器重排`, async () => {
          await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(80);
          const geometry = await measure();
          assert.equal(await page.locator('html').getAttribute('data-interface-style'), mode);
          if (mode !== 'design') assert(await page.locator(`main[data-workspace="${key}"] [data-asset-view="${mode === 'cards' ? 'cards' : 'list'}"]`).count() > 0, 'each top-level style must select its real asset structure');
          assert.equal(geometry.containerName, 'asset-filters'); assert.equal(geometry.containerType, 'inline-size');
          if (key === 'domains') {
            assert.equal(geometry.groups.length, 3);
            const expected = geometry.contentWidth >= 800 ? 3 : 1;
            assert.equal(geometry.gridTemplateColumns.trim().split(/\s+/).length, expected);
            assert(Math.max(...geometry.groups.map((g) => g.width)) - Math.min(...geometry.groups.map((g) => g.width)) <= 1);
            if (expected === 3) assert(Math.max(...geometry.groups.map((g) => g.y)) - Math.min(...geometry.groups.map((g) => g.y)) <= 1);
            else assert(geometry.groups[0].y < geometry.groups[1].y && geometry.groups[1].y < geometry.groups[2].y);
          }
          if (geometry.contentWidth >= 800) {
            assert(alignedFooter(geometry), 'wide summary and export/collapse actions must share the same footer row');
            assert(geometry.summary.right <= geometry.actions.x - 8, 'summary must not collide with actions');
            assert(geometry.footerPaddingTop >= 12, 'footer separator must leave 12px or more before actions');
            assert.equal(geometry.footerSeparator, 'solid', 'footer separator must be explicit and restrained');
            // 两排40px + 外边距32px + gap12px + 分隔留白14px + 边框2px。
            assert(geometry.container.height <= 144, 'wide toolbar must stay within two 40px control rows plus the explicit separator budget');
          } else {
            assert(geometry.summary.y + geometry.summary.height <= geometry.actions.y - 6, 'compact summary must precede the complete action row');
            assert(Math.max(...geometry.actionWidths) - Math.min(...geometry.actionWidths) <= 1, 'compact actions must have equal widths');
            assert(geometry.footerPaddingTop >= 6, 'compact footer separator must leave a readable gap before actions');
          }
          assert(geometry.controls.every((control) => Math.abs(control.height - 40) <= 1), 'all tool controls must remain 40px');
          assert(geometry.controls.every((control) => control.overflow <= 1), 'control captions must not clip or wrap');
          assert(geometry.documentOverflow <= 2, 'document must not overflow horizontally');
          const file = `${key}-${mode}-${width}.png`; await page.screenshot({ path: path.join(out, file), animations: 'disabled' }); report.shots.push(file);
          return { geometry };
        });
      }
    }
  }
  await navigate('domains'); await page.setViewportSize({ width: 1440, height: 1000 });
  await check('负向自检：旧版独占第三排的导出动作必须被同排断言拒绝', async () => {
    assert(alignedFooter(await measure()));
    const oldLayout = await page.addStyleTag({ content: '.asset-filter-footer { grid-template-columns: minmax(0, 1fr) !important; } .asset-filter-actions { justify-self: end; }' });
    const negative = await measure(); assert.equal(alignedFooter(negative), false, 'the old extra-row layout must not pass the footer predicate');
    await oldLayout.evaluate((node) => node.remove()); assert(alignedFooter(await measure()));
    return { rejectedOldLayout: true, negativeGeometry: negative };
  });
  await check('筛选与排序仍有效，CSV/JSON下载内容与当前账号一致', async () => {
    await page.getByLabel('筛选域名账号', { exact: true }).selectOption('1');
    await page.getByLabel('域名列表排序方式').selectOption('name-desc');
    await page.waitForFunction(() => document.querySelector('.asset-filter-summary')?.textContent.includes('托管域名: 2 个'));
    for (const format of ['CSV', 'JSON']) {
      const pending = page.waitForEvent('download'); await page.getByRole('button', { name: `导出 ${format}`, exact: true }).click(); const download = await pending;
      assert(download.suggestedFilename().endsWith(`.${format.toLowerCase()}`));
      const contents = fs.readFileSync(await download.path(), 'utf8').replace(/^\uFEFF/, '');
      if (format === 'JSON') { const rows = JSON.parse(contents); assert.equal(rows.length, 2); assert(rows.every((row) => row.账号 === accounts[0].alias)); }
      else { assert.equal(contents.split('\r\n').length, 3); assert(contents.includes('layout-0.cc.cd') && !contents.includes('layout-1.cc.cd')); }
    }
    assert.equal(await page.getByLabel('域名列表排序方式').inputValue(), 'name-desc');
  });
  await check('全局折叠可往返，分组身份与风格切换后保持', async () => {
    await setStyle('data');
    await page.getByRole('button', { name: '收起全部域名分组', exact: true }).click(); assert.equal(await page.locator('.asset-record').count(), 0);
    await setStyle('design'); assert.equal(await page.locator('.editorial-atlas').count(), 1); assert.equal(await page.locator('.editorial-domain-node').count(), 0, '设计风沿用已收起的分组');
    await page.getByRole('button', { name: '展开全部域名分组', exact: true }).click(); assert.equal(await page.locator('.editorial-domain-node').count(), 2);
    await setStyle('data');
    assert.equal(await page.locator('.asset-record').count(), 2);
    const domainList = page.locator('.asset-collection[data-asset-view="list"]').first();
    assert.equal(await domainList.getAttribute('data-asset-count'), '2');
    assert.equal(await domainList.getAttribute('aria-rowcount'), '2');
    const tracks = await domainList.locator('[data-asset-header] .asset-tracks, [data-asset-record].asset-tracks').evaluateAll((nodes) => nodes.slice(0, 2).map((node) => getComputedStyle(node).gridTemplateColumns));
    assert.equal(tracks.length, 2); assert.equal(tracks[0], tracks[1], 'asset header and rows must share the same column tracks');
    assert.equal(await domainList.locator('[data-asset-header]').evaluate((node) => getComputedStyle(node).position), 'static', 'asset header stays with the first row instead of floating among rows');
    const trackEdges = await domainList.locator('[data-asset-header] .asset-tracks, [data-asset-record].asset-tracks').evaluateAll((nodes) => nodes.slice(0, 2).map((node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; }));
    assert.equal(trackEdges.length, 2);
    assert(Math.abs(trackEdges[0].left - trackEdges[1].left) <= 1 && Math.abs(trackEdges[0].right - trackEdges[1].right) <= 1, 'header/data track containers must share their outer edges');
    assert.equal(await domainList.locator('[data-asset-actions]').count(), 2);
    await navigate('cloudflare'); await page.getByRole('button', { name: '收起全部 Cloudflare 分组', exact: true }).click();
    const zoneObjects = page.locator('[data-asset-record][data-asset-kind="zone"]');
    assert.equal(await zoneObjects.count(), 0);
    await page.getByRole('button', { name: '展开全部 Cloudflare 分组', exact: true }).click();
    const pageSearch = page.locator('input[name="domain-search"]');
    await pageSearch.fill('layout-0');
    await page.waitForFunction(() => document.querySelectorAll('[data-asset-record][data-asset-kind="zone"]').length === 1);
    assert.equal(await zoneObjects.count(), 1, 'Cloudflare search must reduce a multi-zone group to the matching object');
    await pageSearch.fill('');
    await setStyle('design'); assert.equal(await page.locator('.editorial-constellation').count(), 1); assert(await page.locator('.editorial-zone-node').count() > 0);
  });
  await check('域名详情展开／收起期间不产生页面级横向滚动条', async () => {
    await navigate('domains');
    await setStyle('design');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('筛选域名账号', { exact: true }).selectOption('all');
    await page.locator('input[name="domain-search"]').fill('');
    await page.getByRole('button', { name: '展开全部域名分组', exact: true }).click().catch(() => {});
    await page.locator('.editorial-domain-node').first().waitFor();
    const sampleOverflow = async () => page.evaluate(() => {
      // The directory shell deliberately clips the collapsing inspector track,
      // so its scrollWidth may include the clipped contents by definition.
      // The user-visible contract is the viewport/root/main surfaces: none may
      // expose a horizontal scrollbar during either animation.
      const nodes = [document.documentElement, document.body, document.querySelector('main')].filter(Boolean);
      return nodes.map((node) => ({
        name: node === document.documentElement ? 'html' : node === document.body ? 'body' : node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''),
        overflow: Math.max(0, node.scrollWidth - node.clientWidth),
      }));
    });
    const samples = [];
    const collect = async (duration = 220) => {
      const started = performance.now();
      do { samples.push(...await sampleOverflow()); await page.waitForTimeout(16); } while (performance.now() - started < duration);
    };
    await page.locator('.editorial-domain-node').first().click();
    await collect();
    await page.getByRole('button', { name: '关闭域名详情', exact: true }).click();
    await collect();
    assert(samples.length > 10, '必须覆盖展开与收起动画帧');
    assert(samples.every((sample) => sample.overflow <= 1), `检测到横向溢出：${JSON.stringify(samples.filter((sample) => sample.overflow > 1).slice(0, 3))}`);
    const shellOverflow = await page.locator('.ew-directory-layout').evaluate((node) => ({ scroll: node.scrollWidth - node.clientWidth, overflowX: getComputedStyle(node).overflowX }));
    assert(['clip', 'hidden'].includes(shellOverflow.overflowX), `详情轨道必须裁剪溢出，当前为 ${shellOverflow.overflowX}`);
    return { samples: samples.length, maxOverflow: Math.max(...samples.map((sample) => sample.overflow)), shellOverflow };
  });
} catch (error) { report.error = error.message; }
finally {
  await browser.close(); report.sourceAfter = source(); report.sourceChanged = JSON.stringify(report.sourceBefore) !== JSON.stringify(report.sourceAfter);
  report.passed = !report.error && !report.sourceChanged && report.tests.length === 28 && report.tests.every((test) => test.passed) && !report.pageErrors.length && !report.blockedExternal.length && !report.blockedWrites.length;
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`本地离线证据：${out}`); process.exitCode = report.passed ? 0 : 1;
}
