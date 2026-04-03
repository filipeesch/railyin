## Why

The workflow engine can currently only read the worktree—it has no write tools, no search, and no way to delegate subtasks. This makes autonomous coding impossible: an agent can plan but never act, never verify, and never break large tasks into parallel workstreams.

## What Changes

- Add a **write tool group**: `write_file`, `replace_in_file`, `delete_file`, `rename_file`
- Add a **search tool group**: `search_text`, `find_files`
- Rename the `human` tool group to **`interactions`**
- Add a **`spawn_agent` tool** (agents group): spawns parallel in-memory sub-executions that share the parent worktree; results returned as strings to the parent
- Add **tool group expansion** in `resolveToolsForColumn`: column `tools` config can reference group names (`read`, `write`, `shell`, `interactions`, `agents`) or individual tool names—both resolve to `AIToolDefinition[]`
- Add **built-in tool groups** defined in workflow config (hardcoded defaults, no YAML override needed for v1)
- Update the delivery workflow YAML with groups and `in_progress` column using write tools + agents

## Capabilities

### New Capabilities

- `write-tools`: File mutation tools—create, overwrite, surgical replace, delete, rename—with worktree path safety (no traversal)
- `search-tools`: Worktree-scoped text search (`grep`-based) and file discovery by glob pattern
- `spawn-agent`: In-memory parallel sub-agent execution—parent spawns N child runs with scoped tool sets, waits for all, receives array of result strings

### Modified Capabilities

- `workflow-engine`: Tool resolution now supports group names alongside individual tool names; `resolveToolsForColumn` expands groups before returning definitions

## Impact

- `src/bun/workflow/tools.ts`: new tool definitions + executor cases + group expansion logic
- `src/bun/workflow/engine.ts`: intercept `spawn_agent` calls → fan-out to parallel `runExecution`-like mini-runs → collect results
- `config/workflows/delivery.yaml`: update `tools` arrays to use group names; enable write + agents on `in_progress`
- `openspec/specs/workflow-engine/spec.md`: update tool resolution requirements
