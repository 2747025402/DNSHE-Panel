import { useState } from "react";

type Account = { account_id: number; alias: string; used: number; total: number; available: number; base: number; invite_bonus: number; error: string | null };

/** 统一压力尺度；保留原配额字段，不用空白卡片模拟图形。 */
export function OverviewCapacityRows({ accounts, columns }: { accounts: Account[]; columns: string }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return <div className={`overview-capacity-rows grid ${columns}`}>
    {accounts.map((account) => {
      const pct = !account.error && account.total > 0 ? account.used / account.total * 100 : null;
      const open = expanded === account.account_id;
      return <div className="overview-capacity-item" key={account.account_id}>
        <button type="button" aria-expanded={open} aria-label={`${account.alias}，${account.error ? "读取失败" : `已用 ${account.used} / ${account.total}`}`} data-account-id={account.account_id} data-state={account.error ? "error" : pct === null ? "unknown" : pct > 100 ? "over" : "ok"} onClick={() => setExpanded(open ? null : account.account_id)}>
          <span className="overview-capacity-identity"><strong title={account.alias}>{account.alias}</strong><small>{account.error ? "读取失败" : `可用 ${account.available}`}</small></span>
          <span className="overview-capacity-reading"><b>{account.error ? "—" : account.used.toLocaleString("zh-CN")}</b><span> / {account.error ? "—" : account.total.toLocaleString("zh-CN")}</span><em>{pct === null ? "—" : `${pct.toFixed(0)}%`}</em></span>
          <span className="overview-capacity-ruler" aria-hidden="true"><i className={pct !== null && pct >= 100 ? "is-over" : ""} style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} /></span>
        </button>
        {open && <div className="overview-capacity-breakdown">{account.error || `基础 ${account.base} · 奖励 ${account.invite_bonus} · 可用 ${account.available}`}</div>}
      </div>;
    })}
  </div>;
}
