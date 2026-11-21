import clsx from "clsx";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMeta } from "@/components/meta";
import { apiGet } from "@/lib/api";
import { DISCIPLINES } from "@/lib/colors";
import { useFilters } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { STATIC } from "@/lib/api";
import { decisionPath, DECISIONS } from "@/lib/decisions";

export const EXEC_PATH = STATIC ? "/overview" : "/";
export const START_PATH = STATIC ? "/" : "/start";

const NAV = [
  { group: "", items: [
    { to: START_PATH, label: "Start here" },
  ]},
  { group: "Decisions", items: DECISIONS.map((d) => ({ to: decisionPath(d), label: d.nav })) },
  { group: "Dashboards", items: [
    { to: EXEC_PATH, label: "Overview" },
    { to: "/delivery", label: "Schedule" },
    { to: "/capacity", label: "Team capacity" },
    { to: "/actions", label: "Action items" },
    { to: "/proposals", label: "Proposals" },
    { to: "/billables", label: "Billables" },
  ]},
  { group: "Behind the numbers", items: [
    { to: "/pipeline", label: "How the numbers come together" },
  ]},
];

export default function Layout() {
  const { pathname, search } = useLocation();
  const [dark, setDark] = useState(() => document.documentElement.getAttribute("data-theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("pmo-demo-theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [dark]);
  const showFilters = !["/pipeline", "/proposals", START_PATH].includes(pathname) && !pathname.startsWith("/decisions") && !pathname.startsWith("/projects");
  return (
    <div className="min-h-full flex">
      <aside className="hidden lg:block w-[248px] shrink-0 bg-surface-side border-r border-surface-border self-stretch">
       <div className="sticky top-0 h-screen flex flex-col">
        <Link to="/" className="px-6 pt-6 pb-5 block">
          <div className="text-[22px] font-bold tracking-[-0.01em]">PMO <span className="text-brand-red">360</span></div>
          <div className="text-[14.5px] text-brand-gray leading-tight mt-1">Operations analytics</div>
        </Link>
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-4">
          {NAV.map((g) => (
            <div key={g.group || "start"} className="mt-3 first:mt-0">
              {g.group && <div className="px-3 py-2 text-[12.5px] uppercase tracking-[0.1em] text-brand-lightgray font-semibold">{g.group}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={{ pathname: it.to, search }} end={it.to === "/" || it.to === EXEC_PATH}
                  className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2.5 rounded-lg text-[16px] transition border-l-[3px]",
                    isActive ? "bg-brand-red/[0.07] text-brand-black font-semibold border-brand-red" : "border-transparent text-brand-gray hover:bg-surface-mute hover:text-brand-black")}>
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="px-5 py-3 border-t border-surface-border flex items-center justify-end text-[14px] text-brand-gray">
          <button onClick={() => setDark(!dark)} className="px-2.5 py-1.5 rounded-md hover:bg-surface-mute" aria-label="Toggle theme">{dark ? "☀ Light mode" : "☾ Dark mode"}</button>
        </div>
       </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar showFilters={showFilters} />
        <main className="flex-1 px-4 sm:px-8 py-7 max-w-[1400px] w-full mx-auto min-w-0">
          <Outlet />
        </main>
        <footer className="px-8 py-5 text-[14px] text-brand-gray border-t border-surface-border">
          Invented data, generated for this demonstration. No client, project or person is real.
        </footer>
      </div>
    </div>
  );
}

function MobileNav() {
  const { pathname, search } = useLocation();
  const nav = useNavigate();
  const items = NAV.flatMap((g) => g.items);
  return (
    <div className="lg:hidden w-full flex items-center gap-2">
      <span className="font-bold text-[16.5px] shrink-0">PMO <span className="text-brand-red">360</span></span>
      <select className="input !w-auto flex-1 min-w-0" aria-label="Go to page" value={items.find((i) => i.to === pathname)?.to ?? ""}
        onChange={(e) => nav({ pathname: e.target.value, search })}>
        {!items.some((i) => i.to === pathname) && <option value="">Project detail</option>}
        {items.map((i) => <option key={i.to} value={i.to}>{i.label}</option>)}
      </select>
      <span className="shrink-0 rounded border border-[#b37a00]/50 bg-[#fab219]/15 px-1.5 py-0.5 text-[12.5px] font-semibold text-brand-deepgold">Synthetic data</span>
    </div>
  );
}

function TopBar({ showFilters }: { showFilters: boolean }) {
  const { meta } = useMeta();
  return (
    <header className="sticky top-0 z-40 bg-surface-page/95 backdrop-blur border-b border-surface-border">
      <div className="px-4 sm:px-8 py-3 flex items-center gap-3 flex-wrap">
        <MobileNav />
        <ProjectSearch />
        <div className="flex-1" />
        {meta && <Freshness meta={meta} />}
      </div>
      {showFilters && <FilterBar />}
    </header>
  );
}

function Freshness({ meta }: { meta: any }) {
  const [open, setOpen] = useState(false);
  const worst = meta.freshness.some((s: any) => s.freshness === "critical") ? "critical"
    : meta.freshness.some((s: any) => s.freshness === "stale") ? "stale" : "fresh";
  const stale = meta.freshness.filter((s: any) => s.freshness !== "fresh");
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen(!open)} onMouseEnter={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-surface-border bg-surface-card px-2.5 py-1.5 text-[14.5px]">
        <span className={clsx("w-2 h-2 rounded-full", worst === "fresh" ? "bg-st-good" : worst === "stale" ? "bg-st-warn" : "bg-st-critical")} />
        <span>Data as of <b>{fmtDate(meta.as_of)}</b></span>
        {stale.length > 0 && <span className="text-brand-gray">· {stale.length} source{stale.length > 1 ? "s" : ""} stale</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-[min(420px,92vw)] card p-3 z-50">
          <div className="text-[14.5px] font-semibold mb-2">Source freshness (last successful extract vs SLA)</div>
          {meta.freshness.map((s: any) => (
            <div key={s.key} className="flex items-center gap-2 py-1 text-[14.5px] border-t border-surface-hairline first:border-0">
              <span className={clsx("w-2 h-2 rounded-full shrink-0", s.freshness === "fresh" ? "bg-st-good" : s.freshness === "stale" ? "bg-st-warn" : "bg-st-critical")} />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="num text-brand-gray">{s.age_hours}h / {s.freshness_sla_hours}h</span>
              {s.last_status === "failed" && <span className="text-st-critical font-semibold">last run failed</span>}
            </div>
          ))}
          <Link to="/pipeline" className="link text-[14.5px] mt-2 inline-block">How the data flows →</Link>
        </div>
      )}
    </div>
  );
}

function ProjectSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q) { setRes([]); return; }
    const t = setTimeout(() => apiGet(`/projects?q=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative w-full sm:w-[340px]" ref={ref}>
      <input className="input pl-8" placeholder="Find a project, portfolio, client or job #" value={q} onChange={(e) => setQ(e.target.value)} />
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-lightgray text-[15.5px]">⌕</span>
      {res.length > 0 && (
        <div className="absolute left-0 right-0 top-9 card py-1 z-50 max-h-[360px] overflow-auto">
          {res.map((r) => (
            <button key={r.id} className="w-full text-left px-3 py-1.5 hover:bg-surface-rowhover" onClick={() => { setQ(""); nav(`/projects/${r.id}`); }}>
              <div className="text-[15.5px] font-medium">{r.name}</div>
              <div className="text-[14px] text-brand-gray">{r.portfolio_name} · {r.client_name} · {r.lifecycle}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterBar() {
  const { filters, set, clear, active } = useFilters();
  const { meta } = useMeta();
  if (!meta) return null;
  const portfolios = meta.portfolios.filter((p: any) => !filters.clients.length || filters.clients.includes(p.client_id));
  if (STATIC) {
    return (
      <div className="px-4 sm:px-8 pb-3 flex items-center gap-2 flex-wrap text-[15.5px]">
        <span className="text-brand-gray mr-1">Discipline</span>
        {["All", ...DISCIPLINES].map((d) => {
          const on = d === "All" ? filters.disciplines.length === 0 : filters.disciplines.length === 1 && filters.disciplines[0] === d;
          return <button key={d} onClick={() => set({ disciplines: d === "All" ? [] : [d] })}
            className={clsx("px-3.5 py-1.5 rounded-full border", on ? "bg-brand-black text-surface-card border-brand-black font-semibold" : "bg-surface-card border-surface-border text-brand-gray hover:text-brand-black")}>{d}</button>;
        })}
      </div>
    );
  }
  return (
    <div className="px-4 sm:px-6 pb-2.5 flex items-center gap-2 flex-wrap text-[15px]">
      <MultiSelect label="Client" options={meta.clients.map((c: any) => ({ v: c.id, l: c.name }))} value={filters.clients}
        onChange={(v) => set({ clients: v as number[], portfolios: [] })} />
      <MultiSelect label="Portfolio" options={portfolios.map((p: any) => ({ v: p.id, l: p.name, s: p.client_name }))} value={filters.portfolios}
        onChange={(v) => set({ portfolios: v as number[] })} />
      <MultiSelect label="Discipline" options={DISCIPLINES.map((d) => ({ v: d, l: d }))} value={filters.disciplines}
        onChange={(v) => set({ disciplines: v as string[] })} />
      <MultiSelect label="Project manager" options={meta.pms.map((p: any) => ({ v: p.id, l: p.name }))} value={filters.pms}
        onChange={(v) => set({ pms: v as number[] })} />
      <Seg label="Look-ahead" value={filters.lookahead_days} opts={[[14, "2 wk"], [28, "4 wk"], [56, "8 wk"], [84, "12 wk"]]} onChange={(v) => set({ lookahead_days: v })} />
      <Seg label="Trend" value={filters.trend_weeks} opts={[[13, "3 mo"], [26, "6 mo"], [52, "12 mo"]]} onChange={(v) => set({ trend_weeks: v })} />
      {active > 0 && <button className="text-brand-red hover:underline ml-1" onClick={clear}>Clear {active} filter{active > 1 ? "s" : ""}</button>}
    </div>
  );
}

function Seg({ label, value, opts, onChange }: { label: string; value: number; opts: [number, string][]; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-brand-gray">{label}</span>
      <div className="flex rounded-md border border-surface-border bg-surface-card overflow-hidden">
        {opts.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} className={clsx("px-2 py-1", value === v ? "bg-brand-black text-surface-card font-semibold" : "text-brand-gray hover:text-brand-black")}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function MultiSelect({ label, options, value, onChange }: {
  label: string; options: { v: number | string; l: string; s?: string }[]; value: (number | string)[]; onChange: (v: (number | string)[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const shown = options.filter((o) => !q || o.l.toLowerCase().includes(q.toLowerCase()) || o.s?.toLowerCase().includes(q.toLowerCase()));
  const summary = value.length === 0 ? "All" : value.length === 1 ? options.find((o) => o.v === value[0])?.l ?? "1" : `${value.length} selected`;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className={clsx("flex items-center gap-1.5 rounded-md border bg-surface-card px-2.5 py-1",
        value.length ? "border-brand-red/50" : "border-surface-border")}>
        <span className="text-brand-gray">{label}:</span><span className="font-semibold max-w-[160px] truncate">{summary}</span><span className="text-brand-lightgray">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-9 w-[300px] card p-2 z-50">
          {options.length > 8 && <input className="input mb-2" placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
          <div className="max-h-[300px] overflow-auto">
            {shown.map((o) => {
              const on = value.includes(o.v);
              return (
                <label key={String(o.v)} className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-surface-rowhover cursor-pointer">
                  <input type="checkbox" checked={on} className="mt-0.5 accent-[#ad1f2b]"
                    onChange={() => onChange(on ? value.filter((x) => x !== o.v) : [...value, o.v])} />
                  <span className="text-[15px] leading-tight">{o.l}{o.s && <span className="block text-[13.5px] text-brand-gray">{o.s}</span>}</span>
                </label>
              );
            })}
          </div>
          {value.length > 0 && <button className="link text-[14.5px] mt-1.5" onClick={() => onChange([])}>Clear</button>}
        </div>
      )}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="text-[14.5px] bg-surface-mute px-1 py-px rounded">{children}</code>;
}
