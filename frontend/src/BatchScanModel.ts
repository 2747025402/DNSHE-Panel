import type { ShortDomainCharset } from "./DomainCheckCacheModel";

export const BATCH_MAX_CONCURRENCY = 4;
export const BATCH_MAX_TASKS = 20000;
export type BatchConfig = {
  rule: string;
  /** Optional JavaScript regular expression applied to generated prefixes. */
  regexPattern?: string;
  length: number;
  excludeChars: string;
  roots: string[];
  accountIds: number[];
  seqMode: boolean;
  seqCharset: ShortDomainCharset;
  seqLength: number;
  seqStart: string;
  ignorePool: boolean;
  enableReservedFilter: boolean;
  reservedPrefixes: string[];
};
export const numericRule = (length: 2 | 3) => "{数字}".repeat(length);
export const boundedWorkers = (accountCount: number) => Math.min(BATCH_MAX_CONCURRENCY, Math.max(1, accountCount));

/** Reserve the next start before awaiting, so concurrent workers cannot share an account's rate window. */
export function reserveAccountStart(starts: Map<number, number>, accountId: number, now: number, interval = 1200) {
  const start = Math.max(now, (starts.get(accountId) ?? (now - interval)) + interval);
  starts.set(accountId, start);
  return start;
}
