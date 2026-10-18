/** /api/domains returns DNSHE's cached DNS state, not only upstream registration state. */
export interface DomainStatusEvidence {
  status?: string | null;
  expires_at?: string | null;
  has_dns?: number | boolean | null;
  disable_ns_management?: number | boolean | null;
  ns1?: string | null;
  ns2?: string | null;
}

export function domainLifeState(item: DomainStatusEvidence, now = Date.now()): "active" | "expired" | "unknown" {
  const status = String(item.status || "").trim().toLowerCase();
  const expires = item.expires_at ? new Date(item.expires_at).getTime() : NaN;
  if (status.includes("expire") || status.includes("过期") || Number.isFinite(expires) && expires < now) return "expired";
  if (["active", "enabled", "registered", "正常", "已解析", "未解析", "已委派"].includes(status)) return "active";
  return "unknown";
}

export function domainDelegation(item: DomainStatusEvidence): "external" | "default" | "unknown" {
  if (item.disable_ns_management || item.status === "已委派") return "external";
  const servers = [item.ns1, item.ns2].filter((value): value is string => Boolean(value));
  if (servers.length && servers.every((value) => !/(^|\.)dnshe\.com\.?$/i.test(value))) return "external";
  if (item.has_dns === false || item.has_dns === 0) return "external";
  if (item.has_dns === true || item.has_dns === 1 || servers.some((value) => /(^|\.)dnshe\.com\.?$/i.test(value))) return "default";
  return "unknown";
}

export function domainStatusLabel(item: DomainStatusEvidence): string {
  const life = domainLifeState(item);
  if (life === "expired") return "已过期";
  const status = String(item.status || "").trim();
  if (["已解析", "未解析", "已委派"].includes(status)) return status;
  return life === "active" ? "已注册" : status ? "未识别状态" : "状态未返回";
}
