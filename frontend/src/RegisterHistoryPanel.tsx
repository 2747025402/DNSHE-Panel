import { useState } from "react";
import type { BatchConfig } from "./BatchScanModel";

interface Entry {
  id: string; kind: "single" | "batch"; domain: string; rootdomain: string; subdomain: string;
  checkedAt: string; registered: boolean | null; status: string; summary?: string; rule?: string;
  checkedCount?: number; availableCount?: number; config?: BatchConfig;
}
export function RegisterHistoryPanel({ entries, query = "", onClear, onRestore }: { entries: Entry[]; query?: string; onClear: () => void; onRestore: (entry: Entry) => void }) {
  const [page, setPage] = useState(0);
  const rows = entries.filter(entry => `${entry.domain} ${entry.summary || ""} ${entry.rootdomain}`.toLowerCase().includes(query.trim().toLowerCase()));
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1));
  return <section className="register-history-panel" aria-label="查询历史">
    <header className="mapped-directory-heading"><div><h3>查询历史</h3><p>本机保存 · 最近 {entries.length} / 100 条</p></div><button type="button" disabled={!entries.length} onClick={onClear}>清空历史</button></header>
    {rows.length ? <div>{rows.slice(safePage * 10, safePage * 10 + 10).map(entry => <button className="register-history-row" type="button" key={entry.id} onClick={() => onRestore(entry)}><span><strong>{entry.kind === "batch" ? entry.summary || "批量查重" : entry.domain}</strong><small>{entry.kind === "batch" ? `${entry.checkedCount ?? 0} 已查 · ${entry.availableCount ?? 0} 可注册 · ` : ""}{new Date(entry.checkedAt).toLocaleString("zh-CN", { hour12: false })}</small></span><span className={entry.registered === false ? "text-emerald-600 dark:text-emerald-400" : "text-content-secondary"}>{entry.registered === false ? "可注册" : entry.registered === true ? "已注册" : entry.status || "未完成"}</span><span className="register-history-restore">恢复查询</span></button>)}</div> : <p className="flow-empty-inline">{query ? "没有匹配记录。" : "完成一次查询后会自动记录；批量记录恢复配置，不会自动发起请求。"}</p>}
    {rows.length > 10 && <nav className="flow-pagination" aria-label="查询历史分页"><button disabled={!safePage} onClick={() => setPage(safePage - 1)}>上一页</button><span>{safePage + 1} / {Math.ceil(rows.length / 10)}</span><button disabled={(safePage + 1) * 10 >= rows.length} onClick={() => setPage(safePage + 1)}>下一页</button></nav>}
  </section>;
}
