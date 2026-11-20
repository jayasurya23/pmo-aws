import { createContext, ReactNode, useCallback, useContext, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/** Global filters live in the URL, so every view (and every scenario link in the
 *  demo script) is a shareable deep link. Same semantics as the API's Filters. */
export interface Filters {
  portfolios: number[];
  clients: number[];
  disciplines: string[];
  pms: number[];
  lookahead_days: number;
  trend_weeks: number;
  weeks: number;
}

const DEFAULTS: Filters = { portfolios: [], clients: [], disciplines: [], pms: [], lookahead_days: 28, trend_weeks: 26, weeks: 10 };

interface Ctx {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  clear: () => void;
  query: string;
  active: number;
}
const FilterCtx = createContext<Ctx | null>(null);

const ints = (v: string | null) => (v ? v.split(",").map(Number).filter((x) => !Number.isNaN(x)) : []);
const strs = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const filters: Filters = useMemo(
    () => ({
      portfolios: ints(sp.get("portfolios")),
      clients: ints(sp.get("clients")),
      disciplines: strs(sp.get("disciplines")),
      pms: ints(sp.get("pms")),
      lookahead_days: Number(sp.get("lookahead_days") || DEFAULTS.lookahead_days),
      trend_weeks: Number(sp.get("trend_weeks") || DEFAULTS.trend_weeks),
      weeks: Number(sp.get("weeks") || DEFAULTS.weeks),
    }),
    [sp],
  );
  const set = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch };
      const out = new URLSearchParams();
      (Object.keys(next) as (keyof Filters)[]).forEach((k) => {
        const v = next[k];
        if (Array.isArray(v)) {
          if (v.length) out.set(k, v.join(","));
        } else if (v !== DEFAULTS[k]) out.set(k, String(v));
      });
      setSp(out, { replace: true });
    },
    [filters, setSp],
  );
  const clear = useCallback(() => setSp(new URLSearchParams(), { replace: true }), [setSp]);
  const query = useMemo(() => toQuery(filters), [filters]);
  const active = filters.portfolios.length + filters.clients.length + filters.disciplines.length + filters.pms.length;
  return <FilterCtx.Provider value={{ filters, set, clear, query, active }}>{children}</FilterCtx.Provider>;
}

export function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.portfolios.length) p.set("portfolios", f.portfolios.join(","));
  if (f.clients.length) p.set("clients", f.clients.join(","));
  if (f.disciplines.length) p.set("disciplines", f.disciplines.join(","));
  if (f.pms.length) p.set("pms", f.pms.join(","));
  p.set("lookahead_days", String(f.lookahead_days));
  p.set("trend_weeks", String(f.trend_weeks));
  p.set("weeks", String(f.weeks));
  return p.toString();
}

export function useFilters() {
  const c = useContext(FilterCtx);
  if (!c) throw new Error("FilterProvider missing");
  return c;
}
