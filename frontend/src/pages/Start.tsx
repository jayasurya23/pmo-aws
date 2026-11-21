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
        PMO 360 put it in one place for project managers, the PM lead, department leads and approvers.
      </p>
      <p className="mt-4 inline-block rounded-full bg-[#fab219]/15 px-3.5 py-1.5 text-[15px] text-brand-black">Invented data: no client, project or person here is real.</p>

      <h2 className="text-[24px] font-bold mt-10">Start with a decision</h2>
      <p className="text-[17px] text-brand-gray mt-1">Each one takes about a minute, step by step.</p>
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
                  {d.real && <span className="text-[13px] font-semibold rounded-full bg-st-good/15 text-brand-green px-2.5 py-0.5">Happened at work</span>}
                </span>
                <span className="block text-[19px] font-semibold leading-snug mt-1">{d.title}</span>
              </span>
              {result && <span className="hidden sm:block text-[16px] font-semibold text-brand-green whitespace-nowrap">{result}</span>}
              <span className="text-[22px] text-brand-lightgray group-hover:text-brand-red transition">→</span>
            </Link>
          );
        })}
      </div>

      <h2 className="text-[24px] font-bold mt-10">Or explore</h2>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <Link to={EXEC_PATH} className="card p-5 hover:border-brand-lightgray hover:shadow-page transition">
          <div className="text-[19px] font-semibold">The dashboards →</div>
          <div className="text-[16px] text-brand-gray mt-1.5 leading-snug">Overview, Schedule, Team capacity, Action items, Proposals and Billables. Click any number to see the records behind it.</div>
        </Link>
        <Link to="/pipeline" className="card p-5 hover:border-brand-lightgray hover:shadow-page transition">
          <div className="text-[19px] font-semibold">How the numbers come together →</div>
          <div className="text-[16px] text-brand-gray mt-1.5 leading-snug">How data from several tools that didn't agree became numbers people could trust.</div>
        </Link>
      </div>
      <p className="text-[15px] text-brand-gray mt-8">Built by Jayasurya.</p>
    </div>
  );
}
