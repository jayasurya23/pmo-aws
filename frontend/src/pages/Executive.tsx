import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { useDrill } from "@/components/DrillDrawer";
import { AXIS, BAR_SIZE, ChartTip, RADIUS_RIGHT, RADIUS_TOP } from "@/components/charts/common";
import { Card, ErrorBox, Kpi, Legend, Loading, PageHeader, SegmentedBar, StatePill, Tag } from "@/components/ui";
import { useApi } from "@/lib/api";
import { STATE_COLOR, useChartColors } from "@/lib/colors";
import { useFilters } from "@/lib/filters";
import { fmtDate, fmtMonth, fmtShort } from "@/lib/format";

export default function Executive() {
  const { query, filters, set } = useFilters();
  const { data, error, loading, reload } = useApi(`/executive?${query}`);
  const c = useChartColors();
  const drill = useDrill();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const trend = data.action_trend.slice(-12);
  const late = data.late_trend.slice(-12);
  const healthParts = data.health.filter((h: any) => ["on_track", "at_risk", "behind", "unknown", "on_hold"].includes(h.health))
    .map((h: any) => ({ key: h.health, label: h.label, value: h.count, color: c[STATE_COLOR[h.health]],
      ink: h.health === "at_risk" || h.health === "on_hold" ? "#1a1a19" : "#fff" }));
  const healthMetric: Record<string, string> = { on_track: "projects_on_track", at_risk: "projects_at_risk", behind: "projects_behind", unknown: "projects_unknown", on_hold: "projects_on_hold" };
  // upcoming milestones grouped by week for the timeline strip
  const weeks: Record<string, any[]> = {};
  data.upcoming.forEach((m: any) => {
    const d = new Date(m.planned_date + "T00:00:00");
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = mon.toISOString().slice(0, 10);
    (weeks[key] ||= []).push(m);
  });
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Dashboard A · COO, operations leadership, department managers" title="Executive operations overview"
        sub="Where is the portfolio slipping, and what needs a decision this week? Every number opens the records behind it." />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi big label="Active projects" value={k.active_projects} metric="active_projects"
          sub={<>{k.projects_upcoming} not started · {k.projects_complete} complete · {k.projects_on_hold} on hold</>} />
        <Kpi label="Behind schedule" value={k.projects_behind} metric="projects_behind" tone="critical"
          sub="≥1 milestone already past its planned date" />
        <Kpi label="At risk" value={k.projects_at_risk} metric="projects_at_risk" tone="warn"
          sub={<>{k.projected_late_milestones} milestones projected late</>} />
        <Kpi label="Late milestones" value={k.late_milestones} metric="late_milestones" tone="critical"
          spark={late.map((w: any) => w.late_open)} sub="trend: open late milestones by week" />
        <Kpi label={`Deadlines next ${filters.lookahead_days / 7} wk`} value={k.upcoming_milestones} metric="upcoming_milestones" tone="info"
          sub="milestones planned in the look-ahead" />
        <Kpi label="Open actions" value={k.open_actions} metric="open_actions" spark={trend.map((w: any) => w.open_at_end)}
          sub="trend: open at week end" />
        <Kpi label="Overdue actions" value={k.overdue_actions} metric="overdue_actions" tone="serious"
          spark={trend.map((w: any) => w.overdue_at_end)} sub="due date strictly before today" />
        <Kpi label="Overdue deliverables" value={k.overdue_deliverables} metric="overdue_deliverables" tone="serious"
          sub="per the register (system of record)" />
        <Kpi label="On track" value={k.projects_on_track} metric="projects_on_track" tone="good"
          sub={`${Math.round((100 * k.projects_on_track) / Math.max(1, k.active_projects))}% of active projects`} />
        <Kpi label="Unknown health" value={k.projects_unknown} metric="projects_unknown"
          sub="no plan or no work data — never shown as on track" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <Card className="xl:col-span-3" title="Portfolio health — active and on-hold projects"
          sub="One rule everywhere: Behind = a milestone already late; At risk = projected 3+ business days late or blocked near a deadline. Click a block for its projects.">
          <SegmentedBar parts={healthParts} onClick={(key) => drill.open(healthMetric[key], `${healthParts.find((p: any) => p.key === key)?.label} projects`)} />
        </Card>

        <Card title="Health by engineering discipline" sub="Active projects with the discipline in scope (a project counts once per discipline)">
          <div className="h-[230px]">
            <ResponsiveContainer>
              <BarChart data={data.by_discipline} layout="vertical" margin={{ left: 8, right: 18, top: 4 }} barSize={BAR_SIZE}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" {...AXIS} allowDecimals={false} />
                <YAxis type="category" dataKey="discipline" {...AXIS} width={98} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="on_track" name="On track" stackId="h" fill={c.good} stroke={c.surface} strokeWidth={1}
                  onClick={(d: any) => { set({ disciplines: [d.discipline] }); }} cursor="pointer" />
                <Bar dataKey="at_risk" name="At risk" stackId="h" fill={c.warn} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="behind" name="Behind" stackId="h" fill={c.critical} stroke={c.surface} strokeWidth={1} radius={RADIUS_RIGHT} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "On track", color: c.good }, { label: "At risk", color: c.warn }, { label: "Behind", color: c.critical }]} />
          <p className="text-[11px] text-brand-lightgray mt-1">Click a bar to filter the whole app to that discipline.</p>
        </Card>

        <Card className="xl:col-span-2" title="Portfolio-level schedule risk" sub="Ranked by risk score = 3×behind + 2×at-risk + late + projected-late milestones. Click to filter.">
          <div className="overflow-auto max-h-[300px]">
            <table className="w-full">
              <thead><tr><th className="th">Portfolio</th><th className="th">Client</th><th className="th text-right">Active</th>
                <th className="th">Behind / at risk</th><th className="th text-right">Late ms</th><th className="th text-right">Overdue actions</th><th className="th w-[140px]">Risk</th></tr></thead>
              <tbody>
                {data.portfolio_risk.slice(0, 10).map((p: any) => {
                  const max = data.portfolio_risk[0]?.risk_score || 1;
                  return (
                    <tr key={p.portfolio_id} className="hover:bg-surface-rowhover cursor-pointer" onClick={() => set({ portfolios: [p.portfolio_id] })}>
                      <td className="td font-medium">{p.portfolio}</td>
                      <td className="td text-brand-gray">{p.client}</td>
                      <td className="td text-right num">{p.active}</td>
                      <td className="td">
                        <span className="inline-flex gap-1.5">
                          {p.behind > 0 && <StatePill state="behind" label={`${p.behind} behind`} />}
                          {p.at_risk > 0 && <StatePill state="at_risk" label={`${p.at_risk} at risk`} />}
                          {!p.behind && !p.at_risk && <StatePill state="on_track" />}
                        </span>
                      </td>
                      <td className="td text-right num">{p.late_milestones}</td>
                      <td className="td text-right num">{p.overdue_actions}</td>
                      <td className="td"><div className="h-2 rounded-full bg-surface-mute"><div className="h-2 rounded-full" style={{ width: `${(100 * p.risk_score) / max}%`, background: c.serious }} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
        <Card title="Milestones achieved per month" sub="On time vs late (actual vs planned), trend window">
          <div className="h-[210px]">
            <ResponsiveContainer>
              <BarChart data={data.milestone_trend} margin={{ left: -18, right: 6, top: 8 }} barSize={BAR_SIZE}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" {...AXIS} tickFormatter={fmtMonth} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={fmtMonth} />} />
                <Bar dataKey="on_time" name="On time" stackId="m" fill={c.good} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="late" name="Late" stackId="m" fill={c.critical} stroke={c.surface} strokeWidth={1} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "On time", color: c.good }, { label: "Late", color: c.critical }]} />
        </Card>
        <Card title="Action backlog by week" sub="Open and overdue at each week's end (production burndown rule)">
          <div className="h-[210px]">
            <ResponsiveContainer>
              <LineChart data={data.action_trend} margin={{ left: -18, right: 10, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="week_start" {...AXIS} tickFormatter={fmtShort} minTickGap={24} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `Week of ${fmtDate(l)}`} />} />
                <Line dataKey="open_at_end" name="Open" stroke={c["series-1"]} strokeWidth={2} dot={false} />
                <Line dataKey="overdue_at_end" name="Overdue" stroke={c.serious} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: "Open", color: c["series-1"], shape: "line" }, { label: "Overdue", color: c.serious, shape: "line" }]} />
        </Card>
        <Card title="Late milestones still open, by week" sub={<>Restated on current plans <Tag>method note</Tag></>}>
          <div className="h-[210px]">
            <ResponsiveContainer>
              <LineChart data={data.late_trend} margin={{ left: -18, right: 10, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="week_start" {...AXIS} tickFormatter={fmtShort} minTickGap={24} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `Week of ${fmtDate(l)}`} />} />
                <Line dataKey="late_open" name="Late, not achieved" stroke={c.critical} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-brand-lightgray">Weekly snapshots are kept from each pipeline run (kpi_snapshots); this view recomputes history from dates.</p>
        </Card>
      </div>

      <Card className="mt-3" title={`Upcoming deadlines — next ${filters.lookahead_days / 7} weeks`}
        sub="Each milestone with its projected status. IFP = Issued for Purchase: the package clients order long-lead equipment from."
        right={<button className="btn-ghost" onClick={() => drill.open("upcoming_milestones", "Upcoming deadlines")}>All {k.upcoming_milestones} →</button>}>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, Object.keys(weeks).length)}, minmax(170px, 1fr))` }}>
          {Object.entries(weeks).sort().map(([wk, ms]) => (
            <div key={wk} className="min-w-0">
              <div className="micro mb-1.5">Week of {fmtShort(wk)} · {ms.length}</div>
              <div className="space-y-1.5">
                {ms.slice(0, 7).map((m: any) => (
                  <Link key={m.id} to={`/projects/${m.project_id}`} className="block rounded-md border border-surface-border px-2 py-1.5 hover:border-brand-lightgray bg-surface-card">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[12px] font-semibold truncate">{m.project_name}</span>
                      <span className="text-[11px] font-bold shrink-0">{m.stage}</span>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <StatePill state={m.status} label={m.status_label} />
                      <span className="text-[11px] text-brand-gray num">{fmtShort(m.planned_date)}</span>
                    </div>
                  </Link>
                ))}
                {ms.length > 7 && <div className="text-[11px] text-brand-gray">+{ms.length - 7} more</div>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
