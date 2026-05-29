## Why

The `mcp-disabled-by-default` feature introduces semantic breaking changes (NULL→[] default flip), new classes (`McpRegistryPool`, `config-loader`), new RPC handlers, and UI state changes that all need verified test coverage. Without it, regressions in the MCP tool-injection pipeline, project config resolution, and popover rendering behavior would go undetected.

## What Changes

- New unit test file `mcp-config-loader.test.ts` covering `normalizeToMcpConfig` extraction.
- New unit test file `mcp-registry-pool.test.ts` covering pool lazy init, caching, project fallback, and shutdown — using DI factory injection, no real MCP processes.
- Updated `execution-params-builder.test.ts`: flip `null → []` semantics, add pool DI path.
- New migration test case in `db-migrations.test.ts`: verifies migration 044 converts NULL→`[]` in both `tasks` and `chat_sessions`.
- Updated `handlers.test.ts` (or new `mcp-handlers.test.ts`): test `mcp.getProjectConfig` and `mcp.saveProjectConfig` via injected resolver stub.
- Updated `e2e/ui/mcp-tools.spec.ts`: fix V-12 / V-24 / V-25 (null semantics), add suites for default-unchecked state, two edit buttons, session-vs-task button visibility.
- Updated `e2e/ui/fixtures/mock-data.ts`: flip `enabledMcpTools` defaults from `null` to `[]` in `makeTask()` and `makeChatSession()`.

## Capabilities

### New Capabilities

- `mcp-config-loader-unit`: Unit tests for `normalizeToMcpConfig` and `loadMcpConfigFile` covering all input shapes (empty, array format, VS Code object-map, http/stdio entries, headers, env).
- `mcp-registry-pool-unit`: Unit tests for `McpRegistryPool` — lazy init, per-project caching, global fallback, missing config, shutdown — via DI factory injection.
- `mcp-project-config-rpc-unit`: Handler-level unit tests for `mcp.getProjectConfig` and `mcp.saveProjectConfig` with in-memory DB and stubbed project resolver.
- `mcp-migration-test`: DB migration test case for migration 044 (NULL→[]) covering both tables and confirming existing non-null values are untouched.
- `mcp-tools-e2e-updates`: Updated and extended Playwright spec covering the default-disabled state, two edit buttons, and session-vs-task visibility rules.

### Modified Capabilities

- `execution-params-builder-unit`: Existing tests in `execution-params-builder.test.ts` must be updated: `null` DB value maps to `[]`, parse errors map to `[]`, pool DI variant covered.

## Impact

- **Test files created**: `src/bun/test/mcp-config-loader.test.ts`, `src/bun/test/mcp-registry-pool.test.ts`
- **Test files updated**: `src/bun/test/execution-params-builder.test.ts`, `src/bun/test/db-migrations.test.ts`, `src/bun/test/handlers.test.ts`, `e2e/ui/mcp-tools.spec.ts`, `e2e/ui/fixtures/mock-data.ts`
- **Infra files updated**: `src/bun/test/helpers.ts` (add `enabled_mcp_tools` to `initDb()` schema)
- **No production code changes** — all testability improvements (DI seams, factory injection) are driven by the `mcp-disabled-by-default` production change.
