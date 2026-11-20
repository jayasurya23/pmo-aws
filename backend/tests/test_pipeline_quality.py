"""Every injected defect class is detected, counted once, and handled as its
rule says (reject / load flagged). Ground truth is the generator's manifest,
which the pipeline never reads."""
from sqlalchemy import text


def n_exc(db, rule):
    return db.execute(text("SELECT COUNT(*) FROM dq_exceptions WHERE rule_code = :r"), {"r": rule}).scalar()


def test_duplicates_detected_and_not_loaded(db, manifest):
    assert n_exc(db, "DUPLICATE_EXTERNAL_RECORD") == len(manifest["defects"]["monday_duplicates"])
    # natural key unique: nothing double-counted
    dup = db.execute(text("""SELECT COUNT(*) FROM (SELECT portfolio_project_id, discipline, stage, COUNT(*)
                                FROM work_items GROUP BY 1, 2, 3 HAVING COUNT(*) > 1) x""")).scalar()
    assert dup == 0


def test_work_items_loaded_count(db, manifest):
    true_n = manifest["counts"]["work_items_true"]
    rejected_real = len(manifest["defects"]["monday_name_variant_rejected"])
    loaded = db.execute(text("SELECT COUNT(*) FROM work_items")).scalar()
    assert loaded == true_n - rejected_real


def test_missing_project_refs_rejected(db, manifest):
    d = manifest["defects"]
    assert n_exc(db, "MISSING_PROJECT_REF") == len(d["monday_unmatched_prospects"]) + len(d["monday_name_variant_rejected"])
    # manual crosswalk rescued the two renamed items
    for ext in d["monday_name_variant_resolved_manual"]:
        assert db.execute(text("SELECT COUNT(*) FROM work_items WHERE external_item_id = :e"), {"e": ext}).scalar() == 1


def test_cosmetic_variants_normalise_silently(db, manifest):
    d = manifest["defects"]
    for ext in d["monday_cosmetic_labels"]:
        st = db.execute(text("SELECT status FROM work_items WHERE external_item_id = :e"), {"e": ext}).scalar()
        assert st == "done"
    for ext in d["monday_name_cosmetic"]:
        assert db.execute(text("SELECT COUNT(*) FROM work_items WHERE external_item_id = :e"), {"e": ext}).scalar() == 1


def test_field_rules(db, manifest):
    d = manifest["defects"]
    assert n_exc(db, "UNMAPPED_STATUS") == len(d["monday_unmapped_status"])
    assert db.execute(text("SELECT COUNT(*) FROM work_items WHERE status = 'unknown'")).scalar() == len(d["monday_unmapped_status"])
    assert n_exc(db, "MISSING_DUE_DATE") == len(d["monday_missing_due"])
    assert n_exc(db, "DATE_ORDER_INVALID") == len(d["monday_date_order"])
    assert n_exc(db, "ACTUAL_HOURS_MISSING") == len(d["monday_actual_hours_missing_on_done"])


def test_unknown_is_not_zero(db):
    """Missing actual hours stay NULL; nothing was coerced to 0."""
    zeros = db.execute(text("SELECT COUNT(*) FROM work_items WHERE status = 'done' AND actual_hours = 0")).scalar()
    nulls = db.execute(text("SELECT COUNT(*) FROM work_items WHERE status = 'done' AND actual_hours IS NULL")).scalar()
    assert zeros == 0 and nulls > 0


def test_register_rules(db, manifest):
    d = manifest["defects"]
    assert n_exc(db, "REGISTER_UNMATCHED_PROJECT") == len(d["register_orphans"])
    assert n_exc(db, "REGISTER_DUPLICATE") == len(d["register_duplicates"])
    assert n_exc(db, "STATUS_CONFLICT") == len(d["register_status_conflict"])
    assert n_exc(db, "DATE_UNPARSEABLE") == 0  # all three accepted formats parsed


def test_schema_drift_refuses_file_and_keeps_last_good(db, manifest):
    runs = db.execute(text("""SELECT extract_file, status, rows_loaded FROM sync_runs
                              WHERE source_key = 'deliverable_register' AND NOT is_simulated_history
                              ORDER BY started_at""")).all()
    assert [r.status for r in runs] == ["success", "failed"]
    assert runs[1].extract_file == d_file(manifest) and runs[1].rows_loaded == 0
    assert n_exc(db, "SCHEMA_DRIFT") == 1
    # the good snapshot is what the core table holds
    assert db.execute(text("SELECT COUNT(*) FROM engineering_deliverables")).scalar() > 1000


def d_file(manifest):
    return manifest["defects"]["register_schema_drift_file"]


def test_freshness_uses_last_successful_extract(client):
    fr = {s["key"]: s for s in client.get("/api/quality").json()["freshness"]}
    reg = fr["deliverable_register"]
    assert reg["last_status"] == "failed" and reg["freshness"] in ("stale", "critical") and reg["age_hours"] >= 48


def test_monday_portfolio_sync_matches_production_rules(db, manifest):
    d = manifest["defects"]
    assert n_exc(db, "MONDAY_UNNUMBERED") == len(d["monday_portfolio_unnumbered"])
    assert n_exc(db, "MONDAY_ORPHAN") == len(d["monday_portfolio_orphans"])
    assert n_exc(db, "MONDAY_SUB_ONLY_MATCH") == len(d["monday_portfolio_sub_only"])
    assert n_exc(db, "MONDAY_AMBIGUOUS_NAME") == 2  # both same-named items reported, neither written
    assert n_exc(db, "JOB_NUMBER_CONFLICT") == len(d["pmo_job_number_conflict"])
    # conflicting number NOT overwritten; blank numbers backfilled
    for pid in d["pmo_job_number_conflict"]:
        num = db.execute(text("SELECT project_number FROM projects WHERE id = :i"), {"i": pid}).scalar()
        assert num is not None
    filled = db.execute(text("SELECT COUNT(*) FROM projects WHERE id = ANY(:ids) AND project_number IS NOT NULL"),
                        {"ids": d["pmo_missing_job_number"]}).scalar()
    assert filled == len(d["pmo_missing_job_number"])


def test_other_sources(db, manifest):
    d = manifest["defects"]
    assert n_exc(db, "INACTIVE_RESOURCE_BOOKING") == len(d["timeline_inactive_resource_bookings"])
    assert n_exc(db, "INVALID_JOB_NUMBER") == len(d["proposal_bad_job_number"])
    assert n_exc(db, "PROPOSAL_MISSING_SUBMITTED") == len(d["proposal_missing_submitted"])
    assert n_exc(db, "CO_APPROVED_NO_TIMESTAMP") == len(d["co_approved_missing_timestamp"])
    assert n_exc(db, "PROJECT_MISSING_PM") == len(d["project_missing_pm"])
    assert n_exc(db, "CALENDAR_UNMATCHED") == 12
    flagged = {r[0] for r in db.execute(text("SELECT entity_id FROM dq_exceptions WHERE rule_code = 'ACTION_OWNER_UNRESOLVED'"))}
    assert set(d["actions_unresolvable_owner_text"]) <= flagged


def test_every_core_row_traces_to_a_staged_record(db):
    """No core work item or deliverable exists without the raw payload it came from."""
    orphan_wi = db.execute(text("""SELECT COUNT(*) FROM work_items w WHERE NOT EXISTS
                                   (SELECT 1 FROM raw_records r WHERE r.core_table = 'work_items' AND r.core_id = w.id)""")).scalar()
    orphan_d = db.execute(text("""SELECT COUNT(*) FROM engineering_deliverables d WHERE NOT EXISTS
                                  (SELECT 1 FROM raw_records r WHERE r.core_table = 'engineering_deliverables' AND r.core_id = d.id)""")).scalar()
    assert orphan_wi == 0 and orphan_d == 0


def test_timestamps_normalised_to_utc(db):
    """Mixed '...Z', '-05:00' and space-separated inputs all land as UTC instants."""
    offsets = db.execute(text("SELECT DISTINCT EXTRACT(TIMEZONE FROM source_updated_at) FROM work_items")).scalars().all()
    assert set(offsets) <= {0}


def test_milestone_actual_is_last_required_deliverable(db):
    bad = db.execute(text("""
        SELECT COUNT(*) FROM milestones m
        WHERE m.actual_date IS NOT NULL AND m.actual_date <> (
            SELECT MAX(d.actual_issue_date) FROM engineering_deliverables d
            WHERE d.portfolio_project_id = m.portfolio_project_id AND d.stage = m.stage)""")).scalar()
    assert bad == 0
