import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { EXEC_PATH } from "@/components/Layout";
import { CountUp } from "@/components/ui";
import { STATIC, useApi } from "@/lib/api";

/** Landing page. Leads with the case-study question (what decision did the
 *  dashboard change, and how did it help) in plain language. */
export default function Start() {
  const scen = useApi<any[]>("/scenarios");
  const outcomes = useApi<any>(STATIC ? "/scenarios/outcomes" : null);
  const s1 = scen.data?.find((s) => s.key === "s1");
  const s2 = scen.data?.find((s) => s.key === "s2");
  const b1 = s1 ? (s1.before ?? s1.current) : null, a1 = outcomes.data?.s1 ?? (s1?.applied ? s1.current : null);
  const b2 = s2 ? (s2.before ?? s2.current) : null, a2 = outcomes.data?.s2 ?? (s2?.applied ? s2.current : null);
  return (
    <div className="max-w-[1200px]">
      <div className="kicker">Case study · a dashboard I built, and the decisions it changed</div>
      <h1 className="text-[40px] font-bold tracking-[-0.02em] leading-tight mt-2">PMO 360: every project in one place, so the team acts early</h1>
      <p className="text-[18px] text-brand-gray mt-4 max-w-[880px] leading-relaxed">
        I designed and built PMO 360 at Castillo Engineering, which designs utility-scale solar projects. Before it, project status
        was spread across Monday.com, Smartsheet, Outlook, spreadsheets and meeting notes, and priorities were set in the weekly meeting from memory.
        PMO 360 put it all in one place. This site shows how it works, using invented data.
      </p>
      <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#b37a00]/35 bg-[#fab219]/10 px-4 py-2.5 text-[16px]">
        <b>Invented data.</b> No client, project or person here is real.
      </div>

      <h2 className="text-[26px] font-bold mt-10">The decisions it changed</h2>
      <p className="text-[17px] text-brand-gray mt-1">Two examples. Each shows what the dashboard showed, what the team decided, and what changed.</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
        <DecisionCard n={1} tag="Staffing" title="Four projects looked fine. Three engineers were overloaded." to="/scenarios?s=1"
          saw="Every project read on track, but Team capacity showed all four depended on the same three senior engineers, booked over 110% for weeks."
          did="Moved one package to the team lead, brought in a contract engineer, and moved one deadline 5 days with the client's agreement."
          result={b1 && a1 ? <>Their overloaded weeks went from <b>{b1.senior_over_person_weeks}</b> to <Big v={a1.senior_over_person_weeks} />. One project moved to at risk, on purpose.</> : "Their overloaded weeks dropped sharply."} />
        <DecisionCard n={2} tag="Schedule" title="One blocked package was about to delay the final drawings." to="/scenarios?s=2"
          saw={<>Cedar Hollow's final milestone was projected {b2 ? <b>{b2.ifc_slip_bd} business days late</b> : "late"}. The project page showed why: a structural package waiting on the client, and a follow-up nobody owned.</>}
          did="Carried on with an agreed design assumption, added a second engineer, and gave the follow-up an owner."
          result={b2 && a2 ? <>The milestone went from {b2.ifc_slip_bd} days late to <Big v={a2.ifc_slip_bd} /> days: back on track.</> : "The milestone came back on track."} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 mt-10">
        <section className="card p-6 xl:col-span-3">
          <h2 className="text-[22px] font-bold">Who used it</h2>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <Role to="/actions" who="Project managers" q="What do I owe, to whom, and by when?" />
            <Role to={EXEC_PATH} who="The PM lead and leadership" q="Which projects are slipping, worst first?" />
            <Role to="/capacity" who="Department leads" q="Who has room for the next milestone?" />
            <Role to="/billables" who="Leadership and approvers" q="What can we bill, and what is waiting?" />
          </div>
        </section>
        <section className="card p-6 xl:col-span-2">
          <h2 className="text-[22px] font-bold">What I did to the data</h2>
          <ul className="mt-4 space-y-3 text-[16.5px] leading-snug">
            <li className="flex gap-3"><Dot />Matched records across four tools, exact matches only. Anything unclear is flagged, not guessed.</li>
            <li className="flex gap-3"><Dot />Turned each team's status words into one set, and kept missing dates as missing, never zero.</li>
            <li className="flex gap-3"><Dot />Made every number open the list of records behind it, so people trust it.</li>
          </ul>
          <Link to="/pipeline" className="btn-ghost mt-5">How the numbers come together →</Link>
        </section>
      </div>
      <p className="text-[15px] text-brand-gray mt-6">Built by Jayasurya.</p>
    </div>
  );
}

function Big({ v }: { v: number }) {
  return <b className="text-brand-green text-[22px]"><CountUp value={v} /></b>;
}
function Dot() {
  return <span className="mt-2 w-2 h-2 rounded-full bg-brand-red shrink-0" />;
}

function DecisionCard({ n, tag, title, saw, did, result, to }: { n: number; tag: string; title: string; saw: ReactNode; did: ReactNode; result: ReactNode; to: string }) {
  const rows: [string, ReactNode][] = [["What the dashboard showed", saw], ["What we decided", did], ["What changed", result]];
  return (
    <section className="card p-6 flex flex-col anim-rise" style={{ animationDelay: `${n * 120}ms` }}>
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-brand-red text-white grid place-items-center text-[17px] font-bold">{n}</span>
        <span className="text-[13px] font-semibold uppercase tracking-[0.1em] text-brand-gray">{tag}</span>
      </div>
      <h3 className="text-[22px] font-bold leading-snug mt-3">{title}</h3>
      <div className="mt-4 space-y-0 flex-1">
        {rows.map(([h, body], i) => (
          <div key={h} className="relative pl-7 pb-4">
            <span className={`absolute left-0 top-1.5 w-3 h-3 rounded-full ${i === 2 ? "bg-st-good" : "bg-brand-lightgray"}`} />
            {i < 2 && <span className="absolute left-[5px] top-5 bottom-0 w-px bg-surface-border" />}
            <div className="text-[13.5px] font-semibold uppercase tracking-[0.08em] text-brand-gray">{h}</div>
            <div className="text-[17px] leading-snug mt-1">{body}</div>
          </div>
        ))}
      </div>
      <Link to={to} className="btn-primary self-start mt-1">Walk through it step by step →</Link>
    </section>
  );
}

function Role({ to, who, q }: { to: string; who: string; q: string }) {
  return (
    <Link to={to} className="rounded-xl border border-surface-border px-4 py-3.5 hover:border-brand-lightgray hover:bg-surface-rowhover transition block">
      <div className="text-[16.5px] font-semibold flex justify-between">{who}<span className="text-brand-lightgray">→</span></div>
      <div className="text-[15.5px] text-brand-gray mt-0.5">{q}</div>
    </Link>
  );
}
