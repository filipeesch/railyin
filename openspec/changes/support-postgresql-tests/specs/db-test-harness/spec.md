## ADDED Requirements

### Requirement: TH-1 Async in-memory DB fixture via real migrations
The backend test harness SHALL expose an async `initDb()` that provisions an in-memory `Bun.SQL` SQLite database and builds its schema by running the real SQLite migration path, replacing the previously hand-maintained inline DDL. It SHALL reset the DB singleton so each test starts from a clean schema.

#### Scenario: Schema matches production
- **WHEN** a test calls `await initDb()`
- **THEN** the in-memory database contains every table and index produced by the real migrations, with no separately maintained DDL copy

#### Scenario: Isolation between tests
- **WHEN** two tests each call `await initDb()`
- **THEN** each receives a freshly migrated in-memory database with no data leaked from the other

#### Scenario: In-memory state shared across the pool
- **WHEN** concurrent queries run against the fixture's `Db`
- **THEN** they observe the same in-memory data (the pool does not open divergent empty `:memory:` connections)

### Requirement: TH-2 Async seed helpers
`seedProjectAndTask` and `seedChatSession` SHALL be async and perform their inserts through the `Db` port, returning the same identifier shapes as today.

#### Scenario: Seed a project and task
- **WHEN** `await seedProjectAndTask(db, ...)` is called
- **THEN** it returns `{ projectKey, boardId, taskId, conversationId, workspaceKey }` with rows persisted via the async port

#### Scenario: Seed a chat session
- **WHEN** `await seedChatSession(db, ...)` is called
- **THEN** it returns `{ sessionId, conversationId }` with rows persisted via the async port

### Requirement: TH-3 Injectable FakeDb
The harness SHALL provide a `FakeDb` implementing the `Db` port that records every SQL text and parameter array it receives and returns caller-configured canned rows, enabling pure-unit tests of query shape, parameter binding, and row mapping without a real database.

#### Scenario: Records SQL and params
- **WHEN** a repository constructed with a `FakeDb` executes a query
- **THEN** the `FakeDb` exposes the exact SQL text and the bound parameter array for assertion

#### Scenario: Returns canned rows
- **WHEN** a test primes the `FakeDb` with rows for a query
- **THEN** the repository maps those rows and no real database is touched

#### Scenario: Distinguishes rows vs exec
- **WHEN** `rows()` and `exec()` are invoked
- **THEN** the `FakeDb` records each call against the correct operation for assertion

### Requirement: TH-4 Docker-gated Postgres testcontainer fixture
The harness SHALL provide a `pgTestContainer()` fixture that starts an ephemeral PostgreSQL instance and yields a `Db` connected to it, tearing it down after the test. When Docker (or a reachable container runtime) is unavailable, the dependent tests SHALL be skipped with a clear message rather than failing.

#### Scenario: Container provided when Docker is available
- **WHEN** a PG test requests `pgTestContainer()` and Docker is available
- **THEN** it receives a `Db` connected to a fresh, isolated PostgreSQL and the container is removed afterward

#### Scenario: Skipped when Docker is absent
- **WHEN** Docker/container runtime is unavailable
- **THEN** the PG-execution tests are skipped with a message explaining the requirement, and the rest of the suite still runs

#### Scenario: Isolation between PG tests
- **WHEN** two PG tests each request a container
- **THEN** neither observes the other's schema or data
