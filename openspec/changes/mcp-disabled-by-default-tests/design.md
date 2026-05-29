## Context

The `mcp-disabled-by-default` production change introduces: a DB migration (NULL→[]), a new `McpRegistryPool` class, a new `config-loader.ts` module, two new RPC handlers, and UI changes in `McpToolsPopover`. Each of these surfaces needs verified test coverage. This design governs how tests are structured, what DI seams are used, and which test layers cover each concern.

**Key constraint**: No test-only production code. All testability improvements must be refactorings that also improve the production design.

## Goals / Non-Goals

**Goals:**
- Cover every new production module with unit tests using real DI injection.
- Cover the migration with a DB migration test that verifies null-conversion in both tables.
- Fix broken existing tests (V-12, V-24/V-25, `null` semantics in execution-params-builder).
- Extend the Playwright suite with suites covering default-unchecked state, two edit buttons, and session-vs-task button visibility.
- Use dependency injection (factory functions, interface parameters) as the mocking mechanism — no module-level spies, no test-only code paths.

**Non-Goals:**
- Integration tests that launch real MCP processes (those belong in a separate E2E layer).
- Performance / load tests.
- Visual regression tests.

## Decisions

### Decision: McpRegistryPool uses a factory DI parameter
`McpRegistryPool` receives `(config: McpConfig) => McpClientRegistry` in its constructor. In tests, this factory is a spy that returns a minimal fake registry object. In production the default is `(c) => new McpClientRegistry(c)`. No conditional logic, no test-only constructors.

### Decision: mcpHandlers accepts resolver and pool via DI params
`mcpHandlers(db, { registryPool, resolveProject })` — the handler factory receives dependencies explicitly. `resolveProject(wsKey, projectKey)` returns a `{ projectPath: string }` or throws. In tests, a stub resolver is passed, so no real workspace config is needed.

### Decision: helpers.ts initDb() must be updated as part of feature implementation
`initDb()` in `src/bun/test/helpers.ts` does not currently include `enabled_mcp_tools` on the `tasks` table. This is a bug in test infrastructure. It must be fixed when implementing the feature (not test-only code — it mirrors the production schema). Task `1.2` in the main change should include this.

### Decision: mock-data.ts defaults flip to [] before new Playwright suites are written
`makeTask()` and `makeChatSession()` both default `enabledMcpTools: null` today. Flipping to `[]` is the first Playwright change and must happen before any new suite can be added. All existing tests that relied on `null = all enabled` must be updated at the same time.

### Decision: New Playwright suites use existing ApiMock pattern
`mcp.getProjectConfig` and `mcp.saveProjectConfig` are new RPC methods. Once added to `rpc-types.ts`, `ApiMock` will automatically type them. Tests use `api.returns(...)` and `api.capture(...)` exactly as done in existing `mcp-tools.spec.ts` tests.

## Risks / Trade-offs

- **[Risk] helpers.ts schema drift** — if `initDb()` is not updated alongside the migration, migration tests will fail on column-not-found errors. Mitigation: task order in the main change ensures schema update precedes test writing.
- **[Risk] Playwright tests depend on V-12/V-24/V-25 being fixed first** — new suites B/C/D assume `[]` default semantics. If the fix task is skipped, test isolation breaks. Mitigation: the tasks file enforces this ordering.
- **[Trade-off] DI factory adds minor indirection to McpRegistryPool** — acceptable. The pattern is already used elsewhere in the codebase (engine registry factory, orchestrator injection).
