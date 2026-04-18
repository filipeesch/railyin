## 1. MCP Config & Types

- [x] 1.1 Create `src/bun/mcp/types.ts` — `McpServerConfig` (stdio + HTTP variants), `McpToolDef`, `ServerState` type
- [x] 1.2 Add `mcp.json` loading to `src/bun/config/index.ts` — `loadMcpConfig(projectPath)` merges `~/.railyin/mcp.json` + `<project>/.railyin/mcp.json` with env var interpolation
- [x] 1.3 Add RPC type definitions for `mcp.*` methods to `src/shared/rpc-types.ts`

## 2. MCP Client (transport layer)

- [x] 2.1 Create `src/bun/mcp/client.ts` — `McpClient` base class with `initialize()`, `listTools()`, `callTool()`, `close()` 
- [x] 2.2 Implement `StdioMcpClient` — spawns subprocess via `Bun.spawn`, reads JSON-RPC over stdout, writes to stdin
- [x] 2.3 Implement `HttpMcpClient` — sends JSON-RPC via `fetch` POST with configurable headers
- [x] 2.4 Implement MCP initialize handshake (send `initialize` → receive result → send `initialized` notification) in both client types

## 3. McpClientRegistry

- [x] 3.1 Create `src/bun/mcp/registry.ts` — `McpClientRegistry` class with server state map, `startAll()`, `shutdown()`, `listTools()`, `callTool(server, tool, args)`, `reload(serverName?)`
- [x] 3.2 Implement server state machine: `idle → starting → running → error` with tool list caching
- [x] 3.3 Add `getMcpRegistry(workspaceKey?)` singleton accessor (mirrors `getLspManager` pattern)
- [x] 3.4 Hook `McpClientRegistry.shutdown()` into global shutdown sequence in `src/bun/index.ts` (after `killAllPtySessions`)

## 4. DB Migration

- [x] 4.1 Add migration to `src/bun/db/migrations.ts` — `ALTER TABLE tasks ADD COLUMN enabled_mcp_tools TEXT` (nullable, default NULL)
- [x] 4.2 Update `TaskRow` type in `src/bun/db/row-types.ts` and `mapTask` mapper in `src/bun/db/mappers.ts`

## 5. Tool Injection — Native Engine

- [x] 5.1 Update `resolveToolsForColumn` in `src/bun/workflow/tools.ts` to accept optional `McpClientRegistry` and append namespaced `mcp__<server>__<tool>` definitions
- [x] 5.2 Update `getToolDescriptionBlock` to include MCP tool descriptions
- [x] 5.3 Update `executeTool` in `src/bun/workflow/tools.ts` — add `mcp__` prefix dispatch to `McpClientRegistry.callTool`
- [x] 5.4 Update `runExecution` in `src/bun/workflow/engine.ts` to pass the registry to `resolveToolsForColumn` and filter by `task.enabled_mcp_tools`
- [x] 5.5 Update column transition logic in `handleTransition` to reset `enabled_mcp_tools = NULL` when column has explicit `tools` config

## 6. Tool Injection — Copilot Engine

- [x] 6.1 Update `buildCopilotTools` in `src/bun/engine/copilot/tools.ts` to include MCP tool wrappers from registry

## 7. Tool Injection — Claude Engine

- [x] 7.1 Update Claude engine adapter in `src/bun/engine/claude/adapter.ts` to pass configured (and filtered by `enabled_mcp_tools`) MCP servers as `mcpServers` to the SDK

## 8. RPC Handlers

- [x] 8.1 Create `src/bun/handlers/mcp.ts` with handlers: `mcp.getStatus`, `mcp.reload`, `mcp.getConfig`, `mcp.saveConfig`, `mcp.setTaskTools`
- [x] 8.2 Register new handlers in `src/bun/index.ts` RPC router

## 9. UI — FileEditorOverlay

- [x] 9.1 Create `src/mainview/components/FileEditorOverlay.vue` — generic Monaco overlay with props `title`, `content`, `language`, `onSave`; includes JSON/YAML validation indicator and dark mode support
- [x] 9.2 Refactor `WorkflowEditorOverlay.vue` to use `FileEditorOverlay` internally (preserve all existing props/events)

## 10. UI — McpToolsPopover

- [x] 10.1 Create `src/mainview/components/McpToolsPopover.vue` — PrimeVue `Popover`-based balloon with per-server tree (checkboxes via PrimeVue `Checkbox`, status indicators, per-server reload button)
- [x] 10.2 Wire tool checkbox changes to `mcp.setTaskTools` RPC call
- [x] 10.3 Wire "Edit mcp.json" button to open `FileEditorOverlay` with `mcp.getConfig` content; on save call `mcp.saveConfig`
- [x] 10.4 Wire per-server reload button to `mcp.reload` RPC call
- [x] 10.5 Add icon-only tools button to `task-detail__model-row` in `TaskDetailDrawer.vue` — show active/warning indicator based on `mcp.getStatus`; hide when no MCP servers configured
