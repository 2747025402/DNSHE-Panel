import { useEffect, useMemo, useState } from "react";
import { usePageSearch } from "./PageSearch";

export interface AssistPanelDomain {
  id: number;
  domain: string;
  status: string;
  expires_at?: string | null;
  assist_code?: string;
}
export interface AssistPanelAccount {
  account_id: number;
  name: string;
  helper_assist_remaining?: number;
  helper_assist_limit?: number;
  helper_limit_reached?: boolean;
  assist_required?: number;
  quota?: Record<string, unknown> | null;
  domains?: AssistPanelDomain[];
  error?: string;
  assist_logs?: Array<{ role?: string; domain?: string; assist_code?: string; counterpart?: string; created_at?: string }>;
}
type HistoryRow = { ts: string; assist_code: string; count: number };
const knownNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const quotaText = (account: AssistPanelAccount) => {
  const left = knownNumber(account.helper_assist_remaining);
  const limit = knownNumber(account.helper_assist_limit);
  return account.error ? "读取失败" : left === null ? "未读取" : `${left} / ${limit ?? "—"}`;
};
export const canAssist = (account: AssistPanelAccount) => !account.error && !account.helper_limit_reached && (knownNumber(account.helper_assist_remaining) ?? 0) > 0;
const statusText = (account: AssistPanelAccount) => account.error ? "读取失败" : account.helper_limit_reached ? "本期次数已用尽" : knownNumber(account.helper_assist_remaining) === null ? "未读取" : canAssist(account) ? "可参与" : "无剩余额度";

export function AssistSummary({ accounts, dataStyle, view = "list" }: { accounts: AssistPanelAccount[]; dataStyle: boolean; view?: "cards" | "list" }) {
  const known = accounts.filter((account) => !account.error && knownNumber(account.helper_assist_remaining) !== null);
  const domains = accounts.flatMap((account) => account.domains || []);
  if (!accounts.length) return <p className="flow-empty-inline">尚未同步助力数据。同步 DNSHE 后可选择参与账号或获取自己的助力码。</p>;
  if (!dataStyle) return <section className="assist-workflow-summary" aria-label="助力摘要">
    <div><span className="assist-workflow-summary__label">当前可参与</span><p><strong>{accounts.filter(canAssist).length}</strong> 个账号可为好友助力</p><span className="flow-caption">先确认助力码与参与账号，再消耗次数；自己的域名可在下方生成或复制助力码。</span></div>
    <dl><div><dt>已读剩余助力</dt><dd>{known.length ? known.reduce((sum, account) => sum + account.helper_assist_remaining!, 0) : "—"}<small> 次</small></dd></div><div><dt>托管域名</dt><dd>{domains.length}<small> 个</small></dd></div><div><dt>读取覆盖</dt><dd>{known.length}<small> / {accounts.length} 账号</small></dd></div></dl>
  </section>;
  return <div className={`assist-summary-line is-data ${view === "cards" ? "assist-summary-line--cards" : ""}`} aria-label="助力摘要">
    <div><span>已读剩余助力</span><strong>{known.length ? known.reduce((sum, account) => sum + account.helper_assist_remaining!, 0) : "—"}<small>次</small></strong></div>
    <div><span>可参与账号</span><strong>{accounts.filter(canAssist).length}<small>/ {accounts.length}</small></strong></div>
    <div><span>托管域名</span><strong>{domains.length}<small>个</small></strong></div>
    <div><span>读取覆盖</span><strong>{known.length}<small>/ {accounts.length}</small></strong></div>
  </div>;
}

export function AssistDirectory({ accounts, history, dataStyle, view = "list", onGenerate, onCopy }: {
  accounts: AssistPanelAccount[];
  history: HistoryRow[];
  dataStyle: boolean;
  view?: "cards" | "list";
  onGenerate: (accountId: number, domainId: number, domain: string) => void;
  onCopy: (value: string, label: string) => void;
}) {
  const { query, setQuery } = usePageSearch();
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [tab, setTab] = useState<"domains" | "history">("domains");
  const [filter, setFilter] = useState<"all" | "eligible" | "upgraded">("all");
  const [quotaOpen, setQuotaOpen] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [openAccounts, setOpenAccounts] = useState<Set<number>>(new Set());
  const [shownDomains, setShownDomains] = useState<Record<number, number>>({});
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return accounts.filter((account) => !dataStyle || !onlyEligible || canAssist(account)).map((account) => {
      if (!keyword || account.name.toLowerCase().includes(keyword)) return account;
      const domains = (account.domains || []).filter((domain) => `${domain.domain} ${domain.assist_code || ""}`.toLowerCase().includes(keyword));
      return domains.length ? { ...account, domains } : null;
    }).filter((account): account is AssistPanelAccount => account !== null);
  }, [accounts, onlyEligible, query, dataStyle]);
  useEffect(() => { setPage(1); }, [query, onlyEligible, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const activePage = Math.min(page, pageCount);
  const visibleAccounts = filtered.slice((activePage - 1) * 10, activePage * 10);
  const queue = [...filtered].sort((a, b) => Number(canAssist(b)) - Number(canAssist(a)) || (knownNumber(b.helper_assist_remaining) ?? -1) - (knownNumber(a.helper_assist_remaining) ?? -1));
  const toggleAccount = (id: number, open: boolean) => setOpenAccounts((previous) => {
    const next = new Set(previous);
    if (open) { next.delete(id); next.add(-id); } else { next.add(id); next.delete(-id); }
    return next;
  });
  const logRows = useMemo(() => {
    const codeDomains = new Map(accounts.flatMap((account) => (account.domains || []).filter((domain) => domain.assist_code).map((domain) => [domain.assist_code!.toUpperCase(), domain.domain] as const)));
    const rows = accounts.flatMap((account) => (account.assist_logs || []).filter((log) => log.role === "assisted" && log.assist_code).map((log) => ({
      code: log.assist_code!, ts: log.created_at || "", account: account.name,
      domain: codeDomains.get(log.assist_code!.toUpperCase()) || log.domain || "", count: 1,
    })));
    return (rows.length ? rows : history.map((entry) => ({ code: entry.assist_code, ts: entry.ts, count: entry.count, account: "", domain: "" }))).sort((a, b) => b.ts.localeCompare(a.ts));
  }, [accounts, history]);
  const historyPages = Math.max(1, Math.ceil(logRows.length / 10));
  const currentHistoryPage = Math.min(historyPage, historyPages);
  const pagination = pageCount > 1 && <nav className="flow-pagination" aria-label="助力账号分页"><span>{filtered.length} 个账号 · 每页 10 个</span><button disabled={activePage <= 1} onClick={() => setPage(activePage - 1)}>上一页</button><span>{activePage} / {pageCount}</span><button disabled={activePage >= pageCount} onClick={() => setPage(activePage + 1)}>下一页</button></nav>;
  const queuePanel = <aside className="assist-queue-editorial" aria-label="可参与账号队列"><div className="flow-section-head"><div><h3>账号助力额度</h3><p className="flow-caption">剩余 / 上限 · {queue.filter(canAssist).length} 个可参与</p></div>{queue.length > 4 && <button type="button" aria-expanded={queueOpen} onClick={() => setQueueOpen(!queueOpen)}>{queueOpen ? "收起队列" : `查看全部 ${queue.length} 个账号`}</button>}</div><div>{queue.slice(0, queueOpen ? 10 : 4).map((account, index) => {
    const left = knownNumber(account.helper_assist_remaining), limit = knownNumber(account.helper_assist_limit);
    const pct = left !== null && limit !== null && limit > 0 ? Math.max(0, Math.min(100, left / limit * 100)) : null;
    return <div className="assist-queue-editorial__row" data-eligible={canAssist(account)} key={account.account_id}><span className="assist-queue-editorial__rank" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div className="assist-queue-editorial__identity"><strong title={account.name}>{account.name}</strong><span>{statusText(account)}</span></div><div className="assist-queue-editorial__meter" aria-label={`${account.name} 剩余额度`} data-known={pct !== null}><span style={{ width: pct === null ? "0" : `${pct}%` }} /></div><span className="assist-queue-editorial__value">{quotaText(account)}</span></div>;
  })}</div>{!queue.length && <p className="flow-empty-inline">当前筛选下没有可参与账号；未读取与失败账号不会计作零额度。</p>}{queueOpen && queue.length > 10 && <p className="flow-caption">队列显示前 10 个；域名目录可分页查看全部账号。</p>}<p className="assist-queue-editorial__note">实际参与账号在触发前确认，可逐个排除自己的域名所属账号。</p></aside>;
  const domainAction = (account: AssistPanelAccount, domain: AssistPanelDomain) => domain.status === "upgraded" ? <span>已完成升级</span> : domain.assist_code ? <button type="button" onClick={() => onCopy(domain.assist_code!, "助力码")}>复制 {domain.assist_code}</button> : <button type="button" onClick={() => onGenerate(account.account_id, domain.id, domain.domain)}>生成助力码</button>;
  return <section className={`assist-directory ${dataStyle ? `is-data is-${view}` : "is-design"}`} data-view={dataStyle ? view : "workflow"} aria-label="助力账号与域名">
    {dataStyle && <div className="flow-tools"><label className="flow-check"><input type="checkbox" checked={onlyEligible} onChange={(event) => setOnlyEligible(event.target.checked)} />只看可参与</label><span className="flow-count">{filtered.length} / {accounts.length} 个账号</span></div>}
    {dataStyle && <section className="assist-quota-panel"><div className="flow-section-head"><h3>账号助力额度</h3><button type="button" aria-expanded={quotaOpen} onClick={() => setQuotaOpen(!quotaOpen)}>{quotaOpen ? "收起账号额度" : "展开账号额度"}</button></div>{quotaOpen && <>{view === "cards" ? <div className="assist-account-cards">{visibleAccounts.map((account) => <article className="assist-account-card" key={account.account_id}><header><strong title={account.name}>{account.name}</strong><span className={`assist-account-card__status ${canAssist(account) ? "is-ready" : account.error ? "is-error" : ""}`}>{statusText(account)}</span></header><dl><div><dt>助力剩余 / 上限</dt><dd>{quotaText(account)}</dd></div><div><dt>托管域名</dt><dd>{(account.domains || []).length} 个</dd></div><div><dt>可注册 / 总额度</dt><dd>{knownNumber(account.quota?.available) ?? "—"} / {knownNumber(account.quota?.total) ?? "—"}</dd></div></dl>{account.error && <p className="flow-inline-error">{account.error}</p>}</article>)}</div> : <><div className="assist-quota-grid assist-quota-grid--head"><span>账号</span><span>助力剩余 / 上限</span><span>域名</span><span>状态</span></div>{visibleAccounts.map((account) => <div className="assist-quota-grid" key={account.account_id}><strong title={account.name}>{account.name}</strong><span>{quotaText(account)}</span><span>{(account.domains || []).length} 个</span><span>{statusText(account)}</span></div>)}</>}{pagination}</>}</section>}
    <div className={!dataStyle ? "assist-workflow-layout" : undefined}>
    <div className="assist-domain-workspace">
    <div className="flow-tabs" role="group" aria-label="助力内容"><button aria-pressed={tab === "domains"} onClick={() => setTab("domains")}>我的域名</button><button aria-pressed={tab === "history"} onClick={() => setTab("history")}>助力记录 {logRows.length || ""}</button></div>
    {tab === "domains" ? <><div className="flow-section-head"><h3>获取自己的助力码</h3><select className="h-10 text-sm" aria-label="筛选助力域名" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">全部域名</option><option value="eligible">未永久域名</option><option value="upgraded">永久域名</option></select></div><div>{visibleAccounts.map((account) => {
      const domains = (account.domains || []).filter((domain) => filter === "all" || (filter === "upgraded" ? domain.status === "upgraded" : domain.status !== "upgraded"));
      const open = !openAccounts.has(-account.account_id) && (openAccounts.has(account.account_id) || filtered.length === 1);
      const limit = shownDomains[account.account_id] || 20;
      return <section key={account.account_id} className="assist-domain-group"><button className="assist-domain-group__head" aria-expanded={open} onClick={() => toggleAccount(account.account_id, open)}><strong title={account.name}>{account.name}</strong><span>{account.error ? "读取失败 · " : ""}{domains.length} 个域名 · {open ? "收起" : "展开"}</span></button>{open && <div className="assist-domain-group__body">{account.error ? <p className="flow-inline-error">{account.error}</p> : domains.length ? <><div className={dataStyle && view === "cards" ? "assist-domain-cards" : !dataStyle ? "assist-domain-catalog" : undefined}>{domains.slice(0, limit).map((domain) => dataStyle && view === "cards" ? <article className="assist-domain-card assist-domain-row" key={domain.id}><strong title={domain.domain}>{domain.domain}</strong><span className="assist-domain-card__status">{domain.status === "upgraded" ? "已永久" : domain.status === "in_progress" ? "助力中" : "可升级"}</span><span className="assist-domain-card__expiry">{domain.status === "upgraded" ? "永久" : domain.expires_at ? `到期 ${domain.expires_at.slice(0, 10)}` : "到期时间未返回"}</span><footer>{domainAction(account, domain)}</footer></article> : <div className="assist-domain-row" key={domain.id}><strong title={domain.domain}>{domain.domain}</strong><span>{domain.status === "upgraded" ? "已永久" : domain.status === "in_progress" ? "助力中" : "可升级"}</span>{domainAction(account, domain)}</div>)}</div>{domains.length > limit && <button className="flow-more" onClick={() => setShownDomains({ ...shownDomains, [account.account_id]: limit + 20 })}>再显示 20 个（剩余 {domains.length - limit}）</button>}</> : <p className="flow-empty-inline">当前筛选下没有域名。</p>}</div>}</section>;
    })}</div>{pagination}{!filtered.length && <p className="flow-empty-inline">没有匹配的账号。<button onClick={() => { setQuery(""); setOnlyEligible(false); }}>清除筛选</button></p>}</> : <section className="assist-history-list" aria-label="最近助力记录">{logRows.length ? <>{logRows.slice((currentHistoryPage - 1) * 10, currentHistoryPage * 10).map((row, index) => <div className="assist-history-row" key={`${row.code}-${row.ts}-${index}`}><time>{row.ts ? new Date(row.ts).toLocaleString("zh-CN") : "时间未返回"}</time><strong>{row.domain || row.code}</strong><span>{row.account || `助力 ${row.count} 次`}</span></div>)}{historyPages > 1 && <nav className="flow-pagination"><button disabled={currentHistoryPage <= 1} onClick={() => setHistoryPage(currentHistoryPage - 1)}>上一页</button><span>{currentHistoryPage} / {historyPages}</span><button disabled={currentHistoryPage >= historyPages} onClick={() => setHistoryPage(currentHistoryPage + 1)}>下一页</button></nav>}</> : <p className="flow-empty-inline">尚无助力记录。</p>}</section>}
    </div>{!dataStyle && queuePanel}</div>
  </section>;
}
