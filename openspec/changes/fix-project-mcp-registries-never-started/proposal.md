## Why

MCP servers declared in a project's `.railyn/mcp.json` never reach `running`. `McpRegistryPool.getForProject()` creates and caches a project-scoped `McpClientRegistry` but **never starts it** — only the global registry is started, at boot (`src/bun/index.ts`). Consequences:

- `list_mcp_servers` shows project-scoped servers stuck in `idle`.
- `list_mcp_tools` / `invoke_mcp_tool` fail with `not available (state: idle)`.
- Live case: the `grafana-mcpar` server (project-scoped, `http://10.8.0.1:8000/mcp`) is unusable through the Railyin MCP tools while the endpoint itself answers direct MCP `initialize`/`tools/list`/`tools/call` requests.

## What Changes

- **`McpClientRegistry.ensureStarted()`** — a new idempotent start helper: concurrent calls share one in-flight start; once servers are terminal (`running`/`error`/`auth_required`/`disabled`) it is a no-op; errored servers are never auto-retried (retry stays on `reload()`).
- **`McpRegistryPool.getForProject()`** — on first creation of a project registry, fire `ensureStarted()` asynchronously (non-blocking) so servers transition `idle → starting → running` before the execution's MCP tools operate. Cached lookups don't re-start.
- **`src/bun/mcp/discovery-tools.ts`** — all three executor functions (`execListMcpServers`, `execListMcpTools`, `execInvokeMcpTool`) `await registry.ensureStarted()` before reading status / listing tools / invoking a tool. `execListMcpServers` and `execListMcpTools` become async (`Promise<string>`); the dispatcher already awaits executor results, so no caller changes.
- **Tests** aligned to the existing test landscape:
  - **Unit** (`src/bun/test/*.test.ts`): registry `ensureStarted()` idempotency (concurrent single-start, terminal no-op, error no-retry); pool start-on-first-use + cached no-restart; discovery idle-race (executors await a pending `ensureStarted`); builder DI assertion (the registry handed to `ExecutionParams` is started).
  - **Integration** (backend-rpc-runtime harness, in-memory DB via `support/backend-rpc-runtime.ts` + `helpers.ts`): a task execution in a project with a `.railyn/mcp.json` drives the real `ExecutionParamsBuilder.build()` → `getForProject(projectPath)` → executor path; `list_mcp_servers` reports the project server `running` and `invoke_mcp_tool` succeeds — the `grafana-mcpar` shape. (The `mcp.getStatus` RPC is global-only, so the project scope is observed through the execution's MCP tools, not an RPC.)
  - **Playwright excluded** (non-goal): `e2e/ui/mcp-tools.spec.ts` mocks the RPC backend (`api.returns("mcp.getStatus", ...)`) and cannot exercise this backend-side bug.

## Impact

- **Backend only**: `src/bun/mcp/registry.ts`, `registry-pool.ts`, `discovery-tools.ts` + unit/integration tests.
- No RPC, DB, or frontend changes; the `mcp.*` RPC surface is untouched.
- Global registry behavior unchanged — it is still started at boot; `ensureStarted()` is a no-op there (servers already `running`).
- Test-only surface changes are limited to fakes that gain `ensureStarted()` (required because the code under test calls it) — no test-only production code.

## Capabilities

- `mcp-client-registry` — ADD `ensureStarted()` requirement; MODIFY the pool lookup requirement to state project registries are started on first use.
- `mcp-registry-pool` — MODIFY the pool requirement to state project registries are started on first use.
- `mcp-tool-discovery` — ADD a "discovery tools await registry readiness" requirement, including an integration scenario (`list_mcp_servers`/`invoke_mcp_tool` for a project-scoped server).
