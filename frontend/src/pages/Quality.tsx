import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, ErrorBox, Kpi, Legend, Loading, PageHeader, SegmentedBar, Tag } from "@/components/ui";
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
  return (
    <div className={loading ? "opacity-70 transition" : "transition"}>
      <PageHeader kicker="Dashboard F · analytics owner and operations administrators" title="Data quality & integration health"
        sub="If the underlying data is unreliable, an attractive dashboard leads to confident wrong decisions. This page shows how fresh every source is, what each load did, and every record the pipeline refused or flagged — down to the raw payload." />

      <div className="card px-4 py-3 mb-3 border-l-[3px] border-l-st-critical text-[13px] flex flex-wrap items-center gap-x-4 gap-y-1">
        <b>Right now:</b>
        {data.freshness.filter((s: any) => s.last_status === "failed").map((s: any) => (
          <span key={s.key}>{s.name} — last run <span className="text-st-critical font-semibold">failed</span> ({s.last_message}); dashboards show its last good extract, {s.age_hours} h old.</span>
        ))}
        <Link className="link" to="/delivery">Overdue-deliverable counts carry this caveat →</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Open exceptions" value={k.open} metric="open_exceptions" tone="warn" sub={<>{k.errors} errors · {k.warnings} warnings · {k.info} info</>} />
        <Kpi label="Records staged" value={k.staged.toLocaleString()} sub="every source record, as received (JSONB + hash)" />
        <Kpi label="Loaded" value={k.load_rate_pct} unit="%" tone="good" sub={`${k.loaded.toLocaleString()} loaded or loaded-with-flag`} />
        <Kpi label="Rejected" value={k.rejected} tone="critical" sub="unmatched, ambiguous or duplicate" />
        <Kpi label="Stale sources" value={k.stale_sources} metric="source_freshness" tone={k.stale_sources ? "critical" : "good"} sub="last good extract older than SLA" />
        <Kpi label="Failed last run" value={k.failed_last_run} tone={k.failed_last_run ? "critical" : "good"} sub="the previous good data is kept" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="Source freshness vs SLA" sub="Bar = hours since the last SUCCESSFUL extract; tick = that source's SLA. A failed run never refreshes this.">
          <div className="space-y-2.5 mt-1">
            {data.freshness.map((s: any) => {
              const scale = Math.max(...data.freshness.map((x: any) => Math.max(x.age_hours || 0, x.freshness_sla_hours)), 1);
              const col = s.freshness === "fresh" ? c.good : s.freshness === "stale" ? c.warn : c.critical;
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-[12px]"><span>{s.name} <span className="text-brand-gray">· {s.refresh_cadence}</span></span>
                    <span className="num">{s.age_hours} h <span className="text-brand-gray">/ SLA {s.freshness_sla_hours} h</span>{s.last_status === "failed" && <Tag tone="critical">last run failed</Tag>}</span></div>
                  <div className="relative h-2.5 rounded-full bg-surface-mute mt-1">
                    <div className="h-2.5 rounded-full" style={{ width: `${Math.max(1.5, (100 * (s.age_hours || 0)) / scale)}%`, background: col }} />
                    <div className="absolute top-[-3px] h-[16px] w-[2px] bg-brand-black" style={{ left: `${(100 * s.freshness_sla_hours) / scale}%` }} title="SLA" />
                  </div>
                </div>
              );
            })}
          </div>
          <Legend className="mt-3" items={[{ label: "Fresh", color: c.good }, { label: "Stale (≤2× SLA)", color: c.warn }, { label: "Critical", color: c.critical }]} />
        </Card>
        <Card title="Sync history — last 14 days" sub={<>Each cell is one day: green all runs succeeded, red at least one failed. Days before the reporting date are <b>simulated summary history</b> <Tag>labelled</Tag>; the last cells are real pipeline runs.</>}>
          <div className="overflow-auto">
            <table className="border-separate" style={{ borderSpacing: 3 }}>
              <thead><tr><th />{days.map((d) => <th key={d} className="text-[10px] text-brand-gray font-medium px-0.5">{fmtDate(d, "d")}</th>)}</tr></thead>
              <tbody>{data.freshness.map((s: any) => (
                <tr key={s.key}><td className="text-[12px] pr-2 whitespace-nowrap">{s.name}</td>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="What each source load did (latest real run)" sub="Staged → loaded clean / loaded with a flag / rejected. Click a source to filter the exception list.">
          <div className="space-y-2.5">
            {data.funnel.map((f: any) => {
              const clean = f.rows_loaded - f.rows_flagged;
              const tot = Math.max(1, f.rows_extracted);
              return (
                <button key={f.run_id} className={clsx("w-full text-left rounded-md px-1.5 py-1 hover:bg-surface-rowhover", source === f.source_key && "bg-surface-rowhover")} onClick={() => setSource(source === f.source_key ? null : f.source_key)}>
                  <div className="flex justify-between text-[12px]"><span>{names[f.source_key]} {f.status === "failed" && <Tag tone="critical">failed</Tag>}</span>
                    <span className="num text-brand-gray">{f.rows_extracted.toLocaleString()} staged · {f.rows_flagged} flagged · {f.rows_rejected} rejected</span></div>
                  {f.status === "failed" ? <div className="text-[11.5px] text-st-critical mt-0.5">{f.message}</div> : (
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
        <Card title="Open exceptions by validation rule" sub="Each rule states what it does and which dashboard numbers it protects. Click to list the records.">
          <div className="space-y-1.5 max-h-[420px] overflow-auto pr-1">
            {rules.map((r: any) => (
              <button key={r.code} onClick={() => setRule(rule === r.code ? null : r.code)} className={clsx("w-full text-left rounded-md px-1.5 py-1 hover:bg-surface-rowhover", rule === r.code && "bg-surface-rowhover")}>
                <div className="flex justify-between gap-2 text-[12px]"><span className="truncate"><b>{r.name}</b> <span className="text-brand-gray">· {r.action.replace("_", " ")}</span></span><span className="num font-semibold">{r.open}</span></div>
                <div className="h-1.5 rounded-full bg-surface-mute mt-0.5"><div className="h-1.5 rounded-full" style={{ width: `${(100 * r.open) / maxRule}%`, background: sevColor[r.severity] }} /></div>
                <div className="text-[11px] text-brand-gray mt-0.5 truncate">Affects: {r.affects.join(" · ")}</div>
              </button>
            ))}
          </div>
          <Legend className="mt-2" items={[{ label: "Error", color: c.critical }, { label: "Warning", color: c.warn }, { label: "Info", color: c["seq-4"] }]} />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="How Outlook meetings were matched to portfolios" sub="Production rules: manual link → client attendee email (internal colleagues never indexed) → subject contains portfolio/client name">
          <SegmentedBar parts={data.calendar_matches.map((m: any) => ({ key: m.match_method, label: { attendee: "Client attendee email", subject: "Subject text", internal: "Internal-only (ignored by design)", unmatched: "Unmatched external", link: "Manual link" }[m.match_method as string] || m.match_method, value: m.n, color: methodColor[m.match_method] || c.neutral }))} />
        </Card>
        <Card title="How external IDs were matched" sub="Exact normalised-name match (production rule) vs a confirmed manual crosswalk entry. No fuzzy matching, by design.">
          <table className="w-full"><thead><tr><th className="th">Source</th><th className="th">Method</th><th className="th text-right">Links</th></tr></thead>
            <tbody>{data.id_map.map((r: any, i: number) => <tr key={i}><td className="td">{names[r.source_key] || r.source_key}</td><td className="td"><Tag tone={r.match_method === "manual" ? "adapted" : "prod"}>{r.match_method}</Tag></td><td className="td text-right num">{r.n}</td></tr>)}</tbody></table>
        </Card>
      </div>

      <ExceptionTable rule={rule} source={source} setRule={setRule} setSource={setSource} rules={data.by_rule} names={names} />
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
    const p = new URLSearchParams({ page: String(page), page_size: "15" });
    if (rule) p.set("rule", rule);
    if (source) p.set("source", source);
    if (q) p.set("q", q);
    apiGet(`/quality/exceptions?${p}`).then(setRows);
  }, [rule, source, q, page]);
  return (
    <Card className="mt-3" title="Exceptions — drill from an anomaly to the affected record" pad={false}
      sub="Every row links to the raw source payload exactly as received, and to the project it affects."
      right={<div className="flex items-center gap-2">
        {(rule || source) && <button className="link text-[12px]" onClick={() => { setRule(null); setSource(null); }}>Clear filter</button>}
        <select className="input !w-[220px]" value={rule || ""} onChange={(e) => setRule(e.target.value || null)}>
          <option value="">All rules</option>{rules.filter((r: any) => r.open).map((r: any) => <option key={r.code} value={r.code}>{r.name} ({r.open})</option>)}</select>
        <input className="input !w-[200px]" placeholder="Search detail or id" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
      {rows && (
        <>
          <table className="w-full"><thead><tr><th className="th">Severity</th><th className="th">Rule</th><th className="th">Source</th><th className="th">Detail</th><th className="th">Project</th><th className="th">Record</th></tr></thead>
            <tbody>{rows.rows.map((e: any) => (
              <tr key={e.id} className="hover:bg-surface-rowhover">
                <td className="td"><Tag tone={e.severity === "error" ? "critical" : e.severity === "warning" ? "warn" : "neutral"}>{e.severity}</Tag></td>
                <td className="td text-[12.5px] whitespace-nowrap">{e.rule_name}</td>
                <td className="td text-[12px] text-brand-gray whitespace-nowrap">{names[e.source_key] || e.source_key}</td>
                <td className="td text-[12.5px] min-w-[380px]">{e.detail}</td>
                <td className="td text-[12.5px]">{e.project_id ? <Link className="link" to={`/projects/${e.project_id}`}>{e.project_name}</Link> : "—"}</td>
                <td className="td">{e.raw_record_id ? <button className="link text-[12px] whitespace-nowrap" onClick={() => apiGet(`/quality/raw/${e.raw_record_id}`).then(setRaw)}>Raw payload ({e.load_status})</button> : <span className="text-[12px] text-brand-gray">file-level</span>}</td>
              </tr>))}</tbody></table>
          <div className="px-4 py-2.5 flex items-center gap-2 text-[12.5px] border-t border-surface-border">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span className="text-brand-gray">{rows.total} exceptions · page {page} of {Math.max(1, Math.ceil(rows.total / 15))}</span>
            <button className="btn-ghost" disabled={page * 15 >= rows.total} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </>
      )}
      {raw && (
        <div className="fixed inset-0 z-[70] bg-black/30 grid place-items-center p-6" onClick={() => setRaw(null)}>
          <div className="card w-[min(860px,95vw)] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-surface-border flex justify-between gap-3">
              <div><div className="kicker">Raw source record · staged as received</div>
                <div className="text-[13px] mt-0.5">{names[raw.source_key] || raw.source_key} · {raw.entity_type} <b>{raw.external_id}</b> · load status <b>{raw.load_status}</b>{raw.core_table && <> → {raw.core_table} #{raw.core_id}</>}</div>
                <div className="text-[11px] text-brand-gray">Run {fmtDate(raw.started_at?.slice(0, 10))} · file {raw.extract_file} · sha256 {raw.record_hash.slice(0, 16)}…</div></div>
              <button className="btn-ghost" onClick={() => setRaw(null)}>Close</button>
            </div>
            <pre className="p-4 overflow-auto text-[11.5px] leading-snug bg-surface-mute/40 whitespace-pre-wrap">{JSON.stringify(raw.payload, null, 2)}</pre>
          </div>
        </div>
      )}
    </Card>
  );
}
