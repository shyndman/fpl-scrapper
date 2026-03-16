## Why

The current application is implemented in Python across two verified runtime surfaces.

- The scraper/CLI entrypoint in `src/main.py` wires together `config/settings.py`, `src/auth.py`, `src/scraper.py`, `src/api.py`, `src/database.py`, and `src/sync.py` to authenticate to FPL, fetch data from the FPL API, transform it, and write it to SQLite.
- The dashboard entrypoint in `webapp/__main__.py` starts a FastAPI app created by `webapp/app.py`, which serves Jinja2 templates and JSON routes from `webapp/routers/` and reads the same SQLite database through `webapp/db.py`.

The verified Python dependency surface in the repository is also small and explicit: `requirements.txt` contains `requests` and `python-dotenv`, `webapp/requirements.txt` contains `fastapi`, `uvicorn[standard]`, `jinja2`, `aiofiles`, `requests`, and `python-dotenv`, and `requirements-dev.txt` contains `pytest`, `pytest-cov`, `responses`, `black`, `mypy`, and `types-requests`.

The repository now also has broad Python characterization coverage across the scraper, CLI, database, and webapp surfaces, which makes this the right moment to formalize the migration target, library choices, and file-by-file risk areas before implementation starts.

## What Changes

- Define the target TypeScript stack for the code that currently depends on `requests`, `python-dotenv`, FastAPI, Uvicorn, Jinja2, aiofiles, SQLite, and pytest-based characterization tests.
- Specify a migration architecture that preserves the current Python module boundaries and replaces the implementation in-place under the existing `config/`, `src/`, `webapp/`, and `tests/` paths: configuration, auth, HTTP scraping, endpoint wrappers, transforms, SQLite persistence, sync orchestration, web DB reads, image handling, HTML routes, and JSON routes.
- Document file-by-file migration risks and invariants for the verified Python modules in `config/`, `src/`, and `webapp/`.
- Define the parity requirements the TypeScript implementation must satisfy for the current CLI exit behavior, scraper error taxonomy, SQLite behavior, and dashboard response/template behavior.
- Break implementation into ordered tasks that can be executed incrementally while keeping the current Python implementation and tests as the oracle.

## Capabilities

### New Capabilities

- `scraper-cli-runtime`: Defines the required runtime behavior for the migrated scraper, sync pipeline, SQLite persistence, and CLI entrypoints.
- `dashboard-web-runtime`: Defines the required runtime behavior for the migrated dashboard server, HTML routes, JSON API routes, static assets, image handling, and template rendering.
- `migration-verification`: Defines the required verification strategy and parity checks used to prove the TypeScript implementation matches the Python system.

### Modified Capabilities

- None.

## Impact

- Affects the Python modules currently under `config/`, `src/`, and `webapp/`, including the CLI entrypoint in `src/main.py`, the SQLite writer in `src/database.py`, the FastAPI app factory in `webapp/app.py`, and the HTML/JSON routers in `webapp/routers/`. The migration will replace these areas in-place rather than introducing a parallel top-level TypeScript workspace.
- Introduces a TypeScript/Node.js stack selection to replace the currently verified Python dependency surface: `requests`, `python-dotenv`, FastAPI, Uvicorn, Jinja2, aiofiles, and the current pytest-based toolchain.
- Establishes migration constraints for the behavior already present in code: session-file auth handling, request retry/rate-limit semantics, SQLite WAL usage, read-only webapp DB access, startup image-download lifecycle, route/query semantics, and CLI exit codes.
- Creates implementation tasks and specs needed to start the TypeScript migration work.
