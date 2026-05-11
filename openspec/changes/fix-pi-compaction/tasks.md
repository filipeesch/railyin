## 1. Pi Engine — Auto-compact

- [x] 1.1 Add `DEFAULT_RESERVE_TOKENS = 16_384` constant to `src/bun/engine/pi/engine.ts`
- [x] 1.2 Change `getOrCreateSession` visibility from `private` to `protected` (enables test seam for companion `fix-pi-compaction-tests` change)
- [x] 1.3 In `createManagedExecution`, chain a `.then(async () => { ... })` on `session.prompt()` — before `.finally(() => queue.close())` — that checks `session.getContextUsage().tokens > piModel.contextWindow - DEFAULT_RESERVE_TOKENS && !session.isCompacting`, and if true calls `await session.compact()` inside a try/catch that logs failures with `[pi] auto-compact failed:`

## 2. Pi Engine — Manual Compact

- [x] 2.1 In `engine.compact()`, replace the `if (!session) { warn; return }` block with: call `getOrCreateSession(conversationId, this.buildModel(), [], undefined, workingDirectory)` to restore the session from disk, store it in `this.sessions`, and continue
- [x] 2.2 In `engine.compact()`, after session is guaranteed, add `if (session.isCompacting) throw new Error("Compaction already in progress")`
- [x] 2.3 In `engine.compact()`, rethrow caught errors (change `catch` to log and rethrow) so the orchestrator can surface them

## 3. Stream Processor — compaction_done Bug Fix

- [x] 3.1 In `src/bun/engine/stream/stream-processor.ts`, in the `compaction_done` handler, replace `content: ""` with `content: event.summary ?? ""` when creating the `compaction_summary` message

## 4. Orchestrator — Post-compact Broadcast

- [x] 4.1 In `src/bun/engine/orchestrator.ts`, after `await engine.compact(...)` in both `compactTask()` and `compactConversation()`, query the last `compaction_summary` row for that `conversationId` from `conversation_messages` and call `this.onNewMessage(mapConversationMessage(row))` to broadcast it via WebSocket

## 5. Frontend — Gauge Refresh on compaction_summary

- [x] 5.1 In `src/mainview/stores/conversation.ts`, in the `message.new` handler (or `onNewMessage` function), when the received message has `type === "compaction_summary"`, call `fetchContextUsage({ conversationId: message.conversationId })`

## 6. Verification

- [x] 6.1 Run backend tests: `bun test src/bun/test --timeout 20000` — confirm no regressions
- [x] 6.2 Manual smoke test: trigger manual compact when no live session exists (e.g., restart server, click Compact) — confirm it succeeds and summary appears
- [x] 6.3 Manual smoke test: let context gauge reach >80%, send another message — confirm auto-compact fires and a `compaction_summary` appears in the timeline
