// 合成数据；不连接 Cloudflare、不读取真人凭据。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['frontend/src/OverviewCfModel.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { buildOverviewCfUsage } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const today = '2026-10-17';
const limits = { workersRequestsPerDay: 100000, d1RowsReadPerDay: 5000000, kvReadsPerDay: 100000 };
const account = (id, requests) => ({ account_id: id, alias: `合成账号 ${id}`, counts: { worker_scripts: 1, d1_databases: 0, kv_namespaces: 0 }, storage: { d1_detail: [] }, traffic: { workers: [{ date: today, requests }], d1: [], kv: [] } });
const a = account(1, 110000), b = account(2, 0);
const metric = (...args) => buildOverviewCfUsage(...args, today)[0];
let n = 0;
function test(name, check) { check(); console.log(`PASS ${name}`); n++; }
test('110% 与 0% 不得被池化成 55%', () => {
  const value = metric([a, b], limits, 2);
  assert.equal(value.used, 110000); assert.equal(value.limit, 100000); assert(Math.abs(value.highest.pct - 110) < 1e-9); assert.equal(value.highest.alias, a.alias);
  assert.equal('pct' in value, false); assert.equal(value.coverage, 2);
});
test('失败账号不参与合计，覆盖分母保留绑定范围', () => {
  const value = metric([a, { ...b, error: 'synthetic failure' }], limits, 3);
  assert.equal(value.used, 110000); assert.equal(value.coverage, 1); assert.equal(value.total, 3);
});
test('缓存保留来源状态，真实零不丢失', () => {
  const cached = { ...b, traffic: { ...b.traffic, issues: { workers: { kind: 'timeout', cached_at: '2026-10-17T00:00:00Z' } } } };
  const value = metric([cached], limits, 1);
  assert.equal(value.used, 0); assert.equal(value.cached, 1); assert.equal(value.highest.pct, 0);
});
test('今日未知不回退昨日，未知和零不同', () => {
  const old = { ...a, traffic: { ...a.traffic, workers: [{ date: '2026-10-16', requests: 999 }] } };
  const value = metric([old], limits, 1);
  assert.equal(value.used, null); assert.equal(value.highest, null); assert.equal(value.coverage, 0);
});
test('无上限或无账号不制造压力值', () => {
  assert.equal(metric([a], null, 1).highest, null); assert.equal(metric([], limits, 2).used, null);
});
console.log(`${n}/${n} overview CF model passed`);
