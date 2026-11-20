# Architecture, technical decisions and trade-offs

This demo is a standalone rebuild of PMO 360's analytics layer on PMO 360's own stack. Where it differs from production, this document says so.

## System view

```
            SOURCES                       PIPELINE (backend/pipeline)                 SERVING (backend/app)            UI (frontend)
 ┌──────────────────────────┐   ┌──────────────────────────────────────────┐   ┌─────────────────────────┐   ┌──────────────────────┐
 │ Monday Portfolio board   │──►│ extract (GraphQL, cursor pages, by-title │   │ metrics/*.py            │   │ React 18 + Vite + TS │
 │ Monday work board        │──►│   columns, read-only tripwire)           │   │  · one SQL row set per  │   │ Tailwind (PMO 360    │
 │ Deliverable register CSV │──►│ stage  raw_records (JSONB + sha256)      │──►│    grain, shared scope  │──►│   tokens) · Recharts │
 │ PMO 360 master/Timeline/ │──►│ validate  schema · identity · de-dup ·   │   │  · KPI = COUNT(rows)    │   │ URL-backed filters   │
 │   minutes/change orders  │   │   field rules · cross-source → exceptions│   │ FastAPI routers         │   │ drilldown drawer +   │
 │ Graph calendarView       │──►│ normalise  status_map · UTC · NULL=unknown│  │  /api/executive …       │   │   CSV · project page │
 │ proposal360 + override_log│─►│ load  PostgreSQL 16 (PMO 360 schema +    │   │  /api/drill/{metric}    │   │ scenarios · lineage  │
 └──────────────────────────┘   │   demo tables) · sync_runs · kpi_snapshots│   │  /api/projects/{id}     │   └──────────────────────┘
                                └──────────────────────────────────────────┘   └─────────────────────────┘
                 app/netguard.py: outbound connections to anything but local/private hosts are refused
```

## Why these technologies (and the trade-offs)

**FastAPI.** Production PMO 360 is FastAPI: 26 routers, one per domain, about 159 endpoints. Pydantic models type every request and response, the OpenAPI page doubles as documentation, and the same Python ecosystem runs the document generators (ReportLab, python-docx, openpyxl), the LLM note parser and the Monday sync script. The ETL and the API share models and rules instead of re-implementing them. *Trade-off:* Python is slower than a compiled service for heavy aggregation, so the heavy lifting goes to PostgreSQL.

**PostgreSQL.** The domain is relational (client → portfolio → project → meetings / actions / schedules / change orders). Production uses the database as the place where invariants live: a unique constraint on portfolio membership because a doubled row "lies about how staffed a portfolio is", a partial unique index for "one active proposal per project", and optimistic-concurrency version columns. The demo leans on the same strengths: `COUNT(*) FILTER (…)` aggregates, `generate_series` weekly burndowns, `PERCENTILE_CONT`, JSONB staging, `DISTINCT ON` for latest-run-per-source. Production deploys to Azure Container Apps through GitHub Actions; the IT request for the production environment specifies Azure Database for PostgreSQL (Flexible Server). *Trade-off:* a schema needs migrations (46 Alembic revisions in production) where a document store would not; the reward is that wrong data is often impossible rather than merely discouraged.

**React.** PMO 360 is a working tool first: minutes capture, review, agendas, the Timeline board, change-order approvals. Reporting sits on the same screens where data is entered, and a typed API client turns schema mismatches into compile errors. *Trade-off:* every chart is code to maintain.

**An application dashboard rather than only a BI tool.**
1. *Data quality is fixed at the point of entry.* The owner picker, job-number field and status vocabulary are in the app, so the dashboard improves the data it reports on. A BI tool can only read what it is given.
2. *Act on what you see.* A number drills to the action, meeting or work package, and the user can fix it there.
3. *One definition per metric.* "Overdue = due strictly before today" is written once (production `api/dashboard.py`) and shared by every screen. Two BI workbooks each computing it is how numbers drift.
4. *Same sign-in and permissions* (Entra ID), no extra licences for a small team, and live data with no extract refresh to schedule.
*Trade-off:* ad hoc analysis is slower than in Power BI or Tableau. Mitigations: CSV export on every drilldown, documented SQL and a metric catalogue. At larger scale the right design is both: curated tables feeding QuickSight or Power BI for exploration, and the app for operational workflows.

## How source data is synchronised and normalised

See [DATA_PIPELINE.md](DATA_PIPELINE.md). Production behaviour carried over: the Monday sync is read-only (it refuses any GraphQL mutation), dry-run by default, resolves columns by title, matches names exactly after normalisation, never auto-creates portfolios, and reports ambiguous, orphan, unnumbered, sub-project-only and duplicate cases for a person to decide. Calendar events are matched to portfolios by manual link, then client attendee email, then subject. The demo adds what production does not have: staging, a rule catalogue, an exception table, and sync-run history with freshness SLAs.

## How dashboard queries are constructed

1. **Grain first.** Every metric family declares its grain ([METRICS.md](METRICS.md)): project, milestone, work package, deliverable, resource × week, action item.
2. **One scope predicate.** `metrics/common.py::scope_sql()` turns portfolio, client, PM and discipline filters into one SQL predicate. Every dashboard query and every drilldown uses it, so a card and its table cannot disagree about which records count.
3. **Point-in-time.** Status is evaluated against the reporting date. An action is open at `as_of` if it was created on or before that date and not closed on or before it, using production's close-date rule `COALESCE(last_status_change, updated_at, created_at)`.
4. **No fan-out joins.** Many-to-one facts are aggregated before joining. A work package with two Timeline bars has its utilisation `SUM`med in a `GROUP BY w.id` before the projection reads it, so it is one row, not two.
5. **KPI = COUNT of the drilldown.** Card values are `COUNT(*) FILTER (WHERE <predicate>)` over the same CTE the drilldown selects from with the same predicate.
6. **SQL where it fits, Python where it is clearer.** Counting, filtering and percentiles run in SQL. The business-day projection and the capacity roll-up run in Python over SQL-fetched sets; the capacity formula is a port of production's Python (`api/timeline.py::get_board`). Response times on this data set are 30–260 ms per dashboard.

## How validity is verified

* **84 automated tests** (`backend/tests`), run against a separate test database rebuilt by the pipeline:
  * three-way reconciliation: dashboard KPI = drilldown count = an independent SQL count written in the test;
  * filters partition rather than duplicate: the sum of a KPI over every client equals the unfiltered KPI;
  * every injected defect class detected exactly as often as the generator's manifest says it was injected;
  * unknown is never zero; the milestone actual date equals its last required deliverable;
  * every core row traces back to its staged raw record; timestamps are UTC;
  * schedule-rule unit tests (late vs projected late, tolerance band, blocked default, on hold);
  * deterministic generation; scenario apply and reset restore the exact state;
  * network guard; confidentiality scan.
* **Invariants in the schema**: unique natural keys on work items, deliverables and milestones; foreign keys everywhere.
* **Lineage**: every exception links to its raw payload; every core row has a staged source record.
* **The existing proposal360 test suite** (123 tests) passes against its own code. PMO 360's repository has end-to-end smoke scripts rather than a pytest suite.

## How freshness is communicated

Each source declares an SLA (Monday work board 6 h, Graph 2 h, register 24 h, and so on). Freshness is the time since the extract of the source's **last successful** run, so a failed run can never make stale data look fresh. The header shows the reporting time and a green, amber or red dot with a per-source popover. The data-quality page shows SLA bullet bars, a 14-day run strip and a banner for any source whose last run failed. In the demo the register's latest file failed on schema drift, so the deliverable data is 48 hours old and says so.

## How exceptions are handled

Each rule has a severity, an action (`reject` or `load_flagged`), an explanation of why it matters, and the dashboard numbers it can distort. Rejected records never reach core tables. Flagged records load with the problem visible (`status = 'unknown'`, `NULL` dates). The exception list filters by rule, source and severity and opens the raw payload. *Not built in the demo:* a resolution workflow. The `status` column (open, resolved, accepted) exists; production would add assignment and close-out, and re-validation on the next run.

## How permissions and information access are protected

*Production PMO 360:* Entra ID sign-in with JWT validation against the tenant's JWKS. Users are upserted on first request. Per-module **write** permissions are boolean flags on the user row, with defaults treated as a security decision: change-order creation and approval are off by default because approval emails reach people who have never opened the app. An admin floor is set from the environment, and change-order approval refuses self-approval when another approver exists. Reads are company-wide by business rule (every PM can see every portfolio). Client-facing minutes print only actions that belong to that client's portfolio, to prevent cross-client disclosure.

*Demo:* no authentication; one read-only identity. The scenario endpoints write only to the demo database. An outbound network guard refuses any non-local host, all data carries a "synthetic" label and an `X-Data-Classification` response header, and a hashed denylist test keeps real names out of the repository.

*If this held procurement data:* row-level scoping (category, region) enforced in the scope predicate, field-level masking for commercial terms, an audit log of exports, and SSO-backed API tokens for service integrations.

## How the design scales (about 100× the data)

At 100× there would be about 13,000 projects, 185,000 work packages and 240,000 action items:

| Concern | Today | At 100× |
|---|---|---|
| Extraction | full refresh per run | incremental: Monday `updated_at` watermarks, Graph delta queries, change-data-capture from the app database |
| Staging | `raw_records` table | object storage (raw zone, partitioned by source/date) with a manifest table; JSONB only for the latest batch |
| Projection | computed at read time in Python | computed by the pipeline into a `milestone_projection` table, recomputed only for projects whose work items changed |
| Aggregation | live SQL with indexes | materialised KPI tables per grain, refreshed per run; dashboards read pre-aggregated rows, drilldowns hit indexed detail |
| Query load | single PostgreSQL | read replica for dashboards; cache keyed by (filters, data version) and invalidated by each pipeline run |
| Concurrency | single process | stateless API replicas (production already runs multiple Uvicorn workers) |

Indexes already present for the hot paths: `(status, due_date)` on actions, `planned_date` on milestones and deliverables, `(start_date, end_date)` on bookings, foreign keys on every project reference.

## Differences from production (explicit)

| Topic | Production PMO 360 | This demo |
|---|---|---|
| Data | Real company records | Synthetic, deterministic |
| Auth | Entra ID + permission flags | None; read-only demo identity |
| Monday | Portfolio board job-number sync (CLI, human-reviewed) | Same logic plus a demo work board, run in the pipeline against local files |
| Graph | Live calendar, Mail.Send, SharePoint | Local calendar extract; matching rules only |
| Milestones, work packages, deliverable register, DQ framework, dashboards B/C(hours)/E/F, scenarios | Not present | Demo-only |
| Local database | SQLite or PostgreSQL | PostgreSQL only |
