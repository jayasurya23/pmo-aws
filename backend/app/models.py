"""SQLAlchemy models for the PMO 360 operations-analytics demo.

THREE KINDS OF TABLE, labelled in each docstring:

  [PMO 360]   Same table and column names as production PMO 360
              (backend/db/models.py), trimmed to the columns the dashboards
              read. Hierarchy is the production one: Client -> Project (the
              `projects` table IS the Portfolio, a long-ago UI rename) ->
              PortfolioProject (the site-level "Project" tier).
  [ADAPTED]   A production concept reshaped for the demo (noted inline).
  [DEMO]      New for the case study. Not in production.

Conventions carried over from production:
  * Status strings, not booleans, where there are more than two outcomes.
  * Nullable means "unknown", never "zero": actual_hours NULL is not 0 hours,
    a missing due date is not "on time" (proposal360's "blank is unknown").
  * Business dates are DATE; timestamps are UTC (TIMESTAMP WITH TIME ZONE).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON, Boolean, Column, Date, DateTime, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


TZ = DateTime(timezone=True)

DISCIPLINES = ("Electrical", "Civil", "Structural")
STAGES = ("30%", "60%", "90%", "IFP", "IFC")  # IFP is optional per project


# =====================================================================
# People
# =====================================================================
class User(Base):
    """[PMO 360] Staff identity. Production upserts these from Entra ID on first
    sign-in (oid); the demo seeds synthetic people and never authenticates."""
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(200), nullable=False, unique=True)
    name = Column(String(200), nullable=False)
    title = Column(String(200))
    department = Column(String(200))
    role = Column(String(40), nullable=False, default="engineer")  # pm | lead | engineer | ops
    is_admin = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)


class TimelineResource(Base):
    """[PMO 360] A row on the Timeline capacity board: a person (linked to a
    User) or a placeholder ("New Hire", contractor). Grouped by discipline.
    `weekly_capacity_hours` is [DEMO]: production expresses capacity as
    utilisation fractions only; the demo converts to hours at 40 h/week so
    planned-vs-actual hours can sit on the same axis."""
    __tablename__ = "timeline_resources"
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"))
    discipline = Column(String(40), nullable=False)
    title = Column(String(80))
    seniority = Column(String(20))  # [DEMO] junior | mid | senior | lead
    is_placeholder = Column(Boolean, nullable=False, default=False)
    available_from = Column(Date)
    active = Column(Boolean, nullable=False, default=True)
    weekly_capacity_hours = Column(Float, nullable=False, default=40.0)

    user = relationship("User")


# =====================================================================
# Hierarchy
# =====================================================================
class Client(Base):
    """[PMO 360]"""
    __tablename__ = "clients"
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False, unique=True)
    email_domain = Column(String(100))


class Project(Base):
    """[PMO 360] The PORTFOLIO tier (production naming kept on purpose).
    `project_number` is the job number, opaque string, indexed NOT unique —
    one Monday item can legitimately cover two portfolios (production
    migration pn1a2b3c4d5e6)."""
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    name = Column(String(300), nullable=False)
    project_number = Column(String(50), index=True)
    created_at = Column(TZ, default=utcnow)

    client = relationship("Client")


class ProjectMember(Base):
    """[PMO 360] Portfolio staffing. A visibility setting in production, not a
    permission."""
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_members_project_user"),)
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)


class PortfolioProject(Base):
    """[PMO 360 + DEMO columns] The site-level Project tier under a Portfolio.
    Production has id/portfolio_id/name/location/state/size_mw. The demo adds
    technology, PM, lifecycle state and kickoff date so delivery metrics have
    something to group by."""
    __tablename__ = "portfolio_projects"
    id = Column(Integer, primary_key=True)
    portfolio_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String(300), nullable=False)
    location = Column(String(200))
    state = Column(String(50))
    size_mw = Column(String(50))       # free text in production; numeric text here
    technology = Column(String(40))    # [DEMO] PV | PV + BESS | BESS | Substation | PV + Substation
    pm_user_id = Column(Integer, ForeignKey("users.id"), index=True)  # [DEMO]
    lifecycle = Column(String(20), nullable=False, default="active")  # [DEMO] upcoming|active|on_hold|complete
    kickoff_date = Column(Date)        # [DEMO]

    portfolio = relationship("Project")
    pm = relationship("User")


class ProjectDiscipline(Base):
    """[DEMO] Which engineering disciplines are in scope for a project."""
    __tablename__ = "project_disciplines"
    __table_args__ = (UniqueConstraint("portfolio_project_id", "discipline"),)
    id = Column(Integer, primary_key=True)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"), nullable=False)
    discipline = Column(String(40), nullable=False)
    lead_resource_id = Column(Integer, ForeignKey("timeline_resources.id"))


# =====================================================================
# Schedule (DEMO)
# =====================================================================
class Milestone(Base):
    """[DEMO] One engineering milestone per project and stage (30/60/90/IFP/IFC).

    Three dates, never conflated:
      baseline_date — the date first committed (proposal schedule)
      planned_date  — the current commitment after approved revisions
      actual_date   — when it was achieved; NULL = not achieved (not "on time")
    Forecasts are computed at read time from upstream work (metrics/schedule.py)
    and never written back over planned or actual.

    Production analogue: proposal schedule items (`schedule_items.is_milestone`)
    and Timeline assignment `milestone` labels.
    """
    __tablename__ = "milestones"
    __table_args__ = (
        UniqueConstraint("portfolio_project_id", "stage", name="uq_milestone_project_stage"),
        Index("ix_milestones_planned", "planned_date"),
    )
    id = Column(Integer, primary_key=True)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"), nullable=False, index=True)
    stage = Column(String(10), nullable=False)
    seq = Column(Integer, nullable=False)
    baseline_date = Column(Date)
    planned_date = Column(Date)
    actual_date = Column(Date)
    revision_count = Column(Integer, nullable=False, default=0)
    last_revision_reason = Column(Text)

    project = relationship("PortfolioProject")


class WorkItem(Base):
    """[DEMO] Engineering work package, normalised from the Monday work board.
    Grain: one row per (project, discipline, stage) after de-duplication.

    `status` is the NORMALISED status; `source_status_label` keeps what Monday
    said, so every mapping decision can be audited back to the source.
    """
    __tablename__ = "work_items"
    __table_args__ = (
        UniqueConstraint("portfolio_project_id", "discipline", "stage", name="uq_work_item_natural_key"),
        Index("ix_work_items_status", "status"),
        Index("ix_work_items_due", "due_date"),
        Index("ix_work_items_assignee", "assignee_resource_id"),
    )
    id = Column(Integer, primary_key=True)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"), nullable=False, index=True)
    discipline = Column(String(40), nullable=False)
    stage = Column(String(10), nullable=False)
    name = Column(String(300), nullable=False)
    external_item_id = Column(String(40), nullable=False, unique=True)  # Monday item id kept
    assignee_resource_id = Column(Integer, ForeignKey("timeline_resources.id"))
    status = Column(String(20), nullable=False)  # not_started|in_progress|in_review|blocked|done|cancelled|unknown
    source_status_label = Column(String(80))
    priority = Column(String(20))
    planned_start = Column(Date)
    due_date = Column(Date)
    actual_start = Column(Date)
    completed_date = Column(Date)
    planned_hours = Column(Float)
    actual_hours = Column(Float)        # NULL = not reported (unknown), never 0
    percent_complete = Column(Float)
    blocked_reason = Column(Text)
    blocked_since = Column(Date)
    expected_unblock_date = Column(Date)
    depends_on_work_item_id = Column(Integer, ForeignKey("work_items.id"))
    source_updated_at = Column(TZ)      # normalised to UTC

    project = relationship("PortfolioProject")
    assignee = relationship("TimelineResource")


class WorkItemEvent(Base):
    """[DEMO] Status / field history from Monday item updates (UTC)."""
    __tablename__ = "work_item_events"
    id = Column(Integer, primary_key=True)
    work_item_id = Column(Integer, ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False, index=True)
    at = Column(TZ, nullable=False)
    field = Column(String(40), nullable=False)
    old_value = Column(Text)
    new_value = Column(Text)
    source = Column(String(40), nullable=False, default="monday_work_board")
    note = Column(Text)


class EngineeringDeliverable(Base):
    """[ADAPTED] Engineering deliverable register (document control).

    Production PMO 360 has a lighter `deliverables` table (task + delivery
    date per portfolio, reported weekly in minutes). The demo models the
    issued-document register as its own SOURCE so that it can disagree with
    Monday — which real fragmented systems do. The register is the system of
    record for "was it issued"; Monday is the system of record for hours.
    """
    __tablename__ = "engineering_deliverables"
    __table_args__ = (
        UniqueConstraint("portfolio_project_id", "discipline", "stage", name="uq_deliverable_natural_key"),
        Index("ix_deliverables_planned", "planned_issue_date"),
    )
    id = Column(Integer, primary_key=True)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"), nullable=False, index=True)
    discipline = Column(String(40), nullable=False)
    stage = Column(String(10), nullable=False)
    doc_number = Column(String(60), nullable=False)
    title = Column(String(300), nullable=False)
    planned_issue_date = Column(Date)
    actual_issue_date = Column(Date)
    status = Column(String(20), nullable=False)  # not_started|in_progress|in_qc|issued|on_hold|unknown
    source_status_label = Column(String(80))
    revision = Column(String(10))
    register_row_id = Column(String(40), nullable=False)
    source_extracted_at = Column(TZ)


# =====================================================================
# Capacity — production Timeline model
# =====================================================================
class TimelineProject(Base):
    """[PMO 360] A project on the capacity board. `portfolio_project_id` is
    [DEMO]: production timeline projects are free-standing (client is free
    text) and link back only through proposals."""
    __tablename__ = "timeline_projects"
    id = Column(Integer, primary_key=True)
    name = Column(String(300), nullable=False)
    client = Column(String(200))
    status = Column(String(30), nullable=False, default="in_progress")
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"), index=True)


class TimelineAssignment(Base):
    """[PMO 360] A bar on the capacity board: project × discipline × milestone
    slice, assigned to a resource over a date range at a utilisation fraction.
    resource_id NULL = unassigned (production semantics)."""
    __tablename__ = "timeline_assignments"
    __table_args__ = (Index("ix_timeline_assignments_dates", "start_date", "end_date"),)
    id = Column(Integer, primary_key=True)
    timeline_project_id = Column(Integer, ForeignKey("timeline_projects.id"), nullable=False, index=True)
    resource_id = Column(Integer, ForeignKey("timeline_resources.id"), index=True)
    discipline = Column(String(40), nullable=False)
    milestone = Column(String(60))
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    utilization = Column(Float, nullable=False, default=1.0)
    status = Column(String(30))
    origin = Column(String(20), nullable=False, default="manual")  # proposal | manual | scenario
    work_item_id = Column(Integer, ForeignKey("work_items.id"))    # [DEMO] traceability

    project = relationship("TimelineProject")
    resource = relationship("TimelineResource")


class TimelineTimeOff(Base):
    """[PMO 360] Blocked dates that reduce a resource's available capacity."""
    __tablename__ = "timeline_timeoff"
    id = Column(Integer, primary_key=True)
    resource_id = Column(Integer, ForeignKey("timeline_resources.id"), nullable=False, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    reason = Column(String(80))


# =====================================================================
# Meetings and actions — production model
# =====================================================================
class Meeting(Base):
    """[PMO 360] Minutes captured for a portfolio meeting. `graph_event_id` is
    [ADAPTED]: production links Outlook events through calendar_event_links."""
    __tablename__ = "meetings"
    __table_args__ = (Index("ix_meetings_project_date", "project_id", "meeting_date"),)
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"))
    meeting_date = Column(Date, nullable=False)
    title = Column(String(300))
    stage = Column(String(20), nullable=False, default="sent")  # draft | final | sent
    graph_event_id = Column(String(120), index=True)
    created_at = Column(TZ, default=utcnow)


class ActionItem(Base):
    """[PMO 360] Rolling action item. `owner` is free text (initials, names,
    "Client"), `owner_user_id` is the canonical link when known — production
    data has both, which is why ownership is attributed by an explicit rule
    (app/metrics/actions.py, ported from api/dashboard.py)."""
    __tablename__ = "action_items"
    __table_args__ = (
        Index("ix_action_items_status_due", "status", "due_date"),
        Index("ix_action_items_project", "project_id"),
    )
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"), index=True)
    originating_meeting_id = Column(Integer, ForeignKey("meetings.id"), nullable=False, index=True)
    closed_in_meeting_id = Column(Integer, ForeignKey("meetings.id"))
    text = Column(Text, nullable=False)
    owner = Column(String(100))
    owner_user_id = Column(Integer, ForeignKey("users.id"))
    owner_is_external = Column(Boolean, nullable=False, default=False)  # [DEMO] client/vendor owner
    # [DEMO] Ownership as resolved by the pipeline (pipeline/load.py::_resolve_owner).
    # owner_type: internal | external | unassigned | unresolved
    # owner_basis: owner_user_id | full_name | first_name | initials | external | none
    owner_type = Column(String(20), nullable=False, default="unassigned")
    owner_basis = Column(String(20))
    resolved_owner_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    due_date = Column(Date)
    status = Column(String(20), nullable=False, default="open")  # open|pending|completed|cancelled
    last_status_change = Column(TZ)
    created_at = Column(TZ, default=utcnow)
    updated_at = Column(TZ, default=utcnow)


class CalendarEvent(Base):
    """[ADAPTED] Outlook events as Microsoft Graph would return them, after the
    production matching rules (api/calendar.py) assigned a portfolio."""
    __tablename__ = "calendar_events"
    id = Column(Integer, primary_key=True)
    graph_event_id = Column(String(120), nullable=False, unique=True)
    subject = Column(String(300))
    start_at = Column(TZ, nullable=False)
    organizer_email = Column(String(200))
    attendee_emails = Column(JSON)
    matched_project_id = Column(Integer, ForeignKey("projects.id"))
    match_method = Column(String(30))  # link | attendee | subject | internal | unmatched


# =====================================================================
# Commercial
# =====================================================================
class ChangeOrder(Base):
    """[PMO 360] Client change order: draft -> pending -> approved.
    `schedule_impact_days` is [DEMO] (production COs are priced, not dated)."""
    __tablename__ = "change_orders"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), index=True)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"), index=True)
    co_number = Column(Integer, nullable=False)
    title = Column(String(300))
    rate_type = Column(String(10), nullable=False, default="fixed")
    status = Column(String(20), nullable=False, default="draft")
    request_date = Column(Date)
    submitted_at = Column(TZ)
    approved_at = Column(TZ)
    total_amount = Column(Float)
    schedule_impact_days = Column(Integer)
    created_at = Column(TZ, default=utcnow)


class Proposal(Base):
    """[ADAPTED] Engineering-services proposal to a client (NOT a supplier
    purchase order). Stage vocabulary is proposal360's (D29):
    draft, submitted, open, closed, bid, won."""
    __tablename__ = "proposals"
    id = Column(Integer, primary_key=True)
    job_number = Column(String(20))       # validated by shape ^\d{3,4}-\d{3}$, never parsed
    revision = Column(String(5), nullable=False, default="R00")
    title = Column(String(300), nullable=False)
    client_id = Column(Integer, ForeignKey("clients.id"), index=True)
    technology = Column(String(40))
    mwdc = Column(Float)
    status = Column(String(20), nullable=False)
    owner_user_id = Column(Integer, ForeignKey("users.id"))
    fee_total = Column(Float)             # NULL = a package priced as unknown
    created_at = Column(TZ, nullable=False)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"))


class ProposalStageEvent(Base):
    """[ADAPTED] proposal360's append-only override_log rows for field='status'
    — the only place stage transition times exist."""
    __tablename__ = "proposal_stage_events"
    id = Column(Integer, primary_key=True)
    proposal_id = Column(Integer, ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status = Column(String(20))
    to_status = Column(String(20), nullable=False)
    at = Column(TZ, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"))


# =====================================================================
# Integration, validation and audit (DEMO)
# =====================================================================
class SourceSystem(Base):
    """[DEMO] Registry of upstream sources and what each is the system of record for."""
    __tablename__ = "source_systems"
    key = Column(String(40), primary_key=True)
    name = Column(String(120), nullable=False)
    kind = Column(String(40), nullable=False)
    system_of_record_for = Column(Text)
    production_equivalent = Column(Text)
    refresh_cadence = Column(String(60))
    freshness_sla_hours = Column(Integer, nullable=False)


class SyncRun(Base):
    """[DEMO] One extraction/load attempt for one source."""
    __tablename__ = "sync_runs"
    __table_args__ = (Index("ix_sync_runs_source_started", "source_key", "started_at"),)
    id = Column(Integer, primary_key=True)
    source_key = Column(String(40), ForeignKey("source_systems.key"), nullable=False)
    started_at = Column(TZ, nullable=False)
    finished_at = Column(TZ)
    extracted_at = Column(TZ)        # source-side "as of" of the extract
    status = Column(String(20), nullable=False)  # success | partial | failed
    rows_extracted = Column(Integer, nullable=False, default=0)
    rows_loaded = Column(Integer, nullable=False, default=0)
    rows_rejected = Column(Integer, nullable=False, default=0)
    rows_flagged = Column(Integer, nullable=False, default=0)
    message = Column(Text)
    is_simulated_history = Column(Boolean, nullable=False, default=False)
    extract_file = Column(String(200))


class RawRecord(Base):
    """[DEMO] Staging: every source record exactly as received (JSONB), with a
    content hash and its load outcome. Nothing reaches a core table without a
    row here, so any dashboard number can be traced back to source payloads."""
    __tablename__ = "raw_records"
    __table_args__ = (Index("ix_raw_records_source_ext", "source_key", "external_id"),)
    id = Column(Integer, primary_key=True)
    sync_run_id = Column(Integer, ForeignKey("sync_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    source_key = Column(String(40), nullable=False)
    entity_type = Column(String(40), nullable=False)
    external_id = Column(String(80))
    payload = Column(JSONB, nullable=False)
    record_hash = Column(String(64), nullable=False)
    load_status = Column(String(20), nullable=False, default="pending")  # loaded|rejected|duplicate|flagged|pending
    core_table = Column(String(60))
    core_id = Column(Integer)


class IdMap(Base):
    """[DEMO] External-id crosswalk. match_method: exact (normalised name, the
    production rule), manual (a person confirmed it), unmatched."""
    __tablename__ = "id_map"
    __table_args__ = (UniqueConstraint("source_key", "external_key", "entity_type"),)
    id = Column(Integer, primary_key=True)
    source_key = Column(String(40), nullable=False)
    external_key = Column(String(300), nullable=False)
    entity_type = Column(String(40), nullable=False)
    internal_id = Column(Integer)
    match_method = Column(String(20), nullable=False)
    note = Column(Text)


class StatusMap(Base):
    """[DEMO] Source label -> common status. Configuration, not code: a new
    label in Monday becomes an exception until someone maps it here."""
    __tablename__ = "status_map"
    __table_args__ = (UniqueConstraint("source_key", "label_key"),)
    id = Column(Integer, primary_key=True)
    source_key = Column(String(40), nullable=False)
    label_key = Column(String(80), nullable=False)   # lower-cased, trimmed, spaces collapsed
    example_label = Column(String(80))
    normalized_status = Column(String(20), nullable=False)


class DqRule(Base):
    """[DEMO] Validation rule catalogue."""
    __tablename__ = "dq_rules"
    code = Column(String(40), primary_key=True)
    name = Column(String(120), nullable=False)
    severity = Column(String(10), nullable=False)  # error | warning | info
    entity_type = Column(String(40), nullable=False)
    action = Column(String(20), nullable=False)    # reject | load_flagged | normalise
    description = Column(Text, nullable=False)
    why_it_matters = Column(Text, nullable=False)


class DqException(Base):
    """[DEMO] One detected data-quality problem on one record."""
    __tablename__ = "dq_exceptions"
    __table_args__ = (Index("ix_dq_exceptions_rule_status", "rule_code", "status"),)
    id = Column(Integer, primary_key=True)
    sync_run_id = Column(Integer, ForeignKey("sync_runs.id", ondelete="CASCADE"), index=True)
    rule_code = Column(String(40), ForeignKey("dq_rules.code"), nullable=False)
    source_key = Column(String(40), nullable=False)
    external_id = Column(String(80))
    raw_record_id = Column(Integer, ForeignKey("raw_records.id", ondelete="SET NULL"))
    entity_type = Column(String(40))
    entity_id = Column(Integer)
    portfolio_project_id = Column(Integer, ForeignKey("portfolio_projects.id"))
    severity = Column(String(10), nullable=False)
    detail = Column(Text, nullable=False)
    detected_at = Column(TZ, nullable=False, default=utcnow)
    status = Column(String(20), nullable=False, default="open")  # open | resolved | accepted


class KpiSnapshot(Base):
    """[DEMO] Headline KPI values written at the end of each pipeline run, so
    "what did the dashboard say on date X" has an answer."""
    __tablename__ = "kpi_snapshots"
    id = Column(Integer, primary_key=True)
    taken_at = Column(TZ, nullable=False, default=utcnow)
    as_of = Column(Date, nullable=False)
    metric_key = Column(String(60), nullable=False)
    value = Column(Float)


class ScenarioLog(Base):
    """[DEMO] Audit trail of scenario apply/reset actions in the live demo."""
    __tablename__ = "scenario_log"
    id = Column(Integer, primary_key=True)
    scenario_key = Column(String(40), nullable=False)
    action = Column(String(10), nullable=False)
    at = Column(TZ, nullable=False, default=utcnow)
    changes = Column(JSONB)
