import clsx from "clsx";
import { ReactNode, useState } from "react";
import { useMeta } from "@/components/meta";
import { useDrill } from "@/components/DrillDrawer";
import { ColorKey, STATE_COLOR, STATE_LABEL, useChartColors } from "@/lib/colors";
import { fmtNum } from "@/lib/format";

export function Card({ title, sub, right, children, className, pad = true, id }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string;
}) {
  return (
    <section id={id} className={clsx("card flex flex-col min-w-0", className)}>
      {(title || right) && (
        <div className="card-head">
          <div className="min-w-0">
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
        </div>
      )}
      <div className={clsx("flex-1 min-w-0", pad && "px-4 pb-4")}>{children}</div>
    </section>
  );
}

export function PageHeader({ kicker, title, sub, right }: { kicker: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <div className="kicker">{kicker}</div>
        <h1 className="text-[30px] font-bold tracking-[-0.02em] leading-tight mt-1">{title}</h1>
        {sub && <p className="text-[16px] text-brand-gray mt-2 max-w-[820px] leading-relaxed">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** One plain-language sentence: what this page is telling you right now. */
export function Takeaway({ children }: { children: ReactNode }) {
  return (
    <div className="mb-6 rounded-xl border border-surface-border bg-surface-card px-5 py-4 text-[16px] leading-relaxed flex gap-3 items-start shadow-card">
      <span className="mt-1 w-2.5 h-2.5 rounded-full bg-brand-red shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Secondary charts and tables, collapsed until asked for. */
export function Details({ title = "More detail", hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-8">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full flex items-center gap-3 rounded-xl border border-surface-border bg-surface-card px-5 py-4 text-left hover:border-brand-lightgray transition shadow-card">
        <span className={clsx("w-7 h-7 rounded-full grid place-items-center bg-surface-mute text-[14px] font-bold transition-transform", open && "rotate-90")} aria-hidden>›</span>
        <span className="flex-1">
          <span className="block text-[17px] font-semibold">{title}</span>
          {hint && <span className="block text-[14px] text-brand-gray mt-0.5">{hint}</span>}
        </span>
        <span className="text-[14px] text-brand-gray">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="mt-5">{children}</div>}
    </section>
  );
}

/** Definition tooltip, sourced from the API's metric catalogue. */
export function InfoTip({ metric, text }: { metric?: string; text?: string }) {
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const def = metric ? meta.definitions?.metrics?.[metric] : null;
  const body = text || def?.definition;
  if (!body) return null;
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
      <button type="button" aria-label="Definition" onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="w-[18px] h-[18px] rounded-full border border-surface-ghost text-[12px] leading-[16px] text-brand-gray hover:text-brand-black">i</button>
      {open && (
        <span role="tooltip" className="absolute z-50 left-0 top-7 w-[min(20rem,80vw)] rounded-lg bg-surface-card border border-surface-border shadow-page p-3.5 text-[14px] text-brand-black normal-case tracking-normal font-normal text-left">
          {def?.label && <span className="block font-semibold mb-1">{def.label}</span>}
          <span className="block leading-snug">{body}</span>
        </span>
      )}
    </span>
  );
}

export function Sparkline({ values, color, w = 96, h = 26 }: { values: number[]; color: string; w?: number; h?: number }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const sx = (i: number) => (i / Math.max(1, values.length - 1)) * (w - 6) + 3;
  const sy = (v: number) => h - 4 - ((v - min) / Math.max(1, max - min)) * (h - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg width={w} height={h} aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={sx(last)} cy={sy(values[last])} r={3} fill={color} />
    </svg>
  );
}

export type Tone = "default" | "good" | "warn" | "serious" | "critical" | "info";

export function Kpi({ label, value, metric, sub, tone = "default", spark, onClick, big, unit }: {
  label: string; value: ReactNode; metric?: string; sub?: ReactNode; tone?: Tone; spark?: number[];
  onClick?: () => void; big?: boolean; unit?: string;
}) {
  const drill = useDrill();
  const c = useChartColors();
  const click = onClick ?? (metric && drill.has(metric) ? () => drill.open(metric, label) : undefined);
  // The ⓘ inside a clickable card must not trigger the card's drilldown.
  const toneBar = { default: "bg-surface-ghost", good: "bg-st-good", warn: "bg-st-warn", serious: "bg-st-serious", critical: "bg-st-critical", info: "bg-st-info" }[tone];
  const sparkColor = { default: c["series-1"], good: c.good, warn: c.warn, serious: c.serious, critical: c.critical, info: c["series-1"] }[tone];
  return (
    <div className={clsx("card relative px-5 py-4 group", click && "cursor-pointer hover:border-brand-lightgray transition")}
      onClick={click} role={click ? "button" : undefined} tabIndex={click ? 0 : undefined}
      onKeyDown={(e) => click && (e.key === "Enter" || e.key === " ") && click()}>
      <span className={clsx("absolute left-0 top-0 bottom-0 w-1 rounded-l-xl", toneBar)} />
      <div className="flex items-start gap-1.5 text-[15px] text-brand-gray font-medium leading-snug">
        <span>{label}</span>
        {metric && <InfoTip metric={metric} />}
      </div>
      <div className="flex items-end justify-between gap-2 mt-2">
        <div className={clsx("font-semibold tracking-[-0.02em] leading-none", big ? "text-[44px]" : "text-[38px]")}>
          {value}{unit && <span className="text-[15.5px] font-medium text-brand-gray ml-0.5">{unit}</span>}
        </div>
        {spark && spark.length > 1 && <Sparkline values={spark} color={sparkColor} />}
      </div>
      {sub && <div className="text-[14px] text-brand-gray mt-2 leading-snug">{sub}</div>}
      {click && <div className="absolute right-3 top-3 text-[12.5px] text-brand-lightgray opacity-0 group-hover:opacity-100 transition">View records →</div>}
    </div>
  );
}

const ICON: Record<string, string> = {
  good: "●", warn: "▲", serious: "◆", critical: "■", neutral: "○", muted: "‖", complete: "✓",
};
export function StatePill({ state, label }: { state: string; label?: string }) {
  const key = STATE_COLOR[state] || "neutral";
  const c = useChartColors();
  return (
    <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium whitespace-nowrap">
      <span aria-hidden style={{ color: c[key] }} className="text-[12px] leading-none">{ICON[key] || "●"}</span>
      <span>{label || STATE_LABEL[state] || state}</span>
    </span>
  );
}

/** Tall segmented bar: one whole split into parts (legend lists names in block order). */
export function SegmentedBar({ parts, onClick, height = 28 }: {
  parts: { key: string; label: string; value: number; color: string; ink?: string }[]; onClick?: (k: string) => void; height?: number;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <div className="flex w-full gap-[2px]" style={{ height }} role="img"
        aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p) => {
          const pct = (100 * p.value) / total;
          return (
            <button key={p.key} type="button" title={`${p.label}: ${p.value} (${Math.round(pct)}%)`}
              onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)} onClick={() => onClick?.(p.key)}
              className={clsx("rounded-[4px] relative transition-opacity text-left", hover && hover !== p.key && "opacity-60")}
              style={{ width: `${pct}%`, background: p.color, minWidth: 6 }}>
              {pct > 7 && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[13.5px] font-semibold" style={{ color: p.ink || "#fff" }}>{p.value}</span>}
            </button>
          );
        })}
      </div>
      <Legend items={parts.map((p) => ({ label: `${p.label} (${p.value})`, color: p.color }))} className="mt-2" />
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; shape?: "dot" | "line" | "square" }[]; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-brand-gray", className)}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.shape === "line" ? <span className="w-3.5 h-[2px] rounded" style={{ background: it.color }} />
            : <span className={clsx("w-2.5 h-2.5", it.shape === "square" ? "rounded-[2px]" : "rounded-full")} style={{ background: it.color }} />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse" aria-busy>
      {Array.from({ length: 8 }).map((_, i) => <div key={i} className="card h-[92px] bg-surface-mute/50" />)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="card p-4 border-st-critical/40">
      <div className="font-semibold text-[15.5px]">Could not load this view</div>
      <div className="text-[14px] text-brand-gray mt-1 break-all">{error}</div>
      <div className="text-[13.5px] text-brand-gray mt-1">Is the API running on :8000 and the pipeline loaded? See README → Quick start.</div>
      {retry && <button className="btn-ghost mt-3" onClick={retry}>Retry</button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-[14.5px] text-brand-gray py-6 text-center">{children}</div>;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "info" | "warn" | "critical" }) {
  const cls = {
    neutral: "bg-surface-mute text-brand-gray", good: "bg-st-good/15 text-brand-green", info: "bg-st-info/15 text-brand-deepblue", warn: "bg-st-warn/25 text-brand-deepgold", critical: "bg-st-critical/15 text-st-critical",
  }[tone];
  return <span className={clsx("inline-flex items-center px-2 py-0.5 rounded text-[12.5px] font-semibold whitespace-nowrap", cls)}>{children}</span>;
}

export function Num({ v, d = 0 }: { v?: number | null; d?: number }) {
  return <span className="num">{fmtNum(v, d)}</span>;
}

export function colorOf(c: Record<string, string>, key: ColorKey) {
  return c[key];
}
