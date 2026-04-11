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
- [ ] 1.3 Verify migration runs cleanly on a fresh in-memory DB (`bun run dev:test`)

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

- [ ] 6.1 Add `onStreamEvent?: OnStreamEvent` parameter to `runSubExecution()`
- [ ] 6.2 In `runSubExecution()`'s streaming loop, emit events via `onStreamEvent` with `subagentId` set (e.g., `"agent-{idx+1}"`) and `blockId` prefixed with `"sa{n}-"`
- [ ] 6.3 In the parent `runExecution()`, when calling `runSubExecution()`, pass a wrapped `onStreamEvent` that inserts a `subagent_start` event before and `subagent_done` event after the subagent's events

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
- [ ] 11.5 `SubagentBlock.vue` component — deferred to subagent task (Task 6)

## 12. UI Tests — Suite T (new scenarios)

- [ ] 12.1 Add `/queue-stream-events` endpoint to the debug server
- [ ] 12.2 Add bridge helpers for stream events
- [ ] 12.3 Add block inspection helpers to bridge
- [ ] 12.4 Create `src/ui-tests/timeline-pipeline.test.ts` — Suite T scenarios T-28 through T-34

## 13. Regression and cleanup

- [x] 13.1 Run `bun test src/bun/test --timeout 20000` — all existing backend tests pass (7 pre-existing failures unchanged)
- [x] 13.2 Run `bun test src/bun/pipeline/batcher.test.ts` — 6 batcher unit tests pass
- [ ] 13.3 Run `bun test src/mainview/utils/pairToolMessages.test.ts` — pairing tests still pass
- [ ] 13.4 UI tests — deferred (require debug server wiring from Task 12)
- [x] 13.5 Build passes cleanly (`bun run build:canary`)
- [x] 13.6 Created backlog task concept: remove `conversation_messages` table after this ships

## 14. Deprecation markers

- [x] 14.1 In `src/shared/rpc-types.ts`, mark `StreamToken`, `"stream.token"`, `"message.new"` as `@deprecated`
- [x] 14.2 In `src/mainview/stores/task.ts`, mark legacy streaming refs as `@deprecated` (kept for fallback path)
- [x] 14.3 In `src/bun/workflow/engine.ts`, mark `OnToken`, `OnNewMessage` as `@deprecated`
  - `appendStreamEvent(event: PersistedStreamEvent): number` — inserts one row, returns id
  - `appendStreamEventBatch(events: PersistedStreamEvent[]): void` — inserts a batch in a transaction
  - `getStreamEvents(taskId: number): PersistedStreamEvent[]` — SELECT ordered by seq ASC
  - `PersistedStreamEvent` type (matches the table columns)
- [ ] 1.3 Verify migration runs cleanly on a fresh in-memory DB (`bun run dev:test`)

## 2. Shared `StreamEvent` type

- [ ] 2.1 In `src/shared/rpc-types.ts`, add:
  - `StreamEvent` interface (taskId, executionId, seq, blockId, type, content, metadata, subagentId, done)
  - `StreamEventType` union type
  - New IPC channel: `"stream.event": StreamEvent`
  - Keep `StreamToken` and `"stream.token"` / `"message.new"` channels in place for now (deprecated, removed in follow-up)
- [ ] 2.2 In `src/bun/workflow/engine.ts`, add `OnStreamEvent` callback type:
  ```ts
  export type OnStreamEvent = (event: StreamEvent) => void;
  ```

## 3. Batcher (bun side)

- [ ] 3.1 Create `src/bun/pipeline/batcher.ts`:
  - `class StreamBatcher` with constructor `(taskId, executionId, onFlush: (events: StreamEvent[]) => void)`
  - `push(partialEvent)` — assigns `seq`, sets `blockId` using block counters, appends to buffer
  - `flush()` — writes persisted-type events to DB via `appendStreamEventBatch()`, calls `onFlush(buffer)`, clears buffer
  - `start()` — starts 500ms interval timer calling `flush()`
  - `stop()` — clears timer, calls final `flush()`
  - Block counter logic: maintains `Map<"t"|"r"|"sa", number>` — increments when event type switches within a round
  - `blockId` generation per Decision 2 in design.md
- [ ] 3.2 Unit test `src/bun/pipeline/batcher.test.ts`:
  - Test: text chunks → single text block, correct blockId
  - Test: reasoning then text → two different blockIds
  - Test: interleaved reasoning/text → separate blockId per block
  - Test: done event triggers immediate flush (no waiting for 500ms)
  - Test: seq is monotonically increasing across multiple pushes

## 4. Engine integration — native engine (`engine.ts`)

- [ ] 4.1 Add `onStreamEvent: OnStreamEvent` parameter to `runExecution()`, `handleHumanTurn()`, `handleTransition()` — alongside existing `onToken` / `onNewMessage` (keep both for now)
- [ ] 4.2 In the main streaming loop (`for await (const event of retryStream(...))`):
  - `token` → call `onStreamEvent({ type: "text_chunk", content: event.content, ... })`
  - `reasoning` → call `onStreamEvent({ type: "reasoning_chunk", content: event.content, ... })`
  - `status` → call `onStreamEvent({ type: "status_chunk", content: event.content, ... })`
- [ ] 4.3 When preamble text is flushed to DB (lines ~1539-1559): also emit `onStreamEvent({ type: "assistant", content: fullResponse, ... })`
- [ ] 4.4 When reasoning is persisted to DB: also emit `onStreamEvent({ type: "reasoning", content: reasoningAccum, ... })`
- [ ] 4.5 When tool_call is persisted: also emit `onStreamEvent({ type: "tool_call", content: toolCallMsg, metadata: toolMeta, ... })`
- [ ] 4.6 When tool_result is persisted: also emit `onStreamEvent({ type: "tool_result", content: resultContent, metadata: resultMeta, ... })`
- [ ] 4.7 When file_diff is persisted: also emit `onStreamEvent({ type: "file_diff", content: diffContent, metadata: diffMeta, ... })`
- [ ] 4.8 In `handleCancelled()`: emit `onStreamEvent({ type: "done", done: true, ... })` — fixes the missing cleanup that caused ghost reasoning bubbles
- [ ] 4.9 On normal completion: emit `onStreamEvent({ type: "done", done: true, ... })`

## 5. Engine integration — orchestrator (`orchestrator.ts`)

- [ ] 5.1 Add `onStreamEvent: OnStreamEvent` parameter to `consumeStream()`
- [ ] 5.2 `token` event → `onStreamEvent({ type: "text_chunk", ... })`; also accumulate in `tokenAccum`
- [ ] 5.3 `reasoning` event → `onStreamEvent({ type: "reasoning_chunk", ... })`; also accumulate in `reasoningAccum`
- [ ] 5.4 `tool_start` event: **flush `tokenAccum` first** (emit `assistant` event + persist) before emitting `tool_call` — fixes the text-below-tools ordering bug
- [ ] 5.5 `tool_start` → emit `onStreamEvent({ type: "tool_call", ... })`
- [ ] 5.6 `tool_result` → emit `onStreamEvent({ type: "tool_result", ... })`
- [ ] 5.7 Cancel path (line ~773): **flush `tokenAccum` first**, then emit `onStreamEvent({ type: "done", done: true })` — fixes text-disappears-on-cancel bug
- [ ] 5.8 `done` event: flush remaining `tokenAccum` → emit `assistant`, then emit `onStreamEvent({ type: "done", done: true })`

## 6. Subagent pipeline integration

- [ ] 6.1 Add `onStreamEvent?: OnStreamEvent` parameter to `runSubExecution()`
- [ ] 6.2 In `runSubExecution()`'s streaming loop, emit events via `onStreamEvent` with `subagentId` set (e.g., `"agent-{idx+1}"`) and `blockId` prefixed with `"sa{n}-"`
- [ ] 6.3 In the parent `runExecution()`, when calling `runSubExecution()`, pass a wrapped `onStreamEvent` that inserts a `subagent_start` event before and `subagent_done` event after the subagent's events

## 7. Wire batcher into `index.ts`

- [ ] 7.1 In `src/bun/index.ts`, create one `StreamBatcher` per execution when `handleHumanTurn()` / `runExecution()` is called
- [ ] 7.2 `onFlush` callback: send the batch via `win.webview.rpc.send["stream.event"](event)` for each event in the batch
- [ ] 7.3 For `text_chunk`, `reasoning_chunk`, `status_chunk`: also send immediately via IPC (before buffering) so frontend gets real-time tokens
- [ ] 7.4 Pass `batcher.push` as the `onStreamEvent` callback to engine functions
- [ ] 7.5 On execution complete/cancel: call `batcher.stop()` to trigger final flush
- [ ] 7.6 Keep existing `onToken` and `onNewMessage` wiring in place (deprecated path, still needed until frontend migration complete)

## 8. Frontend — shared types and IPC wiring

- [ ] 8.1 In `src/mainview/rpc.ts`, add `"stream.event"` handler alongside existing handlers:
  ```ts
  "stream.event": (event) => _onStreamEvent(event)
  ```
  Keep `stream.token` and `message.new` handlers in place
- [ ] 8.2 Export `onStreamEvent(cb)` registration function

## 9. Frontend store — per-task stream state

- [ ] 9.1 In `src/mainview/stores/task.ts`, add:
  ```ts
  const streamStates = ref(new Map<number, TaskStreamState>())
  ```
  alongside existing global refs (keep old refs in place until drawer is migrated)
- [ ] 9.2 Implement `onStreamEvent(event: StreamEvent)`:
  - On `text_chunk` / `reasoning_chunk` / `status_chunk`: find or create `TaskStreamState` for `event.taskId`; find or create block by `blockId`; append `content` to block's accumulated content
  - On persisted types (`assistant`, `reasoning`, `tool_call`, etc.): upsert block with full content + `isStreaming = false`
  - On `done`: set `isDone = true` on `TaskStreamState`; set all blocks' `isStreaming = false`
- [ ] 9.3 Register `onStreamEvent` callback in the store's `init()` or equivalent setup
- [ ] 9.4 Update `loadMessages(taskId)`:
  - Fetch from `stream_events` table via new RPC method `conversations.getStreamEvents({ taskId })`
  - Build `TaskStreamState` from DB rows (each row is a block)
  - Keep fetching from `conversation_messages` as fallback for tasks with no `stream_events` rows yet (backward compat)
- [ ] 9.5 Update `closeTask()`: do NOT clear `streamStates` for the streaming task — buffer continues accumulating when drawer is closed; cleared only when `done` fires

## 10. New RPC endpoint — `conversations.getStreamEvents`

- [ ] 10.1 In `src/shared/rpc-types.ts`, add request/response types for `conversations.getStreamEvents`
- [ ] 10.2 In the bun RPC handler, implement: `SELECT * FROM stream_events WHERE task_id = ? ORDER BY seq ASC`; return rows as `PersistedStreamEvent[]`

## 11. Frontend — `TaskDetailDrawer.vue` timeline rewrite

- [ ] 11.1 Add computed `activeStreamState` = `streamStates.get(activeTaskId)` 
- [ ] 11.2 Replace `displayItems` computed: instead of building from `messages.value` + pairing tool messages, iterate `activeStreamState.blockOrder` to build display items:
  - `"text_chunk"` / `"assistant"` block → `{ kind: "text", content, isStreaming }`
  - `"reasoning_chunk"` / `"reasoning"` block → `{ kind: "reasoning", content, isStreaming }`
  - `"tool_call"` block → `{ kind: "tool_entry", ... }` (same ToolEntry shape as before)
  - `"subagent"` block → `{ kind: "subagent", subagentId, children: [...] }`
  - `"user"` block → `{ kind: "single", message }`
  - `"system"` block → `{ kind: "single", message }`
- [ ] 11.3 Remove the three separate live bubble template sections (`ReasoningBubble v-if`, `StreamingBubble v-if`) — they are replaced by the unified `displayItems` which includes live blocks
- [ ] 11.4 Add `SubagentBlock.vue` component: collapsible (same pattern as `ToolCallGroup.vue`) that renders its children using the same display item loop
- [ ] 11.5 `ReasoningBubble` and `StreamingBubble`: pass `isStreaming` prop from block state; auto-collapse when `isStreaming` becomes false
- [ ] 11.6 Keep `pairToolMessages` import for tool_call blocks — the block's messages are still paired by call ID (no change to pairing logic)

## 12. UI Tests — Suite T (new scenarios)

- [ ] 12.1 Add `/queue-stream-events` endpoint to the debug server in `src/bun/index.ts` — accepts a JSON array of `FakeStep` items and queues them via `queueStreamStep()`; also add `/reset-fake-ai` endpoint
- [ ] 12.2 Add `queueStreamEvents(steps)` and `resetFakeAI()` bridge helpers to `src/ui-tests/bridge.ts`
- [ ] 12.3 Add helpers to bridge: `getStreamBlockCount(taskId)`, `getStreamBlockOrder(taskId)`, `isReasoningBubbleVisible()`, `isStreamingBubbleVisible()`
- [ ] 12.4 Create `src/ui-tests/timeline-pipeline.test.ts` — Suite T:
  - **T-28**: preamble text appears ABOVE tool calls — script: `[text("preamble"), tool_calls([read_file]), text("summary")]`; assert DOM order is user → assistant(preamble) → tool-entry → assistant(summary)
  - **T-29**: cancel mid-stream → text not lost — start stream, cancel after first text block, reopen drawer; assert text block visible in timeline
  - **T-30**: cancel → no ghost reasoning on next run — script reasoning + tool + text; cancel immediately; re-run; assert only one reasoning bubble
  - **T-31**: reasoning bubble hidden while final text streams — assert reasoning `isStreaming=false` when text block starts
  - **T-32**: close drawer mid-stream → reopen → conversation complete — close drawer during stream, wait for done, reopen; assert all blocks visible
  - **T-33**: two tasks stream concurrently → no cross-contamination — start Task A stream, open Task B, send Task B message; assert Task B's drawer shows only Task B tokens
  - **T-34**: subagent block visible and collapsible — seed a subagent execution; assert `SubagentBlock` is in DOM; expand it; assert child tool calls visible

## 13. Regression and cleanup

- [ ] 13.1 Run `bun test src/bun/test --timeout 20000` — all existing backend tests pass
- [ ] 13.2 Run `bun test src/bun/pipeline/batcher.test.ts` — batcher unit tests pass
- [ ] 13.3 Run `bun test src/mainview/utils/pairToolMessages.test.ts` — pairing tests still pass
- [ ] 13.4 Run `bun test src/ui-tests/timeline-pipeline.test.ts --timeout 120000` — all Suite T tests pass
- [ ] 13.5 Run `bun test src/ui-tests/chat.test.ts src/ui-tests/extended-chat.test.ts src/ui-tests/tool-rendering.test.ts --timeout 120000` — existing suites M, N, O, P, Q, R, S still pass
- [ ] 13.6 Create backlog task: "Remove `conversation_messages` table and all references" — to be done after this change ships and is stable

## 14. Deprecation markers

- [ ] 14.1 In `src/shared/rpc-types.ts`, mark `StreamToken`, `"stream.token"`, `"message.new"` as `@deprecated`
- [ ] 14.2 In `src/mainview/stores/task.ts`, mark `streamingToken`, `streamingReasoningToken`, `streamingTaskId`, `isStreamingReasoning`, `streamingStatusMessage` as `@deprecated`
- [ ] 14.3 In `src/bun/workflow/engine.ts`, mark `OnToken`, `OnNewMessage` as `@deprecated`
