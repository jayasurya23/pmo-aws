# PMO 360 — Operations Analytics (case-study rebuild, synthetic data)

[![Deploy demo to GitHub Pages](https://github.com/jayasurya23/pmo-aws/actions/workflows/pages.yml/badge.svg)](https://github.com/jayasurya23/pmo-aws/actions/workflows/pages.yml) **Live demo: https://jayasurya23.github.io/pmo-aws/**

A standalone, locally runnable rebuild of the analytics layer of **PMO 360**, the project-operations platform I built at Castillo Engineering. It uses PMO 360's own stack (**FastAPI · PostgreSQL · React/TypeScript/Tailwind**) and data model, and runs on a **deterministic synthetic dataset**. It was built to answer, live, the case-study question: *"Walk me through a dashboard you built. Who used it, what decision did it change, and what did you have to do to the underlying data to make it work?"*

> **Synthetic Demonstration Data.** No client, project, employee, credential or document from the real system is in this repository. Email domains use the reserved `.example` TLD. A network guard refuses connections to anything but local hosts, and a hashed-denylist test fails the build if a real name appears.

| | |
|---|---|
| **Case study** | [case-study/AWS_PMO360_Dashboard_Case_Study.md](case-study/AWS_PMO360_Dashboard_Case_Study.md) (+ `.docx`) |
| **Interview answers** | [case-study/AWS_PMO360_Interview_Talking_Points.md](case-study/AWS_PMO360_Interview_Talking_Points.md) |
| **5-minute demo script** | [case-study/AWS_PMO360_Demo_Walkthrough.md](case-study/AWS_PMO360_Demo_Walkthrough.md) |
| **Architecture & trade-offs** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **Data pipeline & validation rules** | [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) |
| **KPI catalogue (grain, definition, origin)** | [docs/METRICS.md](docs/METRICS.md) |
| **Repository audit (what is original / adapted / new)** | [docs/REPO_AUDIT.md](docs/REPO_AUDIT.md) |
| **Read-only production queries for real metrics** | [tools/production_metrics.sql](tools/production_metrics.sql) |

## What's inside

* **Six dashboards**: A Executive overview · B Delivery & schedule health · C Resources & capacity · D Meetings & actions · E Portfolio & commercial · F Data quality & integration. Plus a project drilldown, two decision scenarios with apply/reset, a live data-flow page and a provenance page.
* **Every number drills to its records** (searchable, paginated, CSV export). Every KPI carries its definition, grain, source and origin (production / adapted / demo-only).
* **A real pipeline, not hard-coded numbers**: one coherent synthetic world is written out as Monday GraphQL boards, a Graph calendar payload, CSV register exports and PMO 360 / proposal360 tables, with counted defects. The pipeline stages, validates, normalises and loads PostgreSQL, recording every exception and every sync run.
* **85 tests** proving KPI = drilldown = an independent SQL count, defect detection against the generator's manifest, schedule rules, determinism, scenario reversibility, network isolation and confidentiality.

## Hosted version (no server needed)

The same app also builds as a **static snapshot**: `python -m pipeline.export_static` writes every API response the UI uses to JSON (all dashboards and drilldowns for "all" and each discipline, every project page, exceptions with raw payloads, and each scenario before and after its decision), and `VITE_STATIC=1` builds the React app to read those files. Numbers are identical to the live API (tested).

* **GitHub Pages:** `.github/workflows/pages.yml` regenerates the data, runs the test suite, exports the snapshot and deploys on every push to `main`. One-time setup: **Settings → Pages → Source: GitHub Actions** (on a free GitHub plan the repository must be public). Site: `https://jayasurya23.github.io/pmo-aws/`.
* **Locally:** `cd backend && python -m pipeline.export_static`, then `cd frontend && VITE_STATIC=1 npx vite build --base ./ --outDir dist-static` and serve `dist-static/` with any static server.
* **Snapshot limits:** the filter bar offers discipline only (the live app also filters by client, portfolio, PM and date windows), and *Apply* on a scenario switches to the precomputed after-state instead of rewriting the database.

## Quick start (Docker)

```bash
cp .env.example .env
```
```bash
docker compose up --build
```
Open **http://localhost:8080**. The `seed` service runs the pipeline once before the API starts.

## Run without Docker (the path verified while building this)

Requires Python 3.12+, Node 20+, PostgreSQL 16.

```bash
sudo -u postgres psql -c "CREATE ROLE pmo_demo LOGIN PASSWORD 'pmo_demo_local';" -c "CREATE DATABASE pmo360_demo OWNER pmo_demo;" -c "CREATE DATABASE pmo360_demo_test OWNER pmo_demo;"
```
```bash
make setup
```
```bash
make seed
```
```bash
make api
```
In a second terminal:
```bash
make web
```
Open **http://localhost:5173** (Vite proxies `/api` to :8000). API docs: http://localhost:8000/docs.

Tests (they rebuild the separate `pmo360_demo_test` database; the demo database is not touched):
```bash
make test
```

## Repository layout

```
backend/
  app/            FastAPI app, models (PMO 360 table names + demo tables), metrics/, scenarios, netguard
  pipeline/       world.py (generator) · emit.py (source extracts) · monday.py (adapted sync) ·
                  load.py (stage/validate/normalise/load) · rules.py · run.py · denylist.py
  tests/          reconciliation, pipeline quality, rules & safety, API
frontend/src/     pages/ (6 dashboards, project, scenarios, pipeline, about) · components/ · lib/
docs/  case-study/  tools/
```

## Verification performed

| Check | Result |
|---|---|
| Pipeline end to end (seed 360, as of 2026-11-20) | ~13 s; 12,047 records staged, 99.6% loaded, 44 rejected, 285 exceptions; register schema-drift file refused |
| Backend tests (`pytest`) | **85 passed** (also run in CI on every push) |
| Frontend type-check and production build | pass (`tsc`, `vite build`) |
| All pages rendered in Chromium (Playwright) | no console errors; screenshots in `case-study/screenshots/` |
| API response times | 30–260 ms per dashboard endpoint |
| Read-only production SQL | all 14 statements execute against PMO 360's real 34-table schema (built from its models in a scratch database) |
| Existing tests: proposal360 suite | **123 passed** (isolated environment, repository unmodified) |
| Existing tests: PMO 360 | no pytest suite exists; its smoke scripts need its own database and configuration and write files into that repository, so they were not run |
| Docker Compose | file provided; **not run here** (no Docker daemon in the build environment). The native path above is the verified one. |

## Known limitations

* Synthetic data: patterns are realistic but invented; no figure here is a Castillo outcome.
* The milestone projection is a transparent rules-based calculation, **not** a statistical forecast, and it is labelled as such.
* The 13 days of sync history before the reporting date are simulated summary rows (labelled); the runs on the reporting date are real.
* No authentication (one read-only demo identity). The scenario endpoints write to the demo database only.
* The exception table has a status column but no resolution workflow UI.
* The reporting date is fixed to the extract date (2026-11-20) so screenshots are reproducible; the API accepts `?as_of=`.

## Original vs adapted vs new

See the in-app page **Original vs demo** (`/about`) and [docs/REPO_AUDIT.md](docs/REPO_AUDIT.md). In short: the hierarchy, meetings and actions, the overdue/ownership/burndown rules, the lead view, the Timeline capacity formulas, the Monday sync logic and the calendar matching come from production PMO 360. The milestones and projection, the Monday work board, the deliverable register, the staging and validation layer, dashboards B, C (hours), E and F, and the scenarios are **demo-only**.
