import clsx from "clsx";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMeta } from "@/components/meta";
import { Card, ErrorBox, Kpi, Loading, PageHeader, StatePill } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtShort } from "@/lib/format";

/** One person's view: what a project manager sees when they open PMO 360,
 *  and the short note they would get on Monday morning. */
export default function MyWeek() {
  const { meta } = useMeta();
  const [params, setParams] = useSearchParams();
  const projects = useApi<any>("/drill/active_projects?page=1&page_size=500");
  const actions = useApi<any>("/drill/open_actions?page=1&page_size=500");
  const pms: any[] = meta?.pms ?? [];
  const mine = useMemo(() => {
    if (!projects.data || !actions.data || !pms.length) return null;
    const counts: Record<string, number> = {};
    projects.data.rows.forEach((p: any) => p.pm_name && (counts[p.pm_name] = (counts[p.pm_name] || 0) + 1));
    const busiest = [...pms].sort((a, b) => (counts[b.name] || 0) - (counts[a.name] || 0))[0];
    const who = pms.find((p) => String(p.id) === params.get("as")) ?? busiest;
    const projs = projects.data.rows.filter((p: any) => p.pm_name === who.name)
      .sort((a: any, b: any) => rank(a.health) - rank(b.health) || (b.worst_slip_bd || 0) - (a.worst_slip_bd || 0));
    const ids = new Set(projs.map((p: any) => p.id));
    const acts = actions.data.rows.filter((a: any) => ids.has(a.project_id));
    const overdue = acts.filter((a: any) => (a.days_overdue || 0) > 0).sort((a: any, b: any) => b.days_overdue - a.days_overdue);
    const soon = acts.filter((a: any) => !(a.days_overdue > 0) && a.due_date).sort((a: any, b: any) => a.due_date.localeCompare(b.due_date));
    const noOwner = acts.filter((a: any) => a.owner_type === "unassigned" || a.owner_type === "unresolved");
    return { who, projs, acts, overdue, soon, noOwner };
  }, [projects.data, actions.data, pms, params]);
  if (projects.error || actions.error) return <ErrorBox error={projects.error || actions.error || ""} />;
  if (!mine) return <Loading />;
  const { who, projs, overdue, soon, noOwner } = mine;
  const first = who.name.split(" ")[0];
  const attention = projs.filter((p: any) => p.health === "behind" || p.health === "at_risk");

  return (
    <div className="max-w-[1100px]">
      <PageHeader kicker="A project manager's week" title={`What ${first} sees on Monday morning`}
        sub="The same data as the dashboards, narrowed to one person: their projects, what they owe, and what needs them first."
        right={
          <label className="flex items-center gap-2 text-[15px]">
            <span className="text-brand-gray">View as</span>
            <select className="input !w-auto" value={who.id} onChange={(e) => setParams({ as: e.target.value })}>
              {pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>} />

      <section className="rounded-xl border border-surface-border bg-surface-card shadow-card overflow-hidden anim-rise">
        <div className="px-5 py-3 border-b border-surface-border bg-surface-mute/50 text-[14px] text-brand-gray flex flex-wrap gap-x-4">
          <span><b className="text-brand-black">PMO 360</b> · Monday summary</span><span>To: {who.name}</span>
        </div>
        <div className="px-5 py-4 text-[16.5px] leading-relaxed">
          Good morning {first}. This week: <b>{overdue.length} action{overdue.length === 1 ? "" : "s"} overdue</b>, {soon.length} more due soon
          {noOwner.length ? <>, and <b>{noOwner.length} with no owner</b></> : null}.
          {attention.length ? <> {attention.length === 1 ? "One project needs" : `${attention.length} projects need`} attention first: <b>{attention.slice(0, 2).map((p: any) => p.name).join(" and ")}</b>.</> : <> All your projects are on track.</>}
          <span className="block text-[14.5px] text-brand-gray mt-1">Sent by email or Teams each Monday, so nobody has to remember to log in.</span>
        </div>
      </section>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-5">
        <Kpi label="My projects" value={projs.length} />
        <Kpi label="Need attention" value={attention.length} tone={attention.length ? "warn" : "good"} />
        <Kpi label="Overdue actions" value={overdue.length} tone={overdue.length ? "serious" : "good"} />
        <Kpi label="No owner" value={noOwner.length} tone={noOwner.length ? "critical" : "good"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-5">
        <Card title="My projects" sub="Worst first" pad={false}>
          <table className="w-full"><tbody>{projs.map((p: any) => (
            <tr key={p.id} className="hover:bg-surface-rowhover">
              <td className="td"><Link className="link font-semibold" to={`/projects/${p.id}`}>{p.name}</Link><div className="text-[14px] text-brand-gray">{p.client_name}</div></td>
              <td className="td whitespace-nowrap"><StatePill state={p.health} /></td>
              <td className="td text-[14.5px] whitespace-nowrap">{p.next_milestone ? <>{p.next_milestone} · {fmtShort(p.next_forecast || p.next_planned)}</> : "—"}</td>
            </tr>))}</tbody></table>
        </Card>
        <Card title="What I owe" sub="Overdue first, then due soon" pad={false}>
          <table className="w-full"><tbody>{[...overdue, ...soon].slice(0, 10).map((a: any) => (
            <tr key={a.id}>
              <td className="td text-[15px]">{a.text}<div className="text-[14px] text-brand-gray">{a.project_name} · {a.owner_type === "unassigned" || a.owner_type === "unresolved" ? <span className="text-st-critical">no owner</span> : a.owner_type === "external" ? "client" : a.owner_name}</div></td>
              <td className={clsx("td text-right whitespace-nowrap text-[14.5px] num", a.days_overdue > 0 ? "text-st-critical font-semibold" : "text-brand-gray")}>
                {a.days_overdue > 0 ? `${a.days_overdue} days late` : `due ${fmtShort(a.due_date)}`}</td>
            </tr>))}
            {overdue.length + soon.length === 0 && <tr><td className="td text-brand-gray">Nothing due. </td></tr>}</tbody></table>
        </Card>
      </div>
    </div>
  );
}

const rank = (h: string) => ({ behind: 0, at_risk: 1, unknown: 2, on_track: 3 } as Record<string, number>)[h] ?? 4;
