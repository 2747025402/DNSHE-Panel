import { useEffect, useMemo, useState } from "react";
import { DOMAIN_CHECK_CACHE_LIMIT, domainCheckOutcomeLabel, type DomainCheckOutcome, type DomainCheckRecord } from "./DomainCheckCacheModel";
import "./register-rule-tools.css";

/** One shared view beneath either search mode; the App owns the same cache records. */
export function DomainCheckCachePanel({ records, query = "", onChoose, persistenceError = false }: {
  records: DomainCheckRecord[]; query?: string; persistenceError?: boolean;
  onChoose: (subdomain: string, rootdomain: string) => void;
}) {
  const [filter, setFilter] = useState<DomainCheckOutcome | "all">("all");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => records.filter(row => (filter === "all" || row.outcome === filter) && `${row.domain} ${row.upstreamStatus} ${domainCheckOutcomeLabel[row.outcome]}`.toLowerCase().includes(query.trim().toLowerCase())), [records, filter, query]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 12) - 1));
  useEffect(() => { setPage(0); }, [filter, query]);
  return <section className="domain-check-cache" aria-label="已查询结果">
    <header><div><h3>已查询结果 <span>{records.length.toLocaleString()}</span></h3><p>本机保留查询时间与上游结论 · 最近 {DOMAIN_CHECK_CACHE_LIMIT.toLocaleString()} 个域名</p></div><label><span className="sr-only">查询结果状态</span><select className="form-input h-10 text-sm" aria-label="查询结果状态" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">全部结果</option>{Object.entries(domainCheckOutcomeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></header>
    {persistenceError && <p className="domain-check-cache-error" role="alert">本机存储空间不足；当前结果仍可用，但尚未保存，关闭后可能丢失。</p>}
    {rows.length ? <div className="domain-check-cache-rows">{rows.slice(safePage * 12, safePage * 12 + 12).map(row => <button type="button" key={row.domain} className="domain-check-cache-row" onClick={() => onChoose(row.subdomain, row.rootdomain)} aria-label={`${row.domain}，${domainCheckOutcomeLabel[row.outcome]}，回填查询`}><span><strong>{row.domain}</strong>{row.message && <small>{row.message}</small>}{row.lastConfirmed && <small>上次确认：{domainCheckOutcomeLabel[row.lastConfirmed.outcome]} · {new Date(row.lastConfirmed.checkedAt).toLocaleString("zh-CN", { hour12: false })}</small>}</span><span className={row.outcome === "available" ? "text-emerald-700 dark:text-emerald-400" : ""}>{domainCheckOutcomeLabel[row.outcome]}{row.upstreamStatus && <small>{row.upstreamStatus}</small>}</span><time dateTime={row.checkedAt}>{new Date(row.checkedAt).toLocaleString("zh-CN", { hour12: false })}</time></button>)}</div> : <p className="flow-empty-inline">{records.length ? "没有匹配的已查询结果。" : "查询后自动保存每个域名的真实结果；失败不会被判断为官方保留。"}</p>}
    {rows.length > 12 && <nav className="flow-pagination" aria-label="已查询结果分页"><button type="button" disabled={!safePage} onClick={() => setPage(safePage - 1)}>上一页</button><span>{safePage + 1} / {Math.ceil(rows.length / 12)}</span><button type="button" disabled={(safePage + 1) * 12 >= rows.length} onClick={() => setPage(safePage + 1)}>下一页</button></nav>}
  </section>;
}
