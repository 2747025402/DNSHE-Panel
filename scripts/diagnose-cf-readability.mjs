#!/usr/bin/env node
/** Narrow real read audit: one login at most, ordinary snapshot and one explicit force GET.
 * No Cloudflare tokens, raw API bodies, cookies, storageState, HAR or business writes are saved.
 * Default is production, no force. --force explicitly permits one refresh.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'playwright';
import { readReviewSession, validateReviewSession } from './review-session.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.REVIEW_ORIGIN || 'https://shydns.cc.cd';
assert(['https://shydns.cc.cd', 'https://1.shydns.cc.cd', 'https://2.shydns.cc.cd', 'https://3.shydns.cc.cd'].includes(origin), 'Only explicitly scoped DNSHE instances are allowed.');
const args = process.argv.slice(2);
assert(args.every(arg => arg === '--force') && args.length <= 1, 'Only --force is supported.');
const force = args.includes('--force');
const out = path.resolve(repo, '..', 'shots/takeover-current', `cf-readability-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const report = { origin, startedAt: new Date().toISOString(), policy: { loginBudget: 1, forceBudget: force ? 1 : 0, businessWrites: 0, rawBodiesSaved: false, credentialsPersisted: false }, loginAttempts: 0, sessionReused: false, reads: [], failure: null };
const secrets = new Set();
const scrub = value => {
  let text = String(value || '');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]').replace(/[a-f\d]{32}/gi, '[ID]').slice(0, 1300);
};
const issue = entry => entry ? { kind: entry.kind, message: scrub(entry.message), http_status: entry.http_status, code: entry.code, cached_at: entry.cached_at } : undefined;
function summarize(body) {
  return { success: body.success === true, generated_at: body.generated_at || null, cached: body.cached === true, stale: body.stale === true, age_ms: body.age_ms, refresh_error: body.refresh_error ? scrub(body.refresh_error) : null,
    accounts: (body.accounts || []).map((account, index) => ({ ordinal: index + 1, local_account_id: account.account_id, alias: `账号 ${index + 1}`, error: account.error ? scrub(account.error) : null,
      counts: account.counts, inventory_issues: Object.fromEntries(Object.entries(account.inventory_issues || {}).map(([key, entry]) => [key, issue(entry)])),
      traffic: Object.fromEntries(['workers', 'd1', 'kv', 'r2_ops', 'r2_storage'].map(key => [key, { readable: account.traffic?.[key] != null, rows: Array.isArray(account.traffic?.[key]) ? account.traffic[key].length : null,
        dates: Array.isArray(account.traffic?.[key]) ? [...new Set(account.traffic[key].map(row => row.date).filter(Boolean))] : undefined, issue: issue(account.traffic?.issues?.[key]) }])),
    })) };
}
const proxy = process.env.REVIEW_PROXY === 'none' ? undefined : { server: process.env.REVIEW_PROXY || 'http://127.0.0.1:7890' };
const client = await request.newContext({ ...(proxy ? { proxy } : {}), ignoreHTTPSErrors: false, extraHTTPHeaders: { accept: 'application/json', 'accept-encoding': 'identity' } });
let token = '';
try {
  const saved = readReviewSession(repo, origin);
  if (saved && await validateReviewSession(client, origin, saved)) { token = saved; report.sessionReused = true; }
  else {
    let credentials;
    try { credentials = JSON.parse(fs.readFileSync(path.join(repo, '..', 'credentials.json'), 'utf8')).shydns_console; }
    catch { throw new Error('Cannot read login configuration; contents suppressed.'); }
    assert(credentials?.ADMIN_USERNAME && credentials?.ADMIN_PASSWORD, 'Missing login configuration.');
    secrets.add(credentials.ADMIN_USERNAME); secrets.add(credentials.ADMIN_PASSWORD);
    report.loginAttempts++;
    const response = await client.post(`${origin}/api/auth/login`, { data: { username: credentials.ADMIN_USERNAME, password: credentials.ADMIN_PASSWORD, ...(process.env.REVIEW_TOTP ? { token: process.env.REVIEW_TOTP } : {}) }, timeout: 45_000, maxRedirects: 0, maxRetries: 0 });
    const body = await response.json();
    assert(body.success === true && typeof body.session_token === 'string', `Unique login failed HTTP ${response.status()}; not retried.`);
    token = body.session_token; credentials = undefined; secrets.add(token); await response.dispose();
  }
  for (const forced of force ? [false, true] : [false]) {
    const started = Date.now();
    const pathname = `/api/cf/quota${forced ? '?force=1' : ''}`;
    const response = await client.get(origin + pathname, { headers: { authorization: `Bearer ${token}` }, timeout: 45_000, maxRedirects: 0, maxRetries: forced ? 0 : 1 });
    const status = response.status();
    const entry = { method: 'GET', path: pathname, forced, http_status: status, elapsed_ms: Date.now() - started };
    report.reads.push(entry);
    assert.equal(status, 200, `Snapshot GET failed HTTP ${status}; no bypass or repeated login.`);
    Object.assign(entry, summarize(await response.json())); await response.dispose();
    assert(entry.success, 'Snapshot response was not successful.');
  }
} catch (error) { report.failure = scrub(error.message).split('\n')[0]; }
finally {
  token = ''; await client.dispose(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, failure: report.failure, loginAttempts: report.loginAttempts, sessionReused: report.sessionReused, reads: report.reads }, null, 2));
}
if (report.failure) process.exitCode = 1;
