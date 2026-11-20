import { useEffect, useState } from "react";

/** Chart colours are CSS tokens (light/dark selected steps). SVG attributes need
 *  concrete values, so read them and re-read when the theme class flips. */
const KEYS = ["series-1", "series-2", "series-3", "series-4", "series-5", "good", "warn", "serious", "critical",
  "neutral", "muted", "complete", "seq-1", "seq-2", "seq-3", "seq-4", "seq-5", "seq-6", "grid", "axis", "text",
  "text-2", "surface"] as const;
export type ColorKey = (typeof KEYS)[number];
export type ChartColors = Record<ColorKey, string>;

function read(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(KEYS.map((k) => [k, cs.getPropertyValue(`--c-${k}`).trim()])) as ChartColors;
}

export function useChartColors(): ChartColors {
  const [c, setC] = useState<ChartColors>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setC(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return c;
}

/** Colour follows the ENTITY, never its rank: each discipline owns one slot. */
export const DISCIPLINE_SLOT: Record<string, ColorKey> = {
  Electrical: "series-1", Civil: "series-2", Structural: "series-3", Substation: "series-4", "Battery Storage": "series-5",
};
export const DISCIPLINES = Object.keys(DISCIPLINE_SLOT);

/** Health / milestone state -> reserved status colour (always shown with icon + label). */
export const STATE_COLOR: Record<string, ColorKey> = {
  on_track: "good", at_risk: "warn", projected_late: "serious", behind: "critical", late: "critical",
  unknown: "neutral", no_data: "neutral", no_plan: "neutral", on_hold: "muted", upcoming: "complete",
  complete: "complete", complete_on_time: "good", complete_late: "serious",
};
export const STATE_LABEL: Record<string, string> = {
  on_track: "On track", at_risk: "At risk", projected_late: "Projected late", behind: "Behind", late: "Late",
  unknown: "Unknown", no_data: "No work data", no_plan: "No plan", on_hold: "On hold", upcoming: "Not started",
  complete: "Complete", complete_on_time: "Done on time", complete_late: "Done late",
};
