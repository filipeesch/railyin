## Why

MCP tools are currently injected into every task and chat session automatically — users must manually disable them each time. This creates noise, unexpected tool availability, and potential security surface. MCP tools should be opt-in per task, and users need UI access to edit both global and project-level MCP configs from within the chat window.

## What Changes

- **BREAKING**: All existing `enabled_mcp_tools = NULL` rows in `tasks` and `chat_sessions` are migrated to `[]` (all disabled). After migration, `NULL` has no special meaning — the explicit empty array `[]` is the new "all disabled" default.
- New tasks and chat sessions default to `enabled_mcp_tools = []` (no MCP tools active).
- MCP config loading is extended to support a project-level config file at `<projectPath>/.railyn/mcp.json`. When present, it replaces the global config for that project's tasks. When absent, the global `~/.railyn/mcp.json` is used.
- The `McpClientRegistry` singleton is replaced with a `McpRegistryPool` that lazily manages one registry per project path plus the global registry.
- The MCP tools popover gains a second "Edit project mcp.json" button (visible in task chat only), alongside the existing "Edit global mcp.json" button.
- The `isToolEnabled(null)` logic in the popover is corrected: `null` and `[]` both mean no tools enabled (previously `null` meant all enabled).
- Shared `normalizeToMcpConfig` logic is extracted from `index.ts` and `handlers/mcp.ts` into `mcp/config-loader.ts`.

## Capabilities

### New Capabilities

- `mcp-registry-pool`: Lazy pool that manages per-project and global `McpClientRegistry` instances, resolving the correct registry at execution time based on the task's project path.
- `mcp-project-config-rpc`: Two new RPC methods — `mcp.getProjectConfig` and `mcp.saveProjectConfig` — that read and write `<projectPath>/.railyn/mcp.json`.

### Modified Capabilities

- `mcp-config`: Config loading changes — project-level file at `<projectPath>/.railyn/mcp.json` replaces (not merges with) global when present. Config normalization extracted to shared loader.
- `mcp-tool-injection`: Default behavior flips — `NULL` and `[]` both result in no tools injected. Per-task and per-session defaults change from `NULL` to `[]`.
- `mcp-ui`: MCP tools popover footer gains two edit buttons (global and project). Project button is hidden in session chat context. `isToolEnabled` logic corrected for new `[]` default.
- `mcp-client-registry`: Registry lifetime and lookup changes — global singleton replaced by pool; registry is resolved per-execution rather than fetched from module-level global.

## Impact

- **DB**: New migration `044_mcp_disabled_by_default.ts` — converts all NULL `enabled_mcp_tools` to `[]`.
- **Backend**: `src/bun/mcp/registry.ts`, `src/bun/mcp/config-loader.ts` (new), `src/bun/handlers/mcp.ts`, `src/bun/engine/types.ts`, all executor classes in `src/bun/engine/execution/`, `src/bun/engine/claude/engine.ts`, `src/bun/engine/copilot/engine.ts`, `src/bun/index.ts`.
- **Shared types**: `src/shared/rpc-types.ts` — two new RPC method signatures.
- **Frontend**: `McpToolsPopover.vue`, `ConversationInput.vue`, `TaskChatView.vue`.
- **No change** to the Claude SDK adapter's `buildExternalMcpServers` / `buildAllowedExternalMcpTools` logic — those operate on the resolved registry the same way.
