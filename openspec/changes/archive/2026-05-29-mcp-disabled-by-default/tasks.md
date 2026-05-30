## 1. Database Migration

- [x] 1.1 Create migration `044_mcp_disabled_by_default.ts` that converts all `NULL` values in `tasks.enabled_mcp_tools` and `chat_sessions.enabled_mcp_tools` to `'[]'`
- [x] 1.2 Update task and session creation paths to default `enabled_mcp_tools` to `'[]'` instead of `NULL`

## 2. Config Loader Module

- [x] 2.1 Create `src/bun/mcp/config-loader.ts` exporting `normalizeToMcpConfig(raw)` and `loadMcpConfigFile(path)`
- [x] 2.2 Remove the duplicate `normalizeToMcpConfig` from `src/bun/index.ts` and replace with import from `config-loader.ts`
- [x] 2.3 Remove the duplicate `normalizeToMcpConfig` from `src/bun/handlers/mcp.ts` and replace with import from `config-loader.ts`

## 3. McpRegistryPool

- [x] 3.1 Create `src/bun/mcp/registry-pool.ts` with `McpRegistryPool` class: `getGlobalRegistry()`, `getForProject(projectPath)`, `invalidate(projectPath)`, and `shutdown()` methods; accept a factory `(config: McpConfig) => McpClientRegistry` in constructor (default: `(c) => new McpClientRegistry(c)`)
- [x] 3.2 Implement lazy initialization in `getRegistry` — on first call for a project path, check for `<projectPath>/.railyn/mcp.json`; if present, init a new registry from it; otherwise fall back to global
- [x] 3.3 Replace `initMcpRegistry` / `getMcpRegistry` usages in `src/bun/index.ts` with construction and injection of `McpRegistryPool`
- [x] 3.4 Export `McpRegistryPool` type from `src/bun/mcp/index.ts` (or equivalent barrel)

## 4. ExecutionParams + Builders

- [x] 4.1 Add `mcpRegistry: McpClientRegistry | null` field to `ExecutionParams` in `src/bun/engine/types.ts`
- [x] 4.2 Update `execution-params-builder.ts` `build()` method to receive `McpRegistryPool` and resolve `mcpRegistry` via `pool.getRegistry(projectPath)`
- [x] 4.3 Update `execution-params-builder.ts` `buildForChat()` method to call `pool.getRegistry()` (global) for sessions
- [x] 4.4 Update call sites (orchestrator, coordinator) that construct `ExecutionParams` to pass the pool

## 5. Engine Executor Updates

- [x] 5.1 Update Claude engine / executor to read `params.mcpRegistry` instead of calling `getMcpRegistry()`
- [x] 5.2 Update Copilot engine / executor to read `params.mcpRegistry` instead of calling `getMcpRegistry()`
- [x] 5.3 Update native tool dispatch in any executor that dispatches `mcp__<server>__<tool>` calls to use the injected registry
- [x] 5.4 Remove all remaining `getMcpRegistry()` call sites from execution code

## 6. RPC: Project Config Handlers

- [x] 6.1 Add `mcp.getProjectConfig` and `mcp.saveProjectConfig` method signatures to `src/shared/rpc-types.ts`
- [x] 6.2 Update `mcpHandlers` factory signature to `mcpHandlers(db, { registryPool, resolveProject })` for DI
- [x] 6.3 Implement `mcp.getProjectConfig` handler in `src/bun/handlers/mcp.ts`: resolve `projectPath` from workspace+project key, read `<projectPath>/.railyn/mcp.json`, return path + content (default `{}` if absent)
- [x] 6.4 Implement `mcp.saveProjectConfig` handler: validate JSON, create `.railyn/` dir if needed, write file, call `pool.invalidate(projectPath)` so the next execution reloads the updated config

## 7. Frontend: McpToolsPopover

- [x] 7.1 Fix `isToolEnabled` logic: `null` and `[]` both return `false` (tools disabled by default)
- [x] 7.2 Remove "collapse to null when all enabled" optimization — always persist the array
- [x] 7.3 Add "Edit project mcp.json" button to popover footer (calls `mcp.getProjectConfig` + opens `FileEditorOverlay`; save calls `mcp.saveProjectConfig`)
- [x] 7.4 Rename existing edit button to "Edit global mcp.json" (calls existing `mcp.getConfig` / `mcp.saveConfig`)
- [x] 7.5 Conditionally hide the "Edit project mcp.json" button when `projectKey` prop is absent/null

## 8. Frontend: ConversationInput + TaskChatView

- [x] 8.1 Add `projectKey` prop to `ConversationInput.vue`
- [x] 8.2 Pass `projectKey` from `ConversationInput` down to `McpToolsPopover`
- [x] 8.3 Update `TaskChatView.vue` to pass `task.project_key` into `ConversationInput` as the `projectKey` prop
- [x] 8.4 Verify `SessionChatView.vue` does not pass `projectKey` (so project button remains hidden in session context)
