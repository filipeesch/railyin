## Why

Railyin's data layer is hard-wired to a single synchronous `bun:sqlite` database with no way to point it at an external server. Teams that need shared, durable, or multi-instance storage cannot use it. Supporting PostgreSQL — selected declaratively via a `config/database.yaml` file — unlocks those deployments. Doing it properly means moving the runtime data layer onto Bun's native promise-based SQL client (`Bun.SQL`), which drives both SQLite and PostgreSQL through one connection-string API.

## What Changes

- Add `config/database.yaml` (driver-tagged). When the file is **absent**, the app defaults to SQLite (`~/.railyn/railyn.db`) exactly as today. When **present**, the `driver:` field (`sqlite` | `postgres`) selects the engine and its nested block supplies connection details.
- **BREAKING (internal):** replace the synchronous `bun:sqlite` runtime data layer with an async `Bun.SQL`-backed one. Every DB read/write becomes `await`; the async color propagates through repositories, handlers, and engines. No external API changes — the RPC/WebSocket contract is untouched.
- Introduce a thin injectable **`Db` port** (`rows` / `exec` / `begin`) plus a **`Dialect` strategy** (SQLite/Postgres) isolating the handful of divergent SQL fragments (`now()`, JSON extraction, `RETURNING`, boolean mapping). Standardize all queries on `$1` positional placeholders through the port.
- Make the **migration runner dialect-aware** with two paths: SQLite replays the 53 existing (frozen, checksum-stable) migration files via `bun:sqlite` at migrate-time; PostgreSQL runs a single consolidated baseline schema (and future dual-dialect migrations) via `Bun.SQL`.
- Thread transactions through an **explicit executor parameter** (the 14 transaction sites) rather than the removed synchronous `db.transaction()`.
- Deliver the port via a **singleton provider** (`getDb(): Db`) with constructor DI for classes, preserving existing test seams without a 130-site rewrite.
- Add a `config/database.yaml.sample` documenting both driver blocks.

## Capabilities

### New Capabilities
- `database-configuration`: Declarative DB selection via `config/database.yaml` — driver-tagged blocks, SQLite-default-when-absent, and precedence relative to the `RAILYN_DB` env override.
- `database-abstraction-layer`: The async `Db` port, `Dialect` strategy, `Bun.SQL` adapter, `$1`/`rows`/`exec`/`begin` query API, explicit-executor transactions, and the provider + constructor-DI delivery model.
- `postgresql-database`: First-class PostgreSQL engine support — consolidated baseline schema, Postgres dialect fragments, connection-pool config, and SQLite↔Postgres type coercion in row mappers.

### Modified Capabilities
- `db-migration-runner`: Runner becomes dialect-aware with dual execution paths (bun:sqlite replay for SQLite history; Bun.SQL for the Postgres baseline and future migrations), a per-dialect backup strategy, and an async migration contract for the Postgres path — while keeping the SQLite file contract and checksum guard intact.

## Impact

- **New code:** `Db` port + `Bun.SQL` adapter, `Dialect` (sqlite/postgres), `resolveDbConfig()`, async `initDb()` at boot, dialect-aware migration runner, consolidated Postgres baseline migration, `config/database.yaml(.sample)`.
- **Wide async ripple:** ~200 query sites (`.query().get/all`, `.run`, `.exec`) become `await db.rows/exec`; the change reaches repositories (`src/bun/db/**`), handlers (`src/bun/handlers/**`), and engines (`src/bun/engine/**`), including the streaming hot-path buffers (`raw-message-buffer`, `conv-message-buffer`, `write-buffer`).
- **Dependencies:** adds runtime use of `Bun.SQL`; retains `bun:sqlite` for SQLite migrate-time replay and in-memory tests only.
- **Config/boot:** `src/bun/index.ts` gains async DB init before migrations; `getDb()` semantics change from a `bun:sqlite` `Database` to the `Db` port.
- **No changes** to `src/shared/rpc-types.ts` or the frontend — this is a backend persistence swap.
