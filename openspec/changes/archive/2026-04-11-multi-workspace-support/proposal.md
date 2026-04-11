## Why

Railyin still treats workspace and project data as database records even though the product concept is stronger than that. A workspace is not a workflow bucket. It is an isolated operating context such as "Work Projects" or "Personal Projects", with its own engine, its own workflows, and its own project list.

That matters because the current storage model makes workspaces feel too much like rows in a shared app database. The desired model is filesystem-first: each workspace should live in its own folder under the user's home config directory, and that workspace file should be the source of truth for its projects. The app still needs workspace tabs, unread activity, and concurrent engines, but the storage boundary should reflect the product boundary.

## What Changes

- Add first-class multi-workspace support using file-backed workspace folders under `~/.railyin/workspaces/<workspace>/`.
- Store each workspace's engine config and project list in that workspace's `workspace.yaml`, and keep workflow templates in that workspace's local `workflows/*.yaml`.
- Remove workspace and project records as source-of-truth app data from SQLite; keep boards, tasks, executions, and messages DB-backed for now.
- Make the board header workspace-aware by showing workspaces as top tabs and scoping the existing board selector to the active workspace.
- Resolve execution engine and model context from the task's owning workspace so different workspaces can run different engines concurrently.
- Show unread activity on task cards for any unseen meaningful activity, aggregate that state into workspace-tab unread indicators, and show toasts for meaningful new activity.

## Capabilities

### Modified Capabilities
- `workspace`: multiple file-backed workspaces per installation, per-workspace config loading, workspace-local projects, and workspace-aware execution context
- `board`: workspace tabs, workspace-scoped board lists, task-card unread markers, and workspace unread aggregation
- `task`: unread activity tracking and task activity notifications
- `execution-engine`: engine resolution by task workspace instead of one global workspace singleton

## Impact

- Modified backend config loading and workspace/project resolution in `src/bun/config/index.ts`, workspace/board/project/task handlers, and orchestrator/engine resolution paths
- Modified frontend stores and board UI in `src/mainview/stores/*.ts`, `src/mainview/App.vue`, and `src/mainview/views/BoardView.vue`
- Modified RPC/domain types for file-backed workspace/project lists and task update metadata
- Added or updated tests for file-backed workspace loading, workspace-local workflows, workspace switching, task/workspace unread markers, and task-activity notification behavior
