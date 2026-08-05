## Context

MCP tool exposure today is fragmented across engines:

- **Copilot** (`engine/copilot/tools.ts`) and **Cursor** (`engine/cursor/tools.ts`): each running MCP tool from `McpClientRegistry.listTools()` is wrapped 1:1 as a native SDK tool named `mcp__<server>__<tool>`. Every enabled tool on every running server becomes its own entry in the model's tool list.
- **Claude** (`engine/claude/engine.ts` + `engine/claude/adapter.ts`): the Claude Agent SDK is handed raw `McpServerConfig` transport configs directly (`mcpServers` param) and manages its own MCP subprocess/HTTP connections and tool listing internally, with `allowedTools` (built by `buildAllowedExternalMcpTools`) used to gate by `enabled_mcp_tools`. Our `McpClientRegistry` is not used for the actual protocol traffic in this path — only as a source of server configs read once at execution start.
- **Pi** (`engine/pi/tool-factory.ts`, `engine/pi/tools/index.ts`): does not read `ExecutionParams.mcpRegistry`/`enabledMcpTools` at all. MCP is entirely unavailable in Pi today.
- **OpenCode** (`engine/opencode/adapter.ts`, `mcp-server.ts`): only bridges Railyin's own common tools to the model via an in-process MCP server; external `mcp.json` servers are never forwarded.

All four engines that *do* wire common tools (Copilot, Cursor, Claude via `buildClaudeToolServer`, Pi via `buildCommonTools`) already share a single source of truth: `COMMON_TOOL_DEFINITIONS` + `executeCommonTool()` in `engine/common-tools.ts`, dispatched through a per-conversation `CommonToolContext`. This is the existing extension point used for board, decision, note, and todo tools — LSP tools also follow this pattern via a dedicated `lsp-tool-definitions.ts` + execution functions imported into `common-tools.ts`.

Per-task/session gating exists today via `tasks.enabled_mcp_tools` / `chat_sessions.enabled_mcp_tools` (JSON array of `"server:tool"` pairs; `[]` = none, added/flipped to default-`[]` in the `2026-05-29-mcp-disabled-by-default` change specifically to reduce tool-list noise). `McpToolsPopover.vue` renders a per-server/per-tool checkbox tree backed by `mcp.setTaskTools`/`mcp.setSessionTools`.

`McpRegistryPool` already resolves the correct `McpClientRegistry` per project/global scope and is injected into `ExecutionParamsBuilder`, which threads `mcpRegistry`/`enabledMcpTools` onto `ExecutionParams` today. This pool and registry infrastructure is unchanged by this proposal — only *how the model is given access to it* changes.

## Goals / Non-Goals

**Goals:**
- Replace all native per-tool MCP injection (Copilot, Cursor, Claude SDK passthrough) with 3 common discovery/invocation tools: `list_mcp_servers`, `list_mcp_tools`, `invoke_mcp_tool`.
- Make MCP tool access available identically across every engine (Copilot, Cursor, Claude, Pi, OpenCode) via the same common-tools mechanism, eliminating engine-specific MCP wiring.
- Keep the existing `enabled_mcp_tools` storage/schema and default (`[]`) unchanged, repurposing it as a visibility filter on the new discovery tools rather than a native-injection gate.
- Fix `normalizeToMcpConfig`'s object-map branch to preserve `description`/`enabled` so `list_mcp_servers` reliably surfaces descriptions regardless of `mcp.json` shape.
- Remove now-dead code: Copilot/Cursor per-tool wrapping, Claude's `buildExternalMcpServers`/`buildAllowedExternalMcpTools` and related `ClaudeRunConfig` fields, `ExecutionParams.mcpRegistry`/`enabledMcpTools`.

**Non-Goals:**
- No changes to `McpClientRegistry`, `McpRegistryPool`, server lifecycle state machine, OAuth flow, or config file loading location/merge rules (`mcp-client-registry`, `mcp-registry-pool`, `mcp-oauth` specs are untouched).
- No changes to the `mcp.*` RPC surface (`mcp.getStatus`, `mcp.reload`, `mcp.authorize`, `mcp.getConfig`/`saveConfig`, `mcp.getProjectConfig`/`saveProjectConfig`, `mcp.setTaskTools`/`setSessionTools`) — all continue to work exactly as today.
- No DB migration — `enabled_mcp_tools` schema, type, and default (`'[]'`) are unchanged.
- No restructuring of `McpToolsPopover.vue` — only label/copy updates to reflect the new "visibility" framing; the checkbox tree, RPC calls, and persisted shape stay the same.
- No change to server-level `enabled: false` semantics in `mcp.json` (`McpServerConfig.enabled`) — already defaults to `true`, satisfying "all MCP tools enabled by default" at the config layer.

## Decisions

### D1 — Three tools, one shared implementation, wired through `COMMON_TOOL_DEFINITIONS`

New module `src/bun/engine/mcp-discovery-tool-definitions.ts` exports `MCP_DISCOVERY_TOOL_DEFINITIONS: AIToolDefinition[]` (mirrors `card-tool-definitions.ts`, `workspace-tool-definitions.ts`). A new `src/bun/mcp/discovery-tools.ts` exports the executor functions (`execListMcpServers`, `execListMcpTools`, `execInvokeMcpTool`) since they need direct `McpClientRegistry` access — kept out of `engine/` to avoid circular imports back into `mcp/` and to mirror the existing `mcp/` module boundary. `common-tools.ts` imports both and spreads the definitions into `COMMON_TOOL_DEFINITIONS`, adding 3 new `case` branches in `executeCommonToolText`'s switch (same pattern as LSP tools). This keeps `common-tools.ts` a thin aggregator rather than growing its own MCP-specific logic inline.

**Alternative considered**: Inline everything into `common-tools.ts`. Rejected — that file is already ~700 lines covering board/decision/note/todo concerns; adding MCP registry logic further erodes single-responsibility and was explicitly rejected during exploration.

### D2 — `CommonToolContext.runtime.mcpRegistry` as the injection point

`CommonToolContext.runtime` (currently `{ lspManager?, worktreePath? }` in `engine/types.ts`) gains `mcpRegistry?: McpClientRegistry`. Each engine's context-construction code resolves it once per conversation/task — exactly how `runtime.lspManager` is resolved today — from `McpRegistryPool` (project registry if a project path is known, else global). Concretely:
- **Pi**: `PiToolFactory.getOrCreateCommonContext` resolves `mcpRegistry` the same call site it resolves `lspManager`.
- **Copilot/Cursor/Claude**: wherever each engine currently builds its `CommonToolContext` (Claude: inline in `claude/engine.ts`'s `commonToolContext:` object; Copilot/Cursor: their tool-context builders), add `runtime: { ..., mcpRegistry }`.
- **OpenCode**: `opencode/mcp-server.ts`'s `ContextMap`/`McpContextEntry` carries per-conversation context already (see D5) — extend it to carry `mcpRegistry` too, or resolve it via the same `CommonToolContext` passed through.

**Alternative considered**: Pass the whole `McpRegistryPool` + project path into `CommonToolContext` and resolve lazily per tool call. Rejected — duplicates resolution logic already correctly centralized in `ExecutionParamsBuilder`/engine setup, and adds a resolution step to every tool call for no behavioral benefit (registries are effectively static for the lifetime of a conversation).

### D3 — `enabled_mcp_tools` becomes a visibility filter, not an injection gate

Schema, RPC methods, default value (`'[]'`), and UI persistence are all unchanged. Semantics shift: `execListMcpTools` and `execInvokeMcpTool` read the task/session's `enabled_mcp_tools` array (same JSON parsing logic currently in `ExecutionParamsBuilder`) and:
- `list_mcp_tools(server)`: only returns tools where `"<server>:<tool>"` is present in the array (empty array ⇒ empty result for every server).
- `invoke_mcp_tool(server, tool, args)`: re-checks the same filter before calling `McpClientRegistry.callTool`; rejects with an explicit error (e.g. `Tool "X" on server "Y" is not enabled for this task. Ask the user to enable it via the MCP tools panel.`) if not present — defense-in-depth so a model can't invoke a tool it was never shown.
- `list_mcp_servers` is **not** filtered by `enabled_mcp_tools` (server-level visibility is independent of per-tool visibility) — it reflects the `mcp.json` `enabled` flag and live lifecycle state only.

This requires this filter-check logic to be resolved from the task/session context available to `CommonToolContext` — `ctx.task.id`/`ctx.task.conversationId` are already present; the executor needs read access to `tasks.enabled_mcp_tools`/`chat_sessions.enabled_mcp_tools`. Since `CommonToolContext` has no DB access today (repos are passed explicitly), the discovery tool executor takes an injected accessor function resolved once per context construction (e.g. `runtime.mcpEnabledTools: string[] | null`, computed by each engine the same way `enabledMcpTools` is computed today in `ExecutionParamsBuilder`) rather than querying the DB itself — keeping the executor DB-agnostic and testable with plain arrays.

**Alternative considered**: Store `McpRegistryPool` + a DB handle in context and look up `enabled_mcp_tools` live on every call. Rejected — the value doesn't change mid-conversation in practice (task edits happen between executions), and keeping the executor free of DB dependencies makes it trivially unit-testable.

### D4 — Claude engine drops native SDK MCP passthrough entirely

Remove `buildExternalMcpServers`/`buildAllowedExternalMcpTools` from `claude/adapter.ts`, and the `externalMcpServers`/`enabledMcpTools` fields from `ClaudeRunConfig`. Claude's `commonToolContext` (already passed to `buildClaudeToolServer`, which registers `COMMON_TOOL_DEFINITIONS` as SDK tools via `createSdkMcpServer`) automatically picks up the 3 new discovery tools once D1/D2 land — no Claude-specific new code needed beyond wiring `runtime.mcpRegistry` into the context construction in `claude/engine.ts`.

**Alternative considered**: Leave Claude's native passthrough as an intentional exception (SDK-native MCP handling is arguably "more correct" for that SDK). Rejected per explicit product decision — consistency across all engines was prioritized, and the SDK's OAuth/reconnect handling for MCP is already fully duplicated by our own `McpClientRegistry`, so there's no unique capability lost.

### D5 — OpenCode gains MCP via its existing in-process bridge

`opencode/mcp-server.ts` already runs a small in-process MCP server (`startOpenCodeMcpServer`) that exposes Railyin's common tools to the OpenCode SDK over HTTP (`/mcp`), keyed by conversation via `ContextMap`/`McpContextEntry`. Since discovery tools are added to `COMMON_TOOL_DEFINITIONS`, they are automatically exposed through this bridge once `McpContextEntry` carries a `CommonToolContext` with `runtime.mcpRegistry` populated — the same context-construction change as every other engine, applied in `opencode/adapter.ts` where `McpContextEntry` is built.

### D6 — Fix `normalizeToMcpConfig` object-map branch

`config-loader.ts`'s VS Code object-map parsing path (`{"servers": {"name": {...}}}`) currently builds `{ name, transport }` only, dropping `description` and `enabled` even though `McpServerConfig` supports both and the array-format branch passes them through untouched (it returns `p.servers` as-is). Fix: extract `description: e.description as string | undefined` and `enabled: e.enabled as boolean | undefined` into the returned object, matching the array-format behavior. This is a pre-existing bug, surfaced because `list_mcp_servers` needs `description` to be reliable regardless of config authoring style.

### D7 — Removal of `ExecutionParams.mcpRegistry`/`enabledMcpTools`

Once no engine reads these fields directly (all consumption moves to `CommonToolContext.runtime`), remove them from `ExecutionParams` (`engine/types.ts`) and from `ExecutionParamsBuilder`'s `build`/`buildForChat` methods. `McpRegistryPool` resolution moves into each engine's `CommonToolContext` construction path instead of `ExecutionParamsBuilder`. `ExecutionParamsBuilder` keeps its `McpRegistryPool` constructor dependency only if an engine still needs it there for context construction — otherwise the pool is threaded directly to engine constructors (mirroring how `taskLspRegistry` is a module-level singleton accessed directly rather than threaded through `ExecutionParams`).

## Risks / Trade-offs

- **[Risk] Losing Claude SDK's native MCP reconnect/OAuth handling** → Mitigation: our own `McpClientRegistry` already fully implements connection lifecycle, OAuth (PKCE/DCR), and reconnect (`reload`) — Claude simply becomes another consumer of that existing, tested infrastructure instead of a special case.
- **[Risk] Two-level enablement (server `enabled` + per-task `enabled_mcp_tools`) may confuse users** → Mitigation: `list_mcp_servers` surfaces server state regardless of the per-task filter, so the model can explain "server X is configured but you haven't enabled any of its tools for this task" — existing popover UI already exposes both levels today, just relabeled.
- **[Risk] Model must now make 2-3 tool calls (list servers → list tools → invoke) instead of 1, adding latency/turns for simple MCP tasks** → Mitigation: this is the explicit trade-off requested (avoiding permanent tool-list bloat/cache invalidation) over per-call latency; acceptable since MCP usage is occasional, not every-turn.
- **[Risk] Removing `ExecutionParams.mcpRegistry` touches every engine's execution wiring simultaneously** → Mitigation: changes are mechanical and identical in shape per engine (add `runtime.mcpRegistry` to context construction, delete old field reads) — low logic risk, verify via existing engine test suites per engine after each file change.
- **[Trade-off] `invoke_mcp_tool` argument schema can't be statically validated by the model's tool-calling layer** (unlike native per-tool JSON schemas) — the model must call `list_mcp_tools` first to learn the schema, then self-validate arguments before invoking. Accepted as inherent to the discovery pattern; `invoke_mcp_tool`'s own executor still validates required args from the tool's `inputSchema` before dispatching, returning a clear error otherwise.

## Migration Plan

1. Land `mcp-discovery-tool-definitions.ts` + `discovery-tools.ts` + `CommonToolContext.runtime.mcpRegistry` field additively (no removals yet) — new tools appear in `COMMON_TOOL_DEFINITIONS`, automatically available to Pi/Copilot/Cursor/Claude/OpenCode.
2. Wire `runtime.mcpRegistry` (and `runtime.mcpEnabledTools`) into each engine's context construction, one engine at a time, verifying existing engine test suites pass.
3. Remove native per-tool injection code per engine (Copilot `tools.ts`, Cursor `tools.ts`, Claude `adapter.ts`/`engine.ts`) once the discovery tools are confirmed working for that engine.
4. Remove `ExecutionParams.mcpRegistry`/`enabledMcpTools` and related `ExecutionParamsBuilder` logic once no engine reads them.
5. Fix `normalizeToMcpConfig` object-map branch (independent, can land any time).
6. Update `McpToolsPopover.vue` copy/labels to describe "visibility" instead of "enablement for injection" (cosmetic, no structural change).

No feature flag / rollback plan needed beyond standard git revert — this is a pre-release internal tool with no external API compatibility contract to preserve mid-migration.

## Testing Strategy

All test seams needed already exist in the codebase — no test-only production code changes are required:

- **Executor unit tests**: `execListMcpServers`/`execListMcpTools`/`execInvokeMcpTool` in `discovery-tools.ts` are designed as pure functions (D3) taking a registry + a plain `enabledMcpTools` array, so they're directly unit-testable with the existing `FakeMcpClient`/injectable `clientFactory` DI seam already established in `mcp-registry-oauth.test.ts` — no new mocking mechanism needed.
- **Baseline registry coverage**: a pre-existing gap (no dedicated test for `McpClientRegistry.listTools`/`callTool`/lifecycle outside OAuth scenarios) is filled as part of this change, since the discovery executor now depends on this surface directly.
- **Cross-engine integration coverage**: every engine (Copilot, Claude, Cursor, OpenCode) already has a full mock-SDK-driven integration harness that exercises the real orchestrator + tool-execution loop against an in-memory DB (`test/copilot-rpc-scenarios.test.ts`, `test/cursor/rpc-scenarios.test.ts`, and Claude/OpenCode equivalents, all built on shared scenario helpers in `test/support/shared-rpc-scenarios.ts`). A new shared `runMcpDiscoveryScenario` helper is added there and run identically across all four, plus an equivalent scripted addition to Pi's real-SDK faux-provider harness (`test/pi-session-tools-integration.test.ts`) — this is the strongest signal that per-engine wiring (`runtime.mcpRegistry` population, tool registration) actually works end-to-end, and is the direct replacement for the per-engine "native MCP tool" tests being removed.
- **Config loader fix**: `normalizeToMcpConfig`'s object-map branch fix (D6) is covered by extending existing config-loader unit tests with `description`/`enabled` assertions in object-map format.
- **UI**: the popover change is a pure copy/label relabeling (no structural or RPC change), so `e2e/ui/mcp-tools.spec.ts` is extended minimally with label/tooltip assertions rather than gaining new scenarios.

## Open Questions

None outstanding — all material decisions were resolved during exploration (see decision records #1798–#1809, plus the test-strategy decisions recorded in the follow-up exploration round).
