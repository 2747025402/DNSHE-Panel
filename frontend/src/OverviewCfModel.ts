import type { AccountUsage, CfLimits } from "./CfUsage";
import { readAccount, type Reading } from "./CfQuotaModel";

/** 绝对用量可以合计，但账号额度不能被池化；风险始终来自单账号。 */
export function buildOverviewCfUsage(accounts: AccountUsage[], limits: CfLimits | null, expected = accounts.length, today = new Date().toISOString().slice(0, 10)) {
  const rows = accounts.map((account) => readAccount(account, today, limits));
  const definitions: Array<{ key: string; label: string; cap: keyof CfLimits; read: (row: typeof rows[number]) => Reading }> = [
    { key: "workers", label: "Workers 请求", cap: "workersRequestsPerDay", read: (row) => row.metrics.requests },
    { key: "d1", label: "D1 行读", cap: "d1RowsReadPerDay", read: (row) => row.metrics.rowsRead },
    { key: "kv", label: "KV 读取", cap: "kvReadsPerDay", read: (row) => row.kvRead },
  ];
  return definitions.map((def) => {
    const known = rows.map((row) => ({ reading: def.read(row), alias: row.account.alias })).filter(({ reading }) => reading.value !== null);
    const limit = limits && Number.isFinite(limits[def.cap]) && limits[def.cap] > 0 ? limits[def.cap] : null;
    const highest = limit === null ? null : known.reduce<{ alias: string; pct: number } | null>((result, { reading, alias }) => {
      const pct = reading.value! / limit * 100;
      return result === null || pct > result.pct ? { alias, pct } : result;
    }, null);
    return {
      key: def.key, label: def.label, limit, highest,
      used: known.length ? known.reduce((sum, { reading }) => sum + reading.value!, 0) : null,
      coverage: known.length, total: Math.max(expected, accounts.length), cached: known.filter(({ reading }) => reading.state === "cached").length,
    };
  });
}
export type OverviewCfMetric = ReturnType<typeof buildOverviewCfUsage>[number];
