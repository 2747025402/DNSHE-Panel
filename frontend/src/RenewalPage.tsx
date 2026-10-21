import { useMemo } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, RefreshCw, Settings2 } from "lucide-react";
import { usePageSearch } from "./PageSearch";
import type { InterfaceStyle } from "./InterfaceStyle";
import "./renewal-workspace.css";

export interface RenewalDomain {
  id: number;
  account_id: number;
  account_alias: string;
  full_domain: string;
  expires_at?: string | null;
  last_renewed_at?: string | null;
  account_provider?: string | null;
}

export interface RenewalLog {
  id: number;
  type: string;
  category: string;
  message: string;
  created_at: string;
}

export interface RenewalSettings {
  auto_renew: string;
  renew_threshold_days: string;
}

type RenewalState = "missing" | "overdue" | "due" | "healthy";

interface RenewalRow extends RenewalDomain {
  state: RenewalState;
  days: number | null;
}

interface RenewalPageProps {
  domains: RenewalDomain[];
  logs: RenewalLog[];
  settings: RenewalSettings;
  loading: boolean;
  saving: boolean;
  actionLoading: string | null;
  interfaceStyle: InterfaceStyle;
  onRefresh: () => void;
  onSaveSettings: () => void;
  onChangeSettings: (next: Partial<RenewalSettings>) => void;
  onRenew: (domain: RenewalDomain) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(value: string | null | undefined, now: number): number | null {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? Math.ceil((time - now) / DAY_MS) : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "未返回";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : value;
}

function stateLabel(state: RenewalState): string {
  return state === "overdue" ? "已过期" : state === "due" ? "进入窗口" : state === "missing" ? "到期未知" : "安全区间";
}

function stateClass(state: RenewalState): string {
  return state === "overdue"
    ? "renewal-state renewal-state--danger"
    : state === "due"
      ? "renewal-state renewal-state--due"
      : state === "missing"
        ? "renewal-state renewal-state--unknown"
        : "renewal-state renewal-state--healthy";
}

function remainingText(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天到期";
  return `剩余 ${days} 天`;
}

export function RenewalPage({
  domains,
  logs,
  settings,
  loading,
  saving,
  actionLoading,
  interfaceStyle,
  onRefresh,
  onSaveSettings,
  onChangeSettings,
  onRenew,
}: RenewalPageProps) {
  const { query } = usePageSearch();
  const now = Date.now();
  const threshold = Math.max(0, Number.parseInt(settings.renew_threshold_days || "180", 10) || 180);
  const rows = useMemo<RenewalRow[]>(() => domains
    .filter((domain) => domain.account_provider !== "cloudflare")
    .map((domain) => {
      const days = daysUntil(domain.expires_at, now);
      const state: RenewalState = days === null ? "missing" : days < 0 ? "overdue" : days <= threshold ? "due" : "healthy";
      return { ...domain, state, days };
    })
    .filter((domain) => {
      const needle = query.trim().toLowerCase();
      return !needle || `${domain.full_domain} ${domain.account_alias}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => {
      const left = a.days === null ? Number.POSITIVE_INFINITY : a.days;
      const right = b.days === null ? Number.POSITIVE_INFINITY : b.days;
      return left - right || a.full_domain.localeCompare(b.full_domain);
    }), [domains, now, query, threshold]);

  const due = rows.filter((row) => row.state === "due");
  const overdue = rows.filter((row) => row.state === "overdue");
  const missing = rows.filter((row) => row.state === "missing");
  const renewedRecently = rows.filter((row) => {
    const time = Date.parse(String(row.last_renewed_at || ""));
    return Number.isFinite(time) && now - time <= 30 * DAY_MS;
  }).length;
  const latestRun = logs.find((log) => log.category === "system" && log.message.includes("自动同步任务结束"));
  const attention = [...overdue, ...due, ...missing];
  const active = settings.auto_renew !== "0";

  const renderState = (row: RenewalRow) => (
    <span className={stateClass(row.state)}>{stateLabel(row.state)}</span>
  );

  const renderAction = (row: RenewalRow) => (
    <button
      type="button"
      className="renewal-action"
      onClick={() => onRenew(row)}
      disabled={actionLoading === `renew-${row.id}` || row.state === "missing"}
      title={row.state === "missing" ? "上游未返回到期时间，无法安全发起续期" : "立即续期"}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${actionLoading === `renew-${row.id}` ? "animate-spin" : ""}`} />
      {actionLoading === `renew-${row.id}` ? "处理中" : "立即续期"}
    </button>
  );

  return (
    <div className="renewal-workspace min-w-0 space-y-5" data-renewal-mode={interfaceStyle}>
      <header className="renewal-header">
        <div>
          <div className="renewal-kicker">策略 / 任务 / 到期窗口</div>
          <h2 className="text-2xl font-semibold tracking-tight text-content-primary">自动续期</h2>
          <p className="mt-1 text-sm text-content-secondary">把续期条件、待处理域名和最近任务放在同一条阅读线上。</p>
        </div>
        <div className="renewal-header-actions">
          <div className="text-right text-xs text-content-muted" role="status">
            <div className={active ? "text-content-primary" : "text-content-muted"}>{active ? "策略已启用" : "策略已暂停"}</div>
            <div className="mt-1">生产 Worker 每日 11:00（北京时间）检查</div>
          </div>
          <button type="button" className="renewal-action" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "读取中" : "刷新"}
          </button>
        </div>
      </header>

      <section className="renewal-rulebar" aria-label="续期策略">
        <div className="renewal-rulebar-main">
          <Settings2 className="h-4 w-4 text-content-muted" />
          <div>
            <div className="text-sm font-semibold text-content-primary">续期窗口</div>
            <div className="mt-0.5 text-xs text-content-secondary">剩余 {threshold} 天内自动尝试；已过期域名也会进入候选，由上游返回最终结果。</div>
          </div>
        </div>
        <div className="renewal-rulebar-controls">
          <label className="renewal-inline-field">
            <span>阈值</span>
            <input
              type="number"
              min={0}
              max={3650}
              value={settings.renew_threshold_days}
              onChange={(event) => onChangeSettings({ renew_threshold_days: event.target.value })}
              aria-label="续期阈值天数"
            />
            <span>天</span>
          </label>
          <button type="button" className={`renewal-toggle ${active ? "is-on" : ""}`} onClick={() => onChangeSettings({ auto_renew: active ? "0" : "1" })} aria-pressed={active}>
            <span className="renewal-toggle-dot" />
            {active ? "自动续期已开" : "自动续期已关"}
          </button>
          <button type="button" className="renewal-action renewal-action--primary" onClick={onSaveSettings} disabled={saving}>
            {saving ? "保存中" : "保存策略"}
          </button>
        </div>
      </section>

      <section className="renewal-metrics" aria-label="续期摘要">
        <div><span>DNSHE 域名</span><strong>{rows.length}</strong></div>
        <div><span>当前候选</span><strong>{due.length}</strong></div>
        <div><span>已过期</span><strong className={overdue.length ? "text-red-600 dark:text-red-400" : ""}>{overdue.length}</strong></div>
        <div><span>到期未知</span><strong className={missing.length ? "text-amber-700 dark:text-amber-300" : ""}>{missing.length}</strong></div>
        <div><span>近 30 天已续期</span><strong>{renewedRecently}</strong></div>
      </section>

      {interfaceStyle === "design" ? (
        <>
          <section className="renewal-design-grid">
            <div className="renewal-timeline">
              <div className="renewal-section-heading"><span>需要处理</span><small>{attention.length} 条</small></div>
              {attention.length === 0 ? (
                <div className="renewal-empty"><CheckCircle2 className="h-5 w-5" /><span>当前没有进入续期窗口的域名。</span></div>
              ) : attention.slice(0, 12).map((row) => (
                <div key={row.id} className="renewal-timeline-row">
                  <div className="renewal-timeline-mark" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong className="break-all text-sm text-content-primary">{row.full_domain}</strong>{renderState(row)}</div>
                    <div className="mt-1 text-xs text-content-secondary">{row.account_alias} · {remainingText(row.days)} · 到期 {formatDate(row.expires_at)}</div>
                  </div>
                  {renderAction(row)}
                </div>
              ))}
            </div>
            <aside className="renewal-insight">
              <div className="renewal-section-heading"><span>任务证据</span><CalendarClock className="h-4 w-4 text-content-muted" /></div>
              <div className="renewal-insight-line"><span>上次任务</span><b>{latestRun ? formatDate(latestRun.created_at) : "尚无记录"}</b></div>
              <div className="renewal-insight-line"><span>策略状态</span><b>{active ? "每日检查" : "暂停"}</b></div>
              <div className="renewal-insight-line"><span>失败语义</span><b>保留旧到期时间</b></div>
              <div className="renewal-insight-note"><Clock3 className="h-4 w-4 shrink-0" />缺少到期时间的域名不会被猜测续期，请先让上游同步出有效日期。</div>
            </aside>
          </section>
        </>
      ) : interfaceStyle === "data" ? (
        <section className="renewal-table-wrap" aria-label="续期数据表">
          <div className="renewal-table-head"><span>域名 / 账号</span><span>到期时间</span><span>剩余</span><span>状态</span><span className="text-right">操作</span></div>
          {loading && !rows.length ? <div className="renewal-empty">正在读取域名快照…</div> : rows.length === 0 ? <div className="renewal-empty">没有匹配的域名。</div> : rows.map((row) => (
            <div className="renewal-table-row" key={row.id}>
              <div className="min-w-0"><strong className="block break-all text-sm text-content-primary">{row.full_domain}</strong><small>{row.account_alias}</small></div>
              <span className="tabular-nums text-sm text-content-secondary">{formatDate(row.expires_at)}</span>
              <span className="tabular-nums text-sm text-content-secondary">{remainingText(row.days)}</span>
              {renderState(row)}
              <div className="flex justify-end">{renderAction(row)}</div>
            </div>
          ))}
        </section>
      ) : (
        <section>
          <div className="renewal-section-heading"><span>域名卡片</span><small>{rows.length} 条</small></div>
          {loading && !rows.length ? <div className="renewal-empty">正在读取域名快照…</div> : rows.length === 0 ? <div className="renewal-empty">没有匹配的域名。</div> : (
            <div className="renewal-card-grid">
              {rows.map((row) => <article key={row.id} className={`renewal-card ${row.state === "overdue" ? "is-danger" : row.state === "due" ? "is-due" : ""}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block break-all text-sm text-content-primary">{row.full_domain}</strong><small>{row.account_alias}</small></div>{renderState(row)}</div>
                <div className="renewal-card-meta"><span>到期</span><b>{formatDate(row.expires_at)}</b><span>{remainingText(row.days)}</span></div>
                <div className="mt-3 flex justify-end">{renderAction(row)}</div>
              </article>)}
            </div>
          )}
        </section>
      )}

      {missing.length > 0 && <div className="renewal-footnote"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{missing.length} 个域名没有可解析的到期时间，系统不会把未知值当成可续期或已过期。</span></div>}
    </div>
  );
}
