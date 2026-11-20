import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { useDrill } from "@/components/DrillDrawer";
import { AXIS, BAR_SIZE, ChartTip, RADIUS_RIGHT, RADIUS_TOP } from "@/components/charts/common";
import { Card, Details, ErrorBox, Kpi, Legend, Loading, PageHeader, SegmentedBar, StatePill, Takeaway } from "@/components/ui";
import { STATIC, useApi } from "@/lib/api";
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
  // Worst first in the same order as the health rule: behind, then at risk, then overdue follow-ups.
  const ranked = [...data.portfolio_risk].sort((a: any, b: any) => b.behind - a.behind || b.at_risk - a.at_risk || b.overdue_actions - a.overdue_actions);
  const worst = ranked[0];
  const risk = ranked.slice(0, 6);
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Overview · for leadership and the PM lead" title="Where is the portfolio slipping?"
        sub="Project health across every active project, worst portfolios first. Click any number to see the records behind it." />

      <Takeaway>
        <b>{k.projects_behind} projects are behind</b> and <b>{k.projects_at_risk} are at risk</b>, out of {k.active_projects} active.
        {worst && <> The portfolio needing attention first is <b>{worst.portfolio}</b> ({worst.client}).</>}
      </Takeaway>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Active projects" value={k.active_projects} metric="active_projects"
          sub={`${Math.round((100 * k.projects_on_track) / Math.max(1, k.active_projects))}% on track`} />
        <Kpi label="Behind schedule" value={k.projects_behind} metric="projects_behind" tone="critical"
          sub="a milestone date has already passed" />
        <Kpi label="At risk" value={k.projects_at_risk} metric="projects_at_risk" tone="warn"
          sub="projected to miss a milestone" />
        <Kpi label="Overdue action items" value={k.overdue_actions} metric="overdue_actions" tone="serious"
          spark={trend.map((w: any) => w.overdue_at_end)} sub={`of ${k.open_actions} open`} />
      </div>

      <Card className="mt-5" title="Project health" sub="Click a segment to list its projects.">
        <SegmentedBar height={40} parts={healthParts} onClick={(key) => drill.open(healthMetric[key], `${healthParts.find((p: any) => p.key === key)?.label} projects`)} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mt-5">
        <Card className="xl:col-span-3" title="Portfolios needing attention" sub="Projects behind first, then at risk, then overdue actions. Click a row to see its projects.">
          <table className="w-full">
            <thead><tr><th className="th">Portfolio</th><th className="th">Projects behind / at risk</th><th className="th text-right">Overdue actions</th></tr></thead>
            <tbody>
              {risk.map((p: any) => (
                <tr key={p.portfolio_id} className="hover:bg-surface-rowhover cursor-pointer" onClick={() => STATIC ? drill.open("active_projects", `Active projects — ${p.portfolio}`, { portfolio_name: p.portfolio }) : set({ portfolios: [p.portfolio_id] })}>
                  <td className="td"><div className="font-semibold">{p.portfolio}</div><div className="text-[13.5px] text-brand-gray">{p.client}</div></td>
                  <td className="td">
                    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
                      {p.behind > 0 && <StatePill state="behind" label={`${p.behind} behind`} />}
                      {p.at_risk > 0 && <StatePill state="at_risk" label={`${p.at_risk} at risk`} />}
                      {!p.behind && !p.at_risk && <StatePill state="on_track" />}
                    </span>
                  </td>
                  <td className="td text-right num">{p.overdue_actions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="xl:col-span-2" title="Milestones completed each month" sub="On time vs late. A growing red share means slipping is becoming normal.">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={data.milestone_trend} margin={{ left: -18, right: 6, top: 8 }} barSize={26}>
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
      </div>

      <Details hint="Trends over time, upcoming deadlines and six more measures">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Kpi label="Late milestones" value={k.late_milestones} metric="late_milestones" tone="critical"
          spark={late.map((w: any) => w.late_open)} sub="planned date passed, not achieved" />
        <Kpi label={`Deadlines in the next ${filters.lookahead_days / 7} weeks`} value={k.upcoming_milestones} metric="upcoming_milestones" tone="info" />
        <Kpi label="Overdue deliverables" value={k.overdue_deliverables} metric="overdue_deliverables" tone="serious" />
        <Kpi label="Open action items" value={k.open_actions} metric="open_actions" spark={trend.map((w: any) => w.open_at_end)} />
        <Kpi label="On track" value={k.projects_on_track} metric="projects_on_track" tone="good" />
        <Kpi label="Health unknown" value={k.projects_unknown} metric="projects_unknown" sub="missing plan or progress data, never counted as on track" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
        <Card title="Action backlog by week" sub="Open and overdue at the end of each week">
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
        <Card title="Late milestones still open, by week" sub="Milestones past their planned date and not yet achieved">
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
        </Card>
      </div>

      <Card className="mt-5" title={`Upcoming deadlines — next ${filters.lookahead_days / 7} weeks`}
        sub="Each milestone with its projected status."
        right={<button className="btn-ghost" onClick={() => drill.open("upcoming_milestones", "Upcoming deadlines")}>All {k.upcoming_milestones} →</button>}>
        <div className="overflow-x-auto"><div className="grid gap-3 min-w-max lg:min-w-0" style={{ gridTemplateColumns: `repeat(${Math.max(1, Object.keys(weeks).length)}, minmax(170px, 1fr))` }}>
          {Object.entries(weeks).sort().map(([wk, ms]) => (
            <div key={wk} className="min-w-0">
              <div className="micro mb-1.5">Week of {fmtShort(wk)} · {ms.length}</div>
              <div className="space-y-1.5">
                {ms.slice(0, 7).map((m: any) => (
                  <Link key={m.id} to={`/projects/${m.project_id}`} className="block rounded-md border border-surface-border px-2 py-1.5 hover:border-brand-lightgray bg-surface-card">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[13.5px] font-semibold truncate">{m.project_name}</span>
                      <span className="text-[12.5px] font-bold shrink-0">{m.stage}</span>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <StatePill state={m.status} label={m.status_label} />
                      <span className="text-[12.5px] text-brand-gray num">{fmtShort(m.planned_date)}</span>
                    </div>
                  </Link>
                ))}
                {ms.length > 7 && <div className="text-[12.5px] text-brand-gray">+{ms.length - 7} more</div>}
              </div>
            </div>
          ))}
        </div></div>
      </Card>
      </Details>
    </div>
  );
}
