## Why

The AI model has no tool to discover which projects exist in a workspace. `list_tasks` has a `project_key` filter, but the model can't discover valid project keys. This blocks the model from filtering tasks by project, creating tasks in the right project, or understanding workspace structure.

## What Changes

- Add `list_projects` as a new common tool available to all AI engines (Pi, Copilot, Claude)
- Scopes results to the current workspace (`ctx.workspaceKey`) — no cross-workspace leakage
- Returns all project fields: key, name, projectPath, gitRootPath, defaultBranch, slug, description
- Extracts tool definition into a new `workspace-tool-definitions.ts` module (following the `card-tool-definitions.ts` pattern)
- Injects `IProjectRepository` into `CommonToolContext.repos` for testability (consistent with todos/decisions/notes DI pattern)
- Auto-derives `COMMON_TOOL_NAMES` from `COMMON_TOOL_DEFINITIONS` to eliminate manual name maintenance
- Adds `childAllowed?: boolean` to `AIToolDefinition` to auto-derive `CHILD_COMMON_TOOL_NAMES` in Pi engine

## Capabilities

### New Capabilities
- `list-projects`: AI-facing tool that returns all projects in the current workspace, scoped by `ctx.workspaceKey`. Returns project key, name, path, git repository, default branch, slug, and description. Returns a clear "no projects" message when the workspace has none configured.

### Modified Capabilities
- `engine-common-tools`: Adds `list_projects` to the `COMMON_TOOL_DEFINITIONS` array and `executeCommonToolText` handler, making the tool available across all engines. Injects `IProjectRepository` into `CommonToolContext.repos`. Auto-derives `COMMON_TOOL_NAMES` from definitions. Adds `childAllowed` flag to `AIToolDefinition` for auto-deriving `CHILD_COMMON_TOOL_NAMES`.

## Impact

- `src/bun/engine/workspace-tool-definitions.ts` — new file with tool definition, names set, and display builder
- `src/bun/db/project-repository.ts` — new file with `IProjectRepository` interface and `ConfigProjectRepository` implementation
- `src/bun/engine/common-tools.ts` — imports workspace tools, adds `list_projects` handler, auto-derives `COMMON_TOOL_NAMES`
- `src/bun/engine/types.ts` — adds `projects: IProjectRepository` to `CommonToolContext.repos`
- `src/bun/ai/types.ts` — adds `childAllowed?: boolean` to `AIToolDefinition`
- `src/bun/engine/pi/tools/index.ts` — auto-derives `CHILD_COMMON_TOOL_NAMES` from `childAllowed` flag
- `src/bun/engine/pi/engine.ts` — injects `ConfigProjectRepository` into `CommonToolContext`
- `src/bun/engine/opencode/engine.ts` — injects `ConfigProjectRepository` into `CommonToolContext`
- No changes to `project-store.ts` — `ConfigProjectRepository` wraps existing `listProjectsForWorkspace()`
- No frontend changes — this is an AI model-only tool
- No breaking changes to existing APIs or tool contracts
