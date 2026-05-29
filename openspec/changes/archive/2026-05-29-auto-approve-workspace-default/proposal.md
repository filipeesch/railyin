## Why

Users who always want shell commands auto-approved must manually toggle auto-approve on every new task. A workspace-level default removes that friction by seeding the task's `shell_auto_approve` flag at creation time.

## What Changes

- Add `shell_auto_approve` boolean field to `WorkspaceYaml` (workspace.yaml config).
- Expose it through `WorkspaceConfig` (RPC type) and `workspace.getConfig` / `workspace.update` handlers.
- Seed `tasks.shell_auto_approve` from the workspace setting at task creation time.
- Add a toggle to the Workspace settings tab in `SetupView.vue` (after worktree base path).
- Existing tasks are **not affected** — only newly created tasks inherit the workspace default.

## Capabilities

### New Capabilities

_(none — this extends an existing capability)_

### Modified Capabilities

- `shell-command-approval`: Add workspace-level default that seeds the per-task auto-approve flag at task creation time.
- `workspace`: Add `shell_auto_approve` as a workspace-level execution default, persisted in `workspace.yaml` and exposed through the workspace settings API.

## Impact

- `src/bun/config/index.ts` — `WorkspaceYaml` type gains `shell_auto_approve?: boolean`
- `src/shared/rpc-types.ts` — `WorkspaceConfig` gains `shellAutoApprove: boolean`; `workspace.update` params gain `shellAutoApprove?: boolean`
- `src/bun/handlers/workspace.ts` — `getConfig` maps the new field; `update` persists it
- `src/bun/handlers/tasks.ts` — `tasks.create` reads workspace config and seeds `shell_auto_approve` on INSERT
- `src/mainview/stores/workspace.ts` — `update()` passes the new param through
- `src/mainview/views/SetupView.vue` — workspace form gains the toggle field

## Notes

Test coverage for this feature is tracked in a separate change: `auto-approve-workspace-default-tests`.
