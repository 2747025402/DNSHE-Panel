import { useEffect, useState, type ReactNode } from "react";
import type { EditorialKeyGroup, EditorialKeyRow } from "./EditorialViews";
import { usePageSearch } from "./PageSearch";

/** 候选 1 的凭据账本阅读顺序；敏感值仍由 App 的安全检查器管理。 */
export function DataKeyDirectory({ groups, onCreate, onInspect, renderActions }: {
  groups: EditorialKeyGroup[];
  onCreate: () => void;
  onInspect: (key: EditorialKeyRow, accountId: number, alias: string) => void;
  renderActions: (key: EditorialKeyRow, accountId: number, alias: string) => ReactNode;
}) {
  const { query } = usePageSearch();
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [query]);
  const normalized = query.trim().toLowerCase();
  const filtered = groups.map(group => ({ ...group, keys: group.alias.toLowerCase().includes(normalized) ? group.keys : group.keys.filter(key => `${key.key_name} ${key.api_key}`.toLowerCase().includes(normalized)) })).filter(group => !normalized || group.keys.length || group.alias.toLowerCase().includes(normalized));
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1));
  const visibleGroups = filtered.slice(safePage * 10, safePage * 10 + 10);
  const summaryKeys = filtered.flatMap(group => group.keys);
  const activeCount = summaryKeys.filter(key => key.status === "active").length;
  const requestCount = summaryKeys.reduce((sum, key) => sum + (typeof key.request_count === "number" ? key.request_count : 0), 0);
  return <section className="mapped-key-directory" data-source="preview1-design" aria-label="API 密钥数据账本">
    <header className="mapped-directory-heading mapped-key-directory-heading"><div><span className="mapped-key-eyebrow">凭据账本</span><h2>API 密钥</h2><p>按所属账号读取状态与调用量；完整 Secret 仅在详情中按需显示。</p></div><button type="button" className="mapped-primary" disabled={!groups.length} onClick={onCreate}>创建密钥</button></header>
    <div className="mapped-key-summary" aria-label="API 密钥摘要"><div><span>账号</span><strong>{filtered.length}</strong></div><div><span>密钥</span><strong>{summaryKeys.length}</strong></div><div><span>有效</span><strong>{activeCount}</strong></div><div><span>累计请求</span><strong>{requestCount ? requestCount.toLocaleString("zh-CN") : "—"}</strong></div></div>
    {visibleGroups.map(group => <section className="mapped-key-group" key={group.account_id}>
      <button type="button" className="mapped-key-group-title" aria-expanded={!closed.has(group.account_id)} onClick={() => setClosed(previous => { const next = new Set(previous); next.has(group.account_id) ? next.delete(group.account_id) : next.add(group.account_id); return next; })}><span className="mapped-key-account-identity"><small>DNSHE 账号 · {group.keys.length} 把密钥</small><strong>{group.alias}</strong></span><span className="mapped-key-group-toggle">{closed.has(group.account_id) ? "展开" : "收起"}</span></button>
      {!closed.has(group.account_id) && (group.error ? <p className="flow-inline-error">{group.error}</p> : !group.keys.length ? <p className="flow-empty-inline">该账号没有密钥。</p> : <div className="mapped-key-table" role="table" aria-label={`${group.alias} 的 API 密钥`}><div className="mapped-key-row is-head" role="row"><span>凭据名称 / API Key</span><span>状态</span><span>累计请求</span><span>最后使用</span><span>操作</span></div>{group.keys.map(key => <div role="row" className="mapped-key-row" key={key.api_key}>
        <button type="button" className="mapped-key-identity" onClick={() => onInspect(key, group.account_id, group.alias)} aria-label={`查看 ${key.key_name || "未命名"} 详情`}><span className="mapped-key-name-line"><i aria-hidden="true" /><strong>{key.key_name || "未命名"}</strong></span><small><span>API Key</span><code>{key.api_key.slice(0, 4)}••••{key.api_key.slice(-4)}</code></small></button><span className="mapped-key-state" data-label="状态" data-state={key.status === "active" ? "active" : undefined}><i aria-hidden="true" />{key.status === "active" ? "有效" : key.status || "未知"}</span><span className="mapped-key-requests tabular-nums" data-label="累计请求"><small>累计请求</small><strong>{key.request_count?.toLocaleString("zh-CN") ?? "—"}</strong></span><time className="mapped-key-last" data-label="最后使用"><small>最后使用</small>{key.last_used_at || "未返回"}</time><div className="mapped-key-row-actions"><button type="button" onClick={() => onInspect(key, group.account_id, group.alias)}>查看凭据</button>{renderActions(key, group.account_id, group.alias)}</div>
      </div>)}</div>)}
    </section>)}
    {!filtered.length && <p className="flow-empty-inline">{query ? "没有匹配的凭据。" : "还没有 DNSHE 账号。"}</p>}
    {filtered.length > 10 && <nav className="flow-pagination" aria-label="密钥账号分页"><button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>上一页</button><span>{safePage + 1} / {Math.ceil(filtered.length / 10)}</span><button disabled={(safePage + 1) * 10 >= filtered.length} onClick={() => setPage(safePage + 1)}>下一页</button></nav>}
  </section>;
}
