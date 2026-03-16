## 1. Scaffold the TypeScript workspace

Goal: create a boring, predictable TypeScript project in the existing repository layout before any migration logic begins.

- [x] 1.1 Prepare the existing repository for an in-place TypeScript migration
  - Keep using `config/`, `src/`, `webapp/`, and `tests/`
  - Do not create a separate top-level TypeScript workspace
  - Do not invent extra folders yet
- [x] 1.2 Create `package.json`, `tsconfig.json`, and `vitest.config.ts`
  - Target Node.js 24 Active LTS
  - Configure TypeScript and `package.json` for ESM-only output
  - Configure test discovery under `tests/`
- [x] 1.3 Add the runtime dependencies from the design
  - Add `fastify`, `@fastify/static`, `@fastify/view`, `nunjucks`, `dotenv`, `better-sqlite3`, `winston`, and `undici`
  - Add any required type packages listed in the design
- [x] 1.4 Add the development tooling from the design
  - Add `typescript`, `vitest`, `prettier`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, and `@types/node`
- [x] 1.5 Add package scripts
  - `build`
  - `typecheck`
  - `test`
  - `test:watch`
  - `lint`
  - `format`
  - `cli`
  - `web`
- [x] 1.6 Prove the empty scaffold works
  - Run install
  - Run `typecheck`
  - Run `test` even if no real tests exist yet

Acceptance for section 1:

- A new engineer can clone the repo, install dependencies, and run the declared scripts without guessing what commands to use.

## 2. Port shared runtime foundations

Goal: create the shared building blocks that downstream files rely on.

- [x] 2.1 Port `config/settings.py` to `config/settings.ts`
  - Read Python env names and defaults first
  - Expose one typed config object or config loader
  - Preserve Python default behavior
  - Add focused settings tests before moving on
- [x] 2.2 Port `src/logger.py` to `src/logger.ts`
  - Recreate console logging behavior
  - Recreate durable file logging behavior
  - Ensure repeated setup does not duplicate handlers/transports
  - Add focused logger tests before moving on
- [x] 2.3 Create shared error classes in `src/errors.ts`
  - Add TS error classes for auth, rate-limit, not-found, and generic API failures
  - Keep names and boundaries aligned with Python behavior
- [x] 2.4 Write small shared type helpers only where needed
  - Add shared types for config, persisted session data, and common result shapes
  - Do not create a generic utilities file without a second real use

Acceptance for section 2:

- Downstream modules can import stable config, logging, and error primitives without redefining them.

## 3. Port the scraper and CLI pipeline

Goal: migrate the write-path first, in dependency order.

### 3A. Auth and HTTP transport

- [x] 3.1 Port `src/auth.py` to `src/auth.ts`
  - Define the saved session file shape first
  - Port session loading and validation
  - Port login request behavior
  - Port session persistence and invalidation
  - Add tests for valid cache, expired cache, missing credentials, login failure, login success, and invalidate
- [x] 3.2 Port `src/scraper.py` to `src/scraper.ts`
  - Implement the base fetch wrapper first
  - Add timeout and connection-failure classification
  - Add 403 re-auth-and-retry behavior
  - Add 429 retry-after behavior
  - Add request counting
  - Add tests in the same order as implementation
- [x] 3.3 Port `src/api.py` to `src/api.ts`
  - Keep it thin: endpoint paths, parameters, and auth flags only
  - Add tests that assert path/param forwarding and discovery behavior

### 3B. Domain model and persistence

- [x] 3.4 Port `src/models.py` to `src/models.ts`
  - Define TS types for all domain objects
  - Preserve numeric-string fields as strings where Python does
  - Preserve tuple/row ordering where the DB layer depends on it
  - Add model-focused tests
- [x] 3.5 Port `src/transform.py` to `src/transform.ts`
  - Port helper coercions first
  - Port object/tuple builders next
  - Preserve row-skipping behavior for malformed data
  - Add transform-focused tests using existing fixtures
- [x] 3.6 Port `src/database.py` to `src/database.ts`
  - Port schema creation first
  - Port pragmas and connection setup next
  - Port inserts/upserts table by table
  - Port queries after writes are working
  - Add DB tests for schema, upserts, and read helpers

### 3C. Orchestration and CLI

- [x] 3.7 Port `src/sync.py` to `src/sync.ts`
  - Port full sync before gameweek sync
  - Preserve dry-run behavior
  - Preserve partial-failure summaries
  - Preserve request-count propagation
  - Add sync-focused tests before moving on
- [x] 3.8 Port `src/main.py` to `src/main.ts`
  - Recreate argument parsing
  - Recreate mode dispatch
  - Recreate exit-code behavior
  - Ensure DB cleanup happens on all paths
  - Add CLI tests for each mode and exit path

Acceptance for section 3:

- The TS CLI and write-path modules can execute the current supported sync/discovery flows with the same user-visible contracts as Python.

## 4. Port the web dashboard runtime

Goal: migrate the read-path after the SQLite contract is stable.

### 4A. Web read model and image helpers

- [x] 4.1 Port `webapp/db.py` to `webapp/db.ts`
  - Port cache helpers first
  - Port read queries in route-family order: overview, players, teams, search, compare
  - Preserve filtering, sorting, pagination, and compare behavior
  - Add focused tests for each query family
- [x] 4.2 Port `webapp/images.py` to `webapp/images.ts`
  - Port URL fallback logic first
  - Port download logic second
  - Preserve existing-file short-circuit behavior
  - Preserve startup failure tolerance where Python currently tolerates it
  - Add focused image helper tests

### 4B. Web app bootstrap and routes

- [x] 4.3 Port `webapp/app.py` to `webapp/app.ts`
  - Build the Fastify app factory
  - Register templates, filters, globals, and static assets
  - Add startup/lifecycle behavior for image download
  - Add app-factory tests with `fastify.inject()` where appropriate
- [x] 4.4 Port `webapp/routers/api.py` to `webapp/routers/api.ts`
  - Port overview route first
  - Then port players, teams, search, and compare routes
  - Preserve status codes and response shapes
  - Add route tests with mocked DB helpers
- [x] 4.5 Port `webapp/routers/pages.py` to `webapp/routers/pages.ts`
  - Preserve template names
  - Preserve page context values
  - Preserve pagination and filter-state behavior
  - Add page-route tests with mocked DB helpers
- [x] 4.6 Port `webapp/__main__.py` to `webapp/server.ts`
  - Keep this file thin: create app, listen on host/port, handle startup errors
  - Add a small bootstrap test if the entrypoint has logic worth testing

Acceptance for section 4:

- The TS web layer can serve the same dashboard routes with the same response contracts and template context behavior as Python.

## 5. Migrate templates and static integration

Goal: move view assets only after route context is stable.

- [x] 5.1 Translate Jinja templates to Nunjucks one file at a time
  - Keep filenames and inheritance structure as close as practical
  - Recreate custom filters and globals before relying on them in templates
  - Do not redesign the HTML during the migration
- [x] 5.2 Copy and wire static assets
  - Preserve expected static paths
  - Ensure image URLs resolve the same way as Python
- [x] 5.3 Verify CDN-based frontend behavior still works
  - Confirm Tailwind, Alpine.js, and Chart.js are still reachable from migrated pages
  - Treat this as compatibility verification, not a frontend rewrite

Acceptance for section 5:

- The migrated server-rendered pages render successfully with the expected templates, static assets, and CDN integrations.

## 6. Recreate and extend the TypeScript test harness

Goal: make the TS implementation prove itself continuously instead of waiting until the end.

- [x] 6.1 Create the TS test directory structure to mirror the runtime layout
- [x] 6.2 Port tests for config, logger, auth, scraper, and API first
- [x] 6.3 Port tests for models, transform, database, sync, and CLI next
- [x] 6.4 Port tests for web DB helpers, image helpers, app factory, API routes, and page routes last
- [x] 6.5 Add fixture-driven differential checks where TS and Python can be compared directly
  - transformed outputs
  - algorithmic outputs and derived-field calculations
  - SQLite state
  - route response shapes
  - CLI result summaries where practical
  - pipeline structure and partial-failure summaries
- [x] 6.6 Keep test scope focused while building
  - when working on one module, run that module’s TS tests first
  - only widen out to larger suites after focused tests are green

Acceptance for section 6:

- Every migrated module has focused TS tests, and the important fixture-driven behaviors can be compared back to Python.

## 7. Prove readiness and cut over

Goal: cut over only after the TS implementation stands on its own.

- [x] 7.1 Run the full TS test suite
- [x] 7.2 Run typecheck, lint, and format checks
- [x] 7.3 Run the parity checks described in the design
- [x] 7.4 Manually verify the supported CLI flows against the migration requirements
- [x] 7.5 Manually verify the dashboard routes against the migration requirements
- [x] 7.6 Remove or archive the Python implementation only after the TS runtime is fully ready
  - Because the migration is in-place, this means the `.ts` files become the canonical runtime files in the existing tree
  - Do not leave a parallel long-lived Python implementation beside the TS one

- [x] 7.7 Perform one immediate cutover once readiness is proven
  - Do not plan a mixed Python/TypeScript runtime period
  - Do not split the webapp and scraper into separate cutover milestones

Acceptance for section 7:

- The TS implementation can replace Python without relying on Python code at runtime, and the migration proof is based on tests plus parity evidence, not confidence alone.

## Working rules for junior engineers

- Do one module at a time in the existing repository tree.
- Read the Python file and its tests before writing TS.
- Do not add abstraction layers unless the design explicitly calls for them.
- Do not “improve” data representation during the migration.
- Do not implement downstream files before upstream dependencies have passing tests.
- Do not plan gradual runtime coexistence once the implementation reaches parity; the cutover for this change is all-at-once.
- When in doubt, choose behavior parity over elegance.
