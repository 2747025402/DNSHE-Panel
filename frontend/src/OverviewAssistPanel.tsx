import "./overview-assist.css";

interface AssistSnapshot {
  assist_remaining: number;
  assist_limit: number;
  upgraded_domains: number;
  non_upgraded_domains: number;
}
const reading = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";

/** 概览各画风读同一助力快照；缺值不当成零，也不从账号数量推断助力资格。 */
export function OverviewAssistPanel({ assist, onOpen }: { assist?: AssistSnapshot | null; onOpen: () => void }) {
  return <section className="overview-assist" aria-label="域名助力概览">
    <header><h3>域名助力</h3><button type="button" onClick={onOpen}>管理助力</button></header>
    <dl>
      <div><dt>剩余助力次数</dt><dd>{reading(assist?.assist_remaining)}<small> / {reading(assist?.assist_limit)}</small></dd></div>
      <div><dt>已永久化域名</dt><dd>{reading(assist?.upgraded_domains)}</dd></div>
      <div><dt>待永久化域名</dt><dd>{reading(assist?.non_upgraded_domains)}</dd></div>
    </dl>
    {!assist && <p role="status">尚无助力快照，可进入助力页同步。</p>}
  </section>;
}
