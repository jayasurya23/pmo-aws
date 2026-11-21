import clsx from "clsx";
import { ReactNode, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EXEC_PATH } from "@/components/Layout";
import { CountUp, ErrorBox, Loading, PageHeader, StatePill } from "@/components/ui";
import { apiPost, useApi } from "@/lib/api";
import { ChartColors, useChartColors } from "@/lib/colors";
import { fmtShort } from "@/lib/format";

const stateKey = (label: string) => ({ "On track": "on_track", "At risk": "at_risk", "Projected late": "projected_late", Late: "late", Behind: "behind",
  "Done on time": "complete_on_time", "Done late": "complete_late" } as any)[label] || "unknown";
const STEP_NAMES = ["What the dashboard showed", "What it revealed", "The decision", "The result"];

/** The case-study answer to "what decision did it change, and how did the
 *  dashboard help?" told as a four-step walkthrough per decision. Applying a
 *  decision writes it into the data, so every dashboard shows the result. */
export default function Scenarios() {
  const { data, error, reload } = useApi<any[]>(`/scenarios`);
  const [params, setParams] = useSearchParams();
  const pick = params.get("s") === "2" ? "s2" : "s1";
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const s = data.find((x) => x.key === pick)!;
  return (
    <div>
      <PageHeader kicker="The story · what decision did the dashboard change?" title="Two decisions the dashboard changed"
        sub="Step through each one: what the dashboard showed, what it revealed, what was decided, and what changed as a result. Invented data." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {[["s1", "1", "Staffing", "Four projects look fine, but three engineers are overloaded"], ["s2", "2", "Schedule", "One blocked package puts the next milestone at risk"]].map(([k, n, tag, title]) => (
          <button key={k} onClick={() => setParams({ s: n })}
            className={clsx("card text-left px-5 py-4 flex gap-4 items-start transition", pick === k ? "ring-2 ring-brand-red/50" : "opacity-80 hover:opacity-100")}>
            <span className={clsx("w-10 h-10 rounded-full grid place-items-center text-[18px] font-bold shrink-0", pick === k ? "bg-brand-red text-white" : "bg-surface-mute text-brand-gray")}>{n}</span>
            <span>
              <span className="block text-[13px] font-semibold uppercase tracking-[0.1em] text-brand-gray">{tag}</span>
              <span className="block text-[18px] font-semibold leading-snug mt-0.5">{title}</span>
            </span>
          </button>
        ))}
      </div>
      <Walkthrough key={pick} s={s} reload={reload} />
    </div>
  );
}

function Walkthrough({ s, reload }: { s: any; reload: () => void }) {
  const [step, setStep] = useState(s.applied ? 3 : 0);
  const [busy, setBusy] = useState(false);
  const [play, setPlay] = useState(false);
  const before = s.applied ? s.before : s.current;
  const after = s.applied ? s.current : null;
  useEffect(() => {
    if (!play) return;
    if (step >= 3) { setPlay(false); return; }
    const t = setTimeout(async () => {
      if (step === 2 && !s.applied) await apply(); else setStep(step + 1);
    }, step === 2 ? 4200 : 5200);
    return () => clearTimeout(t);
  });
  async function apply() {
    setBusy(true);
    try { await apiPost(`/scenarios/${s.key}/apply`); reload(); setStep(3); } finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true);
    try { await apiPost(`/scenarios/${s.key}/reset`); reload(); setStep(0); } finally { setBusy(false); }
  }
  const goto = (i: number) => { if (i === 3 && !s.applied) return; setStep(i); };

  return (
    <section className="card p-5 sm:p-7">
      <ol className="grid grid-cols-4 gap-2 mb-7">
        {STEP_NAMES.map((n, i) => (
          <li key={n}>
            <button onClick={() => goto(i)} className="w-full text-left group" disabled={i === 3 && !s.applied}>
              <div className="h-1.5 rounded-full bg-surface-mute overflow-hidden">
                <div className="h-1.5 rounded-full bg-brand-red transition-all duration-700" style={{ width: i <= step ? "100%" : "0%" }} />
              </div>
              <div className={clsx("mt-2 flex items-center gap-2 text-[15px]", i === step ? "font-semibold text-brand-black" : "text-brand-gray")}>
                <span className={clsx("w-6 h-6 rounded-full grid place-items-center text-[13px] font-bold shrink-0 transition-colors", i <= step ? "bg-brand-red text-white" : "bg-surface-mute")}>{i + 1}</span>
                <span className="hidden md:inline">{n}</span>
              </div>
            </button>
          </li>
        ))}
      </ol>

      <div key={step} className="anim-rise min-h-[300px]">
        {s.key === "s1" ? <S1 step={step} before={before} after={after} /> : <S2 step={step} before={before} after={after} />}
      </div>

      <div className="mt-7 pt-5 border-t border-surface-border flex flex-wrap items-center gap-3">
        <button className="btn-ghost" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>← Back</button>
        {step < 2 && <button className="btn-primary" onClick={() => setStep(step + 1)}>Next →</button>}
        {step === 2 && !s.applied && <button className="btn-primary" disabled={busy} onClick={apply}>{busy ? "Applying…" : "Apply this decision →"}</button>}
        {step === 2 && s.applied && <button className="btn-primary" onClick={() => setStep(3)}>See the result →</button>}
        {step === 3 && <button className="btn-ghost" disabled={busy} onClick={reset}>{busy ? "Resetting…" : "↺ Start over"}</button>}
        {step < 3 && <button className="btn-ghost" onClick={() => setPlay(!play)}>{play ? "❚❚ Pause" : "▶ Play it for me"}</button>}
        <span className="text-[14.5px] text-brand-gray ml-auto">
          {s.applied ? "Decision applied: every dashboard now shows the result." : "Nothing has changed yet."}
        </span>
      </div>
    </section>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="text-[20px] leading-snug font-semibold max-w-[900px]">{children}</p>;
}
function Note({ children }: { children: ReactNode }) {
  return <p className="text-[16px] text-brand-gray mt-2 max-w-[900px] leading-relaxed">{children}</p>;
}

/** Before -> after number that counts once it appears. */
function Change({ label, from, to, unit = "", better = "down" }: { label: string; from: number; to: number; unit?: string; better?: "down" | "up" }) {
  const good = better === "down" ? to < from : to > from;
  return (
    <div className="rounded-xl border border-surface-border px-5 py-4 anim-rise">
      <div className="text-[15px] text-brand-gray">{label}</div>
      <div className="flex items-baseline gap-3 mt-1.5">
        <span className="text-[22px] text-brand-lightgray line-through num">{from}{unit}</span>
        <span className="text-brand-lightgray">→</span>
        <span className={clsx("text-[38px] font-semibold leading-none", good ? "text-brand-green" : "text-st-critical")}><CountUp value={to} />{unit}</span>
      </div>
    </div>
  );
}

function Action({ n, children, delay }: { n: number; children: ReactNode; delay: number }) {
  return (
    <div className="flex gap-4 items-start rounded-xl border border-surface-border bg-surface-card px-5 py-4 anim-rise" style={{ animationDelay: `${delay}ms` }}>
      <span className="w-8 h-8 rounded-full bg-brand-red/10 text-brand-red grid place-items-center font-bold shrink-0">{n}</span>
      <span className="text-[17px] leading-snug">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------- staffing
function heat(v: number | null, c: ChartColors) {
  if (v === null) return { bg: c.muted, ink: c["text-2"], label: "PTO" };
  if (v > 110) return { bg: c.critical, ink: "#fff", label: `${v}` };
  if (v > 100) return { bg: c.warn, ink: "#1a1a19", label: `${v}` };
  return { bg: v >= 80 ? c["seq-3"] : v >= 40 ? c["seq-2"] : c["seq-1"], ink: c.text, label: v ? `${v}` : "" };
}

function SeniorHeatmap({ before, after }: { before: any; after?: any }) {
  const c = useChartColors();
  const [showAfter, setShowAfter] = useState(false);
  useEffect(() => { if (!after) return; const t = setTimeout(() => setShowAfter(true), 900); return () => clearTimeout(t); }, [after]);
  const src = showAfter && after ? after : before;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 4 }}>
        <thead><tr><th />{before.weeks.map((w: string) => <th key={w} className="text-[13.5px] font-medium text-brand-gray px-1 whitespace-nowrap">{fmtShort(w)}</th>)}</tr></thead>
        <tbody>{before.seniors.map((p: any, r: number) => {
          const row = src.seniors.find((x: any) => x.name === p.name) ?? p;
          return (
            <tr key={p.name}>
              <td className="text-[16px] font-semibold pr-3 whitespace-nowrap">{p.name}</td>
              {row.pct_of_available.map((v: number | null, i: number) => {
                const h = heat(v, c);
                return <td key={i} className="w-[58px] h-[40px] rounded-md text-center text-[14.5px] num anim-rise"
                  style={{ background: h.bg, color: h.ink, transition: "background-color .8s ease, color .8s ease", animationDelay: `${i * 45 + r * 90}ms` }}>{h.label}</td>;
              })}
            </tr>
          );
        })}</tbody>
      </table>
      <div className="flex flex-wrap gap-4 mt-3 text-[14px] text-brand-gray">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c.critical }} />over 110% of their hours</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c.warn }} />100–110%</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c["seq-3"] }} />under 100%</span>
        {after && <span className="font-semibold text-brand-black">{showAfter ? "Showing: after the decision" : "Showing: before…"}</span>}
      </div>
    </div>
  );
}

function S1({ step, before, after }: { step: number; before: any; after: any }) {
  const team = useApi<any>("/capacity?disciplines=Electrical");
  const avg = team.data?.totals?.utilisation_pct;
  if (step === 0) return (
    <div>
      <Lead>On the Overview, all four solar projects are on track. Nothing asks for attention.</Lead>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
        {before.projects.map((p: any, i: number) => (
          <div key={p.name} className="rounded-xl border border-surface-border px-5 py-4 anim-rise" style={{ animationDelay: `${i * 140}ms` }}>
            <div className="text-[17px] font-semibold">{p.name}</div>
            <div className="mt-2"><StatePill state={stateKey(p.health)} label={p.health} /></div>
          </div>
        ))}
      </div>
      <Note>If the team only looked at schedules, it would carry on as planned.</Note>
    </div>
  );
  if (step === 1) return (
    <div>
      <Lead>Team capacity tells a different story: the same three senior electrical engineers carry all four projects' design work.</Lead>
      <Note>The Electrical team as a whole is booked at {avg ?? "about 70"}%, so the team average looks fine. Looking person by person shows these three over 110% of their available hours for weeks at a time, one of them through a PTO week.</Note>
      <div className="mt-5"><SeniorHeatmap before={before} /></div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link className="btn-ghost" to="/capacity?disciplines=Electrical">Open Team capacity →</Link>
        <Link className="btn-ghost" to={`${EXEC_PATH}?disciplines=Electrical`}>Open Overview →</Link>
      </div>
    </div>
  );
  if (step === 2) return (
    <div>
      <Lead>The decision: spread the work before anyone burns out or a milestone slips.</Lead>
      <div className="grid gap-3 mt-5 max-w-[900px]">
        <Action n={1} delay={100}>The Electrical lead, who has room, takes Bluestem's final (IFC) package.</Action>
        <Action n={2} delay={350}>A contract electrical engineer joins on 7 Dec and takes half of the Silverleaf and Marten Ridge 90% packages.</Action>
        <Action n={3} delay={600}>Thornapple's equipment-purchase package moves 5 business days, agreed with the client.</Action>
      </div>
      <Note>The trade-off is accepted up front: moving Thornapple's date will show that project as at risk.</Note>
    </div>
  );
  if (!after) return null;
  const onTrack = (x: any) => x.projects.filter((p: any) => p.health === "On track").length;
  return (
    <div>
      <Lead>The result: the overload is mostly gone, and the cost is visible instead of hidden.</Lead>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        <Change label="Seniors' peak load" from={before.senior_peak_pct} to={after.senior_peak_pct} unit="%" />
        <Change label="Seniors' weeks over 110%" from={before.senior_over_person_weeks} to={after.senior_over_person_weeks} />
        <Change label="Projects on track" from={onTrack(before)} to={onTrack(after)} better="up" />
      </div>
      <div className="mt-6"><SeniorHeatmap before={before} after={after} /></div>
      <Note>Thornapple now shows at risk because its date moved. That is the trade-off the team chose, and the dashboard shows it rather than hiding it.</Note>
    </div>
  );
}

// ---------------------------------------------------------------- schedule
function MilestoneStrip({ before, after }: { before: any[]; after?: any[] }) {
  const c = useChartColors();
  const [showAfter, setShowAfter] = useState(false);
  useEffect(() => { if (!after) return; const t = setTimeout(() => setShowAfter(true), 900); return () => clearTimeout(t); }, [after]);
  const day = (s?: string | null) => (s ? new Date(s + "T00:00:00").getTime() : 0);
  const all = [...before, ...(after ?? [])].flatMap((m) => [m.planned, m.actual, m.forecast]).map(day).filter(Boolean);
  const t0 = Math.min(...all) - 12 * 864e5, t1 = Math.max(...all) + 12 * 864e5;
  const pos = (t: number) => `${(100 * (t - t0)) / (t1 - t0)}%`;
  const src = showAfter && after ? after : before;
  return (
    <div className="space-y-5 mt-6">
      {before.map((m0: any, i: number) => {
        const m = src.find((x: any) => x.stage === m0.stage) ?? m0;
        const p = day(m.planned), f = day(m.forecast), a = day(m.actual);
        const late = f > p;
        return (
          <div key={m0.stage} className="grid grid-cols-[64px_1fr_150px] items-center gap-3 anim-rise" style={{ animationDelay: `${i * 120}ms` }}>
            <span className="text-[17px] font-bold">{m0.stage}</span>
            <div className="relative h-8">
              <div className="absolute top-1/2 left-0 right-0 h-px bg-surface-ghost" />
              {late && !a && <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded" style={{ left: pos(p), width: `calc(${pos(f)} - ${pos(p)})`, background: c.serious, transition: "width .9s ease" }} />}
              <span className="absolute top-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2" style={{ left: pos(p), borderColor: c.axis, background: c.surface }} title={`Planned ${m.planned}`} />
              {a > 0 && <span className="absolute top-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pos(a), background: a <= p ? c.good : c.critical }} />}
              {!a && f > 0 && <span className="absolute top-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]" style={{ left: pos(f), background: late ? c.serious : c.good, transition: "left .9s ease, background-color .9s ease" }} title={`Projected ${m.forecast}`} />}
            </div>
            <StatePill state={stateKey(m.status)} label={m.status} />
          </div>
        );
      })}
      <div className="flex flex-wrap gap-4 text-[14px] text-brand-gray pl-[76px]">
        <span>◇ planned</span><span style={{ color: c.good }}>●</span><span className="-ml-3">done</span><span style={{ color: c.serious }}>◆</span><span className="-ml-3">projected</span>
        {after && <span className="font-semibold text-brand-black">{showAfter ? "Showing: after the decision" : "Showing: before…"}</span>}
      </div>
    </div>
  );
}

function S2({ step, before, after }: { step: number; before: any; after: any }) {
  const ifc = (x: any) => x.milestones.find((m: any) => m.stage === "IFC");
  if (step === 0) return (
    <div>
      <Lead>On the Schedule page, Cedar Hollow Solar is the furthest behind. Its 90% milestone is late, and the final (IFC) milestone is projected {before.ifc_slip_bd} business days late.</Lead>
      <MilestoneStrip before={before.milestones} />
      <Note>A late IFC delays construction drawings, and with them the client's construction start.</Note>
    </div>
  );
  if (step === 1) return (
    <div>
      <Lead>The project page shows why: one structural package is blocked, and nobody owns the follow-up.</Lead>
      <div className="grid md:grid-cols-2 gap-4 mt-5">
        <div className="rounded-xl border border-st-critical/40 px-5 py-4 anim-rise">
          <div className="flex items-center gap-2 text-[17px] font-semibold"><span className="w-2.5 h-2.5 rounded-full bg-st-critical anim-pulse" />Blocked since 2 Nov</div>
          <p className="text-[16px] text-brand-gray mt-1.5">Structural 90% is waiting on the client's soil (geotechnical) report. Everything after it waits too.</p>
        </div>
        <div className="rounded-xl border border-st-critical/40 px-5 py-4 anim-rise" style={{ animationDelay: "200ms" }}>
          <div className="flex items-center gap-2 text-[17px] font-semibold"><span className="w-2.5 h-2.5 rounded-full bg-st-critical anim-pulse" />An action with no owner</div>
          <p className="text-[16px] text-brand-gray mt-1.5">“Confirm pile design approach if the report is delayed” was raised in a meeting, but nobody was assigned.</p>
        </div>
      </div>
      <div className="mt-5 rounded-xl bg-surface-mute/50 px-5 py-4 anim-rise" style={{ animationDelay: "400ms" }}>
        <div className="text-[16px] font-semibold">Why IFC is projected where it is</div>
        <ul className="text-[15.5px] mt-2 space-y-1 list-disc pl-5">{ifc(before)?.basis.map((b: string) => <li key={b}>{b}</li>)}</ul>
      </div>
      <div className="mt-4"><Link className="btn-ghost" to={`/projects/${before.project_id}`}>Open Cedar Hollow →</Link></div>
    </div>
  );
  if (step === 2) return (
    <div>
      <Lead>The decision: stop waiting, and protect the next milestone.</Lead>
      <div className="grid gap-3 mt-5 max-w-[900px]">
        <Action n={1} delay={100}>Carry on with an agreed pile design assumption, to be checked when the soil report arrives.</Action>
        <Action n={2} delay={350}>Add a second structural engineer for the 90% and IFC packages.</Action>
        <Action n={3} delay={600}>Give the orphaned action an owner, and escalate the client's overdue report.</Action>
      </div>
    </div>
  );
  if (!after) return null;
  return (
    <div>
      <Lead>The result: IFC is back on track. The 90% milestone stays late, because the dashboard does not rewrite history.</Lead>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        <Change label="IFC projected late by (business days)" from={before.ifc_slip_bd} to={after.ifc_slip_bd} />
        <Change label="Blocked packages" from={before.blocked_packages} to={after.blocked_packages} />
        <Change label="Actions with no owner" from={before.unassigned_actions} to={after.unassigned_actions} />
      </div>
      <MilestoneStrip before={before.milestones} after={after.milestones} />
      <Note>To confirm it worked, the team watches for the structural package being issued and IFC staying on track week to week.</Note>
    </div>
  );
}
