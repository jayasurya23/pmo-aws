# Data pipeline

```
External source ──► Ingest & stage ──► Validate ──► Normalise ──► PostgreSQL core ──► Aggregate / API ──► React
(Monday, Graph,     raw_records:        identity,     status map,     PMO 360 schema +      one SQL row set       6 dashboards,
 register CSV,      JSONB payload +     de-dup,       UTC, dates,     work, deliverables,   per grain; KPI =      drilldowns,
 PMO 360 tables,    sha256, sync run    field rules   unknown = NULL  capacity, meetings    COUNT(drill rows)     CSV export
 proposal360)                           → dq_exceptions
```

Run it: `cd backend && python -m pipeline.run --reset` (about 13 seconds; deterministic for a given seed and as-of date).

## 1. Synthetic world → source extracts (demo-only)

`pipeline/world.py` generates **one coherent world** with seeded randomness: 89 people, 25 clients, 54 portfolios, 132 projects, 585 milestones, ~1,850 work packages and the same number of deliverables, ~1,850 Timeline bookings, ~950 meetings, ~2,400 action items, ~1,100 calendar events, ~70 change orders, 118 proposals, covering May 2025 to early 2027. Values are derived from the values they depend on — a work package is "done" only if its milestone was achieved, an action closes after it was raised, and a booking's utilisation follows its hours — so no KPI can contradict another.

`pipeline/emit.py` then writes the world out **in each source's own shape**, injecting realistic defects and recording each one in `_manifest.json` (ground truth for the tests; the pipeline never reads it):

| Extract | Shape | Injected defects (counted) |
|---|---|---|
| `pmo360_master.json` | PMO 360 tables (users, clients, portfolios, projects, milestones with baseline/planned dates) | 3 portfolios without a job number, 1 job-number conflict, 2 projects without a PM |
| `monday_portfolio_board.json` | Monday GraphQL board (columns by id, `display_value` for relation/mirror columns) | 2 unnumbered items, a duplicated name, 2 orphans, 1 item named like a project |
| `monday_work_board.json` | Monday GraphQL board: 17 columns, groups, updates | 18 duplicate items, 6 unmapped status labels, 10 cosmetic label variants, 14 blank timelines, 5 start-after-completion dates, 4 renamed projects (2 covered by a manual crosswalk), 9 prospect items not in PMO 360, mixed timestamp formats, unreported actual hours |
| `id_crosswalk_manual.csv` | ops-maintained confirmed links | — |
| `deliverable_register_2026-11-18.csv` | document-control export | 3 duplicate rows, 7 rows for withdrawn bids, status conflicts with Monday, mixed date formats |
| `deliverable_register_2026-11-20.csv` | the same export after a template change | column `Actual Issue` renamed `Issued On` (schema drift) |
| `timeline_board.json` | PMO 360 Timeline export | bookings held by people who have left |
| `meetings_actions.json` | PMO 360 meetings, action items, rosters | blank/TBD and unrecognisable owners, missing due dates |
| `graph_calendar_events.json` | Graph `calendarView` (`start.dateTime` + Windows zone names) | internal-only and unmatched vendor meetings, meetings with no minutes |
| `proposal360_export.json` | proposals + `override_log` stage history | malformed job numbers, proposals that skipped "submitted" |
| `change_orders.json` | PMO 360 change orders | approved COs without an approval timestamp |

## 2. Ingest and stage

Every record is stored **as received** in `raw_records` (JSONB payload, sha256 hash, sync run, load status). Monday boards are read through `pipeline/monday.py`, adapted from the production sync script: the read-only mutation tripwire, column resolution **by title**, `items_page` / `next_items_page` cursor pagination and `display_value` unwrapping are all kept. A local transport answers the same GraphQL calls from the synthetic board; there is no HTTP client anywhere in the runtime code.

## 3. Validate

1. **Schema** — every expected column must exist before a row is read. A drifted file is refused whole; the previous good data is kept and the run is marked failed.
2. **Identity** — a confirmed manual link on the Monday relation's linked-item id, then an exact normalised-name match (`re.sub(r"[^a-z0-9]", "", name.lower())`, the production rule), otherwise reject. No fuzzy matching: a wrong match files work against another client's project.
3. **De-duplication** on the natural key (project × discipline × stage): keep the most recently updated source record, stage the others as `duplicate`. A unique constraint makes a second copy impossible to load.
4. **Field rules** — unmapped labels, missing dates, date order, unreported hours, unparseable dates, owner resolution, job-number shape.
5. **Cross-source** — Monday "done" vs register "not issued" after the planned date → `STATUS_CONFLICT`.

## 4. Normalise

* Status labels → common vocabulary via the `status_map` table (configuration, not code).
* Timestamps `…Z`, `…-05:00`, `YYYY-MM-DD HH:MM:SS+00:00` and Graph `{dateTime, "Eastern Standard Time"}` → UTC. Business dates are evaluated in America/New_York.
* Register dates in ISO, `M/D/YYYY` or `DD-Mon-YYYY` → `DATE`; anything else → NULL plus an exception.
* **Unknown stays NULL**: no actual hours, no due date, no plan. It is never zero, never "on time" and never "on track".
* Action ownership: user id → full name → first name or initials **unique within the portfolio's team** → else unresolved; client contacts kept separate.
* Calendar events matched to portfolios with the production priority: manual link → client attendee email (internal colleagues never indexed; first seen wins) → subject contains the portfolio or client name (longest first).

## 5. Load and derive

Core tables use PMO 360's names (`clients`, `projects` = portfolios, `portfolio_projects`, `meetings`, `action_items`, `change_orders`, `timeline_*`) plus demo tables (`milestones`, `work_items`, `work_item_events`, `engineering_deliverables`). **A milestone's actual date is derived**: the issue date of its last required deliverable, and only when every required discipline has issued. The register is the system of record for "achieved"; Monday is the system of record for hours.

## 6. Record

Every run writes a `sync_runs` row (extracted / loaded / rejected / flagged counts, extract time, message); every problem is a `dq_exceptions` row linked to the raw record and the affected project. The run ends by writing headline KPIs to `kpi_snapshots`. The 13 days of sync history before the reporting date are **simulated summary rows** (`is_simulated_history = true`, labelled in the UI) so freshness and success-rate charts have a history; the runs on the reporting date (and the 2026-11-18 register load) are real executions of this pipeline.

## Sources

| Key | Source | Kind | System of record for | Production equivalent | Cadence | Freshness SLA |
|---|---|---|---|---|---|---|
| `pmo360_master` | PMO 360 project master | PostgreSQL (PMO 360) | Client, portfolio and project identity; PMs; schedule milestones (planned dates) | PMO 360 production database (clients, projects, portfolio_projects); schedules synced from proposals | Continuous (same database) | 24 h |
| `monday_portfolio_board` | Monday.com - Portfolio board | Monday GraphQL API | Job numbers ("Project ID" column) | scripts/sync_projects_from_monday.py (read-only, exact match, dry-run by default) | Daily 06:00 ET | 26 h |
| `monday_work_board` | Monday.com - Engineering work board | Monday GraphQL API | Engineering work packages: status, assignee, planned/actual hours, blockers | Demo-only extension of the production Monday integration | Every 4 hours | 6 h |
| `deliverable_register` | Deliverable register (document control) | CSV export | Whether and when an engineering deliverable was issued (drives milestone actual dates) | Demo-only; production tracks deliverables in PMO 360 minutes and SharePoint | Daily export | 24 h |
| `timeline_capacity` | PMO 360 Timeline (capacity board) | PostgreSQL (PMO 360) | Resources, assignments (utilisation), time off | PMO 360 Timeline module (timeline_resources / assignments / timeoff) | Continuous (same database) | 24 h |
| `meeting_minutes` | PMO 360 meeting minutes | PostgreSQL (PMO 360) | Meetings, rolling action items, owners, due dates | PMO 360 Capture -> AI parse -> PM review -> save (meetings, action_items) | Continuous (same database) | 24 h |
| `graph_calendar` | Microsoft Graph - Outlook calendar | Microsoft Graph API | Scheduled meetings (used to check that minutes were captured) | PMO 360 /api/calendar/match (manual link -> client attendee email -> subject) | Hourly | 2 h |
| `proposal360` | proposal360 | PostgreSQL (proposal360) | Engineering-services proposals and stage history (override_log) | proposal360 proposals + override_log (field='status') | Daily | 26 h |
| `change_orders` | PMO 360 change orders | PostgreSQL (PMO 360) | Client change orders and approval timestamps | PMO 360 Change Orders module | Continuous (same database) | 24 h |

## Validation rules

| Code | Rule | Severity | Action | What it checks | Why it matters | Dashboard numbers protected |
|---|---|---|---|---|---|---|
| `SCHEMA_DRIFT` | Source schema changed | error | reject | An expected column is missing from a source extract. The whole file is refused and the last good data is kept. | Loading a file with a renamed column silently turns every value in it into a blank - e.g. every deliverable would look un-issued. | Overdue deliverables, Milestone actual dates |
| `MISSING_PROJECT_REF` | No matching project | error | reject | The record's project reference does not exactly match one PMO 360 project and no confirmed manual link exists. | Guessing a match files work against the wrong client's project; an exception a person resolves is cheaper than a wrong number on a dashboard. | Planned vs actual hours, Milestone projections |
| `DUPLICATE_EXTERNAL_RECORD` | Duplicate source record | warning | reject | More than one source record describes the same project + discipline + stage. The most recently updated record is kept. | Duplicates double-count hours and tasks, inflating workload and making a team look busier than it is. | Workload hours (prevented double count) |
| `UNMAPPED_STATUS` | Unrecognised status label | warning | load flagged | A status label is not in the status map. The record loads with status 'unknown' until someone maps the label. | Dropping it hides work; guessing a status misreports progress. 'Unknown' is visible and honest. | Blocked / in-progress counts, Projections |
| `MISSING_DUE_DATE` | Missing due date | warning | load flagged | Open work with no due date. It cannot be overdue, and is reported separately rather than counted as on time. | Treating a missing date as 'on time' makes the least-managed work look the healthiest. | Overdue work (excluded, counted) |
| `DATE_ORDER_INVALID` | Dates out of order | warning | load flagged | A start date falls after the completion date. | Negative durations corrupt cycle-time and productivity measures. | Cycle time |
| `ACTUAL_HOURS_MISSING` | Actual hours not reported | info | load flagged | Completed work with no actual hours. Kept as unknown (NULL), never as zero. | Zero would make estimates look pessimistic and understate real effort; unknown excludes it from variance with the count shown. | Planned vs actual hours (excluded, counted) |
| `REGISTER_UNMATCHED_PROJECT` | Register row for unknown project | error | reject | A deliverable-register row names a project that is not in PMO 360. | Usually a withdrawn bid; loading it would create deliverables no project owns. | None (rejected before load) |
| `REGISTER_DUPLICATE` | Duplicate register row | warning | reject | Two register rows for the same project + discipline + milestone. The later row is kept. | Double-counting deliverables inflates both the overdue and the issued totals. | Deliverable counts (prevented double count) |
| `STATUS_CONFLICT` | Sources disagree on status | warning | load flagged | Monday says the work package is done, but the register shows the deliverable not issued after its planned date. | The register is the system of record for issuance, so the dashboard shows it overdue - and flags the conflict so the PM can fix whichever source is wrong. | Overdue deliverables, Milestone status |
| `MILESTONE_MISSING_DELIVERABLE` | Milestone has no register row | warning | load flagged | A required discipline has no deliverable-register row for this milestone, so it cannot be marked achieved. | Without the row the milestone would stay open forever; the gap needs a register entry, not a manual override. | Milestone actual dates |
| `JOB_NUMBER_CONFLICT` | Job number differs from Monday | warning | load flagged | PMO 360 and the Monday Portfolio board disagree on a job number. Not overwritten automatically. | The job number is how the business refers to a project; a silent overwrite could relabel the wrong portfolio. | Project identification |
| `MONDAY_AMBIGUOUS_NAME` | Ambiguous Monday name | warning | reject | The same normalised name appears more than once, so no exact one-to-one match exists. | Picking one would be a guess. Production reports these for a human to decide. | Job numbers |
| `MONDAY_ORPHAN` | In Monday, not in PMO 360 | info | reject | A Monday Portfolio item matches no portfolio. Nothing is created automatically. | Usually a naming difference. The production sync dropped its auto-create option because it would create duplicate portfolios. | Job numbers |
| `MONDAY_UNNUMBERED` | Monday item has no job number | info | load flagged | Matched exactly, but Monday has no job number to copy. | The portfolio stays without a number until Monday is fixed or a PM types it in. | Job numbers |
| `MONDAY_SUB_ONLY_MATCH` | Matches a project, not a portfolio | info | reject | A Monday Portfolio item matches a site-level project name. Job numbers live on the portfolio, so it is not written. | Guessing which portfolio the number belongs to is exactly the wrong-mapping failure the sync refuses to risk. | Job numbers |
| `PROJECT_MISSING_PM` | Project has no PM | warning | load flagged | A project in the master has no project manager. | Unowned projects disappear from every per-PM view - the dashboards that should surface them. | Per-PM views |
| `INACTIVE_RESOURCE_BOOKING` | Booking on an inactive person | warning | load flagged | A capacity booking is held by someone who has left. Counted as unstaffed demand. | The work looks staffed on the board but nobody will do it. | Unstaffed demand, Capacity |
| `ACTION_OWNER_UNRESOLVED` | Action owner not recognised | warning | load flagged | The action's owner text does not resolve to a person (internal or client). | Unresolved owners read as 'someone else's problem'; they are reported with the unassigned actions. | Unassigned actions, Actions by owner |
| `CALENDAR_UNMATCHED` | Meeting not matched to a portfolio | info | load flagged | An external meeting matched no portfolio by link, client attendee email or subject. | Unmatched meetings cannot be checked for captured minutes. | Minutes capture rate |
| `INVALID_JOB_NUMBER` | Malformed job number | warning | load flagged | Proposal job number does not match ^\d{3,4}-\d{3}$ (shape only; job numbers are never parsed). | A malformed number will not join to the awarded project later. | Proposal-to-project linkage |
| `PROPOSAL_MISSING_SUBMITTED` | No submitted date | info | load flagged | The proposal reached a later stage without a 'submitted' event, so turnaround is unknown. | Excluded from turnaround (with the count shown) rather than counted as zero days. | Proposal turnaround (excluded, counted) |
| `CO_APPROVED_NO_TIMESTAMP` | Approved CO has no approval time | warning | load flagged | A change order is approved but has no approval timestamp. | Approval cycle time cannot be computed; it is excluded, not treated as same-day. | CO approval cycle time (excluded, counted) |
| `DATE_UNPARSEABLE` | Unparseable date | warning | load flagged | A date value matched none of the accepted formats and was stored as unknown. | A bad date silently becoming NULL would hide an issued drawing; the exception keeps it visible. | Deliverable dates |

## Status normalisation (configuration, `status_map` table)

**monday_work_board**

| Common status | Source labels (case/space-insensitive) |
|---|---|
| `not_started` | not started |
| `in_progress` | working on it, in progress, wip |
| `in_review` | in qc, internal review, qc |
| `blocked` | stuck, waiting on client, blocked, on hold - client |
| `done` | done, complete, issued |
| `cancelled` | cancelled, n/a |

**deliverable_register**

| Common status | Source labels (case/space-insensitive) |
|---|---|
| `not_started` | not started |
| `in_progress` | wip, in progress |
| `in_qc` | in qc, qc review |
| `issued` | issued, ifc issued, issued for construction |
| `on_hold` | hold, on hold |

