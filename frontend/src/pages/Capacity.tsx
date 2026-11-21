import clsx from "clsx";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { useDrill } from "@/components/DrillDrawer";
import { AXIS, ChartTip, RADIUS_TOP } from "@/components/charts/common";
import { Card, Details, ErrorBox, Kpi, Legend, Loading, PageHeader, Takeaway } from "@/components/ui";
import { STATIC, useApi } from "@/lib/api";
import { ChartColors, DISCIPLINE_SLOT, DISCIPLINES, useChartColors } from "@/lib/colors";
import { useFilters } from "@/lib/filters";
import { fmtCompact, fmtShort } from "@/lib/format";

function cellColor(pct: number | null, conflict: boolean, c: ChartColors): { bg: string; ink: string } {
  if (pct === null) return conflict ? { bg: c.critical, ink: "#fff" } : { bg: "transparent", ink: c["text-2"] };
  if (pct > 110) return { bg: c.critical, ink: "#fff" };
  if (pct > 100) return { bg: c.warn, ink: "#1a1a19" };
  if (pct === 0) return { bg: "transparent", ink: c["text-2"] };
  // Under 100% is normal work: calm, light steps; only amber and red ask for attention.
  const steps = [c["seq-1"], c["seq-1"], c["seq-2"], c["seq-2"], c["seq-3"]];
  return { bg: steps[Math.min(4, Math.floor(pct / 20.01))], ink: c.text };
}

export default function Capacity() {
  const { query, filters, set } = useFilters();
  const { data, error, reload, loading } = useApi(`/capacity?${query}`);
  const c = useChartColors();
  const drill = useDrill();
  const [onlyOver, setOnlyOver] = useState(true);
  const [hover, setHover] = useState<{ p: any; i: number } | null>(null);
  const people = useMemo(() => {
    if (!data) return [];
    const ps = [...data.people].filter((p: any) => !onlyOver || p.is_overallocated);
    const order: Record<string, number> = Object.fromEntries(DISCIPLINES.map((d, i) => [d, i]));
    return ps.sort((a: any, b: any) => order[a.discipline] - order[b.discipline] || (b.is_overallocated - a.is_overallocated) || b.peak_pct - a.peak_pct);
  }, [data, onlyOver]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const t = data.totals;
  const discTrend = data.weeks.map((w: string, i: number) => {
    const row: any = { week: w };
    Object.entries(data.by_discipline).forEach(([d, v]: any) => {
      row[d] = v.available_hours[i] ? Math.round((100 * v.allocated_hours[i]) / v.available_hours[i]) : null;
    });
    return row;
  });
  const unstaffed = data.weeks.map((w: string, i: number) => ({ week: w, hours: data.unstaffed_hours[i] }));
  const byRes: Record<string, any[]> = {};
  data.competing.forEach((r: any) => (byRes[r.resource] ||= []).push(r));
  const hrs = data.hours.by_discipline;
  const unknown = hrs.reduce((a: number, r: any) => a + r.actual_unknown, 0);
  const busiest = Object.entries(data.by_discipline).map(([d, v]: any) => ({ d, pct: Math.round((100 * v.allocated_hours.reduce((a: number, x: number) => a + x, 0)) / Math.max(1, v.available_hours.reduce((a: number, x: number) => a + x, 0))) }));
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Team capacity · for department leads" title="Who has room for the next milestone?"
        sub={`Hours booked to each person against the hours they have, week by week, for the next ${data.weeks.length} weeks. Holidays and PTO are already taken out.`}
        right={STATIC ? undefined : <div className="flex items-center gap-2 text-[15px]"><span className="text-brand-gray">Horizon</span>
          {[6, 10, 14].map((w) => <button key={w} className={clsx("btn-ghost", filters.weeks === w && "!bg-brand-black !text-surface-card")} onClick={() => set({ weeks: w })}>{w} wk</button>)}</div>} />

      <Takeaway>
        The teams are booked at <b>{t.utilisation_pct}%</b> overall ({busiest.map((b) => `${b.d} ${b.pct}%`).join(", ")}), yet <b>{t.overallocated_people} people are over 110%</b> for two weeks or more.
        Averages hide overload, so this page looks person by person.
      </Takeaway>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Booked vs available" value={t.utilisation_pct} unit="%" metric="utilisation_pct" tone={t.utilisation_pct > 95 ? "serious" : "good"} sub={`${t.people} people`} />
        <Kpi label="Over-allocated people" value={t.overallocated_people} metric="overallocated_people" tone="critical" sub="over 110% for 2+ weeks, or booked during PTO" />
        <Kpi label="Booked during PTO" value={t.booked_during_timeoff} tone="serious" onClick={() => setOnlyOver(true)} sub="people with work booked in a PTO week" />
        <Kpi label="Unstaffed hours" value={fmtCompact(t.unstaffed_hours)} unit="h" metric="unstaffed_bookings" tone="warn" sub="booked to nobody yet" />
      </div>

      <div className="mt-5">
        <Card title="Team load by week"
          sub="Booked hours as a % of available hours. Above 100% the whole team is short of people.">
          <div className="h-[260px]">
            <ResponsiveContainer>
              <LineChart data={discTrend} margin={{ left: -12, right: 16, top: 10 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="week" {...AXIS} tickFormatter={fmtShort} />
                <YAxis {...AXIS} unit="%" domain={[0, (dataMax: number) => Math.max(120, Math.ceil(dataMax / 10) * 10)]} />
                <ReferenceLine y={100} stroke={c.critical} strokeOpacity={0.6} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `Week of ${fmtShort(l)}`} unit="%" />} />
                {Object.keys(data.by_discipline).map((d) => (
                  <Line key={d} dataKey={d} name={d} stroke={c[DISCIPLINE_SLOT[d]]} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: c.surface }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={Object.keys(data.by_discipline).map((d) => ({ label: d, color: c[DISCIPLINE_SLOT[d]], shape: "line" }))} />
        </Card>
      </div>
      <Card className="mt-5" title="Who is over-allocated, and when"
        sub="Each cell is the hours booked to a person that week as a % of their available hours. Red is over 110%. Hover a cell to see the projects."
        right={<label className="flex items-center gap-1.5 text-[15px] cursor-pointer"><input type="checkbox" className="accent-[#ad1f2b]" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} />Only people over 110%</label>}>
        <div className="overflow-auto max-h-[520px] border border-surface-hairline rounded-md relative">
          <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
            <thead className="sticky top-0 bg-surface-card z-10">
              <tr><th className="th !px-2 text-left min-w-[190px]">Person</th>
                {data.weeks.map((w: string, i: number) => <th key={w} className="th !px-1 text-center min-w-[54px]">{fmtShort(w)}{data.working_days[i] < 5 && <div className="text-[12.5px] text-brand-lightgray font-normal">{data.working_days[i]} days</div>}</th>)}
                <th className="th text-right">Peak</th></tr>
            </thead>
            <tbody>
              {people.map((p: any, idx: number) => {
                const first = idx === 0 || people[idx - 1].discipline !== p.discipline;
                return [
                  first && <tr key={p.discipline + "-h"}><td colSpan={data.weeks.length + 2} className="pt-2 pb-0.5 px-2">
                    <span className="inline-flex items-center gap-1.5 micro !text-brand-gray"><span className="w-2 h-2 rounded-full" style={{ background: c[DISCIPLINE_SLOT[p.discipline]] }} />{p.discipline}</span></td></tr>,
                  <tr key={p.id}>
                    <td className="px-2 py-1 text-[15.5px] whitespace-nowrap">
                      <span className={clsx(p.is_overallocated && "font-semibold")}>{p.name}</span>
                      <span className="text-[13.5px] text-brand-gray ml-1.5">{p.seniority}{p.is_placeholder ? " · placeholder" : ""}</span>
                    </td>
                    {p.pct_of_available.map((v: number | null, i: number) => {
                      const conflict = p.pto_conflict_weeks.includes(i);
                      const col = cellColor(v, conflict, c);
                      return (
                        <td key={i} onMouseEnter={() => setHover({ p, i })} onMouseLeave={() => setHover(null)}
                          className="text-center text-[14px] num rounded-[4px] h-[30px] cursor-default"
                          style={{ background: col.bg, color: col.ink, outline: v === null && !conflict ? `1px dashed ${c.grid}` : undefined }}>
                          {v === null ? (conflict ? `PTO ${Math.round(p.allocated_hours[i])}h` : "PTO") : v === 0 ? "" : v}
                        </td>
                      );
                    })}
                    <td className="px-2 text-right text-[14.5px] num font-semibold">{p.peak_pct}%</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
          {hover && (
            <div className="fixed z-50 pointer-events-none card px-3 py-2 text-[14.5px] max-w-[320px]" style={{ right: 32, bottom: 32 }}>
              <div className="font-semibold">{hover.p.name} · week of {fmtShort(data.weeks[hover.i])}</div>
              <div>{hover.p.allocated_hours[hover.i]} h booked / {hover.p.available_hours[hover.i]} h available</div>
              <div className="text-brand-gray mt-1">Projects: {hover.p.projects_by_week[hover.i].length ? hover.p.projects_by_week[hover.i].map((id: number) => data.project_names[String(id)] || `#${id}`).join(", ") : "none"}</div>
            </div>
          )}
        </div>
        <Legend className="mt-2" items={[{ label: "under 40%", color: c["seq-1"], shape: "square" }, { label: "40–80%", color: c["seq-2"], shape: "square" },
          { label: "80–100%", color: c["seq-3"], shape: "square" }, { label: "100–110%", color: c.warn, shape: "square" }, { label: "over 110%, or work booked during PTO", color: c.critical, shape: "square" }]} />
      </Card>

      <Details hint="Competing projects, unstaffed hours, estimate accuracy and the capacity rules">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Kpi label="Available hours" value={fmtCompact(t.available_hours)} sub="net of PTO and holidays" />
        <Kpi label="Booked hours" value={fmtCompact(t.allocated_hours)} tone="info" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Projects competing for the same people" pad={false}
          sub="Projects booked on someone during the weeks they are over-allocated."
          right={<button className="btn-ghost" onClick={() => drill.open("competing_projects", "Projects competing for capacity")}>All →</button>}>
          <div className="overflow-auto max-h-[330px]">
            <table className="w-full"><thead className="sticky top-0 bg-surface-card"><tr><th className="th">Person</th><th className="th">Peak</th><th className="th">Projects in their over-allocated weeks</th></tr></thead>
              <tbody>{Object.entries(byRes).sort((a, b) => b[1][0].peak_pct - a[1][0].peak_pct).slice(0, 14).map(([name, rows]) => (
                <tr key={name}><td className="td whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c[DISCIPLINE_SLOT[rows[0].discipline]] }} />{name}</span></td>
                  <td className="td num font-semibold">{rows[0].peak_pct}%</td>
                  <td className="td"><div className="flex flex-wrap gap-1.5">{rows.map((r: any) => (
                    <Link key={r.project_id} to={`/projects/${r.project_id}`} className="px-1.5 py-0.5 rounded border border-surface-border text-[14px] hover:border-brand-lightgray">
                      {r.project} <span className="text-brand-gray">· {r.weeks.map((w: string) => fmtShort(w)).join(", ")}</span></Link>))}</div></td></tr>))}</tbody></table>
          </div>
        </Card>
        <Card title="Unstaffed demand by week" sub="Hours booked to nobody, or to someone who has left">
          <div className="h-[220px]">
            <ResponsiveContainer>
              <BarChart data={unstaffed} margin={{ left: -16, right: 6, top: 8 }} barSize={18}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="week" {...AXIS} tickFormatter={fmtShort} />
                <YAxis {...AXIS} />
                <Tooltip content={<ChartTip fmtLabel={(l) => `Week of ${fmtShort(l)}`} unit=" h" />} />
                <Bar dataKey="hours" name="Unstaffed" fill={c.warn} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <button className="link text-[14.5px]" onClick={() => drill.open("unstaffed_bookings", "Unstaffed bookings")}>See the bookings →</button>
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-5">
        <Card className="xl:col-span-1" title="Planned vs actual hours, completed work" sub={<>{unknown} packages reported no actual hours. They are left out and counted, never treated as zero.</>}>
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={hrs} margin={{ left: -6, right: 6, top: 8 }} barSize={16} barGap={2}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="discipline" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip content={<ChartTip unit=" h" rows={(p) => {
                  const r = p[0].payload;
                  return <div><div>Planned <b>{r.planned_h.toLocaleString()} h</b></div><div>Actual <b>{r.actual_h.toLocaleString()} h</b> ({r.variance_pct > 0 ? "+" : ""}{r.variance_pct}%)</div>
                    <div className="text-brand-gray">{r.with_actuals} of {r.completed} packages had actuals</div></div>;
                }} />} />
                <Bar dataKey="planned_h" name="Planned" fill={c.neutral} radius={RADIUS_TOP} />
                <Bar dataKey="actual_h" name="Actual" fill={c["series-1"]} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[14.5px] mt-1">{hrs.map((r: any) => <span key={r.discipline}>{r.discipline}: <b className={r.variance_pct > 5 ? "text-st-critical" : ""}>{r.variance_pct > 0 ? "+" : ""}{r.variance_pct}%</b></span>)}</div>
          <Legend className="mt-1" items={[{ label: "Planned", color: c.neutral }, { label: "Actual", color: c["series-1"] }]} />
        </Card>
        <Card title="Estimate accuracy by design stage" sub="Where hours overrun the estimate, by design stage.">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={data.hours.by_stage.map((r: any) => ({ ...r, variance: Math.round((1000 * (r.actual_h - r.planned_h)) / r.planned_h) / 10 }))} margin={{ left: -12, right: 6, top: 8 }} barSize={22}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="stage" {...AXIS} />
                <YAxis {...AXIS} unit="%" />
                <ReferenceLine y={0} stroke={c.axis} />
                <Tooltip content={<ChartTip unit="%" />} />
                <Bar dataKey="variance" name="Actual vs planned" fill={c["series-2"]} radius={RADIUS_TOP} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="How capacity is calculated" sub="Forward weeks show booked work: a plan, not a prediction">
          <ul className="text-[15px] space-y-1.5 list-disc pl-4">{data.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul>
        </Card>
      </div>
      </Details>
    </div>
  );
}
