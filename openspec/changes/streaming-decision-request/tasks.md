## 1. Shared types and tool definition

- [x] 1.1 Add `decision_request_page` to `StreamEventType` in `src/shared/rpc-types.ts` (ephemeral, not persisted) alongside the existing `decision_request_prompt` message type
- [x] 1.2 Add optional `context?: string` to `DecisionRequestQuestion` in `src/shared/rpc-types.ts` (per-question preamble; `DecisionRequestPayload` shape preserved)
- [x] 1.3 Rewrite `DECISION_REQUEST_TOOL_DEFINITION` in `src/bun/engine/decision-request-tool-definition.ts` — single `question` object property (with nested `required: ["question", "type"]`, `type` enum, `options` `minItems: 2`), optional top-level `context`, and updated description teaching the streaming contract (call once per question; END YOUR TURN to present)

## 2. Validation and normalization

- [x] 2.1 Extend `validateToolArgs` in `src/bun/engine/validate-tool-args.ts` — for `required` errors, resolve the missing property in the schema node at the error path and append its enum values when present (e.g. `field 'question.type' is required (valid values: ...)`)
- [x] 2.2 Confirm `normalizeToolArguments` handles single-question object + options array string-encoding (existing function; wired at choke-point, covered by executor tests)

## 3. Per-execution decision buffer

- [x] 3.1 Create `src/bun/engine/decision-buffer.ts` — `DecisionQuestionBuffer` class with `append(entry: { context?: string; question: DecisionRequestQuestion })`, `all`, `count`, `clear()`
- [x] 3.2 Add `runtime.decisionBuffer: DecisionQuestionBuffer` to `CommonToolContext` in `src/bun/engine/types.ts` (optional field for safety)
- [x] 3.3 Wire fresh buffer per execution: Pi (`PiToolFactory.getOrCreateCommonContext`/`buildTools` — reset cached contexts like `loopDetector.reset()`), Cursor (`CursorEngine._run`), Claude (`claude/adapter.ts` `_run`), Copilot (`copilot/engine.ts`), OpenCode (`opencode/adapter.ts` contextMap entry)

## 4. executeCommonTool — choke-point normalize + page result

- [x] 4.1 In `executeCommonTool` (`src/bun/engine/common-tools.ts`): call `normalizeToolArguments(def.parameters, args)` at the top before `validateToolArgs`
- [x] 4.2 Add `{ type: "page"; text: string; payload: string }` to `ToolExecutionResult`; remove `suspend` variant (user decision: no common tool returns suspend anymore)
- [x] 4.3 Rewrite the `decision_request` case: validate single question (schema + runtime options-count for non-freetext), append to `ctx.runtime.decisionBuffer`, return `{ type: "page", text: <count + END YOUR TURN hint>, payload: JSON.stringify(page) }`; invalid → `{ type: "result", text: <error> }` with buffer preserved (delegates to `decision-request-executor.ts`)

## 5. Engine wrappers — page emission + turn-end flush

- [x] 5.1 **Pi** (`src/bun/engine/pi/tools/common.ts` + `engine.ts`): handle `result.type === "page"` → emit `{ type: "decision_request_page", payload }` via `pageRef.onPage`; at turn end (before `done`) flush buffer via `buildDecisionRequestTerminalEvent`. Renamed `SuspendRef` → `PageRef`; removed `suspendedForDecision` + aborted-message trimming
- [x] 5.2 **Cursor** (`src/bun/engine/cursor/tools.ts` + `engine.ts`): `onPage` callback → pageQueue drained in run loop; `pendingDecisionPayload`/`decisionAbort` removed; turn-end flush via buffer
- [x] 5.3 **Claude** (`src/bun/engine/claude/tools.ts` + `adapter.ts`): `takePendingPage` replaces `takePendingSuspend`; PostToolUse emits `decision_request_page` (no `continue:false`); `done` interception in `emit` does turn-end flush
- [x] 5.4 **Copilot** (`src/bun/engine/copilot/tools.ts` + `engine.ts`): `onPage` callback → pageQueue drained; `pendingDecisionPayload`/`decisionAbortController` removed; turn-end flush via buffer
- [x] 5.5 **OpenCode** (`src/bun/engine/opencode/mcp-server.ts` + `adapter.ts` + `engine.ts`): `page` result → `onPage` side-channel + text returned immediately (no long-poll); `pendingQuestion`/`onAskUser`/`respondAskUser` removed; `resume(ask_user)` throws (fresh-execution contract); turn-end flush before done

## 6. Stream processor

- [x] 6.1 Handle `decision_request_page` engine event in `src/bun/engine/stream/stream-processor.ts` — emit ephemeral `decision_request_page` stream event (no persistence, no execution-state change)
- [x] 6.2 Verify the existing terminal `decision_request` case (persist `decision_request_prompt`, set `waiting_user`) is unchanged and reachable via turn-end flush

## 7. Frontend — live interview state

- [x] 7.1 In `src/mainview/stores/conversation.ts`: maintain `liveInterviews` per conversation; handle `decision_request_page` stream events (append page); on terminal `decision_request_prompt` delete the live state (reconcile)
- [x] 7.2 In `src/mainview/stores/chat.ts` / `task.ts`: unchanged — `waiting_user` still set only on terminal `decision_request_prompt` message (existing logic preserved)

## 8. Frontend — DecisionRequest pagination

- [x] 8.1 Refactor `src/mainview/components/DecisionRequest.vue` — pagination (page index, Back / Next / Submit footer, per-page validation gating), per-question `context` rendering, per-page answer state preserved
- [x] 8.2 Extract/extend pure helpers in `src/mainview/utils/decisionRequest.ts` — `canAdvancePage`, `clampPageIndex`

## 9. Frontend — DecisionInterviewPanel

- [x] 9.1 Create `src/mainview/components/DecisionInterviewPanel.vue` — fixed panel rendering live pages from the store; reconciles to persisted payload at turn end; Submit via task/chat store submitDecisions
- [x] 9.2 Mount in `src/mainview/components/TaskChatView.vue` between `ConversationBody` and `ChangedFilesPanel`/`TodoPanel` (above prompt input)
- [x] 9.3 Mount in `src/mainview/components/SessionChatView.vue` above `ConversationInput`
- [x] 9.4 Update `src/mainview/components/MessageBubble.vue` — retire in-chat interview form for new interviews (legacy read-only/answered rendering retained)

## 10. Test infrastructure (DI seams)

- [x] 10.1 `makeDecisionCtx()` helper inlined into tests (fresh `DecisionQuestionBuffer`); `common-tools-registration.test.ts` `baseContext` gains `runtime.decisionBuffer`
- [x] 10.2 `MockCursorSdkAdapter.callTool` mirrors the `page` contract (D11): emits tool_start/tool_result, no abort (streaming)
- [x] 10.3 Mocks updated: OpenCode (`opencode-sdk-mock.ts`) removes ask_user long-poll, adds `onPage` side-channel; Claude mock emits `decision_request_page` on page results
- [x] 10.4 Add `decision_request_page` fixture + `pushDecisionRequestPage` helper to `e2e/ui/fixtures/mock-ws.ts`

## 11. Tests — L1 unit

- [x] 11.1 `src/bun/test/decision-buffer.test.ts` — `append`/`all`/`count`/`clear`; copy semantics
- [x] 11.2 `src/bun/test/decision-request-executor.test.ts` — valid single question → `page` + count text; missing `type` → error + buffer preserved; `exclusive` 1 option → error; `freetext` → `page`; count + END-YOUR-TURN hint; no-buffer error; context folding
- [x] 11.3 `src/bun/test/build-decision-request-terminal-event.test.ts` — non-empty buffer → terminal with all questions; empty → null; context folding; no mutation
- [x] 11.4 `src/bun/test/validate-tool-args.test.ts` — V-6..V-9 migrated to single-question; schema-aware enum hint asserts
- [x] 11.5 `src/mainview/utils/decisionRequest.ts` tests — pagination helpers (`canAdvancePage`, `clampPageIndex`)

## 12. Tests — L2 component-DI

- [x] 12.1 `src/bun/engine/decision-request-executor.ts` extracted
- [x] 12.2 Extend `src/bun/test/pi-common-tools-bridge.test.ts` — `page` result → `pageRef.onPage` fires + text returned to model (PCB-5)
- [x] 12.3 `src/bun/test/claude-tools.test.ts` rewritten — SpyZod single `question` object; `type` enum inline; `takePendingPage` contract; execute tests use fresh buffer ctx
- [x] 12.4 `src/bun/test/common-tools-registration.test.ts` — `baseContext` gains `runtime.decisionBuffer`; single-question page result asserts

## 13. Tests — L3 integration (in-memory DB + fake engines)

- [x] 13.1 `runDecisionStreamingScenario(runtime)` added to `src/bun/test/support/shared-rpc-scenarios.ts` — asserts terminal prompt persisted + page events IPC-not-DB
- [x] 13.2 `src/bun/test/cursor/rpc-scenarios.test.ts` §6.3.5a/b updated — multi-question streaming; terminal carries all buffered questions; follow-up restarts fresh execution
- [x] 13.3 `src/bun/test/copilot-rpc-scenarios.test.ts` L197 updated — single-question streaming + done step
- [x] 13.4 `src/bun/test/opencode-rpc-scenarios.test.ts` — ask_user scenarios removed (long-poll obsolete); shell_approval retained
- [x] 13.5 `src/bun/test/claude-rpc-scenarios.test.ts` — terminal payload shape remains valid
- [x] 13.6 ScriptedEngine turn-end flush scenario added to `src/bun/test/stream-pipeline-scenarios.test.ts` (S-16) — page events IPC-only; terminal prompt persisted + waiting_user
- [x] 13.7 `src/bun/test/cursor/adapter.test.ts` L116-143 — fake tool test rewritten for streaming (no abort)
- [x] 13.8 Pi faux-provider scenario added (`src/bun/test/pi-decision-streaming.test.ts`) — scripted model calls `decision_request` 3× then ends → page events + terminal event
- [x] 13.9 Verify `tasks.submitDecisions` / `human-turn-executor` resume-after-terminal still works with streaming payload (covered by cursor §6.3.5b + copilot decision scenarios)

## 14. Tests — L4 Playwright

- [x] 14.1 Rework `e2e/ui/interview-me.spec.ts` — panel placement above input; pages stream via `pushDecisionRequestPage`; pagination footer Back/Next/Submit (T-D/T-D2); Submit disabled while running, enabled at `waiting_user`; reconcile live→persisted at `done` (T-J/T-J2/T-K)
- [x] 14.2 Panel streaming scenarios — T-J streams pages into panel before done; answered interview renders read-only (T-F/T-G)

## 15. Cleanup / refactor

- [x] 15.1 Extract `buildDecisionRequestTerminalEvent(buffer)` pure helper (shared turn-end flush, D10) — used by all 5 engines before `done`
- [x] 15.2 Remove obsolete decision_request abort plumbing in all engines (Cursor `pendingDecisionPayload`/`decisionAbort`, Copilot `decisionAbortController`, Pi `suspendedForDecision`, Claude `takePendingSuspend`, OpenCode MCP long-poll) — ask_user/shell_approval retained
- [x] 15.3 Keep `executeCommonTool` dispatch thin — decision_request handled via the extracted executor module
