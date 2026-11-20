# Interview talking points — PMO 360 (Option 1: a dashboard built end-to-end)

Spoken-style answers in the first person. Legend: ✔ verifiable in the PMO 360 repository · 🧪 synthetic demo only · **[CONFIRM: …]** a production fact you supply before the interview (the query that produces it is listed at the end). Do not say any 🧪 number as if it happened at Castillo.

---

## Question A — "Walk me through a dashboard you built." (~2 minutes)

**The problem.** "At Castillo Engineering we design utility-scale solar, battery-storage and substation projects. Our PMs each run weekly coordination meetings across many portfolios — about forty to fifty-plus portfolios across twenty-odd clients. Status lived in five places: job numbers and tasks in Monday.com, meetings in Outlook, schedules in Excel proposal workbooks, action items in meeting notes, and staffing in people's heads. Nobody could answer 'what's overdue across the whole PMO, and who owns it' without an afternoon of copying."

**My ownership.** "I built PMO 360 end to end as the primary engineer: requirements with the PMs, data model, FastAPI backend, React frontend, the Monday and Microsoft Graph integrations, Entra sign-in and the Azure deployment. Over about six months that was 223 commits and 30 merged pull requests — all mine." ✔

**Architecture.** "Python FastAPI over PostgreSQL, React and TypeScript on top. Integrations are read-only by design: a Monday GraphQL sync that refuses any write, and Graph for calendars. Meeting notes go through an LLM parser, and a PM reviews every extracted action before it's saved. The dashboards are part of the application, not a separate BI layer, so the screens where data is entered are the same ones that report on it."

**The dashboard.** "Three layers. A lead view ranks every portfolio worst-first by overdue and open actions and shows each PM's workload and unassigned items. A personal *My Work* view shows what's mine: open, overdue, due this week, undated. And a Timeline capacity board shows every engineer's bookings against time off, so staffing a milestone happens with everyone's load visible. Every number drills to the records behind it."

**Outcome.** "It replaced scattered status checks with one shared view for [CONFIRM: n] active users. In the last [period] the team captured [CONFIRM: n] meetings and tracked [CONFIRM: n] action items in it. The thing I'm proudest of is that the numbers are trusted, because I spent real effort making the definitions right — I'll explain that in the data question."

*(If they want to see it: "I rebuilt it on synthetic data so I can show it without company information — same stack, same data model, same rules.")*

---

## Question B — "Who used it, and what decision did it change?"

**Who.** "Four groups, plus one indirect group.
1. **Project managers**, the core users: minutes, rolling actions, agendas, *My Work*.
2. **The PM lead and operations leadership**: the cross-portfolio lead view. I first built it for leads only; the team asked for it to be open to every PM, and I changed it. ✔ That told me PMs wanted to see the whole picture, not just their slice.
3. **Department leads doing resourcing**: the Timeline board. Proposal schedules can be pushed straight onto it and dragged onto engineers.
4. **Commercial and approvers**: proposals and change orders with an approval history.
And clients, indirectly: they receive the generated minutes and action logs."
Scale ✔: ~42 portfolios under ~21 clients and 8 staff to assign when I built the staffing panel; later ~25 clients and 53 portfolios; 118 client contacts; 50 production proposal workbooks. Active users: **[CONFIRM: Q2]**.

**What decision changed.** "The decision is *where the team spends follow-up and staffing effort each week, and how early*. Before, prioritisation happened in the meeting from memory, and a slipped action surfaced when someone remembered it. Now the lead view says which two or three portfolios have the most overdue items, each PM sees exactly what they own, and staffing is agreed on a board that shows everyone's load before a milestone is committed."

**A concrete instance** — use a real one: **[CONFIRM: e.g. "In <month> the lead view showed <n> overdue actions concentrated on <portfolio type>. We <re-assigned owners / escalated to the client / moved a milestone>, and within <n> weeks overdue on that portfolio dropped from <n> to <n>."]** Pull the before/after from Q5 for that portfolio.

**The verified one, if you have no measured instance yet** ✔: "The clearest decision the data changed was about the dashboard itself. On real data, a PM who owned nothing saw 30 open and 30 overdue actions, and one screen said 27 overdue where another said 2 — because whoever typed the minutes counted as owning everything in them. I rewrote ownership as one explicit rule shared by every screen, and fixed the owner picker, which had been silently failing, so new actions carry a real user id. People act on numbers they trust. That was the precondition for any operational decision."

**What I'll show (synthetic, labelled as such)** 🧪: "In the demo, four substation projects all read 'on track', but the capacity view shows all their design packages sit on three senior engineers booked above 110% for weeks, one through his PTO. The decision is to have the lead take one package, bring in a contractor for half of two others, and re-sequence one IFP by five days with the client. Over-allocated person-weeks go from 8 to 1, and the dashboard shows the cost: one milestone moves to at-risk. That's the workflow PMO 360 supports, demonstrated on invented data."

---

## Question C — "What did you have to do to the underlying data?" (~2–3 minutes)

"Most of the work was here, not in the charts.

**One — identity.** Nothing shared an identifier. The business refers to projects by job number, but that number lived only in Monday. I built a read-only Monday sync: it refuses any mutation, resolves columns by *title* because column ids regenerate, and pages with cursors. It matches names only exactly, after stripping case, punctuation and spacing. No fuzzy matching, because a wrong match files work against another client's project. Ambiguous, orphan and unnumbered cases go to a report for a human; nothing is auto-created, because one Monday item can cover two portfolios. 38 of 40 board items carried a number. ✔ I stored the job number as an opaque string, indexed but deliberately *not unique*: correct data needed duplicates, and a unique violation would have crashed start-up.

**Two — unstructured input.** Action items came from meeting notes. An LLM parses notes into structured actions and discussion points, but a PM reviews every item before it's saved. The model proposes, a person disposes.

**Three — modelling.** PostgreSQL with Client → Portfolio → Project. Actions carry the meeting that raised them and the meeting that closed them, so we can reconstruct history. Invariants live in the database: unique portfolio membership, because a doubled row overstates staffing; one active proposal per project; optimistic-locking version columns for concurrent editors.

**Four — definitions.** Overdue means open and due *strictly before* today; due-this-week starts today so it never double-counts; undated work is reported, not hidden or called late; a blank estimate is unknown, never zero. Each rule is written once and every screen uses it.

**Five — ownership.** Owners were free text for most of the app's life. I made ownership a ranked rule (linked user id, then name match, then authorship only as a last resort) and fixed the entry point so the data improves going forward.

**Six — aggregation and validation.** Each dashboard endpoint runs a fixed number of bulk queries regardless of volume, and computes at a declared grain. In the rebuild I added what I'd add to production next: every source record staged as received, 24 validation rules with an exception log that drills to the raw payload, freshness SLAs per source, and 85 tests proving each KPI equals its drilldown and an independent SQL count. 🧪 For example, when I break the register export by renaming a column, the pipeline refuses the file, keeps yesterday's data, and turns freshness red instead of showing every deliverable as overdue."

---

## Short answers

**Why didn't you use Power BI or Tableau?** "The dashboard had to sit inside the workflow. Data quality was fixed at entry (owner picker, job-number field, status vocabulary), users act on what they see with one click, metric definitions are shared with the screens that create the data, and it runs on the same Entra sign-in with no extra licences for a small team. The trade-off is slower ad hoc analysis, so every drilldown exports CSV. At AWS scale I'd do both: curated tables feeding QuickSight for exploration, and an operational app where decisions get recorded."

**What was the hardest data-quality issue?** "Ownership. The owner picker called an endpoint capped at 200 users with a request for 500; the request failed, the failure was swallowed, and owners were saved as free text. Dashboards then attributed actions by whoever typed the minutes — one screen said 27 overdue, another 2. I fixed the picker, wrote one ranked ownership rule shared by every view, and made authorship a last resort."

**How did you prevent double-counting?** "Grain first: every metric declares what one row is. Natural-key uniqueness in the database (one work package per project × discipline × stage; one membership per person × portfolio). Aggregate before joining, so a package with two bookings is one row. A system of record per fact: hours from one source, 'issued' from another; disagreement is an exception, not a second count. And tests: each KPI must equal its drilldown and an independent count."

**How did you handle schema changes?** "Additive Alembic migrations (46 in production), run automatically at start-up; nullable first; no uniqueness on free text a user types; and defaults treated as security decisions. On the integration side: resolve Monday columns by title, and validate source schemas before reading a row. A renamed column fails the file loudly instead of loading blanks."

**How did you know users trusted the dashboard?** "The signal I can point to in the code is that the team asked for the lead view to be opened to every PM ✔ — people don't ask for wider access to numbers they don't believe. **[CONFIRM: usage — share of PMs active weekly (Q2), whether the weekly meetings' minutes are captured in PMO 360 (Q3), and whether the 27-vs-2 style discrepancy reports stopped after the ownership fix].** In the rebuild I'd make trust measurable: freshness and exception counts on screen, and usage instrumented from day one."

**What would you do differently?** "Instrument usage from day one; add monitoring on user-facing paths (a download bug went unnoticed in production for six days ✔); build the staging and exception layer from the start rather than reporting sync problems to a console; and agree metric definitions with stakeholders in writing before building screens."

**How would you adapt this for AWS equipment demand forecasting?** "The same skeleton, different entities. Sources: construction schedules, design packages (the IFP equivalent), supplier lead times, POs and inventory. A common data model keyed on site, equipment category and need-by date. Demand derived from schedule milestones; supply from orders and lead times; a gap view by category and week, like the capacity heatmap, with the exceptions and freshness layer underneath. I'd keep the forecast honest by back-testing it against what actually shipped. That's Option 2's discipline, and I'd build it into the dashboard rather than leave it as a separate model."

**How could the system handle 100× more data?** "Incremental extracts (Monday `updated_at` watermarks, Graph delta queries, CDC from the app database) instead of full refreshes; raw data in object storage by date; projections computed by the pipeline only for changed projects; materialised KPI tables per grain with dashboards reading pre-aggregated rows; a read replica; and a cache keyed by filters and data version. The query patterns already avoid per-row lookups."

**How did you decide what to build versus buy?** "Buy the systems of record — Monday, Microsoft 365 — and build the glue and the views that are specific to how we work: minutes to actions to agendas, job-number identity, our design stages, our capacity rules. The test: if a decision depends on our definitions, own the logic; if it's commodity storage or collaboration, integrate."

**What did you personally implement?** "All of it. ✔ The repository's 223 commits are mine: the data model and migrations, the FastAPI services, the React app, the Monday sync, the Graph integration, the LLM parsing with human review, auth and permissions, document generation, the Timeline capacity board, proposals and change orders, and the Azure deployment pipeline. For this interview I also rebuilt the analytics layer on synthetic data."

---

## Fill-in sheet — run before the interview

Run `tools/production_metrics.sql` read-only against production (it has been validated against PMO 360's real schema; it returns aggregates only). Then replace each placeholder.

| Placeholder | Query | Suggested phrasing |
|---|---|---|
| Active users | Q2 | "[n] people use it; [n] were active in the last 30 days" |
| Meetings captured | Q3 | "[n] coordination meetings captured since [month]" |
| Actions tracked | Q3 | "[n] action items tracked to closure" |
| Documents generated | Q4 | "[n] client-ready minutes and action logs generated" |
| Overdue trend | Q5 | "overdue share of open actions went from [x]% in [month] to [y]% in [month]" |
| Time to close | Q6 | "median time to close an action is [n] days" |
| Owner data quality | Q7 | "actions with a linked owner went from [x]% to [y]% after the picker fix" |
| Capacity use | Q8 | "[n] bookings for [n] engineers on the Timeline, [n] created straight from proposals" |
| CO decision time | Q9 | "median [n] days from approval request to decision" |
| A real decision | Q5 for one portfolio | the 2–3 sentence story in Question B |

If a number is unflattering, say it plainly and say what you did about it. Interviewers trust that more than a perfect chart.
