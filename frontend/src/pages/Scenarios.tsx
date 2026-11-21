import clsx from "clsx";
import { ReactNode, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EXEC_PATH } from "@/components/Layout";
import { CountUp, ErrorBox, Loading, PageHeader, StatePill } from "@/components/ui";
import { apiPost, useApi } from "@/lib/api";
import { ChartColors, useChartColors } from "@/lib/colors";
import { decisionPath, DECISIONS } from "@/lib/decisions";
import { fmtMoney, fmtMonth, fmtShort } from "@/lib/format";

const stateKey = (label: string) => ({ "On track": "on_track", "At risk": "at_risk", "Projected late": "projected_late", Late: "late", Behind: "behind",
  "Done on time": "complete_on_time", "Done late": "complete_late" } as any)[label] || "unknown";
const STEP_NAMES = ["What the dashboard showed", "What it revealed", "The decision", "The result"];

/** One decision per page, told as a four-step walkthrough: what the dashboard
 *  showed, what it revealed, the decision, the result. Applying a decision
 *  writes it into the data, so every dashboard shows the result. */
export default function DecisionPage() {
  const { slug } = useParams();
  const { data, error, reload } = useApi<any[]>(`/scenarios`);
  const idx = Math.max(0, DECISIONS.findIndex((d) => d.slug === slug));
  const d = DECISIONS[idx], next = DECISIONS[(idx + 1) % DECISIONS.length];
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const s = data.find((x) => x.key === d.key)!;
  return (
    <div className="max-w-[1240px]">
      <PageHeader kicker={`Decision ${idx + 1} of ${DECISIONS.length} · ${d.tag}`} title={d.decision}
        sub={`${d.title}. The names and numbers here are invented.`} />
      <Walkthrough key={d.key} s={s} reload={reload} />
      <div className="mt-6 flex justify-end">
        <Link to={decisionPath(next)} className="btn-ghost">Next decision: {next.tag} →</Link>
      </div>
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
        {(() => { const V = VIEWS[s.key]; return V ? <V step={step} before={before} after={after} /> : null; })()}
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
function Change({ label, from, to, unit = "", better = "down", format }: { label: string; from: number; to: number; unit?: string; better?: "down" | "up"; format?: (n: number) => string }) {
  const good = better === "down" ? to < from : to > from;
  return (
    <div className="rounded-xl border border-surface-border px-5 py-4 anim-rise">
      <div className="text-[15px] text-brand-gray">{label}</div>
      <div className="flex items-baseline gap-3 mt-1.5">
        <span className="text-[22px] text-brand-lightgray line-through num">{format ? format(from) : from}{unit}</span>
        <span className="text-brand-lightgray">→</span>
        <span className={clsx("text-[38px] font-semibold leading-none", good ? "text-brand-green" : "text-st-critical")}><CountUp value={to} format={format} />{unit}</span>
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

// ---------------------------------------------------------------- one client decision
function useDelayedAfter(after: any) {
  const [show, setShow] = useState(false);
  useEffect(() => { if (!after) return; const t = setTimeout(() => setShow(true), 900); return () => clearTimeout(t); }, [after]);
  return show && after;
}

function ProjectRows({ before, after }: { before: any; after?: any }) {
  const showAfter = useDelayedAfter(after);
  const src = showAfter || before;
  return (
    <div className="overflow-x-auto mt-5">
      <table className="w-full">
        <thead><tr><th className="th">Project</th><th className="th">Next milestone</th><th className="th">Planned → projected</th><th className="th">Status</th></tr></thead>
        <tbody>{before.projects.map((p0: any, i: number) => {
          const p = src.projects.find((x: any) => x.id === p0.id) ?? p0;
          return (
            <tr key={p0.id} className="anim-rise" style={{ animationDelay: `${i * 90}ms` }}>
              <td className="td"><Link className="link font-semibold" to={`/projects/${p0.id}`}>{p0.name}</Link></td>
              <td className="td font-semibold">{p.next}</td>
              <td className="td num whitespace-nowrap">{fmtShort(p.planned)} → <b className="transition-colors">{fmtShort(p.forecast)}</b>{p.slip_bd ? <span className="text-brand-gray"> ({p.slip_bd} {p.slip_bd === 1 ? "day" : "days"} late)</span> : null}</td>
              <td className="td"><span className="inline-block transition-all duration-700"><StatePill state={stateKey(p.status)} label={p.status} /></span></td>
            </tr>
          );
        })}</tbody>
      </table>
      {after && <div className="text-[14px] font-semibold mt-2">{showAfter ? "Showing: after the decision" : "Showing: before…"}</div>}
    </div>
  );
}

function S3({ step, before, after }: { step: number; before: any; after: any }) {
  if (step === 0) return (
    <div>
      <Lead>On the Schedule page, several projects are slipping. Each one looks like its own small problem.</Lead>
      <Note>{before.late_or_at_risk} of these {before.projects.length} projects have their next milestone late or at risk, adding up to {before.days_late} business days of slip. Looked at one project at a time, each would get its own follow-up.</Note>
      <ProjectRows before={before} />
    </div>
  );
  if (step === 1) return (
    <div>
      <Lead>Grouping the blocked work by what it is waiting on shows one cause: all {before.blocked_packages} are waiting on the same decision from {before.client}.</Lead>
      <div className="mt-5 rounded-xl border border-st-critical/40 px-5 py-4 max-w-[900px] anim-rise">
        <div className="flex items-center gap-2 text-[18px] font-semibold"><span className="w-2.5 h-2.5 rounded-full bg-st-critical anim-pulse" />One decision, {before.projects.length} projects</div>
        <p className="text-[16.5px] text-brand-gray mt-1.5">The client hasn't chosen which inverter to use across their projects. We recommended two options. Until they choose, the electrical design can't move on any of them, and they had said the choice would come after an internal review in late December.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 max-w-[900px]">
        <div className="rounded-xl border border-surface-border px-5 py-4 anim-rise" style={{ animationDelay: "150ms" }}>
          <div className="text-[15px] text-brand-gray">Billing on these projects that is at risk</div>
          <div className="text-[30px] font-semibold mt-1"><CountUp value={before.billing_at_risk} format={fmtMoney} /></div>
        </div>
        <div className="rounded-xl border border-surface-border px-5 py-4 anim-rise" style={{ animationDelay: "300ms" }}>
          <div className="text-[15px] text-brand-gray">Business days of slip, added up</div>
          <div className="text-[30px] font-semibold mt-1"><CountUp value={before.days_late} /></div>
        </div>
      </div>
      <div className="mt-4"><Link className="btn-ghost" to="/delivery">Open Schedule →</Link></div>
    </div>
  );
  if (step === 2) return (
    <div>
      <Lead>The decision: one conversation with the client about all their projects, instead of five separate chases.</Lead>
      <div className="grid gap-3 mt-5 max-w-[900px]">
        <Action n={1} delay={100}>Bring the choice to the client's portfolio review this week, with the cost of waiting shown project by project.</Action>
        <Action n={2} delay={350}>Recommend one option for all their projects, with the reasons and what each option means for schedule.</Action>
        <Action n={3} delay={600}>Once they choose, restart the electrical design on every project the same day.</Action>
      </div>
    </div>
  );
  if (!after) return null;
  return (
    <div>
      <Lead>The result: the client chose in the meeting, and the work restarted on every project at once.</Lead>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        <Change label="Billing at risk on these projects" from={before.billing_at_risk} to={after.billing_at_risk} format={fmtMoney} />
        <Change label="Milestones late or at risk" from={before.late_or_at_risk} to={after.late_or_at_risk} />
        <Change label="Business days of slip, added up" from={before.days_late} to={after.days_late} />
      </div>
      <ProjectRows before={before} after={after} />
      <Note>A milestone that was already late stays late. The rest come back on track because the wait is gone.</Note>
    </div>
  );
}

// ---------------------------------------------------------------- bidding within capacity
function LoadBars({ before, after }: { before: any; after?: any }) {
  const c = useChartColors();
  const showAfter = useDelayedAfter(after);
  const src = showAfter || before;
  const disc = before.peak.discipline;
  const rows0 = before.rows.filter((r: any) => r.discipline === disc);
  const max = 130;
  return (
    <div className="mt-6">
      <div className="text-[16px] font-semibold mb-3">{disc}: hours needed as a % of the hours the team has, by month</div>
      <div className="relative h-[260px] flex items-end gap-4 border-b border-surface-border pl-10">
        <div className="absolute left-10 right-0 border-t-2 border-dashed" style={{ bottom: `${(100 / max) * 100}%`, borderColor: c.critical }} />
        <span className="absolute left-0 text-[13px] font-semibold" style={{ bottom: `calc(${(100 / max) * 100}% - 9px)`, color: c.critical }}>100%</span>
        {rows0.map((r0: any, i: number) => {
          const r = src.rows.find((x: any) => x.discipline === disc && x.month === r0.month) ?? r0;
          const total = Math.min(max, r.total_pct ?? 0), sold = Math.min(max, r.sold_pct ?? 0);
          return (
            <div key={r0.month} className="flex-1 flex flex-col items-center justify-end h-full anim-rise" style={{ animationDelay: `${i * 80}ms` }}>
              <span className={clsx("text-[14px] font-semibold mb-1 num", total > 100 ? "text-st-critical" : "text-brand-black")}>{r.total_pct}%</span>
              <div className="w-full max-w-[64px] flex flex-col justify-end rounded-t-md overflow-hidden" style={{ height: `${(total / max) * 100}%`, transition: "height .9s ease" }}>
                <div style={{ height: `${total ? (100 * (total - sold)) / total : 0}%`, background: total > 100 ? c.serious : c["seq-3"], transition: "height .9s ease, background-color .9s ease" }} />
                <div className="flex-1" style={{ background: c["series-1"] }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 pl-10 mt-2">
        {rows0.map((r: any) => <span key={r.month} className="flex-1 text-center text-[13.5px] text-brand-gray">{fmtMonth(r.month)}</span>)}
      </div>
      <div className="flex flex-wrap gap-4 mt-3 text-[14px] text-brand-gray">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c["series-1"] }} />work already sold</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c["seq-3"] }} />open proposals, if won</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c.serious }} />over capacity</span>
        {after && <span className="font-semibold text-brand-black">{showAfter ? "Showing: after the decision" : "Showing: before…"}</span>}
      </div>
    </div>
  );
}

function S4({ step, before, after }: { step: number; before: any; after: any }) {
  const pk = before.peak;
  if (step === 0) return (
    <div>
      <Lead>On the Proposals page, the pipeline looks healthy: {before.open_proposals} open proposals, and the team has room for the work already sold.</Lead>
      <Note>Taken one at a time, every proposal looks fine to win. Nobody is looking at what happens if several are won at once.</Note>
      <div className="mt-4"><Link className="btn-ghost" to="/proposals">Open Proposals →</Link></div>
    </div>
  );
  if (step === 1) return (
    <div>
      <Lead>Adding the proposals to the sold work, month by month, shows the problem: {pk.discipline} would need {pk.total_pct}% of its hours in {fmtMonth(pk.month)}.</Lead>
      <Note>Sold work alone is {before.peak_sold_pct}% that month. The proposals, with the start dates they name, push it over. Capacity counts {Math.round(before.billable_share * 100)}% of working time as available for project work.</Note>
      <LoadBars before={before} />
    </div>
  );
  if (step === 2) return (
    <div>
      <Lead>The decision: fix it before winning the work, while start dates can still be agreed.</Lead>
      <div className="grid gap-3 mt-5 max-w-[900px]">
        <Action n={1} delay={100}>Pick the four biggest proposals that start before the crunch.</Action>
        <Action n={2} delay={350}>Propose a start about three months later in each, explained to the client as a date we can actually keep.</Action>
        <Action n={3} delay={600}>Keep the rest of the pipeline as it is, and check the view again as proposals are won or lost.</Action>
      </div>
    </div>
  );
  if (!after) return null;
  return (
    <div>
      <Lead>The result: winning the pipeline no longer overloads the team, and every date we commit to is one we can staff.</Lead>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5 max-w-[760px]">
        <Change label={`${pk.discipline} load in ${fmtMonth(pk.month)}, if won`} from={pk.total_pct} to={(after.rows.find((r: any) => r.discipline === pk.discipline && r.month === pk.month) ?? after.peak).total_pct} unit="%" />
        <Change label="Highest month, any discipline" from={pk.total_pct} to={after.peak.total_pct} unit="%" />
      </div>
      <LoadBars before={before} after={after} />
      {after.moved?.length > 0 && <Note>Moved: {after.moved.map((m: any) => m.title.replace(" - engineering services", "")).join(", ")}.</Note>}
    </div>
  );
}

// ---------------------------------------------------------------- billing at risk
function S5({ step, before, after }: { step: number; before: any; after: any }) {
  if (step === 0) return (
    <div>
      <Lead>On Billables, {fmtMoney(before.billing_at_risk)} of the coming billing sits on milestones that are late or at risk, and {fmtMoney(before.co_waiting_value)} of extra scope waits on change-order approvals.</Lead>
      <Note>Design is billed when a milestone is issued, so a slipping schedule is slipping billing.</Note>
      <div className="mt-4"><Link className="btn-ghost" to="/billables">Open Billables →</Link></div>
    </div>
  );
  if (step === 1) return (
    <div>
      <Lead>Sorting by value shows where effort pays back most: three upcoming milestones are worth {fmtMoney(before.targets.reduce((a: number, t: any) => a + (t.value || 0), 0))} between them, and {before.co_waiting_count} change orders are waiting, the oldest for months.</Lead>
      <div className="overflow-x-auto mt-5">
        <table className="w-full"><thead><tr><th className="th">Project</th><th className="th">Milestone</th><th className="th text-right">Value</th><th className="th">Status</th></tr></thead>
          <tbody>{before.targets.map((t: any, i: number) => (
            <tr key={t.project_id + t.stage} className="anim-rise" style={{ animationDelay: `${i * 100}ms` }}>
              <td className="td"><Link className="link font-semibold" to={`/projects/${t.project_id}`}>{t.project_name}</Link></td>
              <td className="td font-semibold">{t.stage}</td><td className="td text-right num">{fmtMoney(t.value)}</td>
              <td className="td"><StatePill state={stateKey(t.status)} label={t.status} /></td></tr>))}</tbody></table>
      </div>
    </div>
  );
  if (step === 2) return (
    <div>
      <Lead>The decision: put effort where the money is.</Lead>
      <div className="grid gap-3 mt-5 max-w-[900px]">
        <Action n={1} delay={100}>Add a second engineer to each of the three highest-value milestones that are at risk.</Action>
        <Action n={2} delay={350}>Take the five oldest change orders to the clients' portfolio meetings and ask for a decision.</Action>
      </div>
      <Note>In this walkthrough the clients approve all five.</Note>
    </div>
  );
  if (!after) return null;
  const showT = after.targets ?? [];
  return (
    <div>
      <Lead>The result: less billing at risk, and more scope approved to bill.</Lead>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        <Change label="Billing at risk" from={before.billing_at_risk} to={after.billing_at_risk} format={fmtMoney} />
        <Change label="Change orders waiting" from={before.co_waiting_value} to={after.co_waiting_value} format={fmtMoney} />
        <Change label="Number waiting" from={before.co_waiting_count} to={after.co_waiting_count} />
      </div>
      <div className="overflow-x-auto mt-5">
        <table className="w-full"><thead><tr><th className="th">Milestone that got a second engineer</th><th className="th text-right">Value</th><th className="th">Before</th><th className="th">After</th></tr></thead>
          <tbody>{before.targets.map((t: any) => {
            const a = showT.find((x: any) => x.project_id === t.project_id && x.stage === t.stage);
            return (<tr key={t.project_id + t.stage}><td className="td"><b>{t.project_name}</b> · {t.stage}</td><td className="td text-right num">{fmtMoney(t.value)}</td>
              <td className="td"><StatePill state={stateKey(t.status)} label={t.status} /></td><td className="td">{a && <StatePill state={stateKey(a.status)} label={a.status} />}</td></tr>);
          })}</tbody></table>
      </div>
    </div>
  );
}

const VIEWS: Record<string, (p: { step: number; before: any; after: any }) => JSX.Element | null> = { s1: S1, s2: S2, s3: S3, s4: S4, s5: S5 };
