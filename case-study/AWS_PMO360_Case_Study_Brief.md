# PMO 360: a dashboard I built, and the decisions it changed

Case study, Option 1 · Supply Chain Program Manager, Data Center Sourcing & Procurement · Jayasurya

> **Website:** https://jayasurya23.github.io/pmo-aws/ . The Start page answers the three questions below in about five minutes. The dashboards use invented data; no client, project or person on the site is real.

## Who used it

I built PMO 360 at Castillo Engineering, where we design utility-scale solar projects. Before it, project status was spread across Monday.com, Smartsheet, Outlook, spreadsheets and meeting notes, and priorities were set in the weekly meeting from memory. PMO 360 brought it together in one set of dashboards, covering about 42 to 53 portfolios across 21 to 25 clients.

- **Project managers:** their own list of what they owe, to whom, and by when.
- **The PM lead and leadership:** every project ranked worst first. This view started as leads-only; the project managers asked for it, so I opened it to everyone.
- **Department leads:** who has room for the next milestone, week by week.
- **Leadership and approvers:** proposals, billing and change orders waiting on them.

## What decisions it changed

The weekly meeting now starts from the dashboard, so the decision it changed is where staffing and follow-up effort goes each week, and how early we act. Three examples, each with a step-by-step walkthrough on the website:

- **One client decision holding up several projects.** As a design firm, most of our blockers are on the client's side: design decisions, data they owe us, and which equipment to use. Grouping blocked work by what it was waiting on showed one client decision behind several projects, so we settled it in one portfolio-level conversation instead of chasing each project.
- **Bidding within capacity.** Proposals looked fine one at a time. Adding them to work already sold, month by month, showed when winning them would overload a team, so start dates and staffing could be agreed before the work was awarded.
- **Overloaded engineers.** Projects read on track, but looking person by person showed the same few engineers carrying several of them. That made it possible to move work before anything slipped.

On the website's invented data, these play out as: billing at risk on one client's projects falls from $296K to about $6K; a team's peak month falls from 108% to 99% of its hours; and three engineers' overloaded weeks fall from 9 to 1.

## What I had to do to the data

- **One key across every tool.** Each tool named projects differently, so the project ID (our job number) became the primary key that ties records together. A missing or mistyped ID is flagged for a person, never guessed.
- **One meaning for each word.** Each team's status words map to one set, overdue means due before today, and a blank estimate is unknown, never zero.
- **Numbers people trust.** One screen once showed a project manager 27 overdue actions and another showed 2, because whoever typed the meeting notes was counted as owning everything in them. I made ownership one rule used by every screen, and every number opens the records behind it.
- **Sources that break safely.** Proposals come from the sales team's Monday.com CRM through its API. If a sync comes back malformed, it is refused and the last good data is kept, rather than loading bad data.
- **Meeting notes to action items.** An AI model drafts action items from meeting notes, and a project manager checks each one before it is saved.

![The Start page of the website](screenshots/12_start_page.png)

**Website:** https://jayasurya23.github.io/pmo-aws/
