import { useEffect, useState } from "react";
import { Card, CountUp, Details, ErrorBox, Kpi, Loading, PageHeader } from "@/components/ui";
import { useMeta } from "@/components/meta";
import { useApi } from "@/lib/api";

/** Plain-language view of how the numbers are put together, for any reader.
 *  The technical detail sits in a collapsed section at the bottom. */
export default function Pipeline() {
  const q = useApi(`/quality`);
  const sm = useApi(`/pipeline/status-map`);
  const { meta } = useMeta();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 4), 2600);
    return () => clearInterval(t);
  }, []);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || !sm.data || !meta) return <Loading />;
  const d = q.data, k = d.kpis;
  const failed = d.freshness.filter((s: any) => s.last_status === "failed");
  const groups: Record<string, string[]> = {};
  sm.data.status_map.filter((r: any) => r.source_key === "monday_work_board")
    .forEach((r: any) => (groups[r.normalized_status] ||= []).push(r.label_key));
  const examples = Object.entries(groups).filter(([, v]) => v.length > 1).slice(0, 4);

  const STEPS = [
    { t: "Collect", icon: "⤓", d: "Project and sales boards in Monday.com (through its API), meetings in Outlook, and the document register.", n: `${d.freshness.length} sources` },
    { t: "Check", icon: "✓", d: "Every record is checked. Problems are flagged for someone to fix, never quietly dropped.", n: `${k.open.toLocaleString()} flagged, ${k.rejected} refused` },
    { t: "Standardise", icon: "≡", d: "Each team's status words become one set, dates line up, and anything missing stays visibly missing.", n: `${sm.data.status_map.length} status words mapped` },
    { t: "Report", icon: "▦", d: "Dashboards for each role. Every number opens the list of records behind it.", n: `${meta.counts.projects} projects` },
  ];

  return (
    <div>
      <PageHeader kicker="The story · what did you have to do to the data?" title="How the numbers come together"
        sub="Project information lived in several tools that did not agree with each other. This is how it was brought into one place people could trust." />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {STEPS.map((s, i) => (
          <button key={s.t} onClick={() => setStep(i)} className={`relative text-left card p-5 transition-all duration-500 anim-rise ${step === i ? "ring-2 ring-brand-red/40 -translate-y-1 shadow-page" : ""}`}
            style={{ animationDelay: `${i * 120}ms` }}>
            <div className="flex items-center gap-3">
              <span className={`w-11 h-11 rounded-full grid place-items-center text-[20px] font-bold transition-colors duration-500 ${step === i ? "bg-brand-red text-white" : "bg-surface-mute text-brand-gray"}`}>{s.icon}</span>
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-[0.1em] text-brand-gray">Step {i + 1}</div>
                <div className="text-[20px] font-bold leading-tight">{s.t}</div>
              </div>
            </div>
            <p className="text-[16px] text-brand-gray mt-3 leading-snug">{s.d}</p>
            <div className="text-[16px] font-semibold text-brand-red mt-3">{s.n}</div>
            {i < 3 && <span className="hidden xl:grid absolute -right-[14px] top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-surface-card border border-surface-border place-items-center text-brand-gray">›</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        <Card title="One set of status words" sub="Each team wrote status its own way. These all now mean the same thing.">
          <div className="space-y-3">
            {examples.map(([norm, labels], i) => (
              <div key={norm} className="flex flex-wrap items-center gap-2 anim-rise" style={{ animationDelay: `${200 + i * 120}ms` }}>
                {labels.slice(0, 4).map((l) => <span key={l} className="px-2.5 py-1 rounded-md bg-surface-mute text-[15px]">“{l}”</span>)}
                <span className="text-brand-lightgray text-[18px] px-1">→</span>
                <span className="px-3 py-1 rounded-md bg-brand-red/10 text-brand-red text-[15px] font-semibold">{norm.replace("_", " ")}</span>
              </div>
            ))}
          </div>
          <p className="text-[15px] text-brand-gray mt-4">A word nobody has seen before is flagged and shown as “unknown”. It is never guessed.</p>
        </Card>

        <Card title="When a source breaks" sub="What happens when one of the tools sends bad data">
          <p className="text-[16px] leading-relaxed">
            The sales team tracks proposals in a Monday.com CRM board, pulled in through Monday's API. In this demo, someone renames
            the board's stage column, so the next sync comes back with no stage on any proposal. Loading it would have emptied the
            proposal pipeline overnight. Instead the sync is refused, the last good data is kept, and the source is marked out of
            date for everyone to see.
          </p>
          {failed.map((s: any) => (
            <div key={s.key} className="mt-4 flex items-center gap-3 rounded-lg border border-st-critical/40 bg-st-critical/5 px-4 py-3 text-[15px]">
              <span className="w-2.5 h-2.5 rounded-full bg-st-critical anim-pulse" />
              <span><b>{s.name}</b>: last sync refused; showing data from {s.age_hours} hours ago.</span>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
        <Kpi label="Records received" value={k.staged} sub="each kept exactly as it arrived" />
        <Kpi label="Flagged for review" value={k.open} tone="warn" sub="shown, not hidden" />
        <Kpi label="Refused" value={k.rejected} tone="critical" sub="could not be matched safely" />
        <Kpi label="Sources up to date" value={`${d.freshness.length - k.stale_sources} of ${d.freshness.length}`} tone={k.stale_sources ? "warn" : "good"} />
      </div>

      <Details title="For technical readers" hint="The stack, how records are matched, how double counting is avoided, and the SQL behind a number">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Stack and flow">
            <ul className="text-[15.5px] space-y-2 list-disc pl-5 leading-snug">
              <li>FastAPI and PostgreSQL behind a React and TypeScript front end; the same stack as PMO 360.</li>
              <li>Every source record is staged as received (JSON with a hash), validated against <CountUp value={sm.data.rules?.length ?? 24} /> rules, normalised, then loaded.</li>
              <li>Each headline number is a count of exactly the rows its drilldown lists; automated tests check both against an independent SQL count.</li>
            </ul>
          </Card>
          <Card title="Matching records to projects">
            <ol className="text-[15.5px] space-y-2 list-decimal pl-5 leading-snug">
              <li>The project ID (job number) is the primary key across every system, checked against its format; a mismatch between systems is flagged, never overwritten.</li>
              <li>A confirmed manual link, for example a project renamed with a “(Phase 1)” suffix.</li>
              <li>In this demo some invented sources carry only names, so they fall back to an exact name match after removing case and punctuation: <code className="bg-surface-mute px-1 rounded text-[14px]">re.sub(r"[^a-z0-9]", "", name.lower())</code>. Anything else is flagged; a wrong match files work against another client's project.</li>
            </ol>
          </Card>
          <Card title="Avoiding double counting">
            <ul className="text-[15.5px] space-y-2 list-disc pl-5 leading-snug">
              <li>Duplicate board items keep the latest; a unique key makes a second copy impossible to load.</li>
              <li>Two sources, one fact: hours come only from the work board, “issued” only from the register; disagreement is flagged, not counted twice.</li>
              <li>Split bookings are summed per work package before joining.</li>
            </ul>
          </Card>
          <Card title="The SQL behind a dashboard number">
            <pre className="text-[13.5px] bg-surface-mute/50 rounded-md p-3 overflow-auto leading-snug">{`WITH s AS (
  SELECT a.*, (created_d <= :as_of AND (status IN ('open','pending')
               OR closed_d > :as_of)) AS is_open
  FROM action_items a WHERE <shared project scope>)
SELECT COUNT(*) FILTER (WHERE is_open)                       AS open_actions,
       COUNT(*) FILTER (WHERE is_open AND due_date < :as_of) AS overdue_actions
FROM s;  -- the drilldown lists FROM s WHERE <same condition>`}</pre>
          </Card>
        </div>
      </Details>
    </div>
  );
}
