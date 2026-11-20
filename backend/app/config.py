"""Demo configuration. Every value has a safe local default; nothing here can
point at a production system.

Differences from PMO 360's backend/config.py, on purpose:
  * No LOCAL_DEV_MODE / SQLite switch: the demo is PostgreSQL-only so the SQL
    shown in the interview is the SQL that runs.
  * No OpenAI, Azure, SharePoint, Monday or Graph settings exist at all. The
    integrations are simulated from local files (see pipeline/), and
    app/netguard.py refuses outbound connections to non-local hosts.
"""
from __future__ import annotations

import os
from datetime import date

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://pmo_demo:pmo_demo_local@localhost:5432/pmo360_demo",
)

# The synthetic world is generated relative to a fixed reporting date so every
# run (and every screenshot in the case study) is reproducible. The API accepts
# an explicit ?as_of= for what-if views; this is only the default.
DEMO_AS_OF = date.fromisoformat(os.getenv("DEMO_AS_OF", "2026-11-20"))
DEMO_SEED = int(os.getenv("DEMO_SEED", "360"))

# Business dates are interpreted in the office's time zone; timestamps are
# stored in UTC. Mirrors PMO 360's DEFAULT_TIMEZONE.
BUSINESS_TZ = os.getenv("BUSINESS_TZ", "America/New_York")

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080"
    ).split(",")
    if o.strip()
]

SOURCES_DIR = os.getenv(
    "SOURCES_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "sources"),
)

DEMO_LABEL = "Synthetic Demonstration Data"
