/** 权限定义与诊断文案反例；仅合成数据，不登录、不访问外网。 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({ stdin: { contents: "export {CF_TOKEN_REQUIREMENTS,CF_TOKEN_PERMISSIONS,CF_TOKEN_CREATE_URL,cfIssueSummary,cfAccountDiagnostics} from './frontend/src/CfUsage';", resolveDir: repo }, bundle: true, write: false, platform: 'node', target: 'node22', format: 'esm' });
const { CF_TOKEN_REQUIREMENTS, CF_TOKEN_PERMISSIONS, CF_TOKEN_CREATE_URL, cfIssueSummary, cfAccountDiagnostics } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
let passed = 0;
const test = (name, callback) => { callback(); passed++; console.log(`PASS ${name}`); };
test('手动清单与模板同源、10项无重、保留Pages和Tunnel兼容key', () => {
  const url = new URL(CF_TOKEN_CREATE_URL);
  assert.equal(url.origin, 'https://dash.cloudflare.com');
  assert.equal(url.searchParams.get('accountId'), '*'); assert.equal(url.searchParams.get('zoneId'), 'all');
  const permissions = JSON.parse(url.searchParams.get('permissionGroupKeys'));
  assert.equal(permissions.length, 10); assert.equal(new Set(permissions.map(entry => entry.key)).size, 10);
  assert.deepEqual(permissions, CF_TOKEN_REQUIREMENTS.map(({ key, type }) => ({ key, type })));
  assert.deepEqual(CF_TOKEN_PERMISSIONS, CF_TOKEN_REQUIREMENTS.map(({ scope, permission, purpose }) => [scope, permission, purpose]));
  assert.deepEqual(permissions.find(entry => entry.key === 'page'), { key: 'page', type: 'edit' });
  assert.deepEqual(permissions.find(entry => entry.key === 'argotunnel'), { key: 'argotunnel', type: 'read' });
  assert.ok(permissions.every(entry => Object.keys(entry).sort().join(',') === 'key,type'));
});
test('短诊断不吞原文；R2未开通兼容旧permission快照，不把其它403猜作未启用', () => {
  assert.equal(cfIssueSummary({ kind: 'permission', message: 'Authentication error' }), '权限或范围待核对');
  assert.equal(cfIssueSummary({ kind: 'permission', message: 'Please enable R2 through the Cloudflare Dashboard.' }), '未启用');
  assert.equal(cfIssueSummary({ kind: 'not_enabled', message: 'Account not entitled' }), '未启用');
  assert.equal(cfIssueSummary({ kind: 'permission', code: 10042, message: 'Account not entitled' }), '未启用');
  assert.equal(cfIssueSummary({ kind: 'timeout', message: 'Synthetic timeout' }), '读取超时');
  assert.equal(cfIssueSummary({ kind: 'authentication', message: 'Token expired' }), '认证未通过');
});
test('每个实际数据集都有接口、权限与目标scope；缓存时间和原始错误完整保留', () => {
  const trafficKeys = ['workers', 'd1', 'kv', 'r2_ops', 'r2_storage'];
  const inventoryKeys = ['zones', 'd1_databases', 'kv_namespaces', 'r2_buckets', 'worker_scripts', 'pages_projects', 'tunnels'];
  const issue = { kind: 'permission', message: 'Synthetic original error HTTP 403 / code 10000', http_status: 403, code: 10000, cached_at: '2026-10-17T12:00:00.000Z' };
  const entries = cfAccountDiagnostics({ traffic: { issues: Object.fromEntries(trafficKeys.map(key => [key, issue])) }, inventory_issues: Object.fromEntries(inventoryKeys.map(key => [key, issue])) });
  assert.equal(entries.length, 12);
  for (const entry of entries) { assert.equal(entry.issue, issue); assert.ok(entry.scope); assert.ok(entry.permission); assert.ok(entry.endpoint); }
  assert.equal(entries.find(entry => entry.key === 'pages_projects').permission, 'Account / Pages Edit');
  assert.ok(entries.find(entry => entry.key === 'zones').endpoint.includes('account.id={account_id}'));
  assert.ok(entries.filter(entry => trafficKeys.includes(entry.key)).every(entry => entry.endpoint.startsWith('POST /graphql')));
});
console.log(`${passed}/3 通过；这验证模板与本地定义，不代表已在Cloudflare登录表单核对或既有Token已升级。`);
