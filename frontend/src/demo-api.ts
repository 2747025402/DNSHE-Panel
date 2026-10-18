/**
 * GitHub Pages 的合成 API 适配器。
 *
 * 这里只在 VITE_STATIC_DEMO=1 的静态构建中被 App 调用；生产构建仍然走
 * 原有 fetch → Worker 路径。页面组件、业务字段和交互不在这里重写，适配器
 * 只提供一组可重复的只读样本，保证真实前端在没有后端时也能完整展示。
 */

const now = new Date("2026-10-18T09:42:00Z");
const iso = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

const accounts = [
  { id: 1, alias: "主账号", api_key: "dnshe_demo_alpha", provider: "dnshe", created_at: "2026-08-02T08:00:00Z" },
  { id: 2, alias: "项目账号", api_key: "dnshe_demo_beta", provider: "dnshe", created_at: "2026-08-14T08:00:00Z" },
  { id: 3, alias: "备用账号", api_key: "dnshe_demo_gamma", provider: "dnshe", created_at: "2026-09-01T08:00:00Z" },
  { id: 101, alias: "CF · 主工作区", api_key: "cf_demo_alpha", provider: "cloudflare", created_at: "2026-08-03T08:00:00Z" },
  { id: 102, alias: "CF · 备用工作区", api_key: "cf_demo_beta", provider: "cloudflare", created_at: "2026-09-05T08:00:00Z" },
];

const dnsheDomains = [
  [11, 1, "alpha", "cc.cd", "已解析", "2027-03-12", true, "a.ns.dnshe.org", "b.ns.dnshe.org"],
  [12, 1, "studio", "us.ci", "已解析", "2027-01-08", true, "vip7.alidns.com", "vip8.alidns.com"],
  [13, 1, "notes", "de5.net", "未解析", "2027-04-19", false, "a.ns.dnshe.org", "b.ns.dnshe.org"],
  [21, 2, "console", "cc.cd", "已解析", "2027-02-03", true, "a.ns.dnshe.org", "b.ns.dnshe.org"],
  [22, 2, "labs", "ccwu.cc", "已委派", "2027-05-22", false, "cleo.ns.cloudflare.com", "dora.ns.cloudflare.com"],
  [23, 2, "status", "us.ci", "已解析", "2027-06-02", true, "vip7.alidns.com", "vip8.alidns.com"],
  [31, 3, "archive", "ddns.ge", "已解析", "2026-12-26", true, "a.ns.dnshe.org", "b.ns.dnshe.org"],
  [32, 3, "media", "cc.cd", "即将到期", "2026-11-09", true, "a.ns.dnshe.org", "b.ns.dnshe.org"],
].map(([id, account_id, subdomain, rootdomain, status, expires_at, has_dns, ns1, ns2]) => ({
  id, account_id, account_alias: accounts.find((a) => a.id === account_id)?.alias || "账号",
  subdomain, rootdomain, full_domain: `${subdomain}.${rootdomain}`, status,
  created_at: "2026-01-18T08:00:00Z", expires_at: `${expires_at}T00:00:00Z`, last_renewed_at: "2026-01-18T08:00:00Z",
  has_dns, ns1, ns2, dns_provider: has_dns ? "DNSHE" : "Cloudflare", provider_account_id: rootdomain === "us.ci" ? "1" : "7",
  account_provider: "dnshe", remote_id: null,
}));

const cfZones = [
  [201, 101, "shiran", "cc.cd", "active"],
  [202, 101, "product", "us.ci", "active"],
  [203, 102, "archive", "de5.net", "pending"],
  [204, 102, "edge", "ccwu.cc", "active"],
].map(([id, account_id, subdomain, rootdomain, status]) => ({
  id, account_id, account_alias: accounts.find((a) => a.id === account_id)?.alias || "Cloudflare",
  subdomain, rootdomain, full_domain: `${subdomain}.${rootdomain}`, status, created_at: "2026-02-02T08:00:00Z",
  expires_at: "2027-12-31T00:00:00Z", last_renewed_at: null, has_dns: true,
  ns1: "cleo.ns.cloudflare.com", ns2: "dora.ns.cloudflare.com", dns_provider: "Cloudflare",
  provider_account_id: String(account_id), account_provider: "cloudflare", remote_id: `zone-demo-${id}`,
}));

const overview = {
  success: true,
  domains: { total: dnsheDomains.length, active: 7, expired: 0, expiring_soon: 1, delegated: 2, not_delegated: 6 },
  accounts: { total: accounts.length, dnshe: 3, cloudflare: 2 },
  quota: {
    total: 100000, used: 18420, available: 81580, failed: 0,
    accounts: [
      { account_id: 1, alias: "主账号", used: 8240, base: 30000, invite_bonus: 10000, total: 40000, available: 31760, error: null },
      { account_id: 2, alias: "项目账号", used: 6910, base: 30000, invite_bonus: 5000, total: 35000, available: 28090, error: null },
      { account_id: 3, alias: "备用账号", used: 3270, base: 25000, invite_bonus: 0, total: 25000, available: 21730, error: null },
    ],
  },
  assist: { updated_at: iso(18), account_count: 3, assist_remaining: 17, assist_limit: 30, managed_domains: 8, upgraded_domains: 3, non_upgraded_domains: 5 },
};

const quotas = overview.quota.accounts;

const usageDays = (base: number) => Array.from({ length: 7 }, (_, index) => {
  const date = new Date(now.getTime() - (6 - index) * 86_400_000).toISOString().slice(0, 10);
  return { date, requests: base + index * 183 + (index === 5 ? 720 : 0), errors: 4 + index, subrequests: base * 2 + index * 100, rowsRead: base * 3 + index * 300, rowsWritten: base + index * 40 };
});

const cfUsage = [
  { account_id: 101, alias: "CF · 主工作区", cf_account_id: "demo-account-alpha", cf_account_name: "主工作区", counts: { zones: 18, d1_databases: 4, kv_namespaces: 3, r2_buckets: 1, worker_scripts: 7, pages_projects: 3, tunnels: 1 }, storage: { d1_bytes: 18300000, d1_detail: [{ name: "dnshe-main", bytes: 18300000, tables: 12 }] }, traffic: { workers: usageDays(1464), d1: usageDays(320), kv: Array.from({ length: 7 }, (_, i) => ({ date: new Date(now.getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10), read: 820 + i * 40, write: 60 + i * 3, delete: 2, list: 8 })), r2_ops: [{ action: "Class A", requests: 42 }, { action: "Class B", requests: 28 }], r2_storage: { bytes: 182000000, objects: 42 }, d1_names: ["dnshe-main"], kv_names: ["assist-cache", "domain-cache"], r2_names: ["media"], pages_names: ["console", "docs", "status"] } },
  { account_id: 102, alias: "CF · 备用工作区", cf_account_id: "demo-account-beta", cf_account_name: "备用工作区", counts: { zones: 9, d1_databases: 2, kv_namespaces: 1, r2_buckets: 0, worker_scripts: 3, pages_projects: 1, tunnels: 0 }, storage: { d1_bytes: 7200000, d1_detail: [{ name: "dnshe-edge", bytes: 7200000, tables: 5 }] }, traffic: { workers: usageDays(620), d1: usageDays(180), kv: Array.from({ length: 7 }, (_, i) => ({ date: new Date(now.getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10), read: 320 + i * 24, write: 18 + i * 2, delete: 1, list: 3 })), r2_ops: [], r2_storage: null, d1_names: ["dnshe-edge"], kv_names: ["edge-cache"], r2_names: [], pages_names: ["edge"] } },
].map((entry) => ({ ...entry, inventory_issues: {}, traffic: { ...entry.traffic, issues: {} } }));

const logs = [
  { id: 5, type: "success", category: "sync", message: "同步账户配额快照", details: "3 个 DNSHE 账号已完成缓存更新", created_at: iso(46) },
  { id: 4, type: "success", category: "operation", message: "完成 3 个域名委派检查", details: "名称服务器响应正常", created_at: iso(70) },
  { id: 3, type: "warning", category: "renew", message: "发现 1 个域名即将到期", details: "media.cc.cd · 22 天后到期", created_at: iso(1440) },
  { id: 2, type: "info", category: "api", message: "刷新 Cloudflare 用量", details: "覆盖 2 个账号，7 日序列完整", created_at: iso(1880) },
  { id: 1, type: "success", category: "auth", message: "管理员登录成功", details: "静态演示会话", created_at: iso(2200) },
];

const keyRows = (accountId: number, alias: string) => [
  { key_id: accountId * 10 + 1, key_name: `${alias} 主密钥`, api_key: `dnshe_demo_key_${accountId}_alpha`, status: "active", request_count: 1840 + accountId * 121, last_used_at: iso(32), remote_created_at: "2026-08-02T08:00:00Z", has_secret: true },
  { key_id: accountId * 10 + 2, key_name: `${alias} 备用密钥`, api_key: `dnshe_demo_key_${accountId}_beta`, status: "active", request_count: 320 + accountId * 44, last_used_at: iso(420), remote_created_at: "2026-09-12T08:00:00Z", has_secret: true },
];

const keyGroups = accounts.filter((account) => account.provider === "dnshe").map((account) => ({ account_id: account.id, alias: account.alias, keys: keyRows(account.id, account.alias) }));

const assistAccounts = accounts.filter((account) => account.provider === "dnshe").map((account, index) => ({
  account_id: account.id, name: account.alias, helper_assist_limit: 10, helper_assist_count: index + 2, helper_assist_remaining: 8 - index,
  helper_limit_reached: false, domains: dnsheDomains.filter((domain) => domain.account_id === account.id).map((domain, domainIndex) => ({ id: domain.id, domain: domain.full_domain, status: domainIndex === 0 ? "in_progress" : "eligible", never_expires: domainIndex === 0 ? 1 : 0, expires_at: domain.expires_at, assist_code: domainIndex === 0 ? "DEMO88" : undefined, assist_count: domainIndex === 0 ? 2 : 0, target_assists: 5 })), assist_logs: [],
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const dnsRecords = [
  { id: "demo-a", name: "@", type: "A", content: "192.0.2.10", ttl: 1, priority: null, line: "default", proxied: true },
  { id: "demo-cname", name: "www", type: "CNAME", content: "@", ttl: 1, priority: null, line: "default", proxied: true },
  { id: "demo-txt", name: "_status", type: "TXT", content: "demo=static-pages", ttl: 300, priority: null, line: "default", proxied: false },
];

export function demoFetch(input: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
  const raw = typeof input === "string" ? input : input.toString();
  const url = new URL(raw, window.location.origin);
  const path = url.pathname;
  const method = (options.method || "GET").toUpperCase();

  if (path === "/api/auth/status") return Promise.resolve(json({ success: true, initialized: true, two_fa_enabled: false }));
  if (path === "/api/auth/account") return Promise.resolve(json({ success: true, username: "demo-admin", two_fa_enabled: false }));
  if (path === "/api/accounts" && method === "GET") return Promise.resolve(json({ success: true, accounts }));
  if (path === "/api/overview") return Promise.resolve(json(overview));
  if (path === "/api/quota") return Promise.resolve(json({ success: true, quotas }));
  if (path === "/api/logs") return Promise.resolve(json({ success: true, logs }));
  if (path === "/api/settings") return Promise.resolve(json({ success: true, settings: { webhook_type: "email", renew_threshold_days: "180", auto_renew: "1", smtp_host: "smtp.example.com", smtp_port: "465" }, configured: { tg_token: false, webhook_url: false, smtp_pass: false } }));
  if (path === "/api/ddns") return Promise.resolve(json({ success: true, bindings: [{ id: "demo-ddns-1", account_id: 1, label: "家庭网络", domain: "home.cc.cd", record_type: "A", token: "demo-token", created_at: "2026-09-10T08:00:00Z", last_ip: "192.0.2.44", last_status: "success", last_at: iso(24) }] }));
  if (path === "/api/assist/status") return Promise.resolve(json({ success: true, accounts: assistAccounts, history: [{ ts: iso(80), assist_code: "DEMO88", count: 2, accounts: ["主账号", "项目账号"] }], updated_at: iso(18) }));
  if (path === "/api/cf/quota") return Promise.resolve(json({ success: true, accounts: cfUsage, limits: { workersRequestsPerDay: 100000, d1RowsReadPerDay: 5000000, d1RowsWrittenPerDay: 1000000, d1StorageBytes: 5000000000, kvReadsPerDay: 100000, kvWritesPerDay: 1000, kvDeletesPerDay: 1000, kvStorageBytes: 1000000000, r2StorageBytes: 1000000000000, r2ClassAPerMonth: 1000000, r2ClassBPerMonth: 10000000 }, generated_at: now.toISOString() }));
  if (path === "/api/dns/ns") {
    const roots = (url.searchParams.get("roots") || "").split(",").filter(Boolean);
    return Promise.resolve(json({ success: true, ns: Object.fromEntries(roots.map((root) => [root, root === "us.ci" ? ["vip7.alidns.com", "vip8.alidns.com"] : ["a.ns.dnshe.org", "b.ns.dnshe.org"]])) }));
  }
  if (path === "/api/keys/reveal") return Promise.resolve(json({ success: true, api_secret: "demo_secret_only_for_static_preview" }));
  if (path === "/api/keys") {
    const accountId = url.searchParams.get("account_id");
    if (accountId && accountId !== "all") return Promise.resolve(json({ success: true, keys: keyRows(Number(accountId), accounts.find((a) => a.id === Number(accountId))?.alias || "账号"), preview_read_only: true }));
    return Promise.resolve(json({ success: true, groups: keyGroups, preview_read_only: true }));
  }
  if (path === "/api/domains") {
    const isCloudflare = url.searchParams.get("provider") === "cloudflare";
    const list = isCloudflare ? cfZones : dnsheDomains;
    return Promise.resolve(json({ success: true, domains: list, last_sync: { at: now.toISOString(), type: "demo", message: "静态合成快照" } }));
  }
  if (/\/api\/domains\/\d+\/dns/.test(path) || /\/api\/domains\/\d+\/propagation/.test(path)) {
    if (path.endsWith("/propagation")) return Promise.resolve(json({ success: true, name: "@", type: "A", verdict: "propagated", checked_at: now.toISOString(), resolvers: [{ resolver: "Cloudflare", ok: true, rtt: 34, answers: ["192.0.2.10"], note: "" }, { resolver: "Google", ok: true, rtt: 41, answers: ["192.0.2.10"], note: "" }] }));
    return Promise.resolve(json({ success: true, records: dnsRecords }));
  }
  if (path.startsWith("/api/ddns/") && path.endsWith("/script")) return Promise.resolve(json({ success: true, domain: "home.cc.cd", filename: "update-home.sh", script: "#!/usr/bin/env sh\n# Static preview script\necho demo" }));
  if (path === "/api/whois" || path === "/api/whois/pool") return Promise.resolve(json({ success: true, result: { domain: "demo.cc.cd", status: "available", message: "静态演示结果" }, results: [] }));
  if (method !== "GET") return Promise.resolve(json({ success: true, message: "静态演示不会写入真实资源" }));
  return Promise.resolve(json({ success: true }));
}
