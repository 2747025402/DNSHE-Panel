/** 候选边界离线回归：内存数据库、合成凭据与本地解析，不登录或访问实网。 */
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Even a regressed preflight cannot read actual credentials, invoke deployment or access a socket.
const pythonGuard = `import os,runpy,sys
def audit(event,args):
    if event == 'open':
        name = str(args[0]).replace('\\\\','/').lower()
        if name.endswith('/credentials.json') or '/.workbuddy/memory.md' in name:
            raise RuntimeError('Regression attempted credential read')
    if event.startswith(('socket.connect','subprocess.Popen','http.client.connect','urllib.Request')):
        raise RuntimeError('Regression attempted external action')
sys.addaudithook(audit)
script = sys.argv[1]
sys.argv = [script,'--check-target']
runpy.run_path(script,run_name='__main__')`;
function preflight(overrides, script = path.join(repo, 'scripts/deploy-preview.py')) {
  const env = { ...process.env };
  for (const key of ['PREVIEW_HOSTNAME', 'PREVIEW_WORKER', 'PREVIEW_CONFIG']) delete env[key];
  return spawnSync('python', ['-X', 'utf8', '-c', pythonGuard, script], {
    cwd: repo, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10_000,
  });
}
const candidate2 = { PREVIEW_HOSTNAME: '2.shydns.cc.cd', PREVIEW_WORKER: 'dnshe-panel-preview-2', PREVIEW_CONFIG: 'wrangler.preview2.toml' };
const candidate3 = { PREVIEW_HOSTNAME: '3.shydns.cc.cd', PREVIEW_WORKER: 'dnshe-panel-preview-3', PREVIEW_CONFIG: 'wrangler.preview3.toml' };
await test('候选1/2/3完整目标可离线预检，且在凭据读取与网络前结束', () => {
  for (const target of [{}, candidate2, candidate3]) {
    const result = preflight(target);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout.trim());
    assert.equal(data.credentials_read, false);
    assert.equal(data.read_only, true);
    assert.equal(data.cron, false);
    assert.equal(data.hostname, target.PREVIEW_HOSTNAME || '1.shydns.cc.cd');
    assert.equal(data.worker, target.PREVIEW_WORKER || 'dnshe-panel-preview');
    assert.equal(data.config, target.PREVIEW_CONFIG || 'wrangler.preview.toml');
  }
});
await test('拒绝生产目标、候选交叉组合与单项覆盖，不读取凭据或部署', () => {
  for (const target of [
    ...[candidate2, candidate3].flatMap(candidate => [
      { ...candidate, PREVIEW_HOSTNAME: 'shydns.cc.cd' },
      { ...candidate, PREVIEW_WORKER: 'dnshe-panel' },
      { ...candidate, PREVIEW_CONFIG: 'wrangler.toml' },
      { ...candidate, PREVIEW_HOSTNAME: '1.shydns.cc.cd' },
      ...Object.entries(candidate).map(([key, value]) => ({ [key]: value })),
    ]),
    { ...candidate3, PREVIEW_HOSTNAME: candidate2.PREVIEW_HOSTNAME },
    { ...candidate3, PREVIEW_WORKER: candidate2.PREVIEW_WORKER },
    { ...candidate3, PREVIEW_CONFIG: candidate2.PREVIEW_CONFIG },
    { ...candidate2, PREVIEW_HOSTNAME: candidate3.PREVIEW_HOSTNAME },
    { ...candidate2, PREVIEW_WORKER: candidate3.PREVIEW_WORKER },
    { ...candidate2, PREVIEW_CONFIG: candidate3.PREVIEW_CONFIG },
  ]) {
    const result = preflight(target);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /候选目标三元组不一致或不在白名单/);
    assert.doesNotMatch(result.stderr, /Regression attempted/);
  }
});
await test('目标配置名称、只读变量与Cron必须同时满足，不仅检查环境白名单', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'dnshe-preview-guard-'));
  try {
    mkdirSync(path.join(fixture, 'scripts'));
    const script = path.join(fixture, 'scripts/deploy-preview.py');
    copyFileSync(path.join(repo, 'scripts/deploy-preview.py'), script);
    for (const candidate of [candidate2, candidate3]) {
      const valid = readFileSync(path.join(repo, candidate.PREVIEW_CONFIG), 'utf8');
      for (const config of [
        valid.replace(`name = "${candidate.PREVIEW_WORKER}"`, 'name = "dnshe-panel"'),
        valid.replace('PREVIEW_READ_ONLY = "1"', 'PREVIEW_READ_ONLY = "0"'),
        `${valid}\n[triggers]\ncrons = ["0 3 * * *"]\n`,
      ]) {
        writeFileSync(path.join(fixture, candidate.PREVIEW_CONFIG), config);
        const result = preflight(candidate, script);
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.match(result.stdout, /候选配置/);
        assert.doesNotMatch(result.stderr, /Regression attempted/);
      }
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
await test('候选3沿用生产D1/KV与静态资源绑定，关闭临时URL且不声明域名路由或Cron', () => {
  const inspect = `import json,sys,tomllib\nwith open(sys.argv[1],'rb') as file: print(json.dumps(tomllib.load(file)))`;
  const configs = ['wrangler.toml', candidate3.PREVIEW_CONFIG].map(config => {
    const result = spawnSync('python', ['-X', 'utf8', '-c', inspect, path.join(repo, config)], {
      cwd: repo, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  });
  const [production, candidate] = configs;
  for (const key of ['main', 'compatibility_date', 'assets', 'd1_databases', 'kv_namespaces']) {
    assert.deepEqual(candidate[key], production[key], key);
  }
  assert.equal(candidate.workers_dev, false);
  assert.equal(candidate.preview_urls, false);
  assert.equal(candidate.route, undefined);
  assert.equal(candidate.routes, undefined);
  assert.equal(candidate.triggers, undefined);
  assert.equal(candidate.vars.PREVIEW_READ_ONLY, '1');
});

const bundle = await build({
  stdin: { contents: `export {default as worker} from './src/index'; export {createD1FromSqlite} from './server/d1-sqlite'; export {DatabaseManager,encryptText} from './src/db';`, resolveDir: repo },
  bundle: true, write: false, platform: 'node', target: 'node22', format: 'esm', external: ['cloudflare:sockets'],
});
const { worker, createD1FromSqlite, DatabaseManager, encryptText } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(path.join(repo, 'schema.sql'), 'utf8'));
const DB = createD1FromSqlite(sqlite);
const aes = '51'.repeat(32);
const manager = new DatabaseManager(DB, aes);
assert.equal(await manager.ensureTables(), true);
const token = await manager.createSession();
for (const id of [1, 2]) {
  sqlite.prepare('INSERT INTO accounts (id,alias,api_key,api_secret,provider) VALUES (?,?,?,?,?)')
    .run(id, `Synthetic ${id}`, `synthetic-binding-${id}`, await encryptText('synthetic-binding-secret', aes), 'dnshe');
}
await manager.upsertApiKey({ accountId: 1, keyId: 11, keyName: 'Old name', apiKey: 'synthetic-existing', apiSecret: 'synthetic-reveal-only', status: 'active', requestCount: 2 });
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async (url, init) => {
  fetchCalls++;
  const target = new URL(url);
  assert.equal(target.origin, 'https://api005.dnshe.com');
  assert.equal(target.pathname, '/index.php');
  assert.equal(target.searchParams.get('endpoint'), 'keys');
  assert.equal(target.searchParams.get('action'), 'list');
  assert.equal(init.method, 'GET');
  const account = new Headers(init.headers).get('X-API-Key');
  const keys = account === 'synthetic-binding-1'
    ? [{ id: 11, key_name: 'Updated name', api_key: 'synthetic-existing', status: 'active', request_count: 19 }, { id: 12, key_name: 'New key', api_key: 'synthetic-new', status: 'active', request_count: 3 }]
    : [{ id: 21, key_name: 'Second account', api_key: 'synthetic-second', status: 'active', request_count: 4 }];
  return Response.json({ success: true, keys });
};
const env = { DB, AES_KEY: aes, PREVIEW_READ_ONLY: '1' };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const keysSnapshot = () => sqlite.prepare('SELECT * FROM api_keys ORDER BY id').all();
const businessSnapshot = () => ['accounts', 'api_keys', 'domains_cache', 'settings', 'logs']
  .map(table => sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
async function request(route, { method = 'GET', body, authenticated = true, bindings = env } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated) headers.Authorization = `Bearer ${token}`;
  const response = await worker.fetch(new Request(`https://2.shydns.cc.cd${route}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
  }), bindings, ctx);
  return { status: response.status, data: await response.json() };
}
try {
  await test('候选实时keys单账号/全部视图读取新值，但不更新或插入共享api_keys', async () => {
    const before = keysSnapshot();
    const one = await request('/api/keys?account_id=1');
    assert.equal(one.status, 200);
    assert.equal(one.data.preview_read_only, true);
    assert.equal(one.data.keys.find(key => key.api_key === 'synthetic-existing').request_count, 19);
    assert.equal(one.data.keys.find(key => key.api_key === 'synthetic-existing').has_secret, true);
    assert.ok(one.data.keys.some(key => key.api_key === 'synthetic-new'));
    const all = await request('/api/keys?account_id=all');
    assert.equal(all.status, 200);
    assert.equal(all.data.preview_read_only, true);
    assert.equal(all.data.groups.length, 2);
    assert.ok(all.data.groups[1].keys.some(key => key.api_key === 'synthetic-second'));
    assert.deepEqual(keysSnapshot(), before);
  });
  await test('候选本地keys快照同样标识只读，且不会发上游请求', async () => {
    const before = keysSnapshot(), calls = fetchCalls;
    for (const scope of ['1', 'all']) {
      const result = await request(`/api/keys?account_id=${scope}&source=local`);
      assert.equal(result.status, 200);
      assert.equal(result.data.preview_read_only, true);
    }
    assert.equal(fetchCalls, calls);
    assert.deepEqual(keysSnapshot(), before);
  });
  await test('仅已认证POST reveal允许读取合成Secret，不写业务；匿名仍401', async () => {
    const before = businessSnapshot(), calls = fetchCalls;
    const options = { method: 'POST', body: { account_id: 1, api_key: 'synthetic-existing' } };
    const revealed = await request('/api/keys/reveal', options);
    assert.equal(revealed.status, 200);
    assert.equal(revealed.data.api_secret, 'synthetic-reveal-only');
    assert.deepEqual(businessSnapshot(), before);
    const anonymous = await request('/api/keys/reveal', { ...options, authenticated: false });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.data.api_secret, undefined);
    assert.equal(fetchCalls, calls);
  });
  await test('backfill/创建/轮换/删除/设置/注册/清日志仍403，且无上游或业务写入', async () => {
    const before = businessSnapshot(), calls = fetchCalls;
    for (const [route, body, method = 'POST'] of [
      ['/api/keys/backfill', {}],
      ...['create', 'regenerate', 'delete'].map(action => ['/api/keys', { account_id: 1, action, key_id: 11, key_name: 'Forbidden' }]),
      ['/api/settings', { settings: { forbidden: true } }],
      ['/api/domains/register', { account_id: 1, subdomain: 'forbidden', rootdomain: 'invalid' }],
      ['/api/logs/clear', {}],
      ['/api/keys/reveal', { account_id: 1, api_key: 'synthetic-existing' }, 'PUT'],
      ['/api/keys/reveal/extra', {}],
    ]) {
      const result = await request(route, { method, body });
      assert.equal(result.status, 403, route);
      assert.equal(result.data.error_code, 'preview_read_only', route);
      assert.equal(result.data.api_secret, undefined);
    }
    assert.equal(fetchCalls, calls);
    assert.deepEqual(businessSnapshot(), before);
  });
  await test('生产模式GET keys仍登记实时状态且保持Secret，不误伤日用行为', async () => {
    const result = await request('/api/keys?account_id=1', { bindings: { DB, AES_KEY: aes } });
    assert.equal(result.status, 200);
    assert.equal(result.data.preview_read_only, undefined);
    const keys = await manager.listStoredApiKeys(1);
    assert.equal(keys.find(key => key.apiKey === 'synthetic-existing').requestCount, 19);
    assert.equal(keys.find(key => key.apiKey === 'synthetic-existing').keyName, 'Updated name');
    assert.ok(keys.some(key => key.apiKey === 'synthetic-new'));
    assert.equal(await manager.revealApiKeySecret(1, 'synthetic-existing'), 'synthetic-reveal-only');
  });
} finally { globalThis.fetch = originalFetch; sqlite.close(); }
console.log(`\n${passed}/9 通过；无真实凭据读取、网络、登录或部署，业务数据仅存在于内存SQLite。`);
