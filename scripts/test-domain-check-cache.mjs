// Offline only: no upstream WHOIS requests or account credentials.
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

const source = fs.readFileSync(new URL("../frontend/src/DomainCheckCacheModel.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const model = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const { shortDomainPreset, domainSequenceCharacters, domainSequenceRange, makeDomainCheckRecord, mergeDomainCheckRecord, readDomainCheckCache, saveDomainCheckCache, findReusableDomainCheck } = model;
const target = { domain: "a1.example.invalid", subdomain: "a1", rootdomain: "example.invalid" };
const now = "2026-10-18T10:00:00.000Z";
let passed = 0;
const test = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };

test("two/three character presets include all mixed letter and digit combinations", () => {
  assert.deepEqual(shortDomainPreset(2, "字母数字"), { rule: "", length: 2, seqMode: true, seqCharset: "字母数字", seqLength: 2, seqStart: "", combinations: 1296 });
  assert.equal(shortDomainPreset(3, "字母数字").combinations, 46656);
  assert.equal(shortDomainPreset(2, "字母").combinations, 676);
  assert.equal(shortDomainPreset(3, "数字").rule, "{数字}{数字}{数字}");
});
test("custom alphabets deduplicate legal lowercase characters and retain declared order", () => {
  assert.deepEqual(domainSequenceCharacters("自定义:AaB119!_"), ["a", "b", "1", "9"]);
  assert.equal(domainSequenceRange(2, "自定义:ab01", "b0").remaining, 10n);
  assert.equal(domainSequenceRange(1, "数字", "9").remaining, 1n);
});
test("large ranges use exact integers without generating a combination array", () => {
  const large = domainSequenceRange(63, "字母数字", "");
  assert.equal(large.combinations, 36n ** 63n);
  assert.equal(large.start, "a".repeat(63));
  assert.equal(large.remaining, large.combinations);
  assert.equal(large.error, "");
});
test("invalid lengths and starts are errors instead of silent fallbacks", () => {
  for (const length of [0, 64, 1.5, NaN]) assert(domainSequenceRange(length, "数字", "").error);
  assert(domainSequenceRange(2, "字母", "a1").error);
  assert(domainSequenceRange(2, "字母", "a").error);
  assert(domainSequenceRange(2, "自定义:", "").error);
});
test("registered false requires a successful structured WHOIS response", () => {
  assert.equal(makeDomainCheckRecord(target, { success: true, whois: { registered: false, status: "available" } }, 200, now).outcome, "available");
  assert.equal(makeDomainCheckRecord(target, { success: false, whois: { registered: false } }, 200, now).outcome, "error");
  assert.equal(makeDomainCheckRecord(target, { success: true, whois: { success: false, registered: false } }, 200, now).outcome, "error");
  assert.equal(makeDomainCheckRecord(target, { success: true, whois: {} }, 200, now).outcome, "unknown");
});
test("only explicit upstream fields prove reserved/prohibited; a failed request never does", () => {
  assert.equal(makeDomainCheckRecord(target, { success: true, whois: { registered: false, status: "reserved" } }, 200, now).outcome, "reserved");
  assert.equal(makeDomainCheckRecord(target, { success: true, whois: { status: "registration_prohibited" } }, 200, now).outcome, "prohibited");
  assert.equal(makeDomainCheckRecord(target, { success: true, whois: { registered: false, status: "unavailable" } }, 200, now).outcome, "unavailable");
  assert.equal(makeDomainCheckRecord(target, { success: false, message: "域名可能被官方保留" }, 503, now).outcome, "error");
  assert.equal(makeDomainCheckRecord(target, { success: false, error_code: "rate_limited" }, 429, now).outcome, "error");
});
test("refresh merges the same domain while failures retain previous confirmed evidence", () => {
  const good = makeDomainCheckRecord(target, { success: true, whois: { registered: false, status: "available" } }, 200, now);
  const error = makeDomainCheckRecord(target, { success: false, message: "timeout" }, 504, "2026-10-18T11:00:00.000Z");
  const rows = mergeDomainCheckRecord([good], error);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "error");
  assert.deepEqual(rows[0].lastConfirmed, { outcome: "available", checkedAt: now, upstreamStatus: "available" });
});
test("persistence round trip restores each real domain and timestamp without response secrets", () => {
  const storage = new Map();
  const adapter = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const row = makeDomainCheckRecord(target, { success: true, whois: { registered: true, status: "registered", api_key: "never-save" } }, 200, now);
  assert.equal(saveDomainCheckCache([row], adapter), true);
  assert.deepEqual(readDomainCheckCache(adapter), [row]);
  assert(![...storage.values()].join("").includes("never-save"));
  storage.set(model.DOMAIN_CHECK_CACHE_KEY, "malformed");
  assert.deepEqual(readDomainCheckCache(adapter), []);
});
test("reuse is bounded by age and excludes errors, stale confirmations and future timestamps", () => {
  const row = makeDomainCheckRecord(target, { success: true, whois: { registered: false } }, 200, now);
  assert.equal(findReusableDomainCheck([row], target.domain, Date.parse(now) + 1000)?.outcome, "available");
  assert.equal(findReusableDomainCheck([row], target.domain, Date.parse(now) + 25 * 60 * 60 * 1000), undefined);
  assert.equal(findReusableDomainCheck([row], target.domain, Date.parse(now) - 1000), undefined);
  assert.equal(findReusableDomainCheck([{ ...row, outcome: "error" }], target.domain, Date.parse(now) + 1000), undefined);
});
test("storage quota failure is explicit and does not throw away in-memory results", () => {
  assert.equal(saveDomainCheckCache([], { setItem() { throw new Error("quota"); } }), false);
});
console.log(JSON.stringify({ passed, failed: 0 }));
