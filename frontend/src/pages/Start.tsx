import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { EXEC_PATH } from "@/components/Layout";
import { Tag } from "@/components/ui";
import { STATIC, useApi } from "@/lib/api";

/** Landing page for someone exploring the site on their own: answers the three
 *  case-study questions in plain language, each with links to the views that
 *  show the evidence. Numbers come from the same data as the dashboards. */
export default function Start() {
  const scen = useApi<any[]>("/scenarios");
  const q = useApi<any>("/quality");
  const ex = useApi<any>("/executive");
  const outcomes = useApi<any>(STATIC ? "/scenarios/outcomes" : null);
  const cedar = useApi<any[]>("/projects?q=Cedar%20Hollow");
  const cedarPath = cedar.data?.[0] ? `/projects/${cedar.data[0].id}` : "/delivery";
  const o1 = outcomes.data?.s1, o2 = outcomes.data?.s2;
  const s1 = scen.data?.find((s) => s.key === "s1");
  const s2 = scen.data?.find((s) => s.key === "s2");
  const k = ex.data?.kpis;
  const dq = q.data?.kpis;
  return (
    <div className="max-w-[1180px]">
      <div className="kicker">Case study · Option 1 — a dashboard built end-to-end</div>
      <h1 className="text-[30px] font-bold tracking-[-0.02em] leading-tight mt-1">PMO 360 operations analytics</h1>
      <p className="text-[14.5px] text-brand-gray mt-2 max-w-[860px] leading-relaxed">
        PMO 360 is the project-operations platform I designed and built at Castillo Engineering (utility-scale solar, battery storage and
        substation design). This site is a working rebuild of its dashboards on the same stack — <b>FastAPI · PostgreSQL · React</b> — with the
        same data model and rules, running on <b>invented data</b> so it can be shared. Every number below and in the dashboards is computed
        from records you can open.
      </p>
      <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-md border border-[#b37a00]/40 bg-[#fab219]/10 px-3 py-2 text-[12.5px]">
        <b>Synthetic Demonstration Data.</b> No client, project or employee is real. Labels show what is <Tag tone="prod">Production</Tag>
        in the real system, <Tag tone="adapted">Adapted</Tag> from it, or <Tag tone="demo">Demo-only</Tag>.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-5">
        <Question n={1} q="Who used it?" a="Project managers, the PM lead and leadership, department leads planning staff, and approvers.">
          <Row to="/actions" label="Project managers" hint="What do I owe, to whom, by when — open, overdue, undated" />
          <Row to={EXEC_PATH} label="PM lead and leadership" hint="Which portfolios are slipping, worst first" />
          <Row to="/capacity" label="Department leads" hint="Who is free to take which milestone, week by week" />
          <Row to="/commercial" label="Commercial and approvers" hint="Proposals, change-order backlog and approvals" />
        </Question>
        <Question n={2} q="What decision did it change?" a="Where follow-up and staffing effort goes each week — and how early the team acts.">
          <div className="rounded-md border border-surface-border p-3">
            <div className="text-[12px] font-semibold">Capacity: four substation projects all read “on track”…</div>
            <div className="text-[12px] text-brand-gray mt-0.5">…but three senior engineers carry all their design work. Re-staffing takes their over-allocated person-weeks
              {s1 ? <> from <b className="text-brand-black">{(s1.before ?? s1.current).senior_over_person_weeks}</b>{(o1 || s1.applied) && <> to <b className="text-brand-black">{(o1 ?? s1.current).senior_over_person_weeks}</b></>}</> : null}.</div>
          </div>
          <div className="rounded-md border border-surface-border p-3">
            <div className="text-[12px] font-semibold">Schedule: a blocked structural package threatens the next milestone</div>
            <div className="text-[12px] text-brand-gray mt-0.5">The IFC projection is {s2 ? <b className="text-brand-black">{(s2.before ?? s2.current).ifc_slip_bd} business days late</b> : "late"}; proceeding on an assumed design with a second engineer brings it back inside tolerance{o2 ? <> ({o2.ifc_slip_bd} business days)</> : null}.</div>
          </div>
          <Link to="/scenarios" className="btn-primary w-full mt-1">Try both decisions →</Link>
        </Question>
        <Question n={3} q="What did you do to the data?" a="Joined systems that disagree, standardised them, and proved the numbers reconcile.">
          <ol className="text-[12.5px] space-y-1.5 list-decimal pl-4">
            <li><b>Identity</b> across Monday, Outlook, the register and the app — exact matches only, everything else reported, never guessed.</li>
            <li><b>Standardise</b>: five teams' status labels → one vocabulary; all timestamps to UTC.</li>
            <li><b>Unknown is never zero</b>: missing hours or dates stay visible as unknown.</li>
            <li><b>Validate and keep the raw record</b>{dq ? <>: {dq.staged.toLocaleString()} records staged, {dq.open} exceptions logged</> : null}.</li>
            <li><b>Reconcile</b>: every KPI equals its drilldown and an independent SQL count (tested).</li>
          </ol>
          <div className="flex gap-2 mt-1">
            <Link to="/pipeline" className="btn-ghost flex-1">Data flow →</Link>
            <Link to="/quality" className="btn-ghost flex-1">Data quality →</Link>
          </div>
        </Question>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mt-3">
        <section className="card p-4 lg:col-span-3">
          <h2 className="card-title">A three-minute path through the site</h2>
          <ol className="mt-2 space-y-2.5 text-[13px]">
            <Step n={1} to={EXEC_PATH} title="Executive overview">{k ? <>{k.active_projects} active projects: {k.projects_on_track} on track, {k.projects_at_risk} at risk, {k.projects_behind} behind.</> : "Portfolio health at a glance."} Hover any <span className="px-1 border rounded text-[11px]">i</span> for the metric's definition; click any number for its records.</Step>
            <Step n={2} to={cedarPath} title="One project, end to end">Cedar Hollow: the 90% milestone is already late, IFC is projected late, and the page shows why — a blocked package, an unassigned action, and the projection's inputs.</Step>
            <Step n={3} to="/capacity?disciplines=Substation" title="Capacity, Substation">The heatmap shows three seniors above 110% for weeks while the projects still look healthy.</Step>
            <Step n={4} to="/scenarios" title="Decision scenarios">Apply each decision and read the before/after — including the trade-off it creates.</Step>
            <Step n={5} to="/quality" title="Data quality">A broken source file refused, freshness against SLAs, and any exception traced to its raw payload.</Step>
          </ol>
        </section>
        <section className="card p-4 lg:col-span-2">
          <h2 className="card-title">What is real and what is demo</h2>
          <ul className="mt-2 space-y-1.5 text-[12.5px]">
            <li><Tag tone="prod">Production</Tag> Client → portfolio → project model, meetings and rolling actions, the overdue and ownership rules, the lead view, the Timeline capacity board.</li>
            <li><Tag tone="adapted">Adapted</Tag> The Monday.com sync (read-only, exact matching) and Outlook calendar matching, run here on local files.</li>
            <li><Tag tone="demo">Demo-only</Tag> Milestone projections, the deliverable register, the data-quality layer, the scenarios.</li>
          </ul>
          <Link to="/about" className="link text-[12.5px] mt-3 inline-block">Full provenance →</Link>
          <p className="text-[11.5px] text-brand-gray mt-3">Built by Jayasurya. The production platform and its data stay private; this rebuild is shared with that in mind.</p>
        </section>
      </div>
    </div>
  );
}

function Question({ n, q, a, children }: { n: number; q: string; a: string; children: ReactNode }) {
  return (
    <section className="card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-brand-red text-white text-[12px] font-bold grid place-items-center">{n}</span>
        <h2 className="text-[16px] font-bold">{q}</h2>
      </div>
      <p className="text-[13px] text-brand-black leading-snug">{a}</p>
      <div className="flex flex-col gap-2 mt-1">{children}</div>
    </section>
  );
}

function Row({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link to={to} className="rounded-md border border-surface-border px-3 py-2 hover:border-brand-lightgray hover:bg-surface-rowhover transition block">
      <div className="text-[13px] font-semibold flex justify-between">{label}<span className="text-brand-lightgray">→</span></div>
      <div className="text-[12px] text-brand-gray">{hint}</div>
    </Link>
  );
}

function Step({ n, to, title, children }: { n: number; to: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 shrink-0 rounded-full bg-surface-mute text-[12px] font-bold grid place-items-center">{n}</span>
      <div><Link to={to} className="link font-semibold">{title} →</Link> <span className="text-brand-gray">{children}</span></div>
    </li>
  );
}
