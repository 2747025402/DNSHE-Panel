import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import "./editorial-workspace.css";
import { OverviewCapacityRows } from "./OverviewCapacityRows";
import { domainDelegation as delegation, domainLifeState as lifeState, domainStatusLabel } from "./DomainPresentation";
import { usePageSearch } from "./PageSearch";
import { OverviewAssistPanel } from "./OverviewAssistPanel";

export interface EditorialDomain {
  id: number;
  full_domain: string;
  status?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  has_dns?: number | boolean;
  disable_ns_management?: number | boolean;
  dns_provider?: string | null;
  account_id?: number;
  account_alias?: string;
  provider_account_id?: string | number | null;
  ns1?: string | null;
  ns2?: string | null;
}

export interface EditorialGroup<T extends EditorialDomain = EditorialDomain> {
  accountId: number;
  alias: string;
  domains: T[];
  error?: string;
}

interface GroupControl {
  collapsedAccounts?: ReadonlySet<number>;
  onToggleAccount?: (accountId: number) => void;
}

const PAGE_SIZE = 12;
const OBJECT_PAGE_SIZE = 24;
const number = (value: number) => value.toLocaleString("zh-CN");
const percent = (value: number) => value.toFixed(1).replace(/\.0$/, "") + "%";
const hasNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const matches = (value: unknown, query: string) => String(value || "").toLocaleLowerCase().includes(query);
const fmt = (value?: string | null) => {
  if (!value) return "未返回";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
};
const mask = (value: string) => value ? value.slice(0, 4) + "••••" + value.slice(-4) : "未保存";
const zoneLabel = (item: EditorialDomain) => {
  const status = String(item.status || "").toLocaleLowerCase();
  return ({ active: "已激活", pending: "待激活", initializing: "初始化中", moved: "已迁移", deactivated: "已停用" } as Record<string, string>)[status] || item.status || "未返回";
};

function Pager({ total, page, onChange, size = PAGE_SIZE, unit = "账号" }: { total: number; page: number; onChange: (page: number) => void; size?: number; unit?: string }) {
  const pages = Math.ceil(total / size);
  if (pages < 2) return null;
  const safePage = Math.min(page, pages - 1);
  return <nav className="ew-pager" aria-label={unit + "分页"}>
    <span>{safePage * size + 1}–{Math.min((safePage + 1) * size, total)} / {number(total)} 个{unit}</span>
    <div><button type="button" disabled={safePage === 0} onClick={() => onChange(safePage - 1)}>上一页</button><span>{safePage + 1} / {pages}</span><button type="button" disabled={safePage + 1 >= pages} onClick={() => onChange(safePage + 1)}>下一页</button></div>
  </nav>;
}

function useGroups(ids: number[], control: GroupControl) {
  const [local, setLocal] = useState<Set<number> | null>(null);
  const initial = () => new Set(ids.length > 8 ? ids.slice(1) : []);
  const collapsed = control.collapsedAccounts || local || initial();
  return {
    collapsed,
    toggle: (id: number) => {
      if (control.onToggleAccount) control.onToggleAccount(id);
      else setLocal((previous) => { const next = new Set(previous || initial()); next.has(id) ? next.delete(id) : next.add(id); return next; });
    },
  };
}

function useEscape(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
}

/** 侧栏关闭先完成短暂退场，再通知父层卸载，避免内容瞬间消失。 */
export function useInspectorPresence<T>(selected: T | null, onClosed?: () => void) {
  const [display, setDisplay] = useState<T | null>(selected);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (selected) { setDisplay(selected); setClosing(false); return; }
    if (!display) return;
    setClosing(true);
    timer.current = setTimeout(() => { setDisplay(null); setClosing(false); }, 180);
  }, [selected]);
  const close = () => {
    if (!display || closing) return;
    setClosing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setDisplay(null); setClosing(false); onClosed?.(); }, 180);
  };
  return { display, closing, close };
}

function Baseline({ total, segments, label }: { total: number; segments: Array<{ label: string; count: number; tone: string }>; label: string }) {
  return <div className="ew-baseline" role="img" aria-label={label + "，" + segments.map((item) => item.label + " " + item.count).join("，")}>
    <div className="ew-baseline-track" aria-hidden="true">{segments.map((item) => <i className={"tone-" + item.tone} key={item.label} style={{ width: total > 0 ? (item.count / total * 100) + "%" : "0%" }} />)}</div>
    <div className="ew-baseline-labels">{segments.map((item) => <span key={item.label}><i className={"tone-" + item.tone} aria-hidden="true" />{item.label}<b>{number(item.count)}</b></span>)}</div>
  </div>;
}

interface AssetDirectoryProps extends GroupControl {
  groups: EditorialGroup[];
  selected: EditorialDomain | null;
  onSelect: (item: EditorialDomain) => void;
  onClose?: () => void;
  onDns?: (item: EditorialDomain) => void;
  onNs?: (item: EditorialDomain) => void;
  onRenew?: (item: EditorialDomain) => void;
  onPropagation?: (item: EditorialDomain) => void;
  zones?: boolean;
}

function AssetDirectory({ groups, selected, onSelect, onClose, onDns, onNs, onRenew, onPropagation, zones = false, ...control }: AssetDirectoryProps) {
  const { query, setQuery } = usePageSearch();
  const [page, setPage] = useState(0);
  const [objectPages, setObjectPages] = useState<Record<number, number>>({});
  const [searchCollapsed, setSearchCollapsed] = useState<Set<number>>(new Set());
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const closeRef = useRef<HTMLButtonElement>(null);
  const inspectorId = useId();
  const all = groups.flatMap((group) => group.domains);
  const { collapsed, toggle } = useGroups(groups.map((group) => group.accountId), control);
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => groups.map((group) => ({ ...group, domains: matches(group.alias, normalized) ? group.domains : group.domains.filter((item) => matches(item.full_domain, normalized)) })).filter((group) => !normalized || matches(group.alias, normalized) || group.domains.length > 0), [groups, normalized]);
  const current = selected ? filtered.flatMap((group) => group.domains).find((item) => item.id === selected.id) || null : null;
  const inspector = useInspectorPresence(current, onClose);
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visibleGroups = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const active = zones ? all.filter((item) => item.status === "active").length : all.filter((item) => lifeState(item) === "active").length;
  const expired = zones ? 0 : all.filter((item) => lifeState(item) === "expired").length;
  const external = all.filter((item) => delegation(item) === "external").length;
  const defaults = all.filter((item) => delegation(item) === "default").length;
  const close = () => {
    if (current) { inspector.close(); rowRefs.current.get(current.id)?.focus({ preventScroll: true }); }
  };
  useEscape(Boolean(current), close);
  useEffect(() => { if (current) closeRef.current?.focus({ preventScroll: true }); }, [current?.id]);
  useEffect(() => { if (selected && !filtered.some((group) => group.domains.some((item) => item.id === selected.id))) onClose?.(); }, [selected?.id, filtered, onClose]);
  const choose = (item: EditorialDomain) => { onSelect(item); };
  const updateQuery = (value: string) => { setQuery(value); setPage(0); setObjectPages({}); setSearchCollapsed(new Set()); };
  useEffect(() => { setPage(0); setObjectPages({}); setSearchCollapsed(new Set()); }, [query]);
  return <section className={"editorial-view ew-workspace " + (zones ? "editorial-constellation" : "editorial-atlas")} aria-label={zones ? "Cloudflare 资产目录" : "域名资产目录"}>
    <div className="ew-asset-overview">
      <div className="ew-total"><span>{zones ? "托管 Zone" : "域名资产"}</span><strong>{number(all.length)}</strong><small>{number(groups.length)} 个账号</small></div>
      <Baseline total={all.length} label={zones ? "激活状态" : "生命周期"} segments={zones ? [{ label: "已激活", count: active, tone: "strong" }, { label: "其他状态", count: all.length - active, tone: "muted" }] : [{ label: "正常", count: active, tone: "strong" }, { label: "已过期", count: expired, tone: "danger" }, { label: "待确认", count: all.length - active - expired, tone: "muted" }]} />
      {!zones && <Baseline total={all.length} label="委派状态" segments={[{ label: "系统默认", count: defaults, tone: "strong" }, { label: "已委派", count: external, tone: "soft" }, { label: "未返回", count: all.length - defaults - external, tone: "muted" }]} />}
    </div>
    {normalized && <div className="ew-directory-tools"><span>匹配 {number(filtered.reduce((sum, group) => sum + group.domains.length, 0))} 个对象</span><button type="button" className="ew-quiet-button" onClick={() => updateQuery("")}>清除筛选</button></div>}
    <div className={"ew-directory-layout" + ((current || inspector.display) ? " has-inspector" : "") + (inspector.closing ? " is-inspector-closing" : "")}>
      <div className="ew-directory-list">
        {visibleGroups.map((group) => {
          const isCollapsed = normalized ? searchCollapsed.has(group.accountId) : collapsed.has(group.accountId);
          const objectsPage = Math.min(objectPages[group.accountId] || 0, Math.max(0, Math.ceil(group.domains.length / OBJECT_PAGE_SIZE) - 1));
          const groupActive = group.domains.filter((item) => zones ? item.status === "active" : lifeState(item) === "active").length;
          return <section className="ew-asset-group" key={group.accountId}>
            <button type="button" className="ew-group-toggle" aria-expanded={!isCollapsed} onClick={() => {
              if (normalized) setSearchCollapsed((previous) => { const next = new Set(previous); next.has(group.accountId) ? next.delete(group.accountId) : next.add(group.accountId); return next; });
              else toggle(group.accountId);
            }}><span className="ew-group-identity"><strong>{group.alias}</strong><small>{number(group.domains.length)} {zones ? "个 Zone" : "个域名"}</small></span><span className="ew-group-signal" aria-hidden="true"><i style={{ width: group.domains.length ? (groupActive / group.domains.length * 100) + "%" : "0%" }} /></span><span className="ew-disclosure-label">{isCollapsed ? "展开" : "收起"}</span></button>
            {group.error && <p className="ew-inline-error" role="status">{group.error}</p>}
            {!isCollapsed && <div>
              <div className="ew-object-grid">{group.domains.slice(objectsPage * OBJECT_PAGE_SIZE, (objectsPage + 1) * OBJECT_PAGE_SIZE).map((item) => {
                const state = zones ? item.status === "active" ? "active" : "unknown" : lifeState(item);
                return <button type="button" key={item.id} ref={(element) => { if (element) rowRefs.current.set(item.id, element); else rowRefs.current.delete(item.id); }} className={"ew-object-row " + (zones ? "editorial-zone-node" : "editorial-domain-node") + (current?.id === item.id ? " is-selected" : "")} onClick={() => choose(item)} aria-label={item.full_domain + "，" + (zones ? zoneLabel(item) : domainStatusLabel(item))} aria-expanded={current?.id === item.id} aria-controls={current?.id === item.id ? inspectorId : undefined}>
                  <span className="ew-object-main"><strong>{item.full_domain}</strong><span>{zones ? "创建 " + fmt(item.created_at) : "到期 " + fmt(item.expires_at)}</span></span>
                  <span className={"ew-object-state state-" + state}>{zones ? zoneLabel(item) : domainStatusLabel(item)}{!zones && <small>{delegation(item) === "external" ? "外部 DNS" : delegation(item) === "default" ? "系统默认" : "DNS 来源未返回"}</small>}</span>
                </button>;
              })}</div>
              {group.domains.length === 0 && !group.error && <p className="ew-empty">此账号下暂无{zones ? " Zone" : "域名"}。</p>}
              <Pager total={group.domains.length} size={OBJECT_PAGE_SIZE} page={objectsPage} unit={zones ? "Zone" : "域名"} onChange={(next) => setObjectPages((previous) => ({ ...previous, [group.accountId]: next }))} />
            </div>}
          </section>;
        })}
        {filtered.length === 0 && <div className="ew-empty" role="status">{normalized ? "没有匹配的账号或对象。" : zones ? "暂无 Cloudflare 资产。" : "暂无域名资产。"}{normalized && <button type="button" onClick={() => updateQuery("")}>清除筛选</button>}</div>}
        <Pager total={filtered.length} page={safePage} onChange={setPage} />
      </div>
      {inspector.display && <aside className={"ew-inspector editorial-inspector" + (inspector.closing ? " is-closing" : "")} id={inspectorId} aria-label={zones ? "Cloudflare Zone 检查器" : "域名检查器"}>
        <div className="ew-inspector-top"><span>{zones ? zoneLabel(inspector.display!) : domainStatusLabel(inspector.display!)}</span><button ref={closeRef} type="button" onClick={close} aria-label={zones ? "关闭 Zone 详情" : "关闭域名详情"}>关闭</button></div>
        <h4>{inspector.display!.full_domain}</h4><p className="ew-inspector-account">{inspector.display!.account_alias || groups.find((group) => group.domains.some((item) => item.id === inspector.display!.id))?.alias}</p>
        <dl className="ew-facts"><div><dt>{zones ? "创建日期" : "注册日期"}</dt><dd>{fmt(inspector.display!.created_at)}</dd></div>{!zones && <div><dt>到期日期</dt><dd>{fmt(inspector.display!.expires_at)}</dd></div>}{!zones && lifeState(inspector.display!) === "unknown" && inspector.display!.status && <div><dt>上游状态</dt><dd>{inspector.display!.status}</dd></div>}<div><dt>{zones ? "托管平台" : "DNS 来源"}</dt><dd>{zones ? "Cloudflare" : inspector.display!.dns_provider || (delegation(inspector.display!) === "default" ? "DNSHE 默认" : delegation(inspector.display!) === "external" ? "外部委派" : "未返回")}</dd></div>{inspector.display!.ns1 && <div><dt>名称服务器 1</dt><dd>{inspector.display!.ns1}</dd></div>}{inspector.display!.ns2 && <div><dt>名称服务器 2</dt><dd>{inspector.display!.ns2}</dd></div>}</dl>
        <div className="ew-inspector-actions">{onDns && <button type="button" className="is-primary" onClick={() => onDns(inspector.display!)}>DNS 解析</button>}{onNs && <button type="button" onClick={() => onNs(inspector.display!)}>委派设置</button>}{onRenew && <button type="button" onClick={() => onRenew(inspector.display!)}>续期</button>}{onPropagation && <button type="button" onClick={() => onPropagation(inspector.display!)}>传播检查</button>}</div>
      </aside>}
    </div>
  </section>;
}

export function EditorialDomainAtlas(props: Omit<AssetDirectoryProps, "zones" | "onPropagation">) { return <AssetDirectory {...props} />; }
export function EditorialZoneConstellation({ groups, selected, onSelect, onClose, onDns, onPropagation, ...control }: Omit<AssetDirectoryProps, "zones" | "onNs" | "onRenew">) {
  const { query, setQuery } = usePageSearch();
  const [scope, setScope] = useState("all");
  const [page, setPage] = useState(0);
  const [objectPages, setObjectPages] = useState<Record<number, number>>({});
  const [searchCollapsed, setSearchCollapsed] = useState<Set<number>>(new Set());
  const rows = useRef(new Map<number, HTMLButtonElement>());
  const closeRef = useRef<HTMLButtonElement>(null);
  const inspectorId = useId();
  const { collapsed, toggle } = useGroups(groups.map((group) => group.accountId), control);
  const normalized = query.trim().toLocaleLowerCase();
  const isFiltering = Boolean(normalized) || scope !== "all";
  const nsCount = (item: EditorialDomain) => Number(Boolean(item.ns1)) + Number(Boolean(item.ns2));
  const all = groups.flatMap((group) => group.domains);
  const active = all.filter((item) => item.status === "active").length;
  const failed = groups.filter((group) => Boolean(group.error)).length;
  const filtered = useMemo(() => groups.map((group) => ({ ...group, domains: group.domains.filter((item) =>
    (matches(group.alias, normalized) || matches(item.full_domain, normalized)) &&
    (scope === "all" || scope === "attention" && item.status !== "active" || scope === "ns" && nsCount(item) < 2 || scope === "failed" && Boolean(group.error)),
  ) })).filter((group) => (!normalized || matches(group.alias, normalized) || group.domains.length > 0) &&
    (scope === "all" || scope === "failed" && Boolean(group.error) || scope !== "failed" && (group.domains.length > 0 || Boolean(group.error)))), [groups, normalized, scope]);
  const current = selected ? filtered.flatMap((group) => group.domains).find((item) => item.id === selected.id) || null : null;
  const inspector = useInspectorPresence(current, onClose);
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const close = () => { if (current) { inspector.close(); rows.current.get(current.id)?.focus({ preventScroll: true }); } };
  useEscape(Boolean(current), close);
  useEffect(() => { if (current) closeRef.current?.focus({ preventScroll: true }); }, [current?.id]);
  useEffect(() => { if (selected && !filtered.some((group) => group.domains.some((item) => item.id === selected.id))) onClose?.(); }, [selected?.id, filtered, onClose]);
  const resetPage = () => { setPage(0); setObjectPages({}); setSearchCollapsed(new Set()); };
  useEffect(resetPage, [query]);
  return <section className="editorial-view ew-workspace editorial-constellation ew-zone-directory" aria-label="Cloudflare 资产目录">
    <div className="ew-zone-summary" aria-label="Zone 状态摘要">
      <div className="ew-zone-total"><span>托管 Zone</span><strong>{number(all.length)}{failed > 0 && <small>+</small>}</strong><small>{number(groups.length)} 个绑定账号{failed > 0 ? " · 仅计已读取对象" : ""}</small></div>
      <dl><div><dt>已激活</dt><dd>{number(active)}<small> / {number(all.length)}</small></dd></div><div><dt>NS 已返回</dt><dd>{number(all.filter((item) => nsCount(item) === 2).length)}<small> / {number(all.length)}</small></dd></div><div><dt>账号读取失败</dt><dd className={failed ? "is-danger" : ""}>{number(failed)}<small> / {number(groups.length)}</small></dd></div></dl>
    </div>
    <div className="ew-directory-tools"><label className="ew-sort"><span>状态</span><select aria-label="Zone 状态筛选" value={scope} onChange={(event) => { setScope(event.target.value); resetPage(); }}><option value="all">全部 Zone</option><option value="attention">未激活</option><option value="ns">NS 未完整返回</option><option value="failed">账号读取失败</option></select></label><span>{isFiltering ? "匹配 " + number(filtered.reduce((sum, group) => sum + group.domains.length, 0)) + " 个 Zone" : "按账号浏览"}</span>{isFiltering && <button type="button" className="ew-quiet-button" onClick={() => { setQuery(""); setScope("all"); resetPage(); }}>清除筛选</button>}</div>
    <div className="ew-directory-list">{filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map((group) => {
      const isCollapsed = isFiltering ? searchCollapsed.has(group.accountId) : collapsed.has(group.accountId);
      const objectPage = Math.min(objectPages[group.accountId] || 0, Math.max(0, Math.ceil(group.domains.length / OBJECT_PAGE_SIZE) - 1));
      const inspected = inspector.display;
      const selectedInGroup = inspected && group.domains.some((item) => item.id === inspected.id) ? inspected : null;
      return <section className="ew-asset-group ew-zone-group" key={group.accountId}>
        <button type="button" className="ew-group-toggle" aria-expanded={!isCollapsed} onClick={() => { if (isFiltering) setSearchCollapsed((previous) => { const next = new Set(previous); next.has(group.accountId) ? next.delete(group.accountId) : next.add(group.accountId); return next; }); else toggle(group.accountId); }}><span className="ew-group-identity"><strong>{group.alias}</strong><small>{group.error ? "读取失败" : number(group.domains.length) + " 个 Zone"}</small></span><span className="ew-disclosure-label">{isCollapsed ? "展开" : "收起"}</span></button>
        {group.error && <p className="ew-inline-error" role="status">{group.error}</p>}
        {!isCollapsed && <><div className="ew-zone-grid">{group.domains.slice(objectPage * OBJECT_PAGE_SIZE, (objectPage + 1) * OBJECT_PAGE_SIZE).map((item) => <div className="ew-zone-entry" key={item.id}><button type="button" className={"ew-object-row editorial-zone-node ew-zone-card" + (current?.id === item.id ? " is-selected" : "")} ref={(element) => { if (element) rows.current.set(item.id, element); else rows.current.delete(item.id); }} onClick={() => { onSelect(item); }} aria-label={item.full_domain + "，" + zoneLabel(item)} aria-expanded={current?.id === item.id} aria-controls={current?.id === item.id ? inspectorId : undefined}>
          <span className="ew-zone-card-head"><strong>{item.full_domain}</strong><span className={"ew-status-badge " + (item.status === "active" ? "is-good" : "is-pending")}>{zoneLabel(item)}</span></span>
          <span className="ew-zone-card-facts"><span><small>NS</small><b>{nsCount(item) === 2 ? "2 项已返回" : nsCount(item) === 1 ? "1 项已返回" : "未返回"}</b></span><span><small>创建</small><b>{fmt(item.created_at)}</b></span><span><small>Zone 记录</small><b>{group.error ? "缓存可查看" : "已读取"}</b></span></span>
          <span className="ew-zone-card-next">{item.status === "active" ? "管理 DNS 与检查传播" : "查看 NS 与激活状态"}<span aria-hidden="true">查看</span></span>
        </button><div className="ew-zone-card-actions" aria-label={item.full_domain + "操作"}><a className="ew-action-button" href={item.provider_account_id ? `https://dash.cloudflare.com/${item.provider_account_id}/${item.full_domain}/dns/records` : "https://dash.cloudflare.com/"} target="_blank" rel="noreferrer">控制台</a>{onDns && <button type="button" onClick={() => onDns(item)}>DNS 解析</button>}{onPropagation && <button type="button" onClick={() => onPropagation(item)}>传播检查</button>}</div></div>)}</div>
        {selectedInGroup && <aside className={"ew-inspector ew-zone-inspector" + (inspector.closing ? " is-closing" : "")} id={inspectorId} aria-label="Cloudflare Zone 检查器"><div className="ew-inspector-top"><span>Zone 详情 · {zoneLabel(selectedInGroup)}</span><button type="button" ref={closeRef} onClick={close} aria-label="关闭 Zone 详情">关闭</button></div><div className="ew-zone-detail-body"><div><h4>{selectedInGroup.full_domain}</h4><p className="ew-inspector-account">{group.alias}</p><dl className="ew-facts"><div><dt>创建日期</dt><dd>{fmt(selectedInGroup.created_at)}</dd></div><div><dt>托管平台</dt><dd>Cloudflare</dd></div></dl></div><div className="ew-zone-nameservers"><span>名称服务器</span><code>{selectedInGroup.ns1 || "名称服务器 1 未返回"}</code><code>{selectedInGroup.ns2 || "名称服务器 2 未返回"}</code><div className="ew-inspector-actions"><a className="ew-action-button" href={selectedInGroup.provider_account_id ? `https://dash.cloudflare.com/${selectedInGroup.provider_account_id}/${selectedInGroup.full_domain}/dns/records` : "https://dash.cloudflare.com/"} target="_blank" rel="noreferrer">控制台</a>{onDns && <button type="button" onClick={() => onDns(selectedInGroup)}>DNS 解析</button>}{onPropagation && <button type="button" onClick={() => onPropagation(selectedInGroup)}>传播检查</button>}</div></div></div></aside>}
        {group.domains.length === 0 && !group.error && <p className="ew-empty">{isFiltering ? "此账号没有匹配的 Zone。" : "此账号下暂无 Zone，可先在 Cloudflare 添加站点后同步。"}</p>}<Pager total={group.domains.length} size={OBJECT_PAGE_SIZE} page={objectPage} unit="Zone" onChange={(next) => setObjectPages((previous) => ({ ...previous, [group.accountId]: next }))} /></>}
      </section>;
    })}</div>
    {filtered.length === 0 && <div className="ew-empty" role="status">{isFiltering ? "没有匹配的账号或 Zone。" : "暂无 Cloudflare 资产。"}{isFiltering && <button type="button" onClick={() => { setQuery(""); setScope("all"); resetPage(); }}>清除筛选</button>}</div>}<Pager total={filtered.length} page={safePage} onChange={setPage} />
  </section>;
}

export interface EditorialAccount { id: number; alias: string; api_key: string; created_at: string; provider?: string; }
export interface EditorialAccountUsage {
  domains?: number;
  zones?: number;
  readState?: "readable" | "cached" | "error" | "unknown";
  readLabel?: string;
  readAt?: string;
  verification?: "valid" | "permission" | "unknown";
  verificationLabel?: string;
}
export function EditorialAccountSwitchboard({ dnshe, cloudflare, onDnsheEdit, onDnsheDelete, onCfEdit, onCfDelete, onBindDnshe, onBindCf, usageByAccount = {} }: {
  dnshe: EditorialAccount[]; cloudflare: EditorialAccount[];
  onDnsheEdit: (account: EditorialAccount) => void; onDnsheDelete: (account: EditorialAccount) => void; onCfEdit: (account: EditorialAccount) => void; onCfDelete: (account: EditorialAccount) => void;
  onBindDnshe: () => void; onBindCf: () => void; usageByAccount?: Record<number, EditorialAccountUsage>;
}) {
  const { query, setQuery } = usePageSearch();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<Record<string, number>>({});
  const providers = [{ id: "dnshe" as const, name: "DNSHE", items: dnshe }, { id: "cloudflare" as const, name: "Cloudflare", items: cloudflare }];
  const normalized = query.trim().toLocaleLowerCase();
  useEffect(() => { setPages({}); setCollapsed(new Set()); }, [query]);
  // Account records only persist a binding. Do not invent a verification status
  // from the presence of a saved key or from a local domain count.
  const readLabel = (usage?: EditorialAccountUsage) => usage?.readLabel || (usage?.readState === "readable" ? "接口快照可读" : usage?.readState === "cached" ? "保留历史快照" : usage?.readState === "error" ? "读取失败" : usage?.verificationLabel || (usage?.verification === "valid" ? "凭据已验证" : usage?.verification === "permission" ? "权限受限" : ""));
  const readFailed = (usage?: EditorialAccountUsage) => usage?.readState === "error" || usage?.verification === "permission";
  const resourceLabel = (provider: "dnshe" | "cloudflare", usage?: EditorialAccountUsage) => {
    const value = provider === "dnshe" ? usage?.domains : usage?.zones;
    return hasNumber(value) ? number(value) + (provider === "dnshe" ? " 个域名" : " 个 Zone") : "资源未读取";
  };
  return <section className="editorial-view ew-workspace editorial-switchboard" aria-label="账号连接目录">
    <div className="ew-page-heading"><h2>账号管理</h2><span>{number(dnshe.length + cloudflare.length)} 个绑定账号</span></div>
    <div className="ew-bind-actions"><button type="button" className="is-primary" onClick={onBindDnshe}>＋ 绑定 DNSHE 账号</button><button type="button" className="is-primary" onClick={onBindCf}>＋ 绑定 Cloudflare 账号</button></div>
    {normalized && <div className="ew-directory-tools"><span>按名称筛选「{query}」</span><button type="button" className="ew-quiet-button" onClick={() => setQuery("")}>清除筛选</button></div>}
    <div className="ew-directory-list ew-provider-directory">
      {providers.map((provider) => {
        const filtered = provider.items.filter((item) => matches(item.alias, normalized) || matches(item.api_key, normalized));
        const page = Math.min(pages[provider.id] || 0, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
        const isCollapsed = collapsed.has(provider.id);
        return <section className={"ew-connection-group provider-" + provider.id} key={provider.id}>
          <button type="button" className="ew-group-toggle ew-provider-heading" aria-expanded={!isCollapsed} onClick={() => setCollapsed((previous) => { const next = new Set(previous); next.has(provider.id) ? next.delete(provider.id) : next.add(provider.id); return next; })}><span className="ew-group-identity"><strong>{provider.name}</strong><small>{number(filtered.length)} 个账号</small></span><span className="ew-provider-purpose">{provider.id === "dnshe" ? "域名 · 助力 · 注册名额" : "Zone · DNS · 免费额度"}</span><span className="ew-disclosure-label">{isCollapsed ? "展开" : "收起"}</span></button>
          {!isCollapsed && <><div className="ew-connection-list">{filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((account) => {
            const usage = usageByAccount[account.id];
            return <div className="ew-connection-row" key={account.id}>
              <div className="ew-connection-select"><span className="ew-account-monogram" aria-hidden="true">{provider.id === "dnshe" ? "D" : "C"}</span><span><strong>{account.alias}</strong><small>{mask(account.api_key)}</small></span></div>
              <div className="ew-connection-meta"><span>已绑定</span><small>{fmt(account.created_at)}</small></div>
              <dl className="ew-connection-evidence">{readLabel(usage) && <div><dt>接口读取</dt><dd className={readFailed(usage) ? "is-danger" : ""}>{readLabel(usage)}</dd></div>}<div><dt>资源快照</dt><dd>{resourceLabel(provider.id, usage)}</dd></div></dl>
              <div className="ew-row-actions"><button type="button" onClick={() => provider.id === "dnshe" ? onDnsheEdit(account) : onCfEdit(account)}>编辑凭据</button><button type="button" className="is-danger" onClick={() => provider.id === "dnshe" ? onDnsheDelete(account) : onCfDelete(account)}>解绑</button></div>
            </div>;
          })}</div>{filtered.length === 0 && <p className="ew-empty">{normalized ? "没有匹配的账号。" : "尚未绑定 " + provider.name + " 账号。"}</p>}<Pager total={filtered.length} page={page} onChange={(next) => setPages((previous) => ({ ...previous, [provider.id]: next }))} /></>}
        </section>;
      })}
    </div>
  </section>;
}

export interface EditorialQuota { account_id: number; alias: string; used: number; total: number; available: number; base?: number; invite_bonus?: number; error?: string; }
const quotaRatio = (quota: EditorialQuota) => !quota.error && hasNumber(quota.used) && hasNumber(quota.total) && quota.total > 0 ? quota.used / quota.total * 100 : null;
export function EditorialQuotaPressure({ quotas, onInspect, renderDetails }: { quotas: EditorialQuota[]; onInspect?: (quota: EditorialQuota) => void; renderDetails?: (quota: EditorialQuota) => React.ReactNode }) {
  const { query } = usePageSearch();
  const [sort, setSort] = useState("pressure");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const idPrefix = useId();
  useEffect(() => { setPage(0); }, [query]);
  const filtered = useMemo(() => quotas.filter((quota) => matches(quota.alias, query.trim().toLocaleLowerCase())).sort((a, b) => {
    if (sort === "name") return a.alias.localeCompare(b.alias, "zh-CN");
    if (sort === "available") return (a.error ? 1 : 0) - (b.error ? 1 : 0) || b.available - a.available;
    return (quotaRatio(b) === null ? 1 : 0) - (quotaRatio(a) === null ? 1 : 0) || (quotaRatio(b) ?? -1) - (quotaRatio(a) ?? -1);
  }), [quotas, query, sort]);
  const known = quotas.filter((quota) => !quota.error && hasNumber(quota.used) && hasNumber(quota.total) && hasNumber(quota.available));
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const failed = quotas.filter((quota) => Boolean(quota.error)).length;
  const totals = known.reduce((sum, quota) => ({ used: sum.used + quota.used, total: sum.total + quota.total, available: sum.available + quota.available }), { used: 0, total: 0, available: 0 });
  const aggregatePct = totals.total > 0 ? totals.used / totals.total * 100 : null;
  const aggregateSlots = aggregatePct === null ? 0 : Math.round(Math.max(0, Math.min(100, aggregatePct)) / 5);
  const overCount = quotas.filter((quota) => (quotaRatio(quota) ?? 0) > 100).length;
  return <section className="editorial-view ew-workspace editorial-pressure" aria-label="账户配额压力轨道">
    <div className="ew-quota-focus-layout">
      <div className="ew-quota-focus" aria-label="全部账户配额总览" aria-live="polite"><span className="ew-section-label">全部账户</span><div className="ew-quota-focus-heading"><strong>账户域名配额总览</strong><span className={aggregatePct === null ? "is-unknown" : aggregatePct >= 100 ? "is-danger" : ""}>{aggregatePct === null ? "使用率未知" : percent(aggregatePct)}<small>{known.length === quotas.length ? "已读账号整体占用" : "已读部分整体占用"}</small></span></div><div className={"ew-capacity-ruler" + (aggregatePct === null ? " is-unknown" : "")} role="img" aria-label={aggregatePct === null ? "容量未读取" : "已读账号合计使用 " + percent(aggregatePct)}>{Array.from({ length: 20 }, (_, index) => <i key={index} className={index < aggregateSlots ? "is-filled" : ""} />)}</div><div className="ew-capacity-labels"><span>0%</span><span>50%</span><span>100%</span></div><div className="ew-quota-focus-facts"><span>已用合计 <b>{known.length ? number(totals.used) : "—"}</b></span><span>总名额 <b>{known.length ? number(totals.total) : "—"}</b></span><span>已读取 <b>{known.length} / {quotas.length}</b></span>{known.length < quotas.length && <span className="is-unknown">未读账号未计入</span>}</div></div>
      <div className="ew-quota-summary"><div><span>可用名额合计</span><strong>{known.length ? number(totals.available) : "—"}</strong><small>各账号额度独立使用，不可相互挪用</small></div><dl><div><dt>绑定账号</dt><dd>{number(quotas.length)}</dd></div><div><dt>超额账号</dt><dd className={overCount ? "is-danger" : ""}>{number(overCount)}</dd></div><div><dt>读取失败</dt><dd className={failed ? "is-danger" : ""}>{number(failed)}</dd></div></dl></div>
    </div>
    <div className="ew-directory-tools"><label className="ew-sort"><span>排序</span><select aria-label="配额排序" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }}><option value="pressure">关注优先</option><option value="available">可用名额</option><option value="name">账号名称</option></select></label><button type="button" className="ew-quiet-button" disabled={expanded.size === 0} onClick={() => setExpanded(new Set())}>收起详情</button></div>
    <div className="ew-pressure-axis" aria-hidden="true"><span>账号 / 已用</span><div><span>0%</span><span>50%</span><span>100%</span></div><span>使用率</span></div>
    <div className="ew-pressure-board">{filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map((quota) => {
      const pct = quotaRatio(quota);
      const open = expanded.has(quota.account_id);
      const over = pct !== null && pct > 100;
      return <section className={"ew-pressure-item" + (open ? " is-expanded" : "")} key={quota.account_id}>
        <button type="button" className="ew-pressure-select" aria-expanded={open} aria-controls={idPrefix + "-" + quota.account_id} onClick={() => { setExpanded((previous) => { const next = new Set(previous); next.has(quota.account_id) ? next.delete(quota.account_id) : next.add(quota.account_id); return next; }); }}>
          <span className="ew-pressure-identity"><strong>{quota.alias}</strong><small>{quota.error ? "读取失败" : hasNumber(quota.used) && hasNumber(quota.total) ? number(quota.used) + " / " + number(quota.total) + " 已用" : "未读取"}{!quota.error && hasNumber(quota.available) ? " · 可用 " + number(quota.available) : ""}</small></span>
          <span className={"ew-pressure-track" + (pct === null ? " is-unknown" : "") + (over ? " is-over" : "")} role="img" aria-label={pct === null ? "使用率未知" : "使用率 " + percent(pct)}><i style={{ width: pct === null ? "0%" : Math.min(100, Math.max(0, pct)) + "%" }} /></span>
          <span className={"ew-pressure-number" + (over ? " is-danger" : "")}><strong>{pct === null ? "—" : percent(pct)}</strong><small>{over ? "超出 " + number(quota.used - quota.total) : open ? "收起详情" : "查看分解"}</small></span>
        </button>
        {open && <div className="ew-quota-detail" id={idPrefix + "-" + quota.account_id}>{quota.error ? <p className="ew-inline-error" role="status">{quota.error}</p> : <dl><div><dt>总名额</dt><dd>{hasNumber(quota.total) ? number(quota.total) : "未返回"}</dd></div><div><dt>已使用</dt><dd>{hasNumber(quota.used) ? number(quota.used) : "未返回"}</dd></div><div><dt>可用</dt><dd>{hasNumber(quota.available) ? number(quota.available) : "未返回"}</dd></div>{hasNumber(quota.base) && <div><dt>基础额度</dt><dd>{number(quota.base)}</dd></div>}{hasNumber(quota.invite_bonus) && <div><dt>邀请奖励</dt><dd>{number(quota.invite_bonus)}</dd></div>}</dl>}{renderDetails?.(quota)}{onInspect && <button type="button" className="ew-quiet-button" onClick={() => onInspect(quota)}>查看账号</button>}</div>}
      </section>;
    })}</div>
    {filtered.length === 0 && <p className="ew-empty" role="status">没有匹配的配额账号。</p>}
    <Pager total={filtered.length} page={safePage} onChange={setPage} />
  </section>;
}

export interface EditorialKeyRow { key_id: number | null; key_name: string; api_key: string; status?: string | null; request_count: number | null; last_used_at: string | null; has_secret: boolean; }
export interface EditorialKeyGroup { account_id: number; alias: string; keys: EditorialKeyRow[]; error?: string; }
export function EditorialKeyLedger({ groups, onCreate, renderKey, onInspect, selectedKey, onClose, collapsedAccounts, onToggleAccount }: { groups: EditorialKeyGroup[]; onCreate: () => void; renderKey: (key: EditorialKeyRow, accountId: number, alias: string) => React.ReactNode; onInspect?: (key: EditorialKeyRow, accountId: number, alias: string) => void; selectedKey?: string | null; onClose?: () => void } & GroupControl) {
  const { query } = usePageSearch();
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(0);
  const [keyPages, setKeyPages] = useState<Record<number, number>>({});
  const [searchCollapsed, setSearchCollapsed] = useState<Set<number>>(new Set());
  useEffect(() => { setPage(0); setKeyPages({}); setSearchCollapsed(new Set()); }, [query]);
  const { collapsed, toggle } = useGroups(groups.map((group) => group.account_id), { collapsedAccounts, onToggleAccount });
  const normalized = query.trim().toLocaleLowerCase();
  const keys = groups.flatMap((group) => group.keys);
  const filtered = groups.map((group) => ({ ...group, keys: group.keys.filter((key) => matches(group.alias, normalized) || matches(key.key_name, normalized) || matches(key.api_key, normalized)).sort((a, b) => sort === "requests" ? (b.request_count ?? -1) - (a.request_count ?? -1) : sort === "last" ? String(b.last_used_at || "").localeCompare(String(a.last_used_at || "")) : a.key_name.localeCompare(b.key_name, "zh-CN")) })).filter((group) => !normalized || matches(group.alias, normalized) || group.keys.length > 0);
  const selectionMatches = !selectedKey || filtered.some((group) => group.keys.some((key) => key.api_key === selectedKey));
  useEffect(() => { if (!selectionMatches) onClose?.(); }, [selectedKey, selectionMatches, onClose]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const readableRequests = keys.filter((key) => hasNumber(key.request_count));
  const failedAccounts = groups.filter((group) => Boolean(group.error)).length;
  return <section className="editorial-view ew-workspace editorial-ledger" aria-label="API 密钥账本">
    <div className="ew-page-heading"><h2>API 密钥</h2><button type="button" className="ew-action-button is-primary" onClick={onCreate}>创建密钥</button></div>
    <div className="ew-ledger-summary"><div className="ew-ledger-request-total"><span>累计请求快照</span><strong>{readableRequests.length ? number(readableRequests.reduce((sum, key) => sum + key.request_count!, 0)) : "—"}</strong><small>{readableRequests.length}/{number(keys.length)} 把密钥已返回请求数</small></div><div className="ew-ledger-snapshot"><span><b>{number(keys.length)}</b> 把密钥</span><span><b>{number(keys.filter((key) => key.status === "active").length)}</b> 把有效</span><span><b>{number(groups.length)}</b> 个账号</span>{failedAccounts > 0 && <span className="is-danger">{number(failedAccounts)} 个账号读取失败</span>}</div></div>
    {groups.length > 0 && <div className="ew-directory-tools"><label className="ew-sort"><span>排序</span><select aria-label="密钥排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">名称</option><option value="requests">累计请求</option><option value="last">最后使用</option></select></label></div>}
    <div className="ew-ledger-groups">{filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map((group) => {
      const isCollapsed = normalized ? searchCollapsed.has(group.account_id) : collapsed.has(group.account_id);
      const keyPage = Math.min(keyPages[group.account_id] || 0, Math.max(0, Math.ceil(group.keys.length / OBJECT_PAGE_SIZE) - 1));
      return <section className="ew-ledger-group" key={group.account_id}><button type="button" className="ew-group-toggle ew-ledger-account-toggle" aria-expanded={!isCollapsed} onClick={() => { if (normalized) setSearchCollapsed((previous) => { const next = new Set(previous); next.has(group.account_id) ? next.delete(group.account_id) : next.add(group.account_id); return next; }); else toggle(group.account_id); }}><span className="ew-group-identity"><small>所属账号 · {number(group.keys.length)} 把密钥</small><strong>{group.alias}</strong></span><span className="ew-disclosure-label">{isCollapsed ? "展开" : "收起"}</span></button>{group.error && <p className="ew-inline-error" role="status">{group.error}</p>}
        {!isCollapsed && <div className="ew-key-records">{group.keys.slice(keyPage * OBJECT_PAGE_SIZE, (keyPage + 1) * OBJECT_PAGE_SIZE).map((key, index) => {
          const inspect = () => onInspect?.(key, group.account_id, group.alias);
          return <div className={"ew-key-row editorial-ledger-row" + (selectedKey === key.api_key ? " is-selected" : "")} key={String(key.key_id ?? index) + key.api_key} role={onInspect ? "button" : undefined} tabIndex={onInspect ? 0 : undefined} aria-label={onInspect ? "查看 " + (key.key_name || "未命名") : undefined} aria-pressed={onInspect ? selectedKey === key.api_key : undefined} onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, input, select, textarea")) inspect(); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); inspect(); } }}>
            <span className="ew-key-identity"><strong>{key.key_name || "未命名"}</strong>{!key.has_secret && <small>本地未保存 Secret</small>}</span><span className={"ew-key-status ew-status-badge " + (key.status === "active" ? "is-good" : "")} data-label="状态">{key.status === "active" ? "有效" : key.status === "disabled" ? "已停用" : key.status || "未返回"}</span><span className="ew-key-count" data-label="累计请求"><small>累计请求</small><b className={hasNumber(key.request_count) ? "" : "is-unknown"}>{hasNumber(key.request_count) ? number(key.request_count) : "未返回"}</b></span><span className="ew-key-last" data-label="最后使用"><small>最后使用</small>{key.last_used_at || "未返回"}</span><div className="ew-key-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{onInspect && <button type="button" className="ew-quiet-button" onClick={inspect} aria-label={"查看 " + (key.key_name || "未命名") + " 详情"}>查看</button>}{renderKey(key, group.account_id, group.alias)}</div>
          </div>;
        })}{group.keys.length === 0 && !group.error && <p className="ew-empty">此账号下暂无 API 密钥。</p>}<Pager total={group.keys.length} size={OBJECT_PAGE_SIZE} page={keyPage} unit="密钥" onChange={(next) => setKeyPages((previous) => ({ ...previous, [group.account_id]: next }))} /></div>}
      </section>;
    })}</div>
    {filtered.length === 0 && <div className="ew-empty" role="status">{normalized ? "没有匹配的密钥。" : "暂无 API 密钥。"}</div>}
    <Pager total={filtered.length} page={safePage} onChange={setPage} />
  </section>;
}

/* --------------------------------------------------------------------------
 * 概览工作面
 *
 * 概览是全站唯一同时回答「有多少资产」与「哪里需要处理」的入口。
 * 这里把两种画风的 DOM 骨架收在一个组件中，但数据、路由和筛选仍由
 * App 持有。这样切换画风不会重取数据，也不会清空用户正在查看的账号。
 *
 * 设计风：资产主轨 → 容量尺 → 最近变化，CF 用量是旁注而不是第三组
 * 等权 KPI。数据风：状态带 → 账号比较 → CF 最高单账号压力 → 最近注册。
 * -------------------------------------------------------------------------- */
export interface EditorialOverviewDomainStats {
  total?: number | null;
  delegated?: number | null;
  not_delegated?: number | null;
  active?: number | null;
  expired?: number | null;
  expiring_soon?: number | null;
}

export interface EditorialOverviewQuotaRow {
  account_id: number;
  alias: string;
  used: number;
  total: number;
  available: number;
  base: number;
  invite_bonus: number;
  error: string | null;
}

export interface EditorialOverviewCfMetric {
  key: string;
  label: string;
  used: number | null;
  limit: number | null;
  highest: { alias: string; pct: number } | null;
  coverage: number;
  total: number;
  cached: number;
}

export interface EditorialOverviewCfAccount {
  error?: string | null;
  counts?: Partial<Record<"zones" | "d1_databases" | "kv_namespaces", number>>;
  inventory_issues?: Partial<Record<"zones" | "d1_databases" | "kv_namespaces", { cached_at?: string | null }>>;
}

export interface EditorialOverviewRecentItem {
  id: number;
  full_domain: string;
  account_alias?: string | null;
  created_at?: string | null;
}

export interface EditorialOverviewAssist {
  assist_remaining: number;
  assist_limit: number;
  upgraded_domains: number;
  non_upgraded_domains: number;
}

export interface EditorialOverviewProps {
  dataStyle: boolean;
  loading?: boolean;
  refreshing?: boolean;
  domains: EditorialOverviewDomainStats | null;
  accounts: { dnshe?: number | null; cloudflare?: number | null } | null;
  dnsheAccountCount: number;
  cloudflareAccountCount: number;
  quota: { available?: number | null; failed?: number | null; accounts?: EditorialOverviewQuotaRow[] } | null;
  cfAccounts: EditorialOverviewCfAccount[];
  cfUsage: EditorialOverviewCfMetric[];
  cfUpdatedAt?: number | null;
  assist?: EditorialOverviewAssist | null;
  recent: EditorialOverviewRecentItem[];
  overviewCols: string;
  quotaColumns: string;
  hiddenQuotaAccounts: number[];
  showQuotaFilter: boolean;
  onOverviewColsChange: (value: string) => void;
  overviewColOptions: Array<{ value: string; label: string }>;
  onToggleQuotaFilter: () => void;
  onSetHiddenQuotaAccounts: (next: number[] | ((previous: number[]) => number[])) => void;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
  onOpenDomain: (domain: EditorialOverviewRecentItem) => void;
  formatDate: (value?: string | null, withTime?: boolean) => string;
}

function overviewCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
}

function OverviewRung({ label, value, total, tone = "neutral" }: { label: string; value?: number | null; total?: number | null; tone?: "neutral" | "warning" | "danger" }) {
  const denominator = typeof total === "number" && total > 0 ? total : 0;
  const numerator = typeof value === "number" && value >= 0 ? value : null;
  const slots = denominator ? Math.min(12, Math.max(4, denominator)) : 4;
  const filled = numerator === null ? 0 : denominator ? Math.round(Math.min(numerator, denominator) / denominator * slots) : 0;
  return <div className="status-rung" aria-label={`${label} ${numerator === null ? "未知" : numerator}`}>
    <div className="status-rung__meta"><span>{label}</span><strong>{numerator === null ? "—" : overviewCount(numerator)}</strong></div>
    <div className={`status-rung__track status-rung__track--${tone}`} aria-hidden="true">{Array.from({ length: slots }, (_, index) => <i key={index} className={index < filled ? "is-filled" : ""} />)}</div>
  </div>;
}

function OverviewCfAside({ accounts, usage, updatedAt, onOpen, mode }: { accounts: EditorialOverviewCfAccount[]; usage: EditorialOverviewCfMetric[]; updatedAt?: number | null; onOpen: () => void; mode: "design" | "data" }) {
  const count = (key: "zones" | "d1_databases" | "kv_namespaces") => {
    const known = accounts.filter((account) => !account.error && (!account.inventory_issues?.[key] || account.inventory_issues[key]?.cached_at) && typeof account.counts?.[key] === "number");
    if (!known.length) return "—";
    const value = known.reduce((sum, account) => sum + Number(account.counts?.[key] || 0), 0);
    return `${value}${known.length < accounts.length ? "+" : ""}`;
  };
  const stamp = updatedAt ? new Date(updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  return <section className={`dashboard-cf-usage-panel is-${mode}`} data-cf-mode={mode} aria-label="Cloudflare 免费额度摘要">
    <div className="dashboard-cf-usage-head"><div><span>Cloudflare 免费额度</span><small>{stamp ? `快照 ${stamp}` : accounts.length ? `已读取 ${accounts.length} 个账号` : "尚未读取用量"}</small></div><button type="button" onClick={onOpen}>查看用量</button></div>
    <div className="dashboard-cf-usage-grid">{usage.map((metric) => {
      const highest = metric.highest;
      const status = highest ? `最高单账号 ${highest.pct.toFixed(1)}%` : "压力未知";
      const limit = metric.limit === null ? "每账号上限未知" : `每账号 ${metric.limit.toLocaleString("en-US")} / 日`;
      return <div className="dashboard-cf-usage-metric" key={metric.key}><span>{metric.label} · 今日 UTC</span><strong>{metric.used === null ? "—" : metric.used.toLocaleString("en-US")}</strong><small>{limit}</small><div className="overview-pressure-track" aria-hidden="true"><i className={highest && highest.pct > 100 ? "is-over" : ""} style={{ width: `${Math.min(100, Math.max(0, highest?.pct ?? 0))}%` }} /></div><em className={highest && highest.pct > 60 ? "is-warn" : metric.used === null ? "is-unknown" : ""}>{status}</em>{highest && <small className="overview-pressure-owner" title={highest.alias}>{highest.alias}</small>}<small>覆盖 {metric.coverage}/{metric.total}{metric.cached ? ` · ${metric.cached} 缓存` : ""}</small></div>;
    })}</div>
    <div className="dashboard-cf-resource-grid"><div><span>CF 账号</span><strong>{accounts.length || "—"}</strong></div><div><span>Zone</span><strong>{count("zones")}</strong></div><div><span>D1 库</span><strong>{count("d1_databases")}</strong></div><div><span>KV 命名空间</span><strong>{count("kv_namespaces")}</strong></div></div>
  </section>;
}

function OverviewRecent({ recent, onNavigate, onOpenDomain, formatDate, data = false }: Pick<EditorialOverviewProps, "recent" | "onNavigate" | "onOpenDomain" | "formatDate"> & { data?: boolean }) {
  return <section className={`dashboard-data-panel overview-recent-panel${data ? " overview-recent-panel--data" : ""}`} aria-labelledby={data ? "dashboard-data-recent" : "overview-design-recent"}>
    <div className="dashboard-data-panel-head"><h3 id={data ? "dashboard-data-recent" : "overview-design-recent"}>最近注册</h3><button type="button" className="text-xs text-content-secondary underline underline-offset-4" onClick={() => onNavigate("domains")}>域名列表</button></div>
    {data ? <div className="dashboard-data-table" role="table" aria-label="最近注册域名"><div className="dashboard-data-row dashboard-data-head" role="row"><span>域名</span><span>账号</span><span>注册时间</span></div>{recent.slice(0, 8).map((item) => <button type="button" className="dashboard-data-row dashboard-data-row--recent w-full text-left hover:bg-hovered" role="row" key={item.id} onClick={() => onOpenDomain(item)} aria-label={`定位域名 ${item.full_domain}`}><span className="font-mono truncate" title={item.full_domain}>{item.full_domain}</span><span className="truncate" title={item.account_alias || ""}>{item.account_alias || "—"}</span><span className="font-mono text-content-muted">{formatDate(item.created_at, false)}</span></button>)}{!recent.length && <p className="p-4 text-sm text-content-muted">暂无最近注册记录</p>}</div> : <div className="overview-recent-list">{recent.slice(0, 8).map((item) => <button type="button" key={item.id} className="overview-registration-row" onClick={() => onOpenDomain(item)}><time dateTime={item.created_at || undefined}>{formatDate(item.created_at, false)}</time><span className="font-mono text-xs sm:text-sm text-content-primary truncate min-w-0">{item.full_domain}</span><span className="text-[11px] sm:text-xs text-content-muted truncate min-w-0">{item.account_alias || "—"}</span></button>)}{!recent.length && <div className="px-5 py-10 text-center text-content-muted text-sm">暂无最近注册记录</div>}</div>}
  </section>;
}

function OverviewQuotaPanel({ props, design }: { props: EditorialOverviewProps; design: boolean }) {
  const rows = (props.quota?.accounts || []).filter((account) => !props.hiddenQuotaAccounts.includes(account.account_id));
  return <section className={`dashboard-detail-panel ${design ? "overview-design-quota" : ""} bg-surface border border-border-base rounded overflow-hidden flex flex-col`}>
    <div className="overview-quota-heading px-4 sm:px-5 py-3.5 border-b border-border-base flex items-center justify-between gap-3 flex-shrink-0"><div className="flex items-center gap-2 min-w-0"><h3 className="font-bold text-content-primary text-sm truncate">账户配额</h3>{props.quota?.failed ? <span className="text-[11px] text-amber-400 flex-shrink-0">{props.quota.failed} 个未取到</span> : null}</div><div className="flex items-center gap-2 flex-shrink-0"><span className="text-[11px] text-content-muted hidden sm:inline whitespace-nowrap">显示{rows.length}/{props.quota?.accounts?.length || 0}</span><button type="button" onClick={props.onToggleQuotaFilter} className={`text-[11px] px-2.5 py-1.5 rounded border flex items-center gap-1.5 transition-colors ${props.showQuotaFilter ? "border-primary/50 bg-primary/10 text-primary" : "border-border-base text-content-muted hover:text-content-primary"}`} title="选择要显示的账号">筛选</button></div></div>
    {props.showQuotaFilter && <div className="drawer-anim px-4 sm:px-5 py-3 border-b border-border-base bg-surface-hover/40 space-y-2.5"><div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-content-secondary">选择要显示的账号</span><div className="flex items-center gap-3"><button type="button" onClick={() => props.onSetHiddenQuotaAccounts([])} className="text-[11px] text-primary">全选</button><button type="button" onClick={() => props.onSetHiddenQuotaAccounts((props.quota?.accounts || []).map((account) => account.account_id))} className="text-[11px] text-content-muted">全不选</button></div></div><div className="flex flex-wrap gap-2">{(props.quota?.accounts || []).map((account) => { const shown = !props.hiddenQuotaAccounts.includes(account.account_id); return <label key={account.account_id} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border cursor-pointer transition-colors max-w-[220px] ${shown ? "border-primary/50 bg-primary/10 text-primary" : "border-border-base text-content-muted"}`}><input type="checkbox" checked={shown} onChange={() => props.onSetHiddenQuotaAccounts((previous) => previous.includes(account.account_id) ? previous.filter((id) => id !== account.account_id) : [...previous, account.account_id])} className="accent-primary" /><span className="truncate">{account.alias}</span></label>; })}</div></div>}
    <div className="p-4 sm:p-5 flex-1">{!props.quota ? <div className="flex justify-center py-8">读取中…</div> : rows.length === 0 ? <div className="py-8 text-center text-content-muted text-sm">没有可显示的账号（点右上「筛选」重新勾选）</div> : <OverviewCapacityRows accounts={rows} columns={props.quotaColumns} />}</div>
  </section>;
}

export function EditorialOverview(props: EditorialOverviewProps) {
  const domain = props.domains;
  const accountSummary = props.accounts || {};
  const onOpenRecent = (item: EditorialOverviewRecentItem) => props.onOpenDomain(item);
  if (props.dataStyle) return <div className="dashboard-data-workbench" data-mode="data" aria-label="概览数据面板">
    <div className="dashboard-mode-header"><div><h2 className="text-xl font-semibold tracking-tight text-content-primary">概览</h2><p className="dashboard-kicker">状态 · 比较 · 最近变化</p></div><button type="button" onClick={props.onRefresh} disabled={props.refreshing} aria-label="刷新概览摘要" className="h-10 px-3 rounded border border-border-base text-sm font-medium text-content-secondary hover:bg-hovered inline-flex items-center gap-2" title="读取统计、域名与 CF 最新快照">{props.refreshing ? "读取中…" : "刷新"}</button></div>
    <div className="dashboard-status-rail" aria-label="概览状态摘要"><div><span>可注册名额</span><strong>{overviewCount(props.quota?.available)}</strong></div><div><span>即将到期</span><strong className={domain?.expiring_soon ? "text-amber-600 dark:text-amber-400" : ""}>{overviewCount(domain?.expiring_soon)}</strong></div><div><span>额度未取到</span><strong className={props.quota?.failed ? "text-red-600 dark:text-red-400" : ""}>{overviewCount(props.quota?.failed)}</strong></div><div><span>CF 免费额度</span><strong className={props.cfAccounts.length ? "" : "text-content-muted"}>{props.cfAccounts.length ? `${props.cfAccounts.length} 个账号` : "未读取"}</strong></div></div>
    <section className="overview-domain-composition" aria-label="域名状态"><div className="overview-domain-total"><span>域名状态</span><strong>{overviewCount(domain?.total)}<small> 个域名</small></strong><button type="button" onClick={() => props.onNavigate("domains")}>域名列表</button></div><div className="overview-domain-dimension"><h3>委派 · 共 {overviewCount(domain?.total)} 个</h3><div><OverviewRung label="已委派" value={domain?.delegated} total={domain?.total} /><OverviewRung label="未委派" value={domain?.not_delegated} total={domain?.total} /></div></div><div className="overview-domain-dimension"><h3>生命周期 · 共 {overviewCount(domain?.total)} 个</h3><div><OverviewRung label="活跃" value={domain?.active} total={domain?.total} /><OverviewRung label="已过期" value={domain?.expired} total={domain?.total} tone="danger" /></div></div></section>
    <div className="overview-identity-strip" aria-label="账号摘要"><button type="button" onClick={() => props.onNavigate("accounts")}><span>DNSHE 账号</span><strong>{overviewCount(accountSummary.dnshe ?? props.dnsheAccountCount)}</strong></button><button type="button" onClick={() => props.onNavigate("accounts")}><span>Cloudflare 账号</span><strong>{overviewCount(accountSummary.cloudflare ?? props.cloudflareAccountCount)}</strong></button></div>
    <div className="dashboard-data-grid"><section className="dashboard-data-panel" aria-labelledby="dashboard-data-accounts"><div className="dashboard-data-panel-head"><h3 id="dashboard-data-accounts">账户额度比较</h3><button type="button" className="text-xs text-content-secondary underline underline-offset-4" onClick={() => props.onNavigate("quota")}>查看全部</button></div><div className="dashboard-data-table" role="table" aria-label="账户额度比较"><div className="dashboard-data-row dashboard-data-head" role="row"><span>账号</span><span>已用</span><span>可用</span><span>状态</span></div>{(props.quota?.accounts || []).slice(0, 8).map((account) => { const failed = Boolean(account.error); const ratio = !failed && account.total > 0 ? Math.round(account.used / account.total * 100) : null; return <div className="dashboard-data-row" role="row" key={account.account_id}><span className="truncate" title={account.alias}>{account.alias}</span><span className="tabular-nums">{failed ? "—" : overviewCount(account.used)}</span><span className="tabular-nums">{failed ? "—" : overviewCount(account.available)}</span><span className={failed ? "text-red-600 dark:text-red-400" : ratio !== null && ratio > 85 ? "text-amber-600 dark:text-amber-400" : "text-content-secondary"}>{failed ? "读取失败" : ratio === null ? "未知" : `${ratio}% 已用`}</span></div>; })}{!(props.quota?.accounts || []).length && <p className="p-4 text-sm text-content-muted">暂无账户额度快照</p>}</div></section><OverviewCfAside accounts={props.cfAccounts} usage={props.cfUsage} mode="data" updatedAt={props.cfUpdatedAt} onOpen={() => props.onNavigate("cfquota")} /></div>
    <OverviewRecent recent={props.recent} data onNavigate={props.onNavigate} onOpenDomain={onOpenRecent} formatDate={props.formatDate} />
  </div>;

  return <div className="overview-design-workbench" data-mode="design">
    <div className="overview-design-header"><div><span className="dashboard-kicker">资产总览</span><h2 className="text-2xl font-bold text-content-primary">概览</h2><p className="text-content-muted mt-1 text-sm">域名资产、账号容量与最近变化</p></div><div className="overview-design-actions"><label><span>容量列数</span><select value={props.overviewCols} onChange={(event) => props.onOverviewColsChange(event.target.value)} aria-label="概览卡片每行列数">{props.overviewColOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button type="button" onClick={props.onRefresh} disabled={props.refreshing} aria-label="刷新概览摘要" title="读取统计、域名与 CF 最新快照">{props.refreshing ? "读取中…" : "刷新"}</button></div></div>
    <div className="overview-design-hero dashboard-detail-grid">
      <section className="overview-design-asset-track" aria-labelledby="overview-design-assets"><div className="overview-design-asset-heading"><div><span className="dashboard-kicker">资产总览</span><h3 id="overview-design-assets">域名资产主轨</h3></div><button type="button" onClick={() => props.onNavigate("domains")}>打开域名列表</button></div><div className="overview-design-asset-total"><span>托管域名</span><strong>{overviewCount(domain?.total)}</strong><small>{overviewCount(domain?.delegated)} 已委派 · {overviewCount(domain?.active)} 活跃</small></div><div className="overview-design-rails"><OverviewRung label="委派" value={domain?.delegated} total={domain?.total} /><OverviewRung label="生命周期" value={domain?.active} total={domain?.total} /></div><div className="overview-identity-strip" aria-label="账号摘要"><button type="button" onClick={() => props.onNavigate("accounts")}><span>DNSHE 账号</span><strong>{overviewCount(accountSummary.dnshe ?? props.dnsheAccountCount)}</strong></button><button type="button" onClick={() => props.onNavigate("accounts")}><span>Cloudflare 账号</span><strong>{overviewCount(accountSummary.cloudflare ?? props.cloudflareAccountCount)}</strong></button></div><OverviewAssistPanel assist={props.assist} onOpen={() => props.onNavigate("assist")} /><OverviewQuotaPanel props={props} design /></section>
      <div className="overview-design-context-track">
        <OverviewCfAside accounts={props.cfAccounts} usage={props.cfUsage} mode="design" updatedAt={props.cfUpdatedAt} onOpen={() => props.onNavigate("cfquota")} />
        <OverviewRecent recent={props.recent} onNavigate={props.onNavigate} onOpenDomain={onOpenRecent} formatDate={props.formatDate} />
      </div>
    </div>
  </div>;
}
