import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { LocalKvNamespace } from "../dist-node/local-kv.mjs";

const db = new DatabaseSync(":memory:");
const kv = new LocalKvNamespace(db);
await kv.put("assist:snapshot", JSON.stringify({ accounts: [] }));
assert.equal(await kv.get("assist:snapshot"), JSON.stringify({ accounts: [] }));
assert.deepEqual(await kv.get("assist:snapshot", "json"), { accounts: [] });
await kv.put("short", "old", { expirationTtl: 1 });
assert.equal(await kv.get("short"), "old");
await new Promise((resolve) => setTimeout(resolve, 1100));
assert.equal(await kv.get("short"), null);
await kv.delete("assist:snapshot");
assert.equal(await kv.get("assist:snapshot"), null);
console.log("local KV 4/4 through persistent SQLite semantics");
