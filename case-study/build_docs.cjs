// Builds the case-study Word documents from their Markdown sources, so the
// text lives in one place:
//   AWS_PMO360_Case_Study.md        -> AWS_PMO360_Case_Study.docx
//   AWS_PMO360_Case_Study_Brief.md  -> AWS_PMO360_Case_Study_Brief.docx
// Run from the repo root:  node case-study/build_docs.cjs
// Handles the small Markdown subset the sources use: # and ## headings, > note,
// - bullets, **bold**, links, ![caption](image) and [add: ...] placeholders.
const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, AlignmentType, LevelFormat,
  BorderStyle, ShadingType, HeadingLevel, Footer, PageNumber } = require("docx");

const DIR = __dirname;
const ACCENT = "991F2B", INK = "1A1A1A", GRAY = "5D5B5A";
const FONT = "Arial", SIZE = 22; // 11 pt body

function runs(text, base = {}) {
  // Split into links, **bold** and [add: ...] pieces.
  const out = [];
  const re = /(\*\*[^*]+\*\*|\[add:[^\]]+\]|https?:\/\/\S+[^\s.,)])/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, size: SIZE, color: INK, ...base }));
    const s = m[0];
    if (s.startsWith("**")) out.push(new TextRun({ text: s.slice(2, -2), font: FONT, size: SIZE, color: INK, bold: true, ...base }));
    else if (s.startsWith("[add:")) out.push(new TextRun({ text: s, font: FONT, size: SIZE, color: ACCENT, bold: true, highlight: "yellow" }));
    else out.push(new ExternalHyperlink({ link: s, children: [new TextRun({ text: s, style: "Hyperlink", font: FONT, size: SIZE, ...base })] }));
    last = m.index + s.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, size: SIZE, color: INK, ...base }));
  return out;
}

function image(file, caption, widthIn) {
  const buf = fs.readFileSync(path.join(DIR, file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  let px = Math.round(widthIn * 96), py = Math.round(px * h / w);
  const maxH = 6.2 * 96;
  if (py > maxH) { px = Math.round(px * maxH / py); py = Math.round(maxH); }
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true,
      children: [new ImageRun({ type: "png", data: buf, transformation: { width: px, height: py },
        altText: { title: caption, description: caption, name: path.basename(file) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 },
      children: [new TextRun({ text: caption, font: FONT, size: 18, italics: true, color: GRAY })] }),
  ];
}

function convert(md) {
  const lines = md.split("\n");
  const kids = [];
  let title = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("# ")) {
      title = line.slice(2);
      kids.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: title, font: FONT, size: 36, bold: true, color: INK })] }));
      const sub = (lines[i + 2] || "").trim();
      if (sub && !sub.startsWith("#") && !sub.startsWith(">")) {
        kids.push(new Paragraph({ spacing: { after: 180 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6 } },
          children: [new TextRun({ text: sub, font: FONT, size: 19, color: GRAY })] }));
        i += 2;
      }
    } else if (line.startsWith("## ")) {
      kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: line.slice(3), font: FONT })] }));
    } else if (line.startsWith("> ")) {
      kids.push(new Paragraph({ spacing: { after: 180, line: 276 }, shading: { fill: "F3F2F1", type: ShadingType.CLEAR, color: "auto" },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } }, indent: { left: 160 },
        children: runs(line.slice(2), { size: 20 }) }));
    } else if (line.startsWith("- ")) {
      kids.push(new Paragraph({ numbering: { reference: "bul", level: 0 }, spacing: { after: 80, line: 276 }, children: runs(line.slice(2)) }));
    } else if (line.startsWith("![")) {
      const m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      kids.push(...image(m[2], m[1], 6.3));
    } else {
      kids.push(new Paragraph({ spacing: { after: 140, line: 288 }, children: runs(line) }));
    }
  }
  return { title, kids };
}

function build(src, out) {
  const { title, kids } = convert(fs.readFileSync(path.join(DIR, src), "utf8"));
  const doc = new Document({
    creator: "Jayasurya", title,
    styles: {
      default: { document: { run: { font: FONT, size: SIZE, color: INK } } },
      paragraphStyles: [{ id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 27, bold: true, color: ACCENT },
        paragraph: { spacing: { before: 260, after: 100 }, keepNext: true, keepLines: true, outlineLevel: 0 } }],
    },
    numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1300, right: 1300 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "PMO 360 case study · ", font: FONT, size: 16, color: GRAY }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GRAY })] })] }) },
      children: kids,
    }],
  });
  return Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(path.join(DIR, out), buf); console.log("wrote", out); });
}

build("AWS_PMO360_Case_Study.md", "AWS_PMO360_Case_Study.docx")
  .then(() => build("AWS_PMO360_Case_Study_Brief.md", "AWS_PMO360_Case_Study_Brief.docx"));
