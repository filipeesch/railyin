## 1. Add `ensureStarted()` to `McpClientRegistry`

- [x] `src/bun/mcp/registry.ts` — added `ensureStarted()`: shared in-flight `startPromise`, starts only `idle` servers, resolves once they reach a terminal state, clears the guard on settle; `shutdown()` invalidates it. `startAll()` shares the same guard (boot/reload path unchanged: starts all non-disabled servers).

## 2. Start project registries on first use

- [x] `src/bun/mcp/registry-pool.ts` — in `getForProject()`'s new-registry branch, fired `void registry.ensureStarted().catch(log)`. Cached branch unchanged; global fallback branch unchanged (never pool-started).

## 3. Make discovery executors await readiness

- [x] `src/bun/mcp/discovery-tools.ts` — `execListMcpServers` / `execListMcpTools` became `Promise<string>`; all three executors `await registry.ensureStarted()` before operating (in `execInvokeMcpTool` the await runs *before* the availability check so idle servers are started, not reported unavailable).

## 4. Unit tests (`src/bun/test`)

- [x] `mcp-registry.test.ts` — `ensureStarted()`: starts idle servers; no-op when running; concurrent calls share a single start (no double-start); skips disabled servers; does not retry errored servers; can start again after `shutdown()`.
- [x] `mcp-registry-pool.test.ts` — mock registry gained `ensureStarted()`; first `getForProject()` fires it; cached lookup doesn't; global fallback registry is never pool-started.
- [x] `mcp-discovery-tools.test.ts` — executors awaited (`Promise<string>`); idle servers are lazily started (never reported `idle`); `list_mcp_tools` / `invoke_mcp_tool` dispatch only after readiness; failed-to-start servers still surface as errors.
- [x] `execution-params-builder.test.ts` — with an injected pool, `build()` resolves the project-scoped registry via `getForProject(projectPath)` and falls back to the global registry without one.

## 5. Integration test (backend-rpc-runtime harness, in-memory DB)

- [x] `support/shared-rpc-scenarios.ts` — added `runProjectScopedMcpDiscoveryScenario`: writes `.railyn/mcp.json` into the workspace config's project dir, then runs the standard discovery flow against it (real `ExecutionParamsBuilder.build()` → `getForProject(projectPath)` → executors).
- [x] `copilot-rpc-scenarios.test.ts` — "starts project-scoped MCP servers on first use (never idle)" with a pool factory returning a FRESH per-scope registry (boot never started it): `list_mcp_servers` reports `running`, `list_mcp_tools` lists `echo`, `invoke_mcp_tool` returns `echoed!`. This is the `grafana-mcpar` shape. (Note: the `mcp.getStatus` RPC is global-only, so the project-scoped path can only be observed through the task-execution harness, not an RPC.)
- [x] Playwright (`e2e/ui/mcp-tools.spec.ts`) intentionally **not** extended — it mocks the RPC backend and cannot exercise this bug.

## 6. Verification

- [x] `bunx tsc --noEmit` — clean.
- [x] `bun test src/bun --timeout 20000` — 2292 pass / 0 fail.
- [x] `bun test e2e/api --timeout 30000` — 39 pass / 0 fail.
- [x] Manual-equivalent: project-scoped server (grafana-mcpar-style) reaches `running`; `list_mcp_tools` / `invoke_mcp_tool` succeed — covered by the integration scenario in step 5.
