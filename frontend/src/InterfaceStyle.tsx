import { useCallback, useEffect, useId, useState } from "react";

export type InterfaceStyle = "design" | "data" | "cards";

const STORAGE_KEY = "DNSHE_INTERFACE_STYLE";
const PAGE_STORAGE_KEY = "DNSHE_INTERFACE_STYLE_PAGES";
const styleLabels: Record<InterfaceStyle, string> = { design: "设计", data: "数据", cards: "卡片" };
const normalizeStyle = (value: unknown): InterfaceStyle => value === "data" || value === "cards" ? value : "design";

const CARD_PAGES = ["dashboard", "domains", "cloudflare", "assist", "accounts", "apikeys", "quota", "ddns", "renewal"];
const LEGACY_VIEWS: Record<string, string> = { dashboard: "OVERVIEW", domains: "DOMAIN", cloudflare: "CF", assist: "ASSIST", accounts: "ACCOUNT", apikeys: "KEY", quota: "QUOTA" };
export const pageStyles = (page: string): InterfaceStyle[] => CARD_PAGES.includes(page) ? ["design", "data", "cards"] : ["design", "data"];
export const effectiveStyle = (style: InterfaceStyle, page: string): InterfaceStyle => style === "cards" && !CARD_PAGES.includes(page) ? "data" : style;

/** 页面级偏好只覆盖全局默认，不复制任何业务状态。空对象表示所有页面跟随全局。 */
export type PageStylePreferences = Record<string, InterfaceStyle>;
export const STYLE_PAGE_LABELS: Record<string, string> = {
  dashboard: "概览", domains: "域名列表", cloudflare: "Cloudflare", assist: "域名助力",
  accounts: "账号管理", apikeys: "API 密钥", register: "注册 / 查重", quota: "账户配额",
  ddns: "动态 DNS", renewal: "自动续期", cfquota: "CF 免费额度", logs: "运行日志", settings: "设置",
};
export const STYLE_PAGE_KEYS = Object.keys(STYLE_PAGE_LABELS);

function readPageStyles(storage: Pick<Storage, "getItem">): PageStylePreferences {
  try {
    const raw = storage.getItem(PAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([page, value]) =>
      STYLE_PAGE_KEYS.includes(page) && pageStyles(page).includes(value as InterfaceStyle),
    ).map(([page, value]) => [page, value as InterfaceStyle]));
  } catch { return {}; }
}

export function resolvePageStyle(globalStyle: InterfaceStyle, page: string, preferences: PageStylePreferences): InterfaceStyle {
  return effectiveStyle(preferences[page] || globalStyle, page);
}

export function migrateStyle(storage: Pick<Storage, "getItem" | "setItem">, page: string): InterfaceStyle {
  const saved = normalizeStyle(storage.getItem(STORAGE_KEY));
  if (!storage.getItem("DNSHE_STYLE_SCHEMA")) {
    const next = saved === "data" && LEGACY_VIEWS[page] && storage.getItem(`DNSHE_${LEGACY_VIEWS[page]}_VIEW`) === "cards" ? "cards" : saved;
    try {
      storage.setItem(STORAGE_KEY, next);
      storage.setItem("DNSHE_STYLE_SCHEMA", "3");
    } catch { /* 只读存储仍保留已读取的偏好，本会话继续可用。 */ }
    return next;
  }
  return saved;
}

/** 结构偏好独立于明暗主题；存储受限时仍允许在当前会话切换。 */
export function useInterfaceStyle(): [InterfaceStyle, (style: InterfaceStyle) => void] {
  const [style, setStyle] = useState<InterfaceStyle>(() => {
    try { return migrateStyle(window.localStorage, window.location.hash.replace(/^#\/?/, "") || "dashboard"); }
    catch { return "design"; }
  });
  const changeStyle = useCallback((value: InterfaceStyle) => {
    const next = normalizeStyle(value);
    setStyle(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); }
    catch { /* 本机存储不可用不应中断布局切换或丢失页面草稿。 */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.interfaceStyle = style;
  }, [style]);

  return [style, changeStyle];
}

/**
 * 页面级样式覆盖。旧版本没有这个键时返回空对象，因而自然继承全局偏好；
 * 删除单页覆盖即可恢复跟随全局，适合设置页提供“跟随全局”入口。
 */
export function usePageInterfaceStyles(): [PageStylePreferences, (page: string, style: InterfaceStyle | null) => void] {
  const [preferences, setPreferences] = useState<PageStylePreferences>(() => {
    try { return readPageStyles(window.localStorage); } catch { return {}; }
  });
  const changePageStyle = useCallback((page: string, value: InterfaceStyle | null) => {
    if (!STYLE_PAGE_KEYS.includes(page)) return;
    setPreferences((previous) => {
      const next = { ...previous };
      if (value === null) delete next[page];
      else if (pageStyles(page).includes(value)) next[page] = value;
      try { window.localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify(next)); } catch { /* 会话内仍可切换 */ }
      return next;
    });
  }, []);
  return [preferences, changePageStyle];
}

type StyleControlProps = { value: InterfaceStyle; onChange: (style: InterfaceStyle) => void };

type InterfaceStyleSettingProps = StyleControlProps & {
  pagePreferences?: PageStylePreferences;
  onPageChange?: (page: string, style: InterfaceStyle | null) => void;
};

export function InterfaceStyleSetting({ value, onChange, pagePreferences, onPageChange }: InterfaceStyleSettingProps) {
  const id = useId();
  const options: Array<{ value: InterfaceStyle; label: string; description: string }> = [
    { value: "design", label: "设计风", description: "对象目录与主辅工作面，适合浏览和日常操作。" },
    { value: "data", label: "数据风", description: "紧凑表格与指标对齐，适合比较和巡检。" },
    { value: "cards", label: "卡片风", description: "自适应卡片，集中查看每个对象；支持的页面提供此视图。" },
  ];
  return <fieldset className="min-w-0 space-y-4" aria-describedby={`${id}-help`} data-interface-style-setting>
    <legend className="text-sm font-semibold text-content-primary">界面画风</legend>
    <p id={`${id}-help`} className="text-xs leading-5 text-content-secondary">切换整站页面布局，明暗主题保持不变。</p>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {options.map((option) => <label key={option.value} className={`flex min-w-0 cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${value === option.value ? "border-primary bg-primary-soft" : "border-border-base bg-surface hover:bg-hovered"}`}>
        <input type="radio" name={`${id}-style`} value={option.value} checked={value === option.value}
          onChange={() => onChange(option.value)} aria-labelledby={`${id}-${option.value}-label`} aria-describedby={`${id}-${option.value}-description`}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
        <span className="min-w-0">
          <span id={`${id}-${option.value}-label`} className="block text-sm font-medium text-content-primary whitespace-nowrap">{option.label}</span>
          <span id={`${id}-${option.value}-description`} className="mt-1 block text-xs leading-5 text-content-secondary">{option.description}</span>
        </span>
      </label>)}
    </div>
    {pagePreferences && onPageChange && <div className="page-style-matrix" data-page-style-matrix>
      <div className="flex items-end justify-between gap-3 border-t border-border-base pt-4">
        <div>
          <h4 className="text-sm font-semibold text-content-primary">页面样式</h4>
          <p className="mt-1 text-xs leading-5 text-content-secondary">单页覆盖优先于全局默认；选择“跟随全局”可恢复统一设置。</p>
        </div>
        <span className="text-xs text-content-muted whitespace-nowrap">{Object.keys(pagePreferences).length} 个覆盖</span>
      </div>
      <div className="mt-3 divide-y divide-border-base border-y border-border-base">
        {STYLE_PAGE_KEYS.map((page) => {
          const options = pageStyles(page);
          const override = pagePreferences[page];
          const selected = effectiveStyle(override || value, page);
          return <div key={page} className="page-style-row" data-page-style-row={page}>
            <span className="page-style-page">{STYLE_PAGE_LABELS[page]}</span>
            <div className="page-style-actions" role="group" aria-label={`${STYLE_PAGE_LABELS[page]}页面样式`}>
              <button type="button" className={!override ? "is-active" : ""} aria-pressed={!override}
                onClick={() => onPageChange(page, null)}>跟随全局</button>
              {options.map((option) => <button key={option} type="button" className={override && selected === option ? "is-active" : ""}
                aria-pressed={Boolean(override && selected === option)} aria-label={`${STYLE_PAGE_LABELS[page]}：${styleLabels[option]}风`}
                onClick={() => onPageChange(page, option)}>{styleLabels[option]}</button>)}
            </div>
          </div>;
        })}
      </div>
    </div>}
  </fieldset>;
}

export function InterfaceStyleToggle({ value, onChange, page = "dashboard" }: StyleControlProps & { page?: string }) {
  const options = pageStyles(page);
  const selected = effectiveStyle(value, page);
  const labels = { design: "设计", data: "数据", cards: "卡片" };
  const selectedIndex = Math.max(0, options.indexOf(selected));
  const next = options[(selectedIndex + 1) % options.length];
  return <div role="group" aria-label="界面画风" className="interface-style-switch">
    <div className="interface-style-switch__segments">
      {options.map((style) => <button key={style} type="button" onClick={() => onChange(style)} aria-pressed={selected === style}
        aria-label={`${labels[style]}风`} className={selected === style ? "is-active" : ""}>{labels[style]}</button>)}
    </div>
    <button
      type="button"
      className="interface-style-switch__cycle"
      onClick={() => onChange(next)}
      aria-label={`切换界面画风，当前${labels[selected]}风，下一个${labels[next]}风`}
    >
      {labels[selected]}
    </button>
  </div>;
}
