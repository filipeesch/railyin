## Context

After `tasks-tool-group` lands, agents can create and move tasks but cannot send them messages. The only existing mechanism for seeding a task with input is creating it and hoping the column's `on_enter_prompt` picks it up. This is too blunt — orchestrators need to pass rich, targeted instructions to specific tasks.

`message_task` fills this gap: it calls `handleHumanTurn` on behalf of an agent, exactly as if a human had typed a message into the task detail drawer. The key new complexity is the **queue**: a target task may be mid-execution when the message arrives.

### Current state

- `handleHumanTurn(taskId, text)` is already implemented in `engine.ts` and used by the UI
- There is no concept of pending/queued messages in the DB schema
- The engine currently returns after execution reaches `waiting_user` or `idle`, with no step to check for pending input

### Pending message lifecycle

```
message_task(targetId, text)
      │
      ├─ target.execution_state == "running"?
      │       YES ──▶ INSERT into pending_messages (task_id, content)
      │                return "queued"
      │
      └─ NO ──▶ handleHumanTurn(targetId, text) [fire-and-forget]
                return "delivered"

Engine side (after execution ends):
      │
      ├─ SELECT oldest pending_message WHERE task_id = ?
      │       found ──▶ DELETE it, call handleHumanTurn [fire-and-forget], end
      └─ not found ──▶ idle, return
```

One message is flushed per execution end. This is intentional: it avoids uncontrolled fan-in and gives the task a chance to respond before the next message is delivered.

## Goals / Non-Goals

**Goals:**
- `message_task(task_id, message)` tool added to `tasks_write` group
- Fire-and-forget delivery: tool returns immediately after inserting the message or triggering `handleHumanTurn`
- Queue via `pending_messages` table when target is running
- Flush exactly one queued message when an execution ends (transitions to `waiting_user` or `idle`)
- Agent may message itself
- DB migration for `pending_messages` table

**Non-Goals:**
- Guaranteed in-order multi-message delivery (queue is FIFO, one-at-a-time is sufficient)
- Read access to the queue (no `list_pending_messages` tool)
- Message expiry or TTL
- UI surface for pending messages (internal engine concern only)

## Decisions

### Decision: One message flushed per execution end, not all at once

Flushing all pending messages at once would trigger N parallel executions, which is uncontrolled. Flushing one means the task processes messages serially, which is safer and more predictable.

**Alternative considered:** Flush all at once with Promise.all. Rejected — the queue would need to track which messages triggered which executions, and concurrent human-turn executions on the same task are not currently supported.

### Decision: Queue flush happens inside the engine after execution finishes

The engine already has a clear "execution ended" point where it sets `execution_state` to `waiting_user` or `idle`. Adding a flush check there is the least invasive integration point.

**Alternative considered:** A background polling loop that watches `pending_messages`. Rejected — adds complexity, timing uncertainty, and a new async process with no natural lifecycle.

### Decision: `handleHumanTurn` called fire-and-forget on flush

The flushed execution runs asynchronously. The engine does not await it — this prevents a chain-reaction stack where execution A flushes execution B which would then need to be awaited.

### Decision: message_task returns immediately with "queued" or "delivered" status

The calling agent has no way to know when the message is acted on. This matches `move_task` semantics (fire-and-forget). Agents that need to verify delivery can call `get_task` to check `execution_state`.

### Decision: `pending_messages` is a simple table, not a join on conversations

Messages in the queue are pre-delivery — they are NOT conversation messages yet. They become conversation messages when flushed and handed to `handleHumanTurn`. This avoids polluting the conversation timeline with undelivered intent.

## Risks / Trade-offs

- **Queue depth unbounded** → Many orchestrator agents messaging a busy task could pile up. Mitigation: document expected usage; a depth cap could be added in future.
- **Flush skipped on crash** → If the process crashes between execution end and flush, the pending message remains and will be delivered on the next execution for that task. This is acceptable (at-least-once delivery).
- **Self-messaging** → An agent calling `message_task(self)` while running is immediately queued. It will fire after its own execution ends — a deferred self-prompt. Useful but potentially surprising.

## Migration Plan

- Add `pending_messages` table in a new migration (non-destructive, additive only)
- No data migration required
- Rollback: drop the table (no data loss, feature simply stops working)
