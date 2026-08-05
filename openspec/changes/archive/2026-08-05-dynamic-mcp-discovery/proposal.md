## Why

Every engine (Copilot, Cursor, Claude via the SDK's native `mcpServers`) currently injects **every enabled MCP tool as its own native tool definition** in the model's tool list. As the number of configured MCP servers/tools grows this bloats the tool list, defeats provider-side prompt/tool caching, and gives the model no way to reason about what's available before committing to a call. Pi and OpenCode don't wire external MCP tools in at all today, so MCP is engine-inconsistent. We want a single, discovery-based mechanism — three generic common tools (list servers, list a server's tools, invoke a tool) — used identically by every engine, replacing all native per-tool injection.

## What Changes

- **BREAKING**: Remove native per-tool MCP injection everywhere it exists today:
  - Copilot (`engine/copilot/tools.ts`) — drop `mcpRegistry.listTools().map(...)` wrapping.
  - Cursor (`engine/cursor/tools.ts`) — drop the equivalent per-tool wrapping.
  - Claude (`engine/claude/adapter.ts`, `engine/claude/engine.ts`) — stop passing `mcpServers`/`allowedTools` to the Claude Agent SDK; remove `buildExternalMcpServers`/`buildAllowedExternalMcpTools` and the `externalMcpServers`/`enabledMcpTools` plumbing on `ClaudeRunConfig`.
- Add 3 new common tools, available identically across **all** engines (Copilot, Cursor, Claude, Pi, OpenCode) via the existing `COMMON_TOOL_DEFINITIONS`/`executeCommonTool` mechanism:
  - `list_mcp_servers` — lists every configured MCP server (respecting the server-level `enabled` config flag) with its lifecycle state (`running`/`error`/`auth_required`/`idle`/`disabled`), error message if any, and `description`.
  - `list_mcp_tools(server)` — lists all tools for a given running server: name, description, and argument schema (with per-argument descriptions).
  - `invoke_mcp_tool(server, tool, arguments)` — invokes a specific tool on a specific server and returns its result.
- Pi and OpenCode gain MCP tool access for the first time, via the same 3 common tools (no engine-specific MCP code needed).
- `CommonToolContext` gains a new `runtime.mcpRegistry?: McpClientRegistry` field, populated per-engine the same way `runtime.lspManager` is populated today (resolved once per conversation/task).
- The per-task/session `enabled_mcp_tools` allow-list (`"server:tool"` pairs, edited via `McpToolsPopover.vue`) is **kept as-is** in storage and schema, but its meaning changes: it now filters which tools `list_mcp_tools`/`invoke_mcp_tool` reveal and allow, rather than gating native tool injection. Default remains `[]` (nothing visible) — no DB migration needed.
- Fix a pre-existing bug in `normalizeToMcpConfig`'s VS Code object-map branch: it silently drops `description` and `enabled` fields when a server is declared using the `{"servers": {"name": {...}}}` object-map shape (only the array shape preserves them today). This is required for `list_mcp_servers` to reliably surface `description` regardless of config shape.

## Capabilities

### New Capabilities
- `mcp-tool-discovery`: Defines the three discovery/invocation common tools (`list_mcp_servers`, `list_mcp_tools`, `invoke_mcp_tool`), their behavior, argument schemas, and how the per-task `enabled_mcp_tools` visibility filter applies to them.

### Modified Capabilities
- `mcp-tool-injection`: Native per-tool MCP injection (`resolveToolsForColumn` MCP appending, native engine `executeTool` MCP dispatch, Copilot `buildCopilotTools` MCP wrapping, Claude native `mcpServers` pass-through) is removed/superseded by `mcp-tool-discovery`. The per-task `enabled_mcp_tools` override requirement is retained but its purpose is redefined as a visibility filter for the new discovery tools rather than a native-injection gate.
- `mcp-config`: `normalizeToMcpConfig` fixed to preserve `description` and `enabled` for servers declared via the VS Code object-map config shape (previously only the array shape preserved them).
- `mcp-ui`: `McpToolsPopover.vue` checkbox semantics are relabeled (not restructured) — checking a tool now controls its visibility to the model via the discovery tools rather than whether it's injected as a native tool.

## Impact

- **Backend**: `src/bun/engine/common-tools.ts` (wire in new tool defs), new `src/bun/engine/mcp-discovery-tool-definitions.ts` and `src/bun/mcp/discovery-tools.ts` (executor), `src/bun/engine/types.ts` (`CommonToolContext.runtime.mcpRegistry`), `src/bun/engine/copilot/tools.ts`, `src/bun/engine/cursor/tools.ts`, `src/bun/engine/claude/adapter.ts`, `src/bun/engine/claude/engine.ts`, `src/bun/engine/pi/tool-factory.ts`, `src/bun/engine/opencode/adapter.ts` / `mcp-server.ts`, `src/bun/mcp/config-loader.ts`.
- **Shared types**: `src/shared/rpc-types.ts` — no new RPC methods expected; existing `mcp.*` RPCs untouched.
- **Frontend**: `McpToolsPopover.vue` — copy/labels only, no structural change.
- **No DB migration**: `enabled_mcp_tools` schema and default (`[]`) are unchanged.
- **Dead code removed**: `ExecutionParams.mcpRegistry`/`enabledMcpTools` fields (replaced by `CommonToolContext.runtime.mcpRegistry` + direct lookup of the task's filter in the discovery tool executor), `buildExternalMcpServers`/`buildAllowedExternalMcpTools` in `claude/adapter.ts`.
