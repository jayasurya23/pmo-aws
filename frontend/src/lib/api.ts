import { useCallback, useEffect, useRef, useState } from "react";

/** Two modes:
 *  - live (default): calls the FastAPI backend under /api
 *  - static (VITE_STATIC=1): answers the same paths from JSON files exported by
 *    `python -m pipeline.export_static`, so the site can be hosted without a server.
 *    Same numbers, computed by the same API code at export time. */
export const STATIC = import.meta.env.VITE_STATIC === "1";
/** Some hosts (e.g. sandboxed viewers) block downloads the page starts itself. */
export const NO_DOWNLOAD = import.meta.env.VITE_NO_DOWNLOAD === "1";
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "/api";
const DATA = `${import.meta.env.BASE_URL}static-data/`;

export async function apiGet<T = any>(path: string): Promise<T> {
  if (STATIC) return staticGet(path) as Promise<T>;
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
export async function apiPost<T = any>(path: string): Promise<T> {
  if (STATIC) return staticPost(path) as Promise<T>;
  const r = await fetch(`${BASE}${path}`, { method: "POST" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
export const apiUrl = (path: string) => `${BASE}${path}`;

/** Fetch with loading/error state; re-runs when `path` changes. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    apiGet<T>(path)
      .then((d) => {
        if (id === seq.current) setData(d);
      })
      .catch((e) => {
        if (id === seq.current) setError(String(e.message || e));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}

// ------------------------------------------------------------------ static mode
const cache = new Map<string, Promise<any>>();
function load(name: string): Promise<any> {
  if (!cache.has(name)) {
    cache.set(name, fetch(DATA + name).then((r) => {
      if (!r.ok) throw new Error(`Snapshot file missing: ${name}`);
      return r.json();
    }));
  }
  return cache.get(name)!;
}

const VARIANT: Record<string, string> = {
  Electrical: "electrical", Civil: "civil", Structural: "structural",
};
function variant(p: URLSearchParams) {
  const d = (p.get("disciplines") || "").split(",").filter(Boolean);
  return d.length === 1 && VARIANT[d[0]] ? VARIANT[d[0]] : "all";
}

/** Same semantics as backend app/metrics/drill.py::apply_facets. */
function facetAndSearch(rows: any[], p: URLSearchParams) {
  let out = rows;
  p.forEach((v, k) => {
    if (k.startsWith("facet_")) out = out.filter((r) => String(r[k.slice(6)]) === v);
  });
  const q = (p.get("q") || "").toLowerCase();
  if (q) out = out.filter((r) => Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(q)));
  return out;
}
function paged(rows: any[], p: URLSearchParams) {
  const page = Number(p.get("page") || 1), size = Number(p.get("page_size") || 25);
  return { total: rows.length, page, page_size: size, rows: rows.slice((page - 1) * size, page * size) };
}

const applied: Record<string, boolean> = {};
function scenarioState(k: string) {
  try { return localStorage.getItem(`pmo-demo-${k}`) === "1"; } catch { return !!applied[k]; }
}
function setScenario(k: string, on: boolean) {
  applied[k] = on;
  try { localStorage.setItem(`pmo-demo-${k}`, on ? "1" : "0"); } catch { /* storage unavailable: in-memory only */ }
}

async function staticGet(path: string): Promise<any> {
  const [p, qs = ""] = path.split("?");
  const params = new URLSearchParams(qs);
  const simple: Record<string, string> = {
    "/meta": "meta.json", "/meta/definitions": "definitions.json", "/pipeline/status-map": "status_map.json",
    "/quality": "quality.json", "/health": "manifest.json",
  };
  if (simple[p]) return load(simple[p]);
  let m = p.match(/^\/(executive|delivery|capacity|actions|commercial)$/);
  if (m) return load(`${m[1]}_${variant(params)}.json`);
  m = p.match(/^\/drill\/(\w+)$/);
  if (m) {
    const all = await load(`drill_${variant(params)}.json`);
    const defs = await load("definitions.json");
    const rows = facetAndSearch(all[m[1]] || [], params);
    return { metric: m[1], definition: defs.metrics[m[1]] || null, ...paged(rows, params) };
  }
  if (p === "/quality/exceptions") {
    let rows: any[] = await load("exceptions.json");
    for (const [k, col] of [["rule", "rule_code"], ["source", "source_key"], ["severity", "severity"]]) {
      const v = params.get(k);
      if (v) rows = rows.filter((r) => r[col] === v);
    }
    const q = (params.get("q") || "").toLowerCase();
    if (q) rows = rows.filter((r) => `${r.detail} ${r.external_id || ""}`.toLowerCase().includes(q));
    return paged(rows, params);
  }
  m = p.match(/^\/quality\/raw\/(\d+)$/);
  if (m) return (await load("raw.json"))[m[1]];
  if (p === "/projects") {
    const q = (params.get("q") || "").toLowerCase();
    const idx: any[] = await load("projects_index.json");
    return idx.filter((r) => !q || [r.name, r.portfolio_name, r.client_name, r.project_number || ""].some((s: string) => s.toLowerCase().includes(q))).slice(0, 15);
  }
  m = p.match(/^\/projects\/(\d+)$/);
  if (m) return (await load(`projects_${Number(m[1]) % 8}.json`))[m[1]];
  if (p === "/scenarios/outcomes") {
    const s = await load("scenarios.json");
    return { s1: s.s1.applied.current, s2: s.s2.applied.current };
  }
  if (p === "/scenarios") {
    const s = await load("scenarios.json");
    return ["s1", "s2"].map((k) => (scenarioState(k) ? s[k].applied : s[k].before));
  }
  throw new Error(`Not available in the static snapshot: ${path}`);
}

async function staticPost(path: string): Promise<any> {
  const m = path.match(/^\/scenarios\/(s1|s2)\/(apply|reset)$/);
  if (!m) throw new Error(`Not available in the static snapshot: ${path}`);
  setScenario(m[1], m[2] === "apply");
  const s = await load("scenarios.json");
  return { status: m[2] === "apply" ? "applied" : "reset", ...(m[2] === "apply" ? s[m[1]].applied : s[m[1]].before) };
}

/** Client-side CSV for the static site (the live API streams it). */
export function rowsToCsv(rows: any[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]).filter((c) => c !== "basis");
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
