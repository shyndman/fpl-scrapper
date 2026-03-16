## Context

The current application is a Python system with two closely related runtime surfaces:

1. a scraper/CLI pipeline that authenticates to FPL, fetches API data, transforms it, and persists it to SQLite; and
2. a server-rendered FastAPI dashboard that reads the same SQLite database and exposes both HTML pages and JSON endpoints.

Most of the important behavior is already custom code, not framework magic: retry and backoff policy, session persistence, SQLite schema and upserts, raw-to-model transforms, TTL caching, image fallback logic, and sync orchestration all live in the repository. That is good for migration fidelity, because the TypeScript port can preserve those semantics instead of translating them through a new abstraction layer.

The migration also starts from a stronger baseline than the original Python code did: the repository now has broad characterization coverage for `src/`, `config/`, and `webapp/`, including CLI behavior, auth/session handling, route shaping, DB helper behavior, and scraper error taxonomy. Those tests are the short-term oracle during the port.

Constraint-wise, this migration should preserve behavior rather than redesign the application. The SQLite schema remains the source of truth. The server-rendered dashboard remains server-rendered. The CDN-loaded frontend libraries already used by the templates (Tailwind, Alpine.js, Chart.js) are not part of this migration.

## Goals / Non-Goals

**Goals:**

- Port the application to TypeScript while preserving the current Python behavior closely enough that the existing characterization suite remains meaningful.
- Choose a concrete, current TypeScript/Node stack, including package versions, before implementation begins.
- Keep the current design decisions that matter for fidelity: raw SQL, server-rendered templates, explicit auth/session handling, and custom retry/rate-limit policy.
- Identify the migration risks file by file so implementation can sequence the hard parts intentionally instead of discovering them opportunistically.
- Define a verification strategy that treats Python as the oracle until the TypeScript implementation proves parity.

**Non-Goals:**

- Redesign the product, data model, or route structure during the migration.
- Replace the dashboard with a SPA, API-first backend, or client-rendered frontend.
- Introduce an ORM, repository layer, or generalized SDK abstraction over the existing handwritten SQL and endpoint wrappers.
- Expand FPL feature scope, add new API surfaces, or change CLI UX during the migration.
- Replace CDN frontend libraries unless later work shows they block the migration.

## Decisions

### 1. Runtime target: Node.js + TypeScript, preserving the current architecture

The TypeScript application SHALL remain a two-surface system:

- a scraper/CLI pipeline that writes SQLite; and
- a server-rendered web dashboard that reads SQLite.

This is a translation, not a re-platforming.

**Why:**

- The Python application already has clear seams that map naturally into TypeScript modules.
- Preserving the architecture minimizes semantic drift during the port.
- The new test suite validates behavior, not a hypothetical redesign.

**Alternatives considered:**

- **Frontend/backend redesign during migration:** rejected because it mixes product change with language migration and destroys the oracle.
- **Single unified framework abstraction over both CLI and webapp:** rejected because the current codebase does not need it and it would invent a new design mid-migration.

### 2. Chosen TypeScript stack and versions

Package ranges below are based on the current npm `latest` tags as of 2026-03-15. They are intentionally written as compatible ranges instead of exact pins so the project can absorb minor updates.

| Concern                   | Choice                                                          | Version range | Why this choice                                                                                                                                                                                    | Rejected alternatives                                                                           |
| ------------------------- | --------------------------------------------------------------- | ------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Language/compiler         | `typescript`                                                    |      `^5.9.3` | Native type system replaces most mypy-era concerns and gives the migration its strongest static guardrail.                                                                                         | None                                                                                            |
| HTTP client               | Node built-in `fetch`                                           |  Node runtime | The current app only needs request/response handling, headers, timeouts, status classification, and manual cookie/session persistence. Built-in fetch keeps transport boring and dependency-light. | `axios`, `got` — unnecessary abstraction for a custom retry/auth layer                          |
| Env loading               | `dotenv`                                                        |     `^17.3.1` | Direct replacement for `python-dotenv`; proven and simple.                                                                                                                                         | Custom parser — unnecessary                                                                     |
| SQLite driver             | `better-sqlite3`                                                |     `^12.8.0` | Best fit for the existing raw-SQL, single-process, SQLite-centric design. Straightforward prepared statements and transactions without ORM indirection.                                            | Prisma, Drizzle, TypeORM — redesign risk; `sqlite3` — poorer fit for the current call style     |
| SQLite TypeScript types   | `@types/better-sqlite3`                                         |     `^7.6.13` | The published `better-sqlite3` package does not expose its own TypeScript declarations; this fills that gap and keeps prepared statements and row access typed.                                    | Local ambient declarations — unnecessary maintenance burden                                     |
| Web framework             | `fastify`                                                       |      `^5.8.2` | Good TypeScript ergonomics, lifecycle hooks, static/view plugins, and built-in in-process testing. Closer to the current needs than a heavier framework.                                           | Express — weaker typing and more manual glue; Nest — overbuilt; Hono — adds runtime/style drift |
| Static files              | `@fastify/static`                                               |      `^9.0.0` | Direct, standard Fastify solution for `/static` behavior.                                                                                                                                          | Custom file serving — needless work                                                             |
| Server-side views         | `@fastify/view`                                                 |     `^11.1.1` | Standard Fastify view integration and lets the app keep server-rendered templates.                                                                                                                 | Custom rendering integration                                                                    |
| Template engine           | `nunjucks`                                                      |      `^3.2.4` | Jinja-inspired syntax keeps template migration cost low and preserves existing filter/global patterns.                                                                                             | EJS, Eta, Handlebars — require more template rewriting                                          |
| Template TypeScript types | `@types/nunjucks`                                               |      `^3.2.6` | The published `nunjucks` package does not ship first-party TypeScript declarations; the DefinitelyTyped package is needed to type template environment configuration, filters, and globals.        | Local ambient declarations — unnecessary maintenance burden                                     |
| App logging core          | `winston`                                                       |     `^3.19.0` | Closer feature match to Python logging than Fastify’s default logger, and supports console plus durable file output without tying the migration to framework-native request logging.               | `pino` — excellent request logger, but weaker fit for the current non-request logging needs     |
| Test runner               | `vitest`                                                        |      `^4.1.0` | Fast TS-native tests, good mocking ergonomics, and easy migration from pytest-style characterization tests.                                                                                        | Jest — heavier; `node:test` — less ergonomic for the planned suite                              |
| HTTP mocking in tests     | `undici` (`MockAgent`)                                          |     `^7.24.3` | `MockAgent` lives in the published `undici` package, not in the Node global fetch API. This keeps fetch-based tests fully offline and aligned with the transport under the hood.                   | `nock`, `msw` — workable but less direct here                                                   |
| Formatting                | `prettier`                                                      |      `^3.8.1` | Standard formatter replacement for Black.                                                                                                                                                          | None                                                                                            |
| Linting                   | `eslint`                                                        |     `^10.0.3` | Standard JS/TS linting baseline.                                                                                                                                                                   | None                                                                                            |
| TS lint rules             | `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` |     `^8.57.0` | Required to lint TypeScript meaningfully with ESLint.                                                                                                                                              | None                                                                                            |
| Node.js TypeScript types  | `@types/node`                                                   |     `^25.5.0` | The migration targets Node.js 24 Active LTS, and the current `@types/node` package line supports the modern Node APIs used here.                                                                   | Omitting Node typings — breaks type-safe use of Node APIs                                       |

**Important implementation note:**

- Cookie/session behavior SHALL remain custom application logic, not a generic cookie-jar abstraction. The Python app persists exactly the session cookies it needs and reuses them explicitly. That narrower contract is easier to preserve than a broad browser-cookie model.
- Because the runtime plan keeps cookie persistence custom, no cookie-jar dependency is required in the base stack. If that decision changes later, `fetch-cookie` + `tough-cookie` or `http-cookie-agent` + `tough-cookie` are the strongest library-backed alternatives for fetch-based cookie management.
- Fastify route tests do not require an extra HTTP test-client dependency in the base plan. Per the Fastify testing guide, `fastify.inject()` is built in and is sufficient for most route and plugin tests.
- The chosen runtime target is **Node.js 24 Active LTS**. This is the safest default because it is production-ready per the official Node release schedule, includes the modern fetch/runtime APIs we want, and avoids betting the migration on a non-LTS release line.
- The chosen module system is **ESM-only**. New TypeScript files should use standard `import` / `export` syntax, `package.json` should declare ESM mode, and the migration should not carry CommonJS compatibility unless a future deployment requirement forces it.
- Exact in-process log rotation parity is **not** required. The migration only requires durable file logging plus console logging. If the deployment environment already handles rotation externally, that is acceptable.

### 2.1 Expected TypeScript project layout

The TypeScript migration will replace the Python implementation **in-place**. That means the repository keeps the same top-level folders and the TypeScript files land beside the current Python file locations instead of moving into a separate workspace.

```text
repo root/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── config/
│   └── settings.ts
├── src/
│   ├── api.ts
│   ├── auth.ts
│   ├── database.ts
│   ├── errors.ts
│   ├── logger.ts
│   ├── main.ts
│   ├── models.ts
│   ├── scraper.ts
│   ├── sync.ts
│   └── transform.ts
├── webapp/
│   ├── app.ts
│   ├── db.ts
│   ├── images.ts
│   ├── server.ts
│   ├── routers/
│   │   ├── api.ts
│   │   └── pages.ts
│   ├── templates/
│   │   └── ... migrated Nunjucks templates ...
│   └── static/
│       └── ... existing static assets ...
└── tests/
    └── ... TypeScript test files replacing Python test files ...
```

Rules for this layout:

- Keep one TypeScript module per current Python module unless the design explicitly calls for a shared helper.
- Put shared transport-facing error classes in `src/errors.ts` so `auth.ts`, `scraper.ts`, and `api.ts` use the same taxonomy.
- Keep route registration code under `webapp/routers/` and keep `webapp/app.ts` separate from `webapp/server.ts`.
- Keep templates in `webapp/templates/` and static assets in `webapp/static/`; do not invent a second asset tree.
- The TypeScript implementation should replace the Python tree path-for-path as the migration completes. This is intentional so the final codebase shape stays familiar.

### 2.2 Required package.json scripts and what they are for

A junior engineer should not improvise project scripts. The initial TypeScript workspace should provide these commands with obvious purposes:

| Script       | Purpose                                                  |
| ------------ | -------------------------------------------------------- |
| `build`      | Run the TypeScript compiler and emit runnable JavaScript |
| `typecheck`  | Run `tsc --noEmit` to validate types without building    |
| `test`       | Run the Vitest suite once                                |
| `test:watch` | Run Vitest in watch mode during module-by-module work    |
| `lint`       | Run ESLint across the TypeScript source and tests        |
| `format`     | Run Prettier over source, tests, templates, and config   |
| `cli`        | Execute `src/main.ts`                                    |
| `web`        | Execute `webapp/server.ts`                               |

If a script is missing, add it before relying on ad-hoc local commands. Reproducible scripts matter because later tasks depend on them.

### 2.3 Module implementation template

Every non-trivial migrated module should follow the same order of work. A junior engineer should use this checklist for each file before writing any production code:

1. Read the Python source file being migrated.
2. Read the Python tests that currently characterize that file.
3. Decide the TS target file path using the project layout above.
4. Write the exported types and interfaces first.
5. Write the error cases and return shapes next.
6. Only then write the implementation.
7. Add or port tests for that module immediately.
8. Run only the relevant TS tests for that module.
9. Compare behavior with the Python implementation and tests before moving on.

The migration should not proceed by writing many TS files first and “coming back for tests later.” That is exactly how silent drift slips in.

### 2.4 How to decide whether a helper belongs in a shared file

A junior engineer should use this rule:

- If a helper is only used by one module, keep it in that module.
- If the same pattern appears in a second module, extract it into a shared helper.
- Do not create generic utility folders up front.

Examples:

- Error classes shared by `auth.ts`, `scraper.ts`, and `api.ts` belong in `src/errors.ts`.
- A parser used only by `transform.ts` should stay inside `transform.ts`.
- A DB row-mapping helper used only by `web/db.ts` should stay local until a second user appears.

### 2.5 What “parity” means in practice

The word “parity” can be too vague for a junior engineer, so this change defines it concretely.

The TypeScript code is considered in parity with Python only when all of the following are true for the migrated area:

1. The same inputs produce the same outputs.
2. The same invalid inputs fail in the same way.
3. The same data is written to SQLite in the same shape.
4. The same route or CLI command returns the same status/result contract.
5. The current characterization tests for that area have TS equivalents that pass.

Parity does **not** mean:

- cleaner code
- fewer helper functions
- more idiomatic TypeScript at the expense of behavior
- replacing strings with numbers “because TS can type it better”

### 2.6 Junior-safe implementation loop

For each task phase below, a junior engineer should use this exact work loop:

```text
read Python file
   ↓
read Python tests for that file
   ↓
create TS file skeleton
   ↓
port types and exported signatures
   ↓
port behavior
   ↓
port or add TS tests
   ↓
run focused tests
   ↓
only then move to the next file
```

Do not jump ahead to downstream files before the current file has:

- a TS implementation,
- a TS test file, and
- a passing focused test run.

### 3. Data and representation rules are part of the migration contract

The migration SHALL make a few global representation choices up front and apply them consistently across modules.

#### 3.1 Nullability

- Python `None` SHALL map to explicit `null` at persisted/domain boundaries.
- `undefined` MAY be used only for omitted optional function parameters, not as a silent substitute for database or API nulls.

**Why:** mixed `null`/`undefined` semantics are one of the fastest ways to introduce migration bugs.

#### 3.2 Dates and timestamps

- ISO timestamp strings stored in SQLite SHALL remain strings in the persistence boundary.
- The code MAY construct `Date` instances transiently for calculations, but stored values and API-facing parity checks SHALL compare the serialized ISO strings.

**Why:** the current system already treats timestamps as string data in the DB.

#### 3.3 Numeric-string fields

The migration SHALL preserve the current distinction between actual numeric fields and FPL fields deliberately preserved as strings, including but not limited to:

- `form`
- `selected_by_percent`
- `points_per_game`
- `influence`
- `creativity`
- `threat`
- `ict_index`
- `expected_goals_conceded`

**Why:** the Python code and tests explicitly preserve these distinctions. “Cleaning them up” would be a behavior change.

#### 3.4 Errors

Python exception categories SHALL become TypeScript `Error` subclasses with the same behavioral boundaries:

- auth failure
- rate-limit failure
- not-found failure
- generic API failure

**Why:** the sync and CLI layers rely on error taxonomy, not just error strings.

### 4. Keep raw SQL and schema ownership in application code

The TypeScript migration SHALL retain handwritten SQL and direct schema ownership in the repository.

**Why:**

- The current behavior is encoded in SQL queries, upserts, indexes, and schema evolution logic.
- Replacing raw SQL with an ORM would be a design change, not just a language change.
- `better-sqlite3` is a better fit for preserving the current shape than introducing model abstractions.

**Alternatives considered:**

- **Prisma/Drizzle/TypeORM:** rejected because they add a second design migration on top of the language migration.

### 5. Keep server-rendered templates

The web dashboard SHALL remain server-rendered, using Nunjucks templates that preserve current route structure, view-model shaping, filters, and template globals.

**Why:**

- The current webapp is already a thin SSR application.
- Jinja2 -> Nunjucks is a much smaller migration than Jinja2 -> client-rendered frontend.
- The existing route tests already characterize response shape and page context.

**Alternatives considered:**

- **SPA rewrite:** rejected as a parallel redesign.
- **Different template engine:** rejected because it increases migration cost without user-visible benefit.

### 6. Keep custom retry, backoff, rate-limit, and sync orchestration logic

The transport layer SHALL use library plumbing but keep application policy in-house.

The TypeScript implementation SHALL preserve the current semantics around:

- request counting
- jittered backoff
- 403 invalidation-and-retry behavior
- 429 `Retry-After` behavior
- partial failures during player sync
- dry-run write suppression
- gameweek sync active-player narrowing

**Why:** those are not generic transport concerns in this repository; they are current product behavior.

**Alternatives considered:**

- **Generic retry libraries:** rejected because they obscure the behavior we are trying to preserve.

### 7. Verification strategy: Python remains the oracle during migration

Implementation SHALL be staged so the TypeScript code proves parity against Python-owned artifacts before Python is retired.

Verification layers:

1. existing Python characterization tests remain intact;
2. TypeScript unit/integration tests are added module by module;
3. fixture-driven differential checks compare transformed outputs and SQLite state across both implementations where practical; and
4. a small number of controlled live probes may be used late in the migration, but offline verification remains the baseline.

**Why:** “ported tests pass” is weaker than “TS matches Python on the same inputs and expectations.”

The mandatory differential-check set for this migration is:

- transformed fixture outputs;
- algorithmic outputs such as coercion, rounding, xP/xGI, and other derived-field calculations;
- SQLite state after sync operations;
- route response shapes and important page-context structures;
- CLI exit codes and result summaries; and
- pipeline structure, meaning the same high-level scrape → transform → persist → summarize flow and the same partial-failure accounting behavior.

## File-by-file migration map

| Python source                | Proposed TS target        | Tricky bits / invariants to preserve                                                                                                                                                                                         | Primary oracle                                    |
| ---------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `config/__init__.py`         | none                      | Package marker only; no runtime behavior to port.                                                                                                                                                                            | n/a                                               |
| `config/settings.py`         | `config/settings.ts`      | `.env` loading timing; string/number coercion; uppercase defaults; path resolution relative to project root.                                                                                                                 | `tests/test_settings.py`                          |
| `src/__init__.py`            | none                      | Package marker only.                                                                                                                                                                                                         | n/a                                               |
| `src/api.py`                 | `src/api.ts`              | Endpoint paths must stay exact; auth-required methods must mark auth explicitly; `get_fixtures()` must collapse non-list responses to `[]`; `discover()` must probe opportunistically and record errors instead of aborting. | `tests/test_api.py`                               |
| `src/auth.py`                | `src/auth.ts`             | Session file JSON format; TTL validation; exact cookie subset persisted; missing credentials and HTTP failures must remain distinguishable; invalidate deletes cached session.                                               | `tests/test_auth.py`                              |
| `src/logger.py`              | `src/logger.ts`           | Root logger initialization semantics; console + durable file output; repeated setup must replace rather than duplicate handlers.                                                                                             | `tests/test_logger.py`                            |
| `src/main.py`                | `src/main.ts`             | Mutually exclusive CLI modes; same exit-code contract (0 success / 1 partial / 2 fatal); `--discover-api`; `--dry-run`; DB must be closed on all paths.                                                                      | `tests/test_main.py`                              |
| `src/models.py`              | `src/models.ts`           | Helper coercions; numeric-string preservation; bool-to-int normalization; xP/xGI math; `to_db_tuple` ordering; timestamp defaults.                                                                                           | `tests/test_models.py`, `tests/test_transform.py` |
| `src/transform.py`           | `src/transform.ts`        | Malformed row skipping with warnings rather than fatal aborts; bootstrap tuple ordering; fixture/live/history parsing boundaries.                                                                                            | `tests/test_transform.py`                         |
| `src/database.py`            | `src/database.ts`         | Schema DDL; WAL mode; upsert semantics; migration logic; `scrape_log`; active-player queries; preserving stored text vs real columns.                                                                                        | `tests/test_database.py`                          |
| `src/scraper.py`             | `src/scraper.ts`          | Timeout vs connection vs auth vs 404 vs 429 classification; one 403 re-auth retry; `Retry-After` handling; request counter; header defaults; cookie injection.                                                               | `tests/test_scraper.py`                           |
| `src/sync.py`                | `src/sync.ts`             | Full vs GW sync shape; dry-run write suppression; partial failure accumulation; current-GW detection; request-count propagation into results and scrape log.                                                                 | `tests/test_sync.py`                              |
| `webapp/__init__.py`         | none                      | Package marker only.                                                                                                                                                                                                         | n/a                                               |
| `webapp/__main__.py`         | `webapp/server.ts`        | Server bootstrap wiring, host/port defaults, and app creation boundary.                                                                                                                                                      | `tests/test_webapp_main.py`                       |
| `webapp/app.py`              | `webapp/app.ts`           | Startup lifecycle; non-blocking background image download; template singleton initialization; custom filters/globals; static mount path.                                                                                     | `tests/test_webapp_app.py`                        |
| `webapp/db.py`               | `webapp/db.ts`            | Read-only SQLite connection behavior; TTL cache semantics; rows-to-dicts coercion; complex filtering/sorting/pagination; overview aggregation; compare helpers.                                                              | `tests/test_webapp_db.py`                         |
| `webapp/images.py`           | `webapp/images.ts`        | CDN fallback order; skip-existing behavior; placeholder URL behavior; DB-read failure tolerance at startup.                                                                                                                  | `tests/test_webapp_images.py`                     |
| `webapp/routers/__init__.py` | none                      | Package marker only.                                                                                                                                                                                                         | n/a                                               |
| `webapp/routers/api.py`      | `webapp/routers/api.ts`   | Response shape must remain stable for overview, players, teams, search, compare, 404s, and invalid-ID errors; image enrichment remains server-side.                                                                          | `tests/test_webapp_api.py`                        |
| `webapp/routers/pages.py`    | `webapp/routers/pages.ts` | Template names, page context, pagination math, 404 behavior, and filter state preservation must remain stable.                                                                                                               | `tests/test_webapp_pages.py`                      |

### 7.1 File-by-file implementation checklist

The table above is the compact view. The checklist below is the junior-friendly execution view.

#### `config/settings.py` → `config/settings.ts`

- Read the current env variables and defaults from Python first.
- Preserve the same names unless the design explicitly says otherwise.
- Keep parsing logic simple: read environment, coerce values, expose a typed config object.
- Add tests for default values, overridden values, and invalid numeric values.

#### `src/auth.py` → `src/auth.ts`

- Start by defining the TypeScript shape of the saved session file.
- Port the session-validity check before the network login flow.
- Port file read/write/invalidate behavior before porting HTTP login.
- Keep the persisted cookie subset exactly the same as Python.
- Add tests for: valid cached session, expired session, missing credentials, failed login, successful login, and invalidate behavior.

#### `src/scraper.py` → `src/scraper.ts`

- Define the error classes before writing the request loop.
- Port the base request method first.
- Then add timeout/connection handling.
- Then add 403 re-auth behavior.
- Then add 429 retry behavior.
- Then add request counting.
- Add tests in the same order, one behavior at a time.

#### `src/api.py` → `src/api.ts`

- Keep this file thin. It should mostly build endpoint paths and call the scraper.
- Avoid putting retry/auth logic here; that belongs in the scraper layer.
- Port one endpoint wrapper at a time and test the exact path and parameters passed through.

#### `src/models.py` and `src/transform.py`

- Write the TypeScript types for each domain object first.
- Preserve Python field names unless a separate change explicitly renames them.
- Treat numeric-string fields carefully; do not auto-convert them to numbers.
- Port helper coercion functions before the larger object builders.
- Add tests for malformed rows, skipped rows, and tuple ordering.

#### `src/database.py`

- Port schema creation first.
- Port connection/setup behavior next, including WAL mode if the TS driver supports the same pragma usage.
- Port insert/upsert helpers one table at a time.
- Port query helpers after writes are working.
- Use fixture DB tests to prove that the TS code writes the same rows the Python code writes.

#### `src/sync.py`

- Do not start here until `auth`, `scraper`, `api`, `models`, `transform`, and `database` are working.
- Port the full-sync orchestration flow first.
- Port gameweek-specific sync second.
- Add tests for dry-run, partial failures, success summary, and request-count propagation.

#### `src/main.py`

- Keep the CLI parser thin.
- Its job is to parse arguments, build dependencies, call sync/discovery paths, and exit with the right code.
- Add tests for each CLI mode and each exit path.

#### `webapp/db.py`

- Treat this as a separate read-model layer, not as a second copy of `src/database.py`.
- Port the cache helpers first.
- Then port read queries one route family at a time: overview, players, teams, search, compare.
- Add tests for filtering, sorting, pagination, cache invalidation, and compare semantics.

#### `webapp/images.py`

- Port fallback URL generation before download orchestration.
- Keep startup failures non-fatal if Python currently tolerates them.
- Add tests for existing-file short-circuit, fallback URL behavior, and failed download behavior.

#### `webapp/app.py`, `webapp/routers/api.py`, `webapp/routers/pages.py`, `webapp/__main__.py`

- Port the Fastify app factory before the routes.
- Register views, static assets, filters, and globals before porting route handlers.
- Port JSON routes before HTML page routes because JSON responses are easier to compare.
- Port the server bootstrap last.
- Test routes with `fastify.inject()` instead of starting a real server unless a test specifically needs a listening port.

### Migration sequencing

The migration should proceed in dependency order, not UI order:

```text
settings/logger
    ↓
auth → scraper → api
    ↓
models → transform → database → sync → cli
    ↓
web db → images → app → routes → server bootstrap
```

Why this order:

- `auth` and `scraper` define transport semantics everything else depends on.
- `models`, `transform`, and `database` define the persistence contract the syncer and dashboard read from.
- The dashboard should move only after the SQLite contract exists in TS.

### Sequencing rules a junior engineer should follow

These rules are mandatory because they prevent downstream confusion:

1. Do not implement `sync.ts` before `database.ts` is proven by tests.
2. Do not implement dashboard routes before `web/db.ts` is proven by tests.
3. Do not migrate templates before the page route context objects are stable.
4. Do not remove or rewrite Python tests during the TS build-out.
5. Do not replace raw SQL with a new abstraction layer.
6. Do not combine “porting” with “cleanup” in the same step.

If a junior engineer is unsure whether a change is migration work or cleanup work, the safe answer is: leave cleanup for later.

## Risks / Trade-offs

- **[Risk] Library drift from Python parity** → Use libraries only for plumbing, not for application policy; keep raw SQL, retry rules, auth semantics, and transforms in-house.
- **[Risk] `null`/`undefined` confusion** → Adopt explicit representation rules and treat `null` as the persisted/domain absence value.
- **[Risk] SQLite behavior changes under a different driver** → Keep schema SQL and query text explicit; validate against existing DB-focused tests and fixture DBs.
- **[Risk] Template migration changes behavior accidentally** → Keep route structure and view-model shaping stable; migrate Jinja templates mechanically into Nunjucks first, improve later if needed.
- **[Risk] Logging parity regresses** → Use a logger that supports file transports and rotation semantics rather than defaulting to framework-native request logging.
- **[Risk] “Improvement” rewrites numeric-string fields into numbers** → Lock those fields down with typed factories and parity tests.
- **[Risk] Hidden Python-only behavior in startup/lifecycle** → Preserve background image download and DB initialization order explicitly in the TS app bootstrap.
- **[Risk] Porting the tests and the misunderstanding together** → Keep Python as the oracle until TypeScript proves parity on shared fixtures and expectations.

## Migration Plan

1. Scaffold the TypeScript workspace and chosen packages.
2. Port configuration and logging first so every later module builds against the final runtime model.
3. Port auth, scraper, and API wrappers with parity tests for error semantics and session behavior.
4. Port models, transforms, and SQLite schema/upsert logic; verify with fixture-driven tests and DB-state assertions.
5. Port sync orchestration and CLI entrypoints; verify exit codes, dry-run behavior, and partial-failure handling.
6. Port web DB helpers and image helpers once the DB contract exists in TS.
7. Port app factory, view integration, JSON routes, and page routes while preserving current template/context behavior.
8. Run Python-vs-TypeScript differential checks where the same fixtures can drive both implementations.
9. Cut over immediately and completely once the TypeScript suite plus differential checks demonstrate parity for the required surfaces.

There is no split cutover plan in this change. The intended cutover is one coherent switch from Python to TypeScript after readiness is proven.

## Junior engineer acceptance checklist

Before marking any migrated area complete, verify all of the following:

### A. Code structure

- The TS file lives in the expected target path.
- The file owns only the behavior mapped from its Python counterpart.
- Shared helpers were extracted only when reused in two or more places.

### B. Behavior

- Happy-path behavior matches Python.
- Known error paths match Python.
- Persisted DB shape matches Python where that file writes data.
- Route or CLI contracts match Python where that file exposes user-facing behavior.

### C. Tests

- A focused TS test file exists for the migrated module.
- The most relevant Python test file was used as the oracle.
- Focused tests for that module pass locally.

### D. Scope discipline

- No unrelated refactor was mixed into the migration.
- No dependency was added without being justified in this design.
- No data representation rule (`null`, timestamps, numeric-string fields) was violated.

## Junior engineer red flags

Stop and re-check the design if any of these happen:

- You are about to introduce an ORM.
- You are about to rename many fields “for TypeScript style.”
- You are about to move route logic into the DB layer or vice versa.
- You are about to make templates client-rendered.
- You are about to change a test because the TS behavior seems more reasonable.
- You are unsure whether a field should be `string`, `number`, `null`, or `undefined`.
- You are trying to implement a downstream module before its upstream dependency has passing tests.

These are not signs to push through; they are signs to pause and resolve the ambiguity first.

## Definition of done for the full migration

The migration is done only when all of the following are true:

1. The TypeScript CLI can run the supported sync and discovery flows.
2. The TypeScript webapp can serve the current dashboard pages and JSON endpoints.
3. The TypeScript test suite covers the migrated modules at the same behavioral level as the Python suite.
4. Differential checks show that important fixture-driven outputs, algorithmic outputs, SQLite state, and pipeline behavior match Python.
5. Cutover can happen immediately and completely without relying on the Python implementation at runtime.

Anything short of that is a partial migration, not a complete one.

## Resolved implementation decisions

- **Node runtime:** Node.js 24 Active LTS
- **Module system:** ESM-only
- **Repository layout:** replace the Python implementation in-place using the existing `config/`, `src/`, `webapp/`, and `tests/` paths
- **Cutover strategy:** one immediate, complete cutover after parity is proven
- **Logging requirement:** equivalent durable file logging is sufficient; exact in-process rotation parity is not required
- **Mandatory differential checks:** transformed outputs, algorithmic outputs, SQLite state, route/page structures, CLI summaries, and pipeline structure
