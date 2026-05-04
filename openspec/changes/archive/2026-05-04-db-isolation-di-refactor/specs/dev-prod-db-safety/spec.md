## ADDED Requirements

### Requirement: dev script uses memory DB by default
`bun run dev` SHALL start the application with an in-memory SQLite database unless `--real-db` is explicitly passed. The `scripts/dev.ts` comment header SHALL document the available flags.

#### Scenario: Default dev start uses memory DB
- **WHEN** `bun run dev` is executed without any flags
- **THEN** the server starts with `RAILYN_DB=:memory:` (no file written to `~/.railyn/`)

#### Scenario: --real-db flag enables production DB
- **WHEN** `bun run dev -- --real-db` is executed
- **THEN** the server starts with the real DB path (`~/.railyn/railyn.db`)

#### Scenario: Legacy --memory-db flag still works
- **WHEN** `bun run dev -- --memory-db` is executed
- **THEN** the server starts with `RAILYN_DB=:memory:` (backward compatibility preserved)

### Requirement: prod script for real DB
`package.json` SHALL include a `prod` script equivalent to `bun scripts/dev.ts -- --real-db`. This provides a clear, memorable entry point for developers who need to run against real data.

#### Scenario: prod script uses real DB
- **WHEN** `bun run prod` is executed
- **THEN** the server starts with the real DB path

### Requirement: README documents dev/prod distinction
The README Development section SHALL document that `bun run dev` uses an in-memory DB (data resets on restart) and `bun run prod` uses the persistent real DB. The README SHALL remove all references to Electrobun-era scripts (`dev:test`, `dev:debug`, `test:ui`, `test:ui:run`, `test:ui:review`) and the debug HTTP bridge section.

#### Scenario: README dev section is accurate
- **WHEN** a developer reads the README Development section
- **THEN** they can understand the DB behavior of `dev` vs `prod` without reading source code

#### Scenario: README test section lists current commands
- **WHEN** a developer reads the README Testing section
- **THEN** they see `bun test src/bun --timeout 20000`, `bun test e2e/api --timeout 30000`, and `npx playwright test e2e/ui` as the current test commands
