"""Test fixtures. Tests run against a SEPARATE database (pmo360_demo_test by
default) that the session fixture rebuilds with the full pipeline, so the
running demo database is never touched by a test run.

Override with TEST_DATABASE_URL.
"""
import os
import tempfile

TEST_DB = os.getenv("TEST_DATABASE_URL",
                    "postgresql+psycopg://pmo_demo:pmo_demo_local@localhost:5432/pmo360_demo_test")
os.environ["DATABASE_URL"] = TEST_DB  # must be set before app modules import config
_SRC = tempfile.mkdtemp(prefix="pmo360_test_sources_")
os.environ["SOURCES_DIR"] = _SRC

import pytest  # noqa: E402

from app.config import DEMO_AS_OF, DEMO_SEED  # noqa: E402


@pytest.fixture(scope="session")
def pipeline_result():
    from pipeline.run import run
    return run(DEMO_SEED, DEMO_AS_OF, reset=True, out_dir=_SRC, quiet=True)


@pytest.fixture(scope="session")
def manifest(pipeline_result):
    return pipeline_result["manifest"]


@pytest.fixture()
def db(pipeline_result):
    from app.db import SessionLocal
    s = SessionLocal()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


@pytest.fixture(scope="session")
def client(pipeline_result):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def sources_dir():
    return _SRC
