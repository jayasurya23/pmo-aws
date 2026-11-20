// Builds AWS_PMO360_Case_Study_Brief.docx — the short cover note that goes with the site link.
// Run from the repo root:  node case-study/build_brief.cjs
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, AlignmentType, LevelFormat, BorderStyle,
  ShadingType, HeadingLevel,
} = require("docx");

const DIR = __dirname;
const SITE = process.env.SITE_URL || "https://jayasurya23.github.io/pmo-aws/";
const ACCENT = "991F2B", INK = "1A1A1A", GRAY = "5D5B5A", GREEN = "1F7A3A";

const t = (text, o = {}) => new TextRun({ text, font: "Arial", size: 21, color: INK, ...o });
const b = (text, o = {}) => t(text, { bold: true, ...o });
const v = () => t(" [verified]", { size: 16, bold: true, color: GREEN });
const confirm = (text) => t(`[CONFIRM: ${text}]`, { bold: true, color: ACCENT, highlight: "yellow" });
const P = (runs, o = {}) => new Paragraph({ children: runs.filter(Boolean), spacing: { after: 100, line: 264 }, ...o });
const H = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: "Arial" })] });
const bullet = (runs) => new Paragraph({ numbering: { reference: "bul", level: 0 }, children: runs.filter(Boolean), spacing: { after: 50, line: 252 } });
const link = (text, url) => new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: "Hyperlink", font: "Arial", size: 21 })] });

function img(file, widthIn) {
  const buf = fs.readFileSync(path.join(DIR, "screenshots", file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const px = Math.round(widthIn * 96);
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 120 },
    children: [new ImageRun({ type: "png", data: buf, transformation: { width: px, height: Math.round(px * h / w) },
      altText: { title: "Start page of the PMO 360 demo site", description: "Start page answering the three case-study questions", name: file } })] });
}

const children = [
  new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "PMO 360: a dashboard I built end-to-end", font: "Arial", size: 34, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 140 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 4 } },
    children: [t("Case study, Option 1 · Supply Chain Program Manager, Data Center Sourcing & Procurement · Jayasurya", { size: 19, color: GRAY })] }),

  new Paragraph({ spacing: { after: 140, line: 264 }, shading: { fill: "F5F4F3", type: ShadingType.CLEAR, color: "auto" },
    children: [b("Live demo: "), link(SITE, SITE),
      t(" · opens on a Start page that answers the three questions below, with links to the screens that show each answer. It is a working demonstration on PMO 360's stack (FastAPI, PostgreSQL, React) and data model, running on invented data so it can be shared. Every number opens the records behind it.", { size: 19 })] }),

  H("Who used it"),
  P([t("PMO 360 is the project-operations platform I designed and built at Castillo Engineering (utility-scale solar, battery storage and substation design). Its users: "),
    b("project managers"), t(" (minutes, rolling action items, a personal \"what I owe\" view), "),
    b("the PM lead and leadership"), t(" (every portfolio ranked worst-first, with each PM's workload), "),
    b("department leads"), t(" (a capacity board for deciding who takes which milestone), and "),
    b("approvers"), t(" (change orders with an approval history). The lead view started as leads-only; the team asked for it to be open to every PM, and I changed it."), v(),
    t(" Scale: about 42–53 portfolios under 21–25 clients."), v(), t(" "), confirm("active users and meetings / actions tracked per month")]),

  H("What decision it changed"),
  P([t("Before, status lived in Monday.com, Outlook, Excel schedules and meeting notes, and prioritisation happened in the weekly meeting from memory. PMO 360 puts one shared view in front of the team, so it decides "),
    b("where follow-up and staffing effort goes each week, and how early it acts"), t(". "),
    confirm("one real instance: what the view showed, what was changed, and the before/after numbers")]),
  P([t("One decision is fully verifiable in the code: one screen showed a PM 27 overdue actions while another showed 2, because whoever typed the minutes counted as owning everything in them."), v(),
    t(" I rewrote ownership as a single rule shared by every screen and fixed the owner picker at the point of entry. People act on numbers they trust. On the demo site, the "),
    b("Two decisions"), t(" page shows the workflow on synthetic data: staffing four \"on track\" substation projects differently cuts three engineers' over-allocated person-weeks from 7 to 1, at the visible cost of one project moving to at risk.")]),

  H("What I did to the underlying data"),
  bullet([b("Identity across systems: "), t("a read-only Monday.com sync that matches names exactly and reports anything ambiguous instead of guessing; 38 of 40 board items carried a job number."), v()]),
  bullet([b("Unstructured input: "), t("an LLM turns meeting notes into structured action items, and a PM reviews each one before it is saved.")]),
  bullet([b("One definition per metric: "), t("overdue means due strictly before today; undated work is reported, not hidden; a blank estimate is unknown, never zero.")]),
  bullet([b("Model and constraints: "), t("PostgreSQL client → portfolio → project, with uniqueness and concurrency rules enforced by the database.")]),
  bullet([b("Proof: "), t("the demo stages every source record as received, logs every validation exception down to its raw payload, and has 85 automated tests that check each KPI equals its drilldown and an independent SQL count.")]),

  img("12_start_page.png", 6.3),

  P([b("About the site. "), t("PMO 360 itself, built by me over about six months (223 commits), stays private with its data."), v(),
    t(" The site runs the same kind of pipeline and dashboards on invented data. No client, project or employee on it is real.")], { spacing: { before: 60, after: 0, line: 264 } }),
];

const doc = new Document({
  creator: "Jayasurya", title: "PMO 360 — case study brief",
  styles: {
    default: { document: { run: { font: "Arial", size: 21, color: INK } } },
    paragraphStyles: [{ id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { font: "Arial", size: 25, bold: true, color: ACCENT },
      paragraph: { spacing: { before: 180, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 0 } }],
  },
  numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } }, children }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(DIR, "AWS_PMO360_Case_Study_Brief.docx");
  fs.writeFileSync(out, buf);
  console.log("wrote", out);
});
