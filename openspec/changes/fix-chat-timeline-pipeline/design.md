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
  taskId:        number;
  executionId:   number;
  seq:           number;         // monotonic per task, assigned by batcher
  blockId:       string;         // this block's identity
  parentBlockId: string | null;  // parent block's identity (for tree building in UI)
  type:          StreamEventType;
  content:       string;         // token text, message content, or JSON
  metadata:      string | null;  // JSON, same role as conversation_messages.metadata
  done:          boolean;        // true only on the terminal event for this execution
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

Every event carries a `blockId`. The frontend renders one UI item per unique `blockId`. Chunks with the same `blockId` append to the same item.

**Block ID assignment (bun side):**
- Text block: `"{executionId}-t{n}"` — increments each time text resumes after a non-text event
- Reasoning block: `"{executionId}-r{n}"` — increments each time a reasoning block starts. Reasoning always gets an explicit generated `blockId` (never empty string) so it can be placed in the block tree as a named node.
- Tool call: `"{callId}"` — the tool call's SDK-assigned ID string
- Tool result: `"{callId}"` — same blockId as its paired tool_call

**Why `blockId` instead of event type for grouping**: Interleaved thinking (Claude 4.6 adaptive) emits reasoning and text in alternating blocks within a single model response. Without `blockId`, the frontend cannot distinguish "second reasoning block" from "still the first reasoning block". `blockId` makes each block's identity explicit and engine-agnostic.

**Note on `subagentId` removal**: The previous design used a `subagentId` field to identify subagent events. This is replaced by `parentBlockId` — subagent hierarchy is encoded in the block tree, not as a separate identity field. The UI reconstructs the tree from `parentBlockId` references.

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
  id              INTEGER PRIMARY KEY,
  task_id         INTEGER NOT NULL,
  execution_id    INTEGER NOT NULL,
  seq             INTEGER NOT NULL,
  block_id        TEXT NOT NULL,
  parent_block_id TEXT,           -- null for root-level blocks; set for nested blocks
  type            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task_id, seq)
);
CREATE INDEX idx_stream_events_task ON stream_events (task_id, seq);
```

Only persisted types are written (not `text_chunk`, `reasoning_chunk`, `status_chunk`, `done`). The `seq` for a persisted event is the seq of the first chunk in its block.

**`conversation_messages` table**: left intact, no longer written by new executions. Existing data is still readable. A follow-up task removes it.

### 5. Per-task stream state in the frontend store

Replace global refs with a `Map`. The stream state is **flat** — all blocks in one Map keyed by `blockId`. The tree structure is built in the UI layer using `parentBlockId` references.

```ts
interface TaskStreamState {
  blocks:    Map<string, StreamBlock>; // blockId → block (ALL blocks, flat)
  roots:     string[];                 // blockIds with parentBlockId=null, in arrival order
  isDone:    boolean;
}

interface StreamBlock {
  blockId:       string;
  parentBlockId: string | null;
  type:          StreamEventType;
  content:       string;    // accumulated for chunks; full content for persisted
  metadata:      unknown;
  isStreaming:   boolean;   // true while chunks are arriving
  children:      string[];  // ordered list of child blockIds
}

// In store:
const streamStates = ref(new Map<number, TaskStreamState>());
```

**Incoming event handling:**
1. If `blockId` not in `blocks` → create new block, then:
   - If `parentBlockId` is set AND `blocks.has(parentBlockId)` → append to parent's `children[]`
   - If `parentBlockId` is set BUT parent NOT found → **promote to root** (orphaned child, e.g. from filtered internal Copilot tool) — add to `roots[]`
   - If `parentBlockId` is null → add to `roots[]`
2. If `blockId` already in `blocks` → append content / upsert

**Drawer open flow:**
1. `loadMessages(taskId)` → `SELECT * FROM stream_events WHERE task_id = ? ORDER BY seq ASC`
2. Build `TaskStreamState` from DB rows using `parent_block_id` column to reconstruct tree
3. Subscribe to live `stream.event` IPC for this `taskId`

**Done event**: sets `isDone = true` on the `TaskStreamState`, marks all `isStreaming = false`. One atomic operation closes all rendering state.

### 6. Subagent / hierarchy visibility

Subagent and nested tool events carry `parentBlockId` pointing to the enclosing tool call's `blockId`. The frontend receives these flat events and builds the tree:

```
roots: ["r0", "call_c1", "t0"]
blocks:
  r0       { parentBlockId: null, children: [] }
  call_c1  { parentBlockId: null, children: ["r1", "call_c2"] }
    r1     { parentBlockId: "call_c1", children: [] }
    call_c2{ parentBlockId: "call_c1", children: [] }
  t0       { parentBlockId: null, children: [] }
```

The renderer walks `roots[]` recursively: each block renders itself, then renders its `children[]` recursively (indented, inside collapsible if tool_call).

No dedicated `SubagentBlock` component is needed — the same recursive renderer handles any nesting depth. A tool_call block that has children renders them inline as a collapsible body.

### 7. Cancel handling

Both engine paths call `onStreamEvent({ type: "done", done: true, ... })` on cancel, after persisting any in-flight accumulated content. This replaces the current `onToken(done=true)` calls and the missing call in `handleCancelled()`. The batcher flushes immediately on `done` (does not wait for 500ms).

### 8. `conversation_messages` migration path

New executions write to `stream_events` only. `loadMessages()` reads from `stream_events`. The existing `conversation_messages` data is orphaned but not deleted. A backlog task tracks the removal. The `pairToolMessages` utility still works because tool call/result content JSON is identical in both tables.

### 9. `parentBlockId` propagation — orchestrator context stack

The orchestrator maintains a `callStack: string[]` to track the currently open tool call chain. This enables assigning `parentBlockId` to reasoning and token chunks without requiring the engine to expose explicit ancestry on every event.

```
callStack starts empty = []

tool_start { callId: "c1", parentCallId: null }
  → emit tool_call { blockId: "c1", parentBlockId: null }
  → push "c1" → callStack = ["c1"]

reasoning chunk (inside c1's subagent)
  → emit reasoning_chunk { blockId: "r1", parentBlockId: callStack.at(-1) = "c1" }

tool_start { callId: "c2", parentCallId: "c1" }
  → emit tool_call { blockId: "c2", parentBlockId: "c1" }  (use event.parentCallId directly)
  → push "c2" → callStack = ["c1", "c2"]

tool_result { callId: "c2" }
  → emit tool_result { blockId: "c2", parentBlockId: "c1" }
  → pop → callStack = ["c1"]

tool_result { callId: "c1" }
  → emit tool_result { blockId: "c1", parentBlockId: null }
  → pop → callStack = []

token chunk (final response)
  → emit text_chunk { blockId: "t1", parentBlockId: callStack.at(-1) = null }
```

**Rules:**
- `tool_start`: `parentBlockId = event.parentCallId ?? null`. Push `callId` to stack **only if `!event.isInternal`** (internal tools are filtered and never emitted, their children may still arrive)
- `tool_result`: `parentBlockId = event.parentCallId ?? null`. Pop from stack **only if `!event.isInternal`**
- `token` / `reasoning` chunks: `parentBlockId = callStack.at(-1) ?? null`
- Orphaned children (internal tool filtered): their `parentCallId` points to a non-emitted block → UI promotes them to root per Decision 5

**Engines:**
- Copilot: `parentCallId` is set on tools by the SDK; reasoning arrives with no explicit parent but context stack covers it
- Claude: `parentCallId` is never set (all tools are depth-1 from our perspective); callStack is always empty for Claude; all `parentBlockId` values are `null`

## Data Flow Diagram

```
AI SDK (Copilot / Claude)
  │ events: token, reasoning, tool_start/result (with callId, parentCallId, isInternal)
  ▼
Engine (copilot/events.ts, claude/events.ts)
  │ EngineEvent — normalized, isInternal flagged
  ▼
Orchestrator (orchestrator.ts)
  │ callStack: string[] tracks open tool calls
  │ assigns parentBlockId to every StreamEvent
  │ isInternal tools: filtered out (never emitted)
  │ StreamEvent { blockId, parentBlockId, type, content, metadata }
  ▼
Batcher (per execution, bun side)
  ├──▶ IPC "stream.event" immediately  (text_chunk, reasoning_chunk, status_chunk)
  │
  └──▶ in-memory buffer
         │ every 500ms OR on done
         ▼
       DB write → stream_events (persisted types only, with parent_block_id column)
       IPC batch → "stream.event" (all accumulated events since last flush)

Frontend store
  │ on "stream.event" (FLAT — all events regardless of depth):
  │   create/update block in flat blocks Map
  │   if parentBlockId && parent found → add to parent.children[]
  │   if parentBlockId && parent NOT found → promote to roots[] (orphan)
  │   if parentBlockId null → add to roots[]
  ▼
TaskDetailDrawer.vue
  recursive render of roots[]:
    renderBlock("r0")   → ReasoningBubble (collapsible, streaming)
    renderBlock("c1")   → ToolCallGroup (collapsible)
      renderBlock("r1") → nested ReasoningBubble (child of c1)
      renderBlock("c2") → nested ToolCallGroup (child of c1)
    renderBlock("t0")   → TextBubble (final response)
```
