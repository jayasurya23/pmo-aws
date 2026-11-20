// Builds AWS_PMO360_Dashboard_Case_Study.docx (US Letter, ~4-5 pages).
// Run from the repo root:  node case-study/build_docx.cjs
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, LevelFormat, BorderStyle, Footer, PageNumber, HeadingLevel, TabStopType,
} = require("docx");

const DIR = __dirname;
const SHOT = (f) => path.join(DIR, "screenshots", f);
const ACCENT = "991F2B", INK = "1A1A1A", GRAY = "5D5B5A", GREEN = "1F7A3A", AMBER = "8A6100";
const W = 9360; // content width in DXA (8.5in - 2 x 1in)

const t = (text, o = {}) => new TextRun({ text, font: "Arial", size: 21, color: INK, ...o });
const b = (text, o = {}) => t(text, { bold: true, ...o });
const tag = (kind) => kind === "v" ? t(" [verified]", { size: 16, bold: true, color: GREEN })
  : kind === "d" ? t(" [synthetic demo]", { size: 16, bold: true, color: AMBER })
  : null;
const confirm = (text) => t(`[CONFIRM: ${text}]`, { bold: true, color: ACCENT, highlight: "yellow" });

const P = (runs, o = {}) => new Paragraph({ children: Array.isArray(runs) ? runs.filter(Boolean) : [runs], spacing: { after: 100, line: 264 }, ...o });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: "Arial" })] });
const bullet = (runs) => new Paragraph({ numbering: { reference: "bul", level: 0 }, children: runs.filter(Boolean), spacing: { after: 60, line: 252 } });
const num = (runs) => new Paragraph({ numbering: { reference: "num", level: 0 }, children: runs.filter(Boolean), spacing: { after: 60, line: 252 } });

function img(file, widthIn, caption) {
  const buf = fs.readFileSync(SHOT(file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const px = Math.round(widthIn * 96);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 40 },
      children: [new ImageRun({ type: "png", data: buf, transformation: { width: px, height: Math.round(px * h / w) },
        altText: { title: caption, description: caption, name: file } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 140 },
      children: [t(caption, { size: 17, italics: true, color: GRAY })] }),
  ];
}

function table(cols, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "D8D6D5" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (content, i, header) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    shading: header ? { fill: "F0EFEE", type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { after: 0, line: 240 },
      children: (Array.isArray(content) ? content : [t(content, { size: 18, bold: header })]).filter(Boolean) })],
  });
  return new Table({
    width: { size: widths.reduce((a, c) => a + c, 0), type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: cols.map((c, i) => cell(c, i, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }))],
  });
}
const s = (text, o = {}) => t(text, { size: 18, ...o });
const sb = (text, o = {}) => s(text, { bold: true, ...o });

const children = [
  new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "PMO 360: An Operations Dashboard I Built End-to-End", font: "Arial", size: 36, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 4 } },
    children: [t("Case study (Option 1) · Supply Chain Program Manager, Data Center Sourcing & Procurement, AWS · Jayasurya", { size: 19, color: GRAY })] }),
  new Paragraph({ spacing: { after: 160, line: 252 }, shading: { fill: "F5F4F3", type: ShadingType.CLEAR, color: "auto" },
    children: [s("How to read the numbers: ", { bold: true }), s("items tagged "), s("[verified]", { bold: true, color: GREEN }),
      s(" can be checked in the PMO 360 source repository; "), s("[synthetic demo]", { bold: true, color: AMBER }),
      s(" figures come from the rebuild I made for this interview, where every client, project and person is invented; "),
      s("[CONFIRM: …]", { bold: true, color: ACCENT }), s(" marks a production figure I will supply from a read-only query before submitting. I have not estimated any figure.")] }),

  H1("1. Project overview"),
  P([b("Context. "), t("Castillo Engineering designs utility-scale solar, battery-storage and substation projects. Project managers run weekly coordination meetings with clients and EPCs across many portfolios at once, through design stages from 30%, 60% and 90% to Issued for Purchase (IFP, the package clients order long-lead equipment from) and Issued for Construction (IFC).")]),
  P([b("Problem. "), t("Operational status lived in five places that did not agree: job numbers and tasks in Monday.com, meetings in Outlook, schedules in Excel proposal workbooks, action items in meeting notes, and staffing in spreadsheets. Nobody could answer \"what is overdue across all portfolios, and who owns it?\" without building the answer by hand.")]),
  P([b("My role. "), t("I am the primary software/AI engineer and built PMO 360 end to end: requirements with the PMs, data model, FastAPI backend, React frontend, Monday.com and Microsoft Graph integrations, Entra ID sign-in and Azure deployment. The repository shows 223 commits and 30 merged pull requests over about six months in 2026, all authored by me: 26 API routers (159 endpoints), 34 tables evolved through 46 migrations, about 79,000 lines of Python and TypeScript."), tag("v")]),
  P([b("Stack. "), t("FastAPI (Python) · PostgreSQL · React + TypeScript + Tailwind · Monday.com GraphQL · Microsoft Graph (Entra ID, Outlook, Mail, SharePoint) · OpenAI for meeting-note parsing with human review · Azure Container Apps via GitHub Actions.")]),

  H1("2. Who used the dashboard"),
  table(["User group", "What they needed to know", "How they used PMO 360"], [
    [[sb("Project managers"), s(" (core users)")], "What do I owe, to whom, by when, and what did the client promise us?",
      "Captured minutes (notes → AI parse → PM review → saved), rolled actions forward meeting to meeting, generated client minutes and agendas, worked from My Work: open, overdue, due this week, undated."],
    [[sb("PM lead and operations leadership")], "Which portfolios are slipping? Is anyone overloaded?",
      [s("Lead dashboard: portfolios ranked worst-first, per-PM workload, unassigned actions. Built for leads; "), sb("opened to every PM at the team's request"), tag("v")]],
    [[sb("Department leads (resourcing)")], "Who is free to take this milestone, and when?",
      "Timeline capacity board: bookings with utilisation and time off; proposal schedules pushed onto the board and dragged onto engineers; live refresh for concurrent editors."],
    [[sb("Commercial staff and approvers")], "What did we quote? What scope has been added? What am I asked to approve?",
      "Proposals → versioned schedules; change orders with named approval requests and an append-only history."],
    [[sb("Clients"), s(" (indirect)")], "Accurate minutes and action logs", "Received the generated PDF/Word minutes and action logs."],
  ], [2050, 2900, 4410]),
  P([b("Scale in production. "), t("When I built the bulk staffing panel, PMO 360 held about 42 portfolios under ~21 clients with 8 staff to assign. Later snapshots: 23 clients and 118 client contacts; a 40-item Monday Portfolio board; 50 production proposal workbooks."), tag("v"),
    t(" At one documented snapshot: ~25 clients, 53 portfolios, 24 sub-projects. "), confirm("active users per month and in the last 30 days; meetings captured and actions tracked (queries Q2–Q3)")], { spacing: { before: 120, after: 100, line: 264 } }),
  ...img("01_executive.png", 6.2, "Figure 1 — Executive view in the synthetic demo rebuild: one health rule, every number drillable to its records."),

  H1("3. What decision did the dashboard change?"),
  P([b("Before: "), t("prioritisation happened inside the weekly meeting, from memory. A slipped action surfaced when someone remembered to ask, and staffing a new milestone meant asking around. "),
    b("After: "), t("PMO 360 is built so the weekly cycle starts from the data. The lead view ranks portfolios worst-first, so follow-up goes to the two or three portfolios with the most overdue items, not the loudest. Each PM sees exactly what is theirs. Staffing is agreed on the Timeline board with every engineer's load visible before a milestone is committed. "),
    b("The decision it changes is where the team spends follow-up and staffing effort each week, and how early it acts. "),
    confirm("a specific production instance: what the lead view showed, what was re-assigned / escalated / moved, and the overdue count before and after (query Q5)")]),
  P([b("A decision the data changed that is verifiable in code. "), t("Early on, the person who typed the minutes counted as owning every action in them. On real data, a PM who owned nothing saw 30 open / 30 overdue actions, and one screen said 27 overdue where another said 2."), tag("v"),
    t(" I rewrote ownership as one explicit rule shared by every screen (linked user id → name match → authorship only as a last resort) and fixed the owner picker, which had silently failed by asking a 200-user endpoint for 500 users. People act on numbers they trust; making this one right was the precondition for every operational decision.")]),
  P([b("Demonstrated decision workflow. "), t("In the rebuild, four high-voltage substation projects all read On track, but the capacity view shows that their design packages sit on three senior engineers, each booked above 110% of available hours for weeks, one through his PTO. The decision: the substation lead takes one IFC package, a contract engineer takes half of two 90% packages, and one IFP is re-sequenced by five days with the client. Over-allocated person-weeks fall from 8 to 1 and peak load from 150% to 110%; the dashboard also shows the cost, one milestone moving to at-risk."), tag("d")]),
  ...img("09_scenario1_after.png", 5.6, "Figure 2 — Synthetic demo: the capacity decision applied. Dashed lines show the state before; the table shows the milestone trade-off."),

  H1("4. What I had to do to the underlying data"),
  bullet([b("Identity across systems. "), t("No shared key existed; the job number lived only in Monday. I built a read-only Monday GraphQL sync that refuses any mutation, resolves columns by title (ids regenerate), pages with cursors and runs as a dry run by default. It matches names exactly after removing case, punctuation and spacing, and reports ambiguous, orphan and unnumbered items instead of guessing or auto-creating. 38 of 40 board items carried a number."), tag("v")]),
  bullet([b("Opaque identifiers. "), t("Job numbers are stored as strings: never parsed, indexed but deliberately not unique, because one Monday item can cover two portfolios and a uniqueness violation would have crashed start-up.")]),
  bullet([b("Unstructured input. "), t("An LLM turns meeting notes into structured actions and discussion points; a PM reviews every item before it is saved. Outlook events are matched to portfolios by manual link, then client attendee email (internal colleagues are never indexed), then subject.")]),
  bullet([b("Data model (PostgreSQL). "), t("Client → Portfolio → Project; rolling actions carry the meeting that raised and closed them; Timeline bookings, proposals and change orders hang off the same hierarchy. Invariants live in the database: unique membership (a duplicate row overstates staffing), one active proposal per project, optimistic-locking version columns.")]),
  bullet([b("Definitions as code. "), t("Overdue = open and due strictly before today; due-this-week starts today so it never double-counts; undated work is reported, never hidden or called late; a blank estimate is unknown, never zero. Each rule is written once and shared by every screen.")]),
  bullet([b("Aggregation and API. "), t("Each dashboard endpoint runs a fixed number of bulk queries regardless of volume (My Work: eight), at a declared grain, and React renders it with drill-through.")]),
  bullet([b("What the rebuild adds"), t(" (demo-only): every source record staged as received with a hash; 24 validation rules with an exception log that drills to the raw payload; freshness SLAs; a broken register export refused whole rather than loaded as blanks; 85 tests proving each KPI equals its drilldown and an independent SQL count."), tag("d")]),
  ...img("00_architecture.png", 6.5, "Figure 3 — Architecture: production PMO 360 (solid) and the additions made in the synthetic rebuild (dashed)."),

  H1("5. Challenges and trade-offs"),
  bullet([b("Inconsistent data: "), t("owners were free text for most of the app's life. I fixed the entry point and resolved history by rule rather than cleaning the output.")]),
  bullet([b("Changing requirements: "), t("a Project tier under portfolios arrived mid-build. I scoped it to proposals first, with an additive migration and no backfill, so existing data behaved exactly as before.")]),
  bullet([b("Schema evolution: "), t("46 additive migrations applied automatically at start-up; defaults treated as security decisions. Change-order permissions are off by default because approval emails reach people who have never opened the app.")]),
  bullet([b("Reliability: "), t("a download bug (links missing the auth token) went unnoticed in production for six days."), tag("v"), t(" I replaced every such link with one authenticated path. The lesson: endpoint health is not user health.")]),
  bullet([b("Stakeholder feedback: "), t("staffing 8 people across ~42 portfolios took 336 dropdown interactions; I replaced it with one grouped, staged bulk panel."), tag("v"), t(" The lead view was opened to all PMs on request.")]),

  H1("6. Results and business impact"),
  table(["Category", "Result"], [
    [[sb("Verified (repository)", { color: GREEN })], "Single operational view across ~42–53 portfolios; built solo (223 commits, 30 PRs, ~6 months); ownership rule that removed a 27-vs-2 overdue discrepancy; Monday job-number backfill with exception reporting (38/40 numbered); lead view opened to all PMs; a 336-step staffing task replaced by one panel."],
    [[sb("Qualitative")], "Weekly coordination works from one shared view; client minutes and agendas are generated from the same records; change-order approvals carry history."],
    [[sb("Synthetic demo", { color: AMBER })], "Capacity decision: over-allocated person-weeks 8 → 1. Blocked-package decision: IFC projection moves from 27 business days late back inside tolerance. Invented data, shown to demonstrate the workflow."],
    [[sb("To confirm", { color: ACCENT })], "Active users (Q2); meetings captured and actions tracked (Q3); overdue share of open actions over time (Q5); median days to close an action (Q6); share of actions with a linked owner before and after the picker fix (Q7); change-order decision time (Q9)."],
  ], [2050, 7310]),

  H1("7. Lessons learned"),
  num([b("Define metrics before charts. "), t("Every disagreement between two screens was a definition problem: write the rule once, with its grain, and share it.")]),
  num([b("Fix data at entry, not in the dashboard. "), t("The owner picker did more for data quality than any clean-up query.")]),
  num([b("Show freshness and exceptions next to the numbers. "), t("People trust a dashboard that admits what it doesn't know.")]),
  num([b("Adoption follows usefulness to the person doing the work. "), t("PMs adopted the tool that wrote their minutes; the dashboard came with it.")]),
  num([b("Next time: "), t("instrument usage from day one, monitor user-facing paths, and build the staging and exception layer into production.")]),
  P([b("Relevance to DCSP. "), t("The role is the same shape: partner with the people who make the decisions (PMs here; category and supply-chain managers there), integrate internal tools that disagree, standardise definitions across programmes, and build self-service reporting people trust enough to act on. The IFP milestone is the engineering signal long-lead equipment procurement waits on.")], { spacing: { before: 100, after: 60, line: 264 } }),
  P([t("Appendix: read-only production queries (tools/production_metrics.sql, Q1–Q11) return aggregates only and have been validated against PMO 360's schema. The synthetic React + FastAPI + PostgreSQL rebuild is available to demo live.", { size: 17, italics: true, color: GRAY })]),
];

const doc = new Document({
  creator: "Jayasurya", title: "PMO 360 — Dashboard Case Study", description: "AWS DCSP case study, Option 1",
  styles: {
    default: { document: { run: { font: "Arial", size: 21, color: INK } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Arial", size: 26, bold: true, color: ACCENT },
        paragraph: { spacing: { before: 220, after: 100 }, keepNext: true, keepLines: true, outlineLevel: 0 } },
    ],
  },
  numbering: { config: [
    { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] },
    { reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }],
      children: [t("PMO 360 case study · synthetic demo figures are labelled; no confidential data included", { size: 15, color: GRAY }),
        t("\tPage ", { size: 15, color: GRAY }), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 15, color: GRAY })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(DIR, "AWS_PMO360_Dashboard_Case_Study.docx");
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");
});
