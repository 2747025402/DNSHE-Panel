/** 真实 Worker 路由 + 内存 SQLite：认证审计不接触真人凭据或远端。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  stdin: { contents: `export {default as worker} from './src/index'; export {createD1FromSqlite} from './server/d1-sqlite'; export {DatabaseManager} from './src/db';`, resolveDir: repo },
  bundle: true, write: false, platform: 'node', target: 'node22', format: 'esm', external: ['cloudflare:sockets'],
});
const { worker, createD1FromSqlite, DatabaseManager } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(path.join(repo, 'schema.sql'), 'utf8'));
const DB = createD1FromSqlite(sqlite);
const env = { DB, AES_KEY: 'synthetic-auth-aes-only' };
const manager = new DatabaseManager(DB, env.AES_KEY);
await manager.ensureTables();
await manager.setPassword('synthetic-admin', 'synthetic-password-only');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Auth regression must not use a network.'); };
const logs = () => sqlite.prepare("SELECT type,category,message FROM logs WHERE category='auth' ORDER BY id").all();
const sessions = () => sqlite.prepare("SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'sess_%'").get().count;
async function request(route, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.20' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await worker.fetch(new Request(`https://synthetic.invalid${route}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  return { status: response.status, data: await response.json() };
}
let passed = 0;
async function test(name, fn) { await fn(); console.log(`  ✓ ${name}`); passed++; }
const credentials = { username: 'synthetic-admin', password: 'synthetic-password-only' };
let token;
try {
  await test('正常登录一次只签发一份会话并写一条成功审计', async () => {
    const result = await request('/api/auth/login', { method: 'POST', body: credentials });
    assert.equal(result.status, 200);
    token = result.data.session_token;
    assert.equal(await manager.validateSession(token), true);
    assert.equal(sessions(), 1);
    assert.equal(logs().length, 1);
    assert.equal(logs()[0].type, 'success');
    assert.match(logs()[0].message, /登录成功/);
  });
  await test('会话恢复、鉴权状态和反复读取日志不会生成登录审计或新会话', async () => {
    const before = logs();
    for (let n = 0; n < 3; n++) {
      for (const route of ['/api/auth/status', '/api/auth/account', '/api/logs']) {
        const result = await request(route, { token });
        assert.equal(result.status, 200, route);
      }
    }
    assert.deepEqual(logs(), before);
    assert.equal(sessions(), 1);
  });
  await test('错误密码保留失败日志，不生成成功记录或新会话', async () => {
    const result = await request('/api/auth/login', { method: 'POST', body: { ...credentials, password: 'synthetic-wrong-password' } });
    assert.equal(result.status, 401);
    assert.equal(result.data.error_code, 'invalid_credentials');
    assert.equal(logs().length, 2);
    assert.equal(logs().at(-1).type, 'warning');
    assert.match(logs().at(-1).message, /登录失败/);
    assert.equal(sessions(), 1);
  });
  await test('独立的再次真实登录仍单独记录，不按用户名时间窗吞审计', async () => {
    const result = await request('/api/auth/login', { method: 'POST', body: credentials });
    assert.equal(result.status, 200);
    assert.notEqual(result.data.session_token, token);
    assert.equal(logs().filter(row => row.type === 'success').length, 2);
    assert.equal(sessions(), 2);
  });
  await test('启用2FA时缺动态码不误写成功，错误动态码保留失败', async () => {
    await manager.setTwoFaSecret('JBSWY3DPEHPK3PXP');
    await manager.setTwoFaEnabled(true);
    const before = logs().length;
    const missing = await request('/api/auth/login', { method: 'POST', body: credentials });
    assert.equal(missing.data.error_code, 'need_2fa');
    assert.equal(logs().length, before);
    // 非六位输入稳定无效，不依赖当前TOTP时间窗口。
    const invalid = await request('/api/auth/login', { method: 'POST', body: { ...credentials, token: 'invalid' } });
    assert.equal(invalid.data.error_code, 'invalid_2fa');
    assert.equal(logs().length, before + 1);
    assert.equal(logs().at(-1).type, 'warning');
    assert.equal(sessions(), 2);
  });
  await test('退出保留注销审计且对应会话立即失效', async () => {
    const before = logs().length;
    const result = await request('/api/auth/logout', { method: 'POST', token });
    assert.equal(result.status, 200);
    assert.equal(await manager.validateSession(token), false);
    assert.equal(logs().length, before + 1);
    assert.equal(logs().at(-1).type, 'info');
    assert.match(logs().at(-1).message, /注销/);
    assert.equal((await request('/api/auth/account', { token })).status, 403);
  });
} finally { globalThis.fetch = originalFetch; sqlite.close(); }
console.log(`\n${passed}/6 通过；真实路由、内存SQLite、无真人登录、无网络与业务数据写入。`);
