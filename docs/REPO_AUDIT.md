# Repository audit and implementation plan

Audited before any demo code was written: `jayasurya23/pmo360` (main, 223 commits, 21 May – 4 Nov 2026,
all authored by the repository owner) and `jayasurya23/proposal360` (main).
Nothing from either repository's data, credentials, client names or company documents was copied.

## 1. What PMO 360 actually is (evidence)

| Area | Finding | Evidence |
|---|---|---|
| Stack | FastAPI (Python 3.11) + React 18 / Vite / TypeScript / Tailwind, SQLAlchemy 2.0, Alembic, PostgreSQL in prod, SQLite locally | `README.md`, `backend/requirements.txt`, `frontend/package.json` |
| Size | 26 API routers, 159 endpoints, 34 ORM models, 46 Alembic migrations, 17 pages, ~32k Python and ~47k TypeScript lines, 30 merged PRs | counted from the tree |
| Hierarchy | `Client → Project` (the `projects` table is the **Portfolio**, a UI rename) `→ PortfolioProject` (the site-level "Project" tier) | `db/models.py`, `docs/PROJECT_TIER.md` |
| Meetings and actions | Meetings, attendees, discussion points, deliverables; rolling `ActionItem` with an origin and closing meeting, `open/pending/completed/cancelled`, free-text `owner` plus `owner_user_id` | `db/models.py`, `api/actions.py`, `core/services.py` |
| Dashboards | Home (overdue and soon-due actions, at-risk spotlight, risks, CO card), per-portfolio dashboard (counts, 8-week action burndown, risk heatmap), Lead dashboard (org totals, portfolio health worst-first, per-PM workload, unassigned actions), My Work | `api/dashboard.py`, `api/lead.py`, `api/projects.py::get_project_metrics`, `pages/LeadDashboard.tsx`, `pages/PortfolioDashboard.tsx` |
| KPI definitions | Overdue = open/pending **and** due date strictly before today, shared across screens; due-this-week starts today so it never double-counts overdue; undated work is reported separately rather than hidden or counted as late | `api/dashboard.py::get_my_work` docstring |
| Ownership attribution | Three-rung rule (owner_user_id → owner-name match → created_by, the last only when nothing else applies). It was introduced after real data showed a PM who owned nothing reading 30 open / 30 overdue, and `/my-work` saying 27 overdue where `/briefing` said 2 | `api/dashboard.py::_action_mine_basis` |
| Capacity | Timeline board: resources by discipline, assignments (project × discipline × milestone × date range × utilization), time off, placeholders with `available_from`; per-week load = Σ utilization × workdays/5; availability = 1 − blocked days/5 | `api/timeline.py::get_board`, `db/models.py::Timeline*` |
| Proposals | Proposal upload → versioned tree → PDF/Excel → schedule sync into a portfolio; proposal → Timeline import of milestones | `api/proposals.py`, `proposal/` |
| Change orders | Draft → pending → approved, line items, append-only approval-request history, separation-of-duties check | `api/change_orders.py`, `ChangeOrderApprovalRequest` |
| Monday.com | `scripts/sync_projects_from_monday.py`: **read-only** (refuses any GraphQL mutation), dry run by default, columns resolved **by title** not id, cursor pagination, **exact normalised-name matching only**, reports ambiguous / sub-project-only / orphan / unnumbered / duplicate job numbers, never auto-creates. 38 of 40 board rows had a job number. | script + migration `pn1a2b3c4d5e6` |
| Microsoft Graph | MSAL sign-in (Entra), Outlook calendar → portfolio matching (manual link → external attendee email → subject substring, internal emails ignored), Mail.Send, SharePoint document storage | `api/calendar.py`, `lib/graph.ts`, `storage/backend.py`, `docs/IT_REQUEST.md` |
| Auth | Entra JWT validation, per-module write permissions (`can_*` flags), admin floor via env, CO permissions off by default | `auth/`, `User` model |
| Deployment | Azure Container Apps via GitHub Actions (OIDC), staging and production | `.github/workflows/` |
| Tests | No pytest suite. End-to-end smoke scripts (`scripts/full_coverage_test.py`, CO docx/outside tests, proposal template round-trip, `audit_auth.py`) | `backend/scripts/` |
| Scale observed in code comments | ~42 portfolios under ~21 clients and 8 staff at the time of the staffing panel; 23 clients and 118 imported client contacts at the contacts import; 50 production proposal workbooks; 16 proposals when the project tier landed | `PortfolioAssignPanel.tsx`, `models.py`, `ClientContactsCard.tsx`, `Proposals.tsx`, `docs/PROJECT_TIER.md` |

**proposal360** (separate app, same stack, React 19): versioned department package libraries → hours,
fees and schedule. Proposal stages `draft/submitted/open/closed/bid/won`; stage changes are recorded
only in the append-only `override_log`, with no submitted/won timestamps. "Blank is unknown, never zero"
is a design rule there. pytest suite (17 files). **No Monday integration, no dashboard or KPI endpoint,
and no actual-hours or capacity data.**

## 2. Classification

### A. Existing production functionality (repository evidence)
- Client / portfolio / project hierarchy, meetings, rolling action items, deliverables, agendas with risks
- Lead dashboard, portfolio dashboard, My Work, Home risk and at-risk views, plus the KPI definitions above
- Timeline capacity board (resources, assignments, utilization, time off, weekly load and availability)
- Proposals (PMO 360) and proposal360 stages; change orders with approval history
- Read-only Monday job-number sync with exact matching and exception reporting
- Graph calendar matching, Entra auth, SharePoint storage

### B. Existing functionality adapted for the isolated demo
- **Schema**: the same table and column names for clients, portfolios (`projects`), `portfolio_projects`,
  meetings, `action_items`, change orders, proposals and `timeline_*`, trimmed to what the dashboards read
- **Monday extract**: the production pagination, title-based column resolution, mutation guard and
  `norm()` exact matching, run against a local mock transport serving synthetic GraphQL-shaped pages
- **Graph calendar matching**: the same priority rules, run against synthetic events
- **KPI rules**: overdue / due-soon / undated definitions, the ownership-attribution rungs, and the timeline load formula
- **Lead dashboard**: becomes the base of Dashboard A and Dashboard D
- **Auth**: replaced by a fixed demo identity. No Entra, no tokens.

### C. New showcase functionality (demo-only, labelled as such)
- Engineering milestones (30/60/90/IFP/IFC) with baseline, planned, actual and forecast dates; schedule-risk rule
- Engineering work items (a Monday-like work board) with planned vs actual hours, blocking and status history
- A deliverable register as a separate source, reconciled against Monday
- Source staging, validation rules, normalisation, a data-quality exception log and sync-run history
- Dashboards B (schedule health), C's hours/forecast view, E (commercial) and F (data quality)
- Two traceable decision scenarios with apply/reset
- A metric catalogue served by the API, KPI reconciliation tests and a network-isolation guard

## 3. Implementation plan

1. Standalone repository `pmo360-ops-demo` (separate from company code): FastAPI + SQLAlchemy +
   PostgreSQL 16 + React/Vite/TS/Tailwind, carrying PMO 360's design tokens and Jost font, without Castillo logos.
2. Deterministic generator (seeded) builds one coherent synthetic world, then **writes it out as
   source-system extracts** in each source's own shape, with realistic defects injected.
3. Pipeline: extract → stage (raw JSON per record) → validate → normalise / match IDs → core tables →
   SQL aggregation → API → React. Every run is recorded; every rejected or suspect record is an exception row.
4. Metrics are written once per grain as SQL; each KPI is `COUNT(*)` over the same row set its drilldown returns.
5. Six dashboards, project drilldown, pipeline / data-quality pages, and two scenarios with apply/reset.
6. pytest: reconciliation, cardinality, determinism, DQ detection, schedule rules, offline guard, confidentiality scan.
7. Docs, case study (md + docx with screenshots), demo script, and read-only SQL the
   owner can run in production to replace every `[CONFIRM]` placeholder with a real number.
