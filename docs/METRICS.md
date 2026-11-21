# KPI catalogue

Generated from `backend/app/metrics/catalog.py`, the same catalogue the API serves at `/api/meta/definitions` and the UI shows as KPI tooltips.

**Origin**: *Production* = same definition as production PMO 360; *Adapted* = production concept reshaped for the demo; *Demo-only* = new for the case study and not part of the production application.

Every KPI below is computed in the API from loaded records (never in React), and every clickable KPI equals the row count of its drilldown for the same filters — enforced by `tests/test_reconciliation.py`.

| Key | KPI | Grain | Origin | Definition | System of record |
|---|---|---|---|---|---|
| `active_projects` | Active projects | project | Demo-only | Projects that have kicked off, are not complete and are not on client hold. | PMO 360 master (lifecycle) + deliverable register (IFC achieved) |
| `projects_on_track` | On track | project | Demo-only | Active projects with no late, projected-late or at-risk milestone. | Schedule rule |
| `projects_at_risk` | At risk | project | Demo-only | Active projects whose worst milestone is projected late or at risk (none already late). | Schedule rule |
| `projects_behind` | Behind | project | Demo-only | Active projects with at least one milestone already past its planned date and not achieved. | Schedule rule |
| `projects_unknown` | Unknown | project | Demo-only | Active projects whose next milestone has no plan or no work data to project from. Never shown as on track. | Schedule rule |
| `projects_on_hold` | On hold | project | Demo-only | Projects paused by the client. Excluded from late and at-risk counts. | PMO 360 master |
| `late_milestones` | Late milestones | milestone | Demo-only | Not achieved and planned date strictly before the reporting date. Already late - not a projection. | Planned: PMO 360 schedule. Achieved: deliverable register |
| `projected_late_milestones` | Projected late | milestone | Demo-only | Future milestones whose rules-based projection (remaining hours / booked utilisation, blockers, upstream stage) finishes after the planned date. | Monday work packages + Timeline bookings |
| `at_risk_milestones` | At risk | milestone | Demo-only | Due within 10 business days with an upstream package blocked, overdue or in an unknown status, but not yet projected late. | Monday work packages |
| `upcoming_milestones` | Upcoming deadlines | milestone | Demo-only | Milestones planned between the reporting date and the look-ahead horizon, not yet achieved. | PMO 360 schedule |
| `ifp_milestones` | IFP milestones | milestone | Adapted | Issued-for-Purchase milestones: the engineering package clients use to order long-lead equipment (inverters, transformers, switchgear). | PMO 360 schedule |
| `overdue_deliverables` | Overdue deliverables | deliverable | Demo-only | Planned issue date before the reporting date and not issued (per the register, the system of record). Client-hold projects excluded. | Deliverable register |
| `blocked_work_items` | Blocked work packages | work package | Demo-only | Work packages whose normalised status is 'blocked' (Stuck / Waiting on Client / Blocked / On Hold - Client). Client-hold projects excluded. | Monday work board |
| `open_actions` | Open actions | action item | Production | Status open or pending as of the reporting date. Counted once each, however many names the owner field lists. | PMO 360 action items |
| `overdue_actions` | Overdue actions | action item | Production | Open AND due date strictly before the reporting date. Due today is due, not late. | PMO 360 action items |
| `due_soon_actions` | Due in 7 days | action item | Production | Open AND due between today and today + 6. Starts today, so it never overlaps overdue. | PMO 360 action items |
| `no_due_date_actions` | No due date | action item | Production | Open with no due date. Not overdue (nothing says it is late) but reported so undated work is not invisible. | PMO 360 action items |
| `unassigned_actions` | Unassigned | action item | Adapted | Open actions whose owner resolves to nobody: blank/TBD, or text that matches no person. Client-owned actions are counted separately (production folds them in). | PMO 360 action items + ownership rule |
| `external_actions` | Client-owned | action item | Demo-only | Open actions owned by a client or vendor contact. | PMO 360 action items |
| `aged_60_actions` | Open > 60 days | action item | Demo-only | Open actions raised more than 60 days before the reporting date. | PMO 360 action items |
| `minutes_capture_rate` | Minutes captured | calendar meeting | Adapted | Of portfolio meetings on the Outlook calendar in the last 8 weeks (to 2 business days ago), the share with minutes saved in PMO 360. Calendar matching uses the production rules. | Microsoft Graph calendar + PMO 360 meetings |
| `on_time_close_rate` | Closed on time (90 d) | action item | Demo-only | Completed actions with a due date, closed in the last 90 days, whose close date was on or before the due date. Cancelled actions excluded. | PMO 360 action items |
| `overallocated_people` | Over-allocated people | resource x week | Adapted | People booked above 110% of their available capacity in 2+ weeks of the capacity horizon (sustained), or booked during full-week PTO. Load and availability follow the production Timeline formulas, in hours. | PMO 360 Timeline |
| `utilisation_pct` | Allocated / available | resource x week | Adapted | Booked hours / available hours across the horizon, for people in scope. | PMO 360 Timeline |
| `unstaffed_hours` | Unstaffed demand | booking | Adapted | Hours booked with no person, or held by someone who has left. | PMO 360 Timeline |
| `hours_variance` | Actual vs planned hours | work package | Demo-only | (Actual - planned) / planned hours on packages completed in the trend window. Packages with no actual hours reported are excluded and counted - never treated as zero. | Monday work board |
| `proposal_turnaround` | Proposal turnaround | proposal | Demo-only | Business days from proposal creation to its first 'submitted' stage event (proposal360 override_log). Proposals with no submitted event are excluded and counted. | proposal360 |
| `co_backlog` | Change-order backlog | change order | Adapted | Client change orders in draft or pending approval. Engineering-services change orders - not supplier purchase orders. | PMO 360 change orders |
| `co_approval_cycle` | CO approval cycle | change order | Demo-only | Median business days from submitted to approved, approved COs with both timestamps. | PMO 360 change orders |
| `source_freshness` | Source freshness | source | Demo-only | Hours since the extract time of the source's last SUCCESSFUL run, against its SLA. Failed runs never refresh it. | Pipeline sync runs |
| `open_exceptions` | Open exceptions | exception | Demo-only | Data-quality problems detected by validation rules and not yet resolved. | Pipeline |

## Shared filter semantics

| Filter | Applies to |
|---|---|
| Reporting date (`as_of`) | Every status: late, overdue, open, achieved. Defaults to the extract date (2026-11-20). |
| Portfolio / client / PM | Project scope, via one SQL predicate (`metrics/common.py::scope_sql`) used by every query. Portfolio-grain records (meetings, actions, change orders) are in scope when any of their projects is. |
| Discipline | Project level: the project has the discipline in scope. Row level: work items, deliverables and bookings of that discipline. |
| Look-ahead | Horizon for upcoming deadlines (default 4 weeks). |
| Trend | Window for trend charts, completion rates, turnaround, hours variance (default 26 weeks). |
| Capacity horizon | Weeks shown on the capacity view and used for over-allocation (default 10). |

## Grain of the main metrics

| Metric family | Grain |
|---|---|
| Project health | one row per project, as of the reporting date |
| Milestone status | one row per milestone (project × stage) |
| Work packages / hours | one row per work package (project × discipline × stage) after de-duplication |
| Deliverables | one register row (project × discipline × stage) |
| Resource allocation | resource × week (bookings summed per person-week) |
| Action status | one row per action item (counted once regardless of how many names the owner field holds) |
| Minutes capture | one matched calendar meeting |
| Proposal turnaround | one proposal with a submitted event |
| Change orders | one change order |
| Data quality | one exception / one staged record / one sync run |
