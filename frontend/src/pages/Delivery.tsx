import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Link } from "react-router-dom";
import { useDrill } from "@/components/DrillDrawer";
import { AXIS, BAR_SIZE, ChartTip, RADIUS_RIGHT, RADIUS_TOP } from "@/components/charts/common";
import { Card, Details, ErrorBox, Kpi, Legend, Loading, PageHeader, StatePill, Tag, Takeaway } from "@/components/ui";
import { useApi } from "@/lib/api";
import { DISCIPLINE_SLOT, STATE_COLOR, useChartColors } from "@/lib/colors";
import { useFilters } from "@/lib/filters";
import { fmtDate, fmtShort } from "@/lib/format";

export default function Delivery() {
  const { query } = useFilters();
  const { data, error, reload, loading } = useApi(`/delivery?${query}`);
  const c = useChartColors();
  const drill = useDrill();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const scatter = data.scatter.map((p: any) => ({ ...p, x: new Date(p.planned + "T00:00:00").getTime() }));
  const onTime = scatter.filter((p: any) => p.variance_bd <= 0);
  const lateS = scatter.filter((p: any) => p.variance_bd > 0);
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Schedule · for project managers and engineering leads" title="Which milestones will slip?"
        sub="Milestones that are already late, kept separate from milestones projected to be late." />

      <Takeaway>
        <b>{k.late_milestones} milestones are already late</b> and <b>{k.projected_late_milestones} more are projected late</b>.
        {data.at_risk_projects[0] && <> The furthest behind is <Link className="link font-semibold" to={`/projects/${data.at_risk_projects[0].id}`}>{data.at_risk_projects[0].name}</Link>, {data.at_risk_projects[0].worst_slip_bd} business days late on its {data.at_risk_projects[0].next_milestone} milestone.</>}
      </Takeaway>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Late milestones" value={k.late_milestones} metric="late_milestones" tone="critical" sub="planned date passed" />
        <Kpi label="Projected late" value={k.projected_late_milestones} metric="projected_late_milestones" tone="serious" sub="more than 5 days after plan" />
        <Kpi label="At risk" value={k.at_risk_milestones} metric="at_risk_milestones" tone="warn" sub="3–5 days late, or blocked near due" />
        <Kpi label="Blocked work packages" value={k.blocked_work_items} metric="blocked_work_items" tone="warn" sub="waiting on an input" />
      </div>

      <div className="mt-5">
        <Card title="Milestones due each week, by projected status" sub="Next 12 weeks. A tall orange or red stack is a week to staff up or escalate now.">
          <div className="h-[280px]">
            <ResponsiveContainer>
              <BarChart data={data.milestones_ahead} margin={{ left: -18, right: 6, top: 8 }} barSize={22}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="week" {...AXIS} tickFormatter={fmtShort} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `Week of ${fmtDate(l)}`} />} />
                <Bar dataKey="on_track" name="On track" stackId="a" fill={c.good} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="at_risk" name="At risk" stackId="a" fill={c.warn} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="projected_late" name="Projected late" stackId="a" fill={c.serious} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="no_data" name="No work data" stackId="a" fill={c.neutral} stroke={c.surface} strokeWidth={1} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "On track", color: c.good }, { label: "At risk", color: c.warn }, { label: "Projected late", color: c.serious }, { label: "No work data", color: c.neutral }]} />
        </Card>
      </div>
        <Card className="mt-5" title="Projects behind or at risk" sub="Worst first. Open a project to see why." pad={false}>
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-card"><tr><th className="th">Project</th><th className="th">Health</th><th className="th">Next milestone</th>
                <th className="th">Planned → projected</th><th className="th text-right">Slip</th></tr></thead>
              <tbody>
                {data.at_risk_projects.map((p: any) => (
                  <tr key={p.id} className="hover:bg-surface-rowhover">
                    <td className="td"><Link className="link font-medium" to={`/projects/${p.id}`}>{p.name}</Link><div className="text-[13.5px] text-brand-gray">{p.portfolio_name} · {p.client_name}</div></td>
                    <td className="td"><StatePill state={p.health} label={p.health_label} /></td>
                    <td className="td">{p.next_milestone} <span className="text-brand-gray">· </span><StatePill state={p.next_status} /></td>
                    <td className="td num">{fmtShort(p.next_planned)} → <b>{fmtShort(p.next_forecast)}</b></td>
                    <td className="td text-right num whitespace-nowrap">{p.worst_slip_bd} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

      <Details hint="Status rules, planned vs actual, slips by project and discipline, IFP and blockers">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Kpi label="Overdue deliverables" value={k.overdue_deliverables} metric="overdue_deliverables" tone="serious" />
        <Kpi label="Milestones on time" value={k.on_time_pct_window} unit="%" tone="info" sub="of those completed recently" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Biggest projected slips" sub="Business days, worst milestone per project">
          <div className="h-[330px]">
            <ResponsiveContainer>
              <BarChart data={data.slip_by_project.slice(0, 12)} layout="vertical" margin={{ left: 4, right: 18 }} barSize={14}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" {...AXIS} />
                <YAxis type="category" dataKey="project" {...AXIS} width={150} tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 21) + "…" : v} />
                <Tooltip content={<ChartTip unit=" days" />} />
                <Bar dataKey="worst_slip_bd" name="Worst slip" radius={RADIUS_RIGHT}
                  shape={(props: any) => <rect x={props.x} y={props.y} width={Math.max(0, props.width)} height={props.height} rx={3} fill={c[STATE_COLOR[props.payload.health]]} />} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "Behind", color: c.critical }, { label: "At risk", color: c.warn }, { label: "On track (within tolerance)", color: c.good }]} />
        </Card>
        <Card title="How a milestone gets its status" sub="Checked in this order, all in business days">
          <ol className="text-[16px] space-y-2 list-decimal pl-5 leading-snug">
            <li><b>Complete</b>: its last required deliverable has been issued.</li>
            <li><b>Late</b>: the planned date has passed and it is not complete.</li>
            <li><b>Projected late</b>: projected more than 5 days after plan.</li>
            <li><b>At risk</b>: projected 3–5 days late, or due within 10 days with blocked work.</li>
            <li><b>On track</b>: otherwise (up to 2 days is within tolerance).</li>
          </ol>
          <p className="text-[15px] text-brand-gray mt-3 leading-relaxed">The projection divides each package's remaining hours by the hours booked to it, and waits for blocked work to resume. It is a rule, not a statistical forecast.</p>
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-5">
        <Card title="Planned vs actual, completed milestones" sub="Each dot is a milestone. Above the line means it finished late.">
          <div className="h-[250px]">
            <ResponsiveContainer>
              <ScatterChart margin={{ left: -14, right: 12, top: 10 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" domain={["dataMin", "dataMax"]} {...AXIS} tickFormatter={(v) => fmtShort(new Date(v).toISOString().slice(0, 10))} />
                <YAxis type="number" dataKey="variance_bd" {...AXIS} />
                <ZAxis range={[46, 46]} />
                <ReferenceLine y={0} stroke={c.axis} />
                <Tooltip content={({ active, payload }: any) => active && payload?.length ? (
                  <div className="rounded-lg bg-surface-card border border-surface-border shadow-page px-3 py-2 text-[14.5px]">
                    <div className="font-semibold">{payload[0].payload.project} · {payload[0].payload.stage}</div>
                    <div className="text-brand-gray">Planned {fmtDate(payload[0].payload.planned)} · actual {fmtDate(payload[0].payload.actual)}</div>
                    <div>{payload[0].payload.variance_bd > 0 ? `${payload[0].payload.variance_bd} business days late` : "On time"}</div>
                  </div>) : null} />
                <Scatter data={onTime} name="On time" fill={c.good} stroke={c.surface} strokeWidth={2} />
                <Scatter data={lateS} name="Late" fill={c.critical} stroke={c.surface} strokeWidth={2} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: `On time (${onTime.length})`, color: c.good }, { label: `Late (${lateS.length})`, color: c.critical }]} />
        </Card>
        <Card title="Schedule variance by discipline" sub="Average business days late on issued deliverables, and how many are overdue now">
          <div className="h-[250px]">
            <ResponsiveContainer>
              <BarChart data={data.variance_by_discipline} layout="vertical" margin={{ left: 8, right: 24, top: 4 }} barSize={BAR_SIZE}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" {...AXIS} />
                <YAxis type="category" dataKey="discipline" {...AXIS} width={98} />
                <Tooltip content={<ChartTip rows={(p) => {
                  const r = p[0].payload;
                  return <div className="space-y-0.5"><div>Average <b>{r.avg_variance_bd ?? "—"} days</b> late</div>
                    <div>{r.late_pct ?? "—"}% of {r.issued} issued were late</div><div>Overdue now: <b>{r.overdue_now}</b></div></div>;
                }} />} />
                <Bar dataKey="avg_variance_bd" name="Average days late" radius={RADIUS_RIGHT}
                  shape={(props: any) => <rect x={props.x} y={props.y} width={Math.max(0, props.width)} height={props.height} rx={3} fill={c[DISCIPLINE_SLOT[props.payload.discipline]]} />} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 text-[14.5px]">
            {data.variance_by_discipline.map((d: any) => (
              <button key={d.discipline} className="inline-flex items-center gap-1.5 hover:underline" onClick={() => drill.open("overdue_deliverables", "Overdue deliverables", { discipline: d.discipline })}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c[DISCIPLINE_SLOT[d.discipline]] }} />{d.discipline}: <b>{d.overdue_now}</b> overdue
              </button>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-5">
        <Card className="xl:col-span-2" title="Issued-for-Purchase (IFP) milestones"
          sub="Clients order long-lead equipment from the IFP package, so a late IFP delays the equipment order.">
          <IfpTimeline rows={data.ifp} c={c} />
          <Legend className="mt-2" items={[["On track / done on time", "good"], ["At risk", "warn"], ["Projected late / done late", "serious"], ["Late", "critical"], ["On hold", "muted"]].map(([l, k]) => ({ label: l, color: (c as any)[k] }))} />
        </Card>
        <Card title="Why work is blocked" sub="Waiting on vendor data is shown in blue">
          <div className="space-y-1.5 max-h-[280px] overflow-auto">
            {data.blocked_reasons.map((r: any) => (
              <button key={r.reason} className="w-full text-left group" onClick={() => drill.open("blocked_work_items", "Blocked work packages", { blocked_reason: r.reason })}>
                <div className="flex justify-between text-[14.5px]"><span className="truncate group-hover:underline">{r.reason}</span><span className="num font-semibold ml-2">{r.n}</span></div>
                <div className="h-1.5 rounded-full bg-surface-mute mt-0.5"><div className="h-1.5 rounded-full" style={{ width: `${(100 * r.n) / data.blocked_reasons[0].n}%`, background: /vendor/i.test(r.reason) ? c["series-1"] : c.neutral }} /></div>
              </button>
            ))}
          </div>
          <Legend className="mt-2" items={[{ label: "Vendor data dependency", color: c["series-1"] }, { label: "Client / site / other", color: c.neutral }]} />
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-5">
        <Card title="Blocked work packages" pad={false} right={<button className="btn-ghost" onClick={() => drill.open("blocked_work_items", "Blocked work packages")}>All →</button>}>
          <table className="w-full"><thead><tr><th className="th">Package</th><th className="th">Blocked since</th><th className="th">Reason</th><th className="th">Milestone</th></tr></thead>
            <tbody>{data.blocked.slice(0, 8).map((b: any) => (
              <tr key={b.id}><td className="td"><Link className="link" to={`/projects/${b.project_id}`}>{b.project_name}</Link><div className="text-[13.5px] text-brand-gray">{b.discipline} {b.stage} · {b.assignee || "unassigned"}</div></td>
                <td className="td num whitespace-nowrap">{fmtShort(b.blocked_since)} <span className="text-brand-gray">({b.days_blocked_bd} days)</span></td>
                <td className="td text-[15px]">{b.blocked_reason}</td><td className="td num">{fmtShort(b.milestone_planned)}</td></tr>))}</tbody></table>
        </Card>
        <Card title="Overdue deliverables" pad={false} right={<button className="btn-ghost" onClick={() => drill.open("overdue_deliverables", "Overdue deliverables")}>All →</button>}>
          <table className="w-full"><thead><tr><th className="th">Document</th><th className="th">Planned issue</th><th className="th text-right">Overdue</th><th className="th">Status</th></tr></thead>
            <tbody>{data.overdue_deliverables.slice(0, 8).map((d: any) => (
              <tr key={d.id}><td className="td"><Link className="link" to={`/projects/${d.project_id}`}>{d.project_name}</Link><div className="text-[13.5px] text-brand-gray">{d.doc_number} · {d.discipline} {d.stage}</div></td>
                <td className="td num">{fmtShort(d.planned_issue_date)}</td><td className="td text-right num whitespace-nowrap">{d.days_overdue_bd} days</td>
                <td className="td text-[14.5px]">{d.source_status_label}{d.sources_disagree && <> · <Tag tone="warn">Monday: done</Tag></>}</td></tr>))}</tbody></table>
        </Card>
      </div>
      </Details>
    </div>
  );
}

function IfpTimeline({ rows, c }: { rows: any[]; c: any }) {
  if (!rows.length) return <div className="text-[15.5px] text-brand-gray py-6 text-center">No IFP milestones in this window.</div>;
  const t = (s?: string | null) => (s ? new Date(s + "T00:00:00").getTime() : 0);
  const all = rows.flatMap((m) => [t(m.planned_date), t(m.forecast_date), t(m.actual_date)]).filter(Boolean);
  const t0 = Math.min(...all) - 4 * 864e5, t1 = Math.max(...all) + 4 * 864e5;
  const pos = (v: number) => `${(100 * (v - t0)) / (t1 - t0)}%`;
  const months: number[] = [];
  const d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1);
  while (d.getTime() < t1) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  return (
    <div className="max-h-[300px] overflow-auto pr-1">
      <div className="grid grid-cols-[minmax(150px,210px)_1fr_auto] items-center gap-x-3 text-[14.5px]">
        <div /><div className="relative h-5">{months.map((m) => <span key={m} className="absolute text-[12.5px] text-brand-gray" style={{ left: pos(m) }}>{fmtShort(new Date(m).toISOString().slice(0, 10))}</span>)}</div><div />
        {rows.map((m: any) => {
          const col = c[STATE_COLOR[m.status]];
          const p = t(m.planned_date), f = t(m.forecast_date), a = t(m.actual_date);
          return [
            <Link key={m.id + "n"} to={`/projects/${m.project_id}`} className="truncate hover:underline py-1" title={m.project_name}>{m.project_name}</Link>,
            <div key={m.id + "t"} className="relative h-6 border-l border-surface-hairline">
              {months.map((mm) => <span key={mm} className="absolute top-0 bottom-0 w-px bg-surface-hairline" style={{ left: pos(mm) }} />)}
              <span className="absolute top-1/2 h-px bg-surface-ghost" style={{ left: 0, right: 0 }} />
              {f > p && !a && <span className="absolute top-1/2 h-[2px] -translate-y-1/2" style={{ left: pos(p), width: `calc(${pos(f)} - ${pos(p)})`, background: c.serious }} />}
              <span className="absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2" style={{ left: pos(p), background: a ? c.surface : col, borderColor: col }} title={`Planned ${m.planned_date}`} />
              {a > 0 && <span className="absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: pos(a), background: col, borderColor: c.surface }} title={`Issued ${m.actual_date}`} />}
              {f > p && !a && <span className="absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2" style={{ left: pos(f), background: c.serious, borderColor: c.surface }} title={`Projected ${m.forecast_date}`} />}
            </div>,
            <div key={m.id + "s"} className="whitespace-nowrap"><StatePill state={m.status} label={m.status_label} /></div>,
          ];
        })}
      </div>
    </div>
  );
}
