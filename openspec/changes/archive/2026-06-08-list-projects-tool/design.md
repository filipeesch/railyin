## Context

The AI model currently has no way to discover which projects exist in a workspace. The `list_tasks` tool accepts a `project_key` filter, but valid project keys are invisible to the model. The project-store already exposes `listProjectsForWorkspace(workspaceKey)` — a workspace-scoped project list — but this is only available to the frontend via the RPC layer (`projects.list`).

Common tools (decisions, todos, notes, cards, LSP) are shared across all engines via `COMMON_TOOL_DEFINITIONS` and `executeCommonTool`. Each tool group uses a consistent pattern: definition + handler + display label. Tool handlers receive data through `CommonToolContext.repos` — injected repository instances.

Two manual maintenance points exist:
- `COMMON_TOOL_NAMES` — manually lists every tool name, must stay in sync with `COMMON_TOOL_DEFINITIONS`
- `CHILD_COMMON_TOOL_NAMES` — manually lists 6 todo tool names allowed for child (subagent) sessions

## Goals / Non-Goals

**Goals:**
- AI model can call `list_projects` with no arguments and receive all projects in the current workspace
- Result includes all project fields: key, name, projectPath, gitRootPath, defaultBranch, slug, description
- Works across all engines (Pi, Copilot, Claude) via `COMMON_TOOL_DEFINITIONS`
- Display label shows "list projects" in UI
- Empty workspace returns a clear "no projects" message
- Inject `IProjectRepository` into `CommonToolContext.repos` for testability (DI pattern)
- Auto-derive `COMMON_TOOL_NAMES` from `COMMON_TOOL_DEFINITIONS` to eliminate manual name maintenance
- Auto-derive `CHILD_COMMON_TOOL_NAMES` via `childAllowed` flag on `AIToolDefinition`

**Non-Goals:**
- Project CRUD tools (register, update, delete) — those are UI-driven via `project-management`
- Cross-workspace project discovery — scoped to context workspace only
- Changes to the frontend or RPC layer

## Decisions

**1. Workspace-scoped via `listProjectsForWorkspace(ctx.workspaceKey)`**
- Chose `listProjectsForWorkspace(ctx.workspaceKey)` over `listProjects()` (all workspaces)
- Rationale: Matches task requirement, consistent with all other tool scoping, no cross-workspace data leakage

**2. Relative paths only in formatted text**
- `detailedContent` shows `projectPath.relative` and `gitRootPath.relative` only
- Full `Project` object (with absolute paths) still available in `data`
- Rationale: No host filesystem path leakage to the AI model; relative paths are sufficient for tool use

**3. Extract to `workspace-tool-definitions.ts`**
- Follows `card-tool-definitions.ts` pattern: definitions array + names set + display builder
- Rationale: Isolates workspace-level tools from the growing common-tools.ts file; consistent with existing extraction pattern

**4. Inject IProjectRepository into CommonToolContext.repos**
- Creates `IProjectRepository` interface with `listByWorkspace(workspaceKey): Project[]`
- `ConfigProjectRepository` wraps `listProjectsForWorkspace()` for production use
- Tests inject a mock `IProjectRepository` — no filesystem dependency
- Rationale: Consistent with DI pattern used by todos/decisions/notes; enables trivial mocking

**5. Auto-derive COMMON_TOOL_NAMES**
- Replace manual set with `new Set(COMMON_TOOL_DEFINITIONS.map(t => t.name))`
- Rationale: Eliminates duplication between definitions and names; one-line change, zero downside

**6. Auto-derive CHILD_COMMON_TOOL_NAMES via childAllowed flag**
- Add `childAllowed?: boolean` to `AIToolDefinition`
- Auto-derive: `COMMON_TOOL_DEFINITIONS.filter(t => t.childAllowed).map(t => t.name)`
- Mark 6 todo tools with `childAllowed: true`
- Rationale: Eliminates manual maintenance; self-documenting; prevents drift

## Risks / Trade-offs

- [Risk] `COMMON_TOOL_NAMES` auto-derivation changes the set membership — need to verify no tool is in `COMMON_TOOL_DEFINITIONS` but not in the manual names set. → Mitigation: Compare old vs new set before merging.
- [Risk] Adding `childAllowed` to `AIToolDefinition` touches every tool definition. → Mitigation: Optional field — existing tools default to `false` (not child-allowed). Only 6 tools need `true`.
- [Risk] Handler now depends on injected `repos.projects` instead of direct call. → Mitigation: Consistent with all other handlers; all production construction sites updated.

## Migration Plan

No migration needed. This is a pure addition — no existing behavior changes or data migrations. Rollback: revert the changed files and delete the new files.

## Open Questions

None — all decisions resolved.
