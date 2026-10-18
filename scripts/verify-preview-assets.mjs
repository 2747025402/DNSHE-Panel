/** Fixed-build static acceptance. No credentials, login, business writes or deployment.
 * ASSET_VERIFY_ORIGIN selects one explicitly allowed instance (default: production).
 * ASSET_VERIFY_REPORT may store the audit outside the source repository.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { request } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.ASSET_VERIFY_ORIGIN || 'https://shydns.cc.cd';
assert(['https://shydns.cc.cd', 'https://1.shydns.cc.cd', 'https://2.shydns.cc.cd', 'https://3.shydns.cc.cd'].includes(target), 'Target must be an explicitly scoped instance.');
const reportPath = process.env.ASSET_VERIFY_REPORT ? path.resolve(process.env.ASSET_VERIFY_REPORT) : null;
if (reportPath) {
  const relative = path.relative(repo, reportPath);
  assert(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Audit must remain outside the source repository.');
}
const report = { target, at: new Date().toISOString(), resources: [], passed: false };
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const refs = html => [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)].map(match => match[1]).sort();
const client = await request.newContext({ proxy: { server: 'http://127.0.0.1:7890' }, extraHTTPHeaders: { 'accept-encoding': 'identity' } });
try {
  const response = await client.get(target + '/', { timeout: 30_000, maxRetries: 1 });
  assert.equal(response.status(), 200);
  const remote = refs(await response.text());
  const local = refs(fs.readFileSync(path.join(repo, 'frontend/dist/index.html'), 'utf8'));
  assert.equal(local.length, 2);
  assert.deepEqual(remote, local, 'Target HTML must reference the current fixed build.');
  report.html_status = response.status();
  for (const resource of local) {
    const asset = await client.get(target + resource, { timeout: 30_000, maxRetries: 1 });
    assert.equal(asset.status(), 200);
    const buffer = await asset.body();
    const expected = fs.readFileSync(path.join(repo, 'frontend/dist', resource));
    assert.equal(buffer.length, expected.length);
    assert.equal(digest(buffer), digest(expected));
    report.resources.push({ path: resource, status: asset.status(), bytes: buffer.length, sha256: digest(buffer) });
  }
  const auth = await client.get(target + '/api/auth/status', { timeout: 30_000, maxRetries: 1 });
  assert.equal(auth.status(), 200);
  report.auth_status = auth.status();
  assert.equal((await auth.json()).initialized, true, 'Target must retain its initialized database.');
  report.passed = true;
} catch (error) { report.failure = String(error.message).slice(0, 700); }
finally {
  await client.dispose();
  const out = reportPath ? path.dirname(reportPath) : path.resolve(repo, '../shots/takeover-current', `fixed-build-static-${report.at.replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(reportPath || path.join(out, 'audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, ...report }, null, 2));
}
if (!report.passed) process.exitCode = 1;
