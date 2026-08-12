## Context

- `src/bun/mcp/registry-pool.ts`: `getForProject()` creates/caches the project registry and returns it; it never calls `startAll()`/`ensureStarted()`. `getGlobalRegistry()` returns the boot-started global registry. The pool is constructed with a `clientFactory` (DI seam), and `ExecutionParamsBuilder` takes `pool?` via its constructor (DI seam).
- `src/bun/index.ts` (~line 124, ~228, ~267, ~303): constructs the pool, passes it to the `Orchestrator`, and exposes `mcp.*` RPC; only the **global** registry is started at boot.
- `src/bun/engine/execution/execution-params-builder.ts` (line 67): `buildForTask` → `this.pool.getForProject(projectPath)`; `buildForChat` → `getGlobalRegistry()`. The registry lands in `ctx.runtime.mcpRegistry`.
- `src/bun/engine/common-tools.ts` (~672–686): `list_mcp_servers`/`list_mcp_tools`/`invoke_mcp_tool` call `execListMcpServers(registry)` etc. — `executeCommonTool` is async and already awaits executor results.
- `src/bun/mcp/registry.ts`: `startAll()` exists but is fire-and-forget (`Promise.allSettled`) with no idempotency guard and no way for callers to await completion.
- `src/bun/mcp/discovery-tools.ts`: `execListMcpServers`/`execListMcpTools` are sync and read registry state directly; `execInvokeMcpTool` is async. A freshly-created registry still `starting` is therefore observed as `idle`.

## Goals

- Project-scoped servers reach `running` before the execution's MCP tools operate.
- No double-start on concurrent access; no surprise auto-retry of errored servers.
- Global registry behavior unchanged.
- Minimal blast radius: `getForProject()` still returns the registry handle synchronously, so builders/executors are unchanged; only the discovery executors become async (the dispatcher already awaits them).

## Non-Goals

- No changes to the `mcp.*` RPC surface or the frontend MCP UI.
- No change to boot-time `startAll()` semantics for the global registry.
- **No Playwright coverage for the regression**: `e2e/ui/mcp-tools.spec.ts` + `playwright.config.ts` serve the built frontend (`vite preview`) and mock the RPC backend (`api.returns("mcp.getStatus", [])`). The bug is backend-side; Playwright cannot exercise it.
- Not fixing pre-existing spec drift (`mcp-registry-pool/spec.md` has a `TBD` purpose and stale `getRegistry()` naming) — flagged for a separate cleanup, out of scope here.

## Decisions

### D1 — Start trigger lives in the pool, fired on first creation

`getForProject()`'s new-registry branch calls `void registry.ensureStarted().catch(log)` before returning, mirroring the boot pattern in `index.ts`. The cached branch returns the registry without re-starting.

### D2 — `ensureStarted()` is idempotent

Guarded by an in-flight `startPromise` shared by concurrent callers; after settle, a terminal-state check makes later calls no-ops. `reload()` and `shutdown()` invalidate the guard. Servers in `error`/`auth_required` are never retried by `ensureStarted()`.

### D3 — Discovery executors await readiness

All three executors start with `await registry.ensureStarted()`, closing the race between pool fire-and-forget start and tool use. `execListMcpServers`/`execListMcpTools` become `Promise<string>`; `executeCommonTool` already awaits executor results.

### D4 — Keep `getForProject()` synchronous

Returning the registry handle synchronously while starting in the background keeps the pool API stable; executors close the race by awaiting.

### D5 — `invalidate()` path needs no change

A recreated registry is a new instance, so its first creation triggers a fresh start.

## Testing Strategy

Aligned to the existing test landscape (unit `bun test`, integration in-memory DB, Playwright excluded):

- **registry unit** (`mcp-registry.test.ts`): `ensureStarted()` idempotency — two concurrent callers share one `startAll`; a `running` registry is a no-op (no second start); an `error` server is not restarted; `reload()`/`shutdown()` invalidate the guard.
- **pool unit** (`mcp-registry-pool.test.ts`): extend the inline `FakeMcpClient` with `ensureStarted()` (the code under test calls it — not test-only code); assert first `getForProject()` fires `ensureStarted()`, a cached call does not, `getGlobalRegistry()` returns without a pool-fired start, and `invalidate()` → new registry → new start.
- **discovery unit** (`mcp-discovery-tools.test.ts`): executors await a **pending** `ensureStarted()` — assert status is `running` (never `idle`) once the start resolves, and `list_mcp_tools`/`invoke_mcp_tool` dispatch only after readiness.
- **builder unit** (`execution-params-builder.test.ts`): with the injected `pool` (DI seam), assert the registry placed in `ExecutionParams` is the started project registry.
- **integration** (`e2e/api/*.test.ts`, in-memory DB via `support/backend-rpc-runtime.ts` + `helpers.ts`): boot the real server with a project config + local stdio MCP server fixture; assert `mcp.getStatus` reports `running` and `invoke_mcp_tool` succeeds — the `grafana-mcpar` shape.

## Migration / Rollback

Additive internal API; no config or DB migration. Standard git revert of the change commits.
