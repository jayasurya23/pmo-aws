import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { AXIS, ChartTip } from "@/components/charts/common";
import { Card, ErrorBox, Legend, Loading, PageHeader, StatePill, Tag } from "@/components/ui";
import { apiPost, useApi } from "@/lib/api";
import { EXEC_PATH } from "@/components/Layout";
import { useChartColors } from "@/lib/colors";
import { fmtDate, fmtShort } from "@/lib/format";

const stateKey = (label: string) => ({ "On track": "on_track", "At risk": "at_risk", "Projected late": "projected_late", Late: "late", Behind: "behind" } as any)[label] || "unknown";

export default function Scenarios() {
  const { data, error, reload } = useApi(`/scenarios`);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const act = async (key: string, op: "apply" | "reset") => {
    setBusy(key);
    try { await apiPost(`/scenarios/${key}/${op}`); } finally { setBusy(null); reload(); }
  };
  return (
    <div>
      <PageHeader kicker="The story · what decision did the dashboard change?" title="Two decisions, before and after"
        sub="Two worked examples on synthetic data. Apply a decision and every dashboard shows the numbers after it, including the trade-off. Reset puts it back." />
      <div className="space-y-6">
        {data.map((s: any) => <ScenarioCard key={s.key} s={s} busy={busy === s.key} act={act} />)}
      </div>
    </div>
  );
}

function Delta({ label, before, after, unit = "", better = "down" }: { label: string; before: any; after: any; unit?: string; better?: "down" | "up" | "none" }) {
  const changed = before !== undefined && before !== null && String(before) !== String(after);
  const good = typeof before === "number" && typeof after === "number" ? (better === "down" ? after < before : better === "up" ? after > before : false) : changed;
  return (
    <div className="rounded-lg border border-surface-border px-4 py-3">
      <div className="text-[14px] text-brand-gray">{label}</div>
      <div className={`${typeof after === "string" && isNaN(Number(after)) ? "text-[17px] leading-snug" : "text-[22px]"} font-semibold num mt-0.5`}>
        {before !== undefined && before !== null && changed && <span className="text-brand-lightgray line-through mr-2 text-[0.85em]">{String(before)}{unit}</span>}
        <span className={changed && good ? "text-brand-green" : ""}>{String(after)}{unit}</span>
      </div>
    </div>
  );
}

function ScenarioCard({ s, busy, act }: { s: any; busy: boolean; act: (k: string, op: "apply" | "reset") => void }) {
  const c = useChartColors();
  const b = s.before, a = s.current;
  return (
    <Card title={<span className="flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-brand-red text-white text-[14px] font-bold grid place-items-center">{s.key === "s1" ? 1 : 2}</span>{s.title}</span>}
      sub={s.applied ? <Tag tone="good">Decision applied: every dashboard now shows the result</Tag> : <Tag>Before the decision</Tag>}
      right={s.applied
        ? <button className="btn-ghost" disabled={busy} onClick={() => act(s.key, "reset")}>{busy ? "Resetting…" : "Reset to before"}</button>
        : <button className="btn-primary" disabled={busy} onClick={() => act(s.key, "apply")}>{busy ? "Applying…" : "Apply the decision"}</button>}>
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <ol className="xl:col-span-2 space-y-3">
          {s.steps.map((st: string, i: number) => (
            <li key={i} className="flex gap-3 text-[15px] leading-snug">
              <span className="w-6 h-6 shrink-0 rounded-full bg-surface-mute text-[13px] font-bold grid place-items-center">{i + 1}</span>
              <span>{st}</span>
            </li>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            {s.key === "s1" && <Link className="btn-ghost" to="/capacity?disciplines=Electrical">Team capacity, Electrical</Link>}
            {s.key === "s1" && <Link className="btn-ghost" to={`${EXEC_PATH}?disciplines=Electrical`}>Overview, Electrical</Link>}
            {s.key === "s2" && <Link className="btn-ghost" to={`/projects/${a.project_id}`}>Open Cedar Hollow</Link>}
            {s.key === "s2" && <Link className="btn-ghost" to="/delivery">Schedule</Link>}
            {s.key === "s2" && <Link className="btn-ghost" to="/actions">Action items</Link>}
          </div>
        </ol>
        <div className="xl:col-span-3">
          {s.key === "s1" ? <S1 b={b} a={a} c={c} /> : <S2 b={b} a={a} />}
        </div>
      </div>
    </Card>
  );
}

function S1({ b, a, c }: any) {
  const series = a.weeks.map((w: string, i: number) => {
    const row: any = { week: w };
    a.seniors.forEach((p: any) => {
      row[p.name] = p.pct_of_available[i];
      const pb = b?.seniors.find((x: any) => x.name === p.name);
      if (pb) row[p.name + " (before)"] = pb.pct_of_available[i];
    });
    return row;
  });
  const cols = [c["series-1"], c["series-2"], c["series-3"]];
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Delta label="Seniors' peak load" before={b?.senior_peak_pct} after={a.senior_peak_pct} unit="%" />
        <Delta label="Seniors' weeks over 110%" before={b?.senior_over_person_weeks} after={a.senior_over_person_weeks} />
        <Delta label="Electrical team weeks over 110%" before={b?.team_over_person_weeks} after={a.team_over_person_weeks} />
        <Delta label="Open milestones still on track" better="up"
          before={b?.open_milestones.filter((m: any) => m.status === "On track").length}
          after={a.open_milestones.filter((m: any) => m.status === "On track").length} />
      </div>
      <div className="text-[15px] font-semibold mb-2">The three senior engineers: booked % of available hours, by week {b && <span className="font-normal text-brand-gray">(dashed = before the decision)</span>}</div>
      <div className="h-[240px]">
        <ResponsiveContainer>
          <LineChart data={series} margin={{ left: -12, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" {...AXIS} tickFormatter={fmtShort} />
            <YAxis {...AXIS} unit="%" domain={[0, 160]} />
            <ReferenceLine y={110} stroke={c.critical} strokeOpacity={0.6} label={{ value: "110%", fontSize: 12, fill: c.critical, position: "insideTopRight" }} />
            <Tooltip content={<ChartTip fmtLabel={(l) => `Week of ${fmtShort(l)}`} unit="%" />} />
            {a.seniors.map((p: any, i: number) => b && <Line key={p.name + "b"} dataKey={p.name + " (before)"} stroke={cols[i]} strokeOpacity={0.45} strokeDasharray="4 3" strokeWidth={2} dot={false} connectNulls />)}
            {a.seniors.map((p: any, i: number) => <Line key={p.name} dataKey={p.name} stroke={cols[i]} strokeWidth={2} dot={{ r: 3, stroke: c.surface, strokeWidth: 2 }} connectNulls />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend items={a.seniors.map((p: any, i: number) => ({ label: p.name, color: cols[i], shape: "line" }))} />
      <table className="w-full mt-3"><thead><tr><th className="th">Project</th><th className="th">Milestone</th><th className="th">Planned</th><th className="th">Status</th></tr></thead>
        <tbody>{a.open_milestones.slice(0, 9).map((m: any, i: number) => {
          const before = b?.open_milestones.find((x: any) => x.project === m.project && x.stage === m.stage);
          return (
            <tr key={i}><td className="td text-[14px]">{m.project}</td><td className="td text-[14px] font-semibold">{m.stage}</td>
              <td className="td num text-[14px]">{before && before.planned !== m.planned && <span className="line-through text-brand-lightgray mr-1">{fmtShort(before.planned)}</span>}{fmtShort(m.planned)}{m.revisions ? <> <Tag tone="warn">moved</Tag></> : null}</td>
              <td className="td">{before && before.status !== m.status && <span className="text-[12.5px] text-brand-lightgray mr-1 line-through">{before.status}</span>}<StatePill state={stateKey(m.status)} label={m.status} /></td></tr>
          );
        })}</tbody></table>
      <p className="text-[14.5px] text-brand-gray mt-3 leading-relaxed">The decision is not free: moving Granite Run's IFP date is a visible plan change and pushes that project to “at risk”. The dashboard shows the trade-off instead of hiding it. To confirm it worked, watch the seniors' weekly load and these milestones' status.</p>
    </div>
  );
}

function S2({ b, a }: any) {
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Delta label="IFC status" before={b?.ifc_status} after={a.ifc_status} better="none" />
        <Delta label="IFC projected slip" before={b?.ifc_slip_bd} after={a.ifc_slip_bd} unit=" days" />
        <Delta label="Blocked packages" before={b?.blocked_packages} after={a.blocked_packages} />
        <Delta label="Actions with no owner" before={b?.unassigned_actions} after={a.unassigned_actions} />
      </div>
      <table className="w-full"><thead><tr><th className="th">Milestone</th><th className="th">Planned</th><th className="th">Actual</th><th className="th">Projected</th><th className="th">Status</th></tr></thead>
        <tbody>{a.milestones.map((m: any) => {
          const pre = b?.milestones.find((x: any) => x.stage === m.stage);
          return (
            <tr key={m.stage}><td className="td font-semibold">{m.stage}</td><td className="td num">{fmtDate(m.planned)}</td><td className="td num">{fmtDate(m.actual)}</td>
              <td className="td num">{pre && pre.forecast !== m.forecast && <span className="line-through text-brand-lightgray mr-1">{fmtShort(pre.forecast)}</span>}{fmtDate(m.forecast)}</td>
              <td className="td">{pre && pre.status !== m.status && <span className="text-[12.5px] text-brand-lightgray mr-1 line-through">{pre.status}</span>}<StatePill state={stateKey(m.status)} label={m.status} /></td></tr>
          );
        })}</tbody></table>
      <div className="mt-4 rounded-lg bg-surface-mute/50 p-4 text-[14.5px]">
        <div className="font-semibold mb-1.5">Why IFC is projected where it is now</div>
        <ul className="list-disc pl-5 space-y-1 leading-snug">{a.milestones.find((m: any) => m.stage === "IFC")?.basis.map((x: string) => <li key={x}>{x}</li>)}</ul>
      </div>
      <p className="text-[14.5px] text-brand-gray mt-3 leading-relaxed">The 90% milestone stays <b>late</b>: the dashboard does not rewrite history. The decision protects the next milestone. To confirm it worked, watch for the Structural 90% package being issued, the client's geotech action closing, and IFC staying on track week to week.</p>
    </div>
  );
}
