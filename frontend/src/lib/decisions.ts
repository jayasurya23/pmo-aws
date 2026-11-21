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

const money = (v: number) => `$${v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1e3) + "K"}`;

export const DECISIONS: Decision[] = [
  {
    slug: "staffing", key: "s1", tag: "Staffing", nav: "Overloaded engineers", real: true,
    title: "Four projects looked fine, but three engineers were overloaded",
    result: (b, a) => (b && a ? `Overloaded weeks ${b.senior_over_person_weeks} → ${a.senior_over_person_weeks}` : null),
  },
  {
    slug: "client-decision", key: "s3", tag: "Client decision", nav: "One client decision", real: true,
    title: "One client decision was holding up several projects",
    result: (b, a) => (b && a ? `Billing at risk ${money(b.billing_at_risk)} → ${money(a.billing_at_risk)}` : null),
  },
  {
    slug: "capacity-bidding", key: "s4", tag: "Bidding", nav: "Bidding within capacity", real: true,
    title: "The pipeline looked healthy, but winning it would overload one team",
    result: (b, a) => (b && a ? `Peak load ${b.peak.total_pct}% → ${a.peak.total_pct}%` : null),
  },
  {
    slug: "billing", key: "s5", tag: "Billing", nav: "Billing at risk", real: false,
    title: "Billing was slipping along with the schedule",
    result: (b, a) => (b && a ? `At risk ${money(b.billing_at_risk)} → ${money(a.billing_at_risk)}` : null),
  },
  {
    slug: "blocked-package", key: "s2", tag: "Schedule", nav: "A blocked package", real: false,
    title: "One blocked package was about to delay the final drawings",
    result: (b, a) => (b && a ? `${b.ifc_slip_bd} → ${a.ifc_slip_bd} days late` : null),
  },
];

export const decisionPath = (d: Decision) => `/decisions/${d.slug}`;
