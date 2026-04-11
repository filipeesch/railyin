## Context

The chat drawer renders streaming output through three independent IPC channels: `stream.token` (text tokens), `stream.token` with `isReasoning=true` (reasoning tokens), and `message.new` (persisted messages). Each channel has its own lifecycle and its own close signal. None of them know about each other.

The bun side has two engine paths that produce these events:
- **engine.ts** (native, Anthropic/OpenAI direct): calls `onToken()` + `onNewMessage()` separately throughout the execution loop
- **orchestrator.ts** (Copilot SDK): accumulates tokens in `tokenAccum`, only flushing on `done`

The frontend stores all streaming state in a single global slot: `streamingTaskId / streamingToken / streamingReasoningToken / isStreamingReasoning / streamingStatusMessage`. Only one task can stream at a time.

## Goals / Non-Goals

**Goals:**
- Single unified pipeline: one ordered stream of events per execution
- Per-task stream state: `Map<taskId, TaskStreamState>` replaces the global single slot
- New `stream_events` DB table with `seq` ordering and `block_id` for collapsible grouping
- 500ms DB write batching (bun side); real-time IPC token forwarding (frontend gets tokens immediately, DB catches up every 500ms)
- Correct timeline ordering: text before tool calls, reasoning in correct position
- No lost messages when drawer closes mid-stream
- No cross-task token contamination
- Subagent conversations visible in a collapsible block in the parent's timeline
- Interleaved reasoning blocks (Claude 4.6 adaptive thinking) rendered correctly
- One `done` event closes all rendering state atomically

**Non-Goals:**
- Not removing `conversation_messages` table in this change (left deprecated, removal is a backlog task)
- Not changing the AI provider implementations (SSE parsing stays the same)
- Not changing the tool call pairing logic (already fixed in the prior change)
- Not adding search or indexing to `stream_events`

## Decisions

### 1. Unified `StreamEvent` type — one IPC channel replaces two

All events (text token, reasoning token, status, tool_call, tool_result, file_diff, assistant, reasoning, system, user, done) are emitted as a single `StreamEvent` type on a single `stream.event` IPC channel. The `stream.token` and `message.new` channels are retired.

**Why**: The three-channel model means any channel can get stuck independently. The done signal on `stream.token` does not close the reasoning bubble (which waits for `message.new`). The done signal is never truly atomic — it's three separate close events that must all fire correctly.

**`StreamEvent` shape:**
```ts
interface StreamEvent {
  taskId:      number;
  executionId: number;
  seq:         number;       // monotonic per task, assigned by batcher
  blockId:     string;       // groups chunks into collapsible UI elements
  type:        StreamEventType;
  content:     string;       // token text, message content, or JSON
  metadata:    string | null; // JSON, same role as conversation_messages.metadata
  subagentId:  string | null; // null for parent; "agent-1" etc for subagents
  done:        boolean;      // true only on the terminal event for this execution
}

type StreamEventType =
  | "text_chunk"       // live token — not persisted to DB
  | "reasoning_chunk"  // live reasoning token — not persisted to DB
  | "status_chunk"     // ephemeral status — not persisted to DB
  | "user"             // persisted: user message
  | "assistant"        // persisted: finalized assistant text
  | "reasoning"        // persisted: finalized reasoning block
  | "tool_call"        // persisted: tool call
  | "tool_result"      // persisted: tool result
  | "file_diff"        // persisted: file diff
  | "system"           // persisted: system/error message
  | "done";            // terminal event — closes all state for this execution
```

### 2. `blockId` identifies collapsible UI elements

Every event carries a `blockId`. The frontend renders one UI item per unique `blockId`, in `seq` order. Chunks with the same `blockId` append to the same item.

**Block ID assignment (bun side):**
- Text block: `"{executionId}-t{n}"` — increments each time text resumes after a non-text event
- Reasoning block: `"{executionId}-r{n}"` — increments each time a reasoning block starts (Anthropic: `content_block_start` with `type:"thinking"`; OpenAI: first `reasoning_content` delta after a non-reasoning delta)
- Tool call: `"{callId}"` — the tool call's ID string
- Subagent: `"{executionId}-sa{n}"` — wraps all events for one subagent invocation
- Subagent children: `"{executionId}-sa{n}-{childBlockId}"`

**Why `blockId` instead of event type for grouping**: Interleaved thinking (Claude 4.6 adaptive) emits reasoning and text in alternating blocks within a single model response. Without `blockId`, the frontend cannot distinguish "second reasoning block" from "still the first reasoning block". `blockId` makes each block's identity explicit and engine-agnostic.

### 3. Batcher: 500ms DB flush, real-time IPC token forwarding

The batcher sits between the engine and the pipeline output:

```
Engine emits StreamEvent
  │
  ├──▶ IPC send immediately (text_chunk, reasoning_chunk, status_chunk only)
  │    → frontend gets live tokens in real-time
  │
  └──▶ In-memory buffer (all event types)
         │ every 500ms
         ▼
       Flush: persist "done" events to DB + send full batch via IPC
              (persisted types: user, assistant, reasoning, tool_call,
               tool_result, file_diff, system)
       Clear buffer
```

The frontend receives:
1. Individual `text_chunk` / `reasoning_chunk` events immediately as they arrive
2. Full batches every 500ms containing finalized messages

This gives real-time typing feel while keeping DB writes cheap and batched.

**Batcher state per execution (bun side):**
```ts
interface BatcherState {
  buffer:    StreamEvent[];
  timer:     Timer | null;
  seq:       number;          // monotonic counter for this task
  blockCounters: Map<string, number>; // "t" → n, "r" → n, "sa" → n
}
```

### 4. New `stream_events` DB table

```sql
CREATE TABLE stream_events (
  id           INTEGER PRIMARY KEY,
  task_id      INTEGER NOT NULL,
  execution_id INTEGER NOT NULL,
  seq          INTEGER NOT NULL,
  block_id     TEXT NOT NULL,
  type         TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  metadata     TEXT,
  subagent_id  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task_id, seq)
);
CREATE INDEX idx_stream_events_task ON stream_events (task_id, seq);
```

Only persisted types are written (not `text_chunk`, `reasoning_chunk`, `status_chunk`, `done`). The `seq` for a persisted event is the seq of the first chunk in its block.

**`conversation_messages` table**: left intact, no longer written by new executions. Existing data is still readable. A follow-up task removes it.

### 5. Per-task stream state in the frontend store

Replace global refs with a `Map`:

```ts
interface TaskStreamState {
  blocks:    Map<string, StreamBlock>; // blockId → block
  blockOrder: string[];                // blockIds in seq order (for rendering)
  isDone:    boolean;
}

interface StreamBlock {
  blockId:    string;
  type:       "text" | "reasoning" | "tool_call" | "tool_result" |
              "file_diff" | "assistant" | "system" | "user" | "subagent";
  content:    string;   // accumulated for chunks; full content for persisted
  metadata:   unknown;
  subagentId: string | null;
  isStreaming: boolean; // true while chunks are arriving
  children:   StreamBlock[]; // for subagent blocks
}

// In store:
const streamStates = ref(new Map<number, TaskStreamState>());
```

**Drawer open flow:**
1. `loadMessages(taskId)` → `SELECT * FROM stream_events WHERE task_id = ? ORDER BY seq ASC`
2. Build `TaskStreamState` from DB rows
3. Subscribe to live `stream.event` IPC for this `taskId`
4. Incoming events: if `blockId` exists in state → append content; if new → add block in order

**Done event**: sets `isDone = true` on the `TaskStreamState`, marks all `isStreaming = false`. One atomic operation closes all rendering state.

### 6. Subagent visibility

`runSubExecution()` receives an `onStreamEvent` callback. It calls this for every event it produces, prefixing `blockId` with `"sa{n}-"` and setting `subagentId`. The parent pipeline batcher handles the rest identically.

The frontend renders a `SubagentBlock` component for blocks where `type === "subagent"`. Inside it, child blocks are rendered in their own seq order — same components as the main timeline (reasoning collapsible, tool call group, text bubble), just nested.

### 7. Cancel handling

Both engine paths call `onStreamEvent({ type: "done", done: true, ... })` on cancel, after persisting any in-flight accumulated content. This replaces the current `onToken(done=true)` calls and the missing call in `handleCancelled()`. The batcher flushes immediately on `done` (does not wait for 500ms).

### 8. `conversation_messages` migration path

New executions write to `stream_events` only. `loadMessages()` reads from `stream_events`. The existing `conversation_messages` data is orphaned but not deleted. A backlog task tracks the removal. The `pairToolMessages` utility still works because tool call/result content JSON is identical in both tables.

## Data Flow Diagram

```
AI SSE
  │ chunks
  ▼
Engine loop (engine.ts / orchestrator.ts)
  │ StreamEvent (with blockId, seq=0 draft)
  ▼
Batcher (per execution, bun side)
  ├──▶ IPC "stream.event" immediately  (text_chunk, reasoning_chunk, status_chunk)
  │
  └──▶ in-memory buffer
         │ every 500ms OR on done
         ▼
       DB write → stream_events (persisted types only)
       IPC batch → "stream.event" (all accumulated events since last flush)

Frontend store
  │ on "stream.event":
  │   if text_chunk/reasoning_chunk/status_chunk → update live block content
  │   if persisted type → upsert block in TaskStreamState
  │   if done → mark all blocks done, clear isStreaming
  ▼
TaskDetailDrawer.vue
  renders blockOrder in seq order:
    "t0" → TextBubble (streaming or final)
    "r0" → ReasoningBubble (collapsible, auto-close on done)
    "call_abc" → ToolCallGroup
    "sa0" → SubagentBlock (collapsible)
      "sa0-r0" → nested ReasoningBubble
      "sa0-t0" → nested TextBubble
      "sa0-call_xyz" → nested ToolCallGroup
    "t1" → TextBubble (final summary)
```
