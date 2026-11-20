import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDrill } from "@/components/DrillDrawer";
import { AXIS, BAR_SIZE, ChartTip, RADIUS_RIGHT, RADIUS_TOP } from "@/components/charts/common";
import { Card, ErrorBox, Kpi, Legend, Loading, PageHeader, SegmentedBar, Tag } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useChartColors } from "@/lib/colors";
import { useFilters } from "@/lib/filters";
import { fmtDate, fmtShort } from "@/lib/format";

const OWNER_LABEL: Record<string, string> = { internal: "Internal owner", external: "Client / external", unassigned: "Unassigned (blank / TBD)", unresolved: "Unrecognised name" };

export default function Actions() {
  const { query } = useFilters();
  const { data, error, reload, loading } = useApi(`/actions?${query}`);
  const c = useChartColors();
  const drill = useDrill();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const ownerColor: Record<string, string> = { internal: c["series-1"], external: c["series-3"], unassigned: c.critical, unresolved: c.serious };
  const owners = data.by_owner.map((o: any) => ({ ...o, not_overdue: o.open - o.overdue }));
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Dashboard D · project managers, engineers, leadership" title="Meetings & action-item accountability"
        sub={<>Actions are raised in coordination meetings (production: notes → AI parse → PM review → saved) and roll forward until closed. Definitions are PMO 360's own: <b>overdue = due strictly before today</b>; undated work is reported, not hidden.</>} />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Open actions" value={k.open_actions} metric="open_actions" spark={data.burndown.slice(-12).map((w: any) => w.open_at_end)} />
        <Kpi label="Overdue" value={k.overdue_actions} metric="overdue_actions" tone="serious" spark={data.burndown.slice(-12).map((w: any) => w.overdue_at_end)} />
        <Kpi label="Due in 7 days" value={k.due_soon_actions} metric="due_soon_actions" tone="info" />
        <Kpi label="No due date" value={k.no_due_date_actions} metric="no_due_date_actions" tone="warn" />
        <Kpi label="Unassigned" value={k.unassigned_actions} metric="unassigned_actions" tone="critical" sub="blank, TBD or unrecognised" />
        <Kpi label="Client-owned" value={k.external_actions} metric="external_actions" sub="waiting on the client" />
        <Kpi label="Minutes captured" value={data.minutes.rate_pct} unit="%" metric="minutes_capture_rate" tone={data.minutes.rate_pct >= 90 ? "good" : "warn"}
          onClick={() => drill.open("missing_minutes", "Meetings with no minutes captured")} sub={`${data.minutes.captured} of ${data.minutes.expected} meetings, 8 wk`} />
        <Kpi label="Closed on time" value={data.on_time_close.rate_pct} unit="%" metric="on_time_close_rate" sub={`${data.on_time_close.on_time} of ${data.on_time_close.closed_with_due}, last 90 days`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <Card className="xl:col-span-2" title="Weekly action flow — raised vs completed, and the open backlog"
          sub="Columns: actions raised and completed each week. Line: open at week end. If raised keeps beating completed, the backlog grows.">
          <div className="h-[260px]">
            <ResponsiveContainer>
              <ComposedChart data={data.burndown} margin={{ left: -16, right: 10, top: 8 }} barSize={8} barGap={2}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="week_start" {...AXIS} tickFormatter={fmtShort} minTickGap={22} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `Week of ${fmtDate(l)}`} />} />
                <Bar dataKey="raised" name="Raised" fill={c.neutral} radius={RADIUS_TOP} />
                <Bar dataKey="completed" name="Completed" fill={c.good} radius={RADIUS_TOP} />
                <Line dataKey="open_at_end" name="Open at week end" stroke={c["series-1"]} strokeWidth={2} dot={false} />
                <Line dataKey="overdue_at_end" name="Overdue at week end" stroke={c.serious} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "Raised", color: c.neutral, shape: "square" }, { label: "Completed", color: c.good, shape: "square" },
            { label: "Open at week end", color: c["series-1"], shape: "line" }, { label: "Overdue at week end", color: c.serious, shape: "line" }]} />
        </Card>
        <Card title="Who owns the open actions" sub="Resolved by rule: user id → full name → first name / initials unique on that portfolio's team">
          <SegmentedBar parts={data.owner_mix.map((o: any) => ({ key: o.owner_type, label: OWNER_LABEL[o.owner_type] || o.owner_type, value: o.n,
            color: ownerColor[o.owner_type] || c.neutral }))}
            onClick={(key) => drill.open(key === "external" ? "external_actions" : key === "internal" ? "open_actions" : "unassigned_actions",
              OWNER_LABEL[key], key === "internal" ? { owner_type: "internal" } : undefined)} />
          <p className="text-[12px] text-brand-gray mt-3">Production counts client-owned actions as "no clear owner"; this view separates them, because "waiting on the client" and "nobody owns it" need different follow-ups. <Tag tone="adapted">refinement</Tag></p>
          <div className="mt-3 pt-3 border-t border-surface-hairline">
            <div className="text-[12px] font-semibold mb-1.5">How every action's owner was resolved (all {data.owner_basis.reduce((a: number, r: any) => a + r.n, 0).toLocaleString()} actions)</div>
            {data.owner_basis.map((r: any) => {
              const total = data.owner_basis.reduce((a: number, x: any) => a + x.n, 0);
              const lbl: Record<string, string> = { owner_user_id: "Linked user id (owner picker)", full_name: "Exact full name", first_name: "First name, unique on the team",
                initials: "Initials, unique on the team", external: "Client / external contact", none: r.owner_type === "unresolved" ? "Unrecognised text" : "Blank / TBD" };
              return (
                <div key={r.owner_type + r.basis} className="flex items-center gap-2 text-[12px] py-0.5">
                  <span className="w-[200px] truncate">{lbl[r.basis] || r.basis}</span>
                  <span className="flex-1 h-2 rounded-full bg-surface-mute"><span className="block h-2 rounded-full" style={{ width: `${(100 * r.n) / total}%`, background: ownerColor[r.owner_type] || c.neutral }} /></span>
                  <span className="num w-[44px] text-right">{r.n.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <Card title="Aging of unresolved actions" sub="Days since raised; red = also past due">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={data.aging.map((a: any) => ({ ...a, current: a.n - a.overdue }))} margin={{ left: -16, right: 6, top: 8 }} barSize={24}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="bucket" {...AXIS} tickFormatter={(b) => `${b} d`} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `${l} days old`} />} />
                <Bar dataKey="current" name="Not yet due" stackId="a" fill={c["series-1"]} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="overdue" name="Overdue" stackId="a" fill={c.serious} stroke={c.surface} strokeWidth={1} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between items-center">
            <Legend items={[{ label: "Not yet due", color: c["series-1"] }, { label: "Overdue", color: c.serious }]} />
            <button className="link text-[12px]" onClick={() => drill.open("aged_60_actions", "Open actions older than 60 days")}>{k.aged_60_actions} older than 60 d →</button>
          </div>
        </Card>
        <Card title="Open actions by owner" sub="Top owners; click a bar for that person's list">
          <div className="h-[330px]">
            <ResponsiveContainer>
              <BarChart data={owners.slice(0, 12)} layout="vertical" margin={{ left: 0, right: 16 }} barSize={13}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" {...AXIS} allowDecimals={false} />
                <YAxis type="category" dataKey="owner_label" {...AXIS} width={140} interval={0} tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 19) + "…" : v} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="overdue" name="Overdue" stackId="o" fill={c.serious} stroke={c.surface} strokeWidth={1} cursor="pointer"
                  onClick={(d: any) => drill.open("open_actions", `Open actions — ${d.owner_label}`, d.owner_type === "internal" ? { owner_name: d.owner_label } : { owner_type: d.owner_type })} />
                <Bar dataKey="not_overdue" name="Not overdue" stackId="o" fill={c["series-1"]} stroke={c.surface} strokeWidth={1} radius={RADIUS_RIGHT} cursor="pointer"
                  onClick={(d: any) => drill.open("open_actions", `Open actions — ${d.owner_label}`, d.owner_type === "internal" ? { owner_name: d.owner_label } : { owner_type: d.owner_type })} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "Overdue", color: c.serious }, { label: "Not overdue", color: c["series-1"] }]} />
        </Card>
        <Card title="Meeting follow-up — were minutes captured?" sub="Portfolio meetings on the Outlook calendar (Graph, production matching rules) vs minutes saved in PMO 360">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={data.minutes.by_week.map((w: any) => ({ ...w, missing: w.expected - w.captured }))} margin={{ left: -16, right: 6, top: 8 }} barSize={20}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="week_start" {...AXIS} tickFormatter={fmtShort} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `Week of ${fmtDate(l)}`} />} />
                <Bar dataKey="captured" name="Minutes captured" stackId="m" fill={c.good} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="missing" name="No minutes" stackId="m" fill={c.critical} stroke={c.surface} strokeWidth={1} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between items-center">
            <Legend items={[{ label: "Captured", color: c.good }, { label: "No minutes", color: c.critical }]} />
            <button className="link text-[12px]" onClick={() => drill.open("missing_minutes", "Meetings with no minutes")}>{data.minutes.expected - data.minutes.captured} missing →</button>
          </div>
        </Card>
      </div>

      <Card className="mt-3" title="Where the backlog sits — by portfolio" pad={false} sub="Click a row for that portfolio's open actions, each linked back to the meeting that raised it">
        <table className="w-full"><thead><tr><th className="th">Portfolio</th><th className="th">Client</th><th className="th text-right">Open</th><th className="th text-right">Overdue</th><th className="th text-right">Unassigned</th><th className="th w-[34%]">Overdue share</th></tr></thead>
          <tbody>{data.by_portfolio.map((p: any) => (
            <tr key={p.portfolio_id} className="hover:bg-surface-rowhover cursor-pointer" onClick={() => drill.open("open_actions", `Open actions — ${p.portfolio_name}`, { portfolio_name: p.portfolio_name })}>
              <td className="td font-medium">{p.portfolio_name}</td><td className="td text-brand-gray">{p.client_name}</td>
              <td className="td text-right num">{p.open}</td><td className="td text-right num">{p.overdue}</td><td className="td text-right num">{p.unassigned}</td>
              <td className="td"><div className="flex h-2 rounded-full overflow-hidden bg-surface-mute gap-[2px]">
                <div style={{ width: `${(100 * p.overdue) / p.open}%`, background: c.serious }} /><div style={{ width: `${(100 * (p.open - p.overdue)) / p.open}%`, background: c["series-1"] }} /></div></td>
            </tr>))}</tbody></table>
      </Card>
    </div>
  );
}
