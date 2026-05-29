## Context

MCP (Model Context Protocol) tools are currently opt-out: a `NULL` value in `enabled_mcp_tools` means "all tools are active." Every new task and session gets all configured MCP tools by default, which creates noise and unexpected tool availability. There is no way to edit MCP configs from within the UI. The registry is a single global singleton, making it impossible to support per-project server configurations.

**Current architecture summary:**
- `getMcpRegistry()` returns one `McpClientRegistry` loaded from `~/.railyn/mcp.json` at boot.
- `enabled_mcp_tools = NULL` in the DB → all tools enabled; `[]` → none; `[...]` → subset.
- `ExecutionParams` receives `enabledMcpTools: string[] | null` where `null` is the "all" sentinel.
- `normalizeToMcpConfig` is duplicated in `src/bun/index.ts` and `src/bun/handlers/mcp.ts`.

## Goals / Non-Goals

**Goals:**
- Flip MCP tools to opt-in: all new tasks/sessions start with zero active tools.
- Support a project-level MCP config (`<projectPath>/.railyn/mcp.json`) that overrides the global one.
- Introduce `McpRegistryPool` so each project gets its own lazily-initialized registry.
- Surface two edit buttons in the MCP tools popover: one for global config, one for project config.
- Remove duplicated config normalization logic via a shared `config-loader.ts`.
- Inject the resolved `McpClientRegistry` into `ExecutionParams` rather than calling a module-level global inside executors.

**Non-Goals:**
- Merging global and project configs (project replaces global entirely).
- Per-server-level overrides (not supported in this change).
- UI for viewing MCP tool usage history or audit logs.
- Changes to the Claude SDK pass-through's `mcpServers` wiring (it already reads from the resolved registry via `ExecutionParams`).

## Decisions

### Decision: Project config overrides global (no merge)
When `<projectPath>/.railyn/mcp.json` exists, it fully replaces `~/.railyn/mcp.json` for that project's executions. Reason: merging creates unpredictable server collisions; the project author owns the full server list.

### Decision: McpRegistryPool as a central DI-injectable service
Replace the module-level `McpClientRegistry` singleton with a `McpRegistryPool` class that:
- Holds a `"global"` registry key for the global config.
- Holds one registry per absolute `projectPath` for project-scoped configs.
- Lazily initializes per-project registries on first use.
- Is constructed in `src/bun/index.ts` and injected into the app context (via the existing pattern used for repos, config, etc.).
- Exposes `getGlobalRegistry()` and `getForProject(projectPath: string)` as the public API.
- Accepts a factory function `(config: McpConfig) => McpClientRegistry` in its constructor for testability — production default is `(c) => new McpClientRegistry(c)`.
- `invalidate(projectPath)` method clears the cached instance for a path so the next execution picks up a fresh config after `saveProjectConfig`.

**Alternative considered:** keeping the singleton and switching configs at call time — rejected because it would create race conditions during concurrent executions for different projects.

### Decision: DB migration converts NULL → [] (one-time, no rollback)
Migration `044` converts all `NULL` values in `tasks.enabled_mcp_tools` and `chat_sessions.enabled_mcp_tools` to `'[]'`. After migration, `NULL` is treated identically to `[]` in code (no special-casing), but the migration ensures a clean break for existing rows. Rollback: not needed — `[]` is logically equivalent to the intended new behavior (tools disabled), and the old behavior (NULL = all enabled) is being removed by design.

### Decision: mcpHandlers receives DI params for testability
`mcpHandlers(db)` becomes `mcpHandlers(db, { registryPool, resolveProject })` where:
- `registryPool: McpRegistryPool` — used for project config save/reload (invalidate + reload).
- `resolveProject: (workspaceKey: string, projectKey: string) => { projectPath: string }` — resolves project path from the workspace config. In production: delegates to `getLoadedProjectByKey`. In tests: stub function, no real config needed.

This is a clean SOLID extension — no test-only code paths, pure DI.

### Decision: ExecutionParams carries the resolved McpClientRegistry
`ExecutionParams` gains an `mcpRegistry: McpClientRegistry | null` field. The `execution-params-builder` calls `pool.getRegistry(projectPath)` (or `pool.getGlobalRegistry()` for sessions) to populate it before building params. Executors (Claude, Copilot) use `params.mcpRegistry` — no more `getMcpRegistry()` calls inside execution code.

### Decision: config-loader.ts as the single normalization point
Extract `normalizeToMcpConfig(raw)` and add `loadMcpConfigFile(path)` to `src/bun/mcp/config-loader.ts`. Both `index.ts` (boot) and `handlers/mcp.ts` (RPC save/reload) import from there. No behavior change — purely a cleanup.

### Decision: isToolEnabled semantics correction
In `McpToolsPopover.vue`, the current guard `if (enabledTools === null) return true` becomes `return false` (disabled by default). The "collapse to null when all enabled" optimization is removed — the array is always the source of truth.

## Risks / Trade-offs

- **[Risk] Existing tasks lose MCP access after migration** → Expected and intentional. Users must re-enable tools per task. Document in release notes.
- **[Risk] Lazy project registry init adds latency to first execution** → Mitigation: init is async and fast (ms-level MCP handshake); acceptable for the use case.
- **[Risk] Project path resolution requires project_key → LoadedProject lookup** → Already resolved in `chat-executor.ts` which queries `t.project_key`. The params builder receives the resolved `projectPath` string.
- **[Risk] Session chat has no project scope** → Handled: `buildForChat` uses the global registry; project edit button is conditionally hidden via `projectKey` prop.

## Migration Plan

1. Run DB migration `044` (NULL → []) — safe to run against existing data.
2. Deploy backend with `McpRegistryPool`, new RPC handlers, updated `ExecutionParams`.
3. Deploy frontend with updated popover (two edit buttons, corrected `isToolEnabled`).
4. No feature flag needed — the semantic change is the entire point of the release.

## Open Questions

- None. All decisions resolved during exploration phase.
