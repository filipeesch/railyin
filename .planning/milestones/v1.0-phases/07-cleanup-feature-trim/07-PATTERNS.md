# Phase 7: Cleanup & Feature Trim - Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 38 new/modified/deleted targets classified
**Analogs found:** 34 / 38 (4 are pure deletes with self-evident inventory — see "No Analog Needed")

**Phase character:** pure deletion + surgical rewrite. The pattern sources are almost always **the files themselves** (surgical strip) or their direct wiring neighbors (index.ts, notifications.ts, rpc-types.ts). Zero new packages, zero migrations.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/bun/engine/stream/stream-processor.ts` | service (engine state machine) | event-driven | file itself (surgical rewrite) + `orchestrator.ts` ctor wiring | exact |
| `src/bun/server/stream-processor.ts` | service (WS pipeline) | streaming → pub-sub | file itself (whole-module delete; wiring in `index.ts:142,238-244`) | exact |
| `src/bun/server/notifications.ts` | service (push) | pub-sub | file itself — `notifyChatSessionUpdated` already exists (:28-30) | exact |
| `src/bun/index.ts` | config (composition root) | — | file itself — env-flag precedent `RAILYN_COPILOTKIT_PROBE` (:262), handler map (:319-347) | exact |
| `src/shared/rpc-types.ts` | config (shared contract) | — | file itself — trim regions verified (:95-108, :619-652, :781, :785, :817, :823, :871, :961, :1103, :1196-1204) | exact |
| `src/bun/engine/types.ts` | config (engine contract) | — | file itself — EngineEvent (:20-50), EngineResumeInput (:60-62) | exact |
| `src/bun/engine/orchestrator.ts` | service (coordinator) | event-driven | file itself (:70-72, :81, :92, :180-182, :272-316, :318-355) | exact |
| `src/mainview/stores/chat.ts` | store | pub-sub consumer | file itself — keep `onChatSessionUpdated` (:43-70), strip queue/live-block layer | exact |
| `src/mainview/stores/conversation.ts` | store | pub-sub consumer | file itself — keep loading gate, strip stream machinery (:29-46, :99-111, :253-408) | exact |
| `src/mainview/stores/task.ts` | store | pub-sub consumer | file itself — strip `onTaskStreamEvent` (:450-460), `compactTask` (:359), `fetchContextUsage` (:262) | exact |
| `src/mainview/rpc.ts` | utility (transport) | request-response + pub-sub | file itself — ws dispatch (:90-103), push callbacks (:41-60) | exact |
| `src/mainview/App.vue` | component (root) | pub-sub consumer | file itself — wiring (:49-81) | exact |
| `src/bun/engine/execution/code-review-executor.ts` | service (executor) | event-driven | file itself — excise :146-147, rework :208 | exact |
| `src/bun/engine/execution/transition-executor.ts` | service (executor) | event-driven | file itself — excise :76, :97 | exact |
| `src/bun/engine/execution/chat-executor.ts` + `human-turn-executor.ts` + `retry-executor.ts` | service (executor) | event-driven | file itself — appendMessage + response-contract rework | exact |
| `src/bun/engine/claude/{adapter,engine,events}.ts` | service (engine adapter) | event-driven | file itself — emitters (:201-205, :378; :45, :107-128; :200-217, :260-315) | exact |
| `src/bun/engine/opencode/engine.ts` + `adapter.ts` | service (engine adapter) | event-driven | file itself — waitForResume (:128-136), ask_user emitters | exact |
| `src/bun/engine/copilot/events.ts`, `cursor/translate-events.ts`, `opencode/event-translator.ts` | service (translator) | event-driven | file itself — trimmed-event emitters | exact |
| `src/bun/copilotkit/event-bridge.ts` | service (translator) | streaming → event-driven | file itself — drop-list (:280-289) | exact |
| `src/bun/handlers/legacy-import.ts` | handler | request-response | file itself (:16-20) + `index.ts:343` | exact |
| `src/bun/handlers/{conversations,tasks,chat-sessions,engine}.ts` | handler | request-response | file themselves — RPC removal with shared-contract discipline | role-match |
| `src/bun/conversation/messages.ts` | utility (DB write helper) | CRUD | file itself — `appendMessage` (:4-19) **decision point** | exact |
| `src/bun/context-usage.ts` | service | CRUD | file itself — `resolveContextWindow` (:7-34) **KEEPS**; `estimateConversationContextUsage` (:36-42) dies | exact |
| `src/bun/conversation/context-estimator.ts` | service | CRUD | **KEEPS** — live importer `cross-engine-context.ts:5,57` (research Group C correction) | exact |
| `src/bun/pipeline/write-buffer.ts` | utility (batching) | batch | file itself — `WaitFn` type only importer `retention-job.ts:2` stays | exact |
| `src/bun/engine/claude/bash-permission-gate.ts` | service | request-response | file itself (whole-module delete, :30-67) | exact |
| `src/bun/engine/claude/file-state-cache.ts` | service | CRUD | file itself (whole-module delete; feed chain verified: events.ts:200-217, :260-315) | exact |
| `e2e/api/smoke.test.ts` | test | request-response | **analog: `e2e/api/copilotkit/legacy-import.test.ts`** — the existing JSONL-on-disk assertion pattern (:104-114) | role-match |
| `e2e/api/copilotkit/legacy-import.test.ts` | test | request-response | file itself — spawn (:93) + fixture `server.ts` extraEnv (:160-186) | exact |
| `e2e/api/fixtures/server.ts` | test fixture | — | file itself — `StartServerOptions` (:23-58), `copilotkitProbe` precedent (:33-38, :184-186) | exact |
| `e2e/ui/fixtures/mock-ws.ts` | test fixture | pub-sub | file itself — keep `push` (:49-56) + `pushChatSessionUpdated` (:98-100), strip :59-95 | exact |
| `src/mainview/stores/{chat,conversation,task,dispatch}.test.ts` | test | pub-sub consumer | file themselves — strip coverage mirroring the store strips | exact |
| `src/bun/test/*` pipeline tests (12 files) | test | event-driven | file themselves + `backend-rpc-runtime.ts` rework | exact |
| `src/mainview/components/chat/ChatThreadSidebar.vue` | component | request-response | file itself — legacy-import button (:38-45, :281) + flag visibility | exact |
| `src/bun/copilotkit/import.ts` | service | CRUD (SELECT-only) | **stays untouched** (reads are permanent) | — |

---

## Pattern Assignments

### `src/bun/engine/stream/stream-processor.ts` (service, event-driven) — THE critical rewrite

**Analog:** the file itself. `consume()` (:145-622) is the single execution state machine for ALL runs (task, session, AG-UI). It must NOT be deleted — only surgically stripped of the legacy write paths.

**Imports pattern** (lines 1-17) — what dies vs stays:
```typescript
import type { OnStreamEvent, OnNewMessage } from "../types.ts";   // types die with protocol
import type { MessageType } from "../../../shared/rpc-types.ts";  // keep (decision_request_prompt stays)
import { ConvMessageBuffer } from "../../conversation/conv-message-buffer.ts"; // :14 — whole import dies
import type { WriteBuffer } from "../../pipeline/write-buffer.ts"; // :15 — dies with rawBuffer ctor arg
import type { RawMessageItem } from "./raw-message-buffer.ts";     // :16 — dies
```

**Constructor contract** (:52-61) — `rawBuffer` ctor arg dies; the orchestrator's `onRawMessageEnqueued` 7th arg (index.ts:235) becomes removable:
```typescript
constructor(
  private readonly db: Database,
  private readonly rawBuffer: WriteBuffer<RawMessageItem>,  // ← delete (D-04 model_raw_messages write)
  private readonly onToken: OnToken,
  private readonly onError: OnError,                        // stays (feeds notifier.onError → /ws decision)
  private readonly onTaskUpdated: OnTaskUpdated,
  private readonly onNewMessage: OnNewMessage,              // ← delete (message.new push dies)
  private readonly onDeferredTransition: ...,               // stays
  private readonly onPendingMessage: ...,                   // stays
) {}
```

**markClaudeExecution block** (:47-75) — D-03 deletion target; also `claudeExecutionIds` skip logic at :223 and :234, `clearClaudeExecution` (:73-75, :593):
```typescript
private onStreamEvent?: OnStreamEvent;          // :47 ← delete
private readonly claudeExecutionIds = new Set<number>();  // :50 ← delete (D-03)
setOnStreamEvent(cb: OnStreamEvent): void {...} // :63-65 ← delete
markClaudeExecution(executionId: number): void  // :68-70 ← delete
```

**KEEP in consume()** — the live board/session lifecycle (verbatim, these DB updates stay):
```typescript
// :176-184 — run start
if (taskId != null) {
  db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
} else {
  db.run("UPDATE chat_sessions SET status = 'running' WHERE conversation_id = ?", [conversationId]);
}
db.run("UPDATE executions SET status = 'running', started_at = datetime('now') WHERE id = ?", [executionId]);
// :210 — the AG-UI bridge tap (BRDG-01) stays FIRST in the loop
opts?.onEngineEvent?.(event);
// :439-447 — done case DB updates; :448 onToken done; :450 opts?.onRunEnd?.("done")
// :454-475 — error case (fatal: task failed / session idle / executions failed, :455-470; non-fatal :471-474 minus convBuffer)
// :494-523 — decision_request case (the ONLY live HITL) — keep flush+enqueue structure, remove convBuffer
// :541-549 — task_updated / new_message cases (minus onNewMessage for new_message)
// :590-621 — finally block (pending_messages drain + deferred transition + final task push) — KEEP WHOLE
```

**REMOVE from consume()** — the frozen-table write paths:
- `const convBuffer = new ConvMessageBuffer(db);` (:153) + every `convBuffer.enqueue/flush` call (:188-189, :215-217, :245-246, :260-261, :270-271, :283-284, :293-294, :309-310, :339-340, :357-360, :425-426, :430-431, :435-436, :437, :472-473, :501-502, :506-507, :510-511, :526-527, :536-537, :558-559) — kills ALL `INSERT INTO conversation_messages` during runs
- Every `this.onStreamEvent?.(...)` call (:202, :217, :226, :237, :244, :262, :272, :289, :295, :328, :341, :376, :403-418, :426, :431, :449, :467, :502, :507, :519, :572, :588, :638, :642, :695-707) — kills the stream_events write + /ws stream.event push
- `case "status"` (:242-248), `case "usage"` (:397-421), `case "shell_approval"` (:477-486), `case "ask_user"` (:488-492), `case "compaction_start"` (:525-529), `case "compaction_done"` (:531-539) — whole cases die
- `_flushAccumulators` (:627-644), `_appendPromptMessage` (:646-654), `_pauseExecution` (:656-668), `_emitFileDiffFromWrittenFiles` (:670-710) — whole helpers die (their only consumers are the removed paths)
- The abort-branch onStreamEvent done push (:202) and post-loop block (:557-574) keep their DB updates but lose convBuffer/onStreamEvent lines

**RPC response contract** (the `{message, executionId}` shape): `chat-executor.ts:50,119,194`, `human-turn-executor.ts:69,88,188,213,295`, `code-review-executor.ts:146-147,208` build `message` from the conversation_messages INSERT via `appendMessage`. Planner decision (see messages.ts below) determines whether responses stay or become synthetic `{ messageId: null, executionId }`.

### `src/bun/server/stream-processor.ts` (service, streaming → pub-sub) — DELETE

**Analog:** file itself. The /ws chat push channel. Deletion is whole-module; the wiring to remove is in index.ts.

**The broadcast pattern being deleted** (:30-59, the enricher seq/blockId role dies with it):
```typescript
onStreamEvent(event: StreamEvent): void {
  const { seq, blockId } = enricher.enrich(event.type, event.blockId || undefined);
  const enrichedEvent: StreamEvent = { ...event, seq, blockId };
  this.channel.broadcast({ type: "stream.event", payload: enrichedEvent });  // :39 — the /ws chat push
  if (PERSISTED_STREAM_TYPES.has(event.type)) { this.streamEventBuffer.enqueue({...}); }  // :41-53 — stream_events write
}
```
- `onRawMessageEnqueued` (:61-113) — claude/copilot raw-delta → text_chunk broadcast; dies with the raw-message-buffer
- `setMarkClaudeExecution` (:12, :89, :115-117) — dies (D-03)
- Tests to delete with it: `src/bun/test/server/stream-processor.test.ts`; `backend-rpc-runtime.ts:17-19` rework

### `src/bun/server/notifications.ts` (service, pub-sub)

**Analog:** file itself. **Key finding: `notifyChatSessionUpdated` ALREADY EXISTS (:28-30)** — the required ADD (Pitfall 2) is the *call-site*, not the method. The consume() done/error/decision paths must fire it (via a new ChatTurnOpts callback, e.g. `opts?.onSessionStatusChange?.(conversationId)` → orchestrator fetches the session → `notifier.notifyChatSessionUpdated`), because today the sidebar learns running→idle only via the stream.event "done" push (`chat.ts:78-84` comment).

```typescript
// :28-30 — KEEP verbatim; wire new call-sites
notifyChatSessionUpdated(session: ChatSession): void {
  this.channel.broadcast({ type: "chatSession.updated", payload: session });
}
// :20-22 — DELETE (message.new push dies)
notifyNewMessage(message: ConversationMessage): void { ... }
// :7-14 — DECISION: stream.error push. Recommend drop (A2: RUN_ERROR + failed execution_state cover it);
// if kept, needs a NEW push type — do NOT keep stream.error
onError(...): void { this.channel.broadcast({ type: "stream.error", ... }); }
```

### `src/bun/index.ts` (config, composition root)

**Analog:** file itself. Four edit sites:

1. **StreamEventProcessor removal** (:57 import, :142 `new StreamEventProcessor(channel, db)`, :235 `streamProc.onRawMessageEnqueued.bind(streamProc)` 7th Orchestrator ctor arg, :239 `orchestrator.setOnStreamEvent(...)`, :241 `streamProc.setMarkClaudeExecution(...)`, :244 `streamProc.start()`)
2. **notifyNewMessage unbind** (:229 `notifier.notifyNewMessage.bind(notifier)` into engines, :235 into Orchestrator) — the engines' `OnNewMessage` ctor arg dies too
3. **Importer flag** — the env-gate precedent (verbatim, :262-267):
```typescript
const copilotProbeEnabled = process.env.RAILYN_COPILOTKIT_PROBE === "1";
```
   Mirror as `const legacyImportEnabled = process.env.RAILYN_LEGACY_IMPORT === "1";` — gate the `legacyImport.run` registration at :343 (`...legacyImportHandlers(db, jsonlStore),`), and register an unconditional `legacyImport.enabled` RPC (Pattern 4 recommendation: type-safe visibility channel for ChatThreadSidebar.vue:38-45).
4. **Session-status wiring** — index.ts already binds `notifier.notifyChatSessionUpdated` (:341, :468); the new consume() callback must reach it (route through the orchestrator ctor or a bound fn).

### `src/shared/rpc-types.ts` (config, shared contract)

**Analog:** file itself. Type-removal-first ordering per wave (tsc is the missed-reference detector).

- **MessageType** (:95-108): remove `transition_event` (:101), `ask_user_prompt` (:102), `file_diff` (:104), `compaction_summary` (:106), `code_review` (:107), `status` (:108). **KEEP** `decision_request_prompt` (:103) — the live HITL.
- **StreamEvent/StreamEventType** (:619-645) + **StreamError** (:647-652): whole removal. Research quotes verbatim; `git grep` gate term.
- **PushMessage** (:1196-1204): remove `stream.event` (:1197), `stream.error` (:1198), `message.new` (:1200). **KEEP** `task.updated`, `workflow.reloaded`, `code.ref`, `chatSession.updated`, `lsp.install.line`.
- **RailynAPI removals** (params/response entries): `conversations.getStreamEvents` (:781-784, note the `import("../bun/db/stream-events").PersistedStreamEvent` — db/stream-events.ts dies with it), `conversations.contextUsage` (:785-788), `tasks.contextUsage` (:817-820), `tasks.compact` (:823-826), `tasks.getFileDiff` (:871-874), `executions.respondShellApproval` (:961-964), `chatSessions.compact` (:1103-1106).
- **ADD** `legacyImport.enabled` alongside `legacyImport.run` (:1116-1119).
- **KEEP** `tasks.setShellAutoApprove` (:957-960) / `chatSessions.setShellAutoApprove` (:965-968) — the opencode auto-approve path is the A3 replacement channel.

### `src/bun/engine/types.ts` (config, engine contract)

**Analog:** file itself.
- EngineEvent (:20-50): remove `ask_user` (:39), `shell_approval` (:41), `status` (:42), `usage` (:43), `new_message` (:45), `compaction_start` (:46), `compaction_done` (:47). **KEEP** `token`, `reasoning`, `tool_start`, `tool_result` (incl. `writtenFiles` field — decision below), `subagent_start/stop`, `decision_request`, `task_updated`, `done`, `error`.
- EngineResumeInput (:60-62): both members die — the only resume channel becomes `decision_request` via AG-UI forwardedProps.
- `OnNewMessage` (:57) and `OnStreamEvent` (:58) types die; `OnError` (:55) stays (its wiring changes per the stream.error decision).
- **writtenFiles field** (`tool_result` :37): zero consumers after `_emitFileDiffFromWrittenFiles` dies (FileChangesRenderer derives from tool ARGS via `buildDiffPayloadsFromArgs`, FileChangesRenderer.vue:67). Planner may delete the field (tsc then enumerates claude/events.ts:200-217 + tools.ts:137-139 + event-bridge consumers) or leave it inert.

### `src/bun/engine/orchestrator.ts` (service, coordinator)

**Analog:** file itself.
- `setOnStreamEvent` (:70-72) — delete
- `onRawMessageEnqueued` ctor arg (:81) + `createRawMessageBuffer(db, { onEnqueue: onRawMessageEnqueued })` (:92) + rawBuffer.start (:93) — delete; StreamProcessor ctor arg (:98) shrinks
- `markClaudeExecution` (:180-182) — delete (D-03)
- `respondShellApprovalByExecution` (:272-316) — delete (shell_approval trim); the `engine.resume(executionId, {type:"shell_approval",...})` (:300) dies with EngineResumeInput
- `compactTask` (:318-338) + `compactConversation` (:340-355) — delete (compaction trim)
- Executor instantiation (:110-132) — `CodeReviewExecutor`/`ChatExecutor` keep their ctor shapes minus `onNewMessage`; the `onNewMessage` field (:68, :89) dies

### Engine emitters (claude/copilot/cursor/opencode adapters)

**Analog:** each file itself. Remove the union members from EngineEvent FIRST; tsc enumerates every emitter:
- `claude/adapter.ts:10,201-205` — BashPermissionGate wiring (emitter at :378 per research); `:5,49,465` — FileStateCache param
- `claude/engine.ts:6,45,107-128` — DefaultFileStateCache instantiation; `:128-136`-style waitForResume (opencode)
- `claude/events.ts:3,4,60,200-217,260-315` — computeWrittenFiles + FileStateCache feed (delete with the cache, or keep the shallow fallback at :281-284 — planner decision; the live renderer is arg-derived so either is safe)
- `opencode/engine.ts:128-136` — shell approval: **A3 human-checkpoint**: replace waitForResume with the existing `shellState.shellAutoApprove` auto-approve path
- `copilot/events.ts`, `cursor/translate-events.ts`, `opencode/event-translator.ts` — status/usage/ask_user emitters
- `copilotkit/event-bridge.ts:280-289` — the drop-list: remove the trimmed cases (usage/status/compaction/ask_user/shell_approval); **keep** `task_updated`, `new_message` handling decisions, and `decision_request` (:288 returns [] because interrupts flow through the registry — do not "fix" it)

### Frozen-table write helpers (DELETE)

**Analog:** each file itself; all three INSERT statements are the D-05 gate's grep terms:
- `conv-message-buffer.ts:43` — `INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata)` (the single consume() writer; `flush()` :31-61 transaction pattern is the shape of the removed batched writes)
- `db/stream-events.ts:31` — `INSERT OR IGNORE INTO stream_events (...)` (all 3 exports die: `appendStreamEvent`, `appendStreamEventBatch`, `getStreamEventsByConversation`; importers: server/stream-processor.ts:5, conversations.ts:5, backend-rpc-runtime.ts:19)
- `raw-message-buffer.ts:24` — `INSERT INTO model_raw_messages` (createRawMessageBuffer :19-51; importers: orchestrator.ts:42,92 + test helpers)
- **retention-job.ts STAYS** (:19-20 prune old rows; imports only `WaitFn` type from write-buffer.ts:2)

### `src/bun/conversation/messages.ts` — DECISION POINT (appendMessage)

**Analog:** file itself (:4-19). `appendMessage` is a SECOND `INSERT INTO conversation_messages` writer (send-time writes), used by: `chat-executor.ts:50,108`, `human-turn-executor.ts:69,213`, `retry-executor.ts:67`, `code-review-executor.ts:146-147`, `transition-executor.ts:76,97`. The research's "3 writer modules" claim covers the streaming path only. Planner must choose:
- **A (narrow):** keep `appendMessage` for user/system turns (getMessages keeps showing user turns; smoke assertions at smoke.test.ts:221,333 for user messages can stay; D-05 grep gate gets a carve-out for this one INSERT)
- **B (broad):** stop all writes — `{message, executionId}` responses become synthetic, smoke tests poll JSONL for user turns too
The MessageType trims force code-review-executor.ts:146 + transition-executor.ts:76,97 removals regardless (their types die). Retry-executor.ts:67 writes type "system" — survives under either option. **Flag in the plan; the e2e/api smoke rewrite depends on this choice.**

### Frontend store strips (Group D)

**Analog:** each store file itself. The universal pattern: keep the session/board layer + the `onChatSessionUpdated` consumer (the replacement push), strip the StreamEvent/live-block layer.

- **`stores/chat.ts`**: KEEP `onChatSessionUpdated` (:43-70 — including the queue-drain guard :62-69, which now fires from the NEW backend push instead of `onChatStreamEvent`'s done case), `updateSession` (:30-37), sessions CRUD (:111-240). STRIP: `useDraftStore` import (:9, :14, :224), `onChatStreamEvent` (:72-92), `onChatNewMessage` (:94-109), queue machinery `sessionQueues`/`suppressDrainIds`/`enqueueMessage`/`dequeueMessage`/`startEdit`/`confirmEdit`/`cancelEdit`/`takeQueue`/`drainSessionQueue` (:20-22, :242-301), `selectSession`'s `fetchContextUsage` call (:157), sendMessage's queue interplay comment (:190-191), `StreamEvent` import (:6).
- **`stores/conversation.ts`**: KEEP `messagesLoading`/`loadMessages` (:139-174), `setActiveConversation` (:118-130), `sortMessagesInPlace` (:114-116), `loadOlderMessages` (:176-193). STRIP: `StreamBlock`/`ConversationStreamState` types (:29-46), `streamStates`/`contextUsageByConversation` (:99-111), `fetchContextUsage` (:229-236), `onStreamError` (:238-251), `onStreamEvent` (:253-408 — the whole live-block state machine incl. `removeScopedLiveBlocks` :55-90, `tryParseJson`/`extractToolResultText` :6-27), `onNewMessage` (:410-426), the stream-state pruning inside `loadMessages`/`refreshLatestPage` (:148-165, :210-223), `refreshLatestPage` if unreferenced after (only caller is :287). `StreamError`/`StreamEvent`/`StreamEventType` imports die.
- **`stores/task.ts`**: STRIP `onTaskStreamEvent` (:450-460), `compactTask` (:359-363), `fetchContextUsage` (:262-266) + callers (:198, :228), their exports (:488-489, :501). KEEP the task.updated queue drain (:231-233) — that's the live replacement path.
- **`rpc.ts`**: strip `onStreamError`/`onStreamEventMessage`/`onNewMessage` exports (:53-56) + `_onStreamError`/`_onStreamEvent`/`_onNewMessage` fields (:41-44) + ws dispatch cases (:91, :92, :94). KEEP task.updated/workflow.reloaded/code.ref/chatSession.updated/lsp.install.line (:93, :95-102) + `onWsReconnect`.
- **`App.vue`**: strip `onStreamError` handler (:49-60 — or reduce to just the config-error sentinel if the toast is kept), `onStreamEventMessage` block (:62-66), `onNewMessage` block (:72-75) + imports (:19). KEEP `onTaskUpdated`/`onCodeRef`/`onChatSessionUpdated`/`onWsReconnect` wiring (:68-81).

### Legacy-import flag (D-06)

**Analog:** `index.ts:262` env-gate + `e2e/api/fixtures/server.ts` options pattern.
- Fixture: add a `legacyImport?: boolean` option to `StartServerOptions` (:23-58) mirroring `copilotkitProbe` (:33-38) → `extraEnv.RAILYN_LEGACY_IMPORT = "1"` (:184-186 precedent)
- Test spawn: `legacy-import.test.ts:93` — `startServer({ dataDir, durableDb: true })` → add the flag option to every spawn in the file (5 spawns)
- UI visibility: `ChatThreadSidebar.vue:38-45` (button) + `:281` (api call) — gate behind `legacyImport.enabled` RPC response (Pattern 4: recommended; avoid 404-driven UI per :288-300 toast flow)
- Import module `src/bun/copilotkit/import.ts` + reads: untouched

### Test-impact rework (Wave 0)

- **`e2e/api/smoke.test.ts`** — the ~8 breaking assertions: `:197-229` (waitFor assistant :215-218, user-msg assert :221), `:247-270` (:266-269 baselineAssistantCount+1), `:272-292` (:287-291), `:319-335` (`sent.messageId` :324, waitFor assistant :327-330, :332-335), `:361-381` (:375-380), `:383-402` (:396-401). **Rework pattern: poll the JSONL log** — analog is `legacy-import.test.ts:104-114` (`readFileSync(join(dataDir, "threads", `${threadId}.jsonl`))` → JSON.parse lines). Requires starting the server with a `dataDir` (fixture :170-177) so `server.dataDir` is populated. The `waitFor` helper (:13-29) stays — swap the load fn from getMessages to the JSONL read + a RUN_FINISHED/RUN_ERROR predicate. The `sent.message`/`sent.messageId` assertions (:212, :257, :281, :324) change with the RPC contract decision.
- **Frontend store tests**: `chat.test.ts` (441L), `conversation.test.ts` (578L — makeStreamEvent helpers + SB-* suite die), `task.test.ts` (546L — T-A :176-186, T15 :395-401 die), `dispatch.test.ts` (186L — :74-75 use onStreamEvent/onTaskStreamEvent), `draft.test.ts` (delete with draft.ts), `pairToolMessages.test.ts` (delete).
- **src/bun tests**: delete `stream-tree-scenarios.test.ts`, `stream-event-enricher.test.ts`, `server/stream-processor.test.ts`, `conv-message-buffer.test.ts`, `raw-message-buffer.test.ts`, `stream-pipeline-scenarios.test.ts`; rework `orchestrator.test.ts`, `retry.test.ts`, `claude-rpc-scenarios.test.ts`, `copilot-rpc-scenarios.test.ts`, `cursor/rpc-scenarios.test.ts`, `handlers.test.ts` (:995 context-usage fallback), `retention-job.test.ts` (stays, WaitFn import), `server/shutdown.test.ts` (:20 markClaudeExecution stub), `support/backend-rpc-runtime.ts` (:17-19), `support/shared-rpc-scenarios.ts` (:214-244 file_diff), `executor-test-helpers.ts` (:76), `chat-executor.test.ts` (:50), `transition-executor.test.ts` (:21-22), `retry-executor.test.ts` (:64), `stream-processor.test.ts` (engine), `context-estimator.test.ts` (stays — estimator survives), `write-buffer.test.ts` (survives only if the class does).
- **e2e/ui fixtures**: `mock-ws.ts` — delete `pushStreamEvent` (:59-61), `pushDone` (:64-78), `pushSessionDone` (:81-95); KEEP `push` (:49-56) + `pushChatSessionUpdated` (:98-100) as the session-status replacement fixture helper. `fixtures/index.ts:72` getStreamEvents mock + `interview-me.spec.ts:541` StreamEvent-typed helper — remove.
- **NEW spec**: session-drawer status flip without stream.event (assert `chatSession.updated` push flips running→idle — the mock-ws.ts `pushChatSessionUpdated` helper is the fixture pattern).

### Deletion inventory (Groups A/C — no analog needed beyond the Phase 6 retire evidence)

Group A dead components (delete all; imports only within the group — re-run the grep per file before deleting): `ChatSidebar.vue`, `ConversationPanel.vue`, `ConversationInput.vue`, `ChatEditor.vue`, `ConversationBody.vue`, `MessageBubble.vue`, `StreamBlockNode.vue`, `SubagentBlock.vue`, `ToolCallBlock.vue`, `ToolCallGroup.vue`, `ReasoningBubble.vue`, `TransitionEventCard.vue`, `CodeReviewCard.vue`, `InlineChipText.vue`, `McpToolsPopover.vue`, `ContextPopover.vue`, `AskUserPrompt.vue`, `ShellApprovalPrompt.vue`, `DecisionRequest.vue`.

Group C dead modules: `src/shared/stream-tree.ts`, `src/bun/pipeline/stream-event-enricher.ts`, `src/bun/server/stream-processor.ts`, `src/bun/conversation/conv-message-buffer.ts`, `src/bun/engine/claude/bash-permission-gate.ts`, `src/bun/engine/claude/file-state-cache.ts`, `src/bun/db/stream-events.ts`, `src/mainview/stores/draft.ts`, `src/mainview/utils/pairToolMessages.ts`, `src/mainview/utils/buildDisplayItems.ts`, `src/mainview/composables/useTypewriter.ts`.

**Group B — do NOT delete (CONTEXT D-01 correction, Pitfall 1):** `FileDiff.vue`, `ReadView.vue` — live importers `chat/tool-call-renderers/FileChangesRenderer.vue:34-35`.

---

## Shared Patterns

### Type-removal-first discipline (all waves)
**Source:** RESEARCH Pattern 3 + tsc-as-detector (AGENTS.md shared-contract discipline). Remove the rpc-types.ts/engine/types.ts members FIRST in each wave, then let `bun run typecheck` enumerate every straggler. Never delete by inventory alone — grep + tsc drive each deletion. Grep proof per file (Pattern 1 snippet):
```bash
rg -n "ConversationBody" src/mainview --glob '*.vue' --glob '*.ts'   # expect only dead-group files
rg -ln "stream-tree" src e2e                                          # expect only its own test
```

### The D-07 post-deletion gate (all waves → phase end)
**Source:** RESEARCH Pattern 3 (from 06-SUMMARY). 8-leg sequence: tripwire (chat-copilotkit + board + board-ws-updates) → `git grep` zero for `StreamEvent|stream.event|stream.error|message.new|stream-tree|StreamEventType` + dead component names → `bun run build` → full Playwright (517/0) → e2e/api (82/0) → src/bun (baseline drops — record new count) → typecheck → mock-agui (23/0). `rm -rf test-results playwright-report` before final run.

### DB lifecycle-update pattern (stays everywhere)
**Source:** `engine/stream/stream-processor.ts:176-184, 439-447, 455-470`. The task/execution/session status writes are LIVE board behavior — every rewrite must preserve the `UPDATE tasks SET execution_state = ...` / `UPDATE chat_sessions SET status = ...` / `UPDATE executions SET status = ...` triad, including the `chat_sessions` row for `conversationId` when taskId is null.

### Session-status push (required ADD — Pitfall 2)
**Source:** consumer `stores/chat.ts:43-70` + method `notifications.ts:28-30`. The backend must broadcast `chatSession.updated` on consume() done/error/decision paths (new ChatTurnOpts callback) — otherwise every session drawer sticks on "running" after the stream.event done push dies.

### Frozen-table grep gate (D-04/D-05)
**Source:** the 3 writer modules. `rg -n "INSERT INTO conversation_messages|INSERT INTO stream_events|INSERT INTO model_raw_messages" src/bun` → zero outside tests (migrations/retention-job/importer reads excluded). Migrations must NOT be touched (rollback safety — a migration touching chat tables is a phase failure).

### EngineEvent trim ripple (Pitfall 7)
**Source:** `engine/types.ts:20-50` + `copilotkit/event-bridge.ts:280-289`. Remove union members first; the bridge's drop-list simplifies; per-engine emitters compile-fail until addressed. shell_approval: **human-checkpoint A3** (opencode auto-approve vs deny posture). failure-toast: **human-checkpoint A2** (drop vs new push).

---

## No Analog Needed

| File | Role | Why No Analog |
|------|------|---------------|
| Group A/C deletion inventory (29 files) | dead components/modules | Whole-file deletes; inventory + grep proof from RESEARCH Pattern 1 is the pattern source |
| `src/bun/copilotkit/import.ts` | service | Untouched (frozen reads permanent) |
| `src/bun/jobs/retention-job.ts` | service | Untouched except possible WaitFn import relocation |
| `e2e/ui/fixtures/mock-agui.test.ts` | test | Untouched (23/0 gate leg) |

---

## Metadata

**Analog search scope:** `src/bun/engine/**`, `src/bun/server/**`, `src/bun/handlers/**`, `src/bun/conversation/**`, `src/bun/pipeline/**`, `src/bun/db/`, `src/bun/copilotkit/`, `src/shared/`, `src/mainview/stores/`, `src/mainview/components/`, `e2e/api/**`, `e2e/ui/fixtures/`
**Files scanned:** ~30 source files read + 4 grep-verified importer maps
**Pattern extraction date:** 2026-08-09

### Corrections to RESEARCH.md worth recording in the plan
1. `notifyChatSessionUpdated` already exists in notifications.ts — the ADD is the consume() call-site, not the method
2. `context-estimator.ts` KEEPS (live importer `cross-engine-context.ts:5,57` for >0.75 compaction-on-switch); `context-usage.ts` KEEPS `resolveContextWindow` (:7-34, live in tasks.ts:291,405 + conversations.ts:82); only `estimateConversationContextUsage` (context-usage.ts:36-42) dies
3. `appendMessage` (conversation/messages.ts:13-18) is a 4th writer to conversation_messages — the D-05 scope (A vs B) is an un-researched planner decision that the smoke rework depends on
4. `writtenFiles` on EngineEvent.tool_result has zero consumers after the rewrite (FileChangesRenderer is arg-derived) — field may die with FileStateCache
5. `write-buffer.ts` production importers all die (server/stream-processor + raw-message-buffer); only the `WaitFn` type survives (retention-job.ts:2)
