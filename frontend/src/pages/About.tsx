import { Card, PageHeader, Tag } from "@/components/ui";

const ROWS: [string, "prod" | "adapted" | "demo", string][] = [
  ["Client → Portfolio → Project hierarchy; meetings; rolling action items; deliverables", "prod", "Same table and column names (db/models.py). The `projects` table IS the portfolio tier, as in production."],
  ["Action KPI definitions (open, overdue = strictly before today, due this week, no due date)", "prod", "api/dashboard.py::get_my_work — one rule shared across screens"],
  ["Action burndown (open at week end, close date = COALESCE(last_status_change, updated_at, created_at))", "prod", "api/projects.py::get_project_metrics"],
  ["Lead dashboard: org totals, portfolio health worst-first, per-PM workload, unassigned actions", "adapted", "Became the base of Dashboards A and D"],
  ["Timeline capacity board: resources, bookings × utilisation, time off, placeholders", "adapted", "api/timeline.py::get_board formulas, expressed in hours; holidays removed from both sides"],
  ["Monday.com sync: read-only guard, columns by title, cursor pagination, exact normalised matching, exception report", "adapted", "scripts/sync_projects_from_monday.py, run against a local transport serving synthetic GraphQL pages"],
  ["Microsoft Graph calendar → portfolio matching (manual link → client email → subject)", "adapted", "api/calendar.py, run against synthetic events"],
  ["Ownership attribution of free-text action owners", "adapted", "Production's rungs (owner_user_id → name → created_by), refined: short forms resolved within the portfolio team; client owners separated"],
  ["Change orders (draft → pending → approved) and proposals (proposal360 stages)", "adapted", "Fields trimmed; stage history from proposal360's override_log shape"],
  ["Engineering milestones 30/60/90/IFP/IFC with baseline / planned / actual / projection", "demo", "New. Production carries IFP/IFC as Timeline milestone labels and proposal schedule items"],
  ["Monday engineering work board (status, hours, blockers, history)", "demo", "New source; production's Monday integration reads the Portfolio board only"],
  ["Deliverable register as a separate source; cross-source status conflicts", "demo", "New"],
  ["Staging (raw_records), sync runs, validation rules, exception log, freshness SLAs", "demo", "New; production reports sync exceptions to the console"],
  ["Dashboards B, C (hours view), E, F; schedule-risk rule; projection; scenarios", "demo", "New for the case study"],
];

export default function About() {
  return (
    <div>
      <PageHeader kicker="Case study · provenance" title="What is original, adapted, or new"
        sub="This demo is a standalone rebuild on PMO 360's stack and data model. Nothing here was copied from production data; every record is synthetic. This page states exactly which ideas come from the production code." />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <Card className="xl:col-span-2" title="Feature provenance" pad={false}>
          <table className="w-full"><thead><tr><th className="th">Capability</th><th className="th">Origin</th><th className="th">Evidence / note</th></tr></thead>
            <tbody>{ROWS.map(([a, o, n]) => (
              <tr key={a}><td className="td text-[12.5px]">{a}</td>
                <td className="td"><Tag tone={o}>{o === "prod" ? "Production" : o === "adapted" ? "Adapted" : "Demo-only"}</Tag></td>
                <td className="td text-[12px] text-brand-gray">{n}</td></tr>))}</tbody></table>
        </Card>
        <div className="space-y-3">
          <Card title="Synthetic data — what that means">
            <ul className="text-[12.5px] space-y-1.5 list-disc pl-4">
              <li>One deterministic generator (seed 360) builds a coherent world, then writes it out as each source's native extract with counted defects.</li>
              <li>25 clients, 54 portfolios, 132 projects, ~1,850 work packages, ~1,850 deliverables, 89 people, ~950 meetings, ~2,400 action items, 18 months of history.</li>
              <li>Email domains use the reserved <code>.example</code> TLD. Names are invented.</li>
              <li>No live Monday, Graph, OpenAI or company API is reachable: an outbound-network guard refuses non-local hosts, and a test proves it.</li>
            </ul>
          </Card>
          <Card title="Differences from production, on purpose">
            <ul className="text-[12.5px] space-y-1.5 list-disc pl-4">
              <li>No Entra ID sign-in: a fixed read-only demo identity. Production validates Entra JWTs and gates writes with per-module permission flags.</li>
              <li>PostgreSQL only (production also runs SQLite locally).</li>
              <li>No AI note parsing; meetings arrive already captured.</li>
              <li>Scenario "apply" writes decisions directly for the demo; production changes happen through the Timeline, Actions and Proposals screens.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
