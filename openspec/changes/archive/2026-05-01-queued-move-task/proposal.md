## Why

Three related bugs degrade task card reliability: column `on_enter_prompt` never fires when a task is moved by an AI tool (`move_task`); moving a running task immediately overwrites its in-progress execution with a new one; and the unread blue dot appears mid-stream instead of when the turn actually completes. These are high-friction daily-use issues that undermine trust in automated task workflows.

## What Changes

- **Deferred column prompt**: when any move operation targets a column with `on_enter_prompt` and the task is already running (or is the currently-executing task doing a self-move), the column prompt is queued via a new DB flag (`needs_column_prompt`) and fires after the current execution ends. The card stays in the new column with its `Running…` badge intact.
- **AI `move_task` wires `on_enter_prompt`**: `ctx.onTransition` (currently a no-op in both Claude and Copilot engines) is wired to `TransitionExecutor` via `ExecutionParams`. For cross-task idle targets, the prompt fires immediately and async; for self-moves or running targets, it defers via the DB flag.
- **`message_task` / `onHumanTurn` wired**: `ctx.onHumanTurn` (also a no-op in both engines) is wired to `HumanTurnExecutor` so cross-task messaging actually wakes idle target tasks. Existing `pending_messages` drain for running targets is preserved; drain logic moves into the `StreamProcessor` finally block.
- **Status badge fix**: `TransitionExecutor` re-reads the task row *after* setting `execution_state = 'running'`, so the returned task reflects the correct `running` state immediately — the card badge no longer briefly shows `Idle` after a column move.
- **Unread dot timing fix**: `markTaskUnread` is removed from `onTaskStreamEvent` and `onTaskNewMessage`; it fires only in `onTaskUpdated` when `executionState` transitions to a terminal value (`completed`, `waiting_user`, `failed`, `cancelled`).

## Capabilities

### New Capabilities
- `queued-column-prompt`: deferred `on_enter_prompt` execution when a task is moved while already running — move is immediate, prompt fires after current execution ends

### Modified Capabilities
- `task`: the `needs_column_prompt` DB flag extends the task lifecycle; the `execution_state` returned on transition is now authoritative (`running` rather than stale `idle`)
- `engine-execution-params`: `ExecutionParams` gains `onTransition` and `onHumanTurn` optional callbacks; both engines wire them into `commonToolContext`
- `engine-stream-processor`: the `finally` block gains deferred-prompt drain and pending-message drain responsibilities
- `engine-common-tools`: `execMoveTask` gains three-case logic for prompt deferral vs immediate fire; `execMessageTask`'s `onHumanTurn` call now actually reaches the target task

## Impact

- **DB schema**: one new column `needs_column_prompt INTEGER NOT NULL DEFAULT 0` on `tasks` (migration 034)
- **Backend files**: `transition-executor.ts`, `stream-processor.ts`, `orchestrator.ts`, `types.ts`, `execution-params-builder.ts`, `claude/engine.ts`, `copilot/engine.ts`, `board-tools.ts`, `handlers/tasks.ts`
- **Frontend**: `src/mainview/stores/task.ts` (unread dot logic — three spots)
- **No API surface changes**: no new RPC methods, no new WebSocket event types, no changes to shared `rpc-types.ts` Task shape
