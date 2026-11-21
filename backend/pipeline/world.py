"""Deterministic synthetic world for the PMO 360 demo.

ONE coherent world is generated first (people, clients, portfolios, projects,
milestones, work, capacity, meetings, commercial records). Source-system
extracts are then written FROM this world by pipeline/emit.py, each in its own
source's shape and with realistic defects. The pipeline never reads this module's
objects directly — it ingests the extracts, exactly as it would ingest real ones.

Why generate a world first instead of random rows per table: independent random
values contradict each other (a "done" task on a project that has not started,
a milestone achieved before its prerequisite). Every value here is derived from
the values it depends on, so every KPI computed downstream is consistent.

Seeded `random.Random` only — no time-dependent or global randomness — so the
same seed and as-of date reproduce byte-identical extracts.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from app.bizdays import add_business_days, business_days_between, monday_of
from pipeline import names as N
from pipeline.denylist import is_denied

# The engineering departments. Every project is utility-scale solar; the
# technology is the solar type.
DISCIPLINES = ["Electrical", "Civil", "Structural"]
DISC_CODE = {"Electrical": "E", "Civil": "C", "Structural": "S"}
STAGES = ["30%", "60%", "90%", "IFP", "IFC"]
STAGE_LABEL = {"30%": "30% Design", "60%": "60% Design", "90%": "90% Design",
               "IFP": "Issued for Purchase", "IFC": "Issued for Construction"}
IFP_DISCIPLINES = {"Electrical"}  # equipment-purchase packages: inverters, transformers, switchgear

TECHS = ["Single-axis tracker", "Fixed tilt", "Community solar"]
TECH_DISCIPLINES = {t: ["Electrical", "Civil", "Structural"] for t in TECHS}
TECH_WEIGHTS = [("Single-axis tracker", 0.55), ("Fixed tilt", 0.27), ("Community solar", 0.18)]
TECH_SUFFIX = {"Single-axis tracker": "Solar", "Fixed tilt": "Solar", "Community solar": "Community Solar"}
IFP_PROB = {"Single-axis tracker": 0.6, "Fixed tilt": 0.5, "Community solar": 0.25}

# Business days between consecutive milestones.
GAP = {"30%": (26, 36), "60%": (26, 36), "90%": (22, 30), "IFP": (9, 13), "IFC_90": (18, 25), "IFC_IFP": (10, 15)}

# Base engineering hours per work package for a ~50 MW project.
BASE_HOURS = {
    "Electrical": {"30%": 80, "60%": 110, "90%": 95, "IFP": 40, "IFC": 55},
    "Civil": {"30%": 65, "60%": 90, "90%": 75, "IFC": 40},
    "Structural": {"30%": 50, "60%": 75, "90%": 65, "IFC": 35},
}

HOURS_SCALE = 0.72
ENGINEERS_PER_DISC = {"Electrical": 34, "Civil": 20, "Structural": 18}
# Electrical design (collection system, inverters, interconnection) is the largest share of a solar project.
ELECTRICAL_SCOPE = {"Single-axis tracker": 1.12, "Fixed tilt": 1.08, "Community solar": 0.95}
PM_COUNT = 10

UTC = timezone.utc

# Scenario 1: the Timeline bars a PM drew for the electrical packages.
# (project, stage) -> (senior index, bar start, bar end, utilisation)
# 0 = Priya Raman, 1 = Marcus Ojo, 2 = Elena Ruiz. Planned hours derive from the bar.
S1_BARS = {
    ("s1_granite", "90%"): (0, date(2026, 11, 16), date(2026, 12, 15), 0.8),
    ("s1_harrow", "IFC"): (0, date(2026, 11, 23), date(2027, 1, 5), 0.5),
    ("s1_granite", "IFP"): (0, date(2026, 12, 16), date(2027, 1, 6), 0.6),
    ("s1_kettle", "60%"): (1, date(2026, 11, 9), date(2026, 12, 8), 0.7),
    ("s1_ironleaf", "90%"): (1, date(2026, 11, 30), date(2027, 1, 12), 0.8),
    ("s1_granite", "IFC"): (1, date(2027, 1, 11), date(2027, 1, 26), 0.6),
    ("s1_kettle", "90%"): (2, date(2026, 12, 9), date(2027, 1, 19), 0.8),
    ("s1_ironleaf", "IFP"): (2, date(2027, 1, 13), date(2027, 1, 26), 0.6),
}


def _ts(d: date, rng: random.Random, lo: int = 13, hi: int = 22) -> datetime:
    """A UTC timestamp during US business hours on business date d."""
    return datetime.combine(d, time(rng.randint(lo, hi), rng.choice((0, 5, 15, 20, 30, 40, 45, 50))), tzinfo=UTC)


@dataclass
class World:
    as_of: date
    seed: int
    users: list = field(default_factory=list)
    resources: list = field(default_factory=list)
    clients: list = field(default_factory=list)
    contacts: list = field(default_factory=list)
    portfolios: list = field(default_factory=list)
    members: list = field(default_factory=list)
    projects: list = field(default_factory=list)
    milestones: list = field(default_factory=list)
    work_items: list = field(default_factory=list)
    s3: dict = field(default_factory=dict)
    events: list = field(default_factory=list)
    deliverables: list = field(default_factory=list)
    timeline_projects: list = field(default_factory=list)
    assignments: list = field(default_factory=list)
    timeoff: list = field(default_factory=list)
    meetings: list = field(default_factory=list)
    calendar: list = field(default_factory=list)
    actions: list = field(default_factory=list)
    change_orders: list = field(default_factory=list)
    proposals: list = field(default_factory=list)
    stage_events: list = field(default_factory=list)
    scenario: dict = field(default_factory=dict)


class Generator:
    def __init__(self, seed: int, as_of: date):
        self.rng = random.Random(seed)
        self.w = World(as_of=as_of, seed=seed)
        self.as_of = as_of
        self._used_people: set[str] = set()
        self._used_places: set[str] = set()
        self.load: dict[int, dict[date, float]] = {}

    # ------------------------------------------------------------ helpers
    def person(self) -> tuple[str, str]:
        while True:
            f, l = self.rng.choice(N.FIRST_NAMES), self.rng.choice(N.LAST_NAMES)
            if f"{f} {l}" not in self._used_people and not is_denied(f"{f} {l}"):
                self._used_people.add(f"{f} {l}")
                return f, l

    def place(self) -> str:
        while True:
            p = f"{self.rng.choice(N.PLACE_A)} {self.rng.choice(N.PLACE_B)}"
            if p not in self._used_places and not is_denied(p):
                self._used_places.add(p)
                return p

    def weighted(self, pairs):
        r, acc = self.rng.random(), 0.0
        for v, w in pairs:
            acc += w
            if r <= acc:
                return v
        return pairs[-1][0]

    # ------------------------------------------------------------ people
    def build_people(self):
        w, rng = self.w, self.rng
        uid = 0

        def add_user(first, last, title, dept, role, admin=False):
            nonlocal uid
            uid += 1
            u = {"id": uid, "name": f"{first} {last}", "first": first, "last": last,
                 "email": f"{first}.{last}@{N.INTERNAL_DOMAIN}".lower().replace(" ", ""),
                 "title": title, "department": dept, "role": role, "is_admin": admin, "is_active": True}
            w.users.append(u)
            return u

        add_user("Avery", "Halvorsen", "Director of Operations", "Operations", "ops", admin=True)
        self._used_people.add("Avery Halvorsen")
        add_user("Jordan", "Castell", "Operations Manager", "Operations", "ops", admin=True)
        self._used_people.add("Jordan Castell")
        self.pms = []
        for _ in range(PM_COUNT):
            f, l = self.person()
            self.pms.append(add_user(f, l, "Project Manager", "Project Management", "pm"))

        # Scenario 1 cast: the three senior electrical engineers everyone relies on.
        fixed_sub_seniors = [("Priya", "Raman"), ("Marcus", "Ojo"), ("Elena", "Ruiz")]
        for f, l in fixed_sub_seniors:
            self._used_people.add(f"{f} {l}")

        rid = 0
        self.res_by_disc: dict[str, list] = {d: [] for d in DISCIPLINES}
        for disc in DISCIPLINES:
            n = ENGINEERS_PER_DISC[disc]
            for i in range(n):
                if disc == "Electrical" and 1 <= i <= 3:
                    f, l = fixed_sub_seniors[i - 1]  # the three senior electrical engineers
                    seniority = "senior"
                else:
                    f, l = self.person()
                    seniority = "lead" if i == 0 else self.weighted(
                        [("senior", 0.25), ("mid", 0.45), ("junior", 0.30)])
                title = {"lead": f"{disc} Engineering Lead", "senior": f"Senior {disc} Engineer",
                         "mid": f"{disc} Engineer II", "junior": f"{disc} Engineer I"}[seniority]
                role = "lead" if seniority == "lead" else "engineer"
                u = add_user(f, l, title, f"{disc} Engineering", role)
                rid += 1
                r = {"id": rid, "name": u["name"], "user_id": u["id"], "discipline": disc, "title": title,
                     "seniority": seniority, "is_placeholder": False, "available_from": None, "active": True,
                     "weekly_capacity_hours": 40.0}
                w.resources.append(r)
                self.res_by_disc[disc].append(r)
        # Two former employees: inactive resources that still hold a future booking (DQ case).
        self.inactive = []
        for disc in ("Electrical", "Civil"):
            f, l = self.person()
            u = add_user(f, l, f"{disc} Engineer II", f"{disc} Engineering", "engineer")
            u["is_active"] = False
            rid += 1
            r = {"id": rid, "name": u["name"], "user_id": u["id"], "discipline": disc,
                 "title": f"{disc} Engineer II", "seniority": "mid", "is_placeholder": False,
                 "available_from": None, "active": False, "weekly_capacity_hours": 40.0}
            w.resources.append(r)
            self.inactive.append(r)
        # Placeholders (production supports these: "New Hire", vendors).
        rid += 1
        w.resources.append({"id": rid, "name": "New Hire - Electrical", "user_id": None, "discipline": "Electrical",
                            "title": "Electrical Engineer I", "seniority": "junior", "is_placeholder": True,
                            "available_from": date(2027, 1, 11), "active": True, "weekly_capacity_hours": 40.0})
        rid += 1
        self.contractor = {"id": rid, "name": "Contract Electrical Engineer", "user_id": None, "discipline": "Electrical",
                           "title": "Contract Electrical Engineer", "seniority": "senior", "is_placeholder": True,
                           "available_from": None, "active": False, "weekly_capacity_hours": 40.0}
        w.resources.append(self.contractor)
        self.sub_seniors = [r for r in self.res_by_disc["Electrical"] if r["name"] in
                            {"Priya Raman", "Marcus Ojo", "Elena Ruiz"}]

    # ------------------------------------------------------------ clients and portfolios
    def build_hierarchy(self):
        w, rng = self.w, self.rng
        cid_contact = 0
        for i, name in enumerate(N.CLIENTS, start=1):
            slug = "".join(ch for ch in name.lower().replace("&", "and") if ch.isalnum() or ch == " ").split()
            domain = "-".join(slug[:2]) + ".example"
            w.clients.append({"id": i, "name": name, "email_domain": domain})
            for _ in range(5):
                f, l = self.person()
                cid_contact += 1
                w.contacts.append({"id": cid_contact, "client_id": i, "name": f"{f} {l}",
                                   "email": f"{f[0]}.{l}@{domain}".lower().replace(" ", "")})

        # 54 portfolios: every client gets at least one, the rest weighted.
        counts = {c["id"]: 1 for c in w.clients}
        for _ in range(54 - len(w.clients)):
            counts[rng.choice([c["id"] for c in w.clients for _ in range(rng.choice((1, 2)))])] += 1
        pid = 0
        for c in w.clients:
            for _ in range(counts[c["id"]]):
                pid += 1
                created = date(2025, 1, 6) + timedelta(days=rng.randint(0, 640))
                pm = rng.choice(self.pms)
                job = f"{created.year % 100:02d}{created.month:02d}-{rng.randint(10, 199):03d}"
                place = self.place()
                name = rng.choice([f"{place} Portfolio", f"{place} Program", place])
                w.portfolios.append({"id": pid, "client_id": c["id"], "name": name, "project_number": job,
                                     "pm_user_id": pm["id"], "created": created})
                w.members.append((pid, pm["id"]))
                for other in rng.sample(self.pms, 2):
                    if other["id"] != pm["id"] and rng.random() < 0.35:
                        w.members.append((pid, other["id"]))
        # Each portfolio's client contacts (its meeting roster).
        self.roster: dict[int, list] = {}
        for p in w.portfolios:
            pool = [x for x in w.contacts if x["client_id"] == p["client_id"]]
            self.roster[p["id"]] = rng.sample(pool, 2)

    # ------------------------------------------------------------ projects and milestones
    def _site_name(self, tech: str) -> str:
        self.rng.random()  # keeps the generator's random sequence stable
        return f"{self.place()} {TECH_SUFFIX[tech]}"

    def build_projects(self):
        w, rng = self.w, self.rng
        as_of = self.as_of
        proj_id = 0
        # Distribute 132 projects over portfolios (1-5 each).
        per = {p["id"]: 1 for p in w.portfolios}
        for _ in range(132 - len(per)):
            per[rng.choice([p["id"] for p in w.portfolios])] += 1
        # Scenario projects are created explicitly below; reserve their portfolios.
        forced = self._forced_specs()
        for spec in forced:
            per[spec["portfolio_id"]] = max(0, per[spec["portfolio_id"]] - 1)

        def kickoff_draw() -> date:
            r = rng.random()
            if r < 0.24:
                return date(2025, 4, 1) + timedelta(days=rng.randint(0, 330))
            if r < 0.86:
                return date(2026, 5, 1) + timedelta(days=rng.randint(0, (as_of - date(2026, 5, 1)).days - 5))
            return as_of + timedelta(days=rng.randint(3, 100))

        specs = []
        for p in w.portfolios:
            for _ in range(per[p["id"]]):
                tech = self.weighted(TECH_WEIGHTS)
                specs.append({"portfolio_id": p["id"], "tech": tech, "name": self._site_name(tech),
                              "kickoff": add_business_days(kickoff_draw(), 0),
                              "profile": self.weighted([("healthy", 0.64), ("trending", 0.24), ("troubled", 0.12)]),
                              "has_ifp": rng.random() < IFP_PROB[tech]})
        specs.extend(forced)
        specs.sort(key=lambda s: (s["portfolio_id"], s["kickoff"], s["name"]))

        for s in specs:
            proj_id += 1
            port = next(p for p in w.portfolios if p["id"] == s["portfolio_id"])
            mw = s.get("mw") or self.weighted([(rng.randint(5, 20), 0.35), (rng.randint(20, 150), 0.45),
                                                (rng.randint(150, 400), 0.20)])
            pm_id = port["pm_user_id"] if rng.random() < 0.8 else rng.choice(self.pms)["id"]
            proj = {"id": proj_id, "portfolio_id": port["id"], "client_id": port["client_id"], "name": s["name"],
                    "technology": s["tech"], "size_mw": mw, "state": rng.choice(N.STATES),
                    "location": rng.choice(N.TOWNS), "pm_user_id": pm_id, "kickoff": s["kickoff"],
                    "profile": s["profile"], "has_ifp": s["has_ifp"], "forced": s.get("forced"),
                    "disciplines": list(TECH_DISCIPLINES[s["tech"]]), "hold_date": None}
            w.projects.append(proj)
            self._build_milestones(proj, s.get("milestones"))

        # Five active projects are on client hold.
        actives = [p for p in w.projects if not p["forced"] and p["kickoff"] < as_of - timedelta(days=40)
                   and self._ms(p, "IFC")["planned"] > as_of]
        for p in rng.sample(actives, 5):
            p["hold_date"] = add_business_days(as_of, -rng.randint(10, 45))
        # Two projects arrive from the master without a PM (incomplete master data).
        for p in rng.sample([p for p in w.projects if not p["forced"]], 2):
            p["pm_user_id"] = None
        for p in w.projects:
            self._actualise(p)
            ifc = self._ms(p, "IFC")
            if p["hold_date"]:
                p["lifecycle"] = "on_hold"
            elif ifc["actual"] is not None:
                p["lifecycle"] = "complete"
            elif p["kickoff"] > as_of:
                p["lifecycle"] = "upcoming"
            else:
                p["lifecycle"] = "active"

    def _forced_specs(self) -> list[dict]:
        """The two decision scenarios, with dates fixed relative to the as-of date."""
        w = self.w
        # Pick portfolios belonging to distinct clients.
        by_client = {}
        for p in w.portfolios:
            by_client.setdefault(p["client_id"], p)
        ports = list(by_client.values())
        d = lambda y, m, dd: date(y, m, dd)
        specs = [
            {"forced": "s2_cedar", "portfolio_id": ports[3]["id"], "tech": "Single-axis tracker",
             "name": "Cedar Hollow Solar", "kickoff": d(2026, 5, 26), "profile": "troubled",
             "has_ifp": False, "mw": 120,
             "milestones": {"30%": d(2026, 7, 17), "60%": d(2026, 9, 18), "90%": d(2026, 11, 13), "IFC": d(2026, 12, 18)}},
            {"forced": "s1_granite", "portfolio_id": ports[6]["id"], "tech": "Single-axis tracker",
             "name": "Thornapple Solar", "kickoff": d(2026, 6, 22), "profile": "healthy",
             "has_ifp": True, "mw": 300,
             "milestones": {"30%": d(2026, 8, 7), "60%": d(2026, 10, 16), "90%": d(2026, 12, 18), "IFP": d(2027, 1, 8), "IFC": d(2027, 1, 29)}},
            {"forced": "s1_ironleaf", "portfolio_id": ports[8]["id"], "tech": "Single-axis tracker",
             "name": "Silverleaf Solar", "kickoff": d(2026, 7, 13), "profile": "healthy",
             "has_ifp": True, "mw": 250,
             "milestones": {"30%": d(2026, 8, 28), "60%": d(2026, 10, 30), "90%": d(2027, 1, 15), "IFP": d(2027, 1, 29), "IFC": d(2027, 2, 26)}},
            {"forced": "s1_kettle", "portfolio_id": ports[10]["id"], "tech": "Fixed tilt",
             "name": "Marten Ridge Solar", "kickoff": d(2026, 8, 17), "profile": "healthy",
             "has_ifp": True, "mw": 400,
             "milestones": {"30%": d(2026, 10, 9), "60%": d(2026, 12, 11), "90%": d(2027, 1, 22), "IFP": d(2027, 2, 5), "IFC": d(2027, 3, 5)}},
            {"forced": "s1_harrow", "portfolio_id": ports[12]["id"], "tech": "Single-axis tracker",
             "name": "Bluestem Solar", "kickoff": d(2026, 5, 4), "profile": "healthy",
             "has_ifp": True, "mw": 180,
             "milestones": {"30%": d(2026, 6, 19), "60%": d(2026, 8, 21), "90%": d(2026, 10, 23), "IFP": d(2026, 11, 13), "IFC": d(2027, 1, 8)}},
        ]
        for s in specs:
            self._used_places.add(" ".join(s["name"].split()[:2]))
        return specs

    def _ms(self, proj, stage):
        return next((m for m in proj["_ms"] if m["stage"] == stage), None)

    def _build_milestones(self, proj, fixed=None):
        rng = self.rng
        stages = ["30%", "60%", "90%"] + (["IFP"] if proj["has_ifp"] else []) + ["IFC"]
        proj["_ms"] = []
        cur = proj["kickoff"]
        for seq, st in enumerate(stages, start=1):
            if fixed:
                planned = fixed[st]
            else:
                if st == "IFC":
                    lo, hi = GAP["IFC_IFP"] if proj["has_ifp"] else GAP["IFC_90"]
                else:
                    lo, hi = GAP[st]
                planned = add_business_days(cur, rng.randint(lo, hi))
            m = {"project_id": proj["id"], "stage": st, "seq": seq, "baseline": planned, "planned": planned,
                 "actual": None, "revision_count": 0, "reason": None}
            proj["_ms"].append(m)
            cur = planned

    def _actualise(self, proj):
        """Scope revisions (via change orders) and actual dates, by profile."""
        rng, as_of = self.rng, self.as_of
        ms = proj["_ms"]
        proj["_cos"] = []
        # Scope change: an approved CO pushes later milestones out and is recorded as a revision.
        if not proj["forced"] and proj["kickoff"] < as_of - timedelta(days=50) and rng.random() < 0.28:
            idx = rng.randint(1, len(ms) - 1)
            shift = rng.randint(8, 20)
            co_date = add_business_days(ms[idx - 1]["planned"], -rng.randint(3, 12))
            if co_date < as_of:
                title = rng.choice(N.CO_TITLES)
                for m in ms[idx:]:
                    m["planned"] = add_business_days(m["planned"], shift)
                    m["revision_count"] += 1
                    m["reason"] = f"Approved change order: {title} (+{shift} business days)"
                proj["_cos"].append({"title": title, "request": co_date, "impact": shift, "status": "approved"})
        slip_prev = 0
        for i, m in enumerate(ms):
            if proj["forced"] == "s2_cedar":
                # 30% and 60% achieved late-ish; 90% not achieved (blocked structural); IFC future.
                m["actual"] = {"30%": date(2026, 7, 22), "60%": date(2026, 9, 25)}.get(m["stage"])
                continue
            if proj["forced"]:
                m["actual"] = add_business_days(m["planned"], rng.choice((-1, 0, 0, 1))) if m["planned"] < as_of - timedelta(days=2) else None
                if m["actual"] and m["actual"] > as_of:
                    m["actual"] = None
                continue
            if i > 0 and ms[i - 1]["actual"] is None:
                break
            if proj["hold_date"] and m["planned"] >= proj["hold_date"]:
                break
            if m["planned"] > as_of:
                break
            base = {"healthy": rng.choice((-2, -1, 0, 0, 0, 0, 0, 0, 1, 2)), "trending": rng.randint(-3, 7),
                    "troubled": rng.randint(5, 22)}[proj["profile"]]
            slip = base + int(0.4 * slip_prev)
            actual = add_business_days(m["planned"], slip)
            if i > 0 and ms[i - 1]["actual"] and actual <= ms[i - 1]["actual"]:
                actual = add_business_days(ms[i - 1]["actual"], 5)
            if actual > as_of or (proj["hold_date"] and actual >= proj["hold_date"]):
                break
            m["actual"] = actual
            slip_prev = max(0, slip)
        self.w.milestones.extend(ms)

    # ------------------------------------------------------------ work, deliverables, capacity
    def build_work(self):
        w, rng, as_of = self.w, self.rng, self.as_of
        wid = 0
        items = []
        for proj in w.projects:
            size = min(1.6, max(0.6, (proj["size_mw"] / 50) ** 0.3))
            prev_planned = proj["kickoff"]
            for m in proj["_ms"]:
                for disc in proj["disciplines"]:
                    if m["stage"] == "IFP" and disc not in IFP_DISCIPLINES:
                        continue
                    wid += 1
                    scope = ELECTRICAL_SCOPE[proj["technology"]] if disc == "Electrical" else 1.0
                    hours = BASE_HOURS[disc][m["stage"]] * HOURS_SCALE * size * scope * rng.uniform(0.85, 1.15)
                    planned_start = add_business_days(prev_planned, 1) if m["seq"] > 1 else proj["kickoff"]
                    due = add_business_days(m["planned"], -3)
                    if due <= planned_start:
                        due = add_business_days(planned_start, 5)
                    items.append({"id": wid, "project_id": proj["id"], "discipline": disc, "stage": m["stage"],
                                  "planned_start": planned_start, "due": due,
                                  "planned_hours": round(hours / 5) * 5, "_m": m, "_p": proj})
                prev_planned = m["planned"]
        for it in items:
            self._status(it)
        # A milestone that is late (planned passed, not achieved) must still have
        # at least one discipline outstanding, or the register would show it achieved.
        by_ms: dict[int, list] = {}
        for it in items:
            by_ms.setdefault(id(it["_m"]), []).append(it)
        for group in by_ms.values():
            m = group[0]["_m"]
            if m["actual"] is None and all(i["status"] == "done" for i in group):
                last = max(group, key=lambda i: (i["completed"], i["id"]))
                last.update(status="in_review", completed=None, pct=0.93)
        # Dependencies inside a stage (informational, shown on drilldown).
        key = {(i["project_id"], i["discipline"], i["stage"]): i for i in items}
        for it in items:
            up = {"Structural": "Civil"}.get(it["discipline"])
            dep = key.get((it["project_id"], up, it["stage"])) if up else None
            it["depends_on"] = dep["id"] if dep else None
        self._assign(items)
        for it in items:
            self._events(it)
            self._deliverable(it)
        # The register is the system of record for "achieved": a milestone's actual
        # date is the issue date of its LAST required deliverable. Make the world agree.
        dels_by_ms: dict[tuple, list] = {}
        for d in w.deliverables:
            dels_by_ms.setdefault((d["project_id"], d["stage"]), []).append(d)
        for m in w.milestones:
            group = dels_by_ms.get((m["project_id"], m["stage"]), [])
            if m["actual"] is not None and group and all(d["actual"] for d in group):
                latest = max(group, key=lambda d: (d["actual"], d["work_item_id"]))
                latest["actual"] = m["actual"]
                for d in group:
                    if d["actual"] > m["actual"]:
                        d["actual"] = m["actual"]
        w.work_items = items

    def _status(self, it):
        rng, as_of = self.rng, self.as_of
        p, m = it["_p"], it["_m"]
        prof = p["profile"]
        it.update({"status": "not_started", "actual_start": None, "completed": None, "actual_hours": None,
                   "pct": 0.0, "blocked_reason": None, "blocked_since": None, "expected_unblock": None})
        overrun = {"healthy": rng.gauss(1.0, 0.07), "trending": rng.gauss(1.12, 0.08),
                   "troubled": rng.gauss(1.24, 0.1)}[prof]
        it["priority"] = "High" if m["stage"] in ("90%", "IFP", "IFC") else rng.choice(("Medium", "Medium", "Low"))

        if p["forced"] == "s2_cedar" and m["stage"] == "90%":
            it["actual_start"] = add_business_days(it["planned_start"], 1)
            if it["discipline"] == "Structural":
                it.update(status="blocked", pct=0.55, blocked_reason="Awaiting client geotechnical report (pile load tests)",
                          blocked_since=date(2026, 11, 2), expected_unblock=None, priority="High")
                it["actual_hours"] = round(it["planned_hours"] * 0.55 * 1.1, 1)
            elif it["discipline"] == "Electrical":
                it.update(status="in_review", pct=0.92)
                it["actual_hours"] = round(it["planned_hours"] * 0.92 * 1.05, 1)
            else:
                it.update(status="done", pct=1.0, completed=date(2026, 11, 10))
                it["actual_hours"] = round(it["planned_hours"] * 1.08, 1)
            return
        if p["forced"] == "s2_cedar" and m["stage"] == "IFC":
            if it["discipline"] in ("Electrical", "Civil"):
                it.update(status="in_progress", pct=0.15, actual_start=date(2026, 11, 12))
                it["actual_hours"] = round(it["planned_hours"] * 0.15, 1)
            return

        if m["actual"] is not None:
            completed = add_business_days(m["actual"], -rng.randint(1, 3))
            start = add_business_days(it["planned_start"], rng.randint(0, 2))
            if completed <= start:
                completed = add_business_days(start, 3)
            it.update(status="done", pct=1.0, actual_start=start, completed=completed)
            it["actual_hours"] = None if rng.random() < 0.06 else round(it["planned_hours"] * max(0.7, overrun), 1)
            return
        if p["hold_date"]:
            if it["planned_start"] <= p["hold_date"]:
                elapsed = business_days_between(it["planned_start"], p["hold_date"]) / max(1, business_days_between(it["planned_start"], it["due"]))
                it.update(status="blocked", pct=round(min(0.9, max(0.05, elapsed)), 2),
                          actual_start=it["planned_start"], blocked_reason="Client hold - project paused",
                          blocked_since=p["hold_date"])
                it["actual_hours"] = round(it["planned_hours"] * it["pct"], 1)
            return
        if it["planned_start"] > as_of:
            return
        elapsed = business_days_between(it["planned_start"], as_of) / max(1, business_days_between(it["planned_start"], it["due"]))
        eff = {"healthy": rng.uniform(0.98, 1.12), "trending": rng.uniform(0.72, 0.88),
               "troubled": rng.uniform(0.55, 0.75)}[prof]
        pct = min(0.97, max(0.03, elapsed * eff))
        late_ms = m["planned"] < as_of
        it["actual_start"] = add_business_days(it["planned_start"], rng.randint(0, 3))
        if it["actual_start"] > as_of:
            it["actual_start"] = as_of
        if late_ms and rng.random() < 0.5:
            comp = add_business_days(it["due"], rng.randint(0, 6))
            if comp < as_of:
                it.update(status="done", pct=1.0, completed=comp)
                it["actual_hours"] = round(it["planned_hours"] * max(0.8, overrun), 1)
                return
        p_block = {"healthy": 0.03, "trending": 0.12, "troubled": 0.45 if late_ms else 0.25}[prof]
        if rng.random() < p_block:
            since = add_business_days(as_of, -rng.randint(3, 18))
            if since < it["actual_start"]:
                since = it["actual_start"]
            it.update(status="blocked", pct=round(pct, 2), blocked_reason=rng.choice(N.BLOCKED_REASONS[it["discipline"]]),
                      blocked_since=since,
                      expected_unblock=add_business_days(as_of, rng.randint(3, 15)) if rng.random() < 0.4 else None)
        elif pct >= 0.88:
            it.update(status="in_review", pct=round(pct, 2))
        else:
            it.update(status="in_progress", pct=round(pct, 2))
        it["actual_hours"] = round(it["planned_hours"] * it["pct"] * max(0.8, overrun), 1)

    def _assign(self, items):
        """Assign engineers the way PMs staff the Timeline board: continuity on a
        project where possible, otherwise the least-loaded engineer of the
        discipline; seniors preferred for 90%/IFP/IFC. Builds Timeline bars."""
        w, rng, as_of = self.w, self.rng, self.as_of
        sticky: dict[tuple, dict] = {}
        tp_by_proj = {}
        for proj in w.projects:
            tp = {"id": len(w.timeline_projects) + 1, "name": proj["name"],
                  "client": next(c["name"] for c in w.clients if c["id"] == proj["client_id"]),
                  "status": {"complete": "complete", "on_hold": "on_hold", "upcoming": "planned"}.get(proj["lifecycle"], "in_progress"),
                  "portfolio_project_id": proj["id"]}
            w.timeline_projects.append(tp)
            tp_by_proj[proj["id"]] = tp

        def weeks(a: date, b: date):
            out, wk = [], monday_of(a)
            while wk <= b:
                out.append(wk)
                wk += timedelta(days=7)
            return out

        def window_load(r, a, b):
            # PMs level the board against the PEAK week a new bar would land on, not the average.
            ws = weeks(a, b)
            ld = self.load.setdefault(r["id"], {})
            vals = [ld.get(x, 0.0) for x in ws] or [0.0]
            return 0.7 * max(vals) + 0.3 * sum(vals) / len(vals)

        aid = 0
        inactive_left = list(self.inactive)
        for it in sorted(items, key=lambda i: (i["planned_start"], i["project_id"], i["discipline"], i["stage"])):
            p = it["_p"]
            start = it["actual_start"] or it["planned_start"]
            if it["status"] == "done":
                end = it["completed"]
            elif it["due"] < as_of and it["status"] != "blocked":
                rem = max(2, round((1 - it["pct"]) * business_days_between(it["planned_start"], it["due"])))
                end = add_business_days(as_of, rem)
            elif it["status"] == "blocked" and not p["hold_date"]:
                end = max(it["due"], add_business_days(as_of, 5))
            elif p["hold_date"]:
                end = p["hold_date"]
            else:
                end = it["due"]
            if end < start:
                end = start
            span = max(1, business_days_between(it["planned_start"], it["due"]))
            util = round(min(1.0, max(0.15, it["planned_hours"] / (8.0 * span))), 2)

            cands = [r for r in self.res_by_disc[it["discipline"]] if r["active"]]
            key = (p["id"], it["discipline"])
            res = None
            bar = S1_BARS.get((p["forced"], it["stage"])) if it["discipline"] == "Electrical" else None
            if p["forced"] and p["forced"].startswith("s1") and it["discipline"] == "Electrical":
                # Scenario 1: every one of these electrical packages lands on the same three seniors.
                res = self.sub_seniors[bar[0] if bar else 0]
                if bar:
                    _, start, end, util = bar
                    days = business_days_between(add_business_days(start, -1), end)
                    it["planned_hours"] = round(util * 8 * days / 5) * 5
                    if it["actual_hours"] is not None and it["status"] != "done":
                        it["actual_hours"] = round(it["planned_hours"] * it["pct"], 1)
            elif it["status"] != "done" and start > as_of and rng.random() < 0.025:
                res = None  # unstaffed future demand (production: resource_id NULL)
            elif it["status"] != "done" and start > as_of and inactive_left and it["discipline"] == inactive_left[0]["discipline"]:
                res = inactive_left.pop(0)  # booking left on a person who has since left
            else:
                cur = sticky.get(key)
                if cur and window_load(cur, start, end) + util <= 1.05 and cur not in self.sub_seniors:
                    res = cur
                else:
                    def score(r):
                        s = window_load(r, start, end)
                        if r["seniority"] == "lead":
                            s += 0.45
                        if r in self.sub_seniors:
                            s += 0.35
                        if it["stage"] in ("90%", "IFP", "IFC") and r["seniority"] == "junior":
                            s += 0.2
                        return (round(s, 4), r["id"])
                    res = min(cands, key=score)
            it["assignee"] = res["id"] if res else None
            if res is not None:
                sticky[key] = res
                ld = self.load.setdefault(res["id"], {})
                for wk in weeks(start, end):
                    wd = sum(1 for k in range(5) if start <= wk + timedelta(days=k) <= end)
                    ld[wk] = ld.get(wk, 0.0) + util * wd / 5.0
            aid += 1
            w.assignments.append({"id": aid, "timeline_project_id": tp_by_proj[p["id"]]["id"],
                                  "resource_id": it["assignee"], "discipline": it["discipline"],
                                  "milestone": it["stage"], "start_date": start, "end_date": end,
                                  "utilization": util, "status": None, "origin": "proposal",
                                  "work_item_id": it["id"]})

        # Time off: personal PTO plus company holidays inside the planning horizon.
        tid = 0
        for r in w.resources:
            if r["is_placeholder"]:
                continue
            for _ in range(rng.randint(2, 4)):
                s = add_business_days(date(2025, 6, 2), rng.randint(0, 420))
                e = add_business_days(s, rng.randint(0, 4))
                tid += 1
                w.timeoff.append({"id": tid, "resource_id": r["id"], "start_date": s, "end_date": e, "reason": "PTO"})
            for s, e in ((date(2026, 11, 26), date(2026, 11, 27)), (date(2026, 12, 24), date(2026, 12, 25)),
                         (date(2027, 1, 1), date(2027, 1, 1))):
                tid += 1
                w.timeoff.append({"id": tid, "resource_id": r["id"], "start_date": s, "end_date": e, "reason": "Holiday"})
        # One senior electrical engineer is out the week of 14 Dec — part of why
        # the crunch is worse than any single project's plan suggests.
        tid += 1
        w.timeoff.append({"id": tid, "resource_id": self.sub_seniors[1]["id"], "start_date": date(2026, 12, 14),
                          "end_date": date(2026, 12, 18), "reason": "PTO"})

    def _events(self, it):
        rng = self.rng
        ev = []
        created = add_business_days(it["planned_start"], -rng.randint(5, 15))
        ev.append((_ts(created, rng), "status", None, "Not Started"))
        if it["actual_start"]:
            ev.append((_ts(it["actual_start"], rng), "status", "Not Started", "Working on it"))
            last = "Working on it"
            if it["blocked_since"]:
                ev.append((_ts(it["blocked_since"], rng), "status", last, "Stuck"))
                last = "Stuck"
            if it["status"] in ("in_review", "done"):
                d = it["completed"] and add_business_days(it["completed"], -rng.randint(2, 5)) or add_business_days(self.as_of, -rng.randint(1, 4))
                if d < it["actual_start"]:
                    d = it["actual_start"]
                ev.append((_ts(d, rng), "status", last, "In QC"))
                last = "In QC"
            if it["status"] == "done":
                ev.append((_ts(it["completed"], rng), "status", last, "Done"))
        ev.sort(key=lambda e: e[0])
        it["events"] = ev
        it["updated_at"] = ev[-1][0]

    def _deliverable(self, it):
        rng = self.rng
        p, m = it["_p"], it["_m"]
        planned = add_business_days(m["planned"], -rng.randint(0, 1))
        actual = None
        if it["status"] == "done":
            actual = add_business_days(it["completed"], rng.randint(0, 2))
            if m["actual"] and actual > m["actual"]:
                actual = m["actual"]
            if actual > self.as_of:
                actual = it["completed"]
            status = "issued"
        elif it["status"] == "in_review":
            status = "in_qc"
        elif it["status"] in ("in_progress", "blocked"):
            status = "on_hold" if p["hold_date"] else "in_progress"
        else:
            status = "not_started"
        port = next(x for x in self.w.portfolios if x["id"] == p["portfolio_id"])
        stage_code = {"30%": "30", "60%": "60", "90%": "90", "IFP": "IFP", "IFC": "IFC"}[m["stage"]]
        self.w.deliverables.append({
            "work_item_id": it["id"], "project_id": p["id"], "discipline": it["discipline"], "stage": m["stage"],
            "doc_number": f"{port['project_number']}-{p['id']:03d}-{DISC_CODE[it['discipline']]}-{stage_code}",
            "title": f"{it['discipline']} {STAGE_LABEL[m['stage']]} drawing set - {p['name']}",
            "planned": planned, "actual": actual, "status": status,
            "revision": {"30%": "A", "60%": "B", "90%": "C", "IFP": "0", "IFC": "0"}[m["stage"]],
        })

    # ------------------------------------------------------------ meetings, actions, calendar
    def build_meetings(self):
        w, rng, as_of = self.w, self.rng, self.as_of
        mid = aid = 0
        evid = 0
        internal_users = [u for u in w.users if u["role"] in ("engineer", "lead", "pm") and u["is_active"]]
        projects_by_port: dict[int, list] = {}
        for p in w.projects:
            projects_by_port.setdefault(p["portfolio_id"], []).append(p)
        for port in w.portfolios:
            projs = projects_by_port.get(port["id"], [])
            if not projs:
                continue
            start = min(p["kickoff"] for p in projs)
            last_ifc = max(self._ms(p, "IFC")["planned"] for p in projs)
            end = min(add_business_days(as_of, 10), add_business_days(last_ifc, 10))
            weekday = rng.choice((1, 2, 3))
            d = start + timedelta(days=(weekday - start.weekday()) % 7)
            worst = max(projs, key=lambda p: {"healthy": 0, "trending": 1, "troubled": 2}[p["profile"]])
            pm = next(u for u in w.users if u["id"] == port["pm_user_id"])
            client = next(c for c in w.clients if c["id"] == port["client_id"])
            port_meetings = []
            while d <= end:
                evid += 1
                active = [p for p in projs if p["kickoff"] <= d <= add_business_days(self._ms(p, "IFC")["planned"], 10)]
                site = rng.choice(active) if active else None
                subject = rng.choice([f"{port['name']} - biweekly coordination",
                                      f"{port['name']} weekly sync",
                                      f"Coordination call: {site['name'] if site else port['name']}",
                                      "Engineering coordination"])
                engineers = rng.sample(internal_users, 2)
                attendees = [pm["email"]] + [e["email"] for e in engineers] + [c["email"] for c in self.roster[port["id"]]]
                ev = {"graph_event_id": f"AAMkAD-demo-{evid:06d}", "subject": subject,
                      "start_at": datetime.combine(d, time(15, 0), tzinfo=UTC),
                      "organizer_email": pm["email"], "attendee_emails": attendees, "_port": port["id"]}
                w.calendar.append(ev)
                if d <= as_of and rng.random() < 0.93:
                    mid += 1
                    mt = {"id": mid, "project_id": port["id"], "portfolio_project_id": site["id"] if site and rng.random() < 0.5 else None,
                          "meeting_date": d, "title": subject, "stage": "sent", "graph_event_id": ev["graph_event_id"],
                          "capture_method": "ai_parsed_pm_reviewed", "created_at": _ts(d, rng, 17, 22)}
                    w.meetings.append(mt)
                    port_meetings.append(mt)
                d += timedelta(days=14)
            for mt in port_meetings:
                for _ in range(self.weighted([(1, 0.2), (2, 0.3), (3, 0.3), (4, 0.15), (5, 0.05)])):
                    aid += 1
                    w.actions.append(self._action(aid, mt, port, projs, worst, client, port_meetings))
        # Internal meetings (internal attendees only — production ignores these by design)
        for k in range(30):
            evid += 1
            d = add_business_days(as_of, -rng.randint(0, 60))
            w.calendar.append({"graph_event_id": f"AAMkAD-demo-{evid:06d}", "subject": rng.choice(
                ["Engineering staff meeting", "Ops weekly", "QC review board", "Resourcing check-in"]),
                "start_at": datetime.combine(d, time(14, 0), tzinfo=UTC),
                "organizer_email": w.users[0]["email"],
                "attendee_emails": [u["email"] for u in rng.sample(internal_users, 4)], "_port": None})
        # External events the matcher cannot place (vendor intros, conferences).
        for k in range(12):
            evid += 1
            d = add_business_days(as_of, -rng.randint(0, 40))
            vendor = rng.choice(["tracker-supply", "inverter-works", "cable-supply", "geotek-labs"])
            w.calendar.append({"graph_event_id": f"AAMkAD-demo-{evid:06d}",
                               "subject": rng.choice(["Vendor intro", "Product roadmap briefing", "Lunch & learn"]),
                               "start_at": datetime.combine(d, time(16, 0), tzinfo=UTC),
                               "organizer_email": f"sales@{vendor}.example",
                               "attendee_emails": [f"sales@{vendor}.example", rng.choice(internal_users)["email"]],
                               "_port": None})
        self._scenario2_meeting()

    def _action(self, aid, mt, port, projs, worst, client, port_meetings):
        rng, as_of = self.rng, self.as_of
        def _end(p):
            ifc = self._ms(p, "IFC")
            return add_business_days(ifc["actual"] or ifc["planned"], 10)
        d0 = mt["meeting_date"]
        active = [p for p in projs if p["kickoff"] <= d0 <= _end(p)] \
            or sorted(projs, key=lambda p: min(abs((p["kickoff"] - d0).days), abs((_end(p) - d0).days)))[:1]
        site = rng.choice(active)
        disc = rng.choice(site["disciplines"])
        stage = next((m["stage"] for m in site["_ms"] if m["planned"] >= mt["meeting_date"]), "IFC")
        text = rng.choice(N.ACTION_TEMPLATES).format(disc=disc, stage=stage, site=site["name"])
        kind = self.weighted([("internal_linked", 0.44), ("internal_text", 0.18), ("external", 0.28),
                              ("blank", 0.06), ("unresolved", 0.04)])
        owner, owner_uid, external = None, None, False
        if kind.startswith("internal"):
            team = sorted({i["assignee"] for i in self.w.work_items if i["project_id"] == site["id"] and i["assignee"]})
            pool = [r for r in self.w.resources if r["id"] in team and r["active"] and r["user_id"]] \
                or [r for r in self.res_by_disc[disc] if r["active"]]
            r = rng.choice(pool)
            u = next(x for x in self.w.users if x["id"] == r["user_id"])
            owner = rng.choice([u["name"], u["first"], f"{u['first'][0]}{u['last'][0]}"]) if kind == "internal_text" else u["name"]
            owner_uid = u["id"] if kind == "internal_linked" else None
        elif kind == "external":
            c = rng.choice(self.roster[port["id"]])
            owner, external = f"Client - {c['name']}", True
        elif kind == "blank":
            owner = rng.choice(["", "TBD", None])
        else:
            owner = rng.choice(["J. Smythe", "Ops team?", "Pat (EPC)"])
        due = None if rng.random() < 0.07 else add_business_days(mt["meeting_date"], rng.randint(5, 15))
        prof = site["profile"]
        delay = {"healthy": rng.gauss(-2, 3), "trending": rng.gauss(3, 5), "troubled": rng.gauss(7, 8)}[prof]
        basis = due or add_business_days(mt["meeting_date"], 10)
        close = add_business_days(basis, int(round(delay)))
        if close <= mt["meeting_date"]:
            close = add_business_days(mt["meeting_date"], 1)
        ifc = self._ms(site, "IFC")
        forgotten = rng.random() < 0.02 or kind == "blank" and rng.random() < 0.3
        if ifc["actual"] and (forgotten or close > ifc["actual"]):
            # close-out meeting: residual actions are completed or cancelled at project close
            close = max(add_business_days(ifc["actual"], rng.randint(3, 10)), add_business_days(mt["meeting_date"], 1))
            forgotten = False
        status, closed_in, last_change = "open", None, _ts(mt["meeting_date"], rng)
        if not forgotten and close <= as_of:
            status = "completed" if rng.random() < 0.93 else "cancelled"
            nxt = next((m for m in port_meetings if m["meeting_date"] >= close), None)
            closed_in = nxt["id"] if nxt else None
            last_change = _ts(close, rng)
        elif rng.random() < 0.1:
            status = "pending"
        return {"id": aid, "project_id": port["id"], "portfolio_project_id": site["id"],
                "originating_meeting_id": mt["id"], "closed_in_meeting_id": closed_in, "text": text,
                "owner": owner, "owner_user_id": owner_uid, "owner_is_external": external, "due_date": due,
                "status": status, "last_status_change": last_change, "created_at": mt["created_at"],
                "updated_at": last_change}

    def _scenario2_meeting(self):
        w, rng = self.w, self.rng
        cedar = next(p for p in w.projects if p["forced"] == "s2_cedar")
        port = next(p for p in w.portfolios if p["id"] == cedar["portfolio_id"])
        d = date(2026, 11, 4)
        mt = next((m for m in w.meetings if m["project_id"] == port["id"] and m["meeting_date"] == d), None)
        if mt is None:
            mt = {"id": max(m["id"] for m in w.meetings) + 1, "project_id": port["id"], "portfolio_project_id": cedar["id"],
                  "meeting_date": d, "title": f"Coordination call: {cedar['name']}", "stage": "sent",
                  "graph_event_id": None, "capture_method": "ai_parsed_pm_reviewed", "created_at": _ts(d, rng, 18, 20)}
            w.meetings.append(mt)
        mt["portfolio_project_id"] = cedar["id"]
        client_contact = self.roster[port["id"]][0]
        nid = max(a["id"] for a in w.actions) + 1
        lead = next(r for r in self.res_by_disc["Structural"] if r["seniority"] == "lead")
        rows = [
            ("Provide geotechnical report (pile load test results) for Cedar Hollow", f"Client - {client_contact['name']}",
             None, True, date(2026, 11, 11), "open"),
            ("Confirm structural pile design approach if geotech report is delayed", "", None, False,
             date(2026, 11, 18), "open"),
            ("Issue Electrical and Civil 90% comment responses", lead["name"], lead["user_id"], False,
             date(2026, 11, 9), "completed"),
        ]
        for text, owner, uid, ext, due, status in rows:
            w.actions.append({"id": nid, "project_id": port["id"], "portfolio_project_id": cedar["id"],
                              "originating_meeting_id": mt["id"], "closed_in_meeting_id": None, "text": text,
                              "owner": owner, "owner_user_id": uid, "owner_is_external": ext, "due_date": due,
                              "status": status,
                              "last_status_change": _ts(date(2026, 11, 9) if status == "completed" else d, rng),
                              "created_at": mt["created_at"], "updated_at": mt["created_at"], "scenario": "s2"})
            nid += 1

    # ------------------------------------------------------------ commercial
    def build_commercial(self):
        w, rng, as_of = self.w, self.rng, self.as_of
        coid = 0
        co_seq: dict[int, int] = {}
        for proj in w.projects:
            extra = []
            if proj["kickoff"] < as_of and not proj["forced"] and rng.random() < 0.3:
                req = add_business_days(as_of, -rng.randint(2, 40))
                if req > proj["kickoff"]:
                    extra.append({"title": rng.choice(N.CO_TITLES), "request": req, "impact": None,
                                  "status": self.weighted([("pending", 0.55), ("draft", 0.45)])})
            if proj["kickoff"] < as_of - timedelta(days=90) and rng.random() < 0.25 and not proj["forced"]:
                extra.append({"title": rng.choice(N.CO_TITLES), "request": add_business_days(proj["kickoff"], rng.randint(20, 60)),
                              "impact": 0, "status": "approved"})
            for co in proj["_cos"] + extra:
                if co["request"] > as_of:
                    continue
                coid += 1
                co_seq[proj["portfolio_id"]] = co_seq.get(proj["portfolio_id"], 0) + 1
                submitted = add_business_days(co["request"], rng.randint(1, 4)) if co["status"] != "draft" else None
                approved = None
                if co["status"] == "approved":
                    approved = add_business_days(submitted, rng.randint(3, 22))
                    if approved > as_of:
                        approved = add_business_days(submitted, 2)
                if submitted and submitted > as_of:
                    submitted = as_of
                amount = round(rng.uniform(4000, 85000) / 10) * 10
                w.change_orders.append({
                    "id": coid, "project_id": proj["portfolio_id"], "portfolio_project_id": proj["id"],
                    "co_number": co_seq[proj["portfolio_id"]], "title": co["title"],
                    "rate_type": rng.choice(("fixed", "fixed", "hourly")), "status": co["status"],
                    "request_date": co["request"],
                    "submitted_at": _ts(submitted, rng) if submitted else None,
                    "approved_at": _ts(approved, rng) if approved else None,
                    "total_amount": amount, "schedule_impact_days": co["impact"],
                })
        # Two approved COs whose approval timestamp never made it across (DQ: incomplete dates).
        approved = [c for c in w.change_orders if c["status"] == "approved"]
        for c in rng.sample(approved, 2):
            c["approved_at"] = None
            c["_dq_missing_approved_at"] = True

        # Engineering-services proposals (proposal360 stage vocabulary).
        prid = 0
        won_projects = [p for p in w.projects if p["kickoff"] > date(2025, 8, 1)]
        rng.shuffle(won_projects)
        for k in range(118):
            prid += 1
            created = date(2025, 6, 2) + timedelta(days=rng.randint(0, (as_of - date(2025, 6, 2)).days - 1))
            created = add_business_days(created, 0)
            client = rng.choice(w.clients)
            tech = self.weighted(TECH_WEIGHTS)
            final = self.weighted([("won", 0.34), ("closed", 0.24), ("open", 0.14), ("submitted", 0.1),
                                   ("bid", 0.06), ("draft", 0.12)])
            age = business_days_between(created, as_of)
            if age < 8:
                final = "draft"
            elif (final == "draft" and age > 40) or (final in ("submitted", "open", "bid") and age > 140):
                if prid % 2 == 0:  # a live pipeline: half of these are recent proposals
                    created = add_business_days(as_of, -(8 + (prid * 7) % (25 if final == "draft" else 70)))
                    age = business_days_between(created, as_of)
                else:              # the rest have been decided by now
                    final = "won" if prid % 3 == 0 else "closed"
            owner = rng.choice(self.pms)
            turnaround = max(2, int(rng.gauss(9, 4)))
            if created > date(2026, 8, 1):
                turnaround += rng.randint(0, 6)  # recent backlog: proposals taking longer to go out
            job = f"{created.year % 100:02d}{created.month:02d}-{rng.randint(10, 299):03d}"
            mwdc = float(rng.choice((5, 8, 12, 20, 45, 80, 120, 200, 300)))
            fee = None if rng.random() < 0.04 else round(rng.uniform(25000, 420000) / 10) * 10
            linked = None
            if final == "won" and won_projects:
                cand = won_projects.pop()
                linked = cand["id"]
            p = {"id": prid, "job_number": job, "revision": "R00", "title": f"{self.place()} {TECH_SUFFIX[tech]} - engineering services",
                 "client_id": client["id"], "technology": tech, "mwdc": mwdc, "status": final,
                 "owner_user_id": owner["id"], "fee_total": fee, "created_at": _ts(created, rng),
                 "portfolio_project_id": linked}
            w.proposals.append(p)
            # Stage history as proposal360 logs it (override_log, field='status').
            path = {"draft": [], "submitted": ["submitted"], "open": ["submitted", "open"],
                    "bid": ["submitted", "bid"], "won": ["submitted", "open", "won"],
                    "closed": ["submitted", "open", "closed"]}[final]
            t = created
            prev = "draft"
            gaps = {"submitted": turnaround, "open": rng.randint(2, 10), "bid": rng.randint(5, 20),
                    "won": rng.randint(10, 45), "closed": rng.randint(10, 60)}
            for st in path:
                t = add_business_days(t, gaps[st])
                if t > as_of:
                    p["status"] = prev
                    break
                w.stage_events.append({"proposal_id": prid, "from_status": prev, "to_status": st,
                                       "at": _ts(t, rng), "user_id": owner["id"]})
                prev = st
        # Data defects that proposal360 data really can carry:
        for p in rng.sample([p for p in w.proposals if p["status"] == "won"], 4):
            # moved straight from draft to won: no 'submitted' event, turnaround unknown
            evs = [e for e in w.stage_events if e["proposal_id"] == p["id"]]
            for e in evs:
                w.stage_events.remove(e)
            w.stage_events.append({"proposal_id": p["id"], "from_status": "draft", "to_status": "won",
                                   "at": evs[-1]["at"], "user_id": p["owner_user_id"]})
            p["_dq_skipped_submit"] = True
        for p, bad in zip(rng.sample(w.proposals, 3), ("25-114", "2511-55", "JOB-2510-017")):
            p["job_number"] = bad
            p["_dq_bad_job"] = True

    # Scenario 3: one client decision holding up several of that client's projects.
    S3_REASON = "Waiting on the client to choose one inverter for all their projects (we recommended two options)"

    def client_decision_cluster(self):
        """Deterministic (no random draws, so nothing else in the world moves):
        the client with the most active projects has not chosen the inverter
        for any of them. Each project's current Electrical package waits on it,
        and the client has said the decision comes after an internal review."""
        w, as_of = self.w, self.as_of
        active = [p for p in w.projects if p["lifecycle"] == "active" and not p["forced"] and not p.get("hold_date")]
        by_client: dict[int, list] = {}
        for p in active:
            by_client.setdefault(p["client_id"], []).append(p)
        client_id = max(by_client, key=lambda c: (len(by_client[c]), -c))
        since = add_business_days(as_of, -9)
        resume = add_business_days(as_of, 22)
        picked = []
        for p in sorted(by_client[client_id], key=lambda p: p["id"]):
            cands = [it for it in w.work_items if it["project_id"] == p["id"] and it["discipline"] == "Electrical"
                     and it["status"] in ("in_progress", "not_started") and it["planned_start"] <= add_business_days(as_of, 10)]
            if not cands:
                continue
            it = min(cands, key=lambda i: i["due"])
            if it["status"] == "not_started":
                it["actual_start"] = min(it["planned_start"], since)
            it.update(status="blocked", blocked_reason=self.S3_REASON, blocked_since=max(since, it["actual_start"]),
                      expected_unblock=resume)
            ts = datetime(it["blocked_since"].year, it["blocked_since"].month, it["blocked_since"].day, 15, 0, tzinfo=UTC)
            it["events"] = sorted(it["events"] + [(ts, "status", "Working on it", "Stuck")], key=lambda e: e[0])
            it["updated_at"] = max(it["updated_at"], ts)
            picked.append(p["id"])
            if len(picked) == 5:
                break
        w.s3 = {"client_id": client_id, "projects": picked, "reason": self.S3_REASON}

    def proposal_starts(self):
        """Deterministic: the start date each proposal names for the design work.
        Open proposals start in the coming months; decided ones a few weeks
        after they were created."""
        as_of = self.as_of
        for p in self.w.proposals:
            created = date.fromisoformat(p["created_at"].isoformat()[:10]) if hasattr(p["created_at"], "isoformat") else p["created_at"]
            start = created + timedelta(days=30 + (p["id"] * 11) % 45)
            if p["status"] in ("draft", "submitted", "open", "bid") and start < as_of + timedelta(days=14):
                start = as_of + timedelta(days=14 + (p["id"] * 17) % 110)
            p["expected_start"] = start.isoformat()

    def build(self) -> World:
        self.build_people()
        self.build_hierarchy()
        self.build_projects()
        self.build_work()
        self.build_meetings()
        self.build_commercial()
        self.client_decision_cluster()
        self.proposal_starts()
        self.w.scenario = {
            "s1_projects": [p["id"] for p in self.w.projects if (p["forced"] or "").startswith("s1")],
            "s1_engineers": [r["id"] for r in self.sub_seniors],
            "s2_project": next(p["id"] for p in self.w.projects if p["forced"] == "s2_cedar"),
            "contractor_resource": self.contractor["id"],
            "s3": self.w.s3,
        }
        return self.w


def generate(seed: int, as_of: date) -> World:
    return Generator(seed, as_of).build()
