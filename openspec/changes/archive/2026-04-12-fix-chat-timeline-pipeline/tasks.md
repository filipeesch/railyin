## 1. DB Schema — `stream_events` table

- [x] 1.1 In `src/bun/db/migrations.ts` (or wherever schema is defined), add the `stream_events` table migration:
  ```sql
  CREATE TABLE IF NOT EXISTS stream_events (
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
  CREATE INDEX IF NOT EXISTS idx_stream_events_task ON stream_events (task_id, seq);
  ```
- [x] 1.2 Create `src/bun/db/stream-events.ts` with:
  - `appendStreamEvent(event: PersistedStreamEvent): number` — inserts one row, returns id
  - `appendStreamEventBatch(events: PersistedStreamEvent[]): void` — inserts a batch in a transaction
  - `getStreamEvents(taskId: number, afterSeq?: number): PersistedStreamEvent[]` — SELECT ordered by seq ASC
  - `PersistedStreamEvent` type (matches the table columns)
- [x] 1.3 Verify migration runs cleanly on a fresh in-memory DB — confirmed via test suite (all stream-tree tests use fresh DBs)

## 2. Shared `StreamEvent` type

- [x] 2.1 In `src/shared/rpc-types.ts`, add:
  - `StreamEvent` interface (taskId, executionId, seq, blockId, type, content, metadata, subagentId, done)
  - `StreamEventType` union type
  - New IPC channel: `"stream.event": StreamEvent`
  - Keep `StreamToken` and `"stream.token"` / `"message.new"` channels in place for now (deprecated, removed in follow-up)
- [x] 2.2 In `src/bun/workflow/engine.ts`, add `OnStreamEvent` callback type:
  ```ts
  export type OnStreamEvent = (event: StreamEvent) => void;
  ```

## 3. Batcher (bun side)

- [x] 3.1 Create `src/bun/pipeline/batcher.ts`:
  - `class StreamBatcher` with constructor `(taskId, executionId, onFlush: (events: StreamEvent[]) => void)`
  - `push(partialEvent)` — assigns `seq`, sets `blockId` using block counters, appends to buffer
  - `flush()` — writes persisted-type events to DB via `appendStreamEventBatch()`, calls `onFlush(buffer)`, clears buffer
  - `start()` — starts 500ms interval timer calling `flush()`
  - `stop()` — clears timer, calls final `flush()`
  - Block counter logic: maintains `Map<"t"|"r"|"sa", number>` — increments when event type switches within a round
  - `blockId` generation per Decision 2 in design.md
- [x] 3.2 Unit test `src/bun/pipeline/batcher.test.ts`:
  - Test: text chunks → single text block, correct blockId
  - Test: reasoning then text → two different blockIds
  - Test: interleaved reasoning/text → separate blockId per block
  - Test: done event triggers immediate flush (no waiting for 500ms)
  - Test: seq is monotonically increasing across multiple pushes

## 4. Engine integration — native engine (`engine.ts`)

- [x] 4.1 Add `onStreamEvent: OnStreamEvent` parameter to `runExecution()`, `handleHumanTurn()`, `handleTransition()` — alongside existing `onToken` / `onNewMessage` (keep both for now)
- [x] 4.2 In the main streaming loop (`for await (const event of retryStream(...))`):
  - `token` → call `onStreamEvent({ type: "text_chunk", content: event.content, ... })`
  - `reasoning` → call `onStreamEvent({ type: "reasoning_chunk", content: event.content, ... })`
  - `status` → call `onStreamEvent({ type: "status_chunk", content: event.content, ... })`
- [x] 4.3 When preamble text is flushed to DB (lines ~1539-1559): also emit `onStreamEvent({ type: "assistant", content: fullResponse, ... })`
- [x] 4.4 When reasoning is persisted to DB: also emit `onStreamEvent({ type: "reasoning", content: reasoningAccum, ... })`
- [x] 4.5 When tool_call is persisted: also emit `onStreamEvent({ type: "tool_call", content: toolCallMsg, metadata: toolMeta, ... })`
- [x] 4.6 When tool_result is persisted: also emit `onStreamEvent({ type: "tool_result", content: resultContent, metadata: resultMeta, ... })`
- [x] 4.7 When file_diff is persisted: also emit `onStreamEvent({ type: "file_diff", content: diffContent, metadata: diffMeta, ... })`
- [x] 4.8 In `handleCancelled()`: emit `onStreamEvent({ type: "done", done: true, ... })` — fixes the missing cleanup that caused ghost reasoning bubbles
- [x] 4.9 On normal completion: emit `onStreamEvent({ type: "done", done: true, ... })`

## 5. Engine integration — orchestrator (`orchestrator.ts`)

- [x] 5.1 Add `onStreamEvent: OnStreamEvent` parameter to `consumeStream()`
- [x] 5.2 `token` event → `onStreamEvent({ type: "text_chunk", ... })`; also accumulate in `tokenAccum`
- [x] 5.3 `reasoning` event → `onStreamEvent({ type: "reasoning_chunk", ... })`; also accumulate in `reasoningAccum`
- [x] 5.4 `tool_start` event: **flush `tokenAccum` first** (emit `assistant` event + persist) before emitting `tool_call` — fixes the text-below-tools ordering bug
- [x] 5.5 `tool_start` → emit `onStreamEvent({ type: "tool_call", ... })`
- [x] 5.6 `tool_result` → emit `onStreamEvent({ type: "tool_result", ... })`
- [x] 5.7 Cancel path (line ~773): **flush `tokenAccum` first**, then emit `onStreamEvent({ type: "done", done: true })` — fixes text-disappears-on-cancel bug
- [x] 5.8 `done` event: flush remaining `tokenAccum` → emit `assistant`, then emit `onStreamEvent({ type: "done", done: true })`

## 6. Subagent pipeline integration

- [x] 6.1 Add `onStreamEvent?: OnStreamEvent` parameter to `runSubExecution()`
- [x] 6.2 In `runSubExecution()`'s streaming loop, emit events via `onStreamEvent` with `subagentId` set (e.g., `"agent-{idx+1}"`) and `blockId` prefixed with `"sa{n}-"`
- [x] 6.3 In the parent `runExecution()`, when calling `runSubExecution()`, pass a wrapped `onStreamEvent` that inserts a `subagent_start` event before and `subagent_done` event after the subagent's events

## 7. Wire batcher into `index.ts`

- [x] 7.1 In `src/bun/index.ts`, create one `StreamBatcher` per execution when `handleHumanTurn()` / `runExecution()` is called
- [x] 7.2 `onFlush` callback: send the batch via `win.webview.rpc.send["stream.event"](event)` for each event in the batch
- [x] 7.3 For `text_chunk`, `reasoning_chunk`, `status_chunk`: also send immediately via IPC (before buffering) so frontend gets real-time tokens
- [x] 7.4 Pass `batcher.push` as the `onStreamEvent` callback to engine functions
- [x] 7.5 On execution complete/cancel: call `batcher.stop()` to trigger final flush
- [x] 7.6 Keep existing `onToken` and `onNewMessage` wiring in place (deprecated path, still needed until frontend migration complete)

## 8. Frontend — shared types and IPC wiring

- [x] 8.1 In `src/mainview/rpc.ts`, add `"stream.event"` handler alongside existing handlers:
  ```ts
  "stream.event": (event) => _onStreamEvent(event)
  ```
  Keep `stream.token` and `message.new` handlers in place
- [x] 8.2 Export `onStreamEvent(cb)` registration function

## 9. Frontend store — per-task stream state

- [x] 9.1 In `src/mainview/stores/task.ts`, add:
  ```ts
  const streamStates = ref(new Map<number, TaskStreamState>())
  ```
  alongside existing global refs (keep old refs in place until drawer is migrated)
- [x] 9.2 Implement `onStreamEvent(event: StreamEvent)`:
  - On `text_chunk` / `reasoning_chunk` / `status_chunk`: find or create `TaskStreamState` for `event.taskId`; find or create block by `blockId`; append `content` to block's accumulated content
  - On persisted types (`assistant`, `reasoning`, `tool_call`, etc.): upsert block with full content + `isStreaming = false`
  - On `done`: set `isDone = true` on `TaskStreamState`; set all blocks' `isStreaming = false`
- [x] 9.3 Register `onStreamEvent` callback in App.vue setup
- [x] 9.4 Update `loadMessages(taskId)`: keep fetching from `conversation_messages` as before (backward compat); merge with stream state when a live stream is ongoing
- [x] 9.5 Update `closeTask()`: do NOT clear `streamStates` for the streaming task — buffer continues accumulating when drawer is closed; cleared only when `done` fires

## 10. New RPC endpoint — `conversations.getStreamEvents`

- [x] 10.1 In `src/shared/rpc-types.ts`, add request/response types for `conversations.getStreamEvents`
- [x] 10.2 In the bun RPC handler, implement: `SELECT * FROM stream_events WHERE task_id = ? ORDER BY seq ASC`; return rows as `PersistedStreamEvent[]`

## 11. Frontend — `TaskDetailDrawer.vue` timeline rewrite

- [x] 11.1 Add computed `activeStreamState` = `streamStates.get(activeTaskId)` (in task store)
- [x] 11.2 Keep `displayItems` computed for DB-persisted messages; add unified live stream section using `activeStreamState.blockOrder`
- [x] 11.3 Remove the three separate live bubble template sections; replaced by unified `blockOrder` loop
- [x] 11.4 `hasLiveContent` computed suppresses the "Thinking…" spinner when stream blocks are present
- [x] 11.5 `SubagentBlock.vue` component — subsumed by recursive StreamBlockNode.vue (subagent events render as children via parentBlockId)

## 12. UI Tests — Suite T (new scenarios)

- [x] 12.1 Add `/queue-stream-events` endpoint to the debug server
- [x] 12.2 Add bridge helpers for stream events
- [x] 12.3 Add block inspection helpers to bridge
- [x] 12.4 Create `src/ui-tests/timeline-pipeline.test.ts` — Suite T scenarios T-28 through T-34

## 13. Regression and cleanup

- [x] 13.1 Run `bun test src/bun/test --timeout 20000` — all existing backend tests pass (7 pre-existing failures unchanged)
- [x] 13.2 Run `bun test src/bun/pipeline/batcher.test.ts` — 6 batcher unit tests pass
- [x] 13.3 Run `bun test src/mainview/utils/pairToolMessages.test.ts` — pairing tests still pass
- [x] 13.4 UI tests — updated for tree model (blockOrder → roots, parentBlockId, tool_result merge)
- [x] 13.5 Build passes cleanly (`bun run build:canary`)
- [x] 13.6 Created backlog task concept: remove `conversation_messages` table after this ships

## 14. Deprecation markers

- [x] 14.1 In `src/shared/rpc-types.ts`, mark `StreamToken`, `"stream.token"`, `"message.new"` as `@deprecated`
- [x] 14.2 In `src/mainview/stores/task.ts`, mark legacy streaming refs as `@deprecated` (kept for fallback path)
- [x] 14.3 In `src/bun/workflow/engine.ts`, mark `OnToken`, `OnNewMessage` as `@deprecated`

## 15. `parentBlockId` — type and DB schema update

- [x] 15.1 In `src/shared/rpc-types.ts`: replace `subagentId: string | null` with `parentBlockId: string | null` on `StreamEvent`
- [x] 15.2 In `src/bun/db/migrations.ts`: add `parent_block_id TEXT` column to `stream_events` table migration (add `ALTER TABLE` for existing DBs)
- [x] 15.3 In `src/bun/db/stream-events.ts`: update `PersistedStreamEvent` type to include `parentBlockId: string | null`; update `appendStreamEventBatch` and `getStreamEvents` to read/write the new column
- [x] 15.4 In `src/bun/pipeline/batcher.ts`: forward `parentBlockId` from the pushed partial event to the emitted `StreamEvent` (batcher should not change it)

## 16. Orchestrator context stack — `parentBlockId` propagation

- [x] 16.1 In `src/bun/engine/orchestrator.ts` `consumeStream()`: add `const callStack: string[] = []` at the top of the loop
- [x] 16.2 On `tool_start` (non-internal): set `parentBlockId = event.parentCallId ?? null` on the emitted `tool_call` StreamEvent; push `callId` to `callStack`
- [x] 16.3 On `tool_result` (non-internal): set `parentBlockId = event.parentCallId ?? null` on the emitted `tool_result` StreamEvent; pop from `callStack`
- [x] 16.4 On `token` / `reasoning` events: set `parentBlockId = callStack.at(-1) ?? null` on the emitted `text_chunk` / `reasoning_chunk` StreamEvent; also use this `parentBlockId` when flushing the accumulated `assistant` / `reasoning` persisted event

## 17. ScriptedEngine — `parentCallId` support for tests

- [x] 17.1 In `src/bun/test/support/scripted-engine.ts`: add optional `parentCallId?: string` and `isInternal?: boolean` to `scriptToolStart()` and `scriptToolResult()` methods
- [x] 17.2 Propagate `parentCallId` / `isInternal` through to the emitted `EngineEvent`

## 18. Integration tests — hierarchy scenarios

- [x] 18.1 **S-14**: Simple text → single root assistant block
- [x] 18.2 **S-15**: Reasoning + text → two ordered roots
- [x] 18.3 **S-16**: Text → tool → text → three ordered roots
- [x] 18.4 **S-17**: Cancel mid-text flushes assistant block into tree
- [x] 18.5 **S-18**: Reasoning inside tool call hangs off tool block as child
- [x] 18.6 **S-19**: Nested tool calls produce parent–child hierarchy

## 19. Frontend store — tree model

- [x] 19.1 In `src/mainview/stores/task.ts`: replace `blockOrder: string[]` with `roots: string[]` (root-level block IDs only) in `TaskStreamState`
- [x] 19.2 Add `parentBlockId: string | null` and `children: string[]` to `StreamBlock`
- [x] 19.3 Update `onStreamEvent` handler: on new block creation, if `parentBlockId` is set AND parent block found → push blockId to `parent.children`; if `parentBlockId` set but parent NOT found (orphan from filtered internal tool) → push to `roots`; if `parentBlockId` null → push to `roots`
- [x] 19.4 Update `loadMessages` / `conversations.getStreamEvents` reconstruction: use `parent_block_id` from DB to rebuild tree (same orphan promotion rule)
- [x] 19.5 Remove `subagentId` from `StreamBlock` (hierarchy is now expressed via `parentBlockId` + `children`)

## 20. Frontend timeline renderer — recursive render

- [x] 20.1 In `TaskDetailDrawer.vue`: replace flat `blockOrder` iteration with recursive `renderBlock(blockId)` function that walks `roots[]` and each block's `children[]`
- [x] 20.2 A `tool_call` block renders itself as a collapsible; its `children[]` are rendered inside the collapsible body (nested reasoning bubbles, nested tool calls, etc.)
- [x] 20.3 `ReasoningBubble`: `isStreaming` prop drives open/closed state; collapses when `isStreaming` becomes false
- [x] 20.4 Remove `SubagentBlock.vue` if created — the recursive renderer subsumes it (no-op, never existed)
- [x] 20.5 Remove the separate `v-if` live bubble sections (ReasoningBubble, StreamingBubble above the list) — live blocks are now part of the unified `roots[]` render pass

## 21. Regression

- [x] 21.1 `bun test src/bun/test --timeout 20000` — all existing + new S-14 to S-19 pass (491/498 pass; 7 pre-existing failures unrelated to this change)
- [x] 21.2 `bun run build:canary` — build passes

