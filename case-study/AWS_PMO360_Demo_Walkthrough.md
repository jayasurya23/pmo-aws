# Five-minute live demo script

**Labels:** **[PROD]** = exists in production PMO 360 · **[ADAPTED]** = production logic, rebuilt here · **[DEMO]** = built for this case study, not in production. Say the label out loud when it matters. Every record on screen is synthetic.

## Before the call (2 minutes)

```bash
cd backend && ../.venv/bin/python -m pipeline.run --reset   # fresh, deterministic data
```
* Start the API (`make api`) and the web app (`make web`, or `docker compose up`), then open http://localhost:5173 (or :8080 with Docker).
* On **Decision scenarios**, make sure both cards say "Current state: before the decision" (press *Reset to before* if not).
* Light theme, browser zoom 90%, one tab. Close the drilldown drawer between steps.

---

## Minute 1 — The business problem and the users (talk over the Executive overview)

**Open:** `/` (Executive overview).

**Say:** "At Castillo our PMs run weekly coordination meetings across forty to fifty-plus portfolios. Status was spread across Monday, Outlook, Excel proposal schedules and meeting notes. I built PMO 360 to put it in one place: PMs, the PM lead, department leads doing resourcing, and approvers all use it. This is a rebuild on invented data, so I can show it without company information; the stack, data model and rules are the real ones."

**Point at:** the yellow *Synthetic Demonstration Data* label (left), and *Data as of 20 Nov 2026* (top right).

**Proves:** you can state the problem, the users and the ownership in under a minute.

## Minute 2 — The executive view and one operational question

**Stay on:** `/`.

1. **Hover** the ⓘ on *Behind schedule*: "Every KPI carries its definition, grain and source. That's the metric catalogue the API serves." **[DEMO]** catalogue; the *overdue* rule is **[PROD]**.
2. **Click** the red *Behind* block in *Portfolio health*. The drawer lists the projects. **Search** "Cedar" → **click** *Cedar Hollow Solar + Storage*.
   "One rule everywhere: *Behind* means a milestone is **already** late, *At risk* means **projected** late. Open work is never called overdue just for being open."
3. On the project page, point at the **milestone timeline** (90% red: late; IFC orange: projected +27 business days) and *How each open milestone was projected*: "Structural 90% has been blocked since 2 November waiting on the client's geotech report. The projection says IFC slips about five weeks, and it shows its inputs, so a PM can argue with the number, not the colour." **[DEMO]** milestones and projection.
4. Point at **Action items**: the client geotech action is overdue and "Confirm pile design approach…" has **no owner**. **[PROD]** action model.

**Proves:** drill from a portfolio-level number to the specific blocker, the owner gap and the schedule consequence in three clicks.

## Minute 3 — Delivery → capacity: demonstrate a decision

1. **Open** `/capacity`. **Set** filter *Discipline: Substation*.
   "Now the decision the dashboard changes. The executive view says the four high-voltage substation projects are on track. Capacity says otherwise."
2. In the heatmap: **Priya Raman** red for four straight weeks; **Marcus Ojo** shows *PTO 32h* (work booked during his time off); **Elena Ruiz** red in mid-December. The lead, **Zoe Ortega**, is mostly under 50%. "Same formula as our production Timeline board, in hours, with holidays removed from both sides." **[ADAPTED]**
3. **Scroll** to *Projects competing for the same over-allocated people*: Granite Run, Ironleaf, Kettle River and Harrow Creek all depend on those three people.
4. **Open** `/scenarios` → S1 → **Apply the decision**. Read the deltas: senior over-allocated person-weeks **8 → 1**, peak **150% → 110%**, team **12 → 6**; Granite Run IFP re-baselined (rev 1) and its IFC moves to **At risk**. "The decision isn't free, and the dashboard shows the cost." **[DEMO]** scenario.
5. *(Optional, 20 s)* S2 → **Apply**: Cedar Hollow IFC goes from **projected late (27 bd)** to **on track**, while the 90% milestone stays **Late**: "it can't rewrite history; it protects the next milestone."

**Proves:** the dashboard surfaces a hidden constraint, supports a concrete decision, and shows the metrics that would confirm it worked.

## Minute 4 — The data: integration, validation, SQL

1. **Open** `/pipeline` (*How the data flows*): source → stage → validate → normalise → PostgreSQL → API → React, with live counts. "The Monday extract is our production sync logic: read-only, columns resolved by title, exact name matching, never auto-create. Five teams' status labels map to one vocabulary through a config table." **[ADAPTED]**
2. **Open** `/quality`. The red banner: "Yesterday someone renamed a column in the register export. The pipeline refused the file and kept the last good data, and freshness is red, instead of showing every deliverable as overdue." Point at *Source freshness vs SLA* and the 14-day strip (earlier days are labelled simulated history). **[DEMO]**
3. **Click** *Duplicate source record* in *Open exceptions by validation rule* → in the table, **click** *Raw payload*: "Every number traces back to the source record as received." **[DEMO]**
4. Back on `/pipeline`, point at *How the dashboard SQL is built*: "Grain first, one shared scope predicate, and every KPI is a `COUNT` over the same rows its drilldown returns. 84 tests check that against an independent count."

**Proves:** the work under the charts: identity, normalisation, validation, lineage, reconciliation.

## Minute 5 — Ownership, trade-offs, results, AWS

**Open:** `/about` (*Original vs demo*).

**Say:** "To be precise about what's real: the hierarchy, meetings, actions, the overdue and ownership rules, the lead view, the Timeline capacity board, the Monday sync and calendar matching are production PMO 360, all built by me. The milestone projection, the work board, the register, the data-quality layer and the scenarios are things I built for this demo to show the full discipline. In production, the outcome I can verify is a trusted single view across ~42–53 portfolios; [CONFIRM: active users, meetings and actions tracked, overdue trend]. The hardest part was the data: identity across systems, and an ownership rule people could trust after one screen said 27 overdue and another said 2.
For DCSP it's the same job: sit with the category and supply-chain managers, integrate tools that disagree, standardise definitions, and give them self-service views they trust enough to decide from. IFP in our world is exactly the engineering signal long-lead equipment procurement waits on."

**Then:** reset both scenarios on `/scenarios`.

---

### If something goes wrong
* A blank dashboard means the API isn't running or the pipeline hasn't loaded. Run `make seed` and `make api`.
* Out of time: skip step 5 of minute 3 and step 3 of minute 4.
* Asked "is this real data?": "No. It's a deterministic synthetic world written out in each source's real format. The production code and data stay private."
