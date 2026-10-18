export const DOMAIN_CHECK_CACHE_KEY = "DNSHE_DOMAIN_CHECK_CACHE_V1";
export const DOMAIN_CHECK_CACHE_LIMIT = 20000;
export const DOMAIN_CHECK_REUSE_MS = 24 * 60 * 60 * 1000;
export type ShortDomainCharset = "数字" | "字母" | "字母数字" | `自定义:${string}`;
export type DomainCheckOutcome = "available" | "registered" | "reserved" | "prohibited" | "unavailable" | "unknown" | "error";
export type DomainCheckTarget = { domain: string; subdomain: string; rootdomain: string };
type Confirmation = { outcome: DomainCheckOutcome; checkedAt: string; upstreamStatus: string };
export type DomainCheckRecord = DomainCheckTarget & {
  checkedAt: string;
  outcome: DomainCheckOutcome;
  registered: boolean | null;
  upstreamStatus: string;
  message: string;
  lastConfirmed?: Confirmation;
};
type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;
const outcomes: DomainCheckOutcome[] = ["available", "registered", "reserved", "prohibited", "unavailable", "unknown", "error"];
const confirmed = (outcome: DomainCheckOutcome) => outcome !== "error" && outcome !== "unknown";
const text = (value: unknown, max = 300) => typeof value === "string" ? value.slice(0, max) : "";

/** Mixed means every slot accepts a-z and 0-9, including aa, a1, 1a and 11. */
export function shortDomainPreset(length: 2 | 3, charset: ShortDomainCharset) {
  const sequenceOnly = charset === "字母数字" || charset.startsWith("自定义:");
  return {
    rule: sequenceOnly ? "" : `{${charset}}`.repeat(length),
    length,
    seqMode: sequenceOnly,
    seqCharset: charset,
    seqLength: length,
    seqStart: "",
    combinations: Math.pow(domainSequenceCharacters(charset).length, length),
  };
}

/** Shared alphabet/order for preview, validation and the bounded lazy scanner. */
export function domainSequenceCharacters(charset: ShortDomainCharset): string[] {
  if (charset === "数字") return [..."0123456789"];
  if (charset === "字母") return [..."abcdefghijklmnopqrstuvwxyz"];
  if (charset === "字母数字") return [..."abcdefghijklmnopqrstuvwxyz0123456789"];
  return [...new Set(charset.slice("自定义:".length).toLowerCase().replace(/[^a-z0-9]/g, ""))];
}

export function domainSequenceRange(length: number, charset: ShortDomainCharset, start: string) {
  const characters = domainSequenceCharacters(charset);
  const cleanStart = start.trim().toLowerCase();
  const invalidLength = !Number.isInteger(length) || length < 1 || length > 63;
  const error = invalidLength ? "长度须为 1–63 之间的整数。" : !characters.length ? "至少填写一个合法字符（a–z、0–9）。" : cleanStart && (cleanStart.length !== length || [...cleanStart].some(char => !characters.includes(char))) ? "起始串长度和字符须与当前配置一致。" : "";
  if (error) return { characters, start: cleanStart, combinations: 0n, remaining: 0n, error };
  const radix = BigInt(characters.length);
  const combinations = radix ** BigInt(length);
  let index = 0n;
  for (const char of cleanStart) index = index * radix + BigInt(characters.indexOf(char));
  return { characters, start: cleanStart || characters[0].repeat(length), combinations, remaining: combinations - index, error: "" };
}

/** Policy conclusions require an explicit upstream code; prose/network failure is not evidence. */
export function makeDomainCheckRecord(target: DomainCheckTarget, response: unknown, httpStatus: number, checkedAt = new Date().toISOString()): DomainCheckRecord {
  const data = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const whois = data.whois && typeof data.whois === "object" ? data.whois as Record<string, unknown> : {};
  const valid = httpStatus >= 200 && httpStatus < 300 && data.success === true && data.whois != null && whois.success !== false;
  const upstreamStatus = text(whois.status || data.error_code, 80);
  const status = upstreamStatus.trim().toLowerCase();
  let outcome: DomainCheckOutcome = "unknown";
  if (!valid) outcome = "error";
  else if (["reserved", "reserved_domain", "reserved_prefix", "官方保留", "保留"].includes(status)) outcome = "reserved";
  else if (["prohibited", "forbidden", "registration_prohibited", "registration_disabled", "禁止注册"].includes(status)) outcome = "prohibited";
  else if (["unavailable", "not_available", "不可注册"].includes(status)) outcome = "unavailable";
  else if (whois.registered === true) outcome = "registered";
  else if (whois.registered === false) outcome = "available";
  return {
    domain: target.domain.trim().toLowerCase(), subdomain: target.subdomain, rootdomain: target.rootdomain,
    checkedAt, outcome, registered: valid && typeof whois.registered === "boolean" ? whois.registered : null,
    upstreamStatus,
    message: text(whois.message || data.message) || (!valid ? `查询未确认（HTTP ${httpStatus}）` : ""),
  };
}

export function mergeDomainCheckRecord(rows: DomainCheckRecord[], next: DomainCheckRecord): DomainCheckRecord[] {
  const old = rows.find(row => row.domain === next.domain);
  const lastConfirmed = old && (confirmed(old.outcome)
    ? { outcome: old.outcome, checkedAt: old.checkedAt, upstreamStatus: old.upstreamStatus }
    : old.lastConfirmed);
  const record = !confirmed(next.outcome) && lastConfirmed ? { ...next, lastConfirmed } : next;
  return [record, ...rows.filter(row => row.domain !== next.domain)].slice(0, DOMAIN_CHECK_CACHE_LIMIT);
}

export function readDomainCheckCache(storage?: ReadStorage): DomainCheckRecord[] {
  try {
    const source = storage ?? localStorage;
    const raw = JSON.parse(source.getItem(DOMAIN_CHECK_CACHE_KEY) || "null");
    if (raw?.version !== 1 || !Array.isArray(raw.records)) return [];
    const unique = new Map<string, DomainCheckRecord>();
    for (const row of raw.records.slice(0, DOMAIN_CHECK_CACHE_LIMIT)) {
      if (!row || typeof row.domain !== "string" || row.domain.length > 253 || typeof row.subdomain !== "string" || typeof row.rootdomain !== "string" || !outcomes.includes(row.outcome) || !Number.isFinite(Date.parse(row.checkedAt))) continue;
      if (unique.has(row.domain)) continue;
      const record: DomainCheckRecord = {
        domain: row.domain.toLowerCase(), subdomain: row.subdomain, rootdomain: row.rootdomain,
        checkedAt: row.checkedAt, outcome: row.outcome, registered: typeof row.registered === "boolean" ? row.registered : null,
        upstreamStatus: text(row.upstreamStatus, 80), message: text(row.message),
      };
      if (row.lastConfirmed && confirmed(row.lastConfirmed.outcome) && outcomes.includes(row.lastConfirmed.outcome) && Number.isFinite(Date.parse(row.lastConfirmed.checkedAt))) {
        record.lastConfirmed = { outcome: row.lastConfirmed.outcome, checkedAt: row.lastConfirmed.checkedAt, upstreamStatus: text(row.lastConfirmed.upstreamStatus, 80) };
      }
      unique.set(record.domain, record);
    }
    return [...unique.values()];
  } catch { return []; }
}

export function saveDomainCheckCache(rows: DomainCheckRecord[], storage?: WriteStorage): boolean {
  try {
    (storage ?? localStorage).setItem(DOMAIN_CHECK_CACHE_KEY, JSON.stringify({ version: 1, records: rows.slice(0, DOMAIN_CHECK_CACHE_LIMIT) }));
    return true;
  } catch { return false; }
}

export function findReusableDomainCheck(rows: DomainCheckRecord[], domain: string, now = Date.now()): DomainCheckRecord | undefined {
  return rows.find(row => row.domain === domain.toLowerCase() && confirmed(row.outcome) && now >= Date.parse(row.checkedAt) && now - Date.parse(row.checkedAt) < DOMAIN_CHECK_REUSE_MS);
}

export const domainCheckOutcomeLabel: Record<DomainCheckOutcome, string> = {
  available: "可注册", registered: "已注册", reserved: "官方保留", prohibited: "禁止注册",
  unavailable: "不可注册", unknown: "未确认", error: "查询失败",
};
