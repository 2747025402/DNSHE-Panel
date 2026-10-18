// Offline regression: synthetic accounts only; no login, network or production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = fs.readFileSync(new URL('../frontend/src/CfQuotaModel.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { buildQuotaModel, readAccount } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const today = '2026-10-17';
const limits = { workersRequestsPerDay: 100000, d1RowsReadPerDay: 5000000, d1RowsWrittenPerDay: 100000, d1StorageBytes: 5000000000 };
const account = (id, requests) => ({
  account_id: id, alias: `account-${id}@example.invalid`, cf_account_name: `Synthetic ${id}`,
  counts: { zones: id, d1_databases: 1, kv_namespaces: 0, r2_buckets: 0, worker_scripts: 1, pages_projects: 0, tunnels: 0 },
  storage: { d1_bytes: id * 1000, d1_detail: [{ name: `db-${id}`, bytes: id * 1000, tables: 1 }] },
  traffic: { workers: [{ date: '2026-10-16', requests: id * 50 }, { date: today, requests }], d1: [{ date: today, rowsRead: id * 10000, rowsWritten: id * 100 }], kv: [], r2_ops: [], r2_storage: null },
  d1_names: [], kv_names: [], r2_names: [], pages_names: [],
});
const tests = [];
const test = (name, run) => { run(); tests.push(name); console.log(`PASS ${name}`); };
const a = account(1, 1000), b = account(2, 90000);

test('account focus changes KPI, trend and high-usage status together', () => {
  const one = buildQuotaModel([a, b], 1, today, limits), two = buildQuotaModel([a, b], 2, today, limits);
  assert.equal(one.metrics[0].value, 1000); assert.equal(two.metrics[0].value, 90000);
  assert.equal(one.days.at(-1).value, 1000); assert.equal(two.days.at(-1).value, 90000);
  assert.equal(one.high, 0); assert.equal(two.high, 1);
  assert.equal(one.metrics[0].pct, 1); assert.equal(two.metrics[0].pct, 90);
});
test('all-account totals have coverage, never a pooled-capacity percentage', () => {
  const all = buildQuotaModel([a, b], 'all', today, limits);
  assert.equal(all.metrics[0].value, 91000); assert.equal(all.metrics[0].coverage, 2);
  assert.ok(all.metrics.every((metric) => metric.pct === null));
  assert.equal(buildQuotaModel([a], 'all', today, limits).metrics[0].pct, null);
  assert.deepEqual(all.metrics[0].highest, { alias: b.alias, pct: 90 });
});
test('highest individual account pressure is absent for unknown or zero limits and ignores failed accounts', () => {
  const failed = { ...account(6, 999999), error: 'Synthetic read failure' };
  assert.deepEqual(buildQuotaModel([a, failed], 'all', today, limits).metrics[0].highest, { alias: a.alias, pct: 1 });
  assert.equal(buildQuotaModel([a], 'all', today, null).metrics[0].highest, null);
  assert.equal(buildQuotaModel([a], 'all', today, { ...limits, workersRequestsPerDay: 0 }).metrics[0].highest, null);
});
test('missing today never silently falls back to yesterday', () => {
  const stale = account(3, 99); stale.traffic.workers = [{ date: '2026-10-16', requests: 99000 }];
  const model = buildQuotaModel([stale], 3, today, limits);
  assert.equal(model.metrics[0].value, null); assert.equal(model.metrics[0].state, 'pending');
  assert.equal(model.pending, 1); assert.equal(model.days.at(-1).value, null);
  assert.equal(model.days.at(-2).value, 99000);
});
test('null is unavailable; true zero remains zero and contributes coverage', () => {
  const unknown = account(4, 10); unknown.traffic.workers = null;
  const zero = account(5, 0);
  assert.equal(readAccount(unknown, today, limits).metrics.requests.state, 'unavailable');
  const model = buildQuotaModel([unknown, zero], 'all', today, limits);
  assert.equal(model.metrics[0].value, 0); assert.equal(model.metrics[0].coverage, 1);
  assert.equal(model.days.at(-1).sources[0].value, null); assert.equal(model.days.at(-1).sources[1].value, 0);
});
test('failed accounts stay visible and never contribute cached values to totals', () => {
  const failed = { ...account(6, 80000), error: 'Synthetic read failure' };
  const model = buildQuotaModel([a, failed], 'all', today, limits);
  assert.equal(model.rows.length, 2); assert.equal(model.failed, 1);
  assert.equal(model.metrics[0].value, 1000); assert.equal(model.metrics[0].coverage, 1);
  assert.equal(model.rows[1].metrics.requests.value, null); assert.equal(model.rows[1].maxUsage, null);
  assert.equal(buildQuotaModel([a, failed], 6, today, limits).failed, 1);
});
test('no resource records are not reported as missing permissions', () => {
  const empty = account(7, 0); empty.counts.worker_scripts = 0; empty.counts.d1_databases = 0;
  empty.traffic.workers = []; empty.traffic.d1 = []; empty.storage = { d1_bytes: 0, d1_detail: [] };
  const row = readAccount(empty, today, limits);
  assert.ok(Object.values(row.metrics).every((reading) => reading.state === 'no-resource'));
  assert.equal(row.unavailable, false); assert.equal(row.pending, false); assert.equal(row.high, false);
  assert.equal(row.metrics.storage.value, null);
});
test('explicitly missing numeric fields are not converted to zero', () => {
  const incomplete = account(8, 30); incomplete.traffic.workers = [{ date: today }];
  const model = buildQuotaModel([incomplete], 8, today, limits);
  assert.equal(model.metrics[0].value, null); assert.equal(model.days.at(-1).value, null);
});
test('partial day totals do not generate false spike multiples', () => {
  const partial = account(9, 70000); partial.traffic.workers = [{ date: today, requests: 70000 }];
  const model = buildQuotaModel([a, partial], 'all', today, limits);
  assert.equal(model.multiple, null); assert.equal(model.days.length, 7);
  assert.deepEqual(model.days.map((day) => day.date), [...model.days.map((day) => day.date)].sort());
});
test('twenty-account datasets preserve stable identities and selected scope', () => {
  const accounts = Array.from({ length: 20 }, (_, index) => account(index + 1, index * 100));
  const model = buildQuotaModel(accounts, 'all', today, limits);
  assert.equal(model.rows.length, 20); assert.equal(new Set(model.rows.map((row) => row.account.account_id)).size, 20);
  assert.equal(buildQuotaModel(accounts, 20, today, limits).metrics[0].value, 1900);
});
test('D1 pressure is detected independently of a low Workers count', () => {
  const d1Heavy = account(21, 0);
  d1Heavy.traffic.d1 = [{ date: today, rowsRead: 4900000, rowsWritten: 0 }];
  const row = readAccount(d1Heavy, today, limits);
  assert.equal(row.maxUsage, 98); assert.equal(row.maxMetric, 'D1 行读'); assert.equal(row.high, true);
});
test('absent or zero limits never create Infinity or invented usage percentages', () => {
  assert.equal(buildQuotaModel([a], 1, today, null).metrics[0].pct, null);
  assert.equal(buildQuotaModel([a], 1, today, { ...limits, workersRequestsPerDay: 0 }).metrics[0].pct, null);
});
test('existing KV read pressure remains visible and never uses yesterday', () => {
  const kvHeavy = account(23, 0);
  kvHeavy.traffic.d1 = [{ date: today, rowsRead: 0, rowsWritten: 0 }];
  kvHeavy.traffic.kv = [{ date: today, read: 90000, write: 0, delete: 0, list: 0 }];
  const row = readAccount(kvHeavy, today, { ...limits, kvReadsPerDay: 100000 });
  assert.equal(row.maxMetric, 'KV 读取'); assert.equal(row.maxUsage, 90); assert.equal(row.high, true);
  kvHeavy.traffic.kv[0].date = '2026-10-16';
  assert.notEqual(readAccount(kvHeavy, today, { ...limits, kvReadsPerDay: 100000 }).maxMetric, 'KV 读取');
});
test('KV null or missing today participates in completeness even when four KPIs are ready', () => {
  const kvUnknown = account(24, 100);
  kvUnknown.counts.kv_namespaces = 1;
  kvUnknown.traffic.kv = null;
  let row = readAccount(kvUnknown, today, limits);
  assert.ok(Object.values(row.metrics).every((reading) => reading.state === 'ready'));
  assert.equal(row.kvRead.state, 'unavailable'); assert.equal(row.unavailable, true); assert.equal(row.pending, false);
  assert.equal(buildQuotaModel([kvUnknown], 24, today, limits).unavailable, 1);
  kvUnknown.traffic.kv = [{ date: '2026-10-16', read: 500 }];
  row = readAccount(kvUnknown, today, limits);
  assert.equal(row.kvRead.value, null); assert.equal(row.kvRead.state, 'pending'); assert.equal(row.pending, true);
  assert.equal(row.unavailable, false);
  kvUnknown.traffic.kv = []; kvUnknown.counts.kv_namespaces = 0;
  row = readAccount(kvUnknown, today, limits);
  assert.equal(row.kvRead.state, 'no-resource'); assert.equal(row.pending, false); assert.equal(row.unavailable, false);
});
test('historical peak multiple excludes the incomplete UTC today from its full-day baseline', () => {
  const history = account(25, 0);
  history.traffic.workers = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${11 + index}`, requests: index === 6 ? 0 : index === 2 ? 300 : 100 }));
  const model = buildQuotaModel([history], 25, today, limits);
  assert.equal(model.peak.date, '2026-10-13'); assert.equal(model.peak.ended, true);
  assert.equal(model.multiple, 3); assert.equal(model.days.at(-1).ended, false);
});
test('today peak remains an incomplete-day cumulative value against completed historical days', () => {
  const history = account(26, 0);
  history.traffic.workers = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${11 + index}`, requests: index === 6 ? 300 : 100 }));
  const model = buildQuotaModel([history], 26, today, limits);
  assert.equal(model.peak.date, today); assert.equal(model.peak.ended, false); assert.equal(model.multiple, 3);
});
test('all-failed scopes stay unknown and produce no fake zero peak', () => {
  const failed = { ...account(22, 99999), error: 'Synthetic failure' };
  const model = buildQuotaModel([failed], 'all', today, limits);
  assert.ok(model.metrics.every((metric) => metric.value === null && metric.coverage === 0));
  assert.ok(model.days.every((day) => day.value === null)); assert.equal(model.peak, null);
});
test('failed queries with preserved cache remain labelled stale and cannot produce a fresh peak multiple', () => {
  const cached = account(27, 1234);
  cached.traffic.issues = { workers: { kind: 'timeout', message: 'Synthetic timeout', cached_at: '2026-10-17T06:00:00.000Z' } };
  const model = buildQuotaModel([cached], 27, today, limits);
  assert.equal(model.rows[0].metrics.requests.state, 'cached');
  assert.equal(model.rows[0].metrics.requests.cachedAt, '2026-10-17T06:00:00.000Z');
  assert.equal(model.metrics[0].value, 1234); assert.equal(model.metrics[0].cached, 1);
  // A stale value is still readable.  Keep it visible as cached, but do not
  // inflate the unreadable/attention count (the UI must not call this
  // “部分不可读”).
  assert.equal(model.unavailable, 0); assert.equal(model.cached, 1); assert.equal(model.days.at(-1).cached, 1);
  assert.equal(model.multiple, null);
  delete cached.traffic.issues.workers.cached_at;
  assert.equal(buildQuotaModel([cached], 27, today, limits).metrics[0].value, null);
});
test('inventory failures never masquerade as empty resources or zero storage', () => {
  const broken = account(28, 0);
  broken.counts.d1_databases = 0; broken.traffic.d1 = [];
  broken.storage = { d1_bytes: 0, d1_detail: [] };
  broken.inventory_issues = { d1_databases: { kind: 'permission', message: 'Synthetic permission failure' } };
  const row = readAccount(broken, today, limits);
  assert.equal(row.metrics.rowsRead.state, 'unavailable'); assert.equal(row.metrics.storage.state, 'unavailable');
  assert.equal(row.metrics.storage.value, null); assert.equal(row.unavailable, true);
});
test('explicitly disabled R2 is a service fact, not partial unreadability; legacy 10042 stays compatible', () => {
  for (const issue of [
    { kind: 'not_enabled', message: 'Please enable R2 through the Cloudflare Dashboard.' },
    { kind: 'permission', code: 10042, message: 'Account not entitled to this feature.' },
    { kind: 'permission', message: 'Please enable R2 through the Cloudflare Dashboard.', cached_at: '2026-10-17T00:01:35Z' },
  ]) {
    const disabled = account(29, 30);
    disabled.inventory_issues = { r2_buckets: issue };
    const row = readAccount(disabled, today, limits);
    assert.equal(row.unavailable, false);
    assert.deepEqual(row.notEnabled, ['r2_buckets']);
    assert.equal(buildQuotaModel([disabled], 'all', today, limits).unavailable, 0);
  }
});
test('Pages403, authentication and network failures stay unreadable rather than disabled', () => {
  for (const issue of [
    { kind: 'permission', code: 10000, message: 'Authentication error' },
    { kind: 'authentication', message: 'Token invalid' },
    { kind: 'network', message: 'Connection failed' },
  ]) {
    const failed = account(30, 40);
    failed.inventory_issues = { pages_projects: issue };
    const row = readAccount(failed, today, limits);
    assert.equal(row.unavailable, true);
    assert.deepEqual(row.notEnabled, []);
    assert.equal(row.metrics.requests.value, 40);
  }
});
test('timeout with a preserved value is stale, not unreadable', () => {
  const cached = account(32, 40);
  cached.inventory_issues = { pages_projects: { kind: 'timeout', message: 'Timeout', cached_at: '2026-10-17T06:00:00Z' } };
  const row = readAccount(cached, today, limits);
  assert.equal(row.unavailable, false);
  assert.equal(row.cached, true);
  assert.deepEqual(row.notEnabled, []);
});
test('disabled service never hides an independent pending KV date or R2 operation timeout', () => {
  const mixed = account(31, 50);
  mixed.counts.kv_namespaces = 1;
  mixed.inventory_issues = { r2_buckets: { kind: 'not_enabled', message: 'Please enable R2' } };
  let row = readAccount(mixed, today, limits);
  assert.equal(row.unavailable, false); assert.equal(row.pending, true);
  mixed.traffic.issues = { r2_ops: { kind: 'timeout', message: 'Read timed out', cached_at: '2026-10-17T06:00:00Z' } };
  row = readAccount(mixed, today, limits);
  assert.equal(row.unavailable, false); assert.equal(row.cached, true); assert.equal(row.pending, true);
  assert.deepEqual(row.notEnabled, ['r2_buckets']);
});
console.log(`\n${tests.length} CF quota model regressions passed.`);
