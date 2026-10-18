import type { CfAccountUsage, CfUsageIssue, CF_FREE_LIMITS } from "./cfusage";

export interface CfUsagePayload {
  accounts: CfAccountUsage[];
  limits: typeof CF_FREE_LIMITS;
  generated_at: string;
}

export interface CfUsageSnapshot {
  at: number;
  payload: CfUsagePayload;
}

/** 同一个数据库内的冷启动、强制刷新、后台刷新合并；不串不同实例。 */
const pending = new WeakMap<object, Promise<CfUsagePayload>>();
export function refreshCfUsageOnce(scope: object, task: () => Promise<CfUsagePayload>): Promise<CfUsagePayload> {
  const current = pending.get(scope);
  if (current) return current;
  const next = task().finally(() => {
    if (pending.get(scope) === next) pending.delete(scope);
  });
  pending.set(scope, next);
  return next;
}

/** 缓存仅在明确读取失败时保留旧字段；成功空集必须覆盖旧值。 */
export function retainCfUsageOnFailure(fresh: CfUsagePayload, previous?: CfUsagePayload): CfUsagePayload {
  if (!previous) return fresh;
  const previousById = new Map(previous.accounts.map((account) => [account.account_id, account]));
  return {
    ...fresh,
    accounts: fresh.accounts.map((account) => {
      const old = previousById.get(account.account_id);
      if (!old) return account;
      // 账号级失败不复制整个旧账号为新鲜成功，保留error供UI明确提示。
      if (account.error) {
        const issue = (key: "workers" | "d1" | "kv" | "r2_ops" | "r2_storage"): CfUsageIssue => ({ kind: "unavailable", message: account.error!, cached_at: old.traffic.issues?.[key]?.cached_at ?? previous.generated_at });
        return {
          ...old,
          alias: account.alias,
          error: account.error,
          traffic: { ...old.traffic, issues: { workers: issue("workers"), d1: issue("d1"), kv: issue("kv"), r2_ops: issue("r2_ops"), r2_storage: issue("r2_storage") } },
        };
      }
      const next: CfAccountUsage = {
        ...account,
        counts: { ...account.counts },
        storage: { ...account.storage },
        traffic: { ...account.traffic, issues: { ...account.traffic.issues } },
        inventory_issues: { ...account.inventory_issues },
      };
      for (const key of ["workers", "d1", "kv", "r2_ops", "r2_storage"] as const) {
        const issue = next.traffic.issues?.[key];
        if (!issue || old.traffic[key] === null) continue;
        // 不改旧数据日期，因而昨日快照不可能被当成今日读数。
        Object.assign(next.traffic, { [key]: old.traffic[key] });
        next.traffic.issues![key] = { ...issue, cached_at: old.traffic.issues?.[key]?.cached_at ?? previous.generated_at };
      }
      const names = { d1_databases: "d1_names", kv_namespaces: "kv_names", r2_buckets: "r2_names", pages_projects: "pages_names" } as const;
      for (const key of Object.keys(next.inventory_issues ?? {}) as Array<keyof CfAccountUsage["counts"]>) {
        const issue = next.inventory_issues![key]!;
        // 上一次本身读取失败且没有旧值时，不把它的兼容0当有效缓存。
        if (old.inventory_issues?.[key] && !old.inventory_issues[key]!.cached_at) continue;
        next.counts[key] = old.counts[key];
        next.inventory_issues![key] = { ...issue, cached_at: old.inventory_issues?.[key]?.cached_at ?? previous.generated_at };
        if (key === "d1_databases") next.storage = old.storage;
        if (key in names) {
          const nameKey = names[key as keyof typeof names];
          next[nameKey] = old[nameKey];
        }
      }
      return next;
    }),
  };
}

export function parseCfUsageSnapshot(raw: string | null): CfUsageSnapshot | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as CfUsageSnapshot;
    if (!Number.isFinite(value.at) || !Array.isArray(value.payload?.accounts) || !value.payload?.limits || typeof value.payload?.generated_at !== "string") return undefined;
    return value;
  } catch {
    return undefined;
  }
}
