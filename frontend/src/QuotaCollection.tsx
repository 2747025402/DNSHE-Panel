import { AlertTriangle } from "lucide-react";
import type { AssetView } from "./AssetCollection";
import "./quota-collection.css";

type QuotaItem = {
  account_id: number;
  alias: string;
  available?: number | null;
  used?: number | null;
  total?: number | null;
  error?: string;
};

function readQuota(quota: QuotaItem) {
  const number = (value: number | null | undefined) => !quota.error && typeof value === "number" && Number.isFinite(value) ? value : null;
  const available = number(quota.available), used = number(quota.used), total = number(quota.total);
  const ratio = used !== null && total !== null && total > 0 ? used / total * 100 : null;
  const percent = ratio !== null && Number.isFinite(ratio) ? Math.round(ratio) : null;
  const incomplete = available === null || used === null || total === null;
  const status = quota.error ? "读取失败" : incomplete ? "数据不完整" : available! <= 0 ? "无可用配额" : "可用";
  const tone = quota.error ? "text-red-600 dark:text-red-400" : incomplete ? "text-content-muted"
    : available! <= 0 ? "text-amber-600 dark:text-amber-400" : "text-content-secondary";
  return { available, used, total, percent, status, tone };
}

const formatNumber = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US");
const formatPercent = (value: number | null) => value === null ? "—" : `${value}%`;

export function QuotaCollection({ quotas, view }: { quotas: QuotaItem[]; view: AssetView }) {
  if (view === "cards") {
    return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6" data-quota-view="cards" data-source="preview1-design">
      {quotas.map((quota) => {
        const reading = readQuota(quota);
        if (quota.error) return <div key={quota.account_id} className="bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-900/50 rounded p-4 sm:p-5">
          <h3 className="font-bold text-red-700 dark:text-red-400 break-all">{quota.alias}</h3>
          <p className="text-red-800 dark:text-red-300 text-sm mt-2 flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="min-w-0 break-words">API 调用异常: {quota.error}</span>
          </p>
        </div>;
        return <div key={quota.account_id} className="glass-card rounded p-4 sm:p-5 border border-border-base">
          <h3 className="font-bold text-content-primary text-sm sm:text-lg break-all mb-4">{quota.alias}</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-baseline gap-2 text-xs text-content-muted">
              <span className="whitespace-nowrap">使用率</span><span className="whitespace-nowrap flex-shrink-0">{formatPercent(reading.percent)}</span>
            </div>
            {reading.percent !== null ? <div className="w-full bg-elevated h-2 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${reading.percent > 85 ? "bg-red-500" : reading.percent > 60 ? "bg-amber-500" : "bg-primary"}`}
                style={{ width: `${Math.max(0, Math.min(100, reading.percent))}%` }} />
            </div> : <p className="text-xs text-content-muted">{reading.total === 0 ? "总配额为 0，使用率不适用" : "数据不完整，暂不计算使用率"}</p>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-6 pt-4 border-t border-border-base text-center">
            <div><span className="block text-[11px] text-content-muted whitespace-nowrap">可用</span>
              <span className={`text-sm font-semibold ${reading.available === null ? "text-content-muted" : reading.available <= 0 ? "text-red-400" : "text-emerald-400"}`}>{formatNumber(reading.available)}</span></div>
            <div><span className="block text-[11px] text-content-muted whitespace-nowrap">已用</span><span className="text-sm font-semibold text-amber-400">{formatNumber(reading.used)}</span></div>
            <div><span className="block text-[11px] text-content-muted whitespace-nowrap">总配额</span><span className="text-sm font-semibold text-content-primary">{formatNumber(reading.total)}</span></div>
          </div>
        </div>;
      })}
    </div>;
  }

  return <div className="quota-collection border border-border-base rounded bg-surface" role="table" aria-label="账户域名配额" data-quota-view="list" data-source="preview1-data">
    <div role="rowgroup" className="quota-column-head"><div role="row" className="quota-tracks">
      {["账号", "可用", "已用", "总额", "使用率", "状态"].map((label) => <span key={label} role="columnheader">{label}</span>)}
    </div></div>
    <div role="rowgroup">{quotas.map((quota) => {
      const reading = readQuota(quota);
      return <div key={quota.account_id} role="row" className="quota-record quota-tracks" data-quota-account-id={quota.account_id}>
        <div role="cell" className="quota-account"><span className="font-medium text-content-primary">{quota.alias}</span>
          {quota.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400 break-words">API 调用异常: {quota.error}</p>}
        </div>
        {([{ label: "可用", value: reading.available }, { label: "已用", value: reading.used }, { label: "总额", value: reading.total }]).map((metric) =>
          <div key={metric.label} role="cell" className="quota-number"><span className="quota-cell-label">{metric.label}</span><span>{formatNumber(metric.value)}</span></div>)}
        <div role="cell" className="quota-usage"><span className="quota-cell-label">使用率</span><span title={reading.total === 0 ? "总配额为 0，使用率不适用" : undefined}>{formatPercent(reading.percent)}</span></div>
        <div role="cell" className={`quota-state ${reading.tone}`}><span className="quota-cell-label">状态</span><span>{reading.status}</span></div>
      </div>;
    })}</div>
  </div>;
}
