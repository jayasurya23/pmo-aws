import clsx from "clsx";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiGet, apiUrl, NO_DOWNLOAD, rowsToCsv, STATIC } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { StatePill } from "@/components/ui";

const DRILLABLE = new Set([
  "active_projects", "projects_on_track", "projects_at_risk", "projects_behind", "projects_unknown", "projects_on_hold",
  "late_milestones", "projected_late_milestones", "at_risk_milestones", "upcoming_milestones", "ifp_milestones",
  "overdue_deliverables", "blocked_work_items", "open_actions", "overdue_actions", "due_soon_actions",
  "no_due_date_actions", "unassigned_actions", "external_actions", "aged_60_actions", "missing_minutes",
  "overallocated_people", "unstaffed_bookings", "competing_projects", "co_backlog", "proposals_pipeline",
]);

interface DrillReq { metric: string; title: string; facets?: Record<string, string>; }
interface Ctx { open: (metric: string, title: string, facets?: Record<string, string>) => void; has: (m: string) => boolean; }
const DrillCtx = createContext<Ctx>({ open: () => {}, has: () => false });
export const useDrill = () => useContext(DrillCtx);

export function DrillProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<DrillReq | null>(null);
  const { pathname } = useLocation();
  useEffect(() => setReq(null), [pathname]); // following a link out of the drawer closes it
  const open = useCallback((metric: string, title: string, facets?: Record<string, string>) => setReq({ metric, title, facets }), []);
  const has = useCallback((m: string) => DRILLABLE.has(m), []);
  return (
    <DrillCtx.Provider value={{ open, has }}>
      {children}
      {req && <DrillDrawer req={req} onClose={() => setReq(null)} />}
    </DrillCtx.Provider>
  );
}

/** Column presets per row shape; anything else falls back to raw keys. */
const HIDE = new Set(["basis", "projects_by_week", "portfolio_id", "originating_meeting_id", "external_item_id",
  "source_extracted_at", "monday_status", "resource_id", "work_item_id", "resource_active", "is_placeholder"]);

function cell(k: string, v: any, row: any) {
  if (v === null || v === undefined || v === "") return <span className="text-brand-lightgray">—</span>;
  if (k === "health" || k === "status" && row.status_label === undefined && ["late", "on_track", "at_risk", "projected_late"].includes(v))
    return <StatePill state={v} />;
  if (k === "status_label") return <StatePill state={row.status} label={v} />;
  if ((k === "name" || k === "project_name" || k === "project") && (row.project_id || row.id) && !row.resource && !row.seniority)
    return <Link className="link font-medium" to={`/projects/${row.project_id ?? row.id}`}>{v}</Link>;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDate(v.slice(0, 10));
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" && /^\d{4}-/.test(x) ? fmtDate(x, "d MMM") : String(x))).join(", ");
  if (typeof v === "number") return <span className="num">{Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)}</span>;
  return String(v);
}

/** The columns shown by default for each record shape; "Show all columns" reveals the rest. */
const PRESETS: string[][] = [
  ["name", "client_name", "pm_name", "health", "next_milestone", "next_planned", "next_forecast", "worst_slip_bd"],
  ["text", "owner_name", "project_name", "due_date", "days_overdue", "age_days"],
  ["project_name", "stage", "planned_date", "forecast_date", "actual_date", "status_label", "slip_bd"],
  ["name", "project_name", "discipline", "blocked_reason", "days_blocked_bd", "assignee"],
  ["co_number", "title", "project_name", "status", "total_amount", "pending_bd"],
  ["resource", "discipline", "project", "weeks", "peak_pct"],
  ["subject", "meeting_date", "portfolio_name", "client_name"],
  ["name", "discipline", "title", "peak_pct", "over_weeks", "pto_conflict_weeks"],
  ["doc_number", "title", "project_name", "discipline", "planned_issue_date", "days_overdue_bd"],
  ["job_number", "title", "client_name", "status", "fee_total", "age_bd"],
  ["project_name", "discipline", "milestone", "start_date", "end_date"],
];
const LABELS: Record<string, string> = {
  name: "Name", client_name: "Client", pm_name: "Project manager", health: "Health", next_milestone: "Next milestone",
  next_planned: "Planned", next_forecast: "Projected", worst_slip_bd: "Worst slip (business days)", text: "Action",
  owner_name: "Owner", project_name: "Project", due_date: "Due", days_overdue: "Days overdue", age_days: "Age (days)",
  stage: "Milestone", planned_date: "Planned", forecast_date: "Projected", actual_date: "Issued", status_label: "Status",
  slip_bd: "Slip (business days)", blocked_reason: "Why blocked", days_blocked_bd: "Blocked for (business days)",
  assignee: "Assigned to", co_number: "CO #", title: "Title", total_amount: "Amount ($)", pending_bd: "Waiting (business days)",
  resource: "Person", project: "Project", weeks: "Over-allocated weeks", peak_pct: "Peak load (%)", subject: "Meeting",
  meeting_date: "Date", portfolio_name: "Portfolio", over_weeks: "Weeks over 110%", pto_conflict_weeks: "Booked during PTO",
  doc_number: "Document", planned_issue_date: "Planned issue", days_overdue_bd: "Overdue (business days)", job_number: "Job #",
  fee_total: "Fee ($)", age_bd: "Age (business days)", milestone: "Milestone", start_date: "Start", end_date: "End",
};
const label = (k: string) => LABELS[k] ?? k.replace(/_bd$/, " (business days)").replace(/_/g, " ").replace(/\bpct\b/, "%").replace(/^./, (c) => c.toUpperCase());

function DrillDrawer({ req, onClose }: { req: DrillReq; onClose: () => void }) {
  const { query } = useFilters();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [allCols, setAllCols] = useState(false);
  const pageSize = 25;
  const facetQs = useMemo(() => Object.entries(req.facets || {}).map(([k, v]) => `&facet_${k}=${encodeURIComponent(v)}`).join(""), [req.facets]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [debounced, req]);
  useEffect(() => {
    setErr(null);
    apiGet(`/drill/${req.metric}?${query}&page=${page}&page_size=${pageSize}${facetQs}${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`)
      .then(setData).catch((e) => setErr(String(e.message || e)));
  }, [req, query, page, debounced, facetQs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const keys = data?.rows?.length ? Object.keys(data.rows[0]) : [];
  const preset = PRESETS.find((p) => p.every((k) => keys.includes(k)));
  const every = keys.filter((k) => !HIDE.has(k) && !(k === "id" && data.rows[0].name));
  const cols = !allCols && preset ? preset : every;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <aside className="absolute right-0 top-0 bottom-0 w-[min(1080px,96vw)] bg-surface-card shadow-drawer flex flex-col" role="dialog" aria-label={req.title}>
        <div className="px-5 pt-4 pb-3 border-b border-surface-border">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="kicker">The records behind this number</div>
              <h2 className="text-[21px] font-bold">{req.title}{req.facets && Object.values(req.facets).length ? ` · ${Object.values(req.facets).join(" · ")}` : ""}</h2>
              {data?.definition && <p className="text-[16px] text-brand-gray mt-1 max-w-[760px] leading-relaxed">{data.definition.definition}</p>}
            </div>
            <button className="btn-ghost" onClick={onClose} aria-label="Close">Close ✕</button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <input className="input max-w-[320px]" placeholder="Search these records…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <span className="text-[15px] text-brand-gray">{data ? `${data.total.toLocaleString()} record${data.total === 1 ? "" : "s"}` : "…"}</span>
            {preset && <button className="text-[15px] link" onClick={() => setAllCols(!allCols)}>{allCols ? "Fewer columns" : `Show all ${every.length} columns`}</button>}
            {STATIC ? (
              <button className="btn-ghost ml-auto" onClick={async () => {
                const all = await apiGet(`/drill/${req.metric}?${query}&page=1&page_size=100000${facetQs}${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`);
                const csv = rowsToCsv(all.rows);
                if (NO_DOWNLOAD) {
                  try { await navigator.clipboard.writeText(csv); setCopied("Copied"); } catch { setCopied("Copy blocked by the browser"); }
                  setTimeout(() => setCopied(null), 1800);
                  return;
                }
                const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                const a = document.createElement("a"); a.href = url; a.download = `${req.metric}.csv`; a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}>{NO_DOWNLOAD ? (copied ?? "Copy as CSV") : "Export CSV"}</button>
            ) : (
              <a className="btn-ghost ml-auto" href={apiUrl(`/drill/${req.metric}?${query}&format=csv${facetQs}${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`)}>Export CSV</a>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {err && <div className="p-5 text-[15.5px] text-st-critical">{err}</div>}
          {data && data.rows.length === 0 && <div className="p-8 text-center text-brand-gray text-[15.5px]">No records match.</div>}
          {data && data.rows.length > 0 && (
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-card z-10 shadow-[0_1px_0_rgb(var(--surface-border))]">
                <tr>{cols.map((c) => <th key={c} className="th">{label(c)}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-surface-rowhover">
                    {cols.map((c) => <td key={c} className={clsx("td", ["text", "title", "detail", "blocked_reason"].includes(c) && "min-w-[260px]")}>{cell(c, r[c], r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-2.5 border-t border-surface-border flex items-center gap-2 text-[15px]">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="text-brand-gray">Page {page} of {pages}</span>
          <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      </aside>
    </div>
  );
}
