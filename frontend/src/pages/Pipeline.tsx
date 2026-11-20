import { Fragment } from "react";
import { Card, Details, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useMeta } from "@/components/meta";
import { useApi } from "@/lib/api";

const STAGES = [
  { k: "src", t: "External sources", d: "Monday.com boards, the Outlook calendar, the deliverable register (CSV), and the project and proposal tables" },
  { k: "ing", t: "Ingest & stage", d: "Every record stored exactly as received, with a fingerprint, tied to its load run" },
  { k: "val", t: "Validate", d: "Expected columns, record matching, duplicates and field rules; problems are flagged, not dropped" },
  { k: "norm", t: "Normalise", d: "Status labels to one vocabulary, timestamps to UTC, dates parsed, unknown kept as unknown" },
  { k: "pg", t: "PostgreSQL core", d: "Clients, portfolios and projects, plus work, deliverables, staffing and meetings" },
  { k: "api", t: "Aggregate & serve", d: "FastAPI: each headline number is a count of the same rows its drilldown lists" },
  { k: "ui", t: "React dashboards", d: "Six dashboards; every number opens its records" },
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
      <PageHeader kicker="The story · what did you have to do to the data?" title="How the data flows"
        sub="From each source system to the dashboards, in seven steps. The counts are from the latest run." />
      <div className="flex flex-wrap 2xl:flex-nowrap items-stretch gap-1.5">
        {STAGES.map((s, i) => (
          <Fragment key={s.k}>
            <div className="card px-4 py-4 flex-1 min-w-[150px]">
              <div className="micro">Step {i + 1}</div>
              <div className="text-[15.5px] font-bold mt-0.5">{s.t}</div>
              <div className="text-[14px] text-brand-gray mt-1.5 leading-snug">{s.d}</div>
              <div className="text-[14px] font-semibold mt-2.5 text-brand-red">{stat[s.k]}</div>
            </div>
            {i < STAGES.length - 1 && <div className="hidden 2xl:grid place-items-center text-brand-lightgray text-[18px]">→</div>}
          </Fragment>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        <Card title="1 · Status labels: three teams, one vocabulary" sub="A lookup table, not code. A new label is flagged and loads as “unknown”, never guessed.">
          <table className="w-full"><thead><tr><th className="th">Common status</th><th className="th">Labels mapped to it</th></tr></thead>
            <tbody>{Object.entries(statusGroups).map(([k, v]) => (
              <tr key={k}><td className="td font-semibold">{k.replace("_", " ")}</td><td className="td"><div className="flex flex-wrap gap-1">{v.map((l) => <code key={l} className="text-[13px] bg-surface-mute px-1.5 rounded">{l}</code>)}</div></td></tr>))}</tbody></table>
        </Card>
        <Card title="2 · Matching records to the right project" sub="Exact names only, or a confirmed manual link. Everything else is flagged.">
          <ol className="text-[15px] space-y-2.5 list-decimal pl-5 leading-snug">
            <li><b>Confirmed manual link</b>, for example a project renamed in Monday.com with a “(Phase 1)” suffix.</li>
            <li><b>Exact normalised name</b>: <code className="bg-surface-mute px-1 rounded text-[13px]">re.sub(r"[^a-z0-9]", "", name.lower())</code> — so "Solar + Storage" and "Solar &amp; Storage" match, but "Owl Creek 1" never matches "Owl Creek (1 &amp; 2)".</li>
            <li><b>Otherwise flag it.</b> A wrong match files work against another client's project; a flag costs someone a minute.</li>
          </ol>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">{d.id_map.map((r: any, i: number) => (
            <div key={i} className="rounded-md border border-surface-border py-2"><div className="text-[18px] font-semibold num">{r.n}</div><div className="text-[13px] text-brand-gray">{r.source_key.replace(/_/g, " ")} · {r.match_method === "manual" ? "manual link" : "exact name"}</div></div>))}</div>
        </Card>
        <Card className="xl:col-span-2" title="3 · When a source breaks" sub="Schema drift on the deliverable register (a column renamed in the export template)">
          <p className="text-[15px] leading-relaxed">The pipeline checks every expected column before reading a row. On {d.freshness.find((s: any) => s.key === "deliverable_register")?.last_message ? "the latest run" : "a run"} the register arrived with <code>Issued On</code> instead of <code>Actual Issue</code>: the whole file was refused, the previous good extract kept, and freshness turned red. Loading it would have made every deliverable look un-issued — inflating "overdue deliverables" overnight.</p>
          <p className="text-[15px] mt-3 leading-relaxed">Freshness is measured from the last <b>successful</b> load, so a failed run can never make old data look fresh.</p>
        </Card>
      </div>
      <Details hint="Double counting, dates and time zones, and the SQL behind a dashboard number">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Avoiding double counting" sub="Each metric has one grain and one system of record">
          <ul className="text-[15px] space-y-2 list-disc pl-5 leading-snug">
            <li><b>Duplicate Monday items</b> (same project + discipline + stage): keep the most recently updated; the others are staged as <code>duplicate</code> and reported. A unique constraint on the natural key makes a second copy impossible to load.</li>
            <li><b>Two sources, one fact</b>: Monday and the register both describe a deliverable. Hours come only from Monday; "issued" only from the register; disagreement is a STATUS_CONFLICT, not a second count.</li>
            <li><b>Split bookings</b>: utilisation is SUMmed per work item in a GROUP BY before joining, so a package with two bars is one row, not two.</li>
            <li><b>Multi-owner actions</b> count once in every total; ownership is resolved to one person or flagged.</li>
          </ul>
        </Card>
        <Card title="Dates, time zones and unknowns" sub="The small rules that decide whether a number can be trusted">
          <ul className="text-[15px] space-y-2 list-disc pl-5 leading-snug">
            <li>Monday timestamps arrive as <code>…Z</code>, <code>…-05:00</code> and <code>YYYY-MM-DD HH:MM:SS+00:00</code>; Graph returns Windows zone names ("Eastern Standard Time"). All stored as UTC; business dates evaluated in America/New_York.</li>
            <li>Register dates arrive as ISO, <code>11/13/2026</code> and <code>13-Nov-2026</code>; anything else → DATE_UNPARSEABLE and NULL, visible.</li>
            <li><b>Planned, baseline and actual are separate columns.</b> Projections are computed at read time and never written over them.</li>
            <li><b>Missing is unknown, never zero</b>: no actual hours → excluded from variance and counted; no due date → not overdue, reported separately; no work data → health "Unknown", never "On track".</li>
          </ul>
        </Card>
        <Card className="xl:col-span-2" title="How the dashboard SQL is built" sub="The same rows feed the headline number and its drilldown">
          <pre className="text-[12.5px] bg-surface-mute/50 rounded-md p-3 overflow-auto leading-snug">{`-- actions: one row per action item, point-in-time at :as_of
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
      </Details>
    </div>
  );
}
