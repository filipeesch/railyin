## Why

The `resetStuckTasks()` function in `src/bun/index.ts` runs at app startup, querying the database for tasks stuck in `running`/`waiting_user` state from a previous session and forcibly marking them as `failed`. This automatic recovery was originally added as a safety net for crashes or unexpected restarts, but it operates silently and without user consent — overwriting user intent, polluting logs with `[db]` warnings, and hiding the real problem (why the process crashed or left tasks stuck in the first place).

## What Changes

- Remove the `resetStuckTasks()` function and its call from `src/bun/index.ts` (lines 117–132)
- Tasks left in `running`/`waiting_user` state after a crash/restart will remain in that state
- Users will handle stuck tasks manually via the board UI (drag-and-drop to a new column, retry button, or manual transition)
- Update the `workflow-engine` spec to remove the "Stale running state reset on startup" requirement

## Capabilities

### Modified Capabilities

- `workflow-engine`: Remove the requirement "Stale running state reset on startup" (tasks are no longer auto-reset to `failed` on process restart)

## Impact

| Area | Impact |
|---|---|
| `src/bun/index.ts` | Delete ~16 lines (the `resetStuckTasks` function and its invocation) |
| `openspec/specs/workflow-engine/spec.md` | Remove requirement at line 205–206 (Scenario: Stale running state reset on startup) |
| `openspec/changes/archive/2026-04-30-slim-bun-index-bootstrap/tasks.md` | Reference in archived tasks (line 7.8) — no action needed, already archived |
| Users | Stuck tasks from crashes remain in `running`/`waiting_user`; manual intervention required via UI |
| Tests | No tests reference `resetStuckTasks`; no test changes expected |
