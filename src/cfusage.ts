/**
 * Cloudflare 免费额度「用量」采集（第24轮K）
 *
 * ─────────────────────────── 为什么有这个文件 ───────────────────────────
 *
 * 第24轮H 我在这里写过一句错的注释：「CF API 不暴露用量类的实时值」，
 * 并把它复制到了用户可见的页面文案上。**那是错的。**
 *
 * 真实情况：
 *   · REST 提供"**存量**"类数据 —— D1 `file_size`（已用存储）、R2 桶列表、
 *     KV 命名空间数、zones / Workers 脚本 / Pages 项目 / Tunnel 数量。
 *   · **GraphQL Analytics（`POST /graphql`）提供"流量"类数据** —— Workers 请求数、
 *     D1 行读行写、KV 读/写/删/列次数、R2 存取请求与存储量、DNS 查询量。
 *
 * 上一轮只探了 REST 就下了"不可测"的结论。**教训：判"能不能测"时，
 * GraphQL Analytics 必须作为一等候选，不能只试 REST。**
 *
 * ─────────────────────────── 诚实边界（本轮真实确认） ───────────────────────────
 *
 * 能测：Workers 请求/错误/子请求、D1 行读行写 + 存储、KV 四类操作次数、
 *       R2 存取请求 + 存储量 + 对象数、DNS 查询量（按 zone）、各类资源数量。
 * 不能测：Workers CPU 时间（只在上限里写）、R2 出网流量（免费不计费）、
 *         Workers AI neuron 消耗（本账号无出口）、Turnstile 校验次数（无出口）。
 * 拿不到时**返回 null 并给 reason**，绝不把"没拿到"当成 0。
 */
import { CfReadError } from "./cloudflare";
import type { CloudflareClient, CfReadFailureKind } from "./cloudflare";

export interface CfUsageIssue {
  kind: CfReadFailureKind;
  message: string;
  http_status?: number;
  code?: number;
  /** 有旧值时保留其原始采集时间，不把旧值冒充本次刷新结果。 */
  cached_at?: string;
}

export type UsageTaskRunner = <T>(task: () => Promise<T>) => Promise<T>;

/** 每次整批采集共享一个队列，避免账号增多时无界占用上游连接。 */
export function createUsageLimiter(limit = 6): UsageTaskRunner {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next(); // 直接交接已占用的槽，防止新请求插队超出并发上限。
      else active--;
    }
  };
}

function usageIssue(error: unknown): CfUsageIssue {
  return error instanceof CfReadError
    ? { kind: error.kind, message: error.message, ...error.detail }
    : { kind: "unavailable", message: error instanceof Error ? error.message : "Cloudflare 数据暂不可用" };
}

/** 免费版上限（口径：Cloudflare 官方 Limits / Pricing 页，2026-10 核对） */
export const CF_FREE_LIMITS = {
  workersRequestsPerDay: 100_000,
  workersCpuMsPerRequest: 10,
  workerSizeMiB: 64,
  workersPerAccount: 100,
  subrequestsPerRequest: 50,
  d1RowsReadPerDay: 5_000_000,
  d1RowsWrittenPerDay: 100_000,
  d1StorageBytes: 5 * 1024 ** 3,
  d1DatabasesPerAccount: 10,
  kvReadsPerDay: 100_000,
  kvWritesPerDay: 1_000,
  kvDeletesPerDay: 1_000,
  kvListPerDay: 1_000,
  kvStorageBytes: 1024 ** 3,
  kvNamespacesPerAccount: 1_000,
  r2StorageBytes: 10 * 1024 ** 3,
  r2ClassAPerMonth: 1_000_000,
  r2ClassBPerMonth: 10_000_000,
  pagesBuildsPerMonth: 500,
  pagesFilesPerSite: 20_000,
  pagesProjectsPerAccount: 100,
  pagesCustomDomainsPerProject: 100,
} as const;

/** 一次取「今天」的 UTC 日期串（CF 的免费额度按 UTC 零点重置） */
function utcDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export interface CfUsageDay {
  date: string;
  /** GraphQL 里 sum.requests / 等价字段 */
  requests?: number;
  errors?: number;
  subrequests?: number;
  rowsRead?: number;
  rowsWritten?: number;
  readQueries?: number;
  writeQueries?: number;
}

export interface CfAccountUsage {
  account_id: number;
  alias: string;
  /** Cloudflare account tag used to build first-party resource links. */
  cf_account_id?: string;
  cf_account_name: string;
  /** 数量类（REST 实测） */
  counts: {
    zones: number;
    d1_databases: number;
    kv_namespaces: number;
    r2_buckets: number;
    worker_scripts: number;
    pages_projects: number;
    tunnels: number;
  };
  inventory_issues?: Partial<Record<keyof CfAccountUsage["counts"], CfUsageIssue>>;
  /** 存量类（REST 实测） */
  storage: {
    /** D1 各库 file_size 合计（字节） */
    d1_bytes: number;
    d1_detail: Array<{ name: string; bytes: number; tables: number }>;
  };
  /**
   * 流量类（GraphQL 实测）。null = 没拿到（Token 缺 Account Analytics:Read 权限
   * 或接口变更），**不是 0**。`reason` 说明原因。
   */
  traffic: {
    workers: CfUsageDay[] | null;
    d1: CfUsageDay[] | null;
    kv: Array<{ date: string; read: number; write: number; delete: number; list: number }> | null;
    r2_ops: Array<{ action: string; requests: number }> | null;
    r2_storage: { bytes: number; objects: number } | null;
    reason?: string;
    issues?: Partial<Record<"workers" | "d1" | "kv" | "r2_ops" | "r2_storage", CfUsageIssue>>;
  };
  d1_names: string[];
  kv_names: string[];
  r2_names: string[];
  pages_names: string[];
  error?: string;
}

/* ─────────────────────────── GraphQL 查询 ───────────────────────────
 * 查询最近 7 天（含今天），上游只返回有记录的日期，不填零或把短序列当权限失败。 */

const Q_WORKERS = (acc: string) => `
query { viewer { accounts(filter:{accountTag:"${acc}"}) {
  workersInvocationsAdaptive(limit:20, filter:{date_geq:"${utcDate(-6)}", date_leq:"${utcDate()}"}) {
    sum { requests errors subrequests } dimensions { date } } } } }`;

const Q_D1 = (acc: string) => `
query { viewer { accounts(filter:{accountTag:"${acc}"}) {
  d1AnalyticsAdaptiveGroups(limit:20, filter:{date_geq:"${utcDate(-6)}", date_leq:"${utcDate()}"}) {
    sum { rowsRead rowsWritten readQueries writeQueries } dimensions { date } } } } }`;

const Q_KV = (acc: string) => `
query { viewer { accounts(filter:{accountTag:"${acc}"}) {
  kvOperationsAdaptiveGroups(limit:200, filter:{date_geq:"${utcDate(-6)}", date_leq:"${utcDate()}"}) {
    sum { requests } dimensions { date actionType } } } } }`;

const Q_R2_OPS = (acc: string) => `
query { viewer { accounts(filter:{accountTag:"${acc}"}) {
  r2OperationsAdaptiveGroups(limit:200, filter:{date_geq:"${utcDate(-6)}", date_leq:"${utcDate()}"}) {
    sum { requests } dimensions { actionType } } } } }`;

const Q_R2_STORAGE = (acc: string) => `
query { viewer { accounts(filter:{accountTag:"${acc}"}) {
  r2StorageAdaptiveGroups(limit:2, filter:{date_geq:"${utcDate()}", date_leq:"${utcDate()}"}) {
    max { payloadSize metadataSize objectCount } dimensions { date } } } } }`;

interface GqlAccounts<T> {
  viewer?: { accounts?: Array<T> };
}

/** 从 GraphQL 结果里安全取出账户段的第一块数据 */
function pluck<T>(data: unknown, key: string): T[] | null {
  const accts = (data as GqlAccounts<Record<string, unknown>>)?.viewer?.accounts;
  if (!Array.isArray(accts) || accts.length === 0) return null;
  const rows = accts[0]?.[key];
  return Array.isArray(rows) ? (rows as T[]) : null;
}

/**
 * 🔴 按日期升序排序（第24轮M 修的真实缺陷）
 *
 * **Cloudflare 的 GraphQL 不保证日期顺序** —— 实测 `workersInvocationsAdaptive`
 * 返回过 `['2026-10-14','2026-10-16','2026-10-15']`（10-16 排在 10-15 前面）。
 * 前端把它当"时间序列"直接连折线，x 轴就变成了 `10-14 · 10-16 · 10-15` ——
 * 折线在说谎（第三次的点被画在最右边）。
 * ⇒ 必须在**后端出口**排序，不能指望前端或上游。
 * 时区口径：日期是 UTC 字符串（`YYYY-MM-DD`），字典序 == 时间序。
 */
function byDateAsc<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 采集单个 CF 账号的用量。
 *
 * 子数据集独立容错并记录诊断；真实空集与读取失败严格分开。
 */
export async function collectAccountUsage(
  client: CloudflareClient,
  acc: { id: number; alias: string; cf_account_id?: string },
  run: UsageTaskRunner = createUsageLimiter()
): Promise<CfAccountUsage> {
  const out: CfAccountUsage = {
    account_id: acc.id,
    alias: acc.alias,
    cf_account_name: "",
    counts: {
      zones: 0,
      d1_databases: 0,
      kv_namespaces: 0,
      r2_buckets: 0,
      worker_scripts: 0,
      pages_projects: 0,
      tunnels: 0,
    },
    storage: { d1_bytes: 0, d1_detail: [] },
    traffic: { workers: null, d1: null, kv: null, r2_ops: null, r2_storage: null },
    d1_names: [],
    kv_names: [],
    r2_names: [],
    pages_names: [],
  };

  // 本地数字主键不是 Cloudflare accountTag；枚举失败不能拿它拼出伪查询。
  const cfAccs = acc.cf_account_id ? [{ id: acc.cf_account_id, name: "" }] : await run(() => client.listAccounts());
  if (!cfAccs.length) throw new CfReadError("unavailable", "Token 未返回可访问的 Cloudflare 账号，请检查账号资源范围和 Account Settings:Read 权限");
  const cfAccountId = String(cfAccs[0].id);
  out.cf_account_id = cfAccountId;
  out.cf_account_name = cfAccs[0].name;

  const graphKeys = ["workers", "d1", "kv", "r2_ops", "r2_storage"] as const;
  const graphQueries = [Q_WORKERS, Q_D1, Q_KV, Q_R2_OPS, Q_R2_STORAGE];
  // 重要流量数据无需等待可选资源清单全部返回；队列限制整批最多六个读取。
  const graphData = Promise.all(graphQueries.map((query, index) => run(async () => {
    const key = graphKeys[index];
    try {
      return await client.cfGraphql(query(cfAccountId));
    } catch (error) {
      (out.traffic.issues ??= {})[key] = usageIssue(error);
      return undefined;
    }
  })));
  const inventory = <T>(key: keyof CfAccountUsage["counts"], task: () => Promise<T[]>): Promise<T[]> => run(async () => {
    try {
      return await task();
    } catch (error) {
      (out.inventory_issues ??= {})[key] = usageIssue(error);
      return [];
    }
  });

  const [zones, d1, kv, r2, scripts, pages, tunnels] = await Promise.all([
    inventory("zones", () => client.listZones(cfAccountId)),
    inventory("d1_databases", () => client.listD1Databases(cfAccountId)),
    inventory("kv_namespaces", () => client.listKvNamespaces(cfAccountId)),
    inventory("r2_buckets", () => client.listR2Buckets(cfAccountId)),
    inventory("worker_scripts", () => client.listWorkerScripts(cfAccountId)),
    inventory("pages_projects", () => client.listPagesProjects(cfAccountId)),
    inventory("tunnels", () => client.listTunnels(cfAccountId)),
  ]);

  out.counts = {
    zones: zones.length,
    d1_databases: d1.length,
    kv_namespaces: kv.length,
    r2_buckets: r2.length,
    worker_scripts: scripts.length,
    pages_projects: pages.length,
    tunnels: tunnels.length,
  };
  out.d1_names = d1.map((d) => d.name);
  out.kv_names = kv.map((k) => k.title);
  out.r2_names = r2.map((b) => b.name);
  out.pages_names = pages.map((p) => p.name);

  // D1 file_size = 真实已用存储（上一轮漏看的字段）
  out.storage.d1_detail = d1.map((d) => ({
    name: d.name,
    bytes: Number(d.file_size) || 0,
    tables: Number(d.num_tables) || 0,
  }));
  out.storage.d1_bytes = out.storage.d1_detail.reduce((s, x) => s + x.bytes, 0);

  // ── GraphQL 流量类：并行拉，逐个容错 ──
  try {
    const [wData, dData, kData, r2oData, r2sData] = await graphData;
    const dataNodes = ["workersInvocationsAdaptive", "d1AnalyticsAdaptiveGroups", "kvOperationsAdaptiveGroups", "r2OperationsAdaptiveGroups", "r2StorageAdaptiveGroups"];
    for (const [index, data] of [wData, dData, kData, r2oData, r2sData].entries()) {
      if (pluck(data, dataNodes[index]) === null && !out.traffic.issues?.[graphKeys[index]]) {
        (out.traffic.issues ??= {})[graphKeys[index]] = { kind: "unavailable", message: "Cloudflare 未返回该账号的数据集，可能受资源范围、数据集可用性或套餐限制；不等同于缺少历史日期" };
      }
    }

    const wRows = pluck<{ sum: Record<string, number>; dimensions: { date: string } }>(wData, "workersInvocationsAdaptive");
    if (wRows) {
      out.traffic.workers = byDateAsc(
        wRows.map((r) => ({
          date: r.dimensions.date,
          requests: Number(r.sum.requests) || 0,
          errors: Number(r.sum.errors) || 0,
          subrequests: Number(r.sum.subrequests) || 0,
        }))
      );
    }

    const dRows = pluck<{ sum: Record<string, number>; dimensions: { date: string } }>(dData, "d1AnalyticsAdaptiveGroups");
    if (dRows) {
      out.traffic.d1 = byDateAsc(
        dRows.map((r) => ({
          date: r.dimensions.date,
          rowsRead: Number(r.sum.rowsRead) || 0,
          rowsWritten: Number(r.sum.rowsWritten) || 0,
          readQueries: Number(r.sum.readQueries) || 0,
          writeQueries: Number(r.sum.writeQueries) || 0,
        }))
      );
    }

    const kRows = pluck<{ sum: { requests: number }; dimensions: { date: string; actionType: string } }>(
      kData,
      "kvOperationsAdaptiveGroups"
    );
    if (kRows) {
      const byDate = new Map<string, { date: string; read: number; write: number; delete: number; list: number }>();
      for (const r of kRows) {
        const d = r.dimensions.date;
        if (!byDate.has(d)) byDate.set(d, { date: d, read: 0, write: 0, delete: 0, list: 0 });
        const t = byDate.get(d)!;
        const n = Number(r.sum.requests) || 0;
        if (r.dimensions.actionType === "read") t.read += n;
        else if (r.dimensions.actionType === "write") t.write += n;
        else if (r.dimensions.actionType === "delete") t.delete += n;
        else if (r.dimensions.actionType === "list") t.list += n;
      }
      out.traffic.kv = byDateAsc([...byDate.values()]);
    }

    const r2oRows = pluck<{ sum: { requests: number }; dimensions: { actionType: string } }>(
      r2oData,
      "r2OperationsAdaptiveGroups"
    );
    if (r2oRows) {
      const agg = new Map<string, number>();
      for (const r of r2oRows) {
        const k = r.dimensions.actionType;
        agg.set(k, (agg.get(k) || 0) + (Number(r.sum.requests) || 0));
      }
      out.traffic.r2_ops = [...agg.entries()]
        .map(([action, requests]) => ({ action, requests }))
        .sort((a, b) => b.requests - a.requests);
    }

    const r2sRows = pluck<{ max: Record<string, number>; dimensions: { date: string } }>(
      r2sData,
      "r2StorageAdaptiveGroups"
    );
    if (r2sRows && r2sRows.length > 0) {
      const m = r2sRows[r2sRows.length - 1].max;
      out.traffic.r2_storage = {
        bytes: Number(m.payloadSize) || 0,
        objects: Number(m.objectCount) || 0,
      };
    }

    const issues = Object.entries(out.traffic.issues ?? {});
    if (issues.length) out.traffic.reason = issues.map(([key, issue]) => `${key}: ${issue.message}`).join("；");
  } catch (e: unknown) {
    out.traffic.reason = e instanceof Error ? e.message : "GraphQL 查询失败";
  }

  return out;
}
