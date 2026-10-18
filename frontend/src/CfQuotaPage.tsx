import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { type AccountUsage, type CfLimits, cfAccountDiagnostics, CF_TOKEN_CREATE_URL, fmtBytes, fmtNum, fmtShort, usageLevel, LEVEL_TEXT } from "./CfUsage";
import { ColumnChart } from "./CfCharts";
import { buildQuotaModel, type AccountReading, type QuotaModel, type ReadingState } from "./CfQuotaModel";
import type { InterfaceStyle } from "./InterfaceStyle";
import { usePageSearch } from "./PageSearch";
import "./cf-quota.css";

const READING_LABEL: Record<ReadingState, string> = {
  ready: "已返回", cached: "保留缓存", pending: "今日无操作记录", unavailable: "上游未返回", "no-resource": "无资源记录", "not-enabled": "服务未启用", error: "读取失败",
};
const METRIC_SHORT: Record<string, string> = { "Workers 请求": "Workers", "D1 行读": "D1 读", "D1 行写": "D1 写", "D1 存储": "D1 存储", "KV 读取": "KV 读" };
const BUTTON = "h-10 px-3 rounded-lg border border-border-base text-sm whitespace-nowrap text-content-secondary hover:bg-hovered transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function cfResourceUrl(account: AccountUsage, key: string): string | null {
  const id = account.cf_account_id;
  if (!id) return null;
  const paths: Record<string, string> = {
    r2_buckets: "r2",
    r2_storage: "r2",
    pages_projects: "pages",
    kv_namespaces: "workers/kv/namespaces",
    kv: "workers/kv/namespaces",
  };
  const path = paths[key];
  return path ? `https://dash.cloudflare.com/${encodeURIComponent(id)}/${path}` : null;
}

/** 日序列的日期来自 Cloudflare UTC，不混用本地日期或昨日值。 */
export function CfQuotaDashboard({ accounts, limits, loading, onRefresh, updatedAt, interfaceStyle }: {
  accounts: AccountUsage[]; limits: CfLimits | null; loading: boolean; onRefresh: () => void; updatedAt: number;
  interfaceStyle: InterfaceStyle;
}) {
  const view = interfaceStyle === "data" ? "clear" : "bold";
  const [focus, setFocus] = useState<number | "all">("all");
  const today = new Date().toISOString().slice(0, 10);
  const validFocus = focus === "all" || accounts.some((account) => account.account_id === focus) ? focus : "all";
  const model = useMemo(() => buildQuotaModel(accounts, validFocus, today, limits), [accounts, validFocus, today, limits]);
  const status = model.failed ? `${model.failed} 个账号读取失败` : model.unavailable ? `${model.unavailable} 个账号有指标待核对`
    : model.pending ? `${model.pending} 个账号今日无操作记录` : model.cached ? `${model.cached} 个账号沿用缓存` : "已读取当前范围";

  return (
    <div className="cf-quota-workspace space-y-4 min-w-0" data-cf-quota-view={view} data-mode={view === "bold" ? "design" : "data"}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-2xl font-semibold tracking-tight text-content-primary">Cloudflare 用量</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-content-muted" role="status">
            <p className={model.failed ? "text-red-600 dark:text-red-400" : "text-content-secondary"}>{loading ? (accounts.length ? "正在更新 · 保留当前快照" : "正在更新") : status}</p>
            <p className="mt-1 tabular-nums">{updatedAt ? `更新于 ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚未获取"}</p>
          </div>
          <button type="button" className={BUTTON} onClick={onRefresh} disabled={loading}>{loading ? "刷新中" : "刷新"}</button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b border-border-base pb-3">
        <label className="cf-scope-control flex min-w-0 items-center gap-2 text-sm text-content-secondary flex-1 sm:flex-none">
          <span className="shrink-0">账号范围</span>
          <select aria-label="账号范围" value={String(validFocus)} onChange={(event) => setFocus(event.target.value === "all" ? "all" : Number(event.target.value))}
            className="form-input h-10 text-sm rounded-lg px-3 min-w-0 w-full sm:w-64">
            <option value="all">全部账号 · {accounts.length}</option>
            {accounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.alias}{account.error ? " · 读取失败" : ""}</option>)}
          </select>
        </label>
        <p className="text-xs text-content-muted sm:ml-auto">{today} UTC · 日用量 / 当前存储</p>
      </div>
      {loading && !accounts.length ? <div className="p-6 border border-border-base rounded-lg text-sm text-content-secondary" role="status">正在读取账号用量…</div>
        : !accounts.length ? <div className="p-6 border border-border-base rounded-lg text-sm text-content-secondary">尚未绑定 Cloudflare 账号。请到「账号管理」绑定 API Token 后刷新。</div>
        : <>
          {view === "bold" ? <>
            <DesignSummary model={model} />
            <MetricStrip model={model} variant="design" />
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] gap-4"><TrendPanel model={model} /><InsightPanel model={model} /></div>
            <AccountTable key={validFocus} model={model} limits={limits} today={today} summary />
          </> : <>
            <MonitorSummary model={model} />
            <AccountTable key={validFocus} model={model} limits={limits} today={today} />
            <details className="cf-data-trend" open>
              <summary className="cf-data-trend-summary">趋势与资源总量 <span>7 日序列与资源计数</span></summary>
              <div className="cf-data-overview"><MetricStrip model={model} variant="data" /><TrendPanel model={model} compact /></div>
            </details>
          </>}
        </>}
    </div>
  );
}

function DesignSummary({ model }: { model: QuotaModel }) {
  const requestMetric = model.metrics.find((metric) => metric.key === "requests");
  const peak = model.peak;
  const verdict = model.failed ? `${model.failed} 个账号读取失败，先检查数据连接`
    : model.metrics.every((metric) => metric.value === null) ? "尚无可判断的用量数据"
    : model.high ? `${model.high} 个账号用量偏高，留意单项额度`
    : model.unavailable || model.pending || model.cached ? "数据尚不完整，暂不判断总体余量"
    : model.multiple !== null && model.multiple >= 3 ? "当前用量正常，近期出现请求峰值" : "当前已读用量平稳";
  return <section className="cf-design-hero" aria-label="用量结论">
    <div className="cf-design-hero-copy">
      <p className="cf-design-overline">Cloudflare / 今日读数</p>
      <p className="cf-design-verdict" data-cf-verdict>{verdict}</p>
      <p className="cf-design-lede">按账号独立计算；缺失值保持未知，不用昨日数据填充。</p>
    </div>
    <dl className="cf-design-hero-facts">
      <div><dt>今日请求</dt><dd>{requestMetric?.value === null || requestMetric?.value === undefined ? "—" : fmtShort(requestMetric.value)}</dd><small>{requestMetric?.coverage ?? 0}/{model.total} 账号</small></div>
      <div><dt>最高压力</dt><dd>{requestMetric?.highest ? `${requestMetric.highest.pct.toFixed(1)}%` : "—"}</dd><small>{requestMetric?.highest?.alias ?? "尚无可比读数"}</small></div>
      <div><dt>近 7 日峰值</dt><dd>{peak ? fmtShort(peak.value) : "—"}</dd><small>{peak?.date ?? "尚无历史读数"}</small></div>
    </dl>
  </section>;
}

function MetricStrip({ model, variant = "default" }: { model: QuotaModel; variant?: "design" | "data" | "detail" | "default" }) {
  return <section aria-label="当前用量摘要" className={`cf-current-metrics grid grid-cols-2 lg:grid-cols-4 border border-border-base rounded-lg bg-surface overflow-hidden ${variant === "design" ? "cf-design-capacity-rail" : variant === "data" ? "cf-data-metric-strip" : variant === "detail" ? "cf-detail-metric-strip" : ""}`}>
    {model.metrics.map((metric) => <div key={metric.key} className="p-4 min-w-0 border-r border-b lg:border-b-0 last:border-r-0 border-border-soft" data-cf-metric={metric.key}>
      <p className="text-xs text-content-secondary">{metric.label}{metric.key !== "storage" ? " · 今日" : ""}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-content-primary">{metric.value === null ? "—" : metric.bytes ? fmtBytes(metric.value) : fmtNum(metric.value)}</p>
      <div className="mt-2 text-xs leading-5 text-content-muted">
        {model.single ? <p className={LEVEL_TEXT[usageLevel(metric.pct)]}>{metric.pct !== null ? `${metric.pct.toFixed(1)}% 已用${metric.state === "cached" ? " · 缓存" : ""}` : READING_LABEL[metric.state ?? "unavailable"]}</p>
          : <><p className={LEVEL_TEXT[usageLevel(metric.highest?.pct ?? null)]} data-cf-highest-account>{metric.highest ? `最高单账号 ${metric.highest.pct.toFixed(1)}%` : "尚无可比用量"}</p><p>{metric.coverage === metric.total ? "已读合计" : "部分合计"} · {metric.coverage}/{metric.total} 账号{metric.cached ? ` · 含 ${metric.cached} 缓存` : ""}</p></>}
        <p>{metric.cap ? `${model.single ? "额度" : "每账号额度"} ${metric.bytes ? fmtBytes(metric.cap) : fmtShort(metric.cap)}${metric.key !== "storage" ? " / 日" : ""}` : "未提供额度信息"}</p>
      </div>
      {metric.highest && <div className="cf-metric-pressure" aria-hidden="true"><span style={{ width: `${Math.min(100, metric.highest.pct)}%` }} /></div>}
    </div>)}
  </section>;
}

function TrendPanel({ model, accountName, compact = false }: { model: QuotaModel; accountName?: string; compact?: boolean }) {
  const hasReliableHistory = model.days.some((day) => day.value !== null);
  return <section className={`cf-trend-panel border border-border-base rounded-lg bg-surface p-4 min-w-0 ${compact ? "cf-trend-compact" : ""}`} aria-label="近七日请求趋势">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h3 className="text-sm font-semibold text-content-primary">近 7 日请求趋势</h3><span className="text-xs text-content-muted">{accountName ?? "当前范围合计"} · UTC</span></div>
    {hasReliableHistory ? <div className={compact ? "mt-2" : "mt-3"}><ColumnChart height={compact ? 124 : 184} unit="请求数" annotatePeak data={model.days.map((day) => ({
      label: day.date.slice(5), value: day.value,
      tooltip: [day.date + ` · UTC${day.ended ? "" : " · 今日未结束，截至采集"}`, day.value === null ? "请求数：未返回数据" : `${day.coverage === model.total ? "总请求数" : "已读请求数"}：${fmtNum(day.value)}`,
        `覆盖 ${day.coverage}/${model.total} 账号${day.cached ? ` · 含 ${day.cached} 缓存` : ""}`, ...day.sources.map((source) => `${source.alias}：${source.value === null ? "未返回" : fmtNum(source.value)}${source.cached ? "（缓存）" : ""}`)].join("\n"),
    }))} /></div> : <p className="cf-no-history mt-3">暂无可靠的逐日请求读数。</p>}
    <p className={compact ? "sr-only" : "mt-2 text-xs text-content-muted"}>点按日期固定明细，Esc 关闭。<span className="sr-only">悬停与键盘聚焦均可查看。“—”为未返回，不计为零。</span></p>
  </section>;
}

function InsightPanel({ model }: { model: QuotaModel }) {
  const peak = model.peak;
  const contributors = peak?.sources.filter((source) => source.value !== null).sort((a, b) => b.value! - a.value!) ?? [];
  return <section className="cf-insight-panel border border-border-base rounded-lg bg-surface p-4 min-w-0">
    <h3 className="text-sm font-semibold text-content-primary">峰值与数据状态</h3>
    {peak ? <>
      <div className="mt-3 flex flex-wrap items-baseline gap-3"><span className="text-2xl font-semibold tabular-nums text-content-primary">{fmtShort(peak.value)}</span><span className="text-xs text-content-muted">{peak.date} · {peak.coverage}/{model.total} 账号已读{peak.cached ? " · 含缓存" : ""}{peak.ended ? "" : " · 今日未结束，截至采集"}</span></div>
      <p className="mt-1 text-xs text-content-secondary">{model.multiple !== null ? `${peak.ended ? "峰值" : "当前累计"}相当于其余已结束且全部账号返回日期均值的 ${model.multiple.toFixed(1)} 倍` : peak.cached ? "包含旧缓存，暂不计算本次波动倍数" : "已结束日数据不足或均值为零，不计算波动倍数"}</p>
      <div className="cf-peak-sources mt-4 border-t border-border-soft pt-3 space-y-2">
        {contributors.slice(0, 3).map((source) => <div key={source.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs">
          <span className="text-content-secondary truncate" title={source.alias}>{source.alias}</span><span className="tabular-nums text-content-primary">{fmtNum(source.value!)}{peak.value > 0 ? ` · ${(source.value! / peak.value * 100).toFixed(0)}%` : ""}</span>
        </div>)}
        {contributors.length > 3 && <p className="text-xs text-content-muted">另 {contributors.length - 3} 个账号，完整构成见日期明细。</p>}
      </div>
    </> : <p className="mt-3 text-sm text-content-muted">近七日尚无可读取的请求数据。</p>}
    <p className="cf-insight-note mt-4 border-t border-border-soft pt-3 text-xs leading-5 text-content-muted">{model.failed || model.unavailable || model.pending || model.cached
      ? `${model.failed} 个失败 · ${model.unavailable} 个指标待核对 · ${model.pending} 个今日无操作记录 · ${model.cached} 个沿用缓存；展开账号查看原因。`
      : "峰值不代表超额；额度按账号独立计算。"}</p>
  </section>;
}

function MonitorSummary({ model }: { model: QuotaModel }) {
  const incomplete = model.rows.filter((row) => !row.failed && (row.pending || row.unavailable)).length;
  const items = [
    { label: "个账号", value: model.total, tone: "text-content-primary" },
    { label: "用量关注", value: model.high, tone: model.high ? "text-amber-600 dark:text-amber-400" : "text-content-muted" },
    { label: "数据待补齐", value: incomplete, tone: incomplete ? "text-amber-600 dark:text-amber-400" : "text-content-muted" },
    { label: "读取失败", value: model.failed, tone: model.failed ? "text-red-600 dark:text-red-400" : "text-content-muted" },
  ];
  return <section className="cf-monitor-status flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border-base py-3" aria-label="监控状态摘要">
    <div className="cf-monitor-status-items">
      {items.map((item) => <p key={item.label} className={`inline-flex items-baseline gap-1.5 text-sm ${item.tone}`}><strong className="font-semibold tabular-nums">{item.value}</strong><span>{item.label}</span></p>)}
    </div>
    <p className="cf-monitor-status-note text-xs text-content-muted sm:ml-auto">额度按账号独立计算</p>
  </section>;
}

function rowStatus(row: AccountReading) {
  if (row.failed) return { text: "读取失败", tone: "text-red-600 dark:text-red-400" };
  const issue = cfAccountDiagnostics(row.account).find((entry) => entry.summary !== "未启用");
  if (issue) {
    const prefix = issue.issue.cached_at ? "保留缓存 · " : "";
    const text = prefix + (issue.issue.kind === "permission" ? "权限待核对"
      : issue.issue.kind === "authentication" ? "认证未通过"
      : issue.issue.kind === "timeout" ? "读取超时"
      : issue.issue.kind === "rate_limit" ? "请求受限"
      : issue.issue.kind === "network" ? "连接失败"
      : "数据待核对");
    return { text, tone: "text-amber-600 dark:text-amber-400" };
  }
  if (row.unavailable) return { text: "数据未返回", tone: "text-amber-600 dark:text-amber-400" };
  if (row.pending) return { text: "今日无操作记录", tone: "text-content-muted" };
  if (row.cached) return { text: "保留缓存", tone: "text-content-secondary" };
  if (row.high) return { text: row.maxUsage! > 85 ? "接近额度" : "用量偏高", tone: LEVEL_TEXT[usageLevel(row.maxUsage)] };
  if ([...Object.values(row.metrics), row.kvRead].every((metric) => metric.state === "no-resource")) return { text: "无资源记录", tone: "text-content-muted" };
  if (row.notEnabled.length) return { text: "已读取 · 部分服务未启用", tone: "text-content-secondary" };
  return { text: "已读取", tone: "text-content-secondary" };
}

/** 账号详情作为行的后续内容渲染，避免跨账号汇总到表格底部。 */
function AccountDetail({ selected, detailModel, close, mobile = false }: { selected: AccountReading; detailModel: QuotaModel; close: () => void; mobile?: boolean }) {
  const diagnostics = cfAccountDiagnostics(selected.account);
  const attentionCount = diagnostics.filter((entry) => entry.summary !== "未启用").length;
  return <div id={mobile ? "cf-account-detail-mobile" : "cf-account-detail"} {...(mobile ? { "data-cf-account-detail-mobile": true } : {})} className="cf-account-detail border-t border-border-base p-4 space-y-4">
    <div className="flex items-center justify-between gap-3"><div className="min-w-0"><h4 className="text-base font-semibold text-content-primary break-all">{selected.account.alias}</h4><p className="mt-1 text-xs text-content-muted">{selected.failed ? "账号读取失败" : attentionCount ? `${attentionCount} 项读取需关注` : selected.pending ? "今日数据待返回" : "已返回当前可读数据"}</p></div><button type="button" className={BUTTON} onClick={close}>关闭详情</button></div>
    <p className="text-xs leading-5 text-content-muted" {...(!mobile ? { "data-cf-history-coverage": true } : {})}>近 7 日返回 {detailModel.days.filter((day) => day.value !== null).length} 天 · UTC · 未返回日期不补零</p>
    {(selected.unavailable || selected.pending || selected.failed) && <dl className="cf-reading-status grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs" aria-label="各项读取状态">
      {[...Object.entries(selected.metrics).map(([key, reading]) => ({ label: { requests: "Workers 请求", rowsRead: "D1 行读", rowsWritten: "D1 行写", storage: "D1 存储" }[key], reading })), { label: "KV 读取", reading: selected.kvRead }].map(({ label, reading }) => <div key={label} className="flex flex-wrap items-baseline gap-2"><dt className="text-content-secondary">{label}</dt><dd className={reading.state === "unavailable" || reading.state === "error" || reading.state === "cached" ? "text-amber-600 dark:text-amber-400" : "text-content-muted"}>{READING_LABEL[reading.state]}{reading.state === "pending" && reading.date ? ` · 最近 ${reading.date}` : reading.cachedAt ? ` · ${new Date(reading.cachedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}</dd></div>)}
    </dl>}
    {diagnostics.length > 0 && <div className="cf-diagnostics" aria-label="读取诊断与服务状态">{diagnostics.map((entry) => <details key={entry.key} className="cf-diagnostic-item" data-cf-diagnostic={entry.key}>
      <summary><span>{entry.label} · {entry.summary}</span>{entry.issue.cached_at && <small>保留缓存 · {new Date(entry.issue.cached_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</small>}</summary>
      <div className="cf-diagnostic-body">
        <dl><div><dt>接口</dt><dd><code>{entry.endpoint}</code></dd></div><div><dt>权限</dt><dd>{entry.permission}</dd></div><div><dt>范围</dt><dd>{entry.scope}</dd></div>
          <div><dt>响应</dt><dd>{entry.issue.http_status ? `HTTP ${entry.issue.http_status}` : /HTTP\s+(\d+)/.exec(entry.issue.message)?.[0] || "上游未提供 HTTP 状态"}{entry.issue.code ? ` / code ${entry.issue.code}` : ""}</dd></div>
          {entry.issue.cached_at && <div><dt>缓存时间</dt><dd>{new Date(entry.issue.cached_at).toLocaleString("zh-CN", { hour12: false })}</dd></div>}</dl>
        <p className="cf-diagnostic-raw">{entry.issue.message}</p>
        {entry.summary === "未启用" ? <p>该账号尚未开通此服务，不计为读取失败；需要使用时再到 Cloudflare 开通。{cfResourceUrl(selected.account, entry.key) && <a href={cfResourceUrl(selected.account, entry.key)!} target="_blank" rel="noopener noreferrer">打开对应服务</a>}</p> : ["permission", "authentication"].includes(entry.issue.kind) && <p>核对账号范围与权限；<a href={CF_TOKEN_CREATE_URL} target="_blank" rel="noopener noreferrer">申请模板</a>只负责预填，不会升级已签发的 Token。{cfResourceUrl(selected.account, entry.key) && <a href={cfResourceUrl(selected.account, entry.key)!} target="_blank" rel="noopener noreferrer">打开对应服务</a>}</p>}
      </div>
    </details>)}</div>}
    {(selected.account.error || !diagnostics.length && selected.account.traffic.reason) && <details className="cf-diagnostic-item"><summary>原始诊断</summary><p className="cf-diagnostic-raw p-3">{selected.account.error || selected.account.traffic.reason}</p></details>}
    {!selected.failed && !selected.account.traffic.issues?.kv && ["pending", "unavailable", "no-resource"].includes(selected.kvRead.state) && <p className="text-xs text-content-secondary" data-cf-kv-status>KV · {selected.kvRead.state === "pending" ? `今日没有操作记录（上游仅返回有操作记录的日期）${selected.kvRead.date ? ` · 最近 ${selected.kvRead.date}` : ""}` : selected.kvRead.state === "no-resource" ? "暂无读取记录" : "上游未返回数据"}{cfResourceUrl(selected.account, "kv_namespaces") && <a className="ml-2 underline underline-offset-2" href={cfResourceUrl(selected.account, "kv_namespaces")!} target="_blank" rel="noopener noreferrer">管理 KV</a>}</p>}
    {!selected.failed && selected.account.counts.r2_buckets > 0 && !selected.account.traffic.r2_storage && !selected.account.traffic.issues?.r2_storage && <p className="text-xs leading-5 text-content-muted" data-cf-r2-status>R2 · 当前存储快照尚未返回{cfResourceUrl(selected.account, "r2_storage") && <a className="ml-2 underline underline-offset-2" href={cfResourceUrl(selected.account, "r2_storage")!} target="_blank" rel="noopener noreferrer">管理 R2</a>}</p>}
    {selected.maxUsage !== null && <p className={`text-sm ${LEVEL_TEXT[usageLevel(selected.maxUsage)]}`}>最高使用率：{selected.maxMetric} · {selected.maxUsage.toFixed(1)}%</p>}
    <MetricStrip model={detailModel} variant="detail" /><TrendPanel model={detailModel} accountName="当前账号" compact />
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-content-muted">{([{ label: "Zone", key: "zones" }, { label: "D1 库", key: "d1_databases" }, { label: "KV", key: "kv_namespaces" }, { label: "Worker", key: "worker_scripts" }, { label: "Pages", key: "pages_projects" }, { label: "R2", key: "r2_buckets" }] as const).map(({ label, key }) => {
      const issue = selected.account.inventory_issues?.[key];
      const resourceLink = (key === "pages_projects" || key === "r2_buckets" || key === "kv_namespaces") ? cfResourceUrl(selected.account, key) : null;
      return <div key={label} className="flex gap-2"><dt>{label}</dt><dd className="tabular-nums text-content-secondary">{selected.failed || issue && !issue.cached_at ? "—" : selected.account.counts[key]}{issue?.cached_at ? " · 缓存" : ""}{resourceLink && <a className="ml-1 underline underline-offset-2" href={resourceLink} target="_blank" rel="noopener noreferrer">管理</a>}</dd></div>;
    })}</dl>
  </div>;
}

function AccountTable({ model, limits, today, summary = false }: { model: QuotaModel; limits: CfLimits | null; today: string; summary?: boolean }) {
  const { query } = usePageSearch();
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("attention");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => { setPage(0); }, [query]);
  const trigger = useRef<HTMLElement | null>(null);
  const selected = model.rows.find((row) => row.account.account_id === selectedId);
  const filtered = useMemo(() => model.rows.filter((row) => {
    if (!row.account.alias.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "issues") return row.failed || row.unavailable || row.pending || row.high;
    if (filter === "high") return row.high;
    if (filter === "failed") return row.failed;
    return true;
  }).sort((a, b) => {
    if (sort === "name") return a.account.alias.localeCompare(b.account.alias);
    if (sort === "usage") return (b.maxUsage ?? -1) - (a.maxUsage ?? -1);
    const rank = (row: AccountReading) => row.failed ? 4 : row.high ? 3 : row.unavailable ? 2 : row.pending ? 1 : 0;
    return rank(b) - rank(a) || (b.maxUsage ?? -1) - (a.maxUsage ?? -1) || a.account.alias.localeCompare(b.account.alias);
  }), [model.rows, query, filter, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 10, currentPage * 10 + 10);
  const close = () => { setSelectedId(null); trigger.current?.focus(); };
  const format = (value: number | null, bytes = false) => value === null ? "—" : bytes ? fmtBytes(value) : fmtNum(value);
  const detailModel = selected ? buildQuotaModel([selected.account], selected.account.account_id, today, limits) : null;
  const selectRow = (row: AccountReading, target: HTMLElement) => {
    trigger.current = target;
    setSelectedId(selectedId === row.account.account_id ? null : row.account.account_id);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>, row: AccountReading) => {
    // 行是可点击的补充触区；按钮自己已经处理 Enter/Space，避免一次按键切换两次。
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea, summary, details")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectRow(row, event.currentTarget);
  };
  return <section className={`cf-account-collection ${summary ? "cf-account-collection--design" : "cf-account-collection--data"} border border-border-base rounded-lg bg-surface min-w-0`} aria-label={summary ? "账号摘要" : "账号监控列表"}
    onKeyDown={(event) => { if (event.key === "Escape" && selectedId !== null) { event.stopPropagation(); close(); } }}>
    <div className="p-4 border-b border-border-base space-y-3">
      <div className="flex flex-wrap items-baseline gap-3"><h3 className="text-sm font-semibold text-content-primary">{summary ? "账号摘要" : "账号监控"}</h3><span className="text-xs text-content-muted">{filtered.length}/{model.total} 个账号 · 最高使用率按单账号计算</span></div>
      <div className="grid grid-cols-2 gap-2">
        <select aria-label="账号状态筛选" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }} className="form-input h-10 text-sm rounded-lg px-3 min-w-0 w-full"><option value="all">全部状态</option><option value="issues">仅需关注</option><option value="high">用量偏高</option><option value="failed">读取失败</option></select>
        <select aria-label="账号排序" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }} className="form-input h-10 text-sm rounded-lg px-3 min-w-0 w-full"><option value="attention">关注优先</option><option value="usage">按使用率</option><option value="name">按账号名称</option></select>
      </div>
    </div>
    <p className="cf-table-scroll-hint px-4 py-2 text-xs text-content-muted">左右滚动表格查看其余指标；账号详情可查看全部读数。</p>
    <div className="cf-account-desktop overflow-x-auto" tabIndex={0} role="region" aria-label="账号比较表，可左右滚动"><table className="w-full border-collapse text-sm min-w-[800px]" data-cf-account-table>
      <thead className="bg-elevated text-xs text-content-secondary"><tr>
        <th className="px-4 py-3 text-left font-medium">账号</th><th className="px-3 py-3 text-right font-medium whitespace-nowrap">今日请求</th><th className="px-3 py-3 text-right font-medium whitespace-nowrap">D1 行读</th>
        {!summary && <th className="px-3 py-3 text-right font-medium whitespace-nowrap">D1 行写</th>}{!summary && <th className="px-3 py-3 text-right font-medium whitespace-nowrap">D1 存储</th>}
        <th className="px-3 py-3 text-right font-medium whitespace-nowrap">最高使用率</th><th className="px-3 py-3 text-left font-medium">状态</th><th className="px-4 py-3 text-right font-medium">详情</th>
      </tr></thead>
      <tbody>{visible.map((row) => {
        const status = rowStatus(row), open = selectedId === row.account.account_id, detailId = "cf-account-detail";
        return <Fragment key={row.account.account_id}><tr tabIndex={0} aria-expanded={open} aria-controls={open ? detailId : undefined} aria-label={`${row.account.alias}，按 Enter 查看详情`} onClick={(event) => { if ((event.target as HTMLElement).closest("button, a, input, select, textarea, summary, details")) return; selectRow(row, event.currentTarget); }} onKeyDown={(event) => handleRowKeyDown(event, row)} className={`cf-account-row border-t border-border-soft ${open ? "bg-primary-soft" : "hover:bg-hovered"}`} data-cf-account-id={row.account.account_id}>
          <td className="px-4 py-3 text-content-primary"><span className="block break-all">{row.account.alias}</span></td>
          <td className="px-3 py-3 text-right tabular-nums text-content-primary whitespace-nowrap">{format(row.metrics.requests.value)}</td><td className="px-3 py-3 text-right tabular-nums text-content-primary whitespace-nowrap">{format(row.metrics.rowsRead.value)}</td>
          {!summary && <td className="px-3 py-3 text-right tabular-nums text-content-primary whitespace-nowrap">{format(row.metrics.rowsWritten.value)}</td>}{!summary && <td className="px-3 py-3 text-right tabular-nums text-content-primary whitespace-nowrap">{format(row.metrics.storage.value, true)}</td>}
          <td className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${LEVEL_TEXT[usageLevel(row.maxUsage)]}`}>
            <span className="inline-flex items-baseline gap-2"><span className="text-xs text-content-muted" data-cf-max-metric>{METRIC_SHORT[row.maxMetric] ?? row.maxMetric}</span><span>{row.maxUsage === null ? "—" : `${row.maxUsage.toFixed(1)}%`}</span></span>
          </td>
          <td className={`px-3 py-3 text-xs whitespace-nowrap ${status.tone}`}>{status.text}</td>
          <td className="px-4 py-1 text-right"><button type="button" className={BUTTON} aria-expanded={open} aria-controls={detailId} aria-label={`查看 ${row.account.alias} 用量详情`}
            onClick={(event) => { event.stopPropagation(); selectRow(row, event.currentTarget); }}>{open ? "收起" : "查看"}</button></td>
        </tr>{open && selected && detailModel && <tr className="cf-account-detail-row" aria-live="polite"><td colSpan={summary ? 6 : 8} className="p-0"><AccountDetail selected={selected} detailModel={detailModel} close={close} /></td></tr>}</Fragment>;
      })}</tbody>
    </table></div>
    <div className="cf-account-mobile" aria-label="账号用量摘要列表">
      {visible.map((row) => {
        const status = rowStatus(row), open = selectedId === row.account.account_id, detailId = "cf-account-detail-mobile";
        return <article key={row.account.account_id} tabIndex={0} aria-expanded={open} aria-controls={open ? detailId : undefined} aria-label={`${row.account.alias}，按 Enter 查看详情`} onClick={(event) => { if ((event.target as HTMLElement).closest("button, a, input, select, textarea, summary, details, .cf-account-detail")) return; selectRow(row, event.currentTarget); }} onKeyDown={(event) => handleRowKeyDown(event, row)} className={`cf-account-row border-t border-border-soft p-4 ${open ? "bg-primary-soft" : ""}`} data-cf-account-mobile={row.account.account_id}>
          <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h4 className="text-sm font-medium text-content-primary break-all">{row.account.alias}</h4><p className={`mt-1 text-xs ${status.tone}`}>{status.text}</p></div>
            <button type="button" className={BUTTON} aria-expanded={open} aria-controls={detailId} aria-label={`查看 ${row.account.alias} 用量详情`} onClick={(event) => { event.stopPropagation(); selectRow(row, event.currentTarget); }}>{open ? "收起" : "查看"}</button></div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3"><div><dt className="text-xs text-content-muted">今日请求</dt><dd className="mt-1 text-sm tabular-nums text-content-primary">{format(row.metrics.requests.value)}</dd></div><div><dt className="text-xs text-content-muted">D1 行读</dt><dd className="mt-1 text-sm tabular-nums text-content-primary">{format(row.metrics.rowsRead.value)}</dd></div></dl>
          <p className={`mt-3 text-xs ${LEVEL_TEXT[usageLevel(row.maxUsage)]}`}>{row.maxUsage === null ? "尚无可比用量" : `最高单项 · ${row.maxMetric} ${row.maxUsage.toFixed(1)}%`}</p>
          {open && selected && detailModel && <AccountDetail selected={selected} detailModel={detailModel} close={close} mobile />}
        </article>;
      })}
    </div>
    {!visible.length && <p className="p-6 text-center text-sm text-content-muted">没有匹配的账号。请调整搜索词或状态筛选。</p>}
    {pages > 1 && <div className="px-4 py-3 border-t border-border-base flex flex-wrap items-center gap-3 text-xs text-content-muted" data-cf-pagination>
      <p>{filtered.length ? `${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, filtered.length)} / ${filtered.length}` : "0 / 0"} · 每页 10 个账号</p>
      <div className="ml-auto flex gap-2"><button type="button" className={BUTTON} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</button><button type="button" className={BUTTON} disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
    </div>}
  </section>;
}
