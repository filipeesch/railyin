## Context

Shell command approval is currently controlled per-task via the `shell_auto_approve` boolean on the `tasks` table (migration 007). A toggle in `TaskChatView` calls `tasks.setShellAutoApprove` to flip it. The default value at task creation time is `0` (off), hardcoded in the INSERT statement regardless of workspace config.

The workspace config (`workspace.yaml`) already supports execution defaults such as `default_model`. The `WorkspaceYaml` interface, `WorkspaceConfig` RPC type, `workspace.getConfig`, and `workspace.update` handlers follow a consistent pattern: YAML field → TypeScript interface → RPC type → handler → frontend store → `SetupView.vue` form.

## Goals / Non-Goals

**Goals:**
- Add `shell_auto_approve` to `WorkspaceYaml` and expose it through the workspace config API.
- Seed `tasks.shell_auto_approve` from the workspace setting when a task is created.
- Surface the toggle in the Workspace settings tab of `SetupView.vue`.

**Non-Goals:**
- Backfilling existing tasks — only newly created tasks are affected.
- Making the workspace setting a live override that forces auto-approve on running tasks.
- Any changes to the per-task toggle behavior or the approval gate logic.

## Decisions

### Decision: Creation-time seed only (not a live override)

The workspace `shell_auto_approve` value is read once at `tasks.create` time and written into `tasks.shell_auto_approve`. After that, the task's value is fully independent. This mirrors how `default_model` works.

**Alternatives considered:**
- *Live override at execution time*: The orchestrator could OR the workspace and task values. Rejected — it would break the task-level toggle contract and require the engine to resolve two sources of truth.

### Decision: Persist in workspace.yaml, not the DB

The setting is workspace-level configuration, not runtime state. All other workspace settings (`default_model`, `worktree_base_path`, etc.) live in `workspace.yaml` and are patched via `patchWorkspaceYaml`. We follow the same pattern.

**Alternatives considered:**
- *Add a column to the `workspaces` DB table*: Rejected — workspace config is file-backed by design; the `workspaces` table is not the authoritative source of truth per the `workspace` spec.

### Decision: No visual distinction in the per-task toggle

The task toggle will not indicate whether the value was inherited from the workspace default. The toggle reflects the task's current state, which is the value that matters at execution time.

### Decision: UI placement — after worktree base path in the existing Workspace tab

The field follows the `worktreeBasePath` field and reuses the existing Save button. No new tab or section is needed for a single boolean toggle.

## Risks / Trade-offs

- **Risk: workspace.yaml `shell_auto_approve` has no migration** → No migration is needed. The field is optional with a falsy default; existing workspaces without the field behave identically to today.
- **Risk: tasks.create reads workspace config on every creation** → `getWorkspaceConfig` already performs a config read/cache lookup; this adds no new I/O for the common path.
