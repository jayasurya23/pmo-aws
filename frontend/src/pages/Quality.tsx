import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Details, ErrorBox, Kpi, Legend, Loading, PageHeader, SegmentedBar, Tag, Takeaway } from "@/components/ui";
import { apiGet, useApi } from "@/lib/api";
import { useChartColors } from "@/lib/colors";
import { fmtDate } from "@/lib/format";

const SEV_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

export default function Quality() {
  const { data, error, reload, loading } = useApi(`/quality`);
  const c = useChartColors();
  const [rule, setRule] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const sevColor: Record<string, string> = { error: c.critical, warning: c.warn, info: c["seq-4"] };
  const names: Record<string, string> = Object.fromEntries(data.freshness.map((s: any) => [s.key, s.name]));
  const days = Array.from(new Set(data.history.map((h: any) => h.day))).sort() as string[];
  const rules = data.by_rule.filter((r: any) => r.open > 0).sort((a: any, b: any) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.open - a.open);
  const maxRule = Math.max(...rules.map((r: any) => r.open), 1);
  const methodColor: Record<string, string> = { attendee: c["series-1"], subject: c["series-3"], internal: c.neutral, unmatched: c.critical, link: c["series-2"] };
  const failed = data.freshness.filter((s: any) => s.last_status === "failed");
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Data quality · for whoever owns the numbers" title="Can these numbers be trusted today?"
        sub="How fresh each source is, what each load did, and every record that was refused or flagged, down to the raw data." />

      <Takeaway>
        {failed.map((s: any) => <span key={s.key}><b>{s.name}</b> failed its last load ({/schema/i.test(s.last_message || "") ? "a column was renamed in the export file" : s.last_message}), so its numbers are from the last good load, {s.age_hours} hours old. </span>)}
        <b>{k.open} records are flagged</b> for review and <b>{k.rejected} were refused</b>, out of {k.staged.toLocaleString()} received.
      </Takeaway>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Flagged records" value={k.open} metric="open_exceptions" tone="warn" sub={<>{k.errors} errors, {k.warnings} warnings</>} />
        <Kpi label="Records received" value={k.staged.toLocaleString()} sub="each kept exactly as received" />
        <Kpi label="Refused" value={k.rejected} tone="critical" sub="unmatched, ambiguous or duplicate" />
        <Kpi label="Stale sources" value={k.stale_sources} metric="source_freshness" tone={k.stale_sources ? "critical" : "good"} sub="older than their target" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-5">
        <Card title="How fresh is each source?" sub="Hours since each source last loaded successfully. The black tick is its target. A failed run does not count.">
          <div className="space-y-2.5 mt-1">
            {data.freshness.map((s: any) => {
              const scale = Math.max(...data.freshness.map((x: any) => Math.max(x.age_hours || 0, x.freshness_sla_hours)), 1);
              const col = s.freshness === "fresh" ? c.good : s.freshness === "stale" ? c.warn : c.critical;
              return (
                <div key={s.key}>
                  <div className="flex justify-between gap-2 text-[14.5px]"><span>{s.name} <span className="text-brand-gray">· {s.refresh_cadence}</span></span>
                    <span className="num">{s.age_hours} h <span className="text-brand-gray">/ target {s.freshness_sla_hours} h</span>{s.last_status === "failed" && <Tag tone="critical">last run failed</Tag>}</span></div>
                  <div className="relative h-2.5 rounded-full bg-surface-mute mt-1">
                    <div className="h-2.5 rounded-full" style={{ width: `${Math.max(1.5, (100 * (s.age_hours || 0)) / scale)}%`, background: col }} />
                    <div className="absolute top-[-3px] h-[16px] w-[2px] bg-brand-black" style={{ left: `${(100 * s.freshness_sla_hours) / scale}%` }} title="SLA" />
                  </div>
                </div>
              );
            })}
          </div>
          <Legend className="mt-3" items={[{ label: "Fresh", color: c.good }, { label: "Stale", color: c.warn }, { label: "Critical", color: c.critical }]} />
        </Card>
        <Card title="Flagged records, by check" sub="Click a rule to list its records below.">
          <div className="space-y-1.5 max-h-[420px] overflow-auto pr-1">
            {rules.map((r: any) => (
              <button key={r.code} onClick={() => setRule(rule === r.code ? null : r.code)} className={clsx("w-full text-left rounded-md px-1.5 py-1 hover:bg-surface-rowhover", rule === r.code && "bg-surface-rowhover")}>
                <div className="flex justify-between gap-2 text-[13.5px]"><span className="truncate"><b>{r.name}</b> <span className="text-brand-gray">· {r.action.replace("_", " ")}</span></span><span className="num font-semibold">{r.open}</span></div>
                <div className="h-1.5 rounded-full bg-surface-mute mt-0.5"><div className="h-1.5 rounded-full" style={{ width: `${(100 * r.open) / maxRule}%`, background: sevColor[r.severity] }} /></div>
                <div className="text-[13px] text-brand-gray mt-0.5 truncate">Affects: {r.affects.join(", ")}</div>
              </button>
            ))}
          </div>
          <Legend className="mt-2" items={[{ label: "Error", color: c.critical }, { label: "Warning", color: c.warn }, { label: "Info", color: c["seq-4"] }]} />
        </Card>
      </div>

      <ExceptionTable rule={rule} source={source} setRule={setRule} setSource={setSource} rules={data.by_rule} names={names} />
      <Details hint="Load history, what each load did, and how records were matched across systems">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Kpi label="Loaded" value={k.load_rate_pct} unit="%" tone="good" sub={`${k.loaded.toLocaleString()} records`} />
        <Kpi label="Failed last run" value={k.failed_last_run} tone={k.failed_last_run ? "critical" : "good"} sub="previous good data is kept" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="What the latest load did" sub="Records received, loaded, flagged or refused. Click a source to filter the list below.">
          <div className="space-y-2.5">
            {data.funnel.map((f: any) => {
              const clean = f.rows_loaded - f.rows_flagged;
              const tot = Math.max(1, f.rows_extracted);
              return (
                <button key={f.run_id} className={clsx("w-full text-left rounded-md px-1.5 py-1 hover:bg-surface-rowhover", source === f.source_key && "bg-surface-rowhover")} onClick={() => setSource(source === f.source_key ? null : f.source_key)}>
                  <div className="flex justify-between text-[13.5px]"><span>{names[f.source_key]} {f.status === "failed" && <Tag tone="critical">failed</Tag>}</span>
                    <span className="num text-brand-gray">{f.rows_extracted.toLocaleString()} staged · {f.rows_flagged} flagged · {f.rows_rejected} rejected</span></div>
                  {f.status === "failed" ? <div className="text-[13px] text-st-critical mt-0.5">{f.message}</div> : (
                    <div className="flex h-2.5 gap-[2px] mt-1">
                      <div className="rounded-l-full" style={{ width: `${(100 * clean) / tot}%`, background: c.good }} />
                      {f.rows_flagged > 0 && <div style={{ width: `${Math.max(0.6, (100 * f.rows_flagged) / tot)}%`, background: c.warn }} />}
                      {f.rows_rejected > 0 && <div className="rounded-r-full" style={{ width: `${Math.max(0.6, (100 * f.rows_rejected) / tot)}%`, background: c.critical }} />}
                    </div>)}
                </button>
              );
            })}
          </div>
          <Legend className="mt-2" items={[{ label: "Loaded clean", color: c.good }, { label: "Loaded with flag", color: c.warn }, { label: "Rejected", color: c.critical }]} />
        </Card>
        <Card title="Load history, last 14 days" sub="Green: every run that day succeeded. Red: at least one failed. Earlier days are summary history; the latest are actual runs.">
          <div className="overflow-auto">
            <table className="border-separate" style={{ borderSpacing: 3 }}>
              <thead><tr><th />{days.map((d) => <th key={d} className="text-[12px] text-brand-gray font-medium px-0.5">{fmtDate(d, "d")}</th>)}</tr></thead>
              <tbody>{data.freshness.map((s: any) => (
                <tr key={s.key}><td className="text-[13.5px] pr-2 whitespace-nowrap">{s.name}</td>
                  {days.map((d) => {
                    const h = data.history.find((x: any) => x.source_key === s.key && x.day === d);
                    const bg = !h ? "transparent" : h.failed ? c.critical : c.good;
                    return <td key={d} title={h ? `${d}: ${h.ok}/${h.runs} succeeded${h.simulated ? " (simulated history)" : ""}` : `${d}: no run`}
                      className="w-[22px] h-[18px] rounded-[3px]" style={{ background: bg, opacity: h?.simulated ? 0.55 : 1, outline: !h ? `1px dashed ${c.grid}` : undefined }} />;
                  })}</tr>))}</tbody>
            </table>
          </div>
          <Legend className="mt-2" items={[{ label: "All runs succeeded", color: c.good, shape: "square" }, { label: "A run failed", color: c.critical, shape: "square" }]} />
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-5">
        <Card title="How calendar meetings were matched to projects" sub="By a manual link, then a client attendee's email, then the meeting subject. Internal-only meetings are ignored.">
          <SegmentedBar parts={data.calendar_matches.map((m: any) => ({ key: m.match_method, label: { attendee: "Client attendee email", subject: "Subject text", internal: "Internal-only (ignored by design)", unmatched: "Unmatched external", link: "Manual link" }[m.match_method as string] || m.match_method, value: m.n, color: methodColor[m.match_method] || c.neutral }))} />
        </Card>
        <Card title="How records were linked across systems" sub="Exact name matches, or a confirmed manual link. No fuzzy matching.">
          <table className="w-full"><thead><tr><th className="th">Source</th><th className="th">Method</th><th className="th text-right">Links</th></tr></thead>
            <tbody>{data.id_map.map((r: any, i: number) => <tr key={i}><td className="td">{names[r.source_key] || r.source_key}</td><td className="td">{r.match_method === "manual" ? "Manual link" : "Exact name match"}</td><td className="td text-right num">{r.n}</td></tr>)}</tbody></table>
        </Card>
      </div>
      </Details>
    </div>
  );
}

function ExceptionTable({ rule, source, setRule, setSource, rules, names }: any) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any>(null);
  const [raw, setRaw] = useState<any>(null);
  useEffect(() => setPage(1), [rule, source, q]);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "8" });
    if (rule) p.set("rule", rule);
    if (source) p.set("source", source);
    if (q) p.set("q", q);
    apiGet(`/quality/exceptions?${p}`).then(setRows);
  }, [rule, source, q, page]);
  return (
    <Card className="mt-5" title="Flagged records" pad={false}
      sub="Each row opens the source record exactly as it was received, and links to the project it affects."
      right={<div className="flex flex-wrap items-center gap-2">
        {(rule || source) && <button className="link text-[13.5px]" onClick={() => { setRule(null); setSource(null); }}>Clear filter</button>}
        <select className="input !w-[220px]" value={rule || ""} onChange={(e) => setRule(e.target.value || null)}>
          <option value="">All checks</option>{rules.filter((r: any) => r.open).map((r: any) => <option key={r.code} value={r.code}>{r.name} ({r.open})</option>)}</select>
        <input className="input !w-[200px]" placeholder="Search detail or id" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
      {rows && (
        <>
          <table className="w-full"><thead><tr><th className="th">Severity</th><th className="th">Check</th><th className="th">Source</th><th className="th">Detail</th><th className="th">Project</th><th className="th">Record</th></tr></thead>
            <tbody>{rows.rows.map((e: any) => (
              <tr key={e.id} className="hover:bg-surface-rowhover">
                <td className="td"><Tag tone={e.severity === "error" ? "critical" : e.severity === "warning" ? "warn" : "neutral"}>{e.severity}</Tag></td>
                <td className="td text-[14px] whitespace-nowrap">{e.rule_name}</td>
                <td className="td text-[13.5px] text-brand-gray whitespace-nowrap">{names[e.source_key] || e.source_key}</td>
                <td className="td text-[14px] min-w-[380px]">{e.detail}</td>
                <td className="td text-[14px]">{e.project_id ? <Link className="link" to={`/projects/${e.project_id}`}>{e.project_name}</Link> : "—"}</td>
                <td className="td">{e.raw_record_id ? <button className="link text-[13.5px] whitespace-nowrap" onClick={() => apiGet(`/quality/raw/${e.raw_record_id}`).then(setRaw)}>View source record</button> : <span className="text-[13.5px] text-brand-gray">file-level</span>}</td>
              </tr>))}</tbody></table>
          <div className="px-4 py-2.5 flex items-center gap-2 text-[14px] border-t border-surface-border">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span className="text-brand-gray">{rows.total} records · page {page} of {Math.max(1, Math.ceil(rows.total / 8))}</span>
            <button className="btn-ghost" disabled={page * 8 >= rows.total} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </>
      )}
      {raw && (
        <div className="fixed inset-0 z-[70] bg-black/30 grid place-items-center p-6" onClick={() => setRaw(null)}>
          <div className="card w-[min(860px,95vw)] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-surface-border flex justify-between gap-3">
              <div><div className="kicker">Source record, exactly as received</div>
                <div className="text-[14.5px] mt-0.5">{names[raw.source_key] || raw.source_key} · {raw.entity_type} <b>{raw.external_id}</b> · load status <b>{raw.load_status}</b>{raw.core_table && <> → {raw.core_table} #{raw.core_id}</>}</div>
                <div className="text-[13.5px] text-brand-gray">Loaded {fmtDate(raw.started_at?.slice(0, 10))} from {raw.extract_file}</div></div>
              <button className="btn-ghost" onClick={() => setRaw(null)}>Close</button>
            </div>
            <pre className="p-4 overflow-auto text-[13px] leading-snug bg-surface-mute/40 whitespace-pre-wrap">{JSON.stringify(raw.payload, null, 2)}</pre>
          </div>
        </div>
      )}
    </Card>
  );
}
