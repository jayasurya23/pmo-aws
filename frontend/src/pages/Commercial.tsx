import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { useDrill } from "@/components/DrillDrawer";
import { AXIS, ChartTip, RADIUS_RIGHT, RADIUS_TOP } from "@/components/charts/common";
import { Card, Details, ErrorBox, Kpi, Legend, Loading, PageHeader, StatePill, Tag, Takeaway } from "@/components/ui";
import { useApi } from "@/lib/api";
import { DISCIPLINE_SLOT, useChartColors } from "@/lib/colors";
import { useFilters } from "@/lib/filters";
import { fmtMoney, fmtMonth } from "@/lib/format";

export default function Commercial() {
  const { query } = useFilters();
  const { data, error, reload, loading } = useApi(`/commercial?${query}`);
  const c = useChartColors();
  const drill = useDrill();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const stageColor: Record<string, string> = { draft: c["seq-3"], submitted: c["seq-4"], open: c["seq-5"], bid: c["seq-6"], won: c.good, closed: c.neutral };
  const buckets = ["0-5", "6-10", "11-20", "20+"];
  const aging = buckets.map((b) => ({ bucket: b,
    draft: data.co_aging.find((r: any) => r.bucket === b && r.status === "draft")?.count || 0,
    pending: data.co_aging.find((r: any) => r.bucket === b && r.status === "pending")?.count || 0 }));
  const months = Array.from(new Set(data.workload.map((r: any) => r.month))).sort() as string[];
  const discs = Array.from(new Set(data.workload.map((r: any) => r.discipline))) as string[];
  const workload = months.map((m) => {
    const row: any = { month: m };
    discs.forEach((d) => (row[d] = data.workload.find((r: any) => r.month === m && r.discipline === d)?.remaining_hours || 0));
    return row;
  });
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Proposals & change orders · for leadership and approvers" title="Where is commercial work waiting?"
        sub="Proposals to clients, and change orders that add scope to signed contracts." />

      <Takeaway>
        <b>{k.co_backlog_count} change orders worth {fmtMoney(k.co_backlog_value)}</b> are in draft or waiting for approval; approval takes a median of {k.co_approval_median_bd ?? "—"} business days.
        {" "}{k.proposals_open_pipeline} proposals are in the pipeline.
      </Takeaway>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Proposals in pipeline" value={k.proposals_open_pipeline} onClick={() => drill.open("proposals_pipeline", "Proposals in pipeline")} sub="draft, submitted, open or bid" />
        <Kpi label="Time to submit a proposal" value={k.turnaround_median_bd ?? "—"} unit=" days" metric="proposal_turnaround" tone="info" sub="median, business days" />
        <Kpi label="Change orders waiting" value={k.co_backlog_count} metric="co_backlog" tone="warn" sub={`${fmtMoney(k.co_backlog_value)} in draft or pending`} />
        <Kpi label="Change-order approval time" value={k.co_approval_median_bd ?? "—"} unit=" days" metric="co_approval_cycle" sub="median, business days" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-5">
        <Card title="Proposals by stage" sub="Number of proposals and their fee value. Unpriced fees are left out of the value, not counted as zero.">
          <div className="space-y-3 mt-1">
            {data.by_stage.map((s: any) => {
              const max = Math.max(...data.by_stage.map((x: any) => x.count), 1);
              return (
                <div key={s.stage}>
                  <div className="flex justify-between text-[15px]"><span>{s.label}</span><span className="num"><b>{s.count}</b> · {fmtMoney(s.fee_total)}{s.fee_unknown ? <span className="text-brand-gray"> (+{s.fee_unknown} unpriced)</span> : null}</span></div>
                  <div className="h-[18px] rounded-[4px] bg-surface-mute mt-1"><div className="h-[18px] rounded-[4px]" style={{ width: `${(100 * s.count) / max}%`, background: stageColor[s.stage] }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Change-order backlog aging" sub="Business days waiting, in draft or pending approval">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={aging} margin={{ left: -16, right: 6, top: 8 }} barSize={24}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="bucket" {...AXIS} tickFormatter={(b) => `${b} days`} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `${l} business days`} />} />
                <Bar dataKey="draft" name="Draft" stackId="a" fill={c["seq-3"]} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="pending" name="Pending approval" stackId="a" fill={c.warn} stroke={c.surface} strokeWidth={1} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "Draft", color: c["seq-3"] }, { label: "Pending approval", color: c.warn }]} />
        </Card>
      </div>
        <Card className="mt-5" title="Waiting too long" pad={false} sub="Change orders pending approval for more than 10 business days, and proposals in draft for more than 15"
          right={<button className="btn-ghost" onClick={() => drill.open("co_backlog", "Change-order backlog")}>CO backlog →</button>}>
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full"><thead className="sticky top-0 bg-surface-card"><tr><th className="th">Item</th><th className="th">Where</th><th className="th text-right">Waiting</th><th className="th text-right">Value</th></tr></thead>
              <tbody>{data.bottlenecks.map((b: any, i: number) => (
                <tr key={i}><td className="td"><Tag tone={b.kind.startsWith("Change") ? "warn" : "neutral"}>{b.kind}</Tag><div className="text-[14px] mt-0.5">{b.ref} · {b.title}</div></td>
                  <td className="td text-[14px]">{b.project_id ? <Link className="link" to={`/projects/${b.project_id}`}>{b.where}</Link> : b.where}</td>
                  <td className="td text-right num whitespace-nowrap">{b.age_bd} days</td><td className="td text-right num">{fmtMoney(b.value)}</td></tr>))}</tbody></table>
          </div>
        </Card>

      <Details hint="Turnaround trend, workload ahead, approved change orders and scope changes by project">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Kpi label="Proposals won" value={k.proposals_won_window} tone="good" sub="created in the last year" />
        <Kpi label="Projects with scope change" value={k.projects_with_scope_change} tone="info" sub="at least one approved change order" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Engineering hours still to deliver, by month due"
          sub="Remaining hours on open work, by discipline">
          <div className="h-[260px]">
            <ResponsiveContainer>
              <BarChart data={workload} margin={{ left: -6, right: 6, top: 8 }} barSize={30}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" {...AXIS} tickFormatter={fmtMonth} />
                <YAxis {...AXIS} />
                <Tooltip content={<ChartTip fmtLabel={fmtMonth} unit=" h" />} />
                {discs.map((d, i) => (
                  <Bar key={d} dataKey={d} name={d} stackId="w" fill={c[DISCIPLINE_SLOT[d]]} stroke={c.surface} strokeWidth={1} radius={i === discs.length - 1 ? RADIUS_TOP : undefined} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={discs.map((d) => ({ label: d, color: c[DISCIPLINE_SLOT[d]] }))} />
        </Card>
        <Card title="Proposal turnaround by month" sub="Business days from starting a proposal to submitting it">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <LineChart data={data.turnaround} margin={{ left: -16, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" {...AXIS} tickFormatter={fmtMonth} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={fmtMonth} unit=" days" />} />
                <Line dataKey="median_bd" name="Median" stroke={c["series-1"]} strokeWidth={2} dot={{ r: 3, stroke: c.surface, strokeWidth: 2 }} />
                <Line dataKey="p80_bd" name="80th percentile" stroke={c["series-2"]} strokeWidth={2} dot={{ r: 3, stroke: c.surface, strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "Median", color: c["series-1"], shape: "line" }, { label: "80th percentile", color: c["series-2"], shape: "line" }]} />
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-5">
        <Card className="xl:col-span-2" title="Scope changes by project" pad={false} sub="Approved change orders and schedule impact, by project">
          <div className="overflow-auto max-h-[340px]">
            <table className="w-full"><thead className="sticky top-0 bg-surface-card"><tr><th className="th">Project</th><th className="th text-right">COs</th><th className="th text-right">Value</th>
              <th className="th text-right">Schedule impact</th><th className="th text-right">Re-baselines</th><th className="th">Health</th></tr></thead>
              <tbody>{data.scope_changes.map((s: any) => (
                <tr key={s.project_id}><td className="td"><Link className="link" to={`/projects/${s.project_id}`}>{s.project}</Link><div className="text-[12.5px] text-brand-gray">{s.portfolio}</div></td>
                  <td className="td text-right num">{s.approved_cos}</td><td className="td text-right num">{fmtMoney(s.co_value)}</td>
                  <td className="td text-right num">{s.impact_bd ? `+${s.impact_bd} days` : "—"}</td><td className="td text-right num">{s.milestone_revisions}</td>
                  <td className="td"><StatePill state={s.health === "Behind" ? "behind" : s.health === "At risk" ? "at_risk" : s.health === "On track" ? "on_track" : "complete"} label={s.health} /></td></tr>))}</tbody></table>
          </div>
        </Card>
        <Card title="Approved change-order value by month" sub="Scope added to contracts">
          <div className="h-[260px]">
            <ResponsiveContainer>
              <BarChart data={data.co_approved_by_month} margin={{ left: -2, right: 6, top: 8 }} barSize={18}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" {...AXIS} tickFormatter={fmtMonth} />
                <YAxis {...AXIS} tickFormatter={(v) => fmtMoney(v)} />
                <Tooltip content={<ChartTip fmtLabel={fmtMonth} rows={(p) => <div><b>{fmtMoney(p[0].payload.value)}</b> across {p[0].payload.count} CO(s)</div>} />} />
                <Bar dataKey="value" name="Approved value" fill={c["series-3"]} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      </Details>
    </div>
  );
}
