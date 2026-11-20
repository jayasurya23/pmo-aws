import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorBox, Legend, Loading, StatePill, Tag } from "@/components/ui";
import { useMeta } from "@/components/meta";
import { useApi } from "@/lib/api";
import { ChartColors, DISCIPLINE_SLOT, STATE_COLOR, useChartColors } from "@/lib/colors";
import { fmtDate, fmtShort } from "@/lib/format";

const day = (s?: string | null) => (s ? new Date(s + "T00:00:00").getTime() : null);

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function axisTicks(t0: number, t1: number) {
  const out: number[] = [];
  const d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= t1) { out.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  return out;
}

function MilestoneTimeline({ ms, asOf, c }: { ms: any[]; asOf: string; c: ChartColors }) {
  const { ref, w } = useWidth();
  const dates = ms.flatMap((m) => [m.baseline_date, m.planned_date, m.actual_date, m.forecast_date]).map(day).filter(Boolean) as number[];
  const t0 = Math.min(...dates, day(asOf)!) - 10 * 864e5, t1 = Math.max(...dates, day(asOf)!) + 12 * 864e5;
  const L = 70, R = 20, rowH = 40, H = ms.length * rowH + 30;
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (w - L - R);
  const diamond = (cx: number, cy: number, r: number) => `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`;
  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={H} role="img" aria-label="Milestone timeline: baseline, planned, actual and projected dates">
        {axisTicks(t0, t1).map((t) => (
          <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={H - 22} stroke={c.grid} />
            <text x={x(t) + 3} y={H - 8} fontSize={10.5} fill={c["text-2"]}>{fmtDate(new Date(t).toISOString().slice(0, 10), "MMM yy")}</text></g>
        ))}
        <line x1={x(day(asOf)!)} x2={x(day(asOf)!)} y1={0} y2={H - 22} stroke={c.critical} strokeWidth={1.5} />
        <text x={x(day(asOf)!) + 4} y={11} fontSize={10.5} fill={c.critical} fontWeight={600}>Today</text>
        {ms.map((m, i) => {
          const cy = 22 + i * rowH;
          const p = day(m.planned_date), b = day(m.baseline_date), a = day(m.actual_date), f = day(m.forecast_date);
          const col = c[STATE_COLOR[m.status]];
          return (
            <g key={m.id}>
              <text x={8} y={cy + 4} fontSize={12} fontWeight={700} fill={c.text}>{m.stage}</text>
              {b && p && b !== p && <line x1={x(b)} x2={x(p)} y1={cy} y2={cy} stroke={c.neutral} strokeDasharray="3 3" />}
              {b && <path d={diamond(x(b), cy, 6)} fill={c.surface} stroke={c.neutral} strokeWidth={1.5}><title>Baseline {m.baseline_date}</title></path>}
              {p && f && f > p && <line x1={x(p)} x2={x(f)} y1={cy} y2={cy} stroke={c.serious} strokeWidth={2} />}
              {p && <path d={diamond(x(p), cy, 7)} fill={a ? c.surface : col} stroke={col} strokeWidth={2}><title>Planned {m.planned_date}</title></path>}
              {f && f > (p || 0) && !a && <path d={diamond(x(f), cy, 7)} fill={c.serious} stroke={c.surface} strokeWidth={2}><title>Projected {m.forecast_date} ({m.slip_bd} bd late)</title></path>}
              {a && <circle cx={x(a)} cy={cy} r={6} fill={a <= (p || 0) ? c.good : c.critical} stroke={c.surface} strokeWidth={2}><title>Actual {m.actual_date}</title></circle>}
              <text x={Math.min(w - 150, x(Math.max(p || 0, f || 0, a || 0)) + 12)} y={cy + 4} fontSize={11} fill={c["text-2"]}>
                {m.status_label}{m.slip_bd ? ` · +${m.slip_bd} bd` : m.variance_bd ? ` · ${m.variance_bd > 0 ? "+" : ""}${m.variance_bd} bd` : ""}{m.revision_count ? ` · rev ${m.revision_count}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function WorkGantt({ items, asOf, c }: { items: any[]; asOf: string; c: ChartColors }) {
  const { ref, w } = useWidth();
  const rows = items.filter((i) => i.planned_start || i.due_date);
  const dates = rows.flatMap((i) => [i.planned_start, i.due_date, i.completed_date]).map(day).filter(Boolean) as number[];
  if (!dates.length) return null;
  const t0 = Math.min(...dates, day(asOf)!) - 5 * 864e5, t1 = Math.max(...dates, day(asOf)!) + 8 * 864e5;
  const L = 200, R = 16, rowH = 22;
  const H = rows.length * rowH + 28;
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (w - L - R);
  return (
    <div ref={ref} className="w-full overflow-hidden">
      <svg width={w} height={H} role="img" aria-label="Work package schedule with progress">
        {axisTicks(t0, t1).map((t) => (
          <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={H - 20} stroke={c.grid} />
            <text x={x(t) + 3} y={H - 6} fontSize={10.5} fill={c["text-2"]}>{fmtDate(new Date(t).toISOString().slice(0, 10), "MMM yy")}</text></g>
        ))}
        <line x1={x(day(asOf)!)} x2={x(day(asOf)!)} y1={0} y2={H - 20} stroke={c.critical} strokeWidth={1.5} />
        {rows.map((it, i) => {
          const y = 4 + i * rowH;
          const s = day(it.planned_start) || day(it.due_date)!, e = day(it.due_date) || s;
          const col = c[DISCIPLINE_SLOT[it.discipline]];
          const pct = it.status === "done" ? 1 : it.percent_complete || 0;
          const done = day(it.completed_date);
          const blocked = it.status === "blocked";
          const bw = Math.max(3, x(e) - x(s));
          return (
            <g key={it.id}>
              <text x={6} y={y + 13} fontSize={11.5} fill={c.text}>{it.stage} · {it.discipline}</text>
              <rect x={x(s)} y={y + 4} width={bw} height={12} rx={4} fill={col} fillOpacity={0.18} />
              <rect x={x(s)} y={y + 4} width={bw * pct} height={12} rx={4} fill={col} />
              {blocked && <rect x={x(s) - 1} y={y + 3} width={bw + 2} height={14} rx={5} fill="none" stroke={c.critical} strokeWidth={2} />}
              {done && <circle cx={x(done)} cy={y + 10} r={4} fill={c.text} stroke={c.surface} strokeWidth={2} />}
              <title>{`${it.name}\n${it.status}${blocked ? ` — ${it.blocked_reason}` : ""}\nPlanned ${it.planned_start} → ${it.due_date}; ${Math.round(pct * 100)}% complete`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Project() {
  const { id } = useParams();
  const { data, error, reload } = useApi(`/projects/${id}`);
  const { meta } = useMeta();
  const c = useChartColors();
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !meta) return <Loading />;
  const p = data.project;
  const open_ms = data.milestones.filter((m: any) => !m.actual_date && m.basis?.length);
  return (
    <div>
      <div className="mb-4">
        <Link to="/delivery" className="link text-[12.5px]">← Delivery & schedule</Link>
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <div>
            <div className="kicker">{p.client_name} · {p.portfolio_name} · job {p.project_number || <Tag tone="warn">no job #</Tag>}</div>
            <h1 className="text-[26px] font-bold tracking-[-0.02em]">{p.name}</h1>
            <div className="text-[13px] text-brand-gray mt-0.5">{p.technology} · {p.size_mw} MW · {p.state} · PM {p.pm_name || <Tag tone="warn">missing in master</Tag>} · kickoff {fmtDate(p.kickoff_date)}</div>
          </div>
          <div className="card px-4 py-2.5 flex items-center gap-5">
            <div><div className="micro">Health</div><StatePill state={p.health} label={p.health_label} /></div>
            <div><div className="micro">Next milestone</div><div className="text-[13px] font-semibold">{p.next_milestone || "—"} <span className="font-normal text-brand-gray">{fmtShort(p.next_planned)}{p.next_forecast && p.next_forecast !== p.next_planned ? ` → ${fmtShort(p.next_forecast)}` : ""}</span></div></div>
            <div><div className="micro">Late milestones</div><div className="text-[13px] font-semibold">{p.late_milestones}</div></div>
            <div><div className="micro">Re-baselines</div><div className="text-[13px] font-semibold">{p.revisions}</div></div>
          </div>
        </div>
      </div>

      <Card title="Milestone timeline — planned vs actual vs projected" sub="Hollow grey ◇ baseline · ◆ planned (status colour) · ● actual (green on time, red late) · orange ◆ projection, with the slip drawn from plan">
        <MilestoneTimeline ms={data.milestones} asOf={meta.as_of} c={c} />
      </Card>

      {open_ms.length > 0 && (
        <Card className="mt-3" title="How each open milestone was projected" sub="The rule's inputs, per discipline — so a PM can challenge the number, not just the colour">
          <div className="grid md:grid-cols-2 gap-3">
            {open_ms.map((m: any) => (
              <div key={m.id} className="rounded-md border border-surface-border p-3">
                <div className="flex justify-between"><b>{m.stage}</b><StatePill state={m.status} label={m.status_label} /></div>
                <div className="text-[12px] text-brand-gray">Planned {fmtDate(m.planned_date)} · projected {fmtDate(m.forecast_date)}{m.slip_bd ? ` (+${m.slip_bd} bd)` : ""}</div>
                <ul className="text-[12px] mt-1.5 space-y-0.5 list-disc pl-4">{m.basis.map((b: string) => <li key={b}>{b}</li>)}</ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-3" title="Work packages — plan, progress and blockers" sub="Track = planned window (Monday timeline column); fill = % complete; red outline = blocked; ● = completed">
        <WorkGantt items={data.work_items} asOf={meta.as_of} c={c} />
        <Legend className="mt-1" items={Object.entries(DISCIPLINE_SLOT).filter(([d]) => data.work_items.some((w: any) => w.discipline === d)).map(([d, k]) => ({ label: d, color: c[k] }))} />
      </Card>

      <Card className="mt-3" title="Work package detail and task history" pad={false} sub="Normalised status beside the original Monday label; expand a row for its status history (UTC timestamps from Monday updates)">
        <table className="w-full"><thead><tr><th className="th">Package</th><th className="th">Status (Monday label)</th><th className="th">Assignee</th><th className="th">Planned</th><th className="th text-right">Hours plan / actual</th><th className="th">Notes</th></tr></thead>
          <tbody>{data.work_items.map((w: any) => (
            <Fragment key={w.id}>
              <tr className="hover:bg-surface-rowhover cursor-pointer" onClick={() => setOpen(open === w.id ? null : w.id)}>
                <td className="td"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c[DISCIPLINE_SLOT[w.discipline]] }} /><b>{w.stage}</b> {w.discipline}</span></td>
                <td className="td text-[12.5px]">{w.status.replace("_", " ")} <span className="text-brand-gray">({w.source_status_label})</span></td>
                <td className="td text-[12.5px]">{w.assignee || <Tag tone="warn">unassigned</Tag>}</td>
                <td className="td num text-[12.5px] whitespace-nowrap">{fmtShort(w.planned_start)} → {fmtShort(w.due_date)}</td>
                <td className="td text-right num text-[12.5px]">{w.planned_hours ?? "—"} / {w.actual_hours ?? <span title="not reported — unknown, not zero">?</span>}</td>
                <td className="td text-[12px]">{w.blocked_reason && <span className="text-st-critical">Blocked: {w.blocked_reason}</span>}{w.depends_on && <div className="text-brand-gray">after {w.depends_on.split(" - ").pop()}</div>}</td>
              </tr>
              {open === w.id && (
                <tr><td colSpan={6} className="px-6 py-2 bg-surface-rowhover">
                  <div className="text-[12px] font-semibold mb-1">History · Monday item {w.external_item_id}</div>
                  {w.history.map((h: any, i: number) => (
                    <div key={i} className="text-[12px] flex gap-3"><span className="num text-brand-gray w-[150px]">{h.at.replace("T", " ").slice(0, 16)} UTC</span>
                      <span>{h.field}: {h.old_value || "—"} → <b>{h.new_value}</b></span>{h.note && <span className="text-brand-gray">· {h.note}</span>}{h.source !== "monday_work_board" && <Tag tone="demo">{h.source}</Tag>}</div>
                  ))}
                </td></tr>
              )}
            </Fragment>
          ))}</tbody></table>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="Deliverable register" pad={false} sub="System of record for 'issued'; drives milestone actual dates">
          <table className="w-full"><thead><tr><th className="th">Document</th><th className="th">Status</th><th className="th">Planned</th><th className="th">Issued</th></tr></thead>
            <tbody>{data.deliverables.map((d: any) => (
              <tr key={d.id}><td className="td text-[12.5px]">{d.doc_number}<div className="text-[11px] text-brand-gray">{d.discipline} {d.stage}</div></td>
                <td className="td text-[12.5px]">{d.status.replace("_", " ")} <span className="text-brand-gray">({d.source_status_label})</span></td>
                <td className="td num text-[12.5px]">{fmtShort(d.planned_issue_date)}</td><td className="td num text-[12.5px]">{fmtShort(d.actual_issue_date)}</td></tr>))}</tbody></table>
        </Card>
        <div className="space-y-3">
          <Card title="Action items from this project's meetings" pad={false}>
            <table className="w-full"><tbody>{data.actions.slice(0, 10).map((a: any) => (
              <tr key={a.id}><td className="td text-[12.5px]">{a.text}<div className="text-[11px] text-brand-gray">Raised {fmtDate(a.meeting_date)} · {a.owner_type === "internal" ? a.owner_name : a.owner_type === "external" ? a.owner : <span className="text-st-critical">unassigned</span>}</div></td>
                <td className="td text-[12px] whitespace-nowrap">{a.status}{a.due_date && <div className="text-brand-gray">due {fmtShort(a.due_date)}</div>}</td></tr>))}</tbody></table>
          </Card>
          <Card title="Capacity bookings (Timeline)" pad={false}>
            <table className="w-full"><tbody>{data.bookings.map((b: any) => (
              <tr key={b.id}><td className="td text-[12.5px]">{b.discipline} {b.milestone}<div className="text-[11px] text-brand-gray">{b.resource || <span className="text-st-critical">unstaffed</span>}{b.resource && !b.resource_active && " (inactive)"} · {b.seniority}</div></td>
                <td className="td num text-[12.5px] whitespace-nowrap">{fmtShort(b.start_date)} → {fmtShort(b.end_date)}</td><td className="td num text-right text-[12.5px]">{Math.round(b.utilization * 100)}%{b.origin === "scenario" && <Tag tone="demo">scenario</Tag>}</td></tr>))}</tbody></table>
          </Card>
          {(data.change_orders.length > 0 || data.exceptions.length > 0) && (
            <Card title="Change orders and data-quality exceptions" pad={false}>
              <table className="w-full"><tbody>
                {data.change_orders.map((co: any) => <tr key={"c" + co.id}><td className="td text-[12.5px]">CO-{co.co_number} {co.title}</td><td className="td text-[12px]">{co.status}{co.schedule_impact_days ? ` · +${co.schedule_impact_days} bd` : ""}</td></tr>)}
                {data.exceptions.map((e: any) => <tr key={"e" + e.id}><td className="td text-[12.5px]"><Tag tone={e.severity === "error" ? "critical" : "warn"}>{e.rule_code}</Tag> {e.detail}</td><td className="td text-[12px] text-brand-gray">{e.source_key}</td></tr>)}
              </tbody></table>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
