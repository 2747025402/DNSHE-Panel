import { Children, createContext, useContext, type ReactNode } from "react";
import "./asset-collection.css";

export type AssetView = "list" | "cards";
const ViewContext = createContext<AssetView>("list");

export function AssetCollection({ view, label, cardColumns = "grid-cols-1 md:grid-cols-2 lg:grid-cols-3", children }: {
  view: AssetView; label: string; cardColumns?: string; children: ReactNode;
}) {
  const itemCount = Children.count(children);
  return (
    <ViewContext.Provider value={view}>
      <div
        className={`asset-collection asset-collection--${view}`}
        role={view === "list" ? "table" : "list"}
        aria-label={label}
        aria-rowcount={view === "list" ? itemCount : undefined}
        data-asset-view={view}
        data-asset-count={itemCount}
      >
        {view === "list" && (
          <div role="rowgroup" className="asset-column-head" data-asset-header>
            <div role="row" className="asset-tracks">
              {["域名", "状态", "创建时间", "到期时间", "来源 / DNS", "操作"].map((name) => (
                <span key={name} role="columnheader">{name}</span>
              ))}
            </div>
          </div>
        )}
        <div role={view === "list" ? "rowgroup" : undefined} className={view === "cards" ? `grid ${cardColumns} gap-3 sm:gap-4 md:gap-6` : "asset-rows"} data-asset-rows>
          {children}
        </div>
      </div>
    </ViewContext.Provider>
  );
}

export function AssetRecord({ id, name, status, created, expires, provider, actions, highlighted, kind = "domain", showProvider = true }: {
  id?: string; name: ReactNode; status: ReactNode; created: ReactNode; expires: ReactNode;
  provider: ReactNode; actions: ReactNode; highlighted?: boolean; kind?: "domain" | "zone"; showProvider?: boolean;
}) {
  const view = useContext(ViewContext);
  // 卡片保留资产管理的原有阅读顺序与视觉层次，不把数据列表简单包成卡片。
  if (view === "cards") return (
    <div id={id} role="listitem" data-asset-card={kind} data-asset-record data-asset-kind={kind}
      className={`bg-surface border rounded p-5 flex flex-col justify-between shadow-sm ${highlighted ? "border-primary ring-2 ring-primary/50" : "border-border-base"}`}>
      <div className="flex items-start justify-between gap-2 min-w-0">{name}{status}</div>
      <div className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3"><span className="text-content-muted font-medium">{kind === "domain" ? "注册时间" : "创建时间"}</span><span className="font-mono text-content-secondary">{created}</span></div>
        <div className="flex items-center justify-between gap-3"><span className="text-content-muted font-medium">到期时间</span><span className="font-mono text-content-secondary">{expires}</span></div>
        {kind === "zone" && showProvider && <div className="flex items-center justify-between gap-3"><span className="text-content-muted font-medium">注册来源</span><span className="text-content-secondary border border-border-base px-2.5 py-0.5 rounded-md">{provider}</span></div>}
      </div>
      {kind === "domain" && <>
        <div className="border-t border-border-base my-3.5" />
        <div className="flex items-center justify-between gap-3 text-xs"><span className="text-content-muted font-medium">当前 DNS 服务器</span><span className="bg-elevated text-content-secondary border border-border-base px-2.5 py-0.5 rounded-md">{provider}</span></div>
      </>}
      <div className="border-t border-border-base my-3.5" />
      <div className="asset-card-actions flex flex-wrap items-center justify-end gap-2">{actions}</div>
    </div>
  );
  const role = view === "list" ? "cell" : undefined;
  return (
    <div id={id} role={view === "list" ? "row" : "listitem"} data-asset-record data-asset-kind={kind}
      className={`asset-record asset-tracks${highlighted ? " asset-record--highlighted" : ""}`}>
      <div role={role} className="asset-name">{name}</div>
      <div role={role} className="asset-status">{status}</div>
      <div role={role} className="asset-date" data-label="创建时间">{created}</div>
      <div role={role} className="asset-date" data-label="到期时间">{expires}</div>
      <div role={role} className="asset-provider" data-label="来源 / DNS">{provider}</div>
      <div role={role} className="asset-actions" data-asset-actions>{actions}</div>
    </div>
  );
}
