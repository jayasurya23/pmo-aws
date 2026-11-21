import { Link } from "react-router-dom";
import { EXEC_PATH } from "@/components/Layout";
import { STATIC, useApi } from "@/lib/api";
import { decisionPath, DECISIONS } from "@/lib/decisions";

/** Landing page: a short intro, the decisions as one simple list, and two
 *  ways to explore further. Kept deliberately light. */
export default function Start() {
  const scen = useApi<any[]>("/scenarios");
  const outcomes = useApi<any>(STATIC ? "/scenarios/outcomes" : null);
  const stateOf = (key: string) => {
    const s = scen.data?.find((x) => x.key === key);
    const before = s ? (s.before ?? s.current) : null;
    const after = outcomes.data?.[key] ?? (s?.applied ? s.current : null);
    return { before, after };
  };
  return (
    <div className="max-w-[960px]">
      <div className="kicker">Case study</div>
      <h1 className="text-[42px] font-bold tracking-[-0.02em] leading-tight mt-2">PMO 360</h1>
      <p className="text-[22px] leading-snug mt-2 font-medium">A project dashboard I built for an engineering team, and the decisions it changed.</p>
      <p className="text-[18px] text-brand-gray mt-4 leading-relaxed">
        Before it, project status was spread across Monday.com, Smartsheet, Outlook, spreadsheets and meeting notes.
        PMO 360 put it in one place. This page answers three questions: who used it, what decisions it changed, and what it took to make the data work.
      </p>
      <p className="mt-4 inline-block rounded-full bg-[#fab219]/15 px-3.5 py-1.5 text-[15px] text-brand-black">The dashboards and walkthroughs use invented data: no client, project or person in them is real.</p>

      <h2 className="text-[24px] font-bold mt-10"><span className="text-brand-red mr-2">1.</span>Who used it</h2>
      <p className="text-[17px] text-brand-gray mt-1">{hl("About **42 to 53 project portfolios** across 21 to 25 clients. The lead view started as leads-only; **the project managers asked for it, so it was opened to everyone**. Everywhere: plain words, works on a phone, and every number opens the records behind it.")}</p>
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        {[["Project managers", "What do I owe, to whom, and by when?", "/actions", "Action items", "**Overdue first**, and every action traced back to the meeting that raised it."],
          ["The PM lead and leadership", "Which projects are slipping, worst first?", EXEC_PATH, "Overview", "**Worst first**, so the first screen is the one that needs action."],
          ["Department leads", "Who has room for the next milestone?", "/capacity", "Team capacity", "**Person by person**, because team averages hide overload."],
          ["Leadership and approvers", "Which proposals and billing need attention?", "/proposals", "Proposals", "**Stuck items flagged in red**, so nothing waits unseen."]].map(([who, q, to, page, design]) => (
          <Link key={who} to={to} className="card px-5 py-4 hover:border-brand-lightgray hover:shadow-page transition">
            <div className="text-[17px] font-semibold">{who}</div>
            <div className="text-[16px] text-brand-gray mt-0.5">{q}</div>
            <div className="text-[15px] mt-2 pl-3 border-l-2 border-brand-red/40"><span className="font-semibold">Designed so:</span> {hl(design)}</div>
            <div className="text-[14.5px] link mt-2">See {page} →</div>
          </Link>
        ))}
      </div>

      <h2 className="text-[24px] font-bold mt-10"><span className="text-brand-red mr-2">2.</span>Decisions it changed</h2>
      <p className="text-[17px] text-brand-gray mt-1">Calls the team made because the dashboard showed a problem early. Each walks through what it showed, what we decided, and what changed, in about a minute. The names and numbers are invented.</p>
      <div className="mt-4 space-y-3">
        {DECISIONS.map((d, i) => {
          const { before, after } = stateOf(d.key);
          const result = d.result(before, after);
          return (
            <Link key={d.slug} to={decisionPath(d)}
              className="group flex items-center gap-5 card px-5 py-4 hover:border-brand-lightgray hover:shadow-page transition anim-rise"
              style={{ animationDelay: `${i * 90}ms` }}>
              <span className="w-11 h-11 rounded-full bg-brand-red text-white grid place-items-center text-[18px] font-bold shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold uppercase tracking-[0.1em] text-brand-gray">{d.tag}</span>
                </span>
                <span className="block text-[20px] font-bold leading-snug mt-1">{d.decision}</span>
                <span className="block text-[16px] text-brand-gray leading-snug mt-0.5">{d.title}</span>
              </span>
              {result && <span className="hidden sm:block text-[16px] font-semibold text-brand-green whitespace-nowrap">{result}</span>}
              <span className="text-[22px] text-brand-lightgray group-hover:text-brand-red transition">→</span>
            </Link>
          );
        })}
      </div>

      <h2 className="text-[24px] font-bold mt-10"><span className="text-brand-red mr-2">3.</span>What it took to make the data work</h2>
      <p className="text-[17px] text-brand-gray mt-1">Most of the work wasn't the charts. It was getting data from tools that disagreed into numbers people would act on. The same problems show up in any sourcing team.</p>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        {[["Every tool named the same project differently",
           "Made **the project ID the one key across every tool**. A missing or mistyped ID is flagged for a person, never guessed.",
           "The same supplier or part showing up differently in contracts, purchase orders and trackers."],
          ["Teams used different words for the same status",
           "Mapped **every team's words to one set**, and kept missing dates visibly missing instead of treating them as fine.",
           "\u201cShipped\u201d, \u201cdispatched\u201d and \u201cin transit\u201d meaning the same thing, and an unknown delivery date that isn't on time."],
          ["People didn't trust the numbers",
           "One screen showed a manager **27 overdue actions, another showed 2**. I made it one rule everywhere, and every number opens the records behind it.",
           "One definition of a late order that a buyer and a director both see the same way."],
          ["A source can send bad data",
           "When the sales CRM sync came back broken, **it was refused and the last good data kept**, so nothing went blank overnight.",
           "A bad supplier feed shouldn't quietly wipe out a delivery forecast."]].map(([prob, did, sourcing], i) => (
          <div key={prob} className="card px-5 py-4 anim-rise" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="text-[17.5px] font-semibold leading-snug">{prob}</div>
            <div className="text-[16px] mt-2 leading-snug">{hl(did)}</div>
            <div className="text-[15px] text-brand-gray mt-2.5 pt-2.5 border-t border-surface-hairline leading-snug"><span className="font-semibold text-brand-black">In sourcing:</span> {sourcing}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-5">
        <Link to="/pipeline" className="btn-ghost">How the numbers come together →</Link>
        <Link to={EXEC_PATH} className="btn-ghost">Explore the dashboards →</Link>
      </div>
      <p className="text-[15px] text-brand-gray mt-8">Built by Jayasurya.</p>
    </div>
  );
}

/** Renders **phrase** as a highlighted key point. */
function hl(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 ? <b key={i} className="font-semibold text-brand-black bg-[#fab219]/25 rounded px-1 -mx-0.5">{part}</b> : part);
}
