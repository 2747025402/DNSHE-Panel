import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  stdin: { contents: `export { isRenewalCandidate, readRenewedExpiry } from './src/cron';`, resolveDir: repo },
  bundle: true,
  write: false,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["cloudflare:sockets"],
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const now = Date.parse("2026-10-21T00:00:00Z");
const iso = (days) => new Date(now + days * 24 * 60 * 60 * 1000).toISOString();

assert.equal(mod.isRenewalCandidate(undefined, now, 180), false);
assert.equal(mod.isRenewalCandidate("not-a-date", now, 180), false);
assert.equal(mod.isRenewalCandidate(iso(180), now, 180), true);
assert.equal(mod.isRenewalCandidate(iso(181), now, 180), false);
assert.equal(mod.isRenewalCandidate(iso(-1), now, 180), true, "过期域名不能静默漏掉");
assert.equal(mod.readRenewedExpiry({ success: true, new_expires_at: " 2027-01-01 00:00:00 " }), "2027-01-01 00:00:00");
assert.equal(mod.readRenewedExpiry({ success: true, new_expires_at: "" }), null);
assert.equal(mod.readRenewedExpiry({ success: false, new_expires_at: iso(365) }), null);

console.log("renewal rules 8/8 through");
