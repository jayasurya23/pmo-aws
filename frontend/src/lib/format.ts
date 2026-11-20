import { format, parseISO } from "date-fns";

export const fmtDate = (v?: string | null, pattern = "d MMM yyyy") => (v ? format(parseISO(v), pattern) : "—");
export const fmtShort = (v?: string | null) => fmtDate(v, "d MMM");
export const fmtMonth = (v?: string | null) => (v ? format(parseISO(v.length === 7 ? `${v}-01` : v), "MMM yy") : "—");
export const fmtNum = (v?: number | null, d = 0) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d });
export function fmtCompact(v?: number | null) {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}K`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return fmtNum(v);
}
export const fmtMoney = (v?: number | null) => (v === null || v === undefined ? "—" : `$${fmtCompact(v)}`);
export const fmtPct = (v?: number | null) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
