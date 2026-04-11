## 1. File-backed workspace and project storage

- [x] 1.1 Define the workspace folder layout under `~/.railyin/workspaces/<workspace>/`, with `workspace.yaml` as the source of truth for workspace metadata, engine config, and project list
- [x] 1.2 Stop using SQLite `workspaces` and `projects` rows as source-of-truth storage; load workspace and project data from files instead
- [x] 1.3 Introduce stable file-backed identifiers such as `workspace key` and `project key`, and thread those identities through handlers and runtime lookups
- [x] 1.4 Keep workflow YAML files local to each workspace under `~/.railyin/workspaces/<workspace>/workflows/`

## 2. DB/runtime boundary cleanup

- [x] 2.1 Keep boards, tasks, executions, and messages in SQLite, but update them to resolve workspace/project ownership through file-backed identities instead of DB workspace/project rows
- [x] 2.2 Update orchestrator and engine resolution paths so each execution resolves config and engine from `task -> board -> workspace key`
- [x] 2.3 Make engine/provider caches workspace-aware so concurrent executions in different workspaces do not share incompatible config
- [x] 2.4 Ensure task update payloads or client-side lookup paths expose enough workspace context to classify activity, set task-card unread state, aggregate workspace unread state, and drive notifications

## 3. Frontend workspace navigation and activity signals

- [x] 3.1 Expand the workspace and task stores to load file-backed workspace/project data, track the active workspace, track unread activity per task, and derive unread state per workspace
- [x] 3.2 Update board loading and selection so the board selector only shows boards from the active workspace while preserving the current board UX within that workspace
- [x] 3.3 Keep workspace tabs above the board controls, with a blue unread indicator on tabs whose workspaces contain unread tasks
- [x] 3.4 Keep task-activity toasts in `App.vue`/stores using state diffing against prior task snapshots, mark cards unread on meaningful unseen activity, and clear unread when a task is opened

## 4. Migration during apply work

- [x] 4.1 During apply, create workspace folders/files from existing DB-backed workspace/project records without adding startup migration logic to the app
- [x] 4.2 During apply, migrate board/task references onto the new workspace/project identities needed by the file-backed model
- [x] 4.3 Do not add standalone migration scripts; keep the transition work inside the implementation change itself

## 5. Validation

- [x] 5.1 Add backend tests for file-backed workspace/project loading, workspace-local workflow resolution, and workspace-specific engine resolution
- [x] 5.2 Add frontend or UI tests for workspace tab switching, task-card unread markers, workspace unread aggregation, and task-activity notification toasts
- [x] 5.3 Confirm concurrent executions can run in different workspaces without config leakage or task update routing errors
