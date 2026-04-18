## Why

Railyin agents are limited to the built-in tool set. Users want to extend agents with external capabilities — file systems, GitHub, databases, APIs — through the Model Context Protocol (MCP), the same way VS Code and GitHub Copilot support it today.

## What Changes

- Add `.railyin/mcp.json` config file (per-project, with global `~/.railyin/mcp.json` fallback) to declare MCP servers
- Add `McpClientRegistry` — a workspace-scoped registry that connects to and manages MCP server processes (stdio) and HTTP endpoints, with lifecycle mirroring `LSPServerManager`
- Auto-inject MCP tool definitions into all engines (native, Copilot, Claude); Claude engine uses native MCP pass-through via SDK `mcpServers`
- Per-task tool override: tasks store an `enabled_mcp_tools` JSON column; MCP tool selection persists per task and resets when a column explicitly defines its tools
- Add `FileEditorOverlay.vue` — a generic Monaco-based file editor overlay (JSON/YAML/TS with syntax highlighting), replacing the duplicated editor code in `WorkflowEditorOverlay.vue`
- Add `McpToolsPopover.vue` — an icon-only button in the chat drawer toolbar that opens a balloon with a tree/checkbox list of built-in + MCP tools, server status indicators, reload and edit config actions
- Plug `McpClientRegistry.shutdown()` into the existing global shutdown sequence in `index.ts`

## Capabilities

### New Capabilities

- `mcp-config`: Schema and loading for `.railyin/mcp.json` (stdio + HTTP servers, env var interpolation, global + project merge)
- `mcp-client-registry`: Lifecycle management of MCP server connections — connect, list tools, call tools, reload, shutdown; state machine per server (idle → starting → running → error)
- `mcp-tool-injection`: How MCP tools flow into each engine — native (`executeTool` dispatch), Copilot (tool wrappers), Claude (SDK `mcpServers` pass-through); auto-inject with per-task opt-out
- `mcp-ui`: Chat drawer tool icon, `McpToolsPopover` (tree + checkboxes + server status + reload + edit), `FileEditorOverlay` generic component

### Modified Capabilities

- `engine-common-tools`: `resolveToolsForColumn` extended to append MCP tool definitions; `executeTool` extended with fallthrough to `McpClientRegistry`

## Impact

- **New files**: `src/bun/mcp/registry.ts`, `src/bun/mcp/client.ts`, `src/bun/mcp/types.ts`, `src/bun/handlers/mcp.ts`, `src/mainview/components/McpToolsPopover.vue`, `src/mainview/components/FileEditorOverlay.vue`
- **Modified files**: `src/bun/workflow/tools.ts`, `src/bun/engine/copilot/tools.ts`, `src/bun/engine/claude/adapter.ts`, `src/bun/index.ts`, `src/bun/config/index.ts` (new `WorkspaceYaml` types optional), `src/mainview/components/TaskDetailDrawer.vue`, `src/mainview/components/WorkflowEditorOverlay.vue` (refactor to use `FileEditorOverlay`)
- **DB migration**: new `enabled_mcp_tools TEXT` column on `tasks` table
- **New dependencies**: none (MCP JSON-RPC over stdio/HTTP implemented natively using Bun's `Bun.spawn` and `fetch`)
- **RPC surface**: new `mcp.*` handlers (`getStatus`, `reload`, `getConfig`, `saveConfig`, `setTaskTools`)
