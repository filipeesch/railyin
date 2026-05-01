## Context

Tasks move between workflow columns via three entry points: drag-and-drop on the board, the column selector in the task detail drawer, and the `move_task` AI tool. Each move can trigger an `on_enter_prompt` execution defined per column in the workflow YAML. Today:

1. `ctx.onTransition()` — the callback that should fire `on_enter_prompt` for AI-initiated moves — is a **no-op** in both the Claude and Copilot engines. `on_enter_prompt` never runs from `move_task`.
2. Human-initiated moves hit `TransitionExecutor` directly with no guard for an already-running task — a second execution starts on top of a live one.
3. `TransitionExecutor` reads `updatedRow` before writing `execution_state = 'running'`, so the stale `idle` state propagates to the board card.
4. `markTaskUnread` fires on the first streaming token (inside `onTaskStreamEvent`) rather than at turn completion.

`pending_messages` (migration 006) already provides a precedent for deferred inter-task messages. The pattern here — store intent in DB, drain in the `StreamProcessor` finally block — mirrors that existing design.

## Goals / Non-Goals

**Goals:**
- Column prompt fires correctly after all three move types (drag/drop, drawer select, `move_task`)
- Task in-progress is never interrupted mid-execution by a column move
- Badge correctly reflects `running` state immediately after a transition that has an `on_enter_prompt`
- Unread dot appears only when the assistant turn has fully completed
- `onHumanTurn` wired so `message_task` actually wakes idle target tasks

**Non-Goals:**
- No new frontend state types (`ExecutionState` unchanged — no `queued` value)
- No new RPC methods or WebSocket event types
- `pending_messages` drain for cross-task messaging is not redesigned — only wired
- No change to column-limit enforcement logic

## Decisions

### Decision 1: DB flag over in-memory queue for deferred prompt

`needs_column_prompt INTEGER NOT NULL DEFAULT 0` added to the `tasks` table (migration 034).

**Why not in-memory map on Orchestrator:** Server restarts during a long execution would silently drop the pending prompt. The flag is durably visible, trivially queryable, and follows the same pattern as `current_execution_id`.

**Why not reuse `pending_messages`:** That table is semantically "queued human messages". Conflating it with "deferred column prompt trigger" makes both concepts harder to reason about and complicates the drain logic.

The flag is backend-only and does not appear in `rpc-types.ts` or the frontend `Task` type.

### Decision 2: `onTransition` / `onHumanTurn` injected via `ExecutionParams`, not engine constructor

Both callbacks are added as optional fields to `ExecutionParams`:
```ts
onTransition?: (taskId: number, toState: string) => void;
onHumanTurn?:  (taskId: number, message: string)  => void;
```

Engines are long-lived (cached per workspace in `EngineRegistry`). Injecting orchestrator callbacks into the constructor would couple the registry to the orchestrator's lifecycle. `ExecutionParams` is already the per-execution DI surface — `onRawModelMessage` follows the same pattern.

Each engine's `execute()` reads the callbacks from `params` and passes them into `commonToolContext`. Both default to `() => {}` if absent.

### Decision 3: `execMoveTask` three-case logic

```
isSelf   = (args.task_id === ctx.taskId)
isRunning = (movedTask.execution_state === 'running')
hasPrompt = !!targetCol.on_enter_prompt

Case A: (isSelf || isRunning) && hasPrompt
  → UPDATE needs_column_prompt = 1
  → no onTransition call; flag drains at execution end

Case B: !isSelf && !isRunning && hasPrompt
  → ctx.onTransition(movedTaskId, targetState)  ← fires async
  → TransitionExecutor.execute() runs in background

Case C: !hasPrompt
  → update workflow_state + position, notify only
```

Case A uses the DB flag because: self-move must not start a new execution while the current one is live; and a running cross-task target would race with its own active execution.

### Decision 4: `StreamProcessor.consume()` finally block owns both drains

The `finally` block already reads `finalRow`. Two sequential drains are added:

1. **`needs_column_prompt` drain** (priority): if flag is set, clear it and call `void this.onDeferredTransition(taskId, workflow_state)`. The new execution starts asynchronously — no `await`.

2. **`pending_messages` drain**: if no column prompt was just fired, check `pending_messages` for this task and call `void this.onPendingMessage(taskId, content)` for each row.

Priority ordering: column prompt fires before queued messages because the column prompt re-establishes the task's context in the new column. Messages should be delivered to the task in its new context.

`StreamProcessor` receives two optional **callback functions** as constructor parameters (not class instances), matching the existing callback-injection style of `onTaskUpdated` and `onNewMessage`:

```ts
onDeferredTransition?: (taskId: number, toState: string) => void   // default: () => {}
onPendingMessage?:     (taskId: number, message: string) => void   // default: () => {}
```

The `Orchestrator` wires these by wrapping its executor instances:
```ts
onDeferredTransition: (tid, state) => void this.transitionExecutor.execute(tid, state),
onPendingMessage:     (tid, msg)   => void this.humanTurnExecutor.execute(tid, msg),
```

This keeps `StreamProcessor` unit tests minimal — existing SP tests only need two extra `() => {}` no-ops in the constructor call.

### Decision 5: Badge fix is a one-line re-read

`TransitionExecutor.execute()` re-reads the task row after writing `execution_state = 'running'`:
```ts
// Before (returns stale row):
return { task: mapTask(updatedRow), executionId };

// After (returns fresh row):
const runningRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
return { task: mapTask(runningRow), executionId };
```

### Decision 6: Unread dot at terminal execution state only

Remove `markTaskUnread` from `onTaskStreamEvent` and `onTaskNewMessage` entirely. Add it in `onTaskUpdated`:

```ts
const terminal = ['completed', 'waiting_user', 'failed', 'cancelled'];
if (
  activity.kind === 'execution' &&
  terminal.includes(activity.nextState) &&
  activeTaskId.value !== task.id
) {
  markTaskUnread(task.id);
}
```

Workflow transitions (column moves) do not trigger the unread dot — only terminal execution states.

## Risks / Trade-offs

- **`needs_column_prompt` priority over `pending_messages`**: if a task is moved while running AND has pending messages, the column prompt fires first and the messages wait for the column prompt execution to finish. This is the correct ordering (messages delivered in new context) but could delay inter-task communication by one extra execution cycle. This mirrors exactly how `pending_messages` already defers when a task is running.

- **Async `onTransition` for Case B**: `transitionExecutor.execute()` is called as `void` inside `execMoveTask`. If it throws, the error is logged but the AI tool already returned success. The tool result string already says "success" — this is consistent with how `message_task` handles async delivery.

- **`StreamProcessor` constructor grows**: adding two optional callbacks increases the constructor surface slightly. This is consistent with the existing pattern (`onTaskUpdated`, `onNewMessage`) and avoids coupling `StreamProcessor` to concrete executor types — it only receives plain arrow functions.

- **No `needs_column_prompt` for columns without `on_enter_prompt`**: the flag is only set when `toCol.on_enter_prompt` exists. If a task is moved to a plain column while running, `workflow_state` updates immediately with no deferred action — correct behavior.

## Migration Plan

1. Add migration `034_needs_column_prompt.ts` — single `ALTER TABLE tasks ADD COLUMN needs_column_prompt INTEGER NOT NULL DEFAULT 0`.
2. Deploy — existing tasks default to `0`; no data backfill needed.
3. Rollback: the column can be dropped in a `035_drop_needs_column_prompt.ts` migration if needed; no behavior changes require it since the flag defaults to `0`.

## Open Questions

None — all design decisions confirmed with product owner.
