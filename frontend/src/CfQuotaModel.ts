import type { AccountUsage, CfLimits } from "./CfUsage";

export type ReadingState = "ready" | "cached" | "pending" | "unavailable" | "no-resource" | "not-enabled" | "error";
export type MetricKey = "requests" | "rowsRead" | "rowsWritten" | "storage";
export type Reading = { value: number | null; state: ReadingState; date?: string; cachedAt?: string };
type ReadIssue = { kind: string; message: string; code?: number; cached_at?: string };
/** 只接受上游明确的未开通信号；普通403/10000绝不推断服务未启用。 */
export const isCfServiceNotEnabled = (issue?: ReadIssue) => Boolean(issue && (issue.kind === "not_enabled" || issue.code === 10042 || /please enable R2|R2 (?:is )?not enabled/i.test(issue.message)));
export type AccountReading = {
  account: AccountUsage;
  metrics: Record<MetricKey, Reading>;
  kvRead: Reading;
  maxUsage: number | null;
  maxMetric: string;
  pending: boolean;
  unavailable: boolean;
  cached: boolean;
  notEnabled: string[];
  high: boolean;
  failed: boolean;
};

export const METRIC_DEFS: Array<{ key: MetricKey; label: string; limit: keyof CfLimits; bytes?: boolean }> = [
  { key: "requests", label: "Workers 请求", limit: "workersRequestsPerDay" },
  { key: "rowsRead", label: "D1 行读", limit: "d1RowsReadPerDay" },
  { key: "rowsWritten", label: "D1 行写", limit: "d1RowsWrittenPerDay" },
  { key: "storage", label: "D1 存储", limit: "d1StorageBytes", bytes: true },
];

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** CF 日序列按 UTC 返回。没有当日行不是零，也不能偷偷用昨日读数替代。 */
function daily<T extends { date: string }>(rows: T[] | null, key: keyof T, today: string, resources: number, issue?: ReadIssue, inventoryIssue?: ReadIssue): Reading {
  if (isCfServiceNotEnabled(issue)) return { value: null, state: "not-enabled" };
  if (rows === null) return { value: null, state: "unavailable" };
  if (issue && !issue.cached_at) return { value: null, state: "unavailable" };
  const row = rows.find((entry) => entry.date === today);
  const value = row?.[key];
  if (finite(value)) return { value, state: issue?.cached_at ? "cached" : issue ? "unavailable" : "ready", date: today, cachedAt: issue?.cached_at };
  if (issue) return { value: null, state: "unavailable" };
  // 空资源列表和权限失败并非同义；当前 API 无资源查询状态，故仅称“无资源记录”。
  if (resources === 0 && rows.length === 0) return { value: null, state: inventoryIssue ? "unavailable" : "no-resource" };
  return { value: null, state: "pending", date: [...rows].sort((a, b) => b.date.localeCompare(a.date))[0]?.date };
}

export function readAccount(account: AccountUsage, today: string, limits: CfLimits | null): AccountReading {
  const error: Reading = { value: null, state: "error" };
  const issues = account.traffic.issues;
  const inventory = account.inventory_issues;
  const storageIssue = inventory?.d1_databases;
  const storage: Reading = account.storage?.d1_detail?.length > 0 && finite(account.storage.d1_bytes)
    ? { value: storageIssue && !storageIssue.cached_at ? null : account.storage.d1_bytes, state: storageIssue?.cached_at ? "cached" : storageIssue ? "unavailable" : "ready", cachedAt: storageIssue?.cached_at }
    : { value: null, state: account.counts.d1_databases === 0 && !storageIssue ? "no-resource" : "unavailable" };
  const metrics: Record<MetricKey, Reading> = account.error ? {
    requests: error, rowsRead: error, rowsWritten: error, storage: error,
  } : {
    requests: daily(account.traffic.workers, "requests", today, account.counts.worker_scripts, issues?.workers, inventory?.worker_scripts),
    rowsRead: daily(account.traffic.d1, "rowsRead", today, account.counts.d1_databases, issues?.d1, inventory?.d1_databases),
    rowsWritten: daily(account.traffic.d1, "rowsWritten", today, account.counts.d1_databases, issues?.d1, inventory?.d1_databases),
    storage,
  };
  const ratios = METRIC_DEFS.flatMap((def) => {
    const value = metrics[def.key].value;
    const cap = limits?.[def.limit];
    return value !== null && cap && cap > 0 ? [{ label: def.label, pct: value / cap * 100 }] : [];
  });
  // 监控已有的 KV 读取预警不能因摘要只显示四项而丢失；仍只取今日真值。
  const kvRead = account.error ? error : daily(account.traffic.kv, "read", today, account.counts.kv_namespaces, issues?.kv, inventory?.kv_namespaces);
  const kvCap = limits?.kvReadsPerDay;
  if (kvRead.value !== null && kvCap && kvCap > 0) {
    ratios.push({ label: "KV 读取", pct: kvRead.value / kvCap * 100 });
  }
  ratios.sort((a, b) => b.pct - a.pct);
  const maxUsage = ratios[0]?.pct ?? null;
  const readings = [...Object.values(metrics), kvRead];
  const allIssues = [...Object.entries(issues ?? {}), ...Object.entries(inventory ?? {})];
  const cached = readings.some((metric) => metric.state === "cached") || allIssues.some(([, issue]) => Boolean(issue.cached_at));
  return {
    account, metrics, kvRead, maxUsage, maxMetric: ratios[0]?.label ?? "",
    pending: readings.some((metric) => metric.state === "pending"),
    // 旧缓存是可读的恢复材料，不等同于本次成功，也不应再被归类为“不可读”。
    // 真正没有读数且没有缓存的上游问题才进入待核对计数。
    unavailable: readings.some((metric) => metric.state === "unavailable") || allIssues.some(([, issue]) => !isCfServiceNotEnabled(issue) && !issue.cached_at),
    cached,
    notEnabled: allIssues.filter(([, issue]) => isCfServiceNotEnabled(issue)).map(([key]) => key),
    high: maxUsage !== null && maxUsage > 60,
    failed: Boolean(account.error),
  };
}

export function buildQuotaModel(accounts: AccountUsage[], focus: number | "all", today: string, limits: CfLimits | null) {
  const selected = focus === "all" ? accounts : accounts.filter((account) => account.account_id === focus);
  const rows = selected.map((account) => readAccount(account, today, limits));
  const single = focus !== "all" && selected.length === 1;
  const metrics = METRIC_DEFS.map((def) => {
    const known = rows.map((row) => row.metrics[def.key]).filter((metric) => metric.value !== null);
    const value = known.length ? known.reduce((total, metric) => total + metric.value!, 0) : null;
    const cap = limits?.[def.limit];
    const highest = rows.reduce<{ alias: string; pct: number } | null>((result, row) => {
      const reading = row.metrics[def.key].value;
      if (reading === null || !cap || cap <= 0) return result;
      const pct = reading / cap * 100;
      return !result || pct > result.pct ? { alias: row.account.alias, pct } : result;
    }, null);
    return {
      ...def, value, cap, highest, coverage: known.length, cached: known.filter((reading) => reading.state === "cached").length, total: selected.length,
      state: single ? rows[0].metrics[def.key].state : undefined,
      // “全部”范围没有共享额度池；即使只绑定一个账号，汇总也不制造使用率。
      pct: single && value !== null && cap && cap > 0 ? value / cap * 100 : null,
    };
  });
  const dayKeys = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 6 + offset);
    return date.toISOString().slice(0, 10);
  });
  const days = dayKeys.map((date) => {
    const sources = selected.map((account) => {
      const value = account.error ? null : account.traffic.workers?.find((day) => day.date === date)?.requests;
      const issue = account.traffic.issues?.workers;
      return { id: account.account_id, alias: account.alias, value: finite(value) && (!issue || issue.cached_at) ? value : null, cached: Boolean(issue?.cached_at) };
    });
    const known = sources.filter((source) => source.value !== null);
    return { date, value: known.length ? known.reduce((sum, source) => sum + source.value!, 0) : null, coverage: known.length, cached: known.filter((source) => source.cached).length, ended: date < today, sources };
  });
  const knownDays = days.filter((day): day is typeof day & { value: number } => day.value !== null);
  const peak = knownDays.reduce<typeof knownDays[number] | null>((current, day) => !current || day.value > current.value ? day : current, null);
  // 今日尚未结束；即使所有账号已有读数，也不能混入完整日均值。
  const comparableDays = days.filter((day) => day.ended && !day.cached && day.coverage === selected.length && day.value !== null);
  const rest = comparableDays.filter((day) => day.date !== peak?.date);
  const mean = rest.length ? rest.reduce((sum, day) => sum + day.value!, 0) / rest.length : null;
  const multiple = peak?.coverage === selected.length && !peak.cached && mean !== null && mean > 0 ? peak.value / mean : null;
  const failed = rows.filter((row) => row.failed).length;
  const unavailable = rows.filter((row) => row.unavailable && !row.failed).length;
  const cached = rows.filter((row) => row.cached && !row.failed).length;
  const pending = rows.filter((row) => row.pending && !row.failed).length;
  const high = rows.filter((row) => row.high).length;
  return { rows, metrics, days, peak, multiple, single, total: rows.length, failed, unavailable, cached, pending, high };
}

export type QuotaModel = ReturnType<typeof buildQuotaModel>;
