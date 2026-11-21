import clsx from "clsx";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ChartTip, RADIUS_RIGHT, RADIUS_TOP } from "@/components/charts/common";
import { Card, CountUp, Details, ErrorBox, Kpi, Legend, Loading, PageHeader, Takeaway } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useChartColors } from "@/lib/colors";
import { useFilters } from "@/lib/filters";
import { fmtDate, fmtMoney, fmtMonth } from "@/lib/format";

const OPEN = ["draft", "submitted", "open", "bid"];
const SHORT: Record<string, string> = { draft: "Draft", submitted: "Submitted", open: "Client review", bid: "Bid", won: "Won", closed: "Lost" };

export default function Proposals() {
  const { query } = useFilters();
  const { data, error, reload, loading } = useApi(`/proposals?${query}`);
  const c = useChartColors();
  const [stage, setStage] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const byStage = useMemo(() => {
    const m: Record<string, any[]> = {};
    (data?.proposals ?? []).forEach((p: any) => (m[p.status] ||= []).push(p));
    Object.values(m).forEach((l) => l.sort((a, b) => b.days_in_stage - a.days_in_stage));
    return m;
  }, [data]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const worstStage = [...data.by_stage].filter((s: any) => OPEN.includes(s.stage)).sort((a: any, b: any) => b.stuck - a.stuck)[0];
  const color: Record<string, string> = { draft: c["seq-3"], submitted: c["seq-4"], open: c["seq-5"], bid: c["seq-6"], won: c.good, closed: c.neutral };
  const maxCount = Math.max(...data.by_stage.map((s: any) => s.count), 1);
  const rows = data.proposals.filter((p: any) => (!stage || p.status === stage) &&
    (!q || `${p.title} ${p.client_name} ${p.job_number} ${p.owner_name}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Proposals · for the proposal team and leadership" title="Where is every proposal, and which are stuck?"
        sub="Every proposal from first draft to won or lost, tracked by stage the way the proposal tool records it." />

      <Takeaway>
        <b>{k.open_count} proposals are open</b>, worth {fmtMoney(k.open_fee)}. <b>{k.stuck_count} have sat in their stage longer than usual</b>
        {worstStage?.stuck ? <>, most of them in <b>{SHORT[worstStage.stage].toLowerCase()}</b></> : null}.
        {k.win_rate_pct !== null && <> Over the last year, {k.win_rate_pct}% of decided proposals were won.</>}
      </Takeaway>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Open proposals" value={k.open_count} sub={`${fmtMoney(k.open_fee)} in fees`} />
        <Kpi label="Stuck in a stage" value={k.stuck_count} tone="warn" sub="longer than that stage usually takes" onClick={() => setStage(worstStage?.stage ?? null)} />
        <Kpi label="Time to submit" value={k.turnaround_median_bd ?? "—"} unit=" days" metric="proposal_turnaround" tone="info" sub="median, business days" />
        <Kpi label="Win rate" value={k.win_rate_pct ?? "—"} unit="%" tone="good" sub={`${k.won} won, ${k.lost} lost in the last year`} />
      </div>

      <Card className="mt-5" title="The pipeline, stage by stage" sub="Click a stage to see its proposals. Red counts are stuck.">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {data.by_stage.map((s: any, i: number) => (
            <button key={s.stage} onClick={() => setStage(stage === s.stage ? null : s.stage)}
              className={clsx("relative text-left rounded-xl border px-4 py-3.5 transition anim-rise hover:border-brand-lightgray",
                stage === s.stage ? "border-brand-red ring-2 ring-brand-red/15" : "border-surface-border")}
              style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold">{SHORT[s.stage]}</span>
                {i < 3 && <span className="hidden xl:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-brand-lightgray text-[18px]">›</span>}
              </div>
              <div className="text-[30px] font-semibold leading-none mt-2"><CountUp value={s.count} /></div>
              <div className="text-[14px] text-brand-gray mt-1.5">{fmtMoney(s.fee_total)}{s.fee_unknown ? ` + ${s.fee_unknown} unpriced` : ""}</div>
              <div className="h-2 rounded-full bg-surface-mute mt-3 overflow-hidden">
                <div className="h-2 rounded-full anim-grow" style={{ width: `${(100 * s.count) / maxCount}%`, background: color[s.stage], animationDelay: `${150 + i * 70}ms` }} />
              </div>
              {s.stuck > 0 && <div className="text-[14px] font-semibold text-st-critical mt-2">{s.stuck} stuck</div>}
            </button>
          ))}
        </div>
      </Card>

      <Card className="mt-5" title={stage && !OPEN.includes(stage) ? `${SHORT[stage]} proposals` : "Open proposals by stage"}
        sub="Longest in their stage first. Red means past the usual time for that stage."
        right={stage && <button className="link text-[15px]" onClick={() => setStage(null)}>Show all stages</button>}>
        {stage && !OPEN.includes(stage) ? (
          <ProposalTable rows={rows} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {OPEN.filter((s) => !stage || s === stage).map((s) => (
              <div key={s} className="rounded-xl bg-surface-mute/50 p-3 min-w-0">
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className="text-[15.5px] font-semibold flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: color[s] }} />{SHORT[s]}</span>
                  <span className="text-[14px] text-brand-gray">{(byStage[s] ?? []).length}</span>
                </div>
                <div className="space-y-2.5">
                  {(byStage[s] ?? []).slice(0, stage ? 40 : 6).map((p: any, i: number) => (
                    <div key={p.id} className={clsx("rounded-lg bg-surface-card border px-3.5 py-3 anim-rise", p.stuck ? "border-st-critical/50" : "border-surface-border")}
                      style={{ animationDelay: `${i * 50}ms` }}>
                      <div className="text-[15px] font-semibold leading-snug">{p.title.replace(" - engineering services", "")}</div>
                      <div className="text-[14px] text-brand-gray mt-0.5">{p.client_name}</div>
                      <div className="flex items-center justify-between mt-2 text-[14px]">
                        <span className="num font-semibold">{fmtMoney(p.fee_total)}</span>
                        <span className={clsx("num", p.stuck ? "text-st-critical font-semibold" : "text-brand-gray")}>{p.days_in_stage} days here</span>
                      </div>
                    </div>
                  ))}
                  {!stage && (byStage[s] ?? []).length > 6 && (
                    <button className="w-full text-center text-[14.5px] link py-1" onClick={() => setStage(s)}>+{(byStage[s] ?? []).length - 6} more</button>
                  )}
                  {(byStage[s] ?? []).length === 0 && <div className="text-[14.5px] text-brand-gray px-1 py-3">None right now</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {data.capacity_plan && <StaffingCheck plan={data.capacity_plan} />}

      <Details hint="How long each stage takes, wins and losses by month, and every proposal in one table">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="How long each stage takes" sub="Median business days spent in a stage before moving on">
            <div className="h-[220px]">
              <ResponsiveContainer>
                <BarChart data={data.stage_time.map((s: any) => ({ ...s, label: SHORT[s.stage] }))} layout="vertical" margin={{ left: 8, right: 24 }} barSize={26}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" {...AXIS} />
                  <YAxis type="category" dataKey="label" {...AXIS} width={110} />
                  <Tooltip content={<ChartTip unit=" days" />} />
                  <Bar dataKey="median_bd" name="Median" fill={c["series-1"]} radius={RADIUS_RIGHT} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Proposals started each month, and how they ended" sub="Last 12 months">
            <div className="h-[220px]">
              <ResponsiveContainer>
                <BarChart data={data.created_by_month} margin={{ left: -16, right: 6, top: 8 }} barSize={22}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" {...AXIS} tickFormatter={fmtMonth} />
                  <YAxis {...AXIS} allowDecimals={false} />
                  <Tooltip content={<ChartTip fmtLabel={fmtMonth} />} />
                  <Bar dataKey="won" name="Won" stackId="a" fill={c.good} stroke={c.surface} strokeWidth={1} />
                  <Bar dataKey="closed" name="Lost" stackId="a" fill={c.neutral} stroke={c.surface} strokeWidth={1} />
                  <Bar dataKey="open" name="Still open" stackId="a" fill={c["seq-4"]} stroke={c.surface} strokeWidth={1} radius={RADIUS_TOP} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{ label: "Won", color: c.good }, { label: "Lost", color: c.neutral }, { label: "Still open", color: c["seq-4"] }]} />
          </Card>
        </div>
        <Card className="mt-5" title="Every proposal" pad={false}
          right={<input className="input !w-[240px]" placeholder="Search title, client, job #" value={q} onChange={(e) => setQ(e.target.value)} />}>
          <ProposalTable rows={rows} />
        </Card>
      </Details>
    </div>
  );
}

function ProposalTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-auto max-h-[520px]">
      <table className="w-full">
        <thead className="sticky top-0 bg-surface-card"><tr><th className="th">Proposal</th><th className="th">Stage</th><th className="th text-right">Fee</th>
          <th className="th text-right">Days in stage</th><th className="th">Started</th><th className="th">Owner</th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id} className="hover:bg-surface-rowhover">
            <td className="td"><div className="font-semibold">{p.title.replace(" - engineering services", "")}</div><div className="text-[14px] text-brand-gray">{p.job_number} · {p.client_name}</div></td>
            <td className="td whitespace-nowrap">{SHORT[p.status]}</td>
            <td className="td text-right num">{fmtMoney(p.fee_total)}</td>
            <td className={clsx("td text-right num", p.stuck && "text-st-critical font-semibold")}>{OPEN.includes(p.status) ? p.days_in_stage : "—"}</td>
            <td className="td num whitespace-nowrap">{fmtDate(p.created_d)}</td>
            <td className="td text-brand-gray">{p.owner_name}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

/** Sold work plus open proposals (if all won), against the hours each team has. */
function StaffingCheck({ plan }: { plan: any }) {
  const c = useChartColors();
  const discs = ["Electrical", "Civil", "Structural"];
  const pk = plan.peak;
  return (
    <Card className="mt-5" title="Can we staff what we're bidding?"
      sub={`Hours needed each month as a % of what each team has (${Math.round(plan.billable_share * 100)}% of working time). Dark: work already sold. Light: open proposals, if they are all won, from the start dates they name.`}>
      {pk.total_pct > 100 && (
        <div className="mb-4 rounded-lg border border-st-critical/40 bg-st-critical/5 px-4 py-3 text-[15.5px]">
          <b>{pk.discipline}</b> would need <b>{pk.total_pct}%</b> of its hours in {fmtMonth(pk.month)} if the open proposals are won as dated.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {discs.map((d) => {
          const rows = plan.rows.filter((r: any) => r.discipline === d).map((r: any) => ({
            month: r.month, sold: r.sold_pct, extra: Math.max(0, (r.total_pct ?? 0) - (r.sold_pct ?? 0)), total: r.total_pct }));
          return (
            <div key={d}>
              <div className="text-[16px] font-semibold mb-1">{d}</div>
              <div className="h-[200px]">
                <ResponsiveContainer>
                  <BarChart data={rows} margin={{ left: -18, right: 6, top: 8 }} barSize={22}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="month" {...AXIS} tickFormatter={(m) => fmtMonth(m).slice(0, 3)} />
                    <YAxis {...AXIS} unit="%" domain={[0, 130]} ticks={[0, 50, 100]} />
                    <ReferenceLine y={100} stroke={c.critical} strokeDasharray="4 3" />
                    <Tooltip content={<ChartTip fmtLabel={fmtMonth} unit="%" />} />
                    <Bar dataKey="sold" name="Sold work" stackId="a" fill={c["series-1"]} />
                    <Bar dataKey="extra" name="Open proposals, if won" stackId="a" fill={c["seq-3"]} radius={RADIUS_TOP} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[14.5px] text-brand-gray mt-3">Proposal hours are a rule-of-thumb estimate from each proposal's size and type.</p>
    </Card>
  );
}
