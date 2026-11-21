# PMO 360: a dashboard I built, and the decisions it changed

Case study, Option 1 · Supply Chain Program Manager, Data Center Sourcing & Procurement · Jayasurya

> **Website:** https://jayasurya23.github.io/pmo-aws/ . I built PMO 360 at Castillo Engineering, where we design utility-scale solar projects. Before it, project status was spread across Monday.com, Smartsheet, Outlook, spreadsheets and meeting notes, and priorities were set in the weekly meeting from memory. The website runs on invented data; no client, project or person on it is real.

## 1. Decisions it changed

Calls the team made because the dashboard showed a problem early. Each has a one-minute walkthrough on the website.

- **Settle the client's equipment choice for all their projects in one meeting.** One client decision was holding up several projects. As a design firm, most of our blockers are on the client's side: design decisions, data they owe us, and which equipment to use. Grouping blocked work by what it was waiting on showed the same decision behind several projects, so one portfolio-level conversation replaced chasing each one.
- **Agree later start dates on proposals before they were awarded.** The pipeline looked healthy, but adding open proposals to work already sold, month by month, showed when winning them would overload one team.
- **Move work off overloaded engineers before anything slipped.** Projects read on track, but looking person by person showed the same few engineers carrying several of them.

On the website's invented data: billing at risk on one client's projects falls from $296K to about $6K; a team's peak month falls from 108% to 99% of its hours; three engineers' overloaded weeks fall from 9 to 1.

## 2. How I shaped it, and who used it

About 42 to 53 portfolios across 21 to 25 clients. The lead view started leads-only; **the project managers asked for it, so I opened it to everyone.**

- **Worst first** (PM lead, leadership): the first screen is the one that needs action.
- **Person by person** (department leads): team averages hide the few people who are overloaded.
- **Every number opens its records** (everyone): nobody has to ask where a number came from.
- **What do I owe, by when** (project managers): overdue first, each action traced to the meeting that raised it.

## 3. Making the data work

Project status lived in six places that didn't agree. Four problems to fix:

- **Same project, different names.** Made the project ID the one key across every tool. A missing or mistyped ID is flagged for a person, never guessed.
- **Same status, different words.** Mapped every team's words to one set. A missing date stays visibly missing, never treated as on time.
- **Two screens, two answers.** One screen said a manager had 27 overdue actions, another said 2. I made ownership one rule used everywhere.
- **Feeds that break.** Proposals come from the sales team's Monday.com CRM through its API. When a sync comes back broken, it is refused and the last good data kept, so nothing goes blank.

![The Start page of the website](screenshots/12_start_page.png)

**Website:** https://jayasurya23.github.io/pmo-aws/
