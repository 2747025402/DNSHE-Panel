import { useEffect, useRef } from "react";

/** 共用模态键盘边界：Esc 只关最上层，取消不提交，关闭后归焦。 */
export function useModalKeyboard(handlers: Record<string, () => void>) {
  const callbacks = useRef(handlers);
  callbacks.current = handlers;
  useEffect(() => {
    const triggers = new Map<HTMLElement, HTMLElement | null>();
    let lastFocus = document.activeElement as HTMLElement | null;
    const layers = () => Array.from(document.querySelectorAll<HTMLElement>("[data-app-modal]"));
    const focusables = (layer: HTMLElement) => Array.from(layer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    const onFocus = (event: FocusEvent) => { lastFocus = event.target as HTMLElement; };
    const observer = new MutationObserver(() => {
      const current = layers();
      for (const [layer, trigger] of triggers) if (!layer.isConnected) {
        triggers.delete(layer);
        if (trigger?.isConnected && (!current.length || current[current.length - 1]?.contains(trigger))) trigger.focus();
      }
      for (const layer of current) if (!triggers.has(layer)) {
        triggers.set(layer, lastFocus);
        layer.tabIndex = -1;
        layer.focus();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const current = layers(), layer = current[current.length - 1];
      if (!layer) return;
      if (event.key === "Escape") {
        const close = callbacks.current[layer.dataset.appModal || ""];
        if (close) { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      } else if (event.key === "Tab") {
        const items = focusables(layer), first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); layer.focus(); }
        else if (!layer.contains(document.activeElement) || document.activeElement === layer || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKey);
    return () => { observer.disconnect(); document.removeEventListener("focusin", onFocus); window.removeEventListener("keydown", onKey); };
  }, []);
}
