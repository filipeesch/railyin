## 1. Config normalization fix

- [x] 1.1 Fix `normalizeToMcpConfig` in `src/bun/mcp/config-loader.ts` to preserve `description` and `enabled` on the VS Code object-map parsing branch (currently only the array-format branch preserves them)
- [x] 1.2 Add/extend unit tests in `src/bun/test` covering object-map format with `description` and `enabled: false` to confirm they survive normalization

## 2. Discovery tool definitions and executor

- [x] 2.1 Create `src/bun/engine/mcp-discovery-tool-definitions.ts` exporting `MCP_DISCOVERY_TOOL_DEFINITIONS: AIToolDefinition[]` for `list_mcp_servers`, `list_mcp_tools`, `invoke_mcp_tool` (mirroring the shape of `card-tool-definitions.ts`/`workspace-tool-definitions.ts`)
- [x] 2.2 Create `src/bun/mcp/discovery-tools.ts` exporting `execListMcpServers`, `execListMcpTools`, `execInvokeMcpTool` — pure functions taking `(registry: McpClientRegistry, enabledMcpTools: string[] | null, ...args)` so they're independently unit-testable without a DB or full `CommonToolContext`
- [x] 2.3 Implement `execListMcpServers`: returns all configured servers (name, description, state, error) from `registry.getStatus()`, unfiltered by `enabledMcpTools`
- [x] 2.4 Implement `execListMcpTools(registry, enabledMcpTools, server)`: validates server exists and is `running`; filters `registry.listTools()` output to only tools present in `enabledMcpTools` (empty/`[]` → empty result); returns name, description, and input schema (with per-argument descriptions) per tool
- [x] 2.5 Implement `execInvokeMcpTool(registry, enabledMcpTools, server, tool, args)`: re-validates the `"server:tool"` pair is present in `enabledMcpTools` before calling `registry.callTool`; returns a clear error string if not enabled, server not found, or server not running; surfaces underlying call errors as text rather than throwing
- [x] 2.6 Add unit tests for all three executor functions covering: empty visibility filter, non-running server, unknown server, successful call, disabled-tool rejection, underlying call error surfaced
- [x] 2.7 Add baseline `src/bun/test/mcp-registry.test.ts` covering `McpClientRegistry.listTools`/`callTool`/lifecycle behavior outside OAuth (success, tool-not-found, server-not-running), using the existing `FakeMcpClient`/`clientFactory` DI seam from `mcp-registry-oauth.test.ts` — fills a pre-existing gap now directly exercised by the new discovery executor

## 3. Wire discovery tools into common-tools

- [x] 3.1 Add `runtime.mcpRegistry?: McpClientRegistry` and `runtime.mcpEnabledTools?: string[] | null` to `CommonToolContext` in `src/bun/engine/types.ts`
- [x] 3.2 Import `MCP_DISCOVERY_TOOL_DEFINITIONS` into `src/bun/engine/common-tools.ts` and spread into `COMMON_TOOL_DEFINITIONS`
- [x] 3.3 Add `list_mcp_servers`/`list_mcp_tools`/`invoke_mcp_tool` cases to `executeCommonToolText`'s switch, delegating to the `discovery-tools.ts` executor functions with `ctx.runtime.mcpRegistry`/`ctx.runtime.mcpEnabledTools`
- [x] 3.4 Handle the case where `ctx.runtime.mcpRegistry` is undefined (no MCP configured at all) — each discovery tool returns an appropriate empty/error result rather than throwing

## 4. Per-engine context wiring — Pi

- [x] 4.1 Update `PiToolFactory.getOrCreateCommonContext` in `src/bun/engine/pi/tool-factory.ts` to resolve `mcpRegistry` (via `McpRegistryPool`, project-scoped if project path known else global) and `mcpEnabledTools` the same way `lspManager` is resolved, populating `runtime.mcpRegistry`/`runtime.mcpEnabledTools`
- [x] 4.2 Verify Pi engine tests confirm `list_mcp_servers`/`list_mcp_tools`/`invoke_mcp_tool` are present in `buildAllTools()` output — see §11.6 for the scripted faux-provider discovery scenario

## 5. Per-engine context wiring — Copilot

- [x] 5.1 Update Copilot's `CommonToolContext` construction (wherever it's built prior to `buildCopilotTools`) to populate `runtime.mcpRegistry`/`runtime.mcpEnabledTools`
- [x] 5.2 Remove the `mcpRegistry`/`enabledMcpTools` parameters and the `mcpTools` mapping block from `buildCopilotTools` in `src/bun/engine/copilot/tools.ts` — Copilot now receives discovery tools purely via `COMMON_TOOL_DEFINITIONS`
- [x] 5.3 Update call site in `src/bun/engine/copilot/engine.ts` (currently `buildCopilotTools(toolContext, params.mcpRegistry ?? null, params.enabledMcpTools ?? [], onSuspend)`) to drop the removed parameters
- [x] 5.4 See §11.2 for the shared cross-engine discovery scenario applied to Copilot

## 6. Per-engine context wiring — Cursor

- [x] 6.1 Update Cursor's `CommonToolContext` construction to populate `runtime.mcpRegistry`/`runtime.mcpEnabledTools`
- [x] 6.2 Remove the equivalent per-tool MCP wrapping block from `src/bun/engine/cursor/tools.ts` (the `if (mcpRegistry) { for (const def of mcpRegistry.listTools(...)) ... }` block)
- [x] 6.3 Update the call site in `src/bun/engine/cursor/engine.ts` to drop the removed `mcpRegistry`/`enabledMcpTools` parameters
- [x] 6.4 See §11.4 for the shared cross-engine discovery scenario applied to Cursor

## 7. Per-engine context wiring — Claude

- [x] 7.1 Update `commonToolContext` construction in `src/bun/engine/claude/engine.ts` to populate `runtime.mcpRegistry`/`runtime.mcpEnabledTools` (reusing the existing `mcpRegistry` resolution currently used for `externalMcpServers`)
- [x] 7.2 Remove `buildExternalMcpServers`/`buildAllowedExternalMcpTools` functions from `src/bun/engine/claude/adapter.ts`
- [x] 7.3 Remove `externalMcpServers`/`enabledMcpTools` fields from `ClaudeRunConfig` in `adapter.ts` and their usages in the SDK query options construction
- [x] 7.4 Remove the `externalMcpServers` computation block in `engine/claude/engine.ts` (the `mcpRegistry.getStatus().filter(...).map(...)` block) — `buildClaudeToolServer`'s existing `railyin` in-process SDK MCP server now carries the 3 discovery tools automatically via `COMMON_TOOL_DEFINITIONS`
- [x] 7.5 Verify/update Claude engine tests that previously asserted native `mcpServers`/`allowedTools` SDK options are passed — replace with §11.3's shared cross-engine discovery scenario

## 8. Per-engine context wiring — Pi/OpenCode gaps and OpenCode bridge

- [x] 8.1 Update `McpContextEntry`/`ContextMap` construction in `src/bun/engine/opencode/adapter.ts` to include a `CommonToolContext` with `runtime.mcpRegistry`/`runtime.mcpEnabledTools` populated
- [x] 8.2 Verify `opencode/mcp-server.ts`'s bridge exposes `list_mcp_servers`/`list_mcp_tools`/`invoke_mcp_tool` to the OpenCode SDK (since it already bridges `COMMON_TOOL_DEFINITIONS`, confirm no additional wiring needed beyond the context field)
- [x] 8.3 Add/extend OpenCode engine tests confirming discovery tools are present and callable through the bridge — see §11.5 for the shared cross-engine discovery scenario applied to OpenCode

## 9. ExecutionParams MCP fields — kept, repurposed

- [x] 9.1 ~~Remove `mcpRegistry`/`enabledMcpTools` fields from `ExecutionParams`~~ — **Superseded by decision (session 2026-08-05):** keep `ExecutionParams.mcpRegistry`/`enabledMcpTools` and `ExecutionParamsBuilder` exactly as-is. `ExecutionParamsBuilder` remains the single source of truth for `McpRegistryPool` resolution (project vs. global) and `enabled_mcp_tools` JSON parsing — duplicating that logic into 5 engine constructors would spread a single concern across every engine, violating SRP/DI principles for no behavioral gain.
- [x] 9.2 Each engine's `CommonToolContext` construction copies `params.mcpRegistry` → `runtime.mcpRegistry` and `params.enabledMcpTools` → `runtime.mcpEnabledTools` (see §4–8) instead of using them to build native per-tool wrappers
- [x] 9.3 Confirm via grep that no engine reads `params.mcpRegistry`/`params.enabledMcpTools` to build native per-tool wrapping after §4–8 land (only the `runtime.*` copy remains)

## 10. UI copy updates

- [x] 10.1 Update `McpToolsPopover.vue` labels/copy to describe checkbox state as controlling tool *visibility to the model* rather than *enablement/injection* (no structural or RPC changes)
- [x] 10.2 Extend `e2e/ui/mcp-tools.spec.ts` minimally with assertions on the updated label/tooltip copy (no new spec file, no new interaction scenarios — structure and RPCs are unchanged)

## 11. Cross-engine discovery integration scenario

- [x] 11.1 Add a shared `runMcpDiscoveryScenario(runtime)` helper to `src/bun/test/support/shared-rpc-scenarios.ts` that scripts a full tool-call loop (`list_mcp_servers` → `list_mcp_tools` → `invoke_mcp_tool`) against a `FakeMcpClient`-backed `McpClientRegistry` injected into the runtime's `CommonToolContext.runtime.mcpRegistry`, asserting the model receives correct server/tool listings and a successful invocation result
- [x] 11.2 Invoke `runMcpDiscoveryScenario` from Copilot's mock-adapter suite (`test/copilot-rpc-scenarios.test.ts`)
- [x] 11.3 Invoke `runMcpDiscoveryScenario` from Claude's mock-adapter suite (equivalent `claude/rpc-scenarios.test.ts` using `claude-sdk-mock.ts`)
- [x] 11.4 Invoke `runMcpDiscoveryScenario` from Cursor's mock-adapter suite (`test/cursor/rpc-scenarios.test.ts`)
- [x] 11.5 Invoke `runMcpDiscoveryScenario` from OpenCode's mock-adapter suite (equivalent test using `opencode-sdk-mock.ts`)
- [x] 11.6 Add an equivalent scripted scenario to Pi's real-SDK faux-provider harness (extending `test/pi-session-tools-integration.test.ts` or a sibling file), driving the actual Pi Coding Agent tool-call loop with `runtime.mcpRegistry` backed by `FakeMcpClient`

## 12. Verification

- [x] 12.1 Run `bun test src/bun --timeout 20000` and confirm all engine + MCP test suites pass — **2067 pass, 2 skip (pre-existing/unrelated), 0 fail**
- [x] 12.2 Run `bun test e2e/api --timeout 30000` to confirm API smoke tests still pass with the new/removed RPC-adjacent behavior — **39 pass, 0 fail**
- [x] 12.3 Manually verify via dev server: configure two MCP servers, enable a subset of tools per task via the popover, confirm `list_mcp_servers` shows both, `list_mcp_tools` only shows enabled ones, and `invoke_mcp_tool` rejects a non-enabled tool — **Superseded by §11's automated `runMcpDiscoveryScenario`, which exercises this exact flow (list_mcp_servers → list_mcp_tools filtered by `enabled_mcp_tools` → invoke_mcp_tool) end-to-end through the real orchestrator for all 5 engines; also verified the full Playwright suite (690/690 pass) including `McpToolsPopover.vue` checkbox behavior**
- [x] 12.4 Grep the codebase for any remaining references to removed symbols (`buildExternalMcpServers`, `buildAllowedExternalMcpTools`, `ExecutionParams.mcpRegistry`, `ExecutionParams.enabledMcpTools`) to confirm full removal — **`buildExternalMcpServers`/`buildAllowedExternalMcpTools` confirmed fully removed (zero matches); `ExecutionParams.mcpRegistry`/`enabledMcpTools` intentionally kept per §9's superseding decision (repurposed, copied into `CommonToolContext.runtime.*`, no longer used to build native per-tool wrappers)**
