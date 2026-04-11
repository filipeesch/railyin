## Why

The chat timeline has accumulated a set of compounding bugs that share a single root cause: **the streaming pipeline has no unified structure**. Tokens, reasoning, and messages flow through three independent channels with three independent lifecycles. None of them know about each other, and any one can get stuck without the others noticing.

The symptoms:

1. **Reasoning bubble never closes** — `streamingReasoningToken` only clears when a `reasoning` DB message arrives via `message.new`. If the done signal is dropped (cancel, crash, re-run), the bubble persists across multiple sessions and new reasoning tokens append to the ghost content.

2. **Streaming text disappears on cancel (Copilot/orchestrator path)** — `tokenAccum` is only flushed to DB on the `done` event. Cancel fires `onToken(done=true)` without flushing first — the accumulated text is lost forever.

3. **Text appears below tool calls (wrong order)** — when `tool_start` fires on the orchestrator path, `tokenAccum` has not been flushed yet. The tool_call message enters `displayItems` while the preamble text is still in the streaming bubble, rendering below the tool call instead of above it.

4. **Close drawer during stream → conversation appears incomplete on reopen** — `onNewMessage()` guards by `activeTaskId`. When the drawer is closed, `activeTaskId = null`, so all new messages are dropped from `messages[]`. On reopen `loadMessages()` fetches from DB but only gets what was persisted before the drawer closed — in-flight tokens are lost from the UI view.

5. **Cross-task token contamination** — `streamingTaskId` is a single global slot. `sendMessage()` unconditionally overwrites it. If two tasks stream concurrently, the second overwrites the first — tokens from Task A appear in Task B's streaming bubble and Task A's done signal is never processed.

6. **ReasoningBubble floats between tool calls and streaming text** — the collapsed ReasoningBubble has no visual anchor; it renders between the last tool call and the streaming text bubble, in the wrong position.

These are not six independent bugs. They are all symptoms of the same missing abstraction: **a per-execution, per-task stream with a single lifecycle**.

## What Changes

Replace the three-channel global streaming state with a unified per-execution pipeline:

**Bun side (pipeline):**
- Engine emits a single `StreamEvent` type covering all event kinds (tokens, reasoning, tool calls, messages, done)
- A batcher accumulates events and flushes every 500ms to:
  1. DB write (`stream_events` table — new, replaces `conversation_messages` for new executions)
  2. IPC send to frontend (same batch)
- Real-time token rendering: individual tokens are forwarded to frontend immediately via IPC (separate from the 500ms DB batch) so the UI feels live
- A `block_id` field on every event identifies which collapsible UI element it belongs to (reasoning block, subagent, text)

**Frontend side:**
- Replace global `streamingToken / streamingReasoningToken / streamingTaskId` refs with `Map<taskId, TaskStreamState>`
- One IPC channel (`stream.event`) replaces `stream.token` + `message.new`
- On drawer open: load DB (`stream_events` for the task) + subscribe to live IPC batches
- Timeline renders by iterating events in `seq` order, grouping by `block_id`
- Collapsibles (reasoning, subagent) are identified by `block_id` — new block = new collapsible; same block = append content
- `done` event closes ALL state for that execution atomically — no partial stale state

**New DB table (`stream_events`):**
- `task_id`, `execution_id`, `seq` (monotonic per task), `block_id`, `type`, `content`, `metadata`, `subagent_id`
- Updated every 500ms with accumulated content per block
- `conversation_messages` left as-is (deprecated, removed in a follow-up task)

**Subagents:**
- `runSubExecution()` emits events into the parent's pipeline with `subagent_id` set
- Frontend groups `subagent_id` events inside a collapsible "Agent N" block in the timeline
- Same block_id mechanism handles interleaved reasoning inside subagents

## Capabilities

### Modified Capabilities
- `chat-streaming`: Unified per-execution pipeline replaces three-channel global state; all streaming bugs resolved
- `chat-tool-rendering`: Timeline order is now guaranteed by `seq`; no more text-below-tools ordering bug
- `chat-timeline`: ReasoningBubble anchored correctly in the timeline by block_id

### New Capabilities
- `chat-stream-pipeline`: Batcher stage with 500ms DB flush and real-time IPC token forwarding
- `subagent-visibility`: Subagent conversations (tools, reasoning, text) visible in a collapsible block in the parent's timeline

### Deprecated
- `conversation_messages` table: superseded by `stream_events`; kept intact, removal tracked as backlog task

## Impact

- `src/bun/index.ts`: replace `onToken()` + `onNewMessage()` callbacks with `onStreamEvent()` emitter wired to the batcher
- `src/bun/workflow/engine.ts`: emit `StreamEvent` instead of calling `onToken` / `onNewMessage` separately; `handleCancelled()` emits `done` event; `runSubExecution()` forwards events to parent pipeline with `subagent_id`
- `src/bun/engine/orchestrator.ts`: `consumeStream()` emits `StreamEvent`; tokenAccum flushed eagerly on `tool_start` and cancel
- `src/bun/db/stream-events.ts`: new module — `appendStreamEvent()`, `flushStreamEventBatch()`, `getStreamEvents(taskId)`
- `src/shared/rpc-types.ts`: new `StreamEvent` IPC type replacing `StreamToken`; new `stream.event` channel
- `src/mainview/stores/task.ts`: replace global streaming refs with `Map<taskId, TaskStreamState>`; `onStreamEvent()` handler; `loadMessages()` reads from `stream_events`
- `src/mainview/components/TaskDetailDrawer.vue`: timeline renders by `seq` order from `StreamEvent[]`; collapsibles keyed by `block_id`; subagent collapsible component
- `src/ui-tests/`: new Suite T covering all fixed scenarios (ordering, cancel, cross-task, close-during-stream, reasoning position, subagent visibility)
- Backlog task: remove `conversation_messages` table and all references
