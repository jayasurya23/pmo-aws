import { Fragment } from "react";
import { Card, ErrorBox, Loading, PageHeader, Tag } from "@/components/ui";
import { useMeta } from "@/components/meta";
import { useApi } from "@/lib/api";

const STAGES = [
  { k: "src", t: "External sources", d: "Monday boards (GraphQL), Outlook calendar (Graph), deliverable register (CSV), PMO 360 and proposal360 tables" },
  { k: "ing", t: "Ingest & stage", d: "Every record stored as received: JSONB payload + sha256, tied to a sync run" },
  { k: "val", t: "Validate", d: "Schema check, identity match, de-duplication, field rules; problems become exception rows" },
  { k: "norm", t: "Normalise", d: "Status labels → common vocabulary, timestamps → UTC, dates parsed, unknown kept as NULL" },
  { k: "pg", t: "PostgreSQL core", d: "PMO 360 schema (clients → portfolios → projects) + work, deliverables, capacity, meetings" },
  { k: "api", t: "Aggregate & serve", d: "FastAPI: one SQL row set per grain; KPI = COUNT of the drilldown rows" },
  { k: "ui", t: "React dashboards", d: "Six views, filters in the URL, every number drills to its records" },
];

export default function Pipeline() {
  const q = useApi(`/quality`);
  const sm = useApi(`/pipeline/status-map`);
  const { meta } = useMeta();
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || !sm.data || !meta) return <Loading />;
  const d = q.data;
  const counts = meta.counts;
  const statusGroups: Record<string, string[]> = {};
  sm.data.status_map.filter((r: any) => r.source_key === "monday_work_board").forEach((r: any) => (statusGroups[r.normalized_status] ||= []).push(r.label_key));
  const stat: Record<string, string> = {
    src: `${d.freshness.length} sources`, ing: `${d.kpis.staged.toLocaleString()} records staged`,
    val: `${d.kpis.open} exceptions (${d.kpis.errors} errors)`, norm: `${sm.data.status_map.length} label mappings · ${d.id_map.reduce((a: number, r: any) => a + r.n, 0)} id links`,
    pg: `${counts.projects} projects · ${counts.work_items.toLocaleString()} work packages · ${counts.action_items.toLocaleString()} actions`,
    api: "9 dashboard endpoints · 26 drilldowns", ui: "6 dashboards + project drilldown",
  };
  return (
    <div>
      <PageHeader kicker="Case study · what did you have to do to the underlying data?" title="How the data flows"
        sub="External source → ingestion → validation → normalisation → PostgreSQL → aggregation/API → React. Live counts from the last pipeline run (python -m pipeline.run --reset)." />
      <div className="flex flex-wrap xl:flex-nowrap items-stretch gap-1.5">
        {STAGES.map((s, i) => (
          <Fragment key={s.k}>
            <div className="card px-3 py-3 flex-1 min-w-[150px]">
              <div className="micro">Step {i + 1}</div>
              <div className="text-[14px] font-bold mt-0.5">{s.t}</div>
              <div className="text-[11.5px] text-brand-gray mt-1 leading-snug">{s.d}</div>
              <div className="text-[12px] font-semibold mt-2 text-brand-red">{stat[s.k]}</div>
            </div>
            {i < STAGES.length - 1 && <div className="hidden xl:grid place-items-center text-brand-lightgray text-[18px]">→</div>}
          </Fragment>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="1 · Status normalisation: five teams, one vocabulary" sub="Configuration (status_map table), not code. A new label becomes an UNMAPPED_STATUS exception and loads as 'unknown' — never silently guessed.">
          <table className="w-full"><thead><tr><th className="th">Common status</th><th className="th">Monday labels mapped to it</th></tr></thead>
            <tbody>{Object.entries(statusGroups).map(([k, v]) => (
              <tr key={k}><td className="td font-semibold">{k.replace("_", " ")}</td><td className="td"><div className="flex flex-wrap gap-1">{v.map((l) => <code key={l} className="text-[11.5px] bg-surface-mute px-1.5 rounded">{l}</code>)}</div></td></tr>))}</tbody></table>
        </Card>
        <Card title="2 · Identity: matching external ids to PMO 360 projects" sub="Ported from the production Monday sync: exact normalised names only, a confirmed manual crosswalk, everything else an exception">
          <ol className="text-[12.5px] space-y-2 list-decimal pl-4">
            <li><b>Confirmed manual link</b> on the Monday relation's linked item id (id_map, match_method = manual) — e.g. a project renamed in Monday with a "(Phase 1)" suffix.</li>
            <li><b>Exact normalised name</b>: <code className="bg-surface-mute px-1 rounded text-[11.5px]">re.sub(r"[^a-z0-9]", "", name.lower())</code> — so "Solar + Storage" and "Solar &amp; Storage" match, but "Owl Creek 1" never matches "Owl Creek (1 &amp; 2)".</li>
            <li><b>Otherwise reject</b> with MISSING_PROJECT_REF — a wrong match files work against another client's project; an exception costs a minute of someone's time.</li>
          </ol>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">{d.id_map.map((r: any, i: number) => (
            <div key={i} className="rounded-md border border-surface-border py-2"><div className="text-[18px] font-semibold num">{r.n}</div><div className="text-[11px] text-brand-gray">{r.source_key.replace(/_/g, " ")} · {r.match_method}</div></div>))}</div>
        </Card>
        <Card title="3 · Avoiding double counting" sub="Each metric has one grain and one system of record">
          <ul className="text-[12.5px] space-y-1.5 list-disc pl-4">
            <li><b>Duplicate Monday items</b> (same project + discipline + stage): keep the most recently updated; the others are staged as <code>duplicate</code> and reported. A unique constraint on the natural key makes a second copy impossible to load.</li>
            <li><b>Two sources, one fact</b>: Monday and the register both describe a deliverable. Hours come only from Monday; "issued" only from the register; disagreement is a STATUS_CONFLICT, not a second count.</li>
            <li><b>Split bookings</b>: utilisation is SUMmed per work item in a GROUP BY before joining, so a package with two bars is one row, not two.</li>
            <li><b>Multi-owner actions</b> count once in every total; ownership is resolved to one person or flagged.</li>
          </ul>
        </Card>
        <Card title="4 · Dates, time zones and unknowns" sub="The small rules that decide whether a number can be trusted">
          <ul className="text-[12.5px] space-y-1.5 list-disc pl-4">
            <li>Monday timestamps arrive as <code>…Z</code>, <code>…-05:00</code> and <code>YYYY-MM-DD HH:MM:SS+00:00</code>; Graph returns Windows zone names ("Eastern Standard Time"). All stored as UTC; business dates evaluated in America/New_York.</li>
            <li>Register dates arrive as ISO, <code>11/13/2026</code> and <code>13-Nov-2026</code>; anything else → DATE_UNPARSEABLE and NULL, visible.</li>
            <li><b>Planned, baseline and actual are separate columns.</b> Projections are computed at read time and never written over them.</li>
            <li><b>Missing is unknown, never zero</b>: no actual hours → excluded from variance and counted; no due date → not overdue, reported separately; no work data → health "Unknown", never "On track".</li>
          </ul>
        </Card>
        <Card title="5 · When a source breaks" sub="Schema drift on the deliverable register (a column renamed in the export template)">
          <p className="text-[12.5px]">The pipeline checks every expected column before reading a row. On {d.freshness.find((s: any) => s.key === "deliverable_register")?.last_message ? "the latest run" : "a run"} the register arrived with <code>Issued On</code> instead of <code>Actual Issue</code>: the whole file was refused, the previous good extract kept, and freshness turned red. Loading it would have made every deliverable look un-issued — inflating "overdue deliverables" overnight.</p>
          <p className="text-[12.5px] mt-2">Freshness is measured from the last <b>successful</b> extract, so a failed run can never make stale data look fresh. <Tag tone="demo">demo scenario</Tag></p>
        </Card>
        <Card title="6 · How the dashboard SQL is built" sub="Grain first, then filters, then aggregation — the same row set for the card and the drilldown">
          <pre className="text-[11px] bg-surface-mute/50 rounded-md p-3 overflow-auto leading-snug">{`-- actions: one row per action item, point-in-time at :as_of
WITH a AS (SELECT ai.*, (ai.created_at AT TIME ZONE 'America/New_York')::date AS created_d,
         (COALESCE(ai.last_status_change, ai.updated_at, ai.created_at)
            AT TIME ZONE 'America/New_York')::date AS closed_d
       FROM action_items ai JOIN projects pf ON pf.id = ai.project_id
       WHERE <shared project scope: portfolio / client / PM / discipline>),
s AS (SELECT a.*, (created_d <= :as_of AND (status IN ('open','pending')
                   OR closed_d > :as_of)) AS is_open FROM a)
SELECT COUNT(*) FILTER (WHERE is_open)                         AS open_actions,
       COUNT(*) FILTER (WHERE is_open AND due_date < :as_of)   AS overdue_actions
FROM s;   -- the drilldown selects rows FROM s WHERE <same predicate>`}</pre>
        </Card>
      </div>
    </div>
  );
}
