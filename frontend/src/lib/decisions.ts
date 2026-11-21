/** The decision walkthroughs, in the order the site shows them. `real` marks a
 *  decision that happened with the real PMO 360 (shown here on invented data). */
export interface Decision {
  slug: string;        // URL: /decisions/<slug>
  key: string;         // API scenario key
  tag: string;         // short label, e.g. "Staffing"
  nav: string;         // sidebar label
  title: string;       // one-line headline
  real: boolean;
  result: (before: any, after: any) => string | null;
}

export const DECISIONS: Decision[] = [
  {
    slug: "staffing", key: "s1", tag: "Staffing", nav: "Overloaded engineers", real: true,
    title: "Four projects looked fine, but three engineers were overloaded",
    result: (b, a) => (b && a ? `Overloaded weeks ${b.senior_over_person_weeks} → ${a.senior_over_person_weeks}` : null),
  },
  {
    slug: "blocked-package", key: "s2", tag: "Schedule", nav: "A blocked package", real: false,
    title: "One blocked package was about to delay the final drawings",
    result: (b, a) => (b && a ? `${b.ifc_slip_bd} → ${a.ifc_slip_bd} days late` : null),
  },
];

export const decisionPath = (d: Decision) => `/decisions/${d.slug}`;
