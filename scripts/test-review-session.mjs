/** 合成会话文件/传输，完全离线验证复用边界。 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readReviewSession, validateReviewSession } from './review-session.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'dnshe-session-contract-'));
const repo = path.join(root, 'repo');
mkdirSync(repo);
const filename = path.join(root, 'synthetic-session.json');
const origin = 'https://synthetic.invalid';
const token = 'dnshe_sess_synthetic-only';
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const response = (status, body) => ({ status: () => status, json: async () => body, dispose: async () => {} });
try {
  await test('仓库外目标绑定会话可读取，不要求或读取登录凭据', () => {
    writeFileSync(filename, JSON.stringify({ origin, session_token: token }));
    assert.equal(readReviewSession(repo, origin, filename), token);
    assert.equal(readReviewSession(repo, origin, ''), '');
  });
  await test('拒绝仓库内会话与跨origin复用，错误中不暴露内容或token', () => {
    const inside = path.join(repo, 'session.json');
    writeFileSync(inside, JSON.stringify({ origin, session_token: token }));
    for (const [target, source] of [[origin, inside], ['https://another.invalid', filename]]) {
      assert.throws(() => readReviewSession(repo, target, source), error => !error.message.includes(token) && /正文已隐藏/.test(error.message));
    }
  });
  await test('有效会话仅GET身份，关闭重试/重定向且不登录', async () => {
    let calls = 0;
    const valid = await validateReviewSession({ get: async (url, options) => {
      calls++;
      assert.equal(url, `${origin}/api/auth/account`);
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.maxRetries, 0);
      assert.equal(options.maxRedirects, 0);
      return response(200, { success: true, username: 'synthetic-admin' });
    } }, origin, token);
    assert.equal(valid, true);
    assert.equal(calls, 1);
  });
  await test('只有明确401/403才允许调用方选择一次登录', async () => {
    for (const status of [401, 403]) assert.equal(await validateReviewSession({ get: async () => response(status, {}) }, origin, token), false);
  });
  await test('网络/500/重定向/非JSON及身份形状异常都失败封闭，不触发登录', async () => {
    for (const get of [
      async () => { throw new Error(`unsafe transport ${token}`); },
      async () => response(500, {}), async () => response(302, {}),
      async () => ({ ...response(200, {}), json: async () => { throw new Error(token); } }),
      async () => response(200, { success: true }),
    ]) await assert.rejects(validateReviewSession({ get }, origin, token), error => /未回退登录/.test(error.message) && !error.message.includes(token));
  });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`\n${passed}/5 通过；无真实凭据、网络、登录或会话持久化。`);
