# Local (non-Docker) workflow. Requires Python 3.12+, Node 20+, and a local PostgreSQL 16
# with a role/database matching DATABASE_URL (see README "Run without Docker").
PY ?= .venv/bin/python

.PHONY: setup seed api web test test-db build

setup:
	python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
	cd frontend && npm ci

seed:
	cd backend && ../$(PY) -m pipeline.run --reset

api:
	cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

test:
	cd backend && ../$(PY) -m pytest
