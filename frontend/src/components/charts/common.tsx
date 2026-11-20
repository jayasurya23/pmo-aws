import { ReactNode } from "react";
import { fmtNum } from "@/lib/format";

/** Mark specs (data-viz method): bars <= 24px, 4px rounded data-end, 2px lines,
 *  hairline recessive grid, 2px surface gap between stacked fills. */
export const BAR_SIZE = 18;
export const RADIUS_TOP: [number, number, number, number] = [4, 4, 0, 0];
export const RADIUS_RIGHT: [number, number, number, number] = [0, 4, 4, 0];
export const AXIS = { tickLine: false, axisLine: false, tick: { fontSize: 12.5 } } as const;

export function ChartTip({ active, payload, label, fmtLabel, unit, rows }: {
  active?: boolean; payload?: any[]; label?: any; fmtLabel?: (l: any) => ReactNode; unit?: string;
  rows?: (p: any[]) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-surface-card border border-surface-border shadow-page px-3 py-2 text-[13.5px] min-w-[150px]">
      <div className="font-semibold mb-1">{fmtLabel ? fmtLabel(label) : label}</div>
      {rows ? rows(payload) : payload.filter((p) => p.value !== null && p.value !== undefined).map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-px">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill || p.stroke }} />
          <span className="text-brand-gray flex-1">{p.name}</span>
          <span className="num font-semibold">{typeof p.value === "number" ? fmtNum(p.value, p.value % 1 ? 1 : 0) : p.value}{unit || ""}</span>
        </div>
      ))}
    </div>
  );
}

/** The last stacked segment carries the rounded data-end; inner segments stay square. */
export function topRadius(isTop: boolean): [number, number, number, number] {
  return isTop ? RADIUS_TOP : [0, 0, 0, 0];
}
