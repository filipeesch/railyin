## Why

AI agents executing in chat sessions (and tasks) have no way to discover what projects and workflows are available in their current workspace. Unlike the frontend, which calls `projects.list` and `boards.list` RPC endpoints, agents can only use tools — and there is no tool for workspace discovery. This blocks agents from making informed decisions about which project to work on or which workflow/board to use.

## What Changes

- **New `list_projects` tool**: Returns all configured projects in the current workspace with full data (key, name, project_path, git_root_path, default_branch, slug, description).
- **New `list_workflows` tool**: Returns all boards (runtime workflow instances) in the current workspace with minimal data (id, name). Boards are used as "workflows" from the agent's perspective — they are the active workflow instances tied to the workspace.
- Both tools use the workspace context already available in chat session and task execution — no additional parameters needed.

## Capabilities

### New Capabilities
- `workspace-discovery`: AI tools that return workspace projects and board/workflow information from the current workspace context.

### Modified Capabilities
<!-- No existing capability specs are modified — this introduces new tools without changing existing behavior. -->

## Why

AI agents executing in chat sessions (and tasks) have no way to discover what projects and workflows are available in their current workspace. Unlike the frontend, which calls `projects.list` and `boards.list` RPC endpoints, agents can only use tools — and there is no tool for workspace discovery. This blocks agents from making informed decisions about which project to work on or which workflow/board to use.

## What Changes

- **New `list_projects` tool**: Returns all configured projects in the current workspace with full data (key, name, project_path, git_root_path, default_branch, slug, description).
- **New `list_workflows` tool**: Returns all boards (runtime workflow instances) in the current workspace with minimal data (id, name). Boards are used as "workflows" from the agent's perspective — they are the active workflow instances tied to the workspace.
- Both tools use the workspace context already available in chat session and task execution — no additional parameters needed.
- **Refactor**: Extract board query logic from `boards.list` RPC handler into a reusable `listBoardsByWorkspace()` function. This enables testability of both the tool and the RPC handler without loading workflow templates.

## Capabilities

### New Capabilities
- `workspace-discovery`: AI tools that return workspace projects and board/workflow information from the current workspace context.

### Modified Capabilities
<!-- No existing capability specs are modified — this introduces new tools without changing existing behavior. -->

## Impact

- `src/bun/engine/workspace-tool-definitions.ts` — **new** file with shared tool definitions for `list_projects` and `list_workflows`
- `src/bun/engine/common-tools.ts` — imports new definitions, adds tool registration, execution logic, and display builder
- `src/bun/engine/types.ts` — ensures `ExecutionParams.workspaceKey` is properly typed for chat sessions
- `src/bun/engine/execution/execution-params-builder.ts` — threads `workspaceKey` through `buildForChat()` (currently missing)
- `src/bun/engine/execution/chat-executor.ts` — passes `workspaceKey` to `buildForChat()`
- `src/bun/handlers/boards.ts` — extract board query into reusable function (refactoring, zero behavioral change)


- `src/bun/engine/workspace-tool-definitions.ts` — **new** file with shared tool definitions for `list_projects` and `list_workflows`
- `src/bun/engine/common-tools.ts` — imports new definitions, adds tool registration, execution logic, and display builder
- `src/bun/engine/types.ts` — ensures `ExecutionParams.workspaceKey` is properly typed for chat sessions
- `src/bun/engine/execution/execution-params-builder.ts` — threads `workspaceKey` through `buildForChat()` (currently missing)
- `src/bun/engine/execution/chat-executor.ts` — passes `workspaceKey` to `buildForChat()`
