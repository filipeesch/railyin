# Phase 7: Cleanup & Feature Trim - Research

**Researched:** 2026-08-09
**Domain:** Dead-code deletion, protocol removal, frozen-table write-path excision, feature trim (backend surfaces + engine event emitters)
**Confidence:** HIGH for the deletion inventory (every entry re-verified by grep/Read this session against the source of truth); MEDIUM for planner-discretion decisions (engine emitter trim depth, flag channel, toast replacement)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Delete the dead chat stack: `src/shared/stream-tree.ts` + StreamEvent protocol types (the AG-UI protocol replaced them), legacy chat components (ChatSidebar, ConversationPanel, ConversationBody, ConversationInput, ChatEditor, MessageBubble, ToolCallBlock, ReasoningBubble, SubagentBlock, TransitionEventCard, McpToolsPopover, ContextPopover, InlineChipText, FileDiff, ReadView, etc. — the Phase 6-verified dead chain), and the legacy conversation/chat Pinia store layers that only served chat streaming (keeping board/task/notes/etc.).
- **D-02:** Trim the removed features' backend surfaces: `file_diff`, `code_review`, `transition_event`, `status`/`status_chunk`, `usage` display, `compaction_summary`, `ask_user`, `shell_approval` — delete event types, RPC methods, renderers, and any dead executor paths (code-review-executor, file-state-cache, bash-permission-gate per PROJECT.md). Verify each trim's RPC/event is unreferenced before deletion (Phase 6's retire evidence is the guide).
- **D-03:** Keep the markClaudeExecution double-broadcast hack deletion for THIS phase (Phase 2 deferred it here) — the bridge is the single translation path now that the legacy /ws chat push is gone.
- **D-04:** Old chat tables (`conversation_messages`, `stream_events`, `chat_sessions`-chat columns, `model_raw_messages`?) stay frozen — NOT dropped; no new writes after this phase. The importer (Phase 4) still reads them (frozen = read-only).
- **D-05:** Verify zero new writes: after the swap, no code path writes to the old chat tables (grep + runtime check via the retention/stream pipeline removal).
- **D-06:** Legacy import retires behind a flag once imports are complete — the `legacyImport.run` RPC + import button hide behind a config/env flag (e.g., `RAILYN_LEGACY_IMPORT=1` or config key); the import module + its reads stay available but off by default.
- **D-07:** Post-deletion gate: `git grep` zero references to the custom StreamEvent protocol and deleted modules; build + full Playwright suite + e2e/api + src/bun + typecheck all green (Phase 6 baseline 517/0 must hold).

### the agent's Discretion

- Exact file inventory for deletion (planner verifies zero-import status per file before listing).
- Whether the importer flag is env-var or config-key.
- Retention/cleanup of `stream_events`-writing pipeline code (WriteBuffer paths) vs keeping for board events — planner verifies what's still live.

### Deferred Ideas (OUT OF SCOPE)

- v2 features (regenerate, cancel hardening, thread-list niceties, suggestions, attachments) — v2 milestone.
- Dropping the frozen chat tables entirely — never (rollback safety is a permanent constraint).
</user_constraints>

<phase_requirements>
## Phase Requirements

No v1 REQ-IDs exist for this phase — the requirement set is PROJECT.md's Active trim items plus the four success criteria. Mapping to research findings:

| Requirement (trim item / criterion) | Research Support |
|-------------------------------------|------------------|
| `file_diff` removed | StreamEventType `"file_diff"` (rpc-types.ts:628); `file_diff` conversation message type (rpc-types.ts:103); writtenFiles→`_emitFileDiffFromWrittenFiles` (engine/stream/stream-processor.ts:670-710); FileStateCache + computeFileDiff (claude/events.ts:3,303); `tasks.getFileDiff` RPC. **KEEP:** `FileDiff.vue`/`ReadView.vue`/`FileDiffPayload` (live FileChangesRenderer imports them); hunk/line-comment review RPCs (live CodeReviewOverlay). |
| `code_review` removed | `code_review` message type (rpc-types.ts:104); CodeReviewCard.vue (dead); CodeReviewExecutor's `code_review` appendMessage (code-review-executor.ts:146). **KEEP:** executor's execution flow (live CodeReviewOverlay submit → `tasks.sendMessage` `_type:"code_review"` → orchestrator.executeCodeReview), review overlay RPCs. |
| `transition_event` removed | MessageType `"transition_event"` (rpc-types.ts:98); appendMessage calls in transition-executor.ts:76,97. **KEEP:** the executor itself (column transitions + `on_enter_prompt` engine runs are live board behavior). |
| `status`/`status_chunk` removed | EngineEvent `"status"` (engine/types.ts:42); StreamEventType `"status_chunk"` (rpc-types.ts:622); consume() status case (engine/stream/stream-processor.ts:242-248); emitters in copilot/events.ts, cursor/translate-events.ts, claude/events.ts, opencode/event-translator.ts. |
| usage display removed | EngineEvent `"usage"` (engine/types.ts:43); consume() usage case (:397-421, writes executions.input_tokens/output_tokens); `conversations.contextUsage` + `tasks.contextUsage` RPCs; context-usage.ts + context-estimator.ts; ContextPopover.vue (dead, display only); store plumbing (conversation.ts:100-109,229-234; chat.ts:157). |
| `compaction_summary` removed | MessageType `"compaction_summary"` (rpc-types.ts:110); consume() compaction_done case (:531-539); `tasks.compact`/`chatSessions.compact` RPCs (zero UI callers); context.ts:339 + pi/compaction-coordinator.ts:27 writes. |
| `ask_user` removed | EngineEvent `"ask_user"` (engine/types.ts:39) + EngineResumeInput (types.ts:61); emitters in opencode adapter/engine, claude adapter/engine, copilot/events.ts; consume() ask_user case (:488-492); AskUserPrompt.vue (dead); `executions.respondShellApproval`-family resume path. |
| `shell_approval` removed | EngineEvent `"shell_approval"` (engine/types.ts:41) + resume input (types.ts:62); claude BashPermissionGate (adapter.ts:378 emitter); opencode engine waitForResume (:128-136); consume() case (:477-486); ShellApprovalPrompt.vue (dead); orchestrator.respondShellApprovalByExecution (:272). |
| Success criterion 1 (no visible trimmed features) | All display surfaces verified dead: ContextPopover/MessageBubble/TransitionEventCard/CodeReviewCard/AskUserPrompt/ShellApprovalPrompt only reachable from the dead chain; AG-UI bridge already drops usage/status/compaction/ask_user/shell_approval (event-bridge.ts:280-289). |
| Success criterion 2 (frozen tables, zero new writes) | Write paths enumerated in Runtime State Inventory: ConvMessageBuffer (conversation_messages), StreamEventProcessor→appendStreamEventBatch (stream_events), raw-message-buffer (model_raw_messages). Reads that must keep working: importer (SELECT-only), `conversations.getMessages` (frozen reads + SessionChatView gate), retention-job deletes. |
| Success criterion 3 (git grep zero + suites green) | Post-deletion gate sequence (Pattern 3); the 6-leg baseline gate from 06-SUMMARY (517/8/0 Playwright + 82 e2e/api + 2396 src/bun + typecheck + mock-agui 23); test-impact inventory (Pitfall 3). |
| Success criterion 4 (import retired behind flag) | Flag placement options + recommendation (Pattern 4); legacy-import.test.ts spawn env; ChatThreadSidebar button (:281). |
</phase_requirements>

## Summary

Phase 7 is a **pure-deletion phase with no new packages, no new dependencies, and no external services** — every piece of research was codebase verification against the source of truth. The single most important discovery: **the legacy write path is NOT dead — it is the current execution engine.** All runs (including AG-UI/CopilotKit runs) flow through `Orchestrator.executeChatTurn` → `chat-executor` → `StreamProcessor.runNonNative` → `consume()`, which today still writes `conversation_messages` (via `ConvMessageBuffer`), writes `stream_events` + broadcasts `/ws stream.event` (via `StreamEventProcessor`), and writes `model_raw_messages` (via `raw-message-buffer`). The AG-UI JSONL store writes in parallel. So "zero new writes to the old chat tables" (D-05) is a **surgical rewrite of the `consume()` state machine**, not a removal of a dead side path — and the planner must treat the executor chain, the /ws push contracts (`stream.event`/`stream.error`/`message.new`), the session-status push replacement, and the `{message, executionId}` RPC response contract as first-class trim surfaces.

Second major finding: **the CONTEXT's D-01 file list contains two errors.** `FileDiff.vue` and `ReadView.vue` are NOT dead — the live new-stack renderer `chat/tool-call-renderers/FileChangesRenderer.vue` imports both (FileChangesRenderer.vue:34-35). They must be excluded from the deletion. Conversely, the CONTEXT's "etc." leaves out several verified-dead files (`StreamBlockNode`, `ToolCallGroup`, `DecisionRequest`, `utils/pairToolMessages.ts`, `utils/buildDisplayItems.ts`, `composables/useTypewriter.ts`, `stores/draft.ts`). The full verified inventory is in Pattern 1.

Third: the trim items are **chat-protocol surfaces, not the underlying features.** The review overlay (`CodeReviewOverlay`, `ChangedFilesPanel`, hunk/line-comment RPCs, `review` store) is fully live and stays; `CodeReviewExecutor` stays (live submit flow) with only its `code_review` chat-message writes excised; `TransitionExecutor` stays (live column transitions) with only `transition_event` writes excised. What dies is the custom `StreamEvent` protocol surface, the legacy chat UI chain, the /ws chat pushes, and the engine-side emitters of trimmed events (`ask_user`, `shell_approval`, `status`, `usage`, `compaction_*`).

Fourth: the **post-deletion gate has a known test-impact blast radius.** `e2e/api/smoke.test.ts` asserts assistant replies arrive in `conversations.getMessages` after `tasks.sendMessage` (smoke.test.ts:249-296) — these ~8 assertions break when writes stop and must be rewritten against the JSONL log. The frontend store tests (chat.test.ts 441L, conversation.test.ts 578L, task.test.ts 546L, dispatch.test.ts 186L) and ~10 src/bun test files exercise the legacy stream pipeline and need deletion/rework. The gate itself (Pattern 3) stays the 6-leg Phase 6 sequence.

**Primary recommendation:** Organize the plan as (1) deletion inventory with per-file grep-proof verification checkpoints, (2) the `consume()` surgical rewrite + /ws push removal + session-status push replacement, (3) trim-item surface removals (RPCs, types, engine emitters), (4) importer flag, (5) test-impact rework, (6) the D-07 gate. Do the type/RPC removals LAST in each wave so `tsc` fails loudly on any missed reference.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Legacy chat UI chain deletion | Browser / Client | — | All dead components live in `src/mainview/components/`; verified zero importers outside the dead chain |
| StreamEvent protocol type removal | Shared contract | — | `src/shared/rpc-types.ts` + `stream-tree.ts` are the protocol source of truth; consumers span frontend (rpc.ts, stores) and backend (handlers, pipeline) |
| Frozen-table write-path excision | API / Backend | Database / Storage | `consume()` + executors + `StreamEventProcessor` + `ConvMessageBuffer` + `raw-message-buffer` are the writers; tables themselves stay untouched (no migrations, no drops) |
| Trim-item RPC/handler removal | API / Backend | Shared contract | RPCs removed from `RailynAPI` + handler maps together (shared-contract discipline per AGENTS.md) |
| Engine event-emitter trim | API / Backend | — | ask_user/shell_approval/status/usage/compaction emitters live in the 5 engine adapters; bridge already drops them (event-bridge.ts:280-289) |
| /ws push channel | Frontend Server / WS | — | Channel + websocket stay (board events); only stream.event/stream.error/message.new pushes die; replacement push for session status needed |
| Import flag | API / Backend | Browser / Client | Server-side env gate at handler registration (index.ts) + frontend button visibility channel |
| Post-deletion gate | Testing | — | 6-leg suite sequence; grep proofs per deletion |

## Standard Stack

**This phase installs zero packages.** It is pure deletion of existing in-repo code. No version verification or package legitimacy checks apply. The "stack" that matters is the existing one the gate runs against:

| Tool | Version (verified this session) | Purpose |
|------|--------------------------------|---------|
| Bun | 1.4.0 (`bun --version`) | Runtime + test runner (`bun test`) |
| Node | v20.20.1 (`node --version`) | Playwright / vite tooling under Bun's npm interop |
| Playwright | pinned in package.json (`bunx playwright test`) | e2e/ui suite (517/8/0 baseline) |
| TypeScript | `tsc --noEmit` via `bun run typecheck` | Compile gate — the loudest missed-reference detector for this phase |

## Package Legitimacy Audit

**Not applicable — no external packages are installed or removed in this phase.** All deletions are in-repo files; the only dependency surface touched is type/import removal from existing files. No `npm install`/`bun add` commands should appear anywhere in the plan (a plan task that adds a package here is a red flag).

## Architecture Patterns

### Pattern 1: The verified deletion inventory (per-file grep proof before deletion)

Every file listed below was re-verified THIS session by grepping import statements across `src/` + `e2e/` (a template usage match is NOT an importer — only `import ... from` lines count). Executors must re-run the grep before deleting each file (Phase 6 Pattern 2 precedent: `rg -n "ConversationInput" src/mainview/ -l` → only dead files).

**Group A — Dead legacy chat components (delete all; imports only within this group):**

| File | Only imported by (all dead) |
|------|-----------------------------|
| `src/mainview/components/ChatSidebar.vue` | *(no importers)* |
| `src/mainview/components/ConversationPanel.vue` | *(no importers; only self-ref comment)* |
| `src/mainview/components/ConversationInput.vue` | ConversationPanel |
| `src/mainview/components/ChatEditor.vue` | ConversationInput |
| `src/mainview/components/ConversationBody.vue` | ConversationPanel |
| `src/mainview/components/MessageBubble.vue` | ConversationBody |
| `src/mainview/components/StreamBlockNode.vue` | ConversationBody, SubagentBlock, ToolCallBlock |
| `src/mainview/components/SubagentBlock.vue` | ConversationBody, StreamBlockNode |
| `src/mainview/components/ToolCallBlock.vue` | ToolCallGroup, StreamBlockNode |
| `src/mainview/components/ToolCallGroup.vue` | SubagentBlock, ConversationBody |
| `src/mainview/components/ReasoningBubble.vue` | MessageBubble, StreamBlockNode |
| `src/mainview/components/TransitionEventCard.vue` | ConversationBody |
| `src/mainview/components/CodeReviewCard.vue` | ConversationBody |
| `src/mainview/components/InlineChipText.vue` | MessageBubble, TransitionEventCard |
| `src/mainview/components/McpToolsPopover.vue` | ConversationInput |
| `src/mainview/components/ContextPopover.vue` | ConversationInput |
| `src/mainview/components/AskUserPrompt.vue` | MessageBubble |
| `src/mainview/components/ShellApprovalPrompt.vue` | MessageBubble |
| `src/mainview/components/DecisionRequest.vue` | MessageBubble only (DecisionInterrupt references it in a COMMENT: DecisionInterrupt.vue:11,147 — not an import) |

**Group B — Files the CONTEXT wrongly lists as dead — MUST STAY:**
- `src/mainview/components/FileDiff.vue` — imported by LIVE `chat/tool-call-renderers/FileChangesRenderer.vue:34` (and dead ToolCallBlock)
- `src/mainview/components/ReadView.vue` — imported by LIVE `FileChangesRenderer.vue:35` (and dead ToolCallBlock)

**Group C — Dead non-component files (delete):**

| File | Evidence |
|------|----------|
| `src/shared/stream-tree.ts` | Only importer: `src/bun/test/stream-tree-scenarios.test.ts` (delete together) |
| `src/bun/pipeline/stream-event-enricher.ts` | Only non-test importer: `src/bun/server/stream-processor.ts` (Group D); test `stream-event-enricher.test.ts` |
| `src/bun/server/stream-processor.ts` (StreamEventProcessor class) | Wired only in index.ts:142,235,239-244 via `onStreamEvent`/`onRawMessageEnqueued`/`setMarkClaudeExecution` — all die with the /ws chat push (Pattern 2). Test `server/stream-processor.test.ts` |
| `src/bun/conversation/conv-message-buffer.ts` | Only importer: engine/stream/stream-processor.ts:14,153 (Pattern 2) |
| `src/bun/context-usage.ts` + `src/bun/conversation/context-estimator.ts` | Feed `conversations.contextUsage`/`tasks.contextUsage` (usage-display trim); context-estimator read of executions.input_tokens (context-estimator.ts:13-22) |
| `src/bun/engine/claude/bash-permission-gate.ts` | Imports: claude/adapter.ts:10,201-205 (emitter), claude/engine.ts, claude/events.ts (type only), orchestrator.ts (type only) — all in the shell_approval trim |
| `src/bun/engine/claude/file-state-cache.ts` | Imports: claude/engine.ts:6,45,107-128 (instantiation), claude/adapter.ts:5,49,465 (param), claude/events.ts:4,264 (computeFileDiff feed), test stub-file-state-cache.ts |
| `src/mainview/stores/draft.ts` | Only importer: ConversationInput (Group A); draft.test.ts |
| `src/mainview/utils/pairToolMessages.ts` + `buildDisplayItems.ts` | Importers: ToolCallGroup, ConversationBody, SubagentBlock (all dead); pairToolMessages.test.ts |
| `src/mainview/composables/useTypewriter.ts` | Only importer: StreamBlockNode (dead) |

**Group D — Stores that stay but shrink (strip the streaming layer, keep the session/board layer):**
- `src/mainview/stores/chat.ts` — **LIVE** (imported by BoardView:258, ConversationDrawer:44, SessionChatView:108, ChatThreadSidebar:133, App.vue:23). Keep: sessions CRUD, unread, selectSession, cancel. Strip: `sessionQueues`/queue actions (`enqueueMessage`/`dequeueMessage`/`startEdit`/`confirmEdit`/`cancelEdit`/`takeQueue`/`drainSessionQueue`/`suppressDrainIds`), `useDraftStore` import (:9,14), `onChatStreamEvent` (:72-92), `onChatNewMessage` (:94-109), `sendMessage`'s draft/queue interplay. chat.test.ts (441L) rework.
- `src/mainview/stores/conversation.ts` — **LIVE** (SessionChatView:56-91 loading gate `messagesLoading` + chatStore.selectSession). Keep: `messagesLoading`, `loadMessages`, `setActiveConversation`, `sortMessagesInPlace`. Strip: live-block machinery (`removeScopedLiveBlocks`, `liveBlocks`, `onStreamEvent` :253-407 region, `onStreamError`, `onNewMessage`, `appendMessage`-for-push), contextUsage plumbing (:100-109, :229-234, :288, :297-300, :424). conversation.test.ts (578L) rework.
- `src/mainview/stores/task.ts` — LIVE. Strip: `onTaskStreamEvent` queue-drain fallback (:340-347 region), `compactTask`/`fetchContextUsage` if compaction+usage RPCs die (:262-265, :359-363, callers :198,:228). task.test.ts (546L) rework.
- `src/mainview/rpc.ts` — strip `onStreamError`/`onStreamEventMessage`/`onNewMessage` exports + ws dispatch cases (rpc.ts:91-94) — **after** App.vue wiring removal (App.vue:19,62-75).

**Group E — Live shells that stay untouched:** `ConversationDrawer.vue` (BoardView:261), `TaskChatView.vue`, `SessionChatView.vue`, `ChatThreadSidebar.vue`, `RailyinChat.vue`, `DecisionInterrupt.vue`/`InterruptBridge.vue`/`interruptBridge.ts`, `tool-call-renderers/{ShellOutputRenderer,FileChangesRenderer,DelegateSummaryRenderer}.vue`, `TaskDetailOverlay.vue`, `CodeReviewOverlay.vue` + `ChangedFilesPanel`/`ReviewFileList`/`InlineReviewEditor`/`HunkActionBar`/`LineCommentBar`/`TaskGitPanel`/`TaskGitTab`, `DecisionsPanel.vue`, `ManageModelsModal.vue`, all board/notes/todo/terminal/launch components.

**Pattern 1 verification snippet (executors re-run before each delete):**
```bash
# Component: expect output = only files inside the dead group
rg -n "ConversationBody" src/mainview --glob '*.vue' --glob '*.ts'
# Module: expect output = only the file itself + its tests
rg -ln "stream-tree" src e2e
# Store surface: confirm live importers before stripping (NOT before deleting)
rg -ln "stores/chat" src/mainview   # → BoardView, ConversationDrawer, SessionChatView, ChatThreadSidebar, App.vue (+ dead: ChatSidebar, MessageBubble)
```

### Pattern 2: The consume() surgical rewrite — frozen tables get zero new writes (D-05)

`src/bun/engine/stream/stream-processor.ts` (`StreamProcessor.consume`, 711 lines) is the **single execution state machine for ALL runs** — task runs, session runs, and AG-UI runs (railyin-agent → `executeChatTurn`/`executeHumanTurn` → executor → `runNonNative` → `consume`). It must NOT be deleted — it is the engine loop. It must be surgically stripped of the legacy write paths while keeping the live state updates:

**Remove from consume():**
- `ConvMessageBuffer` usage (`new ConvMessageBuffer(db)` :153, `_flushAccumulators` :627-644, `_appendPromptMessage` :646-654) — kills ALL `INSERT INTO conversation_messages` during runs
- Every `this.onStreamEvent?.(...)` call (text_chunk/reasoning_chunk/status_chunk/assistant/reasoning/tool_call/tool_result/file_diff/usage/done) — kills the stream_events write + /ws stream.event push (the enricher's seq/blockId role dies with it)
- `case "status"` (:242-248), `case "usage"` (:397-421), `case "shell_approval"` (:477-486), `case "ask_user"` (:488-492), `case "compaction_start"` (:525-529), `case "compaction_done"` (:531-539), `_emitFileDiffFromWrittenFiles` (:670-710)
- `markClaudeExecution`/`claudeExecutionIds` + the skip logic at :223,:234 (D-03: single translation path — the raw-message broadcast path dies too, see below)

**Keep in consume():**
- `UPDATE tasks SET execution_state = ...` / `UPDATE chat_sessions SET status = ...` / `UPDATE executions SET status = ...` (board + session lifecycle: :177-184, :192-196, :439-447, :456-464, :562-570, :578-586)
- `opts?.onEngineEvent?.(event)` tap (:210) — the AG-UI bridge feed
- `onToken`/`onError`/`onTaskUpdated` calls; token/reasoning accumulators (they feed the AG-UI tap order); `done`/`error`/`decision_request` case bodies (minus their onStreamEvent calls); `task_updated`/`new_message` cases (minus the message.new push decision)
- The `finally` block (:590-621) — pending_messages drain + deferred transition + final task push

**Companion removals (the /ws chat push dies):**
- index.ts:235 `streamProc.onRawMessageEnqueued.bind(streamProc)` (7th Orchestrator ctor arg — becomes removable), index.ts:239 `setOnStreamEvent`, index.ts:241 `setMarkClaudeExecution` wiring, index.ts:244 `streamProc.start()`
- `src/bun/server/stream-processor.ts` `onRawMessageEnqueued` (:61-113) — the claude/copilot raw-delta → text_chunk broadcast path; `setMarkClaudeExecution`/`markClaudeExecutionFn` (:12,:89,:115-117)
- `notifier.notifyNewMessage`/`onNewMessage` wiring: `message.new` push dies (App.vue:72-74 consumers stripped). `notifyStreamError`/`onError` → `stream.error` push: **replacement decision needed** — App.vue:58-61 currently toasts "Execution failed" for taskId != null. Recommend: drop the toast (AG-UI RUN_ERROR + board execution_state='failed' already surface failures); if kept, it needs a new push type — do NOT keep stream.error (it's part of the custom protocol).
- **Session-status replacement push:** `chatStore.onChatStreamEvent`'s "done" case is today the ONLY path that flips the session sidebar from running→idle (backend updates chat_sessions in DB but never broadcasts on natural completion — chat.ts:78-84 comment). When stream.event dies, the backend MUST broadcast `notifier.notifyChatSessionUpdated` from the consume() done/error/decision paths (or the executor) — otherwise session statuses stay "running" in the sidebar until reload. This is a required ADD, not optional.

**RPC response contract rework:** `tasks.sendMessage`/`chatSessions.sendMessage` return `{ message: ConversationMessage; executionId }` where `message.id` comes from the conversation_messages INSERT (chat-executor.ts:50,194; human-turn-executor.ts:69,213). With writes removed, the return must become synthetic (e.g., `{ messageId: null, executionId }` or drop the field) — update `RailynAPI` + handler + any assertions.

### Pattern 3: The post-deletion gate sequence (D-07, from 06-SUMMARY D-05 gate)

```
1. Tripwire:  bunx playwright test e2e/ui/chat-copilotkit.spec.ts e2e/ui/board.spec.ts e2e/ui/board-ws-updates.spec.ts
2. grep gate: git grep -n "StreamEvent\|stream.event\|stream.error\|message.new\|stream-tree\|StreamEventType" src e2e   # expect ZERO (after rpc-types.ts clean)
              git grep -n "ConversationPanel\|ConversationInput\|ChatEditor\|MessageBubble\|StreamBlockNode" src/mainview   # expect ZERO
3. bun run build
4. bunx playwright test e2e/ui                                    # 517 pass / 8 skip / 0 fail (42 spec files)
5. bun test e2e/api --timeout 30000                              # 82 pass / 0 fail
6. bun test src/bun --timeout 20000                              # 2396 pass / 2 skip / 0 fail (baseline; count will legitimately DROP as pipeline tests are deleted — record the new number)
7. bun run typecheck                                             # clean
8. bun test e2e/ui/fixtures/mock-agui.test.ts                     # 23 pass
```

Sequence discipline from Phase 6: single chained command per gate run (`&&`), `rm -rf test-results playwright-report` before the final gate, no leg skippable. The 8 Playwright skips (interview-me A6 fixture gap) and 2 src/bun skips are pre-existing intentional — the A6 fixture-knob decision belongs to the phase-gate reviewer, NOT this phase.

### Pattern 4: Import retirement flag (D-06)

Server: gate registration in index.ts:343 with the existing env pattern (`RAILYN_COPILOTKIT_PROBE` precedent at index.ts:262 — `process.env.RAILYN_LEGACY_IMPORT === "1"`). Frontend: ChatThreadSidebar.vue:281 calls `legacyImport.run` — the button needs a visibility channel. Options (discretion):
- **Recommended:** register a tiny `legacyImport.enabled: { params: {}, response: { enabled: boolean } }` RPC unconditionally (reads the env), gate `legacyImport.run` registration on the flag; ChatThreadSidebar hides the button when `!enabled`. Small, type-safe, follows shared-contract discipline.
- Alternative: build-time `import.meta.env.RAILYN_LEGACY_IMPORT` — baked into dist/ at build; works for a single-user local app but requires rebuild to flip.
- Avoid: relying on `legacyImport.run` returning 404 to hide the button (error-driven UI, races with the toast flow at ChatThreadSidebar.vue:288-300).

**Test impact:** `e2e/api/copilotkit/legacy-import.test.ts` spawns the REAL server via `startServer` (fixture supports `extraEnv` — server.ts:165-198). The test must spawn with `RAILYN_LEGACY_IMPORT=1` (add to its server options or extraEnv), mirroring `RAILYN_COPILOTKIT_PROBE` handling. The import module (`src/bun/copilotkit/import.ts`, `handlers/legacy-import.ts`) stays available but off by default — reads stay (frozen-table reads are permanent).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Missed-reference detection during deletion | Manual file-by-file review | `tsc --noEmit` + `bun run build` + grep proofs after each wave | TypeScript is the loudest detector: remove rpc-types/RPC entries and let tsc point at every straggler. Do type removals first per wave |
| Write-path audit | Reading every executor by hand | The enumerated write-path inventory (Runtime State Inventory) + `rg -n "INSERT INTO conversation_messages|INSERT INTO stream_events|INSERT INTO model_raw_messages"` | The 3 writer modules are known; the grep confirms nothing new appears |
| Post-deletion regression check | Spot-checking specs | The full 6-leg gate (Pattern 3) | Phase 6 proved the only trustworthy verdict is the full suite on the rebuilt dist/ |
| Frozen-table safety | Dropping or migrating tables | Leave migrations + tables untouched; delete only the write call-sites | D-04 is a permanent constraint — rollback safety. A migration that touches chat tables is a phase failure |
| Import flag plumbing | Hand-rolled frontend env injection | The `legacyImport.enabled` RPC + server-side env gate (Pattern 4) | Type-safe, follows the existing RPC contract, no build-time coupling |

**Key insight:** this phase's risk is not in what gets deleted — it's in what *remains referenced*. Every deletion must be driven by tsc errors, not by the inventory alone.

## Runtime State Inventory

> Required for deletion phases. All items verified this session.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `conversation_messages`, `stream_events`, `model_raw_messages` tables still RECEIVE writes from live code (ConvMessageBuffer → conversation_messages; StreamEventProcessor → appendStreamEventBatch → stream_events; raw-message-buffer → model_raw_messages). `chat_sessions` table is LIVE (session management — status/title/last_read_at written by consume() + chat-sessions.ts handlers) — NOT frozen; its schema (migrations/026_chat_sessions.ts:91-103: id, workspace_key, title, status, conversation_id, last_activity_at, last_read_at, archived_at, created_at) has no chat-content columns | Data migration: NONE (tables untouched). Code edit: stop the 3 writer paths (Pattern 2). Retention job (jobs/retention-job.ts:19-20 deletes model_raw_messages >1d, stream_events >4h) stays — it only prunes old rows |
| Live service config | None — single-process local app, no external services | None |
| OS-registered state | None (no launchd/systemd/pm2 registrations — dev runs `bun scripts/dev.ts` / `bun src/bun/index.ts` in terminal) | None |
| Secrets/env vars | New env var introduced: `RAILYN_LEGACY_IMPORT` (default off). Existing env pattern to mirror: `RAILYN_COPILOTKIT_PROBE` (index.ts:262), `RAILYN_DEBUG` (:471) | Code edit only; no secrets affected |
| Build artifacts | `dist/` is rebuilt by the gate itself (Pattern 3 step 3) — no manual cleanup. `test-results/`/`playwright-report/` must be `rm -rf`'d before the final gate run (06-SUMMARY precedent) | Rebuild + rm before gate |

**The canonical question answered:** after every file is deleted, the runtime systems still holding the old protocol are (1) the three DB write paths above (removed in Pattern 2), (2) the /ws broadcast channel emitting stream.event/stream.error/message.new (removed with StreamEventProcessor + notifier wiring), (3) the engine adapters still emitting trimmed EngineEvents (trimmed per engine), (4) e2e fixtures mocking the old pushes (mock-ws.ts pushStreamEvent, fixtures/index.ts:72 getStreamEvents mock, interview-me.spec.ts:541) — removed with the type.

## Common Pitfalls

### Pitfall 1: Deleting a "dead" component that a live file actually imports
**What goes wrong:** The CONTEXT's D-01 list includes FileDiff.vue and ReadView.vue as dead; FileChangesRenderer.vue (LIVE new-stack renderer) imports both. Deleting them breaks the shell/file tool-call cards — the visible chat feature.
**Why it happens:** Phase 6's retire evidence targeted *legacy* components; the new-stack renderers were added later and re-use the two diff components.
**How to avoid:** The Group A/B split in Pattern 1 — re-run the import grep before each deletion; treat the CONTEXT list as a starting point, not the truth.
**Warning signs:** A live renderer under `components/chat/` importing from `components/`.

### Pitfall 2: Removing stream.event and silently freezing session status in the UI
**What goes wrong:** chat.ts:78-84 documents that backend never broadcasts chatSession.updated on natural completion — the sidebar learns running→idle only via the stream.event "done" push. Delete the push without a replacement and every session drawer sticks on "running".
**Why it happens:** The status-update push is invisible in the protocol type list (it's a *consumed* push, not a type).
**How to avoid:** Mandatory ADD: `notifier.notifyChatSessionUpdated` broadcast from consume()'s done/error/decision paths (Pattern 2 companion removals).
**Warning signs:** After the rewrite, run a session to completion and watch the sidebar status.

### Pitfall 3: The e2e/api smoke suite asserts the legacy write path
**What goes wrong:** smoke.test.ts:249-296 (and :197-219, :328-331, :376-397) asserts `conversations.getMessages` eventually contains the assistant reply after `tasks.sendMessage`/`chatSessions.sendMessage`. When conversation_messages writes stop, these fail hard — and they're real-server tests, so they block the gate.
**Why it happens:** The smoke suite was written against the legacy persistence contract, which is exactly what this phase removes.
**How to avoid:** Rewrite those assertions to poll `data/threads/{conversationId}.jsonl` (the JSONL store is the new source of truth) or the execution status; record the rework in the plan with the specific test names above.
**Warning signs:** A plan that lists zero e2e/api changes — the smoke suite WILL break.

### Pitfall 4: Trimming `code_review`/`transition_event` by deleting their executors
**What goes wrong:** CodeReviewExecutor is wired to the LIVE review submit flow (CodeReviewOverlay.vue:660-667 sends `tasks.sendMessage` with `{_type:"code_review"}` → orchestrator.ts:159 → executor). TransitionExecutor handles LIVE column transitions + `on_enter_prompt` runs (AGENTS.md: task movement is not just UI state). Deleting either breaks core board workflow.
**Why it happens:** PROJECT.md's "code review executor deleted" wording reads as whole-module deletion; the CONTEXT adds "any dead executor paths" — these two are NOT dead.
**How to avoid:** Excise only the chat-message writes (appendMessage calls at code-review-executor.ts:146-147, transition-executor.ts:76,97) and the `code_review`/`transition_event` message types; keep the execution flows. bash-permission-gate + file-state-cache ARE dead (their only outputs are trimmed channels) — those whole modules go.
**Warning signs:** Executor import graph shows the orchestrator instantiating them (orchestrator.ts:131).

### Pitfall 5: Removing `message.new`/`stream.error` without checking live consumers
**What goes wrong:** App.vue:58-61 toasts "Execution failed" from stream.error; App.vue:72-74 + stores consume message.new for unread/waiting_user state; RailyinChat.vue:14,361 references onStreamError in comments describing its own error toast (already self-contained).
**Why it happens:** The pushes are wired at App.vue setup, which is a live file.
**How to avoid:** Strip App.vue wiring (:62-75) in the same task as the backend push removal; decide the failure-toast replacement explicitly (recommended: drop — RUN_ERROR + failed execution_state cover it); replace the message.new-driven waiting_user/unread updates with the notifyChatSessionUpdated push (Pattern 2).
**Warning signs:** Any plan that deletes the backend push but leaves App.vue imports — tsc will catch it, but only after the wave runs.

### Pitfall 6: Leaving the enricher/WriteBuffer pipeline "for later"
**What goes wrong:** `StreamEventEnricher` + `WriteBuffer<PersistedStreamEvent>` + `db/stream-events.ts` write functions exist only to serve the dead push/persist path; skipping them leaves the custom protocol half-alive and the D-07 `git grep` gate fails ("stream_events" still referenced).
**Why it happens:** They're small utility files that don't look like "chat stack".
**How to avoid:** Group C includes them; the gate's `git grep "stream_events"` (excluding migrations + retention job + importer reads) is the enforcement.
**Warning signs:** `git grep` for the protocol terms returns hits outside migrations.

### Pitfall 7: Engine emitters of trimmed events left in place
**What goes wrong:** opencode adapter/engine + claude adapter/gate + copilot events + cursor translate-events still emit ask_user/shell_approval/status/usage/compaction. The bridge already drops them (event-bridge.ts:280-289), so today a shell_approval means an invisible hang (run waits for resume that no UI can give). Leaving emitters in place perpetuates the hang; removing the EngineEvent union members forces every emitter to compile-fail until addressed.
**Why it happens:** The emitters are scattered across 5 engine adapters — easy to miss individually.
**How to avoid:** Remove the union members from EngineEvent + EngineResumeInput first (engine/types.ts:39,41-43,46-47,61-62), then let tsc enumerate every emitter. For shell_approval specifically, decide the per-engine behavior (recommended: claude gate removed → writes proceed unapproved; opencode: default auto-approve via the existing `shellState.shellAutoApprove` path at opencode/engine.ts:128-136 rather than waitForResume) — flag as a human-checkpoint decision.
**Warning signs:** `bun run typecheck` passes while grep still finds `type: "ask_user"` in engine code.

## Code Examples

Verified patterns from the source of truth:

### The StreamEvent protocol surface being removed (verbatim, rpc-types.ts:619-645)
```typescript
export type StreamEventType =
  | "text_chunk"       // live token — not persisted
  | "reasoning_chunk"  // live reasoning token — not persisted
  | "status_chunk"     // ephemeral status — not persisted
  | "user"             // persisted: user message
  | "assistant"        // persisted: finalized assistant text
  | "reasoning"        // persisted: finalized reasoning block
  | "tool_call"        // persisted: tool call
  | "tool_result"      // persisted: tool result
  | "file_diff"        // persisted: file diff
  | "system"           // persisted: system/error message
  | "usage"            // ephemeral: context usage update — not persisted
  | "done";            // terminal event — closes all state for this execution

export interface StreamEvent {
  taskId: number | null;
  conversationId: number;
  executionId: number;
  seq: number;
  blockId: string;
  type: StreamEventType;
  content: string;
  metadata: string | null;
  parentBlockId?: string | null;
  subagentId: string | null;
  done: boolean;
}
```
PushMessage union (rpc-types.ts:1196-1204) — keep `task.updated`, `workflow.reloaded`, `code.ref`, `chatSession.updated`, `lsp.install.line`; remove `stream.event`, `stream.error`, `message.new`:
```typescript
export type PushMessage =
  | { type: "stream.event"; payload: StreamEvent }
  | { type: "stream.error"; payload: StreamError }
  | { type: "task.updated"; payload: Task }
  | { type: "message.new"; payload: ConversationMessage }
  | { type: "workflow.reloaded"; payload: Record<string, never> }
  | { type: "code.ref"; payload: CodeRef }
  | { type: "chatSession.updated"; payload: ChatSession }
  | { type: "lsp.install.line"; payload: { token: string; line: string } };
```

### EngineEvent members being trimmed (verbatim, engine/types.ts:20-49 excerpt)
```typescript
  | { type: "ask_user"; payload: string /* serialised AskUserPrompt JSON */ }
  | { type: "decision_request"; payload: string /* serialised DecisionRequestPayload JSON */ }
  | { type: "shell_approval"; command: string; executionId: number }
  | { type: "status"; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; contextWindow?: number }
  | { type: "task_updated"; task: import("../../shared/rpc-types.ts").Task }
  | { type: "new_message"; message: import("../../shared/rpc-types.ts").ConversationMessage }
  | { type: "compaction_start" }
  | { type: "compaction_done"; summary?: string }
```
Trim removes: `ask_user`, `shell_approval`, `status`, `usage`, `compaction_start`, `compaction_done`, `new_message` (message.new push dies). Keep: `token`, `reasoning`, `tool_start`, `tool_result`, `subagent_start`, `subagent_stop`, `decision_request`, `task_updated`, `done`, `error`. EngineResumeInput (types.ts:60-62) loses both members (ask_user, shell_approval) — the only resume channel becomes decision_request via AG-UI forwardedProps.

### The frozen-table write call-sites to remove (verbatim)
- `conv-message-buffer.ts:43`: `INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata)` — the single conversation_messages writer
- `db/stream-events.ts:31`: `INSERT OR IGNORE INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id)` — the single stream_events writer
- `raw-message-buffer.ts:24`: `INSERT INTO model_raw_messages` — the model_raw_messages writer
- `server/stream-processor.ts:39`: `this.channel.broadcast({ type: "stream.event", payload: enrichedEvent })` — the /ws chat push
- `notifications.ts:20-21`: `notifyNewMessage` → `{ type: "message.new", payload: message }` — the message.new push

### The live session-status replacement (required ADD, Pattern 2)
```typescript
// In consume() done/error/decision paths, alongside the existing
// UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?:
opts?.onSessionStatusChange?.(conversationId);  // → notifier.notifyChatSessionUpdated(fetchedSession)
```
(Design the exact signature in the plan; the point is a chatSession.updated push must fire on run end — the DB update alone is invisible to the sidebar.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom StreamEvent protocol over /ws for chat | AG-UI events over SSE via CopilotRuntime (Phase 1-5) | Phases 1-5 | Phase 7 deletes the old protocol entirely |
| Double-broadcast avoidance (markClaudeExecution) | Single translation path in the event bridge (BRDG-01) | Phase 2 | D-03 deletes the hack now that /ws chat push is gone |
| conversation_messages/stream_events dual-write | JSONL per-thread store (`data/threads/{id}.jsonl`) | Phase 4 | Phase 7 stops the dual-write; tables freeze |

**Deprecated/outdated (all targeted by this phase):**
- `ask_user`/`shell_approval` HITL channels — replaced by `decision_request` interrupts (the only HITL, PROJECT.md:76)
- `status`/`status_chunk`/`usage`/`compaction_summary`/`file_diff`/`code_review`/`transition_event` chat protocol types — deliberately trimmed, no AG-UI equivalent (REQUIREMENTS.md Out of Scope:100)
- `tasks.getFileDiff`-style chat-diff RPCs — superseded by tool-call renderers deriving diffs from tool args (toolCardDisplay.ts:88-95)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The session-status replacement push (notifyChatSessionUpdated on run end) is required to keep the sidebar status correct — inferred from chat.ts:78-84 ("backend never broadcasts chatSession.updated on natural completion") + consume() DB-only updates | Pattern 2 | If the AG-UI stack already updates session status through another channel (e.g., runner events), the ADD is redundant — planner should verify the sidebar behavior after the rewrite; low risk either way |
| A2 | The App.vue "Execution failed" toast (stream.error, App.vue:58-61) can be dropped — RUN_ERROR in chat + board execution_state='failed' cover the failure UX | Pitfall 5 | If the user relies on the toast for background task failures, a replacement push is needed; flag as human-checkpoint decision |
| A3 | opencode shell_approval trim = auto-approve via the existing `shellState.shellAutoApprove` path (opencode/engine.ts:128-136), never waitForResume | Pitfall 7 | Removing approval entirely changes opencode's permission behavior — a security-relevant decision (see Security Domain); must be human-confirmed |
| A4 | The legacy-import flag channel recommendation (`legacyImport.enabled` RPC) is preferred over build-time env; the CONTEXT leaves the choice to the planner | Pattern 4 | Any channel works; risk is only in UX (button visibility race) |
| A5 | `chatSessions.compact`/`tasks.compact` RPCs have zero live UI callers (verified: only store function `compactTask` at task.ts:359 with no component callers, and ContextPopover which is dead) | Phase Requirements | If a live component calls them through an indirection I missed, removing them breaks tsc — the type-removal-first strategy catches this at compile time |

**All inventory claims (Groups A-E, write call-sites, verbatim type quotes) are [VERIFIED] this session via Read/grep of the source files cited inline.**

## Open Questions

1. **Failure-toast replacement (A2)** — keep "Execution failed" toast via a new push type, or drop it (recommended)?
   - What we know: the toast only fires for taskId != null stream.error; chat already shows RUN_ERROR.
   - What's unclear: whether the user values the toast for background (non-chat) failures.
   - Recommendation: drop; revisit in v2. Planner should gate behind a `checkpoint:human-verify`.

2. **opencode shell-approval behavior (A3)** — after removing waitForResume, does opencode auto-approve permission requests?
   - What we know: opencode engine:128-136 auto-approves when `shellState.shellAutoApprove` is set, else waits (hang today).
   - What's unclear: the intended security posture for shell commands under "decision_request is the only HITL".
   - Recommendation: auto-approve (matching the trim decision); human-checkpoint it.

3. **What happens to `model_raw_messages` writes** — stop them too (raw-message-buffer), or leave as inspection data?
   - What we know: only writer is makePersistCallback (engine/stream/stream-processor.ts:105-121); only reader is retention-job deletes; cursor/adapter.ts:64 mentions "later inspection" in a comment.
   - What's unclear: whether any diagnostics flow reads them.
   - Recommendation: stop the writes with the rest (D-04 lists the table with `?`); retention job keeps pruning old rows.

4. **`conversations.getMessages` loading-gate fate** — SessionChatView's `messagesLoading` gate (SessionChatView.vue:56-77) depends on the RPC completing; with writes stopped, new sessions return empty.
   - What we know: the gate is a vestige; RailyinChat owns history via AG-UI connect.
   - What's unclear: whether to keep the RPC (frozen reads are allowed) or remove the gate + RPC entirely.
   - Recommendation: keep the RPC (frozen reads + smoke-test surface + old-history display), keep the gate, drop only the streaming layers of the store.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Runtime + `bun test` | ✓ | 1.4.0 | — |
| Node | Playwright/vite tooling | ✓ | v20.20.1 | — |
| Playwright | e2e/ui gate leg | ✓ (package.json scripts `test:e2e:*`) | pinned | — |
| SQLite (bun:sqlite) | Frozen-table reads (importer, getMessages) + write-path verification | ✓ (built into Bun) | — | — |

**Missing dependencies with no fallback:** none. This phase is code/config-only with no external services; Step 2.6 audit is otherwise complete.

## Validation Architecture

`workflow.nyquist_validation` is `true` (config.json) — section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (vitest config; `bun test`) + Playwright (e2e/ui) |
| Config file | vitest.config.ts (aliases `@`/`@shared`/`@bun`), playwright.config.ts |
| Quick run command | `bun test src/bun --timeout 20000` (per-file: `bun test src/bun/test/orchestrator.test.ts`) |
| Full suite command | Pattern 3 6-leg gate (build → playwright → e2e/api → src/bun → typecheck → mock-agui) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| Trim (all) | Deleted surfaces produce zero grep hits | smoke (grep) | `git grep -n "StreamEvent\|stream-tree\|stream.event" src e2e` → expect empty | ✅ (gate script task) |
| D-01 | Legacy chat components gone; board/task views build | compile + e2e | `bun run build` + `bunx playwright test e2e/ui/chat-copilotkit.spec.ts e2e/ui/board.spec.ts` | ✅ existing |
| D-02 | Trim RPCs/events unreferenced | compile | `bun run typecheck` | ✅ existing |
| D-04/D-05 | No new writes to frozen tables | unit/integration | Reworked smoke assertions: poll `data/threads/{id}.jsonl` after sendMessage (smoke.test.ts:249-296 rewrite) + `rg -n "INSERT INTO conversation_messages" src/bun` → zero | ❌ Wave 0: smoke.test.ts rewrite |
| D-06 | Import behind flag | integration | `e2e/api/copilotkit/legacy-import.test.ts` spawned with `RAILYN_LEGACY_IMPORT=1` (fixture extraEnv) | ✅ existing (env add) |
| D-07 | Full gate green | e2e + unit | Pattern 3 legs 3-8 | ✅ existing |
| Session-status push | Sidebar shows idle after run end | e2e | New/adapted session-drawer spec asserting status flip without stream.event (chat-session-drawer.spec.ts) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run typecheck` (fastest missed-reference detector) + affected `bun test <file>`
- **Per wave merge:** Pattern 3 tripwire (chat-copilotkit + board + board-ws-updates)
- **Phase gate:** full 6-leg gate, single chained command, `rm -rf test-results playwright-report` first

### Wave 0 Gaps
- [ ] `e2e/api/smoke.test.ts` — rewrite ~8 `conversations.getMessages` assistant-reply assertions (:249-296, :328-331, :376-397) to poll the JSONL log
- [ ] `src/mainview/stores/chat.test.ts` (441L), `conversation.test.ts` (578L), `task.test.ts` (546L), `dispatch.test.ts` (186L) — strip queue/live-block/stream-push coverage per Pattern 1 Group D
- [ ] `src/bun` pipeline tests — delete/rework: `stream-tree-scenarios.test.ts`, `stream-event-enricher.test.ts`, `server/stream-processor.test.ts`, `stream-pipeline-scenarios.test.ts`, plus StreamEvent-dependent scenarios in `orchestrator.test.ts`, `retry.test.ts`, `claude-rpc-scenarios.test.ts`, `copilot-rpc-scenarios.test.ts`, `cursor/rpc-scenarios.test.ts`, `handlers.test.ts`, `retention-job.test.ts` (retention itself stays)
- [ ] `e2e/ui/fixtures/mock-ws.ts` (pushStreamEvent :59-86), `e2e/ui/fixtures/index.ts:72` (getStreamEvents mock), `e2e/ui/interview-me.spec.ts:541` — remove StreamEvent-typed helpers
- [ ] `src/bun/test/support/shared-rpc-scenarios.ts:214-244` — writtenFiles/file_diff scenario assertions
- [ ] `src/bun/test/server/shutdown.test.ts:20` — markClaudeExecution stub removal (D-03)
- [ ] Session-status replacement spec (Open Question 1 area)

## Security Domain

`security_enforcement: true` (config.json) — section required. This is a deletion phase: the security surface SHRINKS. The only security-relevant decisions are the shell-approval trim (A3) and the importer flag.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local-first single user; no auth surface added/removed |
| V3 Session Management | no | — |
| V4 Access Control | yes | `legacyImport.run` gated behind `RAILYN_LEGACY_IMPORT=1` (Pattern 4) — the only privileged operation added to this phase (it reads frozen tables; harmless but off by default per D-06) |
| V5 Input Validation | yes | Existing zod-free RPC contract (`RailynAPI` typing + handler guards); the new `legacyImport.enabled` RPC returns a boolean — no new input surface; `legacyImport.run` params unchanged (`{}`) |
| V6 Cryptography | no | — |

### Known Threat Patterns for {stack}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell-approval bypass after trim (opencode/claude no longer ask) | Tampering/Elevation | **Human decision required (A3):** the trim deliberately removes the only interactive shell gate. Mitigation options: (a) accept — engines are trusted local agents (project's posture: "decision_request is the only HITL"); (b) keep an always-deny/always-approve config knob. Do NOT leave the waitForResume hang (invisible pause = worse than either choice). |
| Deleted-then-restored dead code paths (incomplete trim) | — | Post-deletion `git grep` gate (Pattern 3 step 2) enumerates the protocol terms; type-removal-first ordering makes missed references compile errors |
| Frozen-table tampering via retained write helpers | Tampering | `appendStreamEvent`/`appendStreamEventBatch`/`appendMessage`-into-frozen-tables removed from code; grep gate `INSERT INTO conversation_messages|stream_events` → zero outside migrations/tests |

## Sources

### Primary (HIGH confidence — source of truth read this session)
- `src/shared/rpc-types.ts` (:619-645 StreamEvent/StreamEventType verbatim; :1196-1204 PushMessage verbatim; :95-106 MessageType; :658+ RailynAPI method list) — the protocol + RPC trim surface
- `src/bun/engine/types.ts` (:20-52 EngineEvent union; :60-62 EngineResumeInput) — engine event trim surface
- `src/bun/engine/stream/stream-processor.ts` (711L, full read) — the consume() rewrite target; :68-75 markClaudeExecution; :223-234 skip logic; :242-248 status; :397-421 usage; :477-492 ask_user/shell_approval; :525-539 compaction; :670-710 file_diff
- `src/bun/server/stream-processor.ts` (full read) — StreamEventProcessor: onStreamEvent persist+broadcast (:30-59), onRawMessageEnqueued (:61-113), setMarkClaudeExecution (:115-117)
- `src/bun/index.ts` (:142, :235-244) — wiring: streamProc construction, onRawMessageEnqueued ctor arg, setOnStreamEvent, setMarkClaudeExecution, start; :262 RAILYN_COPILOTKIT_PROBE flag precedent; :343 legacyImportHandlers registration
- `src/bun/copilotkit/event-bridge.ts` (:280-289 — bridge drops usage/status/compaction/ask_user/shell_approval)
- `src/bun/copilotkit/import.ts` + `src/bun/handlers/legacy-import.ts` (full read) — importer (SELECT-only, TRIMMED_TYPES at :34-42)
- Import graphs: every component/module in Groups A-E verified by `rg` import-statement greps this session (see Pattern 1 tables)
- `.planning/phases/06-e2e-migration-verification/06-SUMMARY.md` — the 517/0 gate evidence + retire inventory + A6 gap
- `AGENTS.md` — shared-contract discipline (rpc-types + handlers + consumers together), task-movement warning, test commands

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md`, `FEATURES.md` — legacy stack inventory + anti-feature list (trim rationale)
- `src/bun/conversation/context.ts` (:242-309 estimate/compact functions), `src/bun/context-usage.ts`, `context-estimator.ts` — usage-display ecosystem boundaries
- `src/bun/engine/opencode/engine.ts` (:128-136, :158-165 shell approval), `src/bun/engine/claude/adapter.ts` (:201-205, :378), `src/bun/engine/claude/engine.ts` (:45, :107-128 FileStateCache) — engine emitter surfaces

### Tertiary (LOW confidence)
- None — all behavioral claims verified in-repo this session; external sources not needed for a pure-deletion phase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero packages; the gate toolchain is verified present (bun 1.4.0, node 20.20.1)
- Architecture: HIGH for the deletion inventory + write-path audit (all source-of-truth verified); MEDIUM for the two behavior-replacement decisions (session-status push, failure toast) and engine-trim depth (A1-A3 assumptions)
- Pitfalls: HIGH — every pitfall is grounded in a verified code path (FileChangesRenderer import, chat.ts:78-84, smoke.test.ts assertions, orchestrator.ts:131,159 executor wiring, App.vue:58-75)

**Research date:** 2026-08-09
**Valid until:** 2026-09-09 (in-repo deletion phase — validity bounded by code drift, not external releases; the gate baselines are pinned in 06-SUMMARY)
