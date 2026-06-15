## Context

AI agents execute in two contexts: task executions (tied to a board/task) and chat sessions (workspace-scoped). In both cases, agents use tools to interact with the system. The existing tool set includes MCP tools, LSP tools, card tools, decision tools, note/TODO tools, and file tools — but no tool for discovering workspace projects or boards (runtime workflows).

The backend already exposes `projects.list` (YAML config) and `boards.list` (SQLite) as RPC endpoints for the frontend. These are NOT callable by agents during tool loops. Agents need equivalent functionality as tools.

The `ExecutionParams` type already carries a `workspaceKey` field, but it is only set for task executions — chat sessions compute it but do not thread it through `buildForChat()`.

## Goals / Non-Goals

**Goals:**
- Agent-facing `list_projects` tool: returns all projects for the current workspace with full data (key, name, project_path, git_root_path, default_branch, slug, description)
- Agent-facing `list_workflows` tool: returns all boards (runtime workflow instances) for the current workspace with minimal data (id, name)
- Both tools use workspace context from execution — no parameters needed
- Follow established patterns: consolidated definitions file, shared with common-tools.ts

**Non-Goals:**
- New RPC endpoints (frontend already has `projects.list` and `boards.list`)
- New DB migrations (uses existing `boards` table and YAML config)
- Workflow template listing (separate RPC: `workflow.list`)
- Test changes (handled separately)
- Board filtering by project (future enhancement)

## Decisions

### 1. Two separate tools instead of one
```
list_projects    → { key, name, projectPath, gitRootPath, defaultBranch, slug?, description? }[]
list_workflows   → { id, name, workspaceKey }[]
```
**Why:** Follows existing RPC precedent (`projects.list` + `workflow.list` are separate). Gives agent granular control — it may only need projects, or only workflows. Easier to extend independently.

### 2. Tool definitions file pattern (like `card-tool-definitions.ts`)
Create `src/bun/engine/workspace-tool-definitions.ts` exporting `WORKSPACE_TOOL_DEFINITIONS` and `WORKSPACE_TOOL_NAMES`, imported by `common-tools.ts`.
**Why:** Eliminates drift risk. The card tool pattern proved successful — one source of truth for both engine-facing registration and workflow column resolution.

### 3. `list_workflows` queries boards table via extracted function
Extract `listBoardsByWorkspace(db, workspaceKey)` from `src/bun/handlers/boards.ts` — a pure function that queries the `boards` table and returns `[{ id, name, workspace_key }]`. The `boards.list` RPC handler uses this function for its board data, then enriches with templates. The `list_workflows` tool uses the same function directly.

**Why:** The `boards.list` RPC handler loads full workflow templates per board (expensive, unnecessary for agent discovery). Extracting the query into a reusable function eliminates duplication and makes both the tool and RPC handler testable with a simple in-memory DB query. Zero behavioral change to existing RPC.
```sql
SELECT id, name, workspace_key FROM boards WHERE workspace_key = ?
```
**Why:** The `boards.list` RPC handler loads full workflow templates per board (expensive, unnecessary for agent discovery). A direct SQL query returns just what the agent needs. The term "workflows" in the tool name maps to "boards" in the DB — boards ARE the active workflow instances.

### 4. Thread `workspaceKey` through `buildForChat()`
Currently `ChatExecutor` has `workspaceKey` but `ExecutionParamsBuilder.buildForChat()` does not accept it, so `ExecutionParams.workspaceKey` is never set for chat sessions.
**Why:** Fixes a gap that affects any future tool needing workspace context from chat. Minimal change — one extra parameter threaded through the call chain.

### 5. No new RPC endpoint
**Why:** The frontend already has `projects.list` (from `project-store.ts`) and `boards.list` (from `boards.ts`). If the UI later needs combined workspace data, it can compose these endpoints. Keep scope tight.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Tool returns stale data if workspace.yaml changes between config loads | Config is reloaded on `patchWorkspaceYaml()` via `resetConfig()` — same behavior as existing RPC handlers |
| `list_workflows` returns empty in workspaces with no boards | Expected behavior — agent gets `[]` and can proceed with project-only context |
| Thread `workspaceKey` in `buildForChat()` is a small but non-zero risk of breaking chat execution | `workspaceKey` is already computed in `ChatExecutor` and passed as a parameter — just not forwarded to `buildForChat()`. No logic change, only data threading |

## Migration Plan

No migration needed. This is a pure code addition:
1. New file: `workspace-tool-definitions.ts`
2. Modifications: existing files import and use new definitions
3. Zero breaking changes — all additions are opt-in tool registrations

## Open Questions

None. All decisions captured above.
