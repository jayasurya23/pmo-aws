import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { EXEC_PATH } from "@/components/Layout";
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
  const b1 = s1 ? (s1.before ?? s1.current) : null;
  const a1 = o1 ?? (s1?.applied ? s1.current : null);
  const b2 = s2 ? (s2.before ?? s2.current) : null;
  const a2 = o2 ?? (s2?.applied ? s2.current : null);
  const k = ex.data?.kpis;
  const dq = q.data?.kpis;
  return (
    <div className="max-w-[1240px]">
      <div className="kicker">Case study · a dashboard I built end to end</div>
      <h1 className="text-[36px] font-bold tracking-[-0.02em] leading-tight mt-2">PMO 360 operations analytics</h1>
      <p className="text-[17px] text-brand-gray mt-3 max-w-[860px] leading-relaxed">
        PMO 360 is the project-operations platform I designed and built at Castillo Engineering, which designs utility-scale solar,
        battery storage and substation projects. This site is a working demonstration of that work on the same stack
        (FastAPI, PostgreSQL, React), running on invented data so it can be shared. Every number opens the records behind it.
      </p>
      <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#b37a00]/35 bg-[#fab219]/10 px-4 py-2.5 text-[15px]">
        <b>Synthetic demonstration data.</b> No client, project or person is real.
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mt-8">
        <Question n={1} q="Who used it?" a="Project managers, the PM lead and leadership, department leads, and approvers.">
          <Row to="/actions" label="Project managers" hint="What do I owe, to whom, and by when?" />
          <Row to={EXEC_PATH} label="PM lead and leadership" hint="Which portfolios are slipping, worst first?" />
          <Row to="/capacity" label="Department leads" hint="Who has room for the next milestone?" />
          <Row to="/commercial" label="Approvers" hint="Which change orders are waiting?" />
        </Question>

        <Question n={2} q="What decision did it change?" a="Where follow-up and staffing effort goes each week, and how early the team acts.">
          <Decision title="Staffing: four projects all read “on track”">
            …but three senior engineers carry their design work and are over-booked.
            {b1 && <> Re-staffing cuts their over-booked weeks from <b className="text-brand-black">{b1.senior_over_person_weeks}</b>{a1 && <> to <b className="text-brand-black">{a1.senior_over_person_weeks}</b></>}.</>}
          </Decision>
          <Decision title="Schedule: one blocked package threatens the next milestone">
            {b2 ? <>The IFC milestone is projected <b className="text-brand-black">{b2.ifc_slip_bd} business days late</b>.</> : "The IFC milestone is projected late."}
            {" "}Proceeding on an agreed assumption, with a second engineer, brings it back on track{a2 ? <> ({a2.ifc_slip_bd} days)</> : null}.
          </Decision>
          <Link to="/scenarios" className="btn-primary w-full mt-1">Try both decisions →</Link>
        </Question>

        <Question n={3} q="What did you do to the data?" a="Joined systems that disagree, standardised them, and proved the numbers add up.">
          <ol className="text-[15px] space-y-2.5 list-decimal pl-5 leading-snug">
            <li><b>Matched records</b> across Monday.com, Outlook, the deliverable register and the app: exact matches only, everything else reported, never guessed.</li>
            <li><b>Standardised</b> each team's status labels into one vocabulary, and every timestamp to one time zone.</li>
            <li><b>Kept unknown as unknown</b>: a missing date or hour count is shown as missing, never as zero.</li>
            <li><b>Checked every record</b> and kept it as received{dq ? <>: {dq.staged.toLocaleString()} records, {dq.open} flagged</> : null}.</li>
            <li><b>Reconciled</b>: every headline number equals its list of records and an independent count, in automated tests.</li>
          </ol>
          <div className="flex gap-3 mt-2">
            <Link to="/pipeline" className="btn-ghost flex-1">Data flow →</Link>
            <Link to="/quality" className="btn-ghost flex-1">Data quality →</Link>
          </div>
        </Question>
      </div>

      <section className="card p-6 mt-5">
        <h2 className="text-[20px] font-bold">A three-minute tour</h2>
        <ol className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <Step n={1} to={EXEC_PATH} title="Overview">
            {k ? <>{k.active_projects} active projects: {k.projects_behind} behind, {k.projects_at_risk} at risk.</> : "Portfolio health at a glance."} Click any number for its records.
          </Step>
          <Step n={2} to={cedarPath} title="One project">
            Cedar Hollow: its 90% milestone is late and IFC is projected late. The page shows why.
          </Step>
          <Step n={3} to="/capacity?disciplines=Electrical" title="Team capacity">
            The Electrical team has room on average, but three specialists are over 110% for weeks.
          </Step>
          <Step n={4} to="/scenarios" title="Two decisions">
            Apply each decision and compare before and after, including the trade-off.
          </Step>
          <Step n={5} to="/quality" title="Data quality">
            A failed source load, how fresh each source is, and any flagged record traced to its source.
          </Step>
        </ol>
      </section>
      <p className="text-[14px] text-brand-gray mt-5">Built by Jayasurya.</p>
    </div>
  );
}

function Question({ n, q, a, children }: { n: number; q: string; a: string; children: ReactNode }) {
  return (
    <section className="card p-6 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-full bg-brand-red text-white text-[15px] font-bold grid place-items-center">{n}</span>
        <h2 className="text-[20px] font-bold">{q}</h2>
      </div>
      <p className="text-[16px] text-brand-black leading-snug">{a}</p>
      <div className="flex flex-col gap-3 mt-1">{children}</div>
    </section>
  );
}

function Row({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link to={to} className="rounded-lg border border-surface-border px-4 py-3 hover:border-brand-lightgray hover:bg-surface-rowhover transition block">
      <div className="text-[15.5px] font-semibold flex justify-between">{label}<span className="text-brand-lightgray">→</span></div>
      <div className="text-[14.5px] text-brand-gray mt-0.5">{hint}</div>
    </Link>
  );
}

function Decision({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-surface-border px-4 py-3">
      <div className="text-[15.5px] font-semibold">{title}</div>
      <div className="text-[14.5px] text-brand-gray mt-1 leading-snug">{children}</div>
    </div>
  );
}

function Step({ n, to, title, children }: { n: number; to: string; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="w-7 h-7 shrink-0 rounded-full bg-surface-mute text-[14px] font-bold grid place-items-center">{n}</span>
        <Link to={to} className="link font-semibold text-[16px]">{title} →</Link>
      </div>
      <span className="text-[14.5px] text-brand-gray leading-snug">{children}</span>
    </li>
  );
}
