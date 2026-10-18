import { useMemo } from "react";
import { isCfServiceNotEnabled } from "./CfQuotaModel";

/* ═══════════════════════════════════════════════════════════════════════════
   CF 免费额度 · 用量图表件（第24轮K）

   设计依据：lieflat-charts（`~/.workbuddy/skills/lieflat-charts`）
   ─ §SKILL 第零节选型优先级：先审计 Lupi Editorial → Lupi Basics → 才 Glance
   ─ 本页场合是 **dashboard / 三秒快读**（用户明确要求"仪表盘"）
     ⇒ 按 §零.4「用户明确要求 dashboard / 三秒快读时才用 Glance」允许降级到 Glance，
       但**能用基础型表达的就用基础型** —— 本件实际落在：
         · F1 Rung Bars（少类目比较，单位可数）→ 用量占比条
         · L15 Ballot Tally（逐项独立百分比）→ 距上限百分比
       Lupi Editorial 不适配原因：本页是**聚合读数**（提前聚合好给结论），
       不是"逐条记录摊开细读"（Lupi 的基本单元是记录）。数据只有 6–10 个类目，
       且读者要 <10s 判断，故不做逐记录分解。
   ─ §二 Mono 硬规则：明度即数据、一律实心、无渐变无发光、柱端胶囊圆角、
     卡片圆角 24px（本站按面板既有令牌取 rounded-lg/md，见下"令牌桥接"）
   ─ §八.1 数值与视觉严格成正比（宽度 = 百分比，不做 sqrt 因为不是面积编码）

   🔴 令牌桥接（重要）：lieflat 的 Mono 用固定 hex（纸灰 #F0EFEB / 炭黑 #1C1C1A），
   而本面板已有一套 CSS 变量（`--bg-surface` / `--text-primary` / `--border-base`）。
   两者都是**中性灰阶**，语义一致 ⇒ **沿用面板令牌**，不硬编码 lieflat 的 hex，
   否则深浅色主题会各写一套色。这不违反 §二：它约束的是"色相与明度阶梯"，
   不是"必须用字面量 hex"；本件全部取色自令牌，明度阶梯由令牌自身提供。
   ═══════════════════════════════════════════════════════════════════════════ */

export interface UsageDay {
  date: string;
  requests?: number;
  errors?: number;
  subrequests?: number;
  rowsRead?: number;
  rowsWritten?: number;
  readQueries?: number;
  writeQueries?: number;
}

/** 上游读取诊断与历史覆盖分离；缓存旧值不能冒充本次成功读数。 */
export interface CfReadIssue {
  kind: "permission" | "authentication" | "not_enabled" | "rate_limit" | "timeout" | "network" | "unavailable" | "response" | "query";
  message: string;
  http_status?: number;
  code?: number;
  cached_at?: string;
}

export interface AccountUsage {
  account_id: number;
  alias: string;
  cf_account_id?: string;
  cf_account_name: string;
  counts: {
    zones: number;
    d1_databases: number;
    kv_namespaces: number;
    r2_buckets: number;
    worker_scripts: number;
    pages_projects: number;
    tunnels: number;
  };
  inventory_issues?: Partial<Record<keyof AccountUsage["counts"], CfReadIssue>>;
  storage: { d1_bytes: number; d1_detail: Array<{ name: string; bytes: number; tables: number }> };
  traffic: {
    workers: UsageDay[] | null;
    d1: UsageDay[] | null;
    kv: Array<{ date: string; read: number; write: number; delete: number; list: number }> | null;
    r2_ops: Array<{ action: string; requests: number }> | null;
    r2_storage: { bytes: number; objects: number } | null;
    issues?: Partial<Record<"workers" | "d1" | "kv" | "r2_ops" | "r2_storage", CfReadIssue>>;
    reason?: string;
  };
  d1_names: string[];
  kv_names: string[];
  r2_names: string[];
  pages_names: string[];
  error?: string;
}

export interface CfLimits {
  workersRequestsPerDay: number;
  d1RowsReadPerDay: number;
  d1RowsWrittenPerDay: number;
  d1StorageBytes: number;
  kvReadsPerDay: number;
  kvWritesPerDay: number;
  kvDeletesPerDay: number;
  kvStorageBytes: number;
  r2StorageBytes: number;
  r2ClassAPerMonth: number;
  r2ClassBPerMonth: number;
  [k: string]: number;
}

/* ── 数值格式化（§图表规范：一律取整 / 保留必要精度，不堆小数） ── */
export function fmtBytes(b: number): string {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${u[i]}`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

/** 把大数字压成短标签（图表轴用）：2.2k / 48.7k / 1.2M */
export function fmtShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/**
 * 状态色 —— 全页**唯一**用色处（§30 配色宪章：颜色只表达状态）
 * 返回语义档位，由调用方决定 class；不使用色相表达"分区/类别"。
 */
export function usageLevel(pct: number | null): "none" | "ok" | "warn" | "danger" {
  if (pct === null || Number.isNaN(pct)) return "none";
  if (pct > 100) return "danger";
  if (pct > 85) return "danger";
  if (pct > 60) return "warn";
  return "ok";
}

export const LEVEL_BAR: Record<string, string> = {
  none: "bg-border-base",
  ok: "bg-primary",
  warn: "bg-amber-500",
  danger: "bg-red-500",
};

export const LEVEL_TEXT: Record<string, string> = {
  none: "text-content-muted",
  ok: "text-content-secondary",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

/* ═══════════════════════════════════════════════════════════════
   Token 权限清单 + 一键创建链接

   🔴🔴 第24轮T 修正一个真实缺陷：预填链接**只带出 2 项权限**（用户截图）。
   根因是我用错了载荷结构。官方格式（Cloudflare 文档
   fundamentals/api/how-to/account-owned-token-template）：
       permissionGroupKeys=[{"key":"dns","type":"edit"}]
     · 只有 `key` 与 `type` 两个字段，**没有 `id`**；
     · `key` 是**权限名**（dns / zone / d1 / workers_scripts …），**不是权限组的 hex id**；
     · `type` 只能是 read | edit | revoke | run | purge —— **没有 "write"**。
   我原来写的是 `{"id":"<hex>","key":"<hex>","type":"read"}` ⇒
   CF 只认出 key 恰好是合法名的那两条（zone、account_analytics），其余静默丢弃。

   🔴🔴 第24轮U：默认权限一律取 Edit（用户要求 Zone / Account Settings 也要 Edit）。
   先实测确认对应 Write 组存在，再改（**别凭印象** —— 上一轮我就写错过）：
     · Zone Write             = e6d2666161e84845a636613608cee8d5 ⇒ `zone`+edit 有效
     · Account Settings Write = 1af1fa2adc104452b74a9a3364202f20 ⇒ `account_settings`+edit 有效
   ⚠️ 修正一条错误注释：之前写「account_settings 无 edit 版本」是**错的**，它确实有 Write。
   唯一保持 read 的是 `account_analytics`（Analytics 只有读语义，没有写）。
   取 Edit 的理由：面板后续要能调整资源，只读会在真正需要写的时候卡住。
   ⚠️ zone 级 DNS 写权限的 key 是 `dns`（edit）；`zone` 自身另有 Write 版本。
   ═══════════════════════════════════════════════════════════════ */
/** 手动清单、创建模板和诊断引用同一份定义；Edit 保留既有管理权限，不代表额度页会执行写入。 */
export const CF_TOKEN_REQUIREMENTS = [
  { scope: "Zone", permission: "DNS Edit", key: "dns", type: "edit", purpose: "解析记录读写 · 委派" },
  { scope: "Zone", permission: "Edit", key: "zone", type: "edit", purpose: "zone 列表与管理" },
  { scope: "Account", permission: "Analytics Read", key: "account_analytics", type: "read", purpose: "用量统计" },
  { scope: "Account", permission: "D1 Edit", key: "d1", type: "edit", purpose: "数据库与 file_size" },
  { scope: "Account", permission: "Workers KV Storage Edit", key: "workers_kv_storage", type: "edit", purpose: "命名空间" },
  { scope: "Account", permission: "Workers Scripts Edit", key: "workers_scripts", type: "edit", purpose: "Worker 列表" },
  { scope: "Account", permission: "Workers R2 Storage Edit", key: "workers_r2", type: "edit", purpose: "R2 桶" },
  { scope: "Account", permission: "Pages Edit", key: "page", type: "edit", purpose: "Pages 项目" },
  { scope: "Account", permission: "Cloudflare Tunnel Read", key: "argotunnel", type: "read", purpose: "Tunnel 列表" },
  { scope: "Account", permission: "Settings Edit", key: "account_settings", type: "edit", purpose: "账号设置与账号名" },
] as const;
export const CF_TOKEN_PERMISSIONS: Array<[string, string, string]> = CF_TOKEN_REQUIREMENTS.map(({ scope, permission, purpose }) => [scope, permission, purpose]);

export const CF_TOKEN_CREATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens" +
  "?accountId=*&zoneId=all&name=" + encodeURIComponent("shydns-panel") +
  "&permissionGroupKeys=" +
  encodeURIComponent(JSON.stringify(CF_TOKEN_REQUIREMENTS.map(({ key, type }) => ({ key, type }))));

const CF_DIAGNOSTIC_SOURCES = {
  workers: ["Workers 请求", "workersInvocationsAdaptive", "account_analytics"],
  d1: ["D1 分析", "d1AnalyticsAdaptiveGroups", "account_analytics"],
  kv: ["KV 分析", "kvOperationsAdaptiveGroups", "account_analytics"],
  r2_ops: ["R2 操作", "r2OperationsAdaptiveGroups", "account_analytics"],
  r2_storage: ["R2 存储", "r2StorageAdaptiveGroups", "account_analytics"],
  zones: ["Zone", "GET /zones?account.id={account_id}", "zone"],
  d1_databases: ["D1 资源", "GET /accounts/{account_id}/d1/database", "d1"],
  kv_namespaces: ["KV 资源", "GET /accounts/{account_id}/storage/kv/namespaces", "workers_kv_storage"],
  r2_buckets: ["R2 资源", "GET /accounts/{account_id}/r2/buckets", "workers_r2"],
  worker_scripts: ["Workers 资源", "GET /accounts/{account_id}/workers/scripts", "workers_scripts"],
  pages_projects: ["Pages 资源", "GET /accounts/{account_id}/pages/projects", "page"],
  tunnels: ["Tunnel 资源", "GET /accounts/{account_id}/cfd_tunnel?is_deleted=false", "argotunnel"],
} as const;

/** 旧缓存可能仍把 R2 开通提示标成 permission；只纠正明确的服务开通信号，不猜测其它 403。 */
export function cfIssueSummary(issue: CfReadIssue): string {
  if (isCfServiceNotEnabled(issue)) return "未启用";
  return { permission: "权限或范围待核对", authentication: "认证未通过", not_enabled: "未启用", rate_limit: "请求受限", timeout: "读取超时", network: "连接失败", unavailable: "数据未返回", response: "响应异常", query: "查询不可用" }[issue.kind] ?? "读取待核对";
}

export function cfAccountDiagnostics(account: AccountUsage) {
  return [...Object.entries(account.traffic.issues ?? {}), ...Object.entries(account.inventory_issues ?? {})].flatMap(([key, issue]) => {
    if (!issue) return [];
    const source = CF_DIAGNOSTIC_SOURCES[key as keyof typeof CF_DIAGNOSTIC_SOURCES];
    if (!source) return [];
    const [label, endpoint, permissionKey] = source;
    const permission = CF_TOKEN_REQUIREMENTS.find((entry) => entry.key === permissionKey)!;
    return [{ key, issue, label, summary: cfIssueSummary(issue), endpoint: endpoint.startsWith("GET") ? endpoint : `POST /graphql · ${endpoint}`,
      permission: `${permission.scope} / ${permission.permission}`, scope: key === "zones" ? "目标账号下、Token 可见的 Zone" : "当前所选 Cloudflare 账号" }];
  });
}

/* ═══════════════════════════════════════════════════════════════
   ① 占比条 —— F1 Rung Bars 的横向降级（单位可数、长度 ∝ 数值）
   ═══════════════════════════════════════════════════════════════ */
export function UsageBar({ pct, level, width = "w-full" }: { pct: number | null; level: string; width?: string }) {
  const w = pct === null ? 0 : Math.min(100, Math.max(pct, pct > 0 ? 1.5 : 0));
  return (
    <div className={`${width} h-1.5 rounded-full bg-elevated overflow-hidden`} role="presentation">
      <div
        className={`h-full rounded-full ${LEVEL_BAR[level] || LEVEL_BAR.none} transition-[width] duration-500`}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ② 横向 rung 条组 —— F1 Rung Bars（单位可数、长度 ∝ 数值）

   🔴 第24轮K 自查修正（**图表语法错误**）：第一版让「条长 = 该项占最大项的比例」，
   却在行尾标「距上限 0.6%」—— 一根条同时被读成两种含义，用户看到满格条配 0.6%
   会以为自相矛盾。这正是 §八.1「数值和视觉成正比」要防的。
   正解：**条长一律 = 距上限百分比**（与行尾数字同义）。诚实且无歧义。
   ═══════════════════════════════════════════════════════════════ */
export function RungBars({
  rows,
  unitHint,
}: {
  rows: Array<{ label: string; value: number; limit: number | null; display?: string; sub?: string }>;
  unitHint?: string;
}) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const pctOfLimit = r.limit && r.limit > 0 ? (r.value / r.limit) * 100 : null;
        const lv = usageLevel(pctOfLimit);
        const w = pctOfLimit === null ? 0 : Math.min(100, Math.max(pctOfLimit, r.value > 0 ? 1.5 : 0));
        return (
          <div key={r.label}>
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-content-secondary whitespace-nowrap">{r.label}</span>
              <span className="text-xs font-semibold text-content-primary font-mono tabular-nums">
                {r.display ?? fmtNum(r.value)}
              </span>
              {r.limit !== null && (
                <span className="text-[10px] text-content-muted font-mono tabular-nums whitespace-nowrap">
                  / {fmtBytes(r.limit)}
                </span>
              )}
              {pctOfLimit !== null && (
                <span className={`ml-auto text-[11px] font-mono tabular-nums whitespace-nowrap ${LEVEL_TEXT[lv]}`}>
                  {pctOfLimit.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-elevated overflow-hidden">
              <div
                className={`h-full rounded-full ${LEVEL_BAR[lv]} transition-[width] duration-500`}
                style={{ width: `${w}%` }}
              />
            </div>
            {r.sub && <p className="text-[10px] text-content-muted mt-0.5">{r.sub}</p>}
          </div>
        );
      })}
      {unitHint && <p className="text-[10px] text-content-muted pt-0.5">{unitHint}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ③ 日序列柱 —— F2 Hairline Line 的柱形降级
   用途：最近 3 天读数。柱高 ∝ 数值，不断轴（§二 形状）
   ═══════════════════════════════════════════════════════════════ */
export function DayColumns({
  days,
  limit,
  label = "请求数",
}: {
  days: Array<{ date: string; value: number }>;
  limit: number;
  label: string;
}) {
  const max = Math.max(...days.map((d) => d.value), 1);
  return (
    <div>
      <div className="flex items-end gap-3 h-[92px]" role="img" aria-label={`${label}最近 ${days.length} 天`}>
        {days.map((d) => {
          const h = (d.value / max) * 100;
          const pct = (d.value / limit) * 100;
          const lv = usageLevel(pct);
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
              <span className="text-[10px] font-mono font-semibold text-content-secondary tabular-nums">
                {fmtShort(d.value)}
              </span>
              <div
                className={`w-full rounded-t-[3px] ${LEVEL_BAR[lv]} transition-[height] duration-500`}
                style={{ height: `${Math.max(h, 3)}%` }}
                title={`${d.date} · ${fmtNum(d.value)} / ${fmtNum(limit)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-1.5 border-t border-border-soft pt-1.5">
        {days.map((d) => (
          <span key={d.date} className="flex-1 text-center text-[10px] text-content-muted font-mono">
            {d.date.slice(5)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ④ KPI 卡 —— R09 的 KPI 家具（排字 + 单条比例）
   §二：KPI 卡是"数据家具"，靠排字承载，不用装饰
   ═══════════════════════════════════════════════════════════════ */
export function Kpi({
  label,
  value,
  unit,
  pct,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  pct: number | null;
  note?: string;
}) {
  const lv = usageLevel(pct);
  return (
    <div className="border border-border-base rounded bg-surface p-3">
      <p className="text-[11px] text-content-muted whitespace-nowrap truncate">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-bold text-content-primary font-mono tabular-nums">{value}</span>
        {unit && <span className="text-[11px] text-content-muted">{unit}</span>}
      </p>
      {pct !== null && (
        <>
          <UsageBar pct={pct} level={lv} />
          <p className={`mt-1 text-[10px] font-mono tabular-nums ${LEVEL_TEXT[lv]}`}>
            {pct.toFixed(1)}% 上限
          </p>
        </>
      )}
      {note && <p className="text-[10px] text-content-muted mt-1">{note}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ⑤ 聚合计算 —— 把逐账号数据汇成"全局用量"（用户要求"可聚合"）

   🔴🔴 两条口径铁律（这是诚实性问题，不是实现细节）：

   (1) **百分比只在逐账号视角下成立。** CF 免费上限是**每账号**约束，
       把多账号合计去除以单账号上限必然算小 —— 所以聚合区**只报绝对量**。

   (2) **部分账号没数据时，绝不当成 0 计入合计。** 第一版这里直接把各账号相加，
       而 2 个账号里只有 1 个能返回用量 ⇒ 页面上「今日 Workers 请求 1,816」
       被标成"合计"，实际只是那一个账号的数字，**另一半账号被悄悄当成 0**。
       这跟我自己在注释里批评的"把没拿到当成 0"是同一个错误。
       正解：分别统计"能读到用量的账号数"，并把合计**明确标注为部分合计**；
       一个都没有可读用量时，合计返回 null 而不是 0 —— 让 UI 显示"—"。
   ═══════════════════════════════════════════════════════════════ */
export function useAggregate(accounts: AccountUsage[], limits: CfLimits | null) {
  return useMemo(() => {
    const ok = accounts.filter((a) => !a.error);
    const today = new Date().toISOString().slice(0, 10);

    /**
     * 汇总某个字段。返回 null 表示**没有任何账号可读**（区别于"合计为 0"）。
     * @param readable 该字段是否可读（决定这个账号算不算进分母）
     */
    const sumField = (
      pick: (a: AccountUsage) => UsageDay[] | null,
      field: keyof UsageDay,
      readable: (a: AccountUsage) => boolean
    ): { total: number | null; contributors: number; readableCount: number } => {
      const readableAccounts = ok.filter(readable);
      if (readableAccounts.length === 0) return { total: null, contributors: 0, readableCount: 0 };
      let total = 0;
      let contributors = 0;
      for (const a of readableAccounts) {
        const rows = pick(a);
        if (!rows) continue;
        const row = rows.find((r) => r.date === today) || rows[rows.length - 1];
        if (!row) continue;
        total += Number(row[field]) || 0;
        contributors++;
      }
      if (contributors === 0) return { total: null, contributors: 0, readableCount: readableAccounts.length };
      return { total, contributors, readableCount: readableAccounts.length };
    };

    const reqRes = sumField((a) => a.traffic.workers, "requests", (a) => a.traffic.workers !== null);
    const rrRes = sumField((a) => a.traffic.d1, "rowsRead", (a) => a.traffic.d1 !== null);
    const rwRes = sumField((a) => a.traffic.d1, "rowsWritten", (a) => a.traffic.d1 !== null);

    // 存量类：REST 能拿到才算（d1_detail 为空 = 这个账号读不到 D1）
    const d1Accounts = ok.filter((a) => (a.storage?.d1_detail?.length ?? 0) > 0);
    const d1Bytes = d1Accounts.length > 0 ? d1Accounts.reduce((s, a) => s + (a.storage?.d1_bytes || 0), 0) : null;

    const r2Accounts = ok.filter((a) => a.traffic?.r2_storage !== null);
    const r2Bytes = r2Accounts.length > 0
      ? r2Accounts.reduce((s, a) => s + (a.traffic?.r2_storage?.bytes || 0), 0) : null;
    const r2Objects = r2Accounts.reduce((s, a) => s + (a.traffic?.r2_storage?.objects || 0), 0);

    const kvRes = (() => {
      const readable = ok.filter((a) => a.traffic.kv !== null && (a.traffic.kv?.length ?? 0) > 0);
      if (readable.length === 0) return { total: null as number | null, contributors: 0 };
      let total = 0;
      let contributors = 0;
      for (const a of readable) {
        const row = a.traffic.kv!.find((r) => r.date === today) || a.traffic.kv![a.traffic.kv!.length - 1];
        if (!row) continue;
        total += row.read;
        contributors++;
      }
      return { total: contributors > 0 ? total : null, contributors };
    })();

    const counts = {
      zones: ok.reduce((s, a) => s + a.counts.zones, 0),
      d1: ok.reduce((s, a) => s + a.counts.d1_databases, 0),
      kv: ok.reduce((s, a) => s + a.counts.kv_namespaces, 0),
      r2: ok.reduce((s, a) => s + a.counts.r2_buckets, 0),
      workers: ok.reduce((s, a) => s + a.counts.worker_scripts, 0),
      pages: ok.reduce((s, a) => s + a.counts.pages_projects, 0),
      tunnels: ok.reduce((s, a) => s + a.counts.tunnels, 0),
    };

    return {
      reqToday: reqRes.total,
      reqContributors: reqRes.contributors,
      rowsReadToday: rrRes.total,
      rowsWriteToday: rwRes.total,
      d1Contributors: Math.max(rrRes.contributors, rwRes.contributors),
      d1Bytes,
      d1ContributorsStorage: d1Accounts.length,
      r2Bytes,
      r2Objects,
      r2Contributors: r2Accounts.length,
      kvReadToday: kvRes.total,
      kvContributors: kvRes.contributors,
      counts,
      total: accounts.length,
      okCount: ok.length,
      limits,
    };
  }, [accounts, limits]);
}
