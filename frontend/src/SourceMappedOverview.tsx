import { Fragment, useState } from "react";
import {
  EditorialOverview,
  type EditorialOverviewProps,
  type EditorialOverviewQuotaRow,
} from "./EditorialViews";
import "./source-mapped-views.css";
import { OverviewAssistPanel } from "./OverviewAssistPanel";

export interface SourceMappedOverviewProps extends EditorialOverviewProps {
  view: "cards" | "list";
}

function count(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
}

function pressure(account: EditorialOverviewQuotaRow) {
  return !account.error && Number.isFinite(account.used) && Number.isFinite(account.total) && account.total > 0
    ? account.used / account.total * 100 : null;
}

function QuotaPanel({ props, table = false }: { props: SourceMappedOverviewProps; table?: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const accounts = props.quota?.accounts || [];
  const shown = accounts.filter((account) => !props.hiddenQuotaAccounts.includes(account.account_id));
  const toggle = (accountId: number) => setExpanded((previous) => previous === accountId ? null : accountId);
  const detail = (account: EditorialOverviewQuotaRow) => account.error || `基础 ${count(account.base)} · 奖励 ${count(account.invite_bonus)} · 可用 ${count(account.available)}`;
  return <section className="source-overview-panel source-overview-quota" aria-label={table ? "账户额度比较" : "账户配额"}>
    <div className="source-overview-panel-head">
      <div><h3>{table ? "账户额度比较" : "账户配额"}</h3>{Boolean(props.quota?.failed) && <small className="source-overview-warning">{count(props.quota?.failed)} 个未取到</small>}</div>
      <div className="source-overview-panel-tools"><small>显示 {shown.length}/{accounts.length}</small><button type="button" onClick={props.onToggleQuotaFilter} aria-expanded={props.showQuotaFilter} aria-controls="source-overview-quota-filter">筛选</button>{table && <button type="button" onClick={() => props.onNavigate("quota")}>查看全部</button>}</div>
    </div>
    {props.showQuotaFilter && <div id="source-overview-quota-filter" className="source-overview-filter">
      <div className="source-overview-filter-heading"><span>选择要显示的账号</span><div><button type="button" onClick={() => props.onSetHiddenQuotaAccounts([])}>全选</button><button type="button" onClick={() => props.onSetHiddenQuotaAccounts(accounts.map((account) => account.account_id))}>全不选</button></div></div>
      <div className="source-overview-filter-options">{accounts.map((account) => <label key={account.account_id}>
        <input type="checkbox" checked={!props.hiddenQuotaAccounts.includes(account.account_id)} onChange={() => props.onSetHiddenQuotaAccounts((previous) => previous.includes(account.account_id) ? previous.filter((id) => id !== account.account_id) : [...previous, account.account_id])} />
        <span>{account.alias}</span>
      </label>)}{!accounts.length && <p>尚无账号配额数据</p>}</div>
    </div>}
    {!props.quota ? <p className="source-overview-empty" role="status">{props.loading ? "读取中…" : "暂无账户额度快照"}</p> : !shown.length ? <p className="source-overview-empty">{accounts.length ? "没有可显示的账号，请在筛选中重新勾选。" : "暂无账户额度快照"}</p> : table ? <div className="source-overview-table source-overview-quota-table" role="table" aria-label="账户额度比较">
      <div className="source-overview-table-head source-overview-quota-row" role="row"><span role="columnheader">账号</span><span role="columnheader">已用 / 总额</span><span role="columnheader">可用</span><span role="columnheader">状态</span></div>
      {shown.map((account) => {
        const pct = pressure(account);
        const open = expanded === account.account_id;
        return <Fragment key={account.account_id}><div className="source-overview-quota-row" role="row">
          <div role="cell" data-label="账号"><button className="source-overview-identity-button" type="button" aria-expanded={open} onClick={() => toggle(account.account_id)}>{account.alias}</button></div>
          <span role="cell" data-label="已用 / 总额" className="source-overview-number">{account.error ? "— / —" : `${count(account.used)} / ${count(account.total)}`}</span>
          <span role="cell" data-label="可用" className="source-overview-number">{account.error ? "—" : count(account.available)}</span>
          <span role="cell" data-label="状态" className={account.error ? "source-overview-error" : pct !== null && pct >= 85 ? "source-overview-warning" : ""}>{account.error ? "读取失败" : pct === null ? "压力未知" : `${pct.toFixed(0)}% 已用`}</span>
        </div>{open && <div role="row" className="source-overview-quota-detail"><span role="cell">{detail(account)}</span></div>}</Fragment>;
      })}
    </div> : <div className="source-overview-quota-body"><div className="source-overview-quota-grid" data-columns={props.overviewCols}>
      {shown.map((account) => {
        const pct = pressure(account);
        const open = expanded === account.account_id;
        return <div className="source-overview-quota-card" key={account.account_id}>
          <button type="button" className="source-overview-quota-card-toggle" onClick={() => toggle(account.account_id)} aria-expanded={open} aria-label={`${account.alias}，${account.error ? "读取失败" : `已用 ${count(account.used)} / ${count(account.total)}`}`}>
            <span className="source-overview-quota-card-title"><strong>{account.alias}</strong><small className={account.error ? "source-overview-error" : account.available <= 0 ? "source-overview-warning" : ""}>{account.error ? "未取到" : `剩 ${count(account.available)}`}</small></span>
            <span className="source-overview-quota-reading">已用 {account.error ? "— / —" : `${count(account.used)} / ${count(account.total)}`}{pct !== null && <small>{pct.toFixed(0)}%</small>}</span>
            <span className="source-overview-pressure" aria-hidden="true"><i className={pct !== null && pct >= 100 ? "is-over" : ""} style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} /></span>
          </button>
          {open && <div className="source-overview-quota-card-detail">{detail(account)}</div>}
        </div>;
      })}
    </div></div>}
  </section>;
}

function RecentPanel({ props, table = false }: { props: SourceMappedOverviewProps; table?: boolean }) {
  return <section className="source-overview-panel source-overview-recent" aria-label="最近注册">
    <div className="source-overview-panel-head"><h3>最近注册</h3><button type="button" onClick={() => props.onNavigate("domains")}>域名列表</button></div>
    {!props.recent.length ? <p className="source-overview-empty">暂无最近注册记录</p> : table ? <div className="source-overview-table" role="table" aria-label="最近注册域名">
      <div className="source-overview-table-head source-overview-recent-row" role="row"><span role="columnheader">域名</span><span role="columnheader">账号</span><span role="columnheader">注册时间</span></div>
      {props.recent.slice(0, 8).map((item) => <div className="source-overview-recent-row" role="row" key={item.id}>
        <div role="cell" data-label="域名"><button type="button" className="source-overview-domain-button" onClick={() => props.onOpenDomain(item)} aria-label={`定位域名 ${item.full_domain}`}>{item.full_domain}</button></div>
        <span role="cell" data-label="账号">{item.account_alias || "—"}</span><time role="cell" data-label="注册时间" dateTime={item.created_at || undefined}>{props.formatDate(item.created_at, false)}</time>
      </div>)}
    </div> : <div className="source-overview-recent-list">{props.recent.map((item) => <button type="button" key={item.id} onClick={() => props.onOpenDomain(item)} aria-label={`定位域名 ${item.full_domain}`}>
      <span>{item.full_domain}</span><small>{item.account_alias || "—"} · {props.formatDate(item.created_at, false)}</small>
    </button>)}</div>}
  </section>;
}

function CfSummary({ props }: { props: SourceMappedOverviewProps }) {
  const resources = [
    { key: "zones", label: "Zone" },
    { key: "d1_databases", label: "D1 库" },
    { key: "kv_namespaces", label: "KV 命名空间" },
  ] as const;
  const stamp = props.cfUpdatedAt ? new Date(props.cfUpdatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
  return <section className="source-overview-panel source-overview-cf" aria-label="Cloudflare 免费额度摘要">
    <div className="source-overview-panel-head"><div><h3>Cloudflare 免费额度</h3><small>{stamp ? `快照 ${stamp}` : "尚未读取用量快照"}</small></div><button type="button" onClick={() => props.onNavigate("cfquota")}>查看用量</button></div>
    <div className="source-overview-cf-metrics">{props.cfUsage.map((metric) => <div className="source-overview-cf-metric" key={metric.key}>
      <span>{metric.label} · 今日 UTC</span><strong>{count(metric.used)}</strong><small>{metric.limit === null ? "每账号上限未知" : `每账号 ${count(metric.limit)} / 日`}</small>
      <span className="source-overview-pressure" aria-hidden="true"><i className={metric.highest && metric.highest.pct > 100 ? "is-over" : ""} style={{ width: `${Math.min(100, Math.max(0, metric.highest?.pct ?? 0))}%` }} /></span>
      <em className={metric.highest && metric.highest.pct > 85 ? "source-overview-warning" : ""}>{metric.highest ? `最高单账号 ${metric.highest.pct.toFixed(1)}%` : "单账号压力未知"}</em>
      {metric.highest && <small className="source-overview-cf-owner">{metric.highest.alias}</small>}<small>覆盖 {metric.coverage}/{metric.total}{metric.cached ? ` · ${metric.cached} 缓存` : ""}</small>
    </div>)}{!props.cfUsage.length && <p className="source-overview-empty">暂无免费额度快照</p>}</div>
    <div className="source-overview-cf-resources"><div><span>CF 账号</span><strong>{count(props.accounts?.cloudflare ?? props.cloudflareAccountCount)}</strong></div>{resources.map(({ key, label }) => {
      const known = props.cfAccounts.filter((account) => !account.error && (!account.inventory_issues?.[key] || account.inventory_issues[key]?.cached_at) && typeof account.counts?.[key] === "number" && Number.isFinite(account.counts[key]));
      const value = known.reduce((sum, account) => sum + Number(account.counts?.[key]), 0);
      const expected = Math.max(props.cloudflareAccountCount, props.cfAccounts.length);
      return <div key={key}><span>{label}</span><strong>{known.length ? `${count(value)}${known.length < expected ? "+" : ""}` : "—"}</strong><small>覆盖 {known.length}/{expected}</small></div>;
    })}</div>
  </section>;
}

/** 设计风直接复用候选 2；数据风分别映射候选 1 表格和 v2026.10.15 卡片。 */
export function SourceMappedOverview(props: SourceMappedOverviewProps) {
  if (!props.dataStyle) return <EditorialOverview {...props} />;
  const cards = props.view === "cards";
  const domains = props.domains;
  const assets = [
    { label: "已注册域名", value: domains?.total, hint: "当前托管在 DNSHE 的域名总数", tab: "domains" },
    { label: "可注册域名", value: props.quota?.available, hint: props.quota?.failed ? `${count(props.quota.failed)} 个账号额度未取到` : "各账号剩余额度合计", tab: "quota" },
    { label: "已委派域名", value: domains?.delegated, hint: "NS 已指向 Cloudflare 等外部服务商", tab: "domains" },
    { label: "未委派域名", value: domains?.not_delegated, hint: "仍使用 DNSHE 默认解析", tab: "domains" },
  ];
  const identities = [
    { label: "DNSHE 账号", value: props.accounts?.dnshe ?? props.dnsheAccountCount, hint: "管理 DNSHE 账号", tab: "accounts" },
    { label: "Cloudflare 账号", value: props.accounts?.cloudflare ?? props.cloudflareAccountCount, hint: "管理 Cloudflare 账号", tab: "accounts" },
    { label: "总助力次数", value: props.assist?.assist_limit, hint: props.assist ? `已用 ${count(props.assist.assist_limit - props.assist.assist_remaining)} 次` : "去助力页同步", tab: "assist" },
    { label: "剩余助力次数", value: props.assist?.assist_remaining, hint: props.assist ? `上限 ${count(props.assist.assist_limit)}` : "去助力页同步", tab: "assist" },
    { label: "已永久化域名", value: props.assist?.upgraded_domains, hint: "已升级为永久，无需续期", tab: "assist" },
    { label: "未永久化域名", value: props.assist?.non_upgraded_domains, hint: "仍需按时续期，可生成助力码升级", tab: "assist" },
  ];
  return <div className={`source-overview source-overview--${props.view}`} data-mode="data" data-view={props.view} aria-label={cards ? "概览卡片视图" : "概览表格视图"}>
    <div className="source-overview-header"><div><h2>概览</h2><p>{cards ? "域名资产、账号助力与额度总览" : "先看异常，再定位账号与资产"}</p></div><div className="source-overview-actions">
      {cards && <label><span>每行列数</span><select className="h-10 text-sm" value={props.overviewCols} onChange={(event) => props.onOverviewColsChange(event.target.value)} aria-label="概览卡片每行列数">{props.overviewColOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
      <button type="button" onClick={props.onRefresh} disabled={props.refreshing} aria-label="刷新概览摘要" title="读取统计、域名与 CF 最新快照">{props.refreshing ? "读取中…" : "刷新"}</button>
    </div></div>
    {cards ? <>
      {[{ title: "域名资产", metrics: assets }, { title: "账号与助力", metrics: identities }].map((group) => <section className="source-overview-metric-section" aria-label={group.title} key={group.title}><h3>{group.title}</h3><div className="source-overview-metric-grid" data-columns={props.overviewCols}>{group.metrics.map((metric) => <button type="button" className="source-overview-metric-card" key={metric.label} onClick={() => props.onNavigate(metric.tab)}><span>{metric.label}</span><strong>{count(metric.value)}</strong><small>{metric.hint}</small></button>)}</div></section>)}
      <div className="source-overview-card-lower"><QuotaPanel props={props} /><RecentPanel props={props} /></div>
      <CfSummary props={props} />
    </> : <>
      <section className="source-overview-panel source-overview-asset-scan" aria-label="域名状态">
        <div className="source-overview-panel-head"><div><h3>域名资产</h3><p className="source-overview-asset-total">托管域名 <strong>{count(domains?.total)}</strong></p><small className={domains?.expiring_soon ? "source-overview-warning" : ""}>即将到期 {count(domains?.expiring_soon)}</small></div><button type="button" onClick={() => props.onNavigate("domains")}>打开域名列表</button></div>
        <div className="source-overview-asset-strip">{[
          { label: "已委派", value: domains?.delegated },
          { label: "未委派", value: domains?.not_delegated },
          { label: "活跃", value: domains?.active },
          { label: "已过期", value: domains?.expired },
        ].map((metric) => {
          const total = domains?.total;
          const pct = typeof total === "number" && total > 0 && typeof metric.value === "number" ? metric.value / total * 100 : null;
          return <div key={metric.label}><span>{metric.label}</span><strong>{count(metric.value)}<small> / {count(total)}</small></strong><span className="source-overview-pressure" aria-hidden="true"><i className={metric.label === "已过期" && metric.value ? "is-over" : ""} style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} /></span></div>;
        })}</div>
      </section>
      <OverviewAssistPanel assist={props.assist} onOpen={() => props.onNavigate("assist")} />
      <div className="source-overview-comparison"><QuotaPanel props={props} table /><RecentPanel props={props} table /></div>
      <CfSummary props={props} />
    </>}
  </div>;
}
