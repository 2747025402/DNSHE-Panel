#!/usr/bin/env node
/**
 * 本地界面只读验收（不部署、不写生产业务、无可见窗口）。
 *
 * 先启动本地前端：npm --prefix frontend run dev -- --mode selfhost --host 127.0.0.1 --port 3012
 * 计划 / 离线安全自检：node scripts/design-review.mjs --plan / --self-test
 * 已有证据画廊：node scripts/design-review.mjs --gallery <证据目录>（不联网、不登录）
 * 全套：node scripts/design-review.mjs
 * 定向（PowerShell）：$env:PAGE='domains,cloudflare'; $env:SCENARIO='collection'; node scripts/design-review.mjs
 *
 * 环境变量：BASE（默认 http://127.0.0.1:3012）、UPSTREAM（默认 https://shydns.cc.cd）、
 * PAGE（逗号分隔 key/中文标签）、SCENARIO（all/desktop/matrix/collection）、
 * THEME（light/dark/both）、VIEWPORTS（如 390x844,1440x900，仅 matrix/collection）、
 * REVIEW_PROXY（默认 http://127.0.0.1:7890；none 禁用）、REVIEW_CREDENTIALS、
 * REVIEW_SESSION_FILE（仓库外已有 JSON {origin, session_token}，先 GET 验证，有效时零登录）、
 * REVIEW_PLAYWRIGHT、REVIEW_RUN_NAME、REVIEW_TOTP、REVIEW_SCROLL（top/bottom，默认 bottom）、
 * REVIEW_SYNTHETIC_ROUTES（可选 JSON：{"POST /api/example":{"status":503,"body":{"success":false}}}）、
 * REVIEW_INTERACTIVE=1（完成后保留内存会话，stdin JSON {"action":"run","scenario":"matrix","pages":["cfquota"]} / {"action":"finish"}）。
 *
 * synthetic 响应仅在浏览器本地返回，不能覆盖 login；报告明确标注其范围。
 * GET 响应只保存在本进程内复用；发给页面前掩码凭据字段。会话只驻内存，不存 storageState/HAR/trace。
 * 进入 API 密钥页会自动 POST /api/keys/backfill：本脚本返回 405，绝不向生产转发或伪装写入成功。
 * 本脚本的截图/审计不是人工视觉验收，也不证明任何生产写入功能可用。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { readReviewSession, validateReviewSession } from './review-session.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.dirname(REPO);
const SHOTS_ROOT = path.join(ROOT, 'shots', 'takeover-current');
const PAGES = [
  ['dashboard', '概览'], ['domains', '域名列表'], ['cloudflare', 'Cloudflare'],
  ['assist', '域名助力'], ['accounts', '账号管理'], ['apikeys', 'API 密钥'],
  ['register', '注册 / 查重'], ['quota', '账户配额'], ['ddns', '动态 DNS'],
  ['cfquota', 'CF 免费额度'], ['logs', '运行日志'], ['settings', '设置'],
].map(([key, label]) => ({ key, label }));
const KEY_PAGES = ['dashboard', 'domains', 'cfquota', 'accounts'];
const READ_PATHS = new Set([
  '/api/auth/status', '/api/auth/account', '/api/accounts', '/api/domains',
  '/api/overview', '/api/logs', '/api/settings', '/api/quota', '/api/ddns',
  '/api/cf/quota', '/api/assist/status', '/api/keys', '/api/expiry', '/api/dns/ns',
]);
const SENSITIVE_FIELD = /(?:api[_-]?key|api[_-]?secret|password|passwd|secret|token|authorization|cookie|smtp[_-]?(?:pass|user)|admin[_-]?username|^username$)/i;
const SECRET_MASK = '•';

function configuration() {
  const base = new URL(process.env.BASE || 'http://127.0.0.1:3012');
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
    throw new Error('BASE 必须是 localhost / 127.0.0.1 / ::1，禁止把截图页面指向生产。');
  }
  if (base.username || base.password || base.search || base.hash) throw new Error('BASE 不得包含凭据、查询或 hash。');
  const upstream = new URL(process.env.UPSTREAM || 'https://shydns.cc.cd');
  if (upstream.protocol !== 'https:' || upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password) {
    throw new Error('UPSTREAM 必须是无路径、查询、凭据的 HTTPS origin。');
  }
  const scenario = process.env.SCENARIO || 'all';
  if (!['all', 'desktop', 'matrix', 'collection'].includes(scenario)) throw new Error('未知 SCENARIO。');
  const pageNames = (process.env.PAGE || '').split(',').map((x) => x.trim()).filter(Boolean);
  const pages = pageNames.length ? pageNames.map((name) => {
    const page = PAGES.find((p) => p.key === name || p.label === name);
    if (!page) throw new Error(`未知 PAGE：${name}`);
    return page;
  }) : PAGES;
  const theme = process.env.THEME || 'both';
  if (!['light', 'dark', 'both'].includes(theme)) throw new Error('THEME 仅支持 light/dark/both。');
  const views = (process.env.VIEWPORTS || '390x844,768x1024,1440x900,1920x1080').split(',').map((value) => {
    const m = value.trim().match(/^(\d{3,4})x(\d{3,4})$/);
    if (!m || +m[1] < 280 || +m[1] > 3840 || +m[2] < 400 || +m[2] > 2160) throw new Error(`无效视口：${value}`);
    return { width: +m[1], height: +m[2] };
  });
  return {
    base: base.href, baseOrigin: base.origin, upstreamOrigin: upstream.origin, scenario, pages,
    explicitPages: pageNames.length > 0, themes: theme === 'both' ? ['light', 'dark'] : [theme], views,
    proxy: process.env.REVIEW_PROXY === 'none' ? '' : (process.env.REVIEW_PROXY || 'http://127.0.0.1:7890'),
    credentials: path.resolve(process.env.REVIEW_CREDENTIALS || path.join(ROOT, 'credentials.json')),
    playwright: process.env.REVIEW_PLAYWRIGHT || 'playwright',
    scrollBottom: process.env.REVIEW_SCROLL !== 'top',
  };
}

function apiDecision(url, method, cfg, loginAttempts, loginStage) {
  if (![cfg.baseOrigin, cfg.upstreamOrigin].includes(url.origin)) return 'untrusted-origin';
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    return loginStage && loginAttempts === 0 ? 'login' : 'login-already-used';
  }
  if (method !== 'GET') return 'write-blocked';
  if (!READ_PATHS.has(url.pathname) && !/^\/api\/domains\/\d+\/dns$/.test(url.pathname)) return 'read-not-allowlisted';
  if (['force', 'refresh'].some((key) => url.searchParams.has(key))) return 'forced-refresh-blocked';
  return 'read';
}

function mask(value) {
  return SECRET_MASK.repeat(value.length);
}

function redactValue(value, secretValues, collect = true) {
  const visit = (node, key = '') => {
    if (Array.isArray(node)) return node.map((item) => visit(item, key));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, visit(v, k)]));
    if (typeof node !== 'string') return node;
    if (SENSITIVE_FIELD.test(key)) {
      if (collect && node.length >= 4) secretValues.add(node);
      return mask(node);
    }
    return node;
  };
  const result = visit(value);
  const scrub = (node) => {
    if (Array.isArray(node)) return node.map(scrub);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, scrub(v)]));
    if (typeof node !== 'string') return node;
    let text = node;
    for (const secret of secretValues) if (secret.length >= 4) text = text.split(secret).join(mask(secret));
    return text.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]');
  };
  return scrub(result);
}

function jobsFor(cfg) {
  const jobs = [];
  const add = (kind, theme, viewport, pages) => jobs.push({ kind, theme, viewport, pages });
  if (['all', 'desktop'].includes(cfg.scenario)) add('desktop', cfg.themes[0], { width: 1440, height: 1000 }, cfg.pages);
  if (['all', 'matrix', 'collection'].includes(cfg.scenario)) {
    const pages = cfg.scenario === 'collection'
      ? cfg.pages.filter((p) => ['domains', 'cloudflare'].includes(p.key))
      : cfg.pages.filter((p) => cfg.explicitPages || KEY_PAGES.includes(p.key));
    if (!pages.length) throw new Error('当前 PAGE 与 SCENARIO 没有匹配页面。');
    for (const theme of cfg.themes) for (const view of cfg.views) add(cfg.scenario === 'collection' ? 'collection' : 'matrix', theme, view, pages);
  }
  return jobs;
}

function sourceVersion() {
  const hashes = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:tsx?|css|json)$/.test(entry.name)) hashes[path.relative(REPO, file).replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  };
  walk(path.join(REPO, 'frontend', 'src'));
  let head = 'unknown';
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', windowsHide: true }).trim(); } catch { /* 非 Git 拷贝仍可验收 */ }
  return { head, hashes };
}

function writeGallery(report, out) {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const items = report.shots.map((shot) => {
    const parts = shot.scenario.split('/');
    const theme = parts.at(-2), viewport = parts.at(-1), batch = parts[0];
    const page = PAGES.find((entry) => entry.key === shot.page)?.label || shot.page;
    return `<article data-page="${escape(shot.page)}" data-theme="${escape(theme)}" data-viewport="${escape(viewport)}" data-batch="${escape(batch)}"><a href="${escape(shot.file)}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(shot.file)}" width="${shot.dimensions.width}" height="${shot.dimensions.height}" alt="${escape(page)} ${escape(theme)} ${escape(viewport)} ${escape(shot.suffix)} ${escape(shot.position)}"></a><div class="caption"><strong>${escape(page)}</strong><span>${escape(theme)} · ${escape(viewport)} · ${escape(shot.suffix)} · ${escape(shot.position)}</span><small>${escape(batch)} · PNG ${shot.dimensions.width} × ${shot.dimensions.height} · DPR 1</small></div></article>`;
  }).join('\n');
  const options = (values) => [...new Set(values)].map((value) => `<option>${escape(value)}</option>`).join('');
  const pageOptions = [...new Set(report.shots.map((shot) => shot.page))].map((key) => `<option value="${escape(key)}">${escape(PAGES.find((page) => page.key === key)?.label || key)}</option>`).join('');
  const batches = report.batches.map((batch) => `<li>${escape(batch.name)}：${escape(batch.sourceBefore?.head)} · ${escape(batch.startedAt)}${batch.finishedAt ? ` → ${escape(batch.finishedAt)}` : ' · 进行中'}${batch.sourceChanged ? ' · 源码期间有变动，需结合后续批次' : ''}</li>`).join('');
  const maskNote = report.capturePolicy?.neutralMask ? '灰色块为测试遮罩，不是产品控件样式。' : '旧批次中的洋红色块为默认测试遮罩，不是产品控件样式。';
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DNSHE 本地只读截图验收</title><style>
  :root{color-scheme:light dark;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f4f4f5;color:#18181b}*{box-sizing:border-box}body{margin:0;padding:24px}header{max-width:1600px;margin:0 auto 20px}h1{font-size:24px;margin:0 0 8px}p,li{font-size:14px;line-height:1.7}p{margin:4px 0}code{font-size:12px;overflow-wrap:anywhere}.filters{display:flex;flex-wrap:wrap;gap:12px;align-items:center;position:sticky;top:0;background:#f4f4f5;z-index:1;padding:12px 0}label{font-size:13px;display:flex;gap:8px;align-items:center}select{height:36px;max-width:220px;border:1px solid #d4d4d8;border-radius:6px;background:#fff;color:#18181b;padding:0 10px}main{max-width:1600px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}article{min-width:0;border:1px solid #d4d4d8;border-radius:6px;overflow:hidden;background:#fff}article[hidden]{display:none}a{display:block}img{display:block;width:100%;height:auto;aspect-ratio:1.44;object-fit:contain;background:#e4e4e7}.caption{padding:12px;display:grid;gap:5px;font-size:12px}.caption strong{font-size:15px}.caption small{color:#71717a}details{margin:12px 0}summary{cursor:pointer;font-size:13px}ul{padding-left:20px}@media(prefers-color-scheme:dark){:root{background:#18181b;color:#e4e4e7}.filters{background:#18181b}article,select{background:#27272a;color:#e4e4e7;border-color:#52525b}img{background:#09090b}.caption small{color:#a1a1aa}}
  </style><header><h1>DNSHE 本地只读截图验收</h1><p>仅本地界面 · 后端只读脱敏 · 唯一登录/进程 · 无部署、业务写入或系统剪贴板改动。截图不替代人工视觉验收。</p><p>页面来源：<code>${escape(report.base)}</code> · HEAD：<code>${escape(report.sourceBefore?.head)}</code> · ${report.shots.length} 张 · ${report.interactions.length} 项交互记录</p><p>源码版本、失败及受限项详见同目录 <a href="audit.json" style="display:inline">audit.json</a>；每张 PNG 使用 CSS 视口与 DPR 1。敏感密钥已在接口响应进入界面前掩码。${maskNote}</p><details><summary>批次与源码说明</summary><ul>${batches}</ul><p>截图文件按批次追加，历史失败与修复后证据均保留；后续批次不会覆盖旧图片。</p></details><div class="filters"><label>页面<select id="page"><option value="">全部</option>${pageOptions}</select></label><label>主题<select id="theme"><option value="">全部</option>${options(report.shots.map((shot) => shot.scenario.split('/').at(-2)))}</select></label><label>视口<select id="viewport"><option value="">全部</option>${options(report.shots.map((shot) => shot.scenario.split('/').at(-1)))}</select></label><label>批次<select id="batch"><option value="">全部</option>${options(report.shots.map((shot) => shot.scenario.split('/')[0]))}</select></label><span id="count"></span></div></header><main>${items}</main><script>
  const fields=['page','theme','viewport','batch']; const articles=[...document.querySelectorAll('article')]; function filter(){let shown=0;for(const item of articles){item.hidden=fields.some(key=>document.getElementById(key).value&&document.getElementById(key).value!==item.dataset[key]);if(!item.hidden)shown++;}document.getElementById('count').textContent=shown+' / '+articles.length+' 张';}for(const key of fields)document.getElementById(key).addEventListener('change',filter);filter();
  </script></html>`;
  fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');
}

function loadSynthetic(file) {
  if (!file) return new Map();
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const routes = new Map();
  for (const [key, value] of Object.entries(raw)) {
    if (!/^(GET|POST|PUT|PATCH|DELETE) \/api\/[\S]+$/.test(key) || /\/api\/auth\//.test(key)) throw new Error('synthetic 仅允许明确的非鉴权 API method/path。');
    if (!value || !Number.isInteger(value.status) || value.status < 200 || value.status > 599 || !('body' in value)) throw new Error(`无效 synthetic 响应：${key.split('?')[0]}`);
    routes.set(key, value);
  }
  return routes;
}

/** 纯 DOM 几何审计，不读取输入值、不抄录业务表格正文。兼容原生 table 和 ARIA table。 */
function probePage() {
  const round = (n) => Math.round(n * 10) / 10;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) }; };
  const rendered = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const onscreen = (el) => { const r = el.getBoundingClientRect(); return rendered(el) && r.bottom > 0 && r.top < innerHeight; };
  const alignmentVisible = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if ((style.clipPath === 'inset(50%)' || (style.position === 'absolute' && style.overflow === 'hidden')) && bounds.width <= 2 && bounds.height <= 2) return false;
    }
    return rendered(el);
  };
  const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.matches('input,select,textarea') ? el.tagName : el.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const descriptor = (el) => `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.id ? `#${el.id}` : ''}`;
  const localScroller = (el) => {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth + 2) return true;
    }
    return false;
  };
  const controlBox = (el) => {
    if (el.matches('input,select')) {
      const parent = el.parentElement;
      if (parent && parseFloat(getComputedStyle(parent).borderTopWidth) > 0 && parent.getBoundingClientRect().height <= el.getBoundingClientRect().height + 6) return parent;
    }
    return el;
  };
  const controls = [...document.querySelectorAll('header button,header input,header select,main button,main input,main select,main textarea')]
    .filter(onscreen).filter((el) => !el.matches('input[type=hidden],input[type=checkbox],input[type=radio],input[type=range],input[type=file],input[type=color]'))
    .map((el) => ({ element: descriptor(el), label: label(el), header: !!el.closest('header'), ...rect(controlBox(el)), fontSize: getComputedStyle(el).fontSize, overflow: el.scrollWidth - el.clientWidth, clipped: getComputedStyle(el).textOverflow === 'ellipsis' }));
  const overflowElements = [...document.querySelectorAll('header *,main *')].filter(onscreen).filter((el) => {
    const r = el.getBoundingClientRect();
    return (r.left < -2 || r.right > innerWidth + 2) && !localScroller(el);
  }).slice(0, 50).map((el) => ({ element: descriptor(el), ...rect(el) }));
  const assetFieldOverflows = [...document.querySelectorAll('.asset-date,.asset-provider')].filter(onscreen)
    .filter((el) => el.scrollWidth > el.clientWidth + 2)
    .map((el) => ({ element: descriptor(el), field: el.getAttribute('data-label'), ...rect(el), contentOverflow: el.scrollWidth - el.clientWidth }));
  const tables = [...document.querySelectorAll('main table,main [role=table]')].filter(rendered).map((table, index) => {
    const rows = [...table.querySelectorAll('tr,[role=row]')].filter(rendered);
    const header = rows.find((row) => row.querySelector('th,[role=columnheader]'));
    const headings = header ? [...header.querySelectorAll('th,[role=columnheader]')].filter(alignmentVisible) : [];
    const body = rows.find((row) => row !== header && row.querySelectorAll('td,[role=cell]').length === headings.length);
    const cells = body ? [...body.querySelectorAll('td,[role=cell]')].filter(rendered) : [];
    const comparable = headings.length > 0 && cells.length === headings.length && [...headings, ...cells].every((el) => +(el.getAttribute('colspan') || 1) === 1);
    const columns = comparable ? headings.map((head, i) => {
      const h = head.getBoundingClientRect(), c = cells[i].getBoundingClientRect();
      const leftDelta = round(Math.abs(h.left - c.left)), rightDelta = round(Math.abs(h.right - c.right));
      const centerDelta = round(Math.abs((h.left + h.right) / 2 - (c.left + c.right) / 2));
      const centeredGridItem = getComputedStyle(cells[i]).justifySelf === 'center' && getComputedStyle(body).display === 'grid';
      return { label: label(head), header: rect(head), cell: rect(cells[i]), leftDelta, rightDelta, centerDelta, alignmentRule: centeredGridItem ? 'centered-grid-item' : 'cell-edges', alignmentDelta: centeredGridItem ? centerDelta : Math.max(leftDelta, rightDelta), headerAlign: getComputedStyle(head).textAlign, cellAlign: getComputedStyle(cells[i]).textAlign };
    }) : [];
    return { index, role: table.getAttribute('role') || 'table', rowCount: rows.length, comparable, notComparableReason: comparable ? null : headings.length ? 'column-shape' : 'no-visible-header-or-compact-reflow', columns, maxEdgeDelta: columns.length ? Math.max(...columns.flatMap((c) => [c.leftDelta, c.rightDelta])) : null, maxAlignmentDelta: columns.length ? Math.max(...columns.map((c) => c.alignmentDelta)) : null };
  });
  const main = document.querySelector('main');
  return {
    title: document.title, hash: location.hash, theme: localStorage.getItem('DNSHE_THEME'), interfaceStyle: document.documentElement.dataset.interfaceStyle,
    viewport: { width: innerWidth, height: innerHeight }, documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    main: main ? { ...rect(main), scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, scrollTop: round(main.scrollTop) } : null,
    headings: [...document.querySelectorAll('main h1,main h2,main h3')].filter(onscreen).map(label),
    headerHeights: [...new Set(controls.filter((c) => c.header).map((c) => c.height))], controls, overflowElements, assetFieldOverflows, tables,
  };
}

async function run(cfg) {
  const runName = process.env.REVIEW_RUN_NAME || `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(runName)) throw new Error('REVIEW_RUN_NAME 仅允许字母、数字、下划线、横线。');
  const out = path.join(SHOTS_ROOT, runName);
  fs.mkdirSync(SHOTS_ROOT, { recursive: true });
  fs.mkdirSync(out); // 已存在就报错；不覆盖或删除任何既有证据。
  const jobs = jobsFor(cfg);
  const synthetic = loadSynthetic(process.env.REVIEW_SYNTHETIC_ROUTES);
  let creds;
  const savedSession = readReviewSession(REPO, cfg.upstreamOrigin);
  const secrets = new Set([savedSession, process.env.REVIEW_TOTP || ''].filter(Boolean));
  const clean = (value) => redactValue(value, secrets);
  const moduleUrl = cfg.playwright === 'playwright' || cfg.playwright.startsWith('file:') ? cfg.playwright : pathToFileURL(path.resolve(cfg.playwright)).href;
  const { chromium } = await import(moduleUrl);
  const report = {
    startedAt: new Date().toISOString(), base: cfg.base, upstream: cfg.upstreamOrigin, scenario: cfg.scenario,
    harnessSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
    capturePolicy: { neutralMask: true, secretMask: 'full-length', toastSettled: true, compactHiddenHeadersExcluded: true, deviceScaleFactor: 1 },
    sourceBefore: sourceVersion(), dataPolicy: 'production GET + validated saved session or at most one login; credentials masked; GET snapshots cached in memory; no logout/write',
    syntheticRoutes: [...synthetic.keys()].map((key) => key.split('?')[0]),
    shots: [], failures: [], warnings: [], console: [], network: [], blocked: [], interactions: [], batches: [], loginAttempts: 0, sessionReused: false,
  };
  let token = '', loginStage = false, browser;
  const cache = new Map();
  const safeRoute = (url) => ({ path: url.pathname, queryKeys: [...url.searchParams.keys()] });
  const fulfillJson = (route, status, body) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body), headers: { 'cache-control': 'no-store' } });

  async function makePage(job, authenticated = true) {
    const context = await browser.newContext({ viewport: job.viewport, deviceScaleFactor: 1, colorScheme: job.theme, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false });
    const meta = { tag: `${job.kind}/${job.theme}/${job.viewport.width}x${job.viewport.height}`, activePage: 'login', pending: 0, touched: Date.now() };
    await context.addInitScript(({ baseOrigin, theme, session }) => {
      if (location.origin !== baseOrigin) return;
      localStorage.setItem('DNSHE_THEME', theme);
      localStorage.setItem('DNSHE_BACKEND_URL', '/');
      localStorage.setItem('DNSHE_SIDEBAR_COLLAPSED', '0');
      if (session) sessionStorage.setItem('DNSHE_SESSION', session);
      // 本地写入捕获，绝不改系统剪贴板；字符串只留在隔离页面内，不进入报告。
      window.__reviewClipboard = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (value) => { window.__reviewClipboard.push(String(value)); },
      } });
    }, { baseOrigin: cfg.baseOrigin, theme: job.theme, session: authenticated ? token : '' });
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
      if (!url.pathname.startsWith('/api/')) {
        if (url.origin === cfg.baseOrigin && method === 'GET') return route.continue();
        report.blocked.push({ ...metaTag(meta), ...safeRoute(url), method, reason: 'external-or-non-GET-resource' });
        return route.abort('blockedbyclient');
      }
      meta.pending++; meta.touched = Date.now();
      try {
        const decision = apiDecision(url, method, cfg, report.loginAttempts, loginStage);
        const fixture = [cfg.baseOrigin, cfg.upstreamOrigin].includes(url.origin)
          ? synthetic.get(`${method} ${url.pathname}${url.search}`) || synthetic.get(`${method} ${url.pathname}`) : undefined;
        if (fixture) {
          report.network.push({ ...metaTag(meta), ...safeRoute(url), method, status: fixture.status, source: 'synthetic' });
          return await fulfillJson(route, fixture.status, clean(fixture.body));
        }
        if (!['read', 'login'].includes(decision)) {
          report.blocked.push({ ...metaTag(meta), ...safeRoute(url), method, reason: decision });
          const expectedBackfill = method === 'POST' && url.pathname === '/api/keys/backfill';
          (expectedBackfill ? report.warnings : report.failures).push({ ...metaTag(meta), issue: 'request-blocked', path: url.pathname, method, reason: decision });
          return await fulfillJson(route, 405, { success: false, error_code: 'design_review_read_only', message: '本地只读验收已阻止此请求，未向生产发送。' });
        }
        const headers = { accept: 'application/json', origin: cfg.upstreamOrigin };
        const authorization = request.headers().authorization;
        if (authorization) {
          if (!token || authorization !== `Bearer ${token}`) throw new Error('页面 Authorization 与本次内存会话不一致。');
          headers.authorization = authorization; // 保留当前页面请求的鉴权；不读取/复用用户浏览器 Profile。
        } else if (decision === 'read' && url.pathname !== '/api/auth/status') {
          throw new Error('受保护读取没有 Authorization，已在本地停止。');
        }
        if (decision === 'login') { report.loginAttempts++; headers['content-type'] = 'application/json'; }
        const target = new URL(url.pathname + url.search, cfg.upstreamOrigin).href;
        const getResponse = async () => {
          const upstream = await route.fetch({ url: target, method, headers, ...(decision === 'login' ? { postData: request.postData() } : {}), timeout: 45_000, maxRedirects: 0, maxRetries: 0 });
          const status = upstream.status();
          if (status >= 300 && status < 400) throw new Error('生产 API 返回重定向，安全策略禁止跟随。');
          if (!/application\/json/i.test(upstream.headers()['content-type'] || '')) throw new Error(`API 未返回 JSON（HTTP ${status}）。`);
          const body = await upstream.json();
          if (decision === 'login' && body.success && typeof body.session_token === 'string') {
            token = body.session_token; secrets.add(token);
          }
          return { status, body: decision === 'login' ? body : clean(body) };
        };
        let source = 'production';
        let response;
        if (decision === 'read') {
          if (cache.has(target)) source = 'memory-cache';
          else cache.set(target, getResponse());
          response = await cache.get(target);
        } else response = await getResponse();
        report.network.push({ ...metaTag(meta), ...safeRoute(url), method, status: response.status, source });
        if (response.status >= 400) report.warnings.push({ ...metaTag(meta), issue: 'upstream-http', path: url.pathname, status: response.status });
        await fulfillJson(route, response.status, response.body);
      } catch (error) {
        report.failures.push({ ...metaTag(meta), issue: 'proxy', path: url.pathname, message: clean(String(error.message)) });
        await fulfillJson(route, 502, { success: false, error_code: 'design_review_proxy_failed', message: '只读代理失败，详见本地审计报告。' }).catch(() => {});
      } finally { meta.pending--; meta.touched = Date.now(); }
    });
    // Vite 的本地 HMR 可用；任何远端 WebSocket 都在连接前关闭。
    if (context.routeWebSocket) await context.routeWebSocket(/.*/, (ws) => {
      const url = new URL(ws.url());
      if (url.hostname === new URL(cfg.base).hostname && url.port === new URL(cfg.base).port) ws.connectToServer();
      else { report.blocked.push({ ...metaTag(meta), path: url.pathname, method: 'WEBSOCKET', reason: 'remote-websocket' }); ws.close(); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('dialog', (dialog) => void dialog.dismiss());
    context.on('page', (popup) => { if (popup !== page) void popup.close(); });
    page.on('pageerror', (error) => report.failures.push({ ...metaTag(meta), issue: 'pageerror', message: clean(error.message) }));
    page.on('console', (message) => {
      if (!['error', 'warning'].includes(message.type())) return;
      const url = message.location().url;
      let pathname = '';
      try { pathname = new URL(url).pathname; } catch { /* 内联 console */ }
      const policy = report.blocked.some((entry) => entry.path === pathname);
      report.console.push({ ...metaTag(meta), type: message.type(), policyBlocked: policy, path: pathname, message: clean(message.text()).slice(0, 1200) });
      if (message.type() === 'error' && !policy) report.failures.push({ ...metaTag(meta), issue: 'console-error', path: pathname, message: clean(message.text()).slice(0, 1200) });
    });
    return { page, context, meta };
  }

  async function settle(state, minMs = 1500) {
    const started = Date.now();
    await state.page.locator('main').waitFor({ state: 'visible', timeout: 45_000 });
    while (Date.now() - started < 50_000) {
      if (Date.now() - started >= minMs && state.meta.pending === 0 && Date.now() - state.meta.touched >= 400) break;
      await state.page.waitForTimeout(100);
    }
    if (state.meta.pending) throw new Error('API 在 50 秒内未静止，未把加载中画面计为通过。');
    await state.page.evaluate(() => document.fonts.ready);
    await state.page.waitForTimeout(200);
  }

  async function navigate(state, target) {
    state.meta.activePage = target.key;
    if (new URL(state.page.url()).hash !== `#${target.key}`) {
      if (state.page.viewportSize().width < 768) {
        const menu = state.page.locator('button[aria-controls="app-nav-panel"]');
        if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
      }
      const escaped = target.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await state.page.locator('#app-nav-panel nav button').filter({ hasText: new RegExp(`^\\s*${escaped}(?:\\s*\\d+)?\\s*$`) }).click();
      await state.page.waitForFunction((key) => location.hash === `#${key}`, target.key);
    }
    await settle(state);
    await state.page.locator('main').evaluate((main) => { main.scrollTop = 0; });
    await state.page.waitForTimeout(150);
  }

  async function screenshot(state, job, target, suffix = 'default') {
    await state.page.locator('div.fixed.bottom-5.right-5.z-50').waitFor({ state: 'hidden', timeout: 12_000 });
    const name = `${job.batch}-${job.kind}-${job.theme}-${job.viewport.width}x${job.viewport.height}-${target.key}-${suffix}`;
    const capture = async (position) => {
      const geometry = clean(await state.page.evaluate(probePage));
      const file = `${name}-${position}.png`;
      const bytes = await state.page.screenshot({ path: path.join(out, file), fullPage: false, animations: 'disabled', mask: [state.page.locator('input[type=password],input[autocomplete=one-time-code],[data-sensitive]')], maskColor: job.theme === 'dark' ? '#3f3f46' : '#d4d4d8' });
      const dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
      report.shots.push({ file, ...metaTag(state.meta), position, suffix, dimensions, geometry });
      const issue = (type, details) => report.failures.push({ ...metaTag(state.meta), file, issue: type, details });
      if (dimensions.width !== job.viewport.width || dimensions.height !== job.viewport.height) issue('png-dimensions', dimensions);
      if (geometry.documentOverflow > 2 || geometry.overflowElements.length) issue('horizontal-overflow', { document: geometry.documentOverflow, elements: geometry.overflowElements });
      if (geometry.assetFieldOverflows.length) issue('asset-field-overflow', geometry.assetFieldOverflows);
      for (const table of geometry.tables) if (table.maxAlignmentDelta > 2.5) issue('table-column-alignment', table);
      if (geometry.headerHeights.some((height) => Math.abs(height - 40) > 1.5)) issue('header-control-height', geometry.headerHeights);
      const clipped = geometry.controls.filter((control) => control.overflow > 2 && !control.clipped);
      if (clipped.length) report.warnings.push({ ...metaTag(state.meta), file, issue: 'control-content-overflow', controls: clipped });
      console.log(`截图 ${file}`);
      writeReport();
    };
    await capture('top');
    const scrollable = await state.page.locator('main').evaluate((main) => main.scrollHeight > main.clientHeight + 2);
    if (cfg.scrollBottom && scrollable) {
      await state.page.locator('main').evaluate((main) => { main.scrollTop = main.scrollHeight; });
      await state.page.waitForTimeout(250);
      await capture('bottom');
      await state.page.locator('main').evaluate((main) => { main.scrollTop = 0; });
    }
  }

  function writeReport() {
    report.updatedAt = new Date().toISOString();
    report.summary = { screenshots: report.shots.length, failures: report.failures.length, warnings: report.warnings.length, interactions: report.interactions.length, loginAttempts: report.loginAttempts, productionGets: report.network.filter((x) => x.method === 'GET' && x.source === 'production').length, blockedRequests: report.blocked.length };
    fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(clean(report), null, 2) + '\n', 'utf8');
    writeGallery(report, out);
  }

  function check(state, name, passed, details = {}) {
    report.interactions.push({ ...metaTag(state.meta), name, passed, ...details });
    if (!passed) report.failures.push({ ...metaTag(state.meta), issue: 'interaction', name, ...details });
  }

  async function setStyle(state, value) {
    if (await state.page.locator('html').getAttribute('data-interface-style') !== value) {
      await state.page.getByRole('button', { name: /^界面画风：/ }).click();
    }
    await state.page.waitForFunction((style) => document.documentElement.dataset.interfaceStyle === style, value);
    await settle(state, 200);
  }

  async function collectionInteractions(state, job, target, thorough) {
    const page = state.page;
    if (!thorough) return;
    await setStyle(state, 'data');
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle(state, 500);
    check(state, 'asset-global-data-reload', await page.locator('.asset-collection--list').count() > 0 && await page.locator('html').getAttribute('data-interface-style') === 'data');
    const copy = page.locator('.asset-record .asset-name button[title^="点击复制"]').first();
    if (await copy.count()) {
      await copy.click();
      check(state, 'domain-copy-local-capture', await copy.evaluate((button) => window.__reviewClipboard.at(-1) === button.title.replace(/^点击复制：/, '')));
    } else check(state, 'domain-copy-local-capture', false, { reason: 'no-asset-row' });
    const menu = page.locator('[data-asset-menu-trigger]').first();
    if (await menu.count()) {
      await menu.click();
      check(state, 'asset-menu-open', await menu.getAttribute('aria-expanded') === 'true');
      await screenshot(state, job, target, 'menu-open');
      await page.keyboard.press('Escape');
      check(state, 'asset-menu-escape-focus', await menu.getAttribute('aria-expanded') === 'false' && await menu.evaluate((button) => button === document.activeElement));
    }
    const dns = page.getByRole('button', { name: 'DNS 解析', exact: true }).filter({ visible: true }).first();
    if (!await dns.count()) { report.warnings.push({ ...metaTag(state.meta), issue: 'dns-open-not-covered', reason: 'no-enabled-native-dns-row' }); return; }
    const networkBefore = report.network.length;
    await dns.click();
    await settle(state, 350);
    const modal = page.locator('div.fixed.inset-0.z-50').filter({ has: page.locator('h3') }).filter({ visible: true }).last();
    const read = report.network.slice(networkBefore).find((entry) => entry.method === 'GET' && /^\/api\/domains\/\d+\/dns$/.test(entry.path));
    check(state, 'dns-open-readonly-get', await modal.count() === 1 && !!read, { status: read?.status ?? null, source: read?.source ?? null });
    await screenshot(state, job, target, 'dns-open');
    // 两个既有 DNS 面板头部最后一个按钮都是关闭；不点击刷新或表单动作。
    await modal.locator('div.bg-elevated').first().locator('button').last().click();
    check(state, 'dns-close', await modal.count() === 0);
  }

  async function cfInteractions(state, job, target, thorough) {
    const page = state.page;
    const group = page.getByRole('group', { name: '用量展示方式', exact: true });
    if (!await group.count()) { check(state, 'cf-view-control', false); return; }
    await group.getByRole('button', { name: '设计风', exact: true }).click();
    await settle(state, 250);
    check(state, 'cf-design-one-chart', await page.locator('[data-cf-quota-view=bold] [data-column-chart]').count() === 1);
    if (thorough) {
      const hits = page.locator('[data-column-chart] [data-chart-hit]');
      const first = hits.first();
      if (await hits.count()) {
        await first.hover();
        check(state, 'cf-chart-hover', await page.locator('[data-chart-tooltip]').count() === 1);
        await screenshot(state, job, target, 'design-tooltip');
        await page.mouse.move(0, 0);
        await first.focus();
        await page.keyboard.press('ArrowRight');
        check(state, 'cf-chart-keyboard-next', await hits.nth(1).evaluate((el) => el === document.activeElement) && await page.locator('[data-chart-tooltip]').count() === 1);
        await page.keyboard.press('ArrowLeft');
        check(state, 'cf-chart-keyboard-previous', await first.evaluate((el) => el === document.activeElement));
        await page.keyboard.press('Escape');
        check(state, 'cf-chart-escape', await page.locator('[data-chart-tooltip]').count() === 0);
      }
    }
    await group.getByRole('button', { name: '数据面板风', exact: true }).click();
    await settle(state, 250);
    check(state, 'cf-data-compact-chart', await page.locator('[data-cf-quota-view=clear]').count() === 1 && await page.locator('[data-column-chart]').count() === 1);
    if (thorough) {
      const hits = page.locator('[data-cf-quota-view=clear] [data-chart-hit]');
      if (await hits.count()) {
        await hits.first().hover();
        check(state, 'cf-data-chart-hover', await page.locator('[data-chart-tooltip]').count() === 1);
        await screenshot(state, job, target, 'data-tooltip');
        await page.mouse.move(0, 0);
        await page.keyboard.press('Escape');
      }
      const scope = page.getByRole('combobox', { name: '账号范围', exact: true });
      const values = await scope.locator('option').evaluateAll((options) => options.map((option) => option.value));
      if (values.length > 1) {
        await scope.selectOption(values[1]);
        await settle(state, 200);
        check(state, 'cf-monitor-single-scope', await page.locator('[data-cf-account-table] tr[data-cf-account-id]').count() === 1);
        await screenshot(state, job, target, 'data-single-scope');
        await group.getByRole('button', { name: '设计风', exact: true }).click();
        check(state, 'cf-scope-preserved-on-view-switch', await scope.inputValue() === values[1]);
        await screenshot(state, job, target, 'design-single-scope');
        await group.getByRole('button', { name: '数据面板风', exact: true }).click();
        await scope.selectOption('all');
        await settle(state, 200);
      }
      const details = page.locator('[data-cf-account-table] button[aria-controls="cf-account-detail"]').first();
      if (await details.count()) {
        await details.click();
        check(state, 'cf-monitor-detail-chart', await page.locator('#cf-account-detail [data-column-chart]').count() === 1);
        await screenshot(state, job, target, 'data-detail');
        await details.click();
        check(state, 'cf-monitor-detail-close', await page.locator('#cf-account-detail').count() === 0);
      }
      const search = page.getByRole('searchbox', { name: '搜索账号', exact: true });
      if (await search.count()) {
        const count = await page.locator('[data-cf-account-table] tr[data-cf-account-id]').count();
        await search.fill('__review_no_match_314159__');
        check(state, 'cf-search-empty-result', await page.locator('[data-cf-account-table] tr[data-cf-account-id]').count() === 0);
        await search.fill('');
        check(state, 'cf-search-restore', await page.locator('[data-cf-account-table] tr[data-cf-account-id]').count() === count);
      }
    }
  }

  async function quotaInteractions(state, job, target, thorough) {
    const page = state.page;
    for (const [style, view] of [['design', 'cards'], ['data', 'list']]) {
      await setStyle(state, style);
      check(state, `quota-view-${view}`, await page.locator(`[data-quota-view="${view}"]`).count() === 1);
      if (thorough) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await settle(state, 500);
        check(state, `quota-view-${view}-reload`, await page.locator('html').getAttribute('data-interface-style') === style && await page.locator(`[data-quota-view="${view}"]`).count() === 1);
      }
    }
  }

  async function executeJobs(nextJobs) {
    const batchName = `batch-${String(report.batches.length + 1).padStart(2, '0')}`;
    const batch = { name: batchName, startedAt: new Date().toISOString(), sourceBefore: sourceVersion(), firstShot: report.shots.length };
    report.batches.push(batch);
    for (const rawJob of nextJobs) {
      const job = { ...rawJob, batch: batchName };
      const state = await makePage(job);
      state.meta.tag = `${batchName}/${state.meta.tag}`;
      try {
        await state.page.goto(cfg.base, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await settle(state);
        const navCount = await state.page.locator('#app-nav-panel nav button').count();
        if (navCount !== 12) report.failures.push({ ...metaTag(state.meta), issue: 'navigation-count', actual: navCount, expected: 12 });
        for (const target of job.pages) {
          try {
            await navigate(state, target);
            if (target.key === 'register') {
              check(state, 'register-unified-workspace', await state.page.getByRole('button', { name: /^界面画风：/ }).count() === 0);
              await screenshot(state, job, target, 'unified');
            } else for (const style of ['design', 'data']) {
              await setStyle(state, style);
              check(state, `global-style-${style}-route-preserved`, await state.page.locator('main').getAttribute('data-workspace') === target.key && await state.page.evaluate((key) => location.hash === `#${key}`, target.key));
              await screenshot(state, job, target, `style-${style}`);
            }
            if (target.key === 'settings') {
              await state.page.getByRole('radio', { name: '设计风', exact: true }).check();
              check(state, 'settings-style-syncs-header', await state.page.getByRole('button', { name: '界面画风：设计风', exact: true }).count() === 1);
            }
            if (['domains', 'cloudflare'].includes(target.key)) await collectionInteractions(state, job, target, job.kind === 'desktop' || job.kind === 'collection');
            if (target.key === 'quota') await quotaInteractions(state, job, target, job.kind === 'desktop');
            if (target.key === 'cfquota') await cfInteractions(state, job, target, job.kind === 'desktop');
          } catch (error) {
            report.failures.push({ ...metaTag(state.meta), issue: 'scenario', message: clean(error.message) });
            console.log(`场景未完成 ${state.meta.tag}/${target.key}，详见审计报告。`);
            if (!await state.page.locator('main').count()) throw new Error('会话或页面已失效；不会自动重新登录。');
          }
        }
      } finally { await state.context.close(); writeReport(); }
    }
    batch.finishedAt = new Date().toISOString(); batch.sourceAfter = sourceVersion(); batch.lastShot = report.shots.length;
    batch.sourceChanged = JSON.stringify(batch.sourceBefore) !== JSON.stringify(batch.sourceAfter);
    if (batch.sourceChanged) report.failures.push({ issue: 'source-changed', batch: batchName, message: '此批次取证时源码发生变化，不能作为最终版本验收。' });
    writeReport();
    console.log(`批次完成 ${batchName}；证据：${out}`);
  }

  try {
    browser = await chromium.launch({ headless: true, ...(cfg.proxy ? { proxy: { server: cfg.proxy, bypass: '127.0.0.1,localhost,[::1]' } } : {}) });
    const validationContext = await browser.newContext();
    try {
      if (savedSession && await validateReviewSession(validationContext.request, cfg.upstreamOrigin, savedSession)) {
        token = savedSession; report.sessionReused = true;
      }
    } finally { await validationContext.close(); }
    if (!report.sessionReused) {
      try { creds = JSON.parse(fs.readFileSync(cfg.credentials, 'utf8')).shydns_console; }
      catch { throw new Error('无法读取或解析登录配置；为防止泄漏，不输出文件正文或解析片段。'); }
      if (!creds?.ADMIN_USERNAME || !creds?.ADMIN_PASSWORD) throw new Error('credentials.json 缺少 shydns_console 登录配置。');
      secrets.add(creds.ADMIN_USERNAME); secrets.add(creds.ADMIN_PASSWORD);
      const login = await makePage({ kind: 'login', theme: cfg.themes[0], viewport: { width: 1440, height: 1000 } }, false);
      loginStage = true;
      await login.page.goto(cfg.base, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await login.page.locator('input[autocomplete=username]').fill(creds.ADMIN_USERNAME);
      await login.page.locator('input[autocomplete=current-password]').fill(creds.ADMIN_PASSWORD);
      const totp = login.page.locator('input[autocomplete=one-time-code]');
      if (await totp.count()) {
        if (!process.env.REVIEW_TOTP) throw new Error('当前登录需要 2FA；未提供 REVIEW_TOTP，本轮未提交登录。');
        await totp.fill(process.env.REVIEW_TOTP);
      }
      await login.page.getByRole('button', { name: '登录', exact: true }).click();
      await login.page.waitForFunction(() => !!sessionStorage.getItem('DNSHE_SESSION'), undefined, { timeout: 45_000 });
      loginStage = false;
      if (!token || report.loginAttempts !== 1) throw new Error('未获得唯一有效会话；禁止再次尝试登录。');
      await settle(login);
      await login.context.close();
      creds = undefined;
    }
    console.log(report.sessionReused ? '已只读验证并复用已有会话；本轮零登录，所有业务写入已封锁。' : '唯一登录完成；后续上下文复用内存会话，所有业务写入已封锁。');

    await executeJobs(jobs);
    if (process.env.REVIEW_INTERACTIVE === '1') {
      console.log('REVIEW_READY：会话仅保留在此进程；stdin 接受 run 或 finish JSON。');
      const lines = readline.createInterface({ input: process.stdin, terminal: false });
      for await (const line of lines) {
        try {
          const command = JSON.parse(line);
          if (command.action === 'finish') { lines.close(); break; }
          if (command.action !== 'run') throw new Error('只接受 run / finish。');
          const names = command.pages || cfg.pages.map((p) => p.key);
          const pages = names.map((key) => { const page = PAGES.find((p) => p.key === key); if (!page) throw new Error('无效 page。'); return page; });
          const scenario = command.scenario || 'desktop';
          if (!['all', 'desktop', 'matrix', 'collection'].includes(scenario)) throw new Error('无效 scenario。');
          const themes = command.themes || cfg.themes;
          if (!themes.every((theme) => ['light', 'dark'].includes(theme))) throw new Error('无效 theme。');
          if (command.synthetic) { synthetic.clear(); for (const [key, value] of loadSynthetic(command.synthetic)) synthetic.set(key, value); }
          if (command.clearSynthetic) synthetic.clear();
          report.syntheticRoutes = [...synthetic.keys()].map((key) => key.split('?')[0]);
          await executeJobs(jobsFor({ ...cfg, pages, explicitPages: true, scenario, themes }));
        } catch (error) { console.log(`追加批次未完成：${clean(error.message)}`); }
        console.log('REVIEW_READY');
      }
    }
  } catch (error) {
    report.failures.push({ issue: 'run', message: clean(error.message) });
  } finally {
    loginStage = false;
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    report.sourceAfter = sourceVersion();
    report.sourceChangedDuringRun = JSON.stringify(report.sourceBefore) !== JSON.stringify(report.sourceAfter);
    // 报告不保存响应体/请求头/会话；再次清理动态日志中可能出现的已知凭据。
    writeReport();
    token = ''; cache.clear(); secrets.clear();
    console.log(`完成：${report.shots.length} 张截图，${report.failures.length} 项失败，${report.warnings.length} 项提醒。`);
    console.log(`本地证据：${out}`);
    process.exitCode = report.failures.length ? 1 : 0;
  }
}

function metaTag(meta) { return { scenario: meta.tag, page: meta.activePage }; }

function selfTest() {
  const cfg = { baseOrigin: 'http://127.0.0.1:3012', upstreamOrigin: 'https://shydns.cc.cd' };
  const url = (p, origin = cfg.baseOrigin) => new URL(p, origin);
  assert.equal(apiDecision(url('/api/auth/login'), 'POST', cfg, 0, true), 'login');
  assert.equal(apiDecision(url('/api/auth/login'), 'POST', cfg, 1, true), 'login-already-used');
  assert.equal(apiDecision(url('/api/auth/login'), 'POST', cfg, 0, false), 'login-already-used');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) assert.equal(apiDecision(url('/api/accounts'), method, cfg, 1, false), 'write-blocked');
  assert.equal(apiDecision(url('/api/keys/backfill'), 'POST', cfg, 1, false), 'write-blocked');
  assert.equal(apiDecision(url('/api/auth/logout'), 'POST', cfg, 1, false), 'write-blocked');
  assert.equal(apiDecision(url('/api/accounts'), 'GET', cfg, 1, false), 'read');
  assert.equal(apiDecision(url('/api/dns/ns?roots=example.com'), 'GET', cfg, 1, false), 'read');
  assert.equal(apiDecision(url('/api/domains/123/dns'), 'GET', cfg, 1, false), 'read');
  assert.equal(apiDecision(url('/api/domains/123/dns/batch'), 'GET', cfg, 1, false), 'read-not-allowlisted');
  assert.equal(apiDecision(url('/api/domains/123/dns?refresh=1'), 'GET', cfg, 1, false), 'forced-refresh-blocked');
  assert.equal(apiDecision(url('/api/accounts', 'https://example.com'), 'GET', cfg, 1, false), 'untrusted-origin');
  assert.equal(apiDecision(url('/api/cf/quota?force=1'), 'GET', cfg, 1, false), 'forced-refresh-blocked');
  assert.equal(apiDecision(url('/api/unexpected'), 'GET', cfg, 1, false), 'read-not-allowlisted');
  const privateValues = new Set(['test-password-1234']);
  const sample = { api_key: 'abcd12345678wxyz', nested: { api_secret: 'secret456789', has_secret: true }, note: 'Bearer session-secret', error: 'test-password-1234' };
  const safe = redactValue(sample, privateValues);
  assert.equal(safe.api_key.length, sample.api_key.length);
  assert.equal(safe.api_key, SECRET_MASK.repeat(sample.api_key.length));
  assert.equal(safe.nested.has_secret, true);
  for (const secret of privateValues) assert.ok(!JSON.stringify(safe).includes(secret));
  assert.ok(!JSON.stringify(safe).includes('session-secret'));
  console.log('离线自检通过：一次登录、写入拦截、来源白名单、强刷拦截、凭据等长掩码。未联网、未启动浏览器、未读取真实凭据。');
}

if (process.argv.includes('--help')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split(' */')[0].replace(/^#!.*\n/, ''));
} else if (process.argv.includes('--self-test')) {
  selfTest();
} else if (process.argv.includes('--gallery')) {
  const directory = process.argv[process.argv.indexOf('--gallery') + 1];
  if (!directory) throw new Error('--gallery 需要已有证据目录。');
  const out = path.resolve(directory);
  const relative = path.relative(SHOTS_ROOT, out);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('画廊仅允许写入本项目 takeover-current 的既有子目录。');
  const report = JSON.parse(fs.readFileSync(path.join(out, 'audit.json'), 'utf8'));
  writeGallery(report, out);
  console.log(`已更新本地静态画廊：${path.join(out, 'index.html')}`);
} else {
  const cfg = configuration();
  if (process.argv.includes('--plan')) {
    console.log(JSON.stringify({ base: cfg.base, upstream: cfg.upstreamOrigin, out: SHOTS_ROOT, headless: true, jobs: jobsFor(cfg), policy: 'GET allowlist + one POST /api/auth/login; no other production write' }, null, 2));
  } else {
    await run(cfg).catch((error) => { console.error(`验收未启动：${error.message}`); process.exitCode = 1; });
  }
}
