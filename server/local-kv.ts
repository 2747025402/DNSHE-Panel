/**
 * Minimal Cloudflare KV-compatible store for the Node/Docker runtime.
 *
 * The Worker uses ASSIST_KV for the assist snapshot and CF usage snapshot.
 * A Docker deployment has no KV binding, so keep the same contract in the
 * existing SQLite file instead of making those features fail closed.
 */
import type { SqliteDatabase } from "./d1-sqlite";

type PutOptions = { expiration?: number; expirationTtl?: number };

export class LocalKvNamespace {
  constructor(private readonly sqlite: SqliteDatabase) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at);
    `);
  }

  async get(key: string, type: "text" | "json" = "text"): Promise<string | unknown | null> {
    const row = this.sqlite.prepare(
      "SELECT value, expires_at FROM kv_store WHERE key = ?1"
    ).get(key) as { value?: string; expires_at?: number | null } | undefined;
    if (!row?.value) return null;
    if (row.expires_at != null && row.expires_at <= Math.floor(Date.now() / 1000)) {
      this.sqlite.prepare("DELETE FROM kv_store WHERE key = ?1").run(key);
      return null;
    }
    if (type === "json") {
      try { return JSON.parse(row.value); } catch { return null; }
    }
    return row.value;
  }

  async put(key: string, value: string, options?: PutOptions): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = options?.expirationTtl;
    const expiresAt = options?.expiration ?? (ttl && ttl > 0 ? now + ttl : null);
    this.sqlite.prepare(
      `INSERT INTO kv_store(key, value, expires_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
    ).run(key, value, expiresAt);
  }

  async delete(key: string): Promise<void> {
    this.sqlite.prepare("DELETE FROM kv_store WHERE key = ?1").run(key);
  }
}
