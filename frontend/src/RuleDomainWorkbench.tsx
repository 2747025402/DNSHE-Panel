import { useCallback, useEffect, useRef, useState } from "react";
import {
  domainSequenceRange, makeDomainCheckRecord, mergeDomainCheckRecord,
  readDomainCheckCache, saveDomainCheckCache,
  type DomainCheckRecord, type DomainCheckTarget, type ShortDomainCharset,
} from "./DomainCheckCacheModel";
import "./register-rule-tools.css";

export { DomainCheckCachePanel } from "./DomainCheckResults";

export function useDomainCheckCache() {
  const [records, setRecords] = useState<DomainCheckRecord[]>(readDomainCheckCache);
  const current = useRef(records);
  const [persistenceError, setPersistenceError] = useState(false);
  const dirty = useRef(false);
  const persistTimer = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (!dirty.current) return;
    const saved = saveDomainCheckCache(current.current);
    if (saved) dirty.current = false;
    setPersistenceError(!saved);
  }, []);
  useEffect(() => {
    // At most one full snapshot write per 400ms; never serialize a 20k-row cache per render.
    if (!dirty.current || persistTimer.current !== null) return;
    persistTimer.current = window.setTimeout(() => { persistTimer.current = null; flush(); }, 400);
  }, [records, flush]);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
      flush();
    };
  }, [flush]);
  const recordOutcome = useCallback((target: DomainCheckTarget, response: unknown, httpStatus: number) => {
    const row = makeDomainCheckRecord(target, response, httpStatus);
    current.current = mergeDomainCheckRecord(current.current, row);
    dirty.current = true;
    setRecords(current.current);
    return row;
  }, []);
  return { records, recordOutcome, persistenceError };
}

export type DomainCombinationConfig = { enabled: boolean; length: number; charset: ShortDomainCharset; start: string };

/** Configuring never starts a request or allocates the full combination space. */
export function DomainCombinationControls({ value, disabled = false, onChange }: {
  value: DomainCombinationConfig; disabled?: boolean; onChange: (patch: Partial<DomainCombinationConfig>) => void;
}) {
  const custom = value.charset.startsWith("自定义:");
  const range = domainSequenceRange(value.length, value.charset, value.start);
  const rounds = (range.remaining + 19999n) / 20000n;
  return <section className="domain-combination-controls" aria-label="字符组合规则">
    <label className="domain-combination-toggle"><input type="checkbox" checked={value.enabled} disabled={disabled} onChange={event => onChange({ enabled: event.target.checked })} /><span>按字符组合顺序查询</span><small aria-hidden="true">关闭时使用通配规则</small></label>
    {value.enabled && <>
      <div className={`domain-combination-fields${custom ? " has-custom" : ""}`}>
        <label><span>长度</span><input aria-label="组合长度" type="number" min={1} max={63} step={1} value={Number.isFinite(value.length) ? value.length : ""} disabled={disabled} onChange={event => onChange({ length: event.target.value === "" ? 0 : Number(event.target.value) })} /></label>
        <label><span>字符集</span><select aria-label="组合字符集" value={custom ? "custom" : value.charset} disabled={disabled} onChange={event => onChange({ charset: event.target.value === "custom" ? "自定义:" : event.target.value as ShortDomainCharset })}><option value="字母数字">字母与数字（a–z、0–9）</option><option value="字母">字母（a–z）</option><option value="数字">数字（0–9）</option><option value="custom">自定义字符</option></select></label>
        {custom && <label><span>自定义字符 · 自动去重</span><input aria-label="自定义组合字符" value={value.charset.slice("自定义:".length)} placeholder="例如 ab019" disabled={disabled} onChange={event => onChange({ charset: `自定义:${[...new Set(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))].join("")}` })} /></label>}
        <label><span>起始串 · 可留空</span><input aria-label="组合起始串" value={value.start} placeholder="留空从第一个组合开始" disabled={disabled} maxLength={63} aria-invalid={!!range.error} onChange={event => onChange({ start: event.target.value.toLowerCase() })} /></label>
      </div>
      {range.error ? <p className="domain-combination-error" role="alert">{range.error}</p> : <p className="domain-combination-summary">从 <code>{range.start}</code> 起，理论剩余 <strong>{range.remaining.toLocaleString()}</strong> 个前缀；每轮最多 20,000 个任务，至少 {rounds.toLocaleString()} 轮，多后缀会分摊本轮容量。只在点击开始后查询，续轮仍需手动确认。</p>}
    </>}
  </section>;
}
