import { useEffect, useMemo, useState } from "react";
import { usePageSearch } from "./PageSearch";
import type { InterfaceStyle } from "./InterfaceStyle";
import "./flow-workspaces.css";

export type DdnsBinding = {
  id: string; account_id: number; label: string; domain: string; record_type: string;
  token: string; created_at: string; last_ip?: string; last_status?: string; last_at?: string;
};
const resultLabel = (status?: string) => status === "good" ? "已变更" : status === "nochg" ? "无变化" : status || "尚未更新";
const dateTime = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚无记录";
const demoBindings: DdnsBinding[] = [
  { id: "demo-home", account_id: 0, label: "家庭网络", domain: "home.example.cc", record_type: "A", token: "无真实令牌", created_at: "", last_ip: "203.0.113.24", last_status: "good", last_at: "2026-10-17T10:42:00+08:00" },
  { id: "demo-office", account_id: 0, label: "办公出口", domain: "office.example.cc", record_type: "A", token: "无真实令牌", created_at: "", last_ip: "198.51.100.18", last_status: "第 2 次重试", last_at: "2026-10-17T10:39:00+08:00" },
];

export function DdnsDirectory({ bindings, accounts, loading, dataStyle, style, onUpdate, onScript, onDelete }: {
  bindings: DdnsBinding[]; accounts: Array<{ id: number; alias: string }>; loading: boolean; dataStyle: boolean;
  style?: InterfaceStyle;
  onUpdate: (id: string, domain: string) => void; onScript: (id: string) => void; onDelete: (id: string, domain: string) => void;
}) {
  const [preview, setPreview] = useState(bindings.length === 0);
  const { query } = usePageSearch();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const view = style || (dataStyle ? "data" : "design");
  useEffect(() => { if (bindings.length) setPreview(false); }, [bindings.length]);
  useEffect(() => { setPage(1); }, [query, status, preview]);
  const names = new Map(accounts.map((account) => [account.id, account.alias]));
  const rows = (preview ? demoBindings : bindings).filter((binding) => {
    const ok = binding.last_status === "good" || binding.last_status === "nochg";
    return (status === "all" || (status === "attention" ? !!binding.last_status && !ok : !binding.last_status)) &&
      `${binding.label} ${binding.domain} ${names.get(binding.account_id) || ""}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pages);
  const visible = rows.slice((currentPage - 1) * 10, currentPage * 10);
  const selected = rows.find((binding) => binding.id === selectedId) || visible[0];
  const actions = (binding: DdnsBinding) => !preview && <div className="ddns-actions"><button onClick={() => onUpdate(binding.id, binding.domain)}>立即更新</button><button onClick={() => onScript(binding.id)}>设备脚本</button><button className="is-danger" onClick={() => onDelete(binding.id, binding.domain)}>删除</button></div>;
  const identity = (binding: DdnsBinding) => <><strong>{binding.label || binding.domain}</strong><code>{binding.domain}</code></>;
  return <section className={`ddns-directory is-${view}`} aria-label={preview ? "动态 DNS 模拟运行面" : "动态 DNS 绑定目录"}>
    <div className="flow-tools"><select aria-label="筛选动态 DNS 状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="attention">需要关注</option><option value="pending">尚未更新</option></select><button aria-pressed={preview} onClick={() => { setPreview(!preview); setSelectedId(null); }}>{preview ? "关闭模拟预览" : "查看模拟预览"}</button></div>
    {preview && <p className="ddns-demo-label">模拟数据 · 不会写入 DNS</p>}
    {loading && <p className="flow-caption" role="status">正在读取绑定…</p>}
    {!rows.length ? <p className="flow-empty-inline">{query || status !== "all" ? "没有匹配的绑定。" : "尚无真实绑定。新增绑定后可以生成设备脚本或更新 DNS。"}</p> : view === "cards" ? <div className="ddns-card-grid" data-ddns-view="cards">
      {visible.map(binding => <article key={binding.id} className="ddns-binding-card" data-ddns-id={binding.id}>
        <header><div className="ddns-identity">{identity(binding)}</div><span className={`ddns-card-result${binding.last_status && !["good", "nochg"].includes(binding.last_status) ? " is-warning" : ""}`}>{resultLabel(binding.last_status)}</span></header>
        <p className="ddns-card-account">{preview ? "模拟账号 · 不会写入 DNS" : names.get(binding.account_id) || `账号 ${binding.account_id}`}<span>{binding.record_type}</span></p>
        <dl><div><dt>最近 IP</dt><dd><code>{binding.last_ip || "未返回"}</code></dd></div><div><dt>更新时间</dt><dd><time>{dateTime(binding.last_at)}</time></dd></div></dl>
        <footer>{preview ? <span className="flow-caption">仅演示 · 无真实令牌</span> : actions(binding)}</footer>
      </article>)}
    </div> : view === "data" ? <div className="ddns-scan" data-ddns-view="data">
      <div className="ddns-scan__row ddns-scan__head"><span>名称 / 域名</span><span>账号 / 类型</span><span>最近 IP</span><span>最近结果 / 时间</span><span>操作</span></div>
      {visible.map((binding) => <div className="ddns-scan__row" key={binding.id}><div className="ddns-identity">{identity(binding)}</div><div><span>{preview ? "模拟账号" : names.get(binding.account_id) || `账号 ${binding.account_id}`}</span><small>{binding.record_type}</small></div><code>{binding.last_ip || "未返回"}</code><div><b className={binding.last_status && !["good", "nochg"].includes(binding.last_status) ? "is-warning" : ""}>{resultLabel(binding.last_status)}</b><time>{dateTime(binding.last_at)}</time></div>{preview ? <span className="flow-caption">仅演示</span> : actions(binding)}</div>)}
    </div> : <div className="ddns-editorial" data-ddns-view="design"><div className="ddns-roster">{visible.map((binding) => <button key={binding.id} className="ddns-roster__item" aria-pressed={selected?.id === binding.id} onClick={() => setSelectedId(binding.id)}><span className="ddns-identity">{identity(binding)}</span><span>{resultLabel(binding.last_status)}</span></button>)}</div>{selected && <article className="ddns-inspector"><header><span className="flow-caption">{preview ? "最近事件 · 模拟" : "最近执行"}</span><h3>{selected.label || selected.domain}</h3><code>{selected.domain}</code></header><dl><div><dt>最近 IP</dt><dd>{selected.last_ip || "未返回"}</dd></div><div><dt>执行结果</dt><dd>{resultLabel(selected.last_status)}</dd></div><div><dt>更新时间</dt><dd>{dateTime(selected.last_at)}</dd></div><div><dt>所属账号</dt><dd>{preview ? "模拟账号" : names.get(selected.account_id) || `账号 ${selected.account_id}`}</dd></div><div><dt>记录类型</dt><dd>{selected.record_type}</dd></div><div><dt>令牌</dt><dd>{preview ? "无真实令牌" : "已保管（不在页面显示）"}</dd></div></dl>{actions(selected)}</article>}</div>}
    {pages > 1 && <nav className="flow-pagination" aria-label="DDNS 分页"><span>{rows.length} 个绑定 · 每页 10 个</span><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pages}</span><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
  </section>;
}

export type FlowLog = { id: number; type: "info" | "success" | "warning" | "error" | string; category: "auth" | "api" | "operation" | "sync" | "renew" | "system" | string; message: string; details: string | null; created_at: string };
const logResultLabels: Record<string, string> = { success: "success", error: "error", warning: "warning", warn: "warning", info: "info", failed: "error", failure: "error", ok: "success", pending: "pending", running: "running", 成功: "success", 失败: "error", 警告: "warning", 信息: "info" };
export const logResultLabel = (type: string) => logResultLabels[type.trim().toLowerCase()] || type || "未知";
const logResultTone = (type: string) => logResultLabel(type);
export function LogsWorkspace({ logs, dataStyle, loading, updatedAt, error, pendingCount, onApplyPending, onRefresh, onClear, clearBusy, category, onCategory }: {
  logs: FlowLog[]; dataStyle: boolean; loading: boolean; updatedAt: number; error: string; pendingCount: number;
  onApplyPending: () => void; onRefresh: () => void; onClear: () => void; clearBusy: boolean;
  category: string; onCategory: (value: "all" | "auth" | "api" | "operation") => void;
}) {
  const { query } = usePageSearch();
  const [onlyAttention, setOnlyAttention] = useState(false);
  const rows = useMemo(() => logs.filter((log) => (!onlyAttention || ["error", "warning"].includes(logResultTone(log.type))) && `${log.message} ${log.details || ""} ${log.category} ${logResultLabel(log.type)}`.toLowerCase().includes(query.trim().toLowerCase())), [logs, query, onlyAttention]);
  const detail = (log: FlowLog) => log.details ? <details className="log-detail"><summary>查看详情</summary><pre>{log.details}</pre></details> : <span className="log-detail-placeholder" aria-hidden="true">—</span>;
  const badge = (log: FlowLog) => <span className={`log-result is-${logResultTone(log.type)}`}>{logResultLabel(log.type)}</span>;
  const categoryLabel = (category: FlowLog["category"]) => ({ auth: "登录", api: "API", operation: "操作", sync: "同步", renew: "续期", system: "系统" } as Record<string, string>)[category] || category;
  return <section className={`logs-workspace ${dataStyle ? "is-data" : "is-design"}`} aria-busy={loading}>
    <header className="logs-workspace__head"><div><h2>运行日志 <small>最近 100 条</small></h2><p role="status">{loading ? "正在读取最新日志…" : updatedAt ? `最近读取 ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚未读取"}</p></div><div className="logs-workspace__actions">{pendingCount > 0 && <button className="log-new-items" onClick={onApplyPending}>有 {pendingCount} 条新日志 · 点击查看</button>}<button onClick={onRefresh} disabled={loading} aria-label="刷新运行日志">{loading ? "刷新中" : "刷新"}</button><button className="is-danger" onClick={onClear} disabled={clearBusy || loading}>清空日志</button></div></header>
    {error && <p className="flow-inline-error" role="alert">{error}</p>}
    <div className="flow-tabs" aria-label="日志分类">{([{ key: "all", label: "全部" }, { key: "auth", label: "登录" }, { key: "api", label: "API" }, { key: "operation", label: "操作" }] as const).map((item) => <button key={item.key} aria-pressed={category === item.key} onClick={() => onCategory(item.key)}>{item.label}</button>)}</div>
    <div className="flow-tools logs-workspace__filters"><label className="flow-check"><input type="checkbox" checked={onlyAttention} onChange={(event) => setOnlyAttention(event.target.checked)} />只看失败与警告</label><span className="flow-count">{rows.length} 条</span></div>
    {!rows.length ? <p className="flow-empty-inline">{loading ? "正在获取运行日志…" : "当前范围没有日志。"}</p> : <div className="log-scan" data-log-view={dataStyle ? "data" : "design"}>
      <div className="log-scan__row log-scan__head"><span>时间</span><span>结果</span><span>模块</span><span>事件</span><span>详情</span></div>
      {rows.map((log) => <article key={log.id} className="log-scan__row" data-log-id={log.id}><time dateTime={log.created_at}>{dateTime(log.created_at)}</time>{badge(log)}<span className="log-category">{categoryLabel(log.category)}</span><div className="log-message">{log.message}</div>{detail(log)}</article>)}
    </div>}
  </section>;
}
