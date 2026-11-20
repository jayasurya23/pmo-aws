"""Write the synthetic world out as SOURCE-SYSTEM EXTRACTS, each in its own
system's shape, with realistic defects injected.

Every injected defect is recorded in `_manifest.json` (ground truth). The
pipeline never reads the manifest; tests do, to prove each defect class is
detected and counted exactly once.

Extracts written to data/sources/:
  pmo360_master.json             PMO 360: users, clients, portfolios, projects, schedule milestones
  monday_portfolio_board.json    Monday Portfolio board (job numbers) — production sync's input shape
  monday_work_board.json         Monday engineering work board (items, columns, updates)
  id_crosswalk_manual.csv        Manually confirmed external-id links (maintained by ops)
  deliverable_register_2026-11-18.csv / _2026-11-20.csv   Document-control register exports
  timeline_board.json            PMO 360 Timeline capacity board export
  meetings_actions.json          PMO 360 minutes and rolling action items
  graph_calendar_events.json     Outlook calendarView as Microsoft Graph returns it
  proposal360_export.json        Proposals + override_log stage history
  change_orders.json             PMO 360 change orders
"""
from __future__ import annotations

import csv
import json
import os
import random
from datetime import date, datetime, timedelta, timezone

from app.bizdays import add_business_days
from pipeline.world import DISC_CODE, STAGE_LABEL, World

PORTFOLIO_BOARD_ID = "9000000001"   # fake ids, deliberately unlike production's
WORK_BOARD_ID = "9000000002"
PROJECTS_BOARD_PULSE_BASE = 7_000_000_000

# Monday status labels differ team by team — the core of the normalisation problem.
TEAM_LABELS = {
    "Electrical": {"not_started": "Not Started", "in_progress": "Working on it", "blocked": "Stuck",
                   "in_review": "In QC", "done": "Done"},
    "Civil": {"not_started": "Not Started", "in_progress": "In Progress", "blocked": "Waiting on Client",
              "in_review": "Internal Review", "done": "Complete"},
    "Structural": {"not_started": "Not Started", "in_progress": "WIP", "blocked": "Blocked",
                   "in_review": "QC", "done": "Done"},
}
REGISTER_LABELS = {"not_started": ["Not started"], "in_progress": ["WIP", "In Progress"],
                   "in_qc": ["In QC", "QC Review"], "issued": ["Issued", "IFC Issued", "Issued for Construction"],
                   "on_hold": ["Hold", "On Hold"]}


def _iso(d):
    return d.isoformat() if d else None


def _ts_variant(ts: datetime, rng: random.Random) -> str:
    """Monday exports mix UTC 'Z', local offsets and space-separated forms."""
    r = rng.random()
    if r < 0.7:
        return ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    if r < 0.9:
        local = ts.astimezone(timezone(timedelta(hours=-5)))
        return local.strftime("%Y-%m-%dT%H:%M:%S-05:00")
    return ts.strftime("%Y-%m-%d %H:%M:%S+00:00")


def _date_variant(d: date | None, rng: random.Random) -> str:
    if d is None:
        return ""
    r = rng.random()
    if r < 0.6:
        return d.isoformat()
    if r < 0.9:
        return f"{d.month}/{d.day}/{d.year}"
    return d.strftime("%d-%b-%Y")


def write_extracts(w: World, out_dir: str, seed: int) -> dict:
    rng = random.Random(seed * 7 + 1)
    os.makedirs(out_dir, exist_ok=True)
    as_of = w.as_of
    run_ts = datetime(as_of.year, as_of.month, as_of.day, 11, 0, tzinfo=timezone.utc)  # 06:00 ET
    manifest: dict = {"as_of": as_of.isoformat(), "seed": seed, "defects": {}, "counts": {}}
    D = manifest["defects"]
    proj_by_id = {p["id"]: p for p in w.projects}
    port_by_id = {p["id"]: p for p in w.portfolios}

    # ------------------------------------------------------------------ PMO 360 master
    master = {
        "source": "pmo360_master", "extracted_at": run_ts.isoformat(),
        "users": [{k: u[k] for k in ("id", "name", "email", "title", "department", "role", "is_admin", "is_active")}
                  for u in w.users],
        "clients": w.clients,
        "client_contacts": w.contacts,
        "portfolios": [{"id": p["id"], "client_id": p["client_id"], "name": p["name"],
                        "project_number": p["project_number"]} for p in w.portfolios],
        "project_members": [{"project_id": a, "user_id": b} for a, b in w.members],
        "portfolio_projects": [{
            "id": p["id"], "portfolio_id": p["portfolio_id"], "name": p["name"], "location": p["location"],
            "state": p["state"], "size_mw": str(p["size_mw"]), "technology": p["technology"],
            "pm_user_id": p["pm_user_id"], "lifecycle": p["lifecycle"], "kickoff_date": _iso(p["kickoff"]),
            "disciplines": p["disciplines"]} for p in w.projects],
        # Schedule milestones synced from the proposal schedule. Actual dates are NOT
        # here: "achieved" comes from the deliverable register (system of record).
        "milestones": [{"portfolio_project_id": m["project_id"], "stage": m["stage"], "seq": m["seq"],
                        "baseline_date": _iso(m["baseline"]), "planned_date": _iso(m["planned"]),
                        "revision_count": m["revision_count"], "last_revision_reason": m["reason"]}
                       for m in w.milestones],
    }
    # Job numbers missing in PMO 360 for three portfolios (the Monday sync fills them)
    # and one that disagrees with Monday (reported, never overwritten silently).
    blanked = rng.sample([p for p in master["portfolios"]], 4)
    for p in blanked[:3]:
        p["project_number"] = None
    conflict_port = blanked[3]
    true_num = conflict_port["project_number"]
    conflict_port["project_number"] = true_num[:-1] + str((int(true_num[-1]) + 3) % 10)
    D["pmo_missing_job_number"] = [p["id"] for p in blanked[:3]]
    D["pmo_job_number_conflict"] = [conflict_port["id"]]
    D["project_missing_pm"] = [p["id"] for p in w.projects if p["pm_user_id"] is None]
    _dump(out_dir, "pmo360_master.json", master)

    # ------------------------------------------------------------------ Monday portfolio board
    pb_items = []
    for p in w.portfolios:
        client = next(c for c in w.clients if c["id"] == p["client_id"])
        pb_items.append({"id": str(8_000_000_000 + p["id"]), "name": p["name"],
                         "url": f"https://example.monday.com/boards/{PORTFOLIO_BOARD_ID}/pulses/{8_000_000_000 + p['id']}",
                         "number": p["project_number"], "client": client["name"]})
    unnumbered = rng.sample(pb_items, 2)
    for it in unnumbered:
        it["number"] = None
    dup_src = rng.choice([i for i in pb_items if i not in unnumbered])
    pb_items.append({**dup_src, "id": str(int(dup_src["id"]) + 500), "number": dup_src["number"][:-3] + "999",
                     "url": dup_src["url"] + "-dup"})
    orphans = [{"id": str(8_100_000_000 + k), "name": n, "url": f"https://example.monday.com/boards/{PORTFOLIO_BOARD_ID}/pulses/{8_100_000_000 + k}",
                "number": num, "client": rng.choice(w.clients)["name"]}
               for k, (n, num) in enumerate([("Thornbury Flats Portfolio", "2609-211"), ("Mossy Bend Program", None)])]
    pb_items.extend(orphans)
    sub_named = rng.choice(w.projects)
    pb_items.append({"id": str(8_200_000_000), "name": sub_named["name"], "url": f"https://example.monday.com/boards/{PORTFOLIO_BOARD_ID}/pulses/8200000000",
                     "number": "2607-404", "client": rng.choice(w.clients)["name"]})
    D["monday_portfolio_unnumbered"] = [i["name"] for i in unnumbered]
    D["monday_portfolio_ambiguous"] = [dup_src["name"]]
    D["monday_portfolio_orphans"] = [o["name"] for o in orphans]
    D["monday_portfolio_sub_only"] = [sub_named["name"]]
    _dump(out_dir, "monday_portfolio_board.json", _monday_board(
        PORTFOLIO_BOARD_ID, "Portfolio",
        [("text_pid", "Project ID", "text"), ("text_client", "Client Name", "text")],
        [{"id": i["id"], "name": i["name"], "url": i["url"], "updated_at": run_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
          "column_values": [{"id": "text_pid", "text": i["number"], "value": None},
                            {"id": "text_client", "text": None, "display_value": i["client"], "value": None}]}
         for i in pb_items]))

    # ------------------------------------------------------------------ Monday work board
    cols = [
        ("board_relation_proj", "Project", "board_relation"), ("mirror_job", "Job #", "mirror"),
        ("dropdown_disc", "Discipline", "dropdown"), ("status_stage", "Stage", "status"),
        ("person", "Owner", "people"), ("status", "Status", "status"), ("priority", "Priority", "status"),
        ("timeline", "Timeline", "timeline"), ("date_start", "Start Date", "date"),
        ("date_done", "Completed", "date"), ("numbers_plan", "Planned Hrs", "numbers"),
        ("numbers_actual", "Actual Hrs", "numbers"), ("numbers_pct", "% Complete", "numbers"),
        ("long_text_block", "Blocked Reason", "long_text"), ("date_blocked", "Blocked Since", "date"),
        ("date_unblock", "Expected Unblock", "date"), ("dependency", "Depends On", "dependency"),
    ]
    res_by_id = {r["id"]: r for r in w.resources}
    items = []
    for it in w.work_items:
        p = proj_by_id[it["project_id"]]
        port = port_by_id[p["portfolio_id"]]
        label = TEAM_LABELS[it["discipline"]][it["status"]]
        owner = res_by_id[it["assignee"]]["name"] if it["assignee"] else ""
        item_id = str(9_100_000_000 + it["id"])
        items.append({
            "id": item_id, "name": f"{p['name']} - {it['discipline']} {STAGE_LABEL[it['stage']]}",
            "group": {"title": it["discipline"]},
            "updated_at": _ts_variant(it["updated_at"], rng),
            "column_values": [
                {"id": "board_relation_proj", "text": None, "display_value": p["name"],
                 "value": json.dumps({"linkedPulseIds": [{"linkedPulseId": PROJECTS_BOARD_PULSE_BASE + p["id"]}]})},
                {"id": "mirror_job", "text": None, "display_value": port["project_number"], "value": None},
                {"id": "dropdown_disc", "text": it["discipline"], "value": None},
                {"id": "status_stage", "text": STAGE_LABEL[it["stage"]], "value": None},
                {"id": "person", "text": owner, "value": None},
                {"id": "status", "text": label, "value": None},
                {"id": "priority", "text": it["priority"], "value": None},
                {"id": "timeline", "text": f"{it['planned_start']} - {it['due']}",
                 "value": json.dumps({"from": _iso(it["planned_start"]), "to": _iso(it["due"])})},
                {"id": "date_start", "text": _iso(it["actual_start"]) or "", "value": None},
                {"id": "date_done", "text": _iso(it["completed"]) or "", "value": None},
                {"id": "numbers_plan", "text": str(it["planned_hours"]), "value": None},
                {"id": "numbers_actual", "text": "" if it["actual_hours"] is None else str(it["actual_hours"]), "value": None},
                {"id": "numbers_pct", "text": str(round(it["pct"] * 100)), "value": None},
                {"id": "long_text_block", "text": it["blocked_reason"] or "", "value": None},
                {"id": "date_blocked", "text": _iso(it["blocked_since"]) or "", "value": None},
                {"id": "date_unblock", "text": _iso(it["expected_unblock"]) or "", "value": None},
                {"id": "dependency", "text": None,
                 "value": json.dumps({"linkedPulseIds": [{"linkedPulseId": 9_100_000_000 + it["depends_on"]}]}) if it["depends_on"] else None},
            ],
            "updates": [{"created_at": _ts_variant(ts, rng), "body": f"{field} changed from {old or 'blank'} to {new}"}
                        for ts, field, old, new in it["events"]],
            "_wid": it["id"],
        })

    def col(item, cid):
        return next(c for c in item["column_values"] if c["id"] == cid)

    scen_ids = {w.scenario["s2_project"], *w.scenario["s1_projects"]}
    pool = [i for i in items if proj_by_id[w.work_items[i["_wid"] - 1]["project_id"]]["id"] not in scen_ids]

    # (1) Duplicates: the same package re-created in another group, older and stale.
    dups = rng.sample(pool, 18)
    for k, src in enumerate(dups):
        copy = json.loads(json.dumps(src))
        copy["id"] = str(9_500_000_000 + k)
        copy["group"] = {"title": "Imported"}
        copy["updated_at"] = "2026-06-01T12:00:00Z"
        copy["updates"] = copy["updates"][:1]
        items.append(copy)
    D["monday_duplicates"] = [d["id"] for d in dups]
    rest = [i for i in pool if i not in dups]
    # (2) Unmapped status label.
    unk = rng.sample([i for i in rest if col(i, "status")["text"] not in ("Done", "Complete", "Issued")], 6)
    for i in unk:
        col(i, "status")["text"] = "Pending Review?"
    D["monday_unmapped_status"] = [i["id"] for i in unk]
    rest = [i for i in rest if i not in unk]
    # (3) Cosmetic label variants that SHOULD normalise silently (not exceptions).
    cosmetic = rng.sample([i for i in rest if col(i, "status")["text"] == "Done"], 10)
    for i in cosmetic:
        col(i, "status")["text"] = rng.choice(["done ", "DONE", "Done  "])
    D["monday_cosmetic_labels"] = [i["id"] for i in cosmetic]
    # (4) Missing timeline (due date) on open work.
    nodue = rng.sample([i for i in rest if not col(i, "date_done")["text"]], 14)
    for i in nodue:
        col(i, "timeline")["text"] = ""
        col(i, "timeline")["value"] = None
    D["monday_missing_due"] = [i["id"] for i in nodue]
    rest = [i for i in rest if i not in nodue]
    # (5) Start date typed after completion.
    order = rng.sample([i for i in rest if col(i, "date_done")["text"] and col(i, "date_start")["text"]], 5)
    for i in order:
        done = date.fromisoformat(col(i, "date_done")["text"])
        col(i, "date_start")["text"] = (done + timedelta(days=rng.randint(3, 10))).isoformat()
    D["monday_date_order"] = [i["id"] for i in order]
    rest = [i for i in rest if i not in order]
    # (6) Project relation not linked, name typed differently. Two are covered by a
    #     manual crosswalk entry (linked id), two are not and must be rejected.
    variants = rng.sample(rest, 4)
    crosswalk = []
    for k, i in enumerate(variants):
        rel = col(i, "board_relation_proj")
        rel["display_value"] = rel["display_value"] + " (Phase 1)"
        if k < 2:
            pid = json.loads(rel["value"])["linkedPulseIds"][0]["linkedPulseId"]
            crosswalk.append({"source_key": "monday_work_board", "external_key": str(pid),
                              "entity_type": "portfolio_project", "internal_id": pid - PROJECTS_BOARD_PULSE_BASE,
                              "note": "Confirmed by ops: Monday project item renamed with phase suffix"})
        else:
            rel["value"] = None  # relation never linked; only free text remains
    D["monday_name_variant_resolved_manual"] = [i["id"] for i in variants[:2]]
    D["monday_name_variant_rejected"] = [i["id"] for i in variants[2:]]
    # Cosmetic name variants that normalise to an exact match ("+" vs "&").
    amp = [i for i in rest if "+" in col(i, "board_relation_proj")["display_value"] and i not in variants][:6]
    for i in amp:
        rel = col(i, "board_relation_proj")
        rel["display_value"] = rel["display_value"].replace("+", "&")
    D["monday_name_cosmetic"] = [i["id"] for i in amp]
    # (7) Prospects tracked in Monday that do not exist in PMO 360.
    prospects = []
    for k in range(9):
        name = f"{rng.choice(['Thornbury', 'Mossy', 'Gilded', 'Larkfield', 'Stonecrop'])} {rng.choice(['Flats', 'Bend', 'Ridge'])} Solar (prospect)"
        disc = rng.choice(["Electrical", "Civil", "Structural"])
        prospects.append({
            "id": str(9_600_000_000 + k), "name": f"{name} - {disc} 30% Design", "group": {"title": disc},
            "updated_at": run_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "column_values": [
                {"id": "board_relation_proj", "text": None, "display_value": name, "value": None},
                {"id": "mirror_job", "text": None, "display_value": None, "value": None},
                {"id": "dropdown_disc", "text": disc, "value": None},
                {"id": "status_stage", "text": "30% Design", "value": None},
                {"id": "person", "text": "", "value": None}, {"id": "status", "text": "Not Started", "value": None},
                {"id": "priority", "text": "Low", "value": None},
                {"id": "timeline", "text": "", "value": None}, {"id": "date_start", "text": "", "value": None},
                {"id": "date_done", "text": "", "value": None}, {"id": "numbers_plan", "text": "40", "value": None},
                {"id": "numbers_actual", "text": "", "value": None}, {"id": "numbers_pct", "text": "0", "value": None},
                {"id": "long_text_block", "text": "", "value": None}, {"id": "date_blocked", "text": "", "value": None},
                {"id": "date_unblock", "text": "", "value": None}, {"id": "dependency", "text": None, "value": None},
            ], "updates": []})
    items.extend(prospects)
    D["monday_unmatched_prospects"] = [p["id"] for p in prospects]
    D["monday_actual_hours_missing_on_done"] = [str(9_100_000_000 + it["id"]) for it in w.work_items
                                                if it["status"] == "done" and it["actual_hours"] is None]
    for i in items:
        i.pop("_wid", None)
    rng.shuffle(items)
    _dump(out_dir, "monday_work_board.json", _monday_board(WORK_BOARD_ID, "Engineering Work Packages", cols, items))
    _write_csv(out_dir, "id_crosswalk_manual.csv",
               ["source_key", "external_key", "entity_type", "internal_id", "note"], crosswalk)

    # ------------------------------------------------------------------ Deliverable register
    header = ["Register Row", "Job Number", "Project", "Discipline", "Milestone", "Document No.", "Title",
              "Planned Issue", "Actual Issue", "Status", "Rev"]
    wi_by_id = {it["id"]: it for it in w.work_items}
    ms_by_key = {(m["project_id"], m["stage"]): m for m in w.milestones}
    rows = []
    for k, d in enumerate(w.deliverables, start=1):
        p = proj_by_id[d["project_id"]]
        port = port_by_id[p["portfolio_id"]]
        rows.append({"Register Row": f"R{k:05d}", "Job Number": port["project_number"], "Project": p["name"],
                     "Discipline": d["discipline"], "Milestone": STAGE_LABEL[d["stage"]],
                     "Document No.": d["doc_number"], "Title": d["title"],
                     "Planned Issue": _date_variant(d["planned"], rng), "Actual Issue": _date_variant(d["actual"], rng),
                     "Status": rng.choice(REGISTER_LABELS[d["status"]]), "Rev": d["revision"],
                     "_wid": d["work_item_id"], "_pid": p["id"], "_planned": d["planned"]})
    # Engineering says done, doc control has not issued (milestone still open, date passed).
    conflicts = [r for r in rows if wi_by_id[r["_wid"]]["status"] == "done"
                 and ms_by_key[(r["_pid"], wi_by_id[r["_wid"]]["stage"])]["actual"] is None
                 and r["_pid"] not in scen_ids and r["_planned"] < as_of]
    conflicts = rng.sample(conflicts, min(12, len(conflicts)))
    for r in conflicts:
        r["Status"], r["Actual Issue"] = "WIP", ""
    D["register_status_conflict"] = [r["Register Row"] for r in conflicts]
    # Duplicate register rows (re-entered revision).
    rdups = rng.sample([r for r in rows if r not in conflicts and r["_pid"] not in scen_ids], 3)
    for k, r in enumerate(rdups):
        copy = dict(r)
        copy["Register Row"] = f"R9{k:04d}"
        copy["Rev"] = r["Rev"]
        rows.append(copy)
    D["register_duplicates"] = [r["Register Row"] for r in rdups]
    # Rows for projects that are not in PMO 360 (cancelled bids still in the register).
    for k in range(7):
        rows.append({"Register Row": f"R8{k:04d}", "Job Number": f"25{k:02d}-0{k}9", "Project": f"Withdrawn Bid {k + 1} Solar",
                     "Discipline": "Electrical", "Milestone": "30% Design", "Document No.": f"WB-{k}-E-30",
                     "Title": "Electrical 30% Design drawing set", "Planned Issue": "2026-03-02", "Actual Issue": "",
                     "Status": "Not started", "Rev": "A", "_wid": None, "_pid": None, "_planned": None})
    D["register_orphans"] = [f"R8{k:04d}" for k in range(7)]
    for r in rows:
        r.pop("_wid"), r.pop("_pid"), r.pop("_planned")
    rng.shuffle(rows)
    good_name = f"deliverable_register_{(as_of - timedelta(days=2)).isoformat()}.csv"
    _write_csv(out_dir, good_name, header, rows)
    # Two days later, someone renamed a column in the register template. The
    # pipeline must refuse the file (schema drift), not load it with blanks.
    drift_header = [("Issued On" if h == "Actual Issue" else h) for h in header]
    drift_rows = [{("Issued On" if k == "Actual Issue" else k): v for k, v in r.items()} for r in rows]
    _write_csv(out_dir, f"deliverable_register_{as_of.isoformat()}.csv", drift_header, drift_rows)
    D["register_schema_drift_file"] = f"deliverable_register_{as_of.isoformat()}.csv"

    # ------------------------------------------------------------------ Timeline board
    _dump(out_dir, "timeline_board.json", {
        "source": "timeline_capacity", "extracted_at": run_ts.isoformat(),
        "resources": [{**r, "available_from": _iso(r["available_from"])} for r in w.resources],
        "projects": w.timeline_projects,
        "assignments": [{**a, "start_date": _iso(a["start_date"]), "end_date": _iso(a["end_date"])} for a in w.assignments],
        "timeoff": [{**t, "start_date": _iso(t["start_date"]), "end_date": _iso(t["end_date"])} for t in w.timeoff],
    })
    inactive_ids = {r["id"] for r in w.resources if not r["active"] and not r["is_placeholder"]}
    D["timeline_inactive_resource_bookings"] = [a["id"] for a in w.assignments if a["resource_id"] in inactive_ids]

    # ------------------------------------------------------------------ Meetings and actions
    roster_rows = []
    for pid, contacts in sorted(_roster(w).items()):
        for c in contacts:
            roster_rows.append({"project_id": pid, "full_name": c["name"], "email": c["email"]})
    _dump(out_dir, "meetings_actions.json", {
        "source": "meeting_minutes", "extracted_at": run_ts.isoformat(),
        "project_attendees": roster_rows,
        "meetings": [{**{k: v for k, v in m.items() if k != "created_at"}, "meeting_date": _iso(m["meeting_date"]),
                      "created_at": m["created_at"].isoformat()} for m in w.meetings],
        "action_items": [{**{k: v for k, v in a.items() if k not in ("scenario",)},
                          "due_date": _iso(a["due_date"]),
                          "last_status_change": a["last_status_change"].isoformat() if a["last_status_change"] else None,
                          "created_at": a["created_at"].isoformat(), "updated_at": a["updated_at"].isoformat()}
                         for a in w.actions],
    })
    D["actions_unresolvable_owner_text"] = [a["id"] for a in w.actions if a["owner"] in ("J. Smythe", "Ops team?", "Pat (EPC)")]

    # ------------------------------------------------------------------ Graph calendar
    def graph_event(e):
        if rng.random() < 0.3:
            local = e["start_at"].astimezone(timezone(timedelta(hours=-5)))
            start = {"dateTime": local.strftime("%Y-%m-%dT%H:%M:%S.0000000"), "timeZone": "Eastern Standard Time"}
        else:
            start = {"dateTime": e["start_at"].strftime("%Y-%m-%dT%H:%M:%S.0000000"), "timeZone": "UTC"}
        return {"id": e["graph_event_id"], "subject": e["subject"], "start": start,
                "organizer": {"emailAddress": {"address": e["organizer_email"]}},
                "attendees": [{"emailAddress": {"address": a}, "type": "required"} for a in e["attendee_emails"]]}
    _dump(out_dir, "graph_calendar_events.json", {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('demo')/calendarView",
        "value": [graph_event(e) for e in w.calendar]})

    # ------------------------------------------------------------------ proposal360 + change orders
    _dump(out_dir, "proposal360_export.json", {
        "source": "proposal360", "extracted_at": run_ts.isoformat(),
        "proposals": [{**{k: v for k, v in p.items() if not k.startswith("_")}, "created_at": p["created_at"].isoformat()}
                      for p in w.proposals],
        "override_log": [{"proposal_id": e["proposal_id"], "field": "status", "old_value": e["from_status"],
                          "new_value": e["to_status"], "at": e["at"].isoformat(), "user_id": e["user_id"]}
                         for e in w.stage_events],
    })
    D["proposal_bad_job_number"] = [p["id"] for p in w.proposals if p.get("_dq_bad_job")]
    D["proposal_missing_submitted"] = [p["id"] for p in w.proposals if p.get("_dq_skipped_submit")]
    _dump(out_dir, "change_orders.json", {
        "source": "change_orders", "extracted_at": run_ts.isoformat(),
        "change_orders": [{**{k: v for k, v in c.items() if not k.startswith("_")},
                           "request_date": _iso(c["request_date"]),
                           "submitted_at": c["submitted_at"].isoformat() if c["submitted_at"] else None,
                           "approved_at": c["approved_at"].isoformat() if c["approved_at"] else None}
                          for c in w.change_orders]})
    D["co_approved_missing_timestamp"] = [c["id"] for c in w.change_orders if c.get("_dq_missing_approved_at")]

    manifest["counts"] = {"projects": len(w.projects), "work_items_true": len(w.work_items),
                          "work_board_items_emitted": len(items), "register_rows_emitted": len(rows),
                          "deliverables_true": len(w.deliverables), "actions": len(w.actions),
                          "meetings": len(w.meetings), "calendar_events": len(w.calendar)}
    manifest["scenario"] = w.scenario
    _dump(out_dir, "_manifest.json", manifest)
    return manifest


def _roster(w: World) -> dict:
    """Each portfolio's client contacts — the production email index's input."""
    out = {}
    for e in w.calendar:
        if e.get("_port"):
            out.setdefault(e["_port"], {})
            for a in e["attendee_emails"]:
                if not a.endswith("pmo360-demo.example"):
                    c = next((x for x in w.contacts if x["email"] == a), None)
                    if c:
                        out[e["_port"]][c["email"]] = c
    return {k: list(v.values()) for k, v in out.items()}


def _monday_board(board_id, name, columns, items):
    return {"board": {"id": board_id, "name": name,
                      "columns": [{"id": c, "title": t, "type": ty} for c, t, ty in columns]},
            "items": items}


def _dump(out_dir, name, obj):
    with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, default=str, sort_keys=False)


def _write_csv(out_dir, name, header, rows):
    with open(os.path.join(out_dir, name), "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        wr.writeheader()
        for r in rows:
            wr.writerow(r)
