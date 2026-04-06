## Why

The `tasks-tool-group` change gives agents the ability to create, read, and move tasks — but agents cannot yet *communicate with* a task. There is no mechanism for an orchestrator agent to send a message to a sibling task's conversation and wake it up. This change adds `message_task`, completing the agent-to-agent coordination loop.

## What Changes

- Add a `message_task` AI tool to the `tasks_write` group
- `message_task` appends a human-turn message to another task's conversation and triggers its AI model
- If the target task is currently running, the message is queued and delivered when the task next reaches `waiting_user` or `idle` state
- Introduce a `pending_messages` DB table to hold queued messages
- Add a flush step in the engine: after a task's execution ends and reaches a waiting state, drain any pending messages before returning control to the user

## Capabilities

### New Capabilities

- `message-task-tool`: The `message_task` AI tool — appends a message to another task's conversation and triggers execution, with queuing when the target is busy

### Modified Capabilities

- `tasks-write-tools`: `message_task` is added as a member of the `tasks_write` tool group (delta to spec created by `tasks-tool-group` change)
- `conversation`: The pending message queue and flush behaviour are new requirements on the conversation/execution lifecycle

## Impact

- `src/bun/db/migrations.ts` — new `pending_messages` table
- `src/bun/workflow/tools.ts` — new `message_task` tool definition and executor
- `src/bun/workflow/engine.ts` — pending message flush after execution reaches waiting state
- `src/bun/handlers/tasks.ts` — no changes (reuses `handleHumanTurn`)
- `src/shared/rpc-types.ts` — possibly expose pending message count on Task type (optional)
