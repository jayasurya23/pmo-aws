import { Link } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ChartTip, RADIUS_TOP } from "@/components/charts/common";
import { Card, Details, ErrorBox, Kpi, Legend, Loading, PageHeader, StatePill, Takeaway } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useChartColors } from "@/lib/colors";
import { useFilters } from "@/lib/filters";
import { fmtMoney, fmtMonth, fmtShort } from "@/lib/format";

export default function Billables() {
  const { query } = useFilters();
  const { data, error, reload, loading } = useApi(`/billables?${query}`);
  const c = useChartColors();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const atRisk = k.at_risk_value + k.overdue_value;
  const worst = data.at_risk[0];
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Billables · for leadership and project managers" title="What can we bill, and what is at risk?"
        sub={`Design work is billed when a milestone is issued. Each milestone is valued at its planned hours × a blended rate ($${data.rate}/h, a demonstration rate), so a late milestone means late billing.`} />

      <Takeaway>
        <b>{fmtMoney(k.billable_90d)} is due to be billed in the next 90 days.</b> {fmtMoney(atRisk)} of upcoming billing sits on milestones that are late or at risk
        {worst && <>, the largest being <Link className="link font-semibold" to={`/projects/${worst.project_id}`}>{worst.project_name}</Link> ({worst.stage})</>}.
        {" "}Another {fmtMoney(k.co_waiting_value)} of extra scope is waiting for change-order approval.
      </Takeaway>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Billed, last 6 months" value={k.billed_6m} format={fmtMoney} tone="good" sub="milestones issued" />
        <Kpi label="Billable, next 90 days" value={k.billable_90d} format={fmtMoney} tone="info" sub="milestones due" />
        <Kpi label="Billing at risk" value={atRisk} format={fmtMoney} tone="critical" sub="on late or at-risk milestones" />
        <Kpi label="Change orders waiting" value={k.co_waiting_value} format={fmtMoney} tone="warn" sub={`${k.co_waiting_count} not yet approved, so not billable`} />
      </div>

      <Card className="mt-5" title="Billing by month" sub="Left of the line: billed. Right: what the plan says we can bill, coloured by whether the milestone is on track.">
        <div className="h-[300px]">
          <ResponsiveContainer>
            <ComposedChart data={data.by_month} margin={{ left: 4, right: 10, top: 12 }} barSize={30}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" {...AXIS} tickFormatter={fmtMonth} />
              <YAxis {...AXIS} tickFormatter={(v) => fmtMoney(v)} width={64} />
              <ReferenceLine x={data.current_month} stroke={c.critical} strokeDasharray="4 3" label={{ value: "Today", position: "insideTopLeft", fill: c.critical, fontSize: 13 }} />
              <Tooltip content={<ChartTip fmtLabel={fmtMonth} rows={(p) => (
                <div className="space-y-0.5">{p.filter((x: any) => x.value).map((x: any) => (
                  <div key={x.dataKey} className="flex justify-between gap-4"><span className="text-brand-gray">{x.name}</span><b className="num">{fmtMoney(x.value)}</b></div>))}</div>)} />} />
              <Bar dataKey="billed" name="Billed" stackId="b" fill={c["series-1"]} radius={RADIUS_TOP} />
              <Bar dataKey="on_track" name="On track" stackId="b" fill={c.good} stroke={c.surface} strokeWidth={1} />
              <Bar dataKey="at_risk" name="At risk" stackId="b" fill={c.warn} stroke={c.surface} strokeWidth={1} />
              <Bar dataKey="projected_late" name="Projected late" stackId="b" fill={c.serious} stroke={c.surface} strokeWidth={1} radius={RADIUS_TOP} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Legend items={[{ label: "Billed", color: c["series-1"] }, { label: "On track", color: c.good }, { label: "At risk", color: c.warn }, { label: "Projected late", color: c.serious }]} />
      </Card>

      <Card className="mt-5" title="Billing at risk" sub={`Largest first. ${data.at_risk_count} milestones in all. Open a project to see why it is slipping.`} pad={false}>
        <table className="w-full">
          <thead><tr><th className="th">Project</th><th className="th">Milestone</th><th className="th text-right">Value</th><th className="th">Planned → projected</th><th className="th">Status</th></tr></thead>
          <tbody>{data.at_risk.slice(0, 8).map((r: any) => (
            <tr key={r.project_id + r.stage} className="hover:bg-surface-rowhover">
              <td className="td"><Link className="link font-semibold" to={`/projects/${r.project_id}`}>{r.project_name}</Link><div className="text-[14px] text-brand-gray">{r.client_name}</div></td>
              <td className="td font-semibold">{r.stage}</td>
              <td className="td text-right num">{fmtMoney(r.value)}</td>
              <td className="td num whitespace-nowrap">{fmtShort(r.planned_date)} → <b>{fmtShort(r.forecast_date)}</b></td>
              <td className="td"><StatePill state={r.status} /></td>
            </tr>))}</tbody>
        </table>
      </Card>

      <Details hint="Billing by client and the change orders waiting for approval">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="By client" pad={false} sub="Billed in the last 6 months, still to bill in the next 6, and how much of that is at risk">
            <table className="w-full"><thead><tr><th className="th">Client</th><th className="th text-right">Billed</th><th className="th text-right">To bill</th><th className="th text-right">At risk</th></tr></thead>
              <tbody>{data.by_client.map((r: any) => (
                <tr key={r.client}><td className="td font-semibold">{r.client}</td><td className="td text-right num">{fmtMoney(r.billed)}</td>
                  <td className="td text-right num">{fmtMoney(r.upcoming)}</td><td className="td text-right num">{r.at_risk ? fmtMoney(r.at_risk) : "—"}</td></tr>))}</tbody></table>
          </Card>
          <Card title="Change orders waiting" pad={false} sub="Extra scope that cannot be billed until the client approves it">
            <table className="w-full"><thead><tr><th className="th">Change order</th><th className="th text-right">Value</th><th className="th text-right">Waiting</th></tr></thead>
              <tbody>{data.co_waiting.map((r: any) => (
                <tr key={r.id}><td className="td"><div className="font-semibold">CO-{r.co_number} · {r.title}</div>
                  <div className="text-[14px] text-brand-gray"><Link className="link" to={`/projects/${r.project_id}`}>{r.project_name}</Link> · {r.status === "pending" ? "with the client" : "being drafted"}</div></td>
                  <td className="td text-right num">{fmtMoney(r.value)}</td><td className="td text-right num whitespace-nowrap">{r.waiting_bd ?? "—"} days</td></tr>))}</tbody></table>
          </Card>
        </div>
      </Details>
    </div>
  );
}
