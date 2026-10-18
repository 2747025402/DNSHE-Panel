import { useEffect, useId, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   CF 用量 · 图表件（第24轮R 重做）

   🔴 第24轮R 的转折：**放弃"梯子"作为主图型。**
   把「一阶 = 一个可数单位」的梯子当作柱状图用时，视觉结果是**条形码**
   （堆叠的短横线）—— 没有基线、没有刻度、柱高与数值关系不直观、峰值无解释。
   ⇒ 结论：**梯子是"可数单位"的修辞，不是"比较数值"的工具。**
     要比较数值就用**真正的柱状图**：实心柱 + 基线 + 纵轴刻度 + 峰值语义色。

   保留图型：
     ColumnChart    逐日/分类比较（柱状，带刻度与基线）
     DotWaffle      占比极小时（0.6%）唯一诚实画法
     Hairline       少点趋势（≤7 点）
     MultiLine      多账号叠加
     DrawInCounter  单个大数 + 动线
   ═══════════════════════════════════════════════════════════════════════════ */

const NS = "http://www.w3.org/2000/svg";

/**
 * SVG 图表外壳。
 *
 * 🔴 第24轮S：**取消宽度上限**。
 * 曾经用 `maxWidth: 560` 控制"图别太大"，但锐评正确指出这造成了
 * 「外层很宽、内部内容只占一半、右侧大片空白」—— 属于典型的
 * 「外层响应式、内部固定尺寸」。正解是**让绘图区铺满容器**。
 *
 * 做法：`width:100%` + `viewBox` 宽高比接近真实容器（宽扁 2.6:1 左右），
 * 高度由比例自然得出。这样：
 *   · 容器宽 ⇒ 图也宽（不留死角）
 *   · 字号随容器等比缩放，但因为我们把 viewBox 设计成"宽扁"，
 *     放大倍率被摊薄，不会再出现"字糊掉"或"高度爆炸"。
 */
const VIEW_W = 1040;          // 逻辑绘图宽（配合宽扁比例）
function chartStyle(vbH: number) {
  return { width: "100%", height: "auto", display: "block" as const, aspectRatio: `${VIEW_W} / ${vbH}` };
}

function useSvg(draw: (svg: SVGSVGElement) => void, deps: unknown[]) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.innerHTML = "";
    draw(svg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function el(p: SVGElement | SVGSVGElement, t: string, a: Record<string, string | number>) {
  const n = document.createElementNS(NS, t);
  for (const k in a) n.setAttribute(k, String(a[k]));
  p.appendChild(n);
  return n;
}
function txt(p: SVGElement | SVGSVGElement, a: Record<string, string | number>, s: string) {
  const n = el(p, "text", a);
  n.textContent = s;
  return n;
}

const INK = "rgb(var(--accent-rgb))";
const GRID = "var(--border-base)";
const MUTED = "var(--text-muted)";

/* ═══════════════════════════════════════════════════════════════
   ① ColumnChart · 柱状图（第24轮R 取代梯子作为主图型）

   锐评：「柱状图像条形码…没有纵轴刻度、没有明确的最大值或阈值线」。
   本实现补齐柱状图该有的一切：
     · 明确基线（0 刻度加粗）
     · 纵轴 4 档刻度 + 浅网格线（刻度值右对齐在轴外）
     · 实心柱、柱端小圆角（lieflat §二 形状）
     · 峰值用满墨强调 + 可直接标注数值
   ═══════════════════════════════════════════════════════════════ */
export function ColumnChart({
  data, height = 220, unit = "", annotatePeak = false,
  valueFmt = (value: number) => value.toLocaleString("en-US"), tickFmt,
}: {
  data: Array<{ label: string; value: number | null; sub?: string; tooltip?: string }>;
  height?: number;
  unit?: string;
  annotatePeak?: boolean;
  valueFmt?: (value: number) => string;
  tickFmt?: (value: number) => string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const tooltipId = useId();
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const update = () => setWidth(Math.max(1, node.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setHovered(null); setFocused(null); setPinned(null);
  }, [JSON.stringify(data)]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setPinned(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  // The viewBox uses the measured CSS width: labels stay 12px at every viewport.
  const padL = width < 400 ? 44 : 56, padR = 12, padT = 28, padB = 34;
  const plotWidth = Math.max(1, width - padL - padR);
  const plotHeight = Math.max(60, height - padT - padB);
  const base = padT + plotHeight;
  const valid = data.map((point) => point.value).filter((value): value is number => value !== null && Number.isFinite(value));
  const maxValue = Math.max(0, ...valid);
  const rawMax = Math.max(3, maxValue * 1.12);
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const niceMax = ([1, 1.2, 1.5, 2, 2.5, 3, 5, 10].find((step) => step * magnitude >= rawMax) ?? 10) * magnitude;
  const formatTick = tickFmt ?? ((value: number) => value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(1)}M`
    : value >= 1000 ? `${+(value / 1000).toFixed(1)}k` : value.toLocaleString("en-US", { maximumFractionDigits: 1 }));
  const step = plotWidth / Math.max(1, data.length);
  const barWidth = Math.min(42, step * .48);
  const peakIndex = data.findIndex((point) => point.value === maxValue);
  // 键盘焦点优先于悬停：指针停在旧日期时，左右键仍须切换到当前聚焦日期。
  // 反过来，鼠标进入另一根柱时清掉焦点，避免指针被键盘状态锁住。
  const active = focused ?? hovered ?? pinned;
  const activePoint = active === null ? undefined : data[active];
  const tooltipWidth = Math.min(304, width);
  const tooltipLeft = active === null ? 0 : Math.max(0, Math.min(width - tooltipWidth, padL + step * (active + .5) - tooltipWidth / 2));
  const tooltip = activePoint?.tooltip ?? (activePoint ? `${activePoint.label}\n${activePoint.value === null ? "未返回数据" : valueFmt(activePoint.value)} ${unit}` : "");

  return (
    <div ref={container} className="relative min-w-0" data-column-chart onMouseLeave={() => setHovered(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && active !== null) { setHovered(null); setFocused(null); setPinned(null); event.stopPropagation(); }
      }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="group" aria-label={`${unit || "数据"}，${data.length} 个日期；方向键浏览日期`}>
        {[0, 1, 2, 3].map((tick) => {
          const value = niceMax / 3 * tick, y = base - plotHeight * tick / 3;
          return <g key={tick}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke={GRID} strokeWidth={tick === 0 ? 1 : .5} />
            <text x={padL - 8} y={y + 4} fontSize={12} fill={MUTED} textAnchor="end">{formatTick(value)}</text>
          </g>;
        })}
        {unit && <text x={0} y={12} fontSize={12} fill={MUTED}>{unit}</text>}
        {data.map((point, index) => {
          const cx = padL + step * (index + .5);
          const value = point.value !== null && Number.isFinite(point.value) ? Math.max(0, point.value) : null;
          const barHeight = value === null ? 0 : value / niceMax * plotHeight;
          const isActive = index === active;
          const label = point.tooltip ?? `${point.label}：${value === null ? "未返回数据" : valueFmt(value)} ${unit}`;
          return <g key={point.label + index}>
            {isActive && <rect x={padL + step * index} y={padT - 4} width={step} height={plotHeight + 30} fill={INK} opacity={.05} />}
            {value === null ? <text x={cx} y={base - 7} fontSize={12} fill={MUTED} textAnchor="middle">—</text>
              : value > 0 ? <rect x={cx - barWidth / 2} y={base - barHeight} width={barWidth} height={barHeight} rx={2} fill={INK} opacity={index === peakIndex ? 1 : .48} />
              : <circle cx={cx} cy={base} r={2} fill={INK} />}
            <text x={cx} y={base + 22} fontSize={12} fill={MUTED} textAnchor="middle">{point.label}</text>
            {annotatePeak && index === peakIndex && maxValue > 0 && <text x={cx} y={Math.max(17, base - barHeight - 9)} fontSize={12} fontWeight={600} fill={INK} textAnchor="middle">{valueFmt(maxValue)}</text>}
            {focused === index && <rect x={padL + step * index + 1} y={padT - 3} width={Math.max(1, step - 2)} height={plotHeight + 29} fill="none" stroke={INK} strokeWidth={1} />}
            <rect x={padL + step * index} y={padT - 4} width={step} height={plotHeight + 32} fill="transparent"
              tabIndex={0} role="button" aria-label={label} aria-describedby={isActive ? tooltipId : undefined} data-chart-hit={index}
              className="cursor-crosshair outline-none"
              onMouseEnter={() => { setFocused(null); setHovered(index); }} onFocus={() => { setHovered(null); setFocused(index); }} onBlur={() => setFocused(null)}
              onClick={() => setPinned(pinned === index ? null : index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setHovered(null); setPinned(pinned === index ? null : index); }
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  setHovered(null);
                  const next = Math.max(0, Math.min(data.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
                  container.current?.querySelector<SVGElement>(`[data-chart-hit="${next}"]`)?.focus();
                }
              }} />
          </g>;
        })}
      </svg>
      {activePoint && <div id={tooltipId} role="tooltip" data-chart-tooltip
        className={`absolute z-20 rounded-lg border border-border-base bg-surface shadow-sm p-3 text-xs leading-5 text-content-primary max-h-52 overflow-y-auto ${pinned === active ? "" : "pointer-events-none"}`}
        style={{ left: tooltipLeft, top: 24, width: tooltipWidth, maxWidth: "100%" }}>
        {tooltip.split("\n").map((line, index) => <p key={index} className={index === 0 ? "font-semibold mb-1" : "break-words"}>{line}</p>)}
      </div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ② Dot Waffle · 点阵（占比极小时唯一诚实画法）
   一点 = 一个百分点（或 0.1 个百分点）。画出的格数须与量级匹配。
   ═══════════════════════════════════════════════════════════════ */
export function DotWaffle({
  pct, dotPer, cols = 20, rows = 5, label,
}: {
  pct: number; dotPer: number; cols?: number; rows?: number; label?: string;
}) {
  const ref = useSvg(
    (svg) => {
      const R = 5.2, CELL = 14.5, X0 = 10, Y0 = 10;
      const n = Math.max(1, Math.round(pct / dotPer));
      const total = cols * rows;
      for (let c = 0; c < total; c++) {
        const row = Math.floor(c / cols), col = c % cols;
        const filled = c < n;
        el(svg, "circle", {
          cx: X0 + col * CELL + R, cy: Y0 + row * CELL + R, r: R,
          fill: filled ? INK : "none",
          stroke: filled ? "none" : GRID, "stroke-width": 1,
        });
      }
      if (label) {
        txt(svg, { x: X0, y: Y0 + rows * CELL + 18, "font-size": 6.5, "font-weight": 600, fill: MUTED, "letter-spacing": ".08em", opacity: 0.8 }, label);
      }
    },
    [pct, dotPer, cols, rows, label]
  );
  const H = 10 + rows * 14.5 + 24;
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${10 + cols * 14.5 + 10} ${H}`}
      className="block"
      style={{ width: "100%", maxWidth: 520, height: "auto" }}
      role="img"
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   ③ Hairline · 发丝线（少点趋势，≤7 点）
   ═══════════════════════════════════════════════════════════════ */
export function Hairline({
  pts, height = 84, showAxis = true,
}: {
  pts: Array<{ d: string; v: number; label: string }>;
  height?: number;
  showAxis?: boolean;
}) {
  const ref = useSvg(
    (svg) => {
      const padL = 58, padR = 22, Y0 = 22, H = height - 40;
      const base = Y0 + H;
      const W = 400 - padL - padR;
      const max = Math.max(...pts.map((p) => p.v), 1);
      const n = pts.length;
      const xs = (i: number) => padL + (n <= 1 ? W / 2 : (i / (n - 1)) * W);
      const ys = (v: number) => base - (v / max) * H;
      el(svg, "line", { x1: padL, y1: base, x2: padL + W, y2: base, stroke: GRID, "stroke-width": 0.8 });
      el(svg, "line", { x1: padL, y1: Y0, x2: padL + W, y2: Y0, stroke: GRID, "stroke-width": 0.5, opacity: 0.5, "stroke-dasharray": "2 3" });
      const d = pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${ys(p.v).toFixed(1)}`).join(" ");
      el(svg, "path", { d, fill: "none", stroke: INK, "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" });
      const peakIdx = pts.reduce((m, p, i) => (p.v > pts[m].v ? i : m), 0);
      pts.forEach((p, i) => {
        const isEnd = i === 0 || i === n - 1;
        el(svg, "circle", {
          cx: xs(i), cy: ys(p.v), r: isEnd || i === peakIdx ? 2.8 : 1.9,
          fill: i === peakIdx ? INK : "var(--bg-surface)", stroke: INK, "stroke-width": 1.4,
        });
        if (i === peakIdx || i === n - 1) {
          const nearTop = ys(p.v) - 6 < Y0 + 2;
          txt(svg, {
            x: xs(i), y: nearTop ? ys(p.v) + 13 : ys(p.v) - 6,
            "font-size": 9, "font-weight": 800, fill: INK,
            "text-anchor": i === n - 1 ? "end" : "middle",
            stroke: "var(--bg-surface)", "stroke-width": 2.4, "paint-order": "stroke",
          }, p.label);
        }
        /* 🔴 小图（<110px）不画逐点日期：空间不足时标签会互相压叠。
           只画首末两端日期，读者知道区间即可。 */
        const showDate = height >= 110 ? (n <= 5 || i % 2 === 0 || i === n - 1) : (i === 0 || i === n - 1);
        if (showDate) {
          txt(svg, { x: xs(i), y: base + 13, "font-size": 10, "font-weight": 700, fill: MUTED, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }, p.d);
        }
      });
      if (showAxis) {
        txt(svg, { x: 4, y: Y0 + 3, "font-size": 6, "font-weight": 700, fill: MUTED, opacity: 0.7 }, "PEAK");
        txt(svg, { x: 4, y: base, "font-size": 6, "font-weight": 700, fill: MUTED, opacity: 0.7 }, "0");
      }
    },
    [JSON.stringify(pts), height, showAxis]
  );
  return <svg ref={ref} viewBox={`0 0 ${VIEW_W} ${height}`} style={chartStyle(height)} role="img" />;
}

/* ═══════════════════════════════════════════════════════════════
   ④ DrawInCounter · 动线 + 大数
   ═══════════════════════════════════════════════════════════════ */
export function DrawInCounter({
  value, unit, label, spark,
}: {
  value: number; unit?: string; label: string; spark: number[];
}) {
  const [shown, setShown] = useState(0);
  const ref = useSvg(
    (svg) => {
      const W = 400, H = 30, pad = 2;
      const max = Math.max(...spark, 1);
      const pts = spark.length ? spark : [0];
      const xs = (i: number) => pad + (i / Math.max(pts.length - 1, 1)) * (W - pad * 2);
      const ys = (v: number) => H - 4 - (v / max) * (H - 10);
      const d = pts.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(" ");
      const path = el(svg, "path", { d, fill: "none", stroke: INK, "stroke-width": 1.4, "stroke-linecap": "round", "stroke-linejoin": "round" });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) {
        const len = (path as SVGPathElement).getTotalLength?.() || 600;
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        path.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.25,.8,.25,1)";
        requestAnimationFrame(() => requestAnimationFrame(() => { path.style.strokeDashoffset = "0"; }));
      }
      pts.forEach((v, i) => {
        if (i === pts.length - 1) el(svg, "circle", { cx: xs(i), cy: ys(v), r: 3, fill: INK });
      });
    },
    [JSON.stringify(spark)]
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 4);
      setShown(Math.round(value * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <div>
      <p className="text-[10px] font-bold tracking-widest text-content-muted uppercase">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[34px] leading-none font-extrabold text-content-primary font-mono tabular-nums">
          {shown.toLocaleString("en-US")}
        </span>
        {unit && <span className="text-xs text-content-muted">{unit}</span>}
      </p>
      <svg ref={ref} viewBox="0 0 400 30" className="w-full mt-2" style={{ height: 30, display: "block" }} role="img" aria-label="趋势" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ⑤ MultiLine · 多账号叠加（明度阶梯：越重要越黑）
   ═══════════════════════════════════════════════════════════════ */
const LADDER = ["var(--text-primary)", "#6A6963", "#8F8E88", "#B0AFA9", "#C6C5BF", "#D8D7D1"];

export function MultiLine({
  series, height = 96,
}: {
  series: Array<{ name: string; pts: Array<{ d: string; v: number }> }>;
  height?: number;
}) {
  const ref = useSvg(
    (svg) => {
      const padL = 58, padR = 20, Y0 = 20, H = height - 38;
      const base = Y0 + H;
      const W = 400 - padL - padR;
      const all = series.flatMap((s) => s.pts.map((p) => p.v));
      const max = Math.max(...all, 1);
      const n = Math.max(...series.map((s) => s.pts.length), 1);
      const xs = (i: number) => padL + (n <= 1 ? W / 2 : (i / (n - 1)) * W);
      const ys = (v: number) => base - (v / max) * H;
      el(svg, "line", { x1: padL, y1: Y0, x2: padL + W, y2: Y0, stroke: GRID, "stroke-width": 0.5, opacity: 0.5, "stroke-dasharray": "2 3" });
      el(svg, "line", { x1: padL, y1: base, x2: padL + W, y2: base, stroke: GRID, "stroke-width": 0.8 });
      series.forEach((s, si) => {
        if (s.pts.length === 0) return;
        const color = LADDER[Math.min(si, LADDER.length - 1)];
        const d = s.pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${ys(p.v).toFixed(1)}`).join(" ");
        el(svg, "path", { d, fill: "none", stroke: color, "stroke-width": si === 0 ? 1.5 : 1.1, "stroke-linejoin": "round", "stroke-linecap": "round" });
        s.pts.forEach((p, i) => {
          const isEnd = i === 0 || i === s.pts.length - 1;
          el(svg, "circle", { cx: xs(i), cy: ys(p.v), r: si === 0 ? (isEnd ? 2.8 : 2.1) : isEnd ? 2.2 : 1.7, fill: color });
        });
      });
      const labels = series[0]?.pts || [];
      labels.forEach((p, i) => {
        if (labels.length > 5 && i % 2 !== 0 && i !== labels.length - 1) return;
        txt(svg, { x: xs(i), y: base + 12, "font-size": 6.5, "font-weight": 700, fill: MUTED, "text-anchor": i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle" }, p.d);
      });
      txt(svg, { x: 4, y: Y0 + 3, "font-size": 6, "font-weight": 700, fill: MUTED, opacity: 0.7 }, String(max >= 1000 ? Math.round(max / 1000) + "k" : max));
      txt(svg, { x: 4, y: base, "font-size": 6, "font-weight": 700, fill: MUTED, opacity: 0.7 }, "0");
    },
    [JSON.stringify(series), height]
  );
  return <svg ref={ref} viewBox={`0 0 ${VIEW_W} ${height}`} style={chartStyle(height)} role="img" />;
}

export { LADDER };
