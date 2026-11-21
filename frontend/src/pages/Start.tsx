import clsx from "clsx";
import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { EXEC_PATH } from "@/components/Layout";
import { STATIC, useApi } from "@/lib/api";
import { decisionPath, DECISIONS } from "@/lib/decisions";

/** Landing page, told as one short story: the data, the challenges, how the
 *  dashboard was shaped, and what it fixed. Each block says which of the
 *  case-study questions it answers. */
export default function Start() {
  const scen = useApi<any[]>("/scenarios");
  const outcomes = useApi<any>(STATIC ? "/scenarios/outcomes" : null);
  const stateOf = (key: string) => {
    const s = scen.data?.find((x) => x.key === key);
    return { before: s ? (s.before ?? s.current) : null, after: outcomes.data?.[key] ?? (s?.applied ? s.current : null) };
  };
  return (
    <div className="max-w-[1000px]">
      <div className="kicker">Case study</div>
      <h1 className="text-[42px] font-bold tracking-[-0.02em] leading-tight mt-2">PMO 360</h1>
      <p className="text-[22px] leading-snug mt-2 font-medium">A project dashboard I built for an engineering team, and the decisions it changed.</p>
      <p className="mt-4 inline-block rounded-full bg-[#fab219]/15 px-3.5 py-1.5 text-[15px]">The dashboards use invented data: no client, project or person in them is real.</p>

      <Block n={1} title="The data" answers="what it took to make the data work">
        <p className="text-[18px] leading-snug"><b>Project status lived in six places that didn't agree.</b> Priorities were set in the weekly meeting, from memory.</p>
        <div className="flex flex-wrap items-center gap-2.5 mt-5">
          {["Monday.com", "Smartsheet", "Outlook", "Spreadsheets", "Meeting notes", "Sales CRM"].map((t, i) => (
            <span key={t} className="px-3.5 py-2 rounded-lg bg-surface-card border border-surface-border text-[15.5px] anim-rise" style={{ animationDelay: `${i * 70}ms` }}>{t}</span>
          ))}
          <span className="text-[24px] text-brand-lightgray px-1 anim-rise" style={{ animationDelay: "450ms" }}>→</span>
          <span className="px-4 py-2 rounded-lg bg-brand-red text-white text-[16px] font-semibold anim-rise" style={{ animationDelay: "520ms" }}>PMO 360</span>
        </div>
      </Block>

      <Block n={2} title="The challenges" answers="what it took to make the data work">
        <p className="text-[16px] text-brand-gray">Click one to see the fix.</p>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Challenge title="Same project, different names" fix="Made the project ID the one key across every tool. A missing or mistyped ID is flagged for a person, never guessed." />
          <Challenge title="Same status, different words" fix="Mapped every team's words to one set. A missing date stays visibly missing, never treated as on time." />
          <Challenge title="Two screens, two answers" fix="One screen said a manager had 27 overdue actions, another said 2. I made ownership one rule used everywhere." />
          <Challenge title="Feeds that break" fix="When the sales CRM sync came back broken, it was refused and the last good data kept, so nothing went blank." />
        </div>
        <Link to="/pipeline" className="link text-[15.5px] mt-3 inline-block">How the numbers come together →</Link>
      </Block>

      <Block n={3} title="How I shaped the dashboard" answers="who used it">
        <p className="text-[16px] text-brand-gray">About 42 to 53 portfolios across 21 to 25 clients. The lead view started leads-only; <b className="text-brand-black">the project managers asked for it, so I opened it to everyone.</b></p>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <Choice title="Worst first" who={["PM lead", "Leadership"]} to={EXEC_PATH} line="The first screen is the one that needs action." visual={<MiniWorstFirst />} />
          <Choice title="Person by person" who={["Department leads"]} to="/capacity" line="Team averages hide the three people who are overloaded." visual={<MiniHeat />} />
          <Choice title="Every number opens its records" who={["Everyone"]} to="/actions" line="Nobody has to ask where a number came from." visual={<MiniDrill />} />
          <Choice title="What do I owe, by when" who={["Project managers"]} to="/actions" line="Overdue first, each action traced to the meeting that raised it." visual={<MiniOwe />} />
        </div>
      </Block>

      <Block n={4} title="How it helped" answers="what decisions it changed">
        <div className="grid gap-2.5">
          {[["Weekly meeting run from memory", "The meeting starts from the dashboard"],
            ["Two answers to “how many overdue?”", "One number everyone trusts"],
            ["Overload found when a milestone slipped", "Overload seen weeks ahead"]].map(([b, a], i) => (
            <div key={b} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[16px] anim-rise" style={{ animationDelay: `${i * 90}ms` }}>
              <span className="rounded-lg bg-surface-mute/70 px-4 py-2.5 text-brand-gray">{b}</span>
              <span className="text-brand-lightgray text-[20px]">→</span>
              <span className="rounded-lg bg-st-good/10 px-4 py-2.5 font-semibold text-brand-black">{a}</span>
            </div>
          ))}
        </div>
        <p className="text-[17px] font-semibold mt-6">Three decisions it changed <span className="font-normal text-brand-gray text-[15.5px]">· a one-minute walkthrough each</span></p>
        <div className="mt-3 space-y-3">
          {DECISIONS.map((d, i) => {
            const { before, after } = stateOf(d.key);
            const result = d.result(before, after);
            return (
              <Link key={d.slug} to={decisionPath(d)} className="group flex items-center gap-4 card px-5 py-4 hover:border-brand-lightgray hover:shadow-page transition">
                <span className="w-10 h-10 rounded-full bg-brand-red text-white grid place-items-center text-[17px] font-bold shrink-0">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[18.5px] font-bold leading-snug">{d.decision}</span>
                  <span className="block text-[15.5px] text-brand-gray leading-snug mt-0.5">{d.title}</span>
                </span>
                {result && <span className="hidden sm:block text-[15.5px] font-semibold text-brand-green whitespace-nowrap">{result}</span>}
                <span className="text-[22px] text-brand-lightgray group-hover:text-brand-red transition">→</span>
              </Link>
            );
          })}
        </div>
      </Block>

      <div className="flex flex-wrap gap-3 mt-8">
        <Link to={EXEC_PATH} className="btn-ghost">Explore the dashboards →</Link>
      </div>
      <p className="text-[15px] text-brand-gray mt-6">Built by Jayasurya.</p>
    </div>
  );
}

function Block({ n, title, answers, children }: { n: number; title: string; answers: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[26px] font-bold"><span className="text-brand-red mr-2">{n}.</span>{title}</h2>
        <span className="text-[13px] font-semibold rounded-full border border-surface-border bg-surface-card px-3 py-1 text-brand-gray">Answers: {answers}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Challenge({ title, fix }: { title: string; fix: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen(!open)} className={clsx("card text-left px-5 py-4 transition hover:border-brand-lightgray", open && "ring-2 ring-brand-red/25")}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[17.5px] font-semibold">{title}</span>
        <span className={clsx("text-brand-lightgray transition-transform", open && "rotate-90")}>›</span>
      </div>
      {open && <div className="text-[15.5px] mt-2 leading-snug anim-rise"><b className="text-brand-red">Fix:</b> {fix}</div>}
    </button>
  );
}

function Choice({ title, who, line, to, visual }: { title: string; who: string[]; line: string; to: string; visual: ReactNode }) {
  return (
    <Link to={to} className="card p-4 flex gap-4 items-center hover:border-brand-lightgray hover:shadow-page transition">
      <div className="w-[120px] shrink-0 rounded-lg bg-surface-mute/60 p-2.5">{visual}</div>
      <div className="min-w-0">
        <div className="text-[17px] font-semibold">{title}</div>
        <div className="text-[15px] text-brand-gray leading-snug mt-0.5">{line}</div>
        <div className="flex flex-wrap gap-1.5 mt-2">{who.map((w) => <span key={w} className="text-[12.5px] font-semibold rounded-full bg-brand-red/10 text-brand-red px-2 py-0.5">{w}</span>)}</div>
      </div>
    </Link>
  );
}

// Tiny illustrations of each design choice.
function MiniWorstFirst() {
  return <div className="space-y-1">{["#d03b3b", "#fab219", "#fab219", "#0ca30c"].map((c, i) => (
    <div key={i} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="h-2 rounded bg-surface-ghost" style={{ width: `${80 - i * 12}%` }} /></div>))}</div>;
}
function MiniHeat() {
  const rows = [[60, 80, 120, 130], [40, 115, 125, 70], [55, 60, 70, 65]];
  return <div className="space-y-1">{rows.map((r, i) => <div key={i} className="flex gap-1">{r.map((v, j) => (
    <span key={j} className="h-3.5 flex-1 rounded-sm" style={{ background: v > 110 ? "#d03b3b" : v > 100 ? "#fab219" : "#b7d3f6" }} />))}</div>)}</div>;
}
function MiniDrill() {
  return <div className="flex items-center gap-2"><span className="text-[22px] font-bold leading-none">45</span><span className="text-brand-lightgray">→</span>
    <div className="flex-1 space-y-1">{[0, 1, 2].map((i) => <span key={i} className="block h-1.5 rounded bg-surface-ghost" />)}</div></div>;
}
function MiniOwe() {
  return <div className="space-y-1">{([["#d03b3b", 85], ["#d03b3b", 70], ["#a8a6a3", 60]] as [string, number][]).map(([c, w], i) => (
    <div key={i} className="flex items-center gap-1.5"><span className="h-2 rounded bg-surface-ghost" style={{ width: `${w}%` }} /><span className="w-3 h-2 rounded" style={{ background: c }} /></div>))}</div>;
}
