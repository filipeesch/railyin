## Context

Railyin is a task/agent management system with three AI engines (native, Copilot, Claude). Each engine resolves a set of tools per workflow column. Today all tools are built-in and hardcoded. Users cannot extend agents without modifying the application.

MCP (Model Context Protocol) is an open standard for exposing tools to AI agents, adopted by VS Code, GitHub Copilot, Claude Desktop, and others. Supporting MCP lets users plug in any MCP-compatible server — filesystem, GitHub, databases, custom scripts — using a config format they already know.

**Current tool flow (native engine):**
`workflow column config` → `resolveToolsForColumn()` → `TOOL_DEFINITIONS[]` → `executeTool()` switch

**Current tool flow (Copilot engine):**
`buildCopilotTools()` → fixed COMMON_TOOL_DEFINITIONS only

**Current tool flow (Claude engine):**
Claude Agent SDK with `mcpServers` param → already speaks MCP natively

The `LSPServerManager` / `LSPClient` pair in `src/bun/lsp/` is the direct structural precedent for the MCP registry.

## Goals / Non-Goals

**Goals:**
- Users configure MCP servers in `.railyin/mcp.json` (per-project) or `~/.railyin/mcp.json` (global)
- All three engines can use MCP tools; Claude gets native pass-through, others get a bridge
- MCP tools auto-inject into agents; users can disable specific tools per-task via chat UI
- Server status (running / error) is visible in the UI with per-server reload
- Editing `mcp.json` from the UI reloads the registry immediately; a reload button covers external changes
- `McpClientRegistry` shuts down cleanly on process exit via existing global shutdown sequence
- `FileEditorOverlay.vue` replaces duplicated Monaco editor code in `WorkflowEditorOverlay.vue`

**Non-Goals:**
- SSE transport (deprecated in MCP spec; can be added later)
- MCP sampling / resource endpoints (tools-only for now)
- Per-column MCP tool assignment (column `tools` config controls built-ins; MCP tools follow task-level selection)
- Authentication flows beyond static headers and env vars

## Decisions

### D1: `McpClientRegistry` as workspace-scoped singleton

**Decision:** One registry per loaded workspace, created at workspace init, shut down with the process.

**Rationale:** MCP stdio servers are subprocesses — cold-starting them per-execution (as LSP currently does) adds 1–5s latency on every agent run. A long-lived singleton eliminates this. Workspace-scoped (not global) because different workspaces may have different project paths and thus different `.railyin/mcp.json` files.

**Alternative considered:** Per-execution (matches current LSP pattern) — rejected because stdio processes have significant startup cost and MCP servers are stateless tools, unlike LSP which tracks file state.

### D2: Config file `.railyin/mcp.json` (not `workspace.yaml`)

**Decision:** Dedicated config file per project root, with global `~/.railyin/mcp.json` as fallback. Load order: global → project (project keys override global). Format matches VS Code's MCP config schema.

**Rationale:** MCP servers are project-specific (e.g., a filesystem server scoped to the repo). `workspace.yaml` is workspace-scoped (one per Railyin workspace, potentially covering multiple projects). Separating concerns allows `.railyin/mcp.json` to be committed to the repo for team sharing or gitignored for personal tools.

**Alternative considered:** `workspace.yaml mcp:` block — rejected because project-level MCP servers don't belong in workspace config.

### D3: Claude engine uses native MCP pass-through

**Decision:** Claude engine receives configured MCP servers directly as `mcpServers` in the SDK call, bypassing the `McpClientRegistry` bridge.

**Rationale:** Claude Agent SDK already manages MCP connections natively. Bridging would create a double-hop (registry → SDK's own MCP client), losing streaming, error recovery, and native tool display. Native pass-through is zero-latency and correct-by-default.

**Implication:** For Claude, tool filtering (enabled_mcp_tools) must be applied at config construction time, not at dispatch time.

### D4: MCP tool naming — namespaced as `mcp__<server>__<tool>`

**Decision:** MCP tools are exposed to models with the name `mcp__<server>__<tool>` (double underscore, matching Claude's MCP naming convention).

**Rationale:** Prevents collision with built-in tools. If an MCP server exposes `read_file`, it becomes `mcp__filesystem__read_file`, distinct from the built-in `read_file`. Consistent with how Claude SDK already names MCP tools.

### D5: MCP tools auto-inject; per-task opt-out stored in DB

**Decision:** All running MCP tools are included in `resolveToolsForColumn()` output by default. Tasks store an `enabled_mcp_tools TEXT` column (JSON array of `"server:tool"` strings, or `NULL` for all enabled). When a column explicitly defines its `tools`, `enabled_mcp_tools` is reset to `NULL` on transition.

**Rationale:** Zero-friction onboarding — configure a server, tools appear. Per-task override gives users control when needed. Column-defined tools signal intentional scoping, so resetting is the right default.

### D6: `FileEditorOverlay.vue` as generic Monaco editor component

**Decision:** Extract a generic `FileEditorOverlay.vue` that accepts `title`, `content`, `language`, `onSave`, and refactor `WorkflowEditorOverlay.vue` to use it internally.

**Rationale:** `WorkflowEditorOverlay.vue` already implements the full Monaco lifecycle (loader, dark mode, validation, save/cancel). The MCP config editor needs identical infrastructure. Extracting avoids duplication and benefits the workflow editor too.

### D7: No file watcher — reload button + save-triggered reload

**Decision:** No `fs.watch` on `mcp.json`. Instead: (a) saving via the UI triggers immediate reload, (b) a reload button in the popover handles external edits.

**Rationale:** File watchers add complexity and cross-platform fragility. The two trigger points cover all practical cases without the overhead.

## Risks / Trade-offs

- **stdio subprocess crashes mid-execution** → Server transitions to `error` state. The engine receives a tool error result and the model can retry or report. The reload button restarts the process.
- **HTTP server unreachable** → Same error state treatment. Timeout is configurable.
- **MCP server slow to initialize** → First tool call on a newly started server may have latency. Acceptable since servers are long-lived and start once.
- **Claude engine MCP tool filtering** → For native pass-through, disabled tools must be excluded from the `mcpServers` config before passing to the SDK, not at dispatch time. This requires `enabled_mcp_tools` to be resolved before calling the SDK, adding coupling between DB state and engine invocation.
- **`WorkflowEditorOverlay` refactor** → Existing component has test coverage in UI tests. Refactoring must not break existing YAML editing.

## Migration Plan

1. DB migration adds `enabled_mcp_tools TEXT NULL DEFAULT NULL` to `tasks` — safe, nullable, no data loss
2. `McpClientRegistry` is initialized only when `mcp.json` exists — no config = no change in behavior
3. `FileEditorOverlay` refactor is internal; `WorkflowEditorOverlay` props/events unchanged
4. No breaking changes to `workspace.yaml` format

## Open Questions

- Should `enabled_mcp_tools` be surfaced in the task RPC types (`Task` interface in `rpc-types.ts`) for the UI, or kept as a separate `mcp.getTaskTools` RPC call?
- Should the `McpToolsPopover` show built-in tools (read, write, shell groups) as read-only for visibility, or only show MCP tools?
