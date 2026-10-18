/** 离线后端契约回归：内存 SQLite、Node fetch 夹具及真实 workerd，不登录、不访问真人远端。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  stdin: { contents: `export {CloudflareClient,CfReadError} from './src/cloudflare'; export {collectAccountUsage,CF_FREE_LIMITS,createUsageLimiter} from './src/cfusage'; export * from './src/cfusage-cache'; export {default as worker} from './src/index'; export {createD1FromSqlite} from './server/d1-sqlite'; export {DatabaseManager} from './src/db';`, resolveDir: repo },
  bundle: true, write: false, platform: 'node', target: 'node22', format: 'esm', external: ['cloudflare:sockets'],
});
const { CloudflareClient, CfReadError, collectAccountUsage, CF_FREE_LIMITS, createUsageLimiter, retainCfUsageOnFailure, refreshCfUsageOnce, parseCfUsageSnapshot, worker, createD1FromSqlite, DatabaseManager } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const originalFetch = globalThis.fetch;
const day = new Date().toISOString().slice(0, 10);
const accountTag = 'a'.repeat(32);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = result => json({ success: true, result });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { console.error(`  ✗ ${name}`); throw error; }
  finally { globalThis.fetch = originalFetch; }
}
function graphBody(query) {
  const node = ['workersInvocationsAdaptive', 'd1AnalyticsAdaptiveGroups', 'kvOperationsAdaptiveGroups', 'r2OperationsAdaptiveGroups', 'r2StorageAdaptiveGroups'].find(key => query.includes(key));
  const rows = node === 'workersInvocationsAdaptive' ? [{ dimensions: { date: day }, sum: { requests: 30, errors: 0, subrequests: 4 } }]
    : node === 'd1AnalyticsAdaptiveGroups' ? [{ dimensions: { date: day }, sum: { rowsRead: 50, rowsWritten: 3, readQueries: 5, writeQueries: 2 } }] : [];
  return { data: { viewer: { accounts: [{ [node]: rows }] } } };
}
function normalFetch(url, init = {}) {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith('/graphql')) return json(graphBody(JSON.parse(init.body).query));
  if (pathname.endsWith('/accounts')) return ok([{ id: accountTag, name: 'Synthetic Account' }]);
  if (pathname.endsWith('/r2/buckets')) return ok({ buckets: [] });
  if (pathname.endsWith('/d1/database')) return ok([{ name: 'Synthetic DB', uuid: 'db', file_size: 100, num_tables: 1 }]);
  return ok([]);
}
const collect = (client = new CloudflareClient('test-only-not-real')) => collectAccountUsage(client, { id: 1, alias: 'Synthetic' });

await test('GraphQL HTTP 200 errors 保留分类；一个数据集失败不丢其他成功读数', async () => {
  globalThis.fetch = async (url, init) => String(url).endsWith('/graphql') && JSON.parse(init.body).query.includes('kvOperationsAdaptiveGroups')
    ? json({ errors: [{ message: 'permission denied for kvOperationsAdaptiveGroups' }] }) : normalFetch(url, init);
  const result = await collect();
  assert.equal(result.traffic.workers[0].requests, 30);
  assert.equal(result.traffic.d1[0].rowsRead, 50);
  assert.equal(result.traffic.kv, null);
  assert.equal(result.traffic.issues.kv.kind, 'permission');
  assert.ok(result.traffic.reason.includes('kv'));
});
await test('只有三天数据是成功短序列，不被标成权限错误，也不补造零', async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/graphql') && JSON.parse(init.body).query.includes('workersInvocationsAdaptive')) {
      const rows = [0, -2, -1].map(offset => ({ dimensions: { date: new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10) }, sum: { requests: 10 } }));
      return json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } } });
    }
    return normalFetch(url, init);
  };
  const result = await collect();
  assert.equal(result.traffic.workers.length, 3);
  assert.equal(result.traffic.issues?.workers, undefined);
  assert.deepEqual(result.traffic.workers.map(row => row.date), [...result.traffic.workers.map(row => row.date)].sort());
});
await test('成功空数据集无权限诊断；REST枚举失败不伪装为无资源', async () => {
  globalThis.fetch = async (url, init) => String(url).includes('/workers/scripts')
    ? json({ success: false, errors: [{ code: 9109, message: 'Authentication error' }] }, 403) : normalFetch(url, init);
  const result = await collect();
  assert.deepEqual(result.traffic.kv, []);
  assert.equal(result.traffic.issues?.kv, undefined);
  assert.equal(result.inventory_issues.worker_scripts.kind, 'permission');
});
await test('R2今日存储成功空值：有桶保持未知、无桶无资源，均不归咎Token', async () => {
  for (const count of [5, 0]) {
    globalThis.fetch = async (url, init) => String(url).includes('/r2/buckets')
      ? ok({ buckets: Array.from({ length: count }, (_, index) => ({ name: `Synthetic bucket ${index}` })) }) : normalFetch(url, init);
    const result = await collect();
    assert.equal(result.counts.r2_buckets, count);
    assert.equal(result.traffic.r2_storage, null);
    assert.equal(result.traffic.issues?.r2_storage, undefined);
    assert.equal(result.traffic.reason, undefined);
  }
});
await test('账户枚举空不使用本地数字ID向上游查询', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return ok([]); };
  await assert.rejects(collect(), /未返回可访问/);
  assert.equal(calls, 1);
});
await test('持久化accountTag直接查询正确账号，省去账户枚举', async () => {
  const urls = [];
  globalThis.fetch = async (url, init) => { urls.push(String(url)); return normalFetch(url, init); };
  const result = await collectAccountUsage(new CloudflareClient('test-only'), { id: 1, alias: 'Synthetic', cf_account_id: accountTag });
  assert.ok(result.traffic.workers);
  assert.ok(!urls.some(url => url.endsWith('/accounts')));
});
await test('用量里的Zone只计目标账号；其它业务无参listZones仍保留原Token可见范围', async () => {
  const scopes = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/zones')) {
      scopes.push(parsed.searchParams.get('account.id'));
      return ok([{ id: parsed.searchParams.get('account.id') || 'all-visible', name: 'synthetic.invalid' }]);
    }
    return normalFetch(url, init);
  };
  const client = new CloudflareClient('test-only');
  for (const id of [accountTag, 'b'.repeat(32)]) {
    const result = await collectAccountUsage(client, { id: 1, alias: 'Synthetic', cf_account_id: id });
    assert.equal(result.counts.zones, 1);
  }
  await client.listZones();
  assert.deepEqual(scopes, [accountTag, 'b'.repeat(32), null]);
});
await test('R2未开通不误报Token权限；Pages403保留HTTP/code且不假称已找到根因', async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/r2/buckets')) return json({ success: false, errors: [{ code: 10042, message: 'Please enable R2 through the Cloudflare Dashboard.' }] }, 403);
    if (String(url).includes('/pages/projects')) return json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403);
    return normalFetch(url, init);
  };
  const result = await collect();
  assert.equal(result.inventory_issues.r2_buckets.kind, 'not_enabled');
  assert.equal(result.inventory_issues.r2_buckets.http_status, 403);
  assert.equal(result.inventory_issues.r2_buckets.code, 10042);
  assert.equal(result.inventory_issues.pages_projects.kind, 'permission');
  assert.equal(result.inventory_issues.pages_projects.code, 10000);
  assert.match(result.inventory_issues.pages_projects.message, /不能区分/);
  assert.ok(result.traffic.workers);
});
await test('响应头未到时超时主动abort，且不重试', async () => {
  let aborts = 0;
  globalThis.fetch = async (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborts++; reject(new Error('aborted')); }, { once: true }));
  const start = Date.now();
  await assert.rejects(new CloudflareClient('test-only', 20).cfGraphql('query'), error => error instanceof CfReadError && error.kind === 'timeout');
  assert.equal(aborts, 1);
  assert.ok(Date.now() - start < 1000);
});
await test('响应头已到但JSON流未结束，计时器仍有效并abort响应体', async () => {
  let aborted = false, calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":'));
      init.signal.addEventListener('abort', () => { aborted = true; controller.error(new DOMException('aborted', 'AbortError')); }, { once: true });
    } }), { headers: { 'Content-Type': 'application/json' } });
  };
  const start = Date.now();
  await assert.rejects(new CloudflareClient('test-only', 20).cfGraphql('query'), error => error instanceof CfReadError && error.kind === 'timeout');
  assert.equal(aborted, true); assert.equal(calls, 1); assert.ok(Date.now() - start < 1000);
});
await test('HTTP429 / 401 / 500 与查询范围错误不误报成缺权限', async () => {
  for (const [status, message, kind] of [[429, 'too many requests', 'rate_limit'], [401, 'invalid token', 'authentication'], [500, 'internal error', 'unavailable'], [200, 'cannot request data older than available interval', 'query']]) {
    globalThis.fetch = async () => json({ errors: [{ message }] }, status);
    await assert.rejects(new CloudflareClient('test-only').cfGraphql('query'), error => error.kind === kind);
  }
});
await test('并发队列有界且失败释放槽位', async () => {
  let active = 0, max = 0;
  const run = createUsageLimiter(3);
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => run(async () => {
    max = Math.max(max, ++active); await delay(5); active--; if (index === 1) throw new Error('expected'); return index;
  })));
  assert.equal(max, 3);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 11);
  assert.equal(active, 0);
});
await test('槽位唤醒与新任务同一轮微任务竞争，排队者不会被插队造成超限', async () => {
  let release, newcomer, active = 0, max = 0;
  const run = createUsageLimiter(1);
  const gate = new Promise(resolve => { release = resolve; });
  const task = async (wait = false) => { max = Math.max(max, ++active); await (wait ? gate : delay(2)); active--; };
  const first = run(() => task(true));
  const queued = run(() => task());
  release();
  queueMicrotask(() => { newcomer = run(() => task()); });
  await first; await Promise.all([queued, newcomer]);
  assert.equal(max, 1); assert.equal(active, 0);
});
await test('真实fetch处扣预算，REST分页不会绕过总量保护', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.equal(init.redirect, 'manual'); return ok(Array.from({ length: 50 }, (_, id) => ({ id: String(id), name: 'Synthetic' }))); };
  const client = new CloudflareClient('budget-test-only').withReadBudget({ remaining: 2, deadline: Date.now() + 1000 });
  await assert.rejects(client.listZones(), /读取预算已用尽/);
  assert.equal(calls, 2);
});
await test('预算读取明确拒绝3xx、取消响应体，不解析HTML、不跟随链接或漏记预算', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const method of ['graphql', 'rest']) {
      let calls = 0, cancelled = false;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.equal(init.redirect, 'manual');
        return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
          status, headers: { Location: 'https://never-follow.invalid/token-must-not-appear' },
        });
      };
      const budget = { remaining: 1, deadline: Date.now() + 1000 };
      const client = new CloudflareClient('synthetic-only').withReadBudget(budget);
      await assert.rejects(method === 'graphql' ? client.cfGraphql('query') : client.listZones(), error => {
        assert.equal(error.kind, 'response');
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, /已拒绝跳转/);
        assert.ok(!error.message.includes('token-must-not-appear'));
        return true;
      });
      assert.equal(calls, 1); assert.equal(budget.remaining, 0); assert.equal(cancelled, true);
    }
  }
});
await test('真实workerd同生产兼容日期：拒绝error模式；预算客户端REST/GraphQL可读、3xx不跟随、耗尽不再发出', async () => {
  // 请求初始化和 fetch 都由 workerd 执行，而不是 Node 的宽松 Request/Mock 实现。
  const runtimeBundle = await build({
    stdin: { contents: `import {CloudflareClient} from './src/cloudflare';
      export default { async fetch(request) {
        const mode = new URL(request.url).pathname;
        if (mode === '/unsupported') {
          try { new Request('https://offline.invalid', {redirect:'error'}); return Response.json({accepted:true}); }
          catch (error) { return Response.json({name:error.name,message:error.message}); }
        }
        const budget = {remaining:mode === '/exhausted' ? 1 : 2,deadline:Date.now()+2000};
        const client = new CloudflareClient('synthetic-runtime-only',2000).withReadBudget(budget);
        try {
          const data = mode === '/rest' ? await client.listZones() : await client.cfGraphql(mode === '/redirect' ? 'query SyntheticRedirect' : 'query SyntheticSuccess');
          if (mode === '/exhausted') await client.cfGraphql('query MustNotBeSent');
          return Response.json({ok:true,data,remaining:budget.remaining});
        } catch(error) { return Response.json({kind:error.kind,message:error.message,remaining:budget.remaining}); }
      }};`, resolveDir: repo },
    bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'esm',
  });
  const outbound = [];
  const compatibilityDate = /^compatibility_date\s*=\s*"([\d-]+)"/m.exec(readFileSync(path.join(repo, 'wrangler.toml'), 'utf8'))?.[1];
  assert.ok(compatibilityDate, '测试必须沿用当前生产兼容日期');
  const mf = new Miniflare({ workers: [{
    config: { name: 'cf-read-runtime-regression', type: 'worker', compatibilityDate, manifest: {
      mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: runtimeBundle.outputFiles[0].text } },
    } },
    dev: { outboundService: { type: 'fetcher', handler: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://api.cloudflare.com');
      const query = request.method === 'POST' ? (await request.json()).query : undefined;
      outbound.push({ pathname: url.pathname, query });
      if (query === 'query SyntheticRedirect') return new MiniflareResponse('<html>redirect</html>', {
        status: 302, headers: { Location: 'https://never-follow.invalid/forbidden' },
      });
      return new MiniflareResponse(JSON.stringify(query ? { data: { synthetic: 29 } } : { success: true, result: [{ id: 'synthetic-zone', name: 'synthetic.invalid' }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } } },
  }] });
  const dispatch = async pathname => (await mf.dispatchFetch(`http://local.invalid${pathname}`)).json();
  try {
    const unsupported = await dispatch('/unsupported');
    assert.equal(unsupported.name, 'TypeError'); assert.match(unsupported.message, /Invalid redirect value/);
    assert.equal(outbound.length, 0);
    assert.deepEqual(await dispatch('/graphql'), { ok: true, data: { synthetic: 29 }, remaining: 1 });
    assert.equal(outbound.length, 1);
    const rest = await dispatch('/rest');
    assert.equal(rest.ok, true); assert.equal(rest.data[0].name, 'synthetic.invalid'); assert.equal(rest.remaining, 1);
    assert.equal(outbound.length, 2);
    const redirect = await dispatch('/redirect');
    assert.equal(redirect.kind, 'response'); assert.match(redirect.message, /HTTP 302/); assert.equal(redirect.remaining, 1);
    assert.equal(outbound.length, 3, '3xx只能消费一次请求，不能跟随Location');
    const exhausted = await dispatch('/exhausted');
    assert.equal(exhausted.kind, 'query'); assert.match(exhausted.message, /读取预算已用尽/); assert.equal(exhausted.remaining, 0);
    assert.equal(outbound.length, 4); assert.ok(!outbound.some(call => call.query === 'query MustNotBeSent'));
  } finally { await mf.dispose(); }
});
await test('整批时间预算截断排队读取且abort进行中读取，不留下悬挂槽位', async () => {
  let calls = 0, aborts = 0;
  globalThis.fetch = async (_url, init) => { calls++; return new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborts++; reject(new DOMException('aborted', 'AbortError')); }, { once: true })); };
  const client = new CloudflareClient('deadline-test-only').withReadBudget({ remaining: 40, deadline: Date.now() + 20 });
  const run = createUsageLimiter(2);
  const start = Date.now();
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => run(() => client.cfGraphql('query'))));
  assert.equal(results.length, 8); assert.ok(results.every(result => result.status === 'rejected' && result.reason.kind === 'timeout'));
  assert.ok(calls <= 2); assert.equal(aborts, calls); assert.ok(Date.now() - start < 1000);
  await assert.rejects(run(() => client.cfGraphql('query')), /时间上限/);
});
await test('供应商错误即使回显Token，返回诊断也不泄漏凭据', async () => {
  const secret = 'offline-do-not-log-this-token';
  globalThis.fetch = async () => json({ errors: [{ message: `permission denied ${secret}` }] }, 403);
  await assert.rejects(new CloudflareClient(secret).cfGraphql('query'), error => !error.message.includes(secret) && error.message.includes('[REDACTED]'));
  globalThis.fetch = async () => json({ success: false, errors: [{ message: `permission denied ${secret}` }] }, 403);
  await assert.rejects(new CloudflareClient(secret).listZones(), error => !error.message.includes(secret) && error.message.includes('[REDACTED]'));
});
await test('失败字段保留旧缓存及原始时间，成功空集覆盖旧值且不污染输入', async () => {
  globalThis.fetch = async (url, init) => normalFetch(url, init);
  const good = await collect();
  const old = { accounts: [good], limits: CF_FREE_LIMITS, generated_at: '2026-10-15T12:00:00.000Z' };
  const fresh = structuredClone(old); fresh.generated_at = '2026-10-17T12:00:00.000Z';
  fresh.accounts[0].traffic.workers = null;
  fresh.accounts[0].traffic.kv = [];
  fresh.accounts[0].traffic.issues = { workers: { kind: 'timeout', message: 'timeout' } };
  fresh.accounts[0].inventory_issues = { d1_databases: { kind: 'permission', message: 'denied' } };
  fresh.accounts[0].storage = { d1_bytes: 0, d1_detail: [] };
  const merged = retainCfUsageOnFailure(fresh, old);
  assert.equal(merged.accounts[0].traffic.workers[0].requests, 30);
  assert.equal(merged.accounts[0].traffic.issues.workers.cached_at, old.generated_at);
  assert.equal(fresh.accounts[0].traffic.issues.workers.cached_at, undefined);
  assert.equal(merged.accounts[0].storage.d1_bytes, 100);
  assert.deepEqual(merged.accounts[0].traffic.kv, []);
  const again = retainCfUsageOnFailure(fresh, merged);
  assert.equal(again.accounts[0].traffic.issues.workers.cached_at, old.generated_at);
});
await test('强刷和后台刷新同实例去重，不同数据库不串缓存；失败后能重试', async () => {
  const scope = {}, other = {}; let count = 0;
  const task = async () => { count++; await delay(10); return { accounts: [], limits: CF_FREE_LIMITS, generated_at: 'now' }; };
  const one = refreshCfUsageOnce(scope, task), two = refreshCfUsageOnce(scope, task), three = refreshCfUsageOnce(other, task);
  assert.equal(one, two); assert.notEqual(one, three); await Promise.all([one, two, three]); assert.equal(count, 2);
  await assert.rejects(refreshCfUsageOnce(scope, async () => { throw new Error('expected'); }));
  await refreshCfUsageOnce(scope, task); assert.equal(count, 3);
  await assert.rejects(async () => refreshCfUsageOnce(scope, () => { throw new Error('sync throw'); }));
  await refreshCfUsageOnce(scope, task); assert.equal(count, 4);
  assert.equal(parseCfUsageSnapshot('{bad'), undefined);
  assert.equal(parseCfUsageSnapshot('{"at":1,"payload":{}}'), undefined);
});
await test('完整API契约：本地无KV缓存复用、双账号并发不超过6、强刷新合并、失败保旧值', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(path.join(repo, 'schema.sql'), 'utf8'));
  const DB = createD1FromSqlite(sqlite);
  await new DatabaseManager(DB).ensureTables();
  for (let id = 1; id <= 2; id++) sqlite.prepare('INSERT INTO accounts (id,alias,api_key,api_secret,provider) VALUES (?,?,?,?,?)').run(id, `Synthetic ${id}`, `cf:${String(id).repeat(32)}`, `plain:${btoa('test-only')}`, 'cloudflare');
  let calls = 0, active = 0, max = 0, fail = false;
  globalThis.fetch = async (url, init) => {
    calls++; max = Math.max(max, ++active); await delay(8); active--;
    if (fail && String(url).endsWith('/graphql') && JSON.parse(init.body).query.includes('workersInvocationsAdaptive')) return json({ errors: [{ message: 'rate limit exceeded' }] }, 429);
    return normalFetch(url, init);
  };
  const background = [];
  const ctx = { waitUntil: promise => background.push(promise), passThroughOnException() {} };
  const env = { DB, ADMIN_TOKEN: 'offline-contract-only' };
  const request = force => worker.fetch(new Request(`https://offline.invalid/api/cf/quota${force ? '?force=1' : ''}`, { headers: { Authorization: 'Bearer offline-contract-only' } }), env, ctx).then(response => response.json());
  try {
    const first = await request(false); const coldCalls = calls;
    assert.equal(first.success, true); assert.equal(first.accounts.length, 2); assert.equal(coldCalls, 24); assert.ok(max <= 6);
    assert.equal(background.length, 1, '冷采集同一Promise登记waitUntil，保证客户端断连时可收尾');
    const cached = await request(false); assert.equal(cached.cached, true); assert.equal(calls, coldCalls);
    fail = true;
    const [forced, joined] = await Promise.all([request(true), request(true)]);
    assert.equal(calls, coldCalls * 2); assert.equal(forced.accounts[0].traffic.issues.workers.kind, 'rate_limit');
    assert.equal(forced.accounts[0].traffic.workers[0].requests, 30);
    assert.equal(forced.accounts[0].traffic.issues.workers.cached_at, first.generated_at);
    assert.deepEqual(forced, joined);
    assert.equal(background.length, 3, '两次强刷共享工作，但各自请求上下文都保住该工作');
    // 过期快照先响应，后台刷新完成再写入，不让用户等待网络。
    const dbm = new DatabaseManager(DB); const snapshot = JSON.parse(await dbm.getCache('cfquota:v1')); snapshot.at = Date.now() - 91_000;
    await dbm.setCache('cfquota:v1', JSON.stringify(snapshot));
    await Promise.all(background); background.length = 0;
    const stale = await request(false); assert.equal(stale.stale, true); assert.equal(background.length, 1); await Promise.all(background);
  } finally { sqlite.close(); }
});
await test('五账号两批刷新均不超过40次，上一批预算失败账号能优先补读且响应顺序不变', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(path.join(repo, 'schema.sql'), 'utf8'));
  const DB = createD1FromSqlite(sqlite);
  await new DatabaseManager(DB).ensureTables();
  for (let id = 1; id <= 5; id++) sqlite.prepare('INSERT INTO accounts (id,alias,api_key,api_secret,provider) VALUES (?,?,?,?,?)').run(id, `Synthetic ${id}`, `cf:${String(id).repeat(32)}`, `plain:${btoa('budget-contract-token-only')}`, 'cloudflare');
  let calls = 0; const queryAccounts = [];
  globalThis.fetch = async (url, init) => {
    calls++; await delay(1);
    if (String(url).endsWith('/graphql')) queryAccounts.push(/accountTag:"(\d)\d+"/.exec(JSON.parse(init.body).query)?.[1]);
    return normalFetch(url, init);
  };
  const env = { DB, ADMIN_TOKEN: 'offline-budget-only' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const request = () => worker.fetch(new Request('https://offline.invalid/api/cf/quota?force=1', { headers: { Authorization: 'Bearer offline-budget-only' } }), env, ctx).then(response => response.json());
  try {
    const first = await request();
    assert.equal(first.success, true); assert.ok(calls <= 40); assert.equal(calls, 40);
    const failed = first.accounts.filter(account => account.traffic.issues?.workers?.message.includes('读取预算已用尽'));
    assert.ok(failed.length > 0);
    const before = calls; queryAccounts.length = 0;
    const second = await request();
    assert.equal(calls - before, 40);
    assert.deepEqual(first.accounts.map(account => account.account_id), [1, 2, 3, 4, 5]);
    assert.deepEqual(second.accounts.map(account => account.account_id), [1, 2, 3, 4, 5]);
    for (const account of failed) {
      const retried = second.accounts.find(item => item.account_id === account.account_id);
      assert.equal(retried.traffic.workers[0].requests, 30);
      assert.equal(retried.traffic.issues?.workers, undefined);
    }
    assert.equal(queryAccounts[0], String(first.accounts.find(account => Object.values(account.traffic.issues ?? {}).some(issue => issue.message.includes('读取预算已用尽')) || Object.values(account.inventory_issues ?? {}).some(issue => issue.message.includes('读取预算已用尽'))).account_id));
    assert.ok(!JSON.stringify(second).includes('budget-contract-token-only'));
  } finally { sqlite.close(); }
});
console.log(`\n${passed}/22 通过；含真实workerd运行时，外部读取均拦截为本地合成响应，无真实网络、登录或业务写入。`);
