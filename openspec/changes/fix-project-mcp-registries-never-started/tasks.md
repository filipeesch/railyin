## 1. Add `ensureStarted()` to `McpClientRegistry`

- [ ] `src/bun/mcp/registry.ts` — add `ensureStarted()`: shared in-flight `startPromise`, terminal-state no-op, clear the guard on settle; `reload()` and `shutdown()` invalidate it.

## 2. Start project registries on first use

- [ ] `src/bun/mcp/registry-pool.ts` — in `getForProject()`'s new-registry branch, fire `void registry.ensureStarted().catch(log)`. Cached branch unchanged.

## 3. Make discovery executors await readiness

- [ ] `src/bun/mcp/discovery-tools.ts` — `execListMcpServers` / `execListMcpTools` become `Promise<string>`; all three executors `await registry.ensureStarted()` before operating.

## 4. Unit tests (`src/bun/test`)

- [ ] `mcp-registry.test.ts` — `ensureStarted()`: concurrent calls share one `startAll`; `running` registry is a no-op; `error` server not retried; `reload()`/`shutdown()` invalidate the guard.
- [ ] `mcp-registry-pool.test.ts` — extend the inline `FakeMcpClient` with `ensureStarted()`; first `getForProject()` fires it; cached call doesn't; `getGlobalRegistry()` returns without a pool-fired start; `invalidate()` → new registry → new start.
- [ ] `mcp-discovery-tools.test.ts` — executors await a **pending** `ensureStarted()`; status is `running` (never `idle`) once the start resolves; `list_mcp_tools` / `invoke_mcp_tool` dispatch only after readiness.
- [ ] `execution-params-builder.test.ts` — with the injected `pool`, assert the registry in `ExecutionParams` is the started project registry.

## 5. Integration test (`e2e/api`, in-memory DB)

- [ ] New/extended `e2e/api` test via `support/backend-rpc-runtime.ts` + `helpers.ts` (`Database(":memory:")`) — boot the real server with a project config + local stdio MCP server fixture; assert `mcp.getStatus` reports `running` and `invoke_mcp_tool` succeeds (the `grafana-mcpar` shape).
- [ ] Playwright (`e2e/ui/mcp-tools.spec.ts`) intentionally **not** extended — it mocks the RPC backend and cannot exercise this bug.

## 6. Verification

- [ ] `bun test src/bun --timeout 20000`
- [ ] `bun test e2e/api --timeout 30000`
- [ ] Manual: a project-scoped server (grafana-mcpar-style) reaches `running`; `list_mcp_tools` / `invoke_mcp_tool` succeed.
