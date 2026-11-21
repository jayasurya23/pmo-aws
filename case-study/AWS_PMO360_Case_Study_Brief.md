# PMO 360: a dashboard I built, and the decisions it changed

Case study, Option 1 · Supply Chain Program Manager, Data Center Sourcing & Procurement · Jayasurya

> **Live demo:** https://jayasurya23.github.io/pmo-aws/ . Start with "The decisions it changed". The data is invented; no client, project or person on the site is real.

## Who used it

I built PMO 360 at Castillo Engineering, where we design utility-scale solar projects. It brings project status out of Monday.com, Outlook, spreadsheets and meeting notes into one set of dashboards. Project managers use it for their own action list, the PM lead and leadership to see every project ranked worst first, department leads to see who has room, and approvers to see change orders waiting on them. It covers about 42 to 53 portfolios across 21 to 25 clients. The lead view started out as leads-only; the project managers asked for it, so I opened it to everyone. [add: weekly users and action items tracked a month]

## What decision it changed

Priorities used to be set in the weekly meeting from memory. Now the meeting starts from the dashboard, so the decision it changed is where staffing and follow-up effort goes each week, and how early we act. One real example: one screen showed a project manager 27 overdue actions and another showed 2, because whoever typed the notes was counted as owning everything in them. I made ownership one rule shared by every screen. People only act on numbers they trust. [add: one real decision with before and after]

The demo walks through two decisions step by step, on invented data:

- **Staffing.** Four projects all read "on track", but Team capacity showed they all relied on the same three senior engineers, booked over 110% for weeks. Moving work to the team lead and a contractor, and shifting one deadline with the client, cut their overloaded weeks from 9 to 1. One project moves to "at risk", and the dashboard says so.
- **Schedule.** One project's final milestone was projected 28 business days late because a package was waiting on the client and a follow-up had no owner. Carrying on with an agreed assumption and adding an engineer brought it back to 2 days.

## What I had to do to the data

- Matched records across tools on exact names only, plus links confirmed by hand. Anything unclear is flagged for a person, never guessed.
- Gave each word one meaning: each team's status words map to one set, overdue means due before today, and a blank estimate is unknown rather than zero.
- Used an AI model to turn meeting notes into draft action items, with a project manager checking each one before it is saved.
- Made every number open the records behind it, so anyone can check it.

![The Start page of the demo](screenshots/12_start_page.png)
