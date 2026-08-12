## 1. Shared types and tool definition

- [ ] 1.1 Add `decision_request_page` to `StreamEventType` in `src/shared/rpc-types.ts` (ephemeral, not persisted) alongside the existing `decision_request_prompt` message type
- [ ] 1.2 Add optional `context?: string` to `DecisionRequestQuestion` in `src/shared/rpc-types.ts` (per-question preamble; `DecisionRequestPayload` shape preserved)
- [ ] 1.3 Rewrite `DECISION_REQUEST_TOOL_DEFINITION` in `src/bun/engine/decision-request-tool-definition.ts` — single `question` object property (with nested `required: ["question", "type"]`, `type` enum, `options` `minItems: 2`), optional top-level `context`, and updated description teaching the streaming contract (call once per question; END YOUR TURN to present)

## 2. Validation and normalization

- [ ] 2.1 Extend `validateToolArgs` in `src/bun/engine/validate-tool-args.ts` — for `required` errors, resolve the missing property in the schema node at the error path and append its enum values when present (e.g. `field 'question.type' is required (valid values: ...)`)
- [ ] 2.2 Confirm `normalizeToolArguments` handles single-question object + options array string-encoding (existing function; add case coverage in tests later)

## 3. Per-execution decision buffer

- [ ] 3.1 Create `src/bun/engine/decision-buffer.ts` — `DecisionQuestionBuffer` class with `append(entry: { context?: string; question: DecisionRequestQuestion })`, `all`, `count`, `clear()`
- [ ] 3.2 Add `runtime.decisionBuffer: DecisionQuestionBuffer` to `CommonToolContext` in `src/bun/engine/types.ts` (optional field for safety)
- [ ] 3.3 Wire fresh buffer per execution: Pi (`PiToolFactory.getOrCreateCommonContext`/`buildTools` — reset cached contexts like `loopDetector.reset()`), Cursor (`CursorEngine._run`), Claude (`claude/adapter.ts` `_run`), Copilot (`copilot/engine.ts`), OpenCode (`opencode/adapter.ts` contextMap entry)

## 4. executeCommonTool — choke-point normalize + page result

- [ ] 4.1 In `executeCommonTool` (`src/bun/engine/common-tools.ts`): call `normalizeToolArguments(def.parameters, args)` at the top before `validateToolArgs`
- [ ] 4.2 Add `{ type: "page"; text: string; payload: string }` to `ToolExecutionResult`
- [ ] 4.3 Rewrite the `decision_request` case: validate single question (schema + runtime options-count for non-freetext), append to `ctx.runtime.decisionBuffer`, return `{ type: "page", text: <count + END YOUR TURN hint>, payload: JSON.stringify(page) }`; invalid → `{ type: "result", text: <error> }` with buffer preserved; keep `suspend` path only for ask_user/shell_approval-style tools

## 5. Engine wrappers — page emission + turn-end flush

- [ ] 5.1 **Pi** (`src/bun/engine/pi/tools/common.ts` + `engine.ts`): handle `result.type === "page"` → emit `{ type: "decision_request_page", payload }` via suspendRef/pageRef extension; at turn end (before `done`) flush buffer to terminal `{ type: "decision_request", payload }`
- [ ] 5.2 **Cursor** (`src/bun/engine/cursor/tools.ts` + `engine.ts`): add `onPage` callback wired to emit `decision_request_page`; replace `pendingDecisionPayload` block with buffer turn-end flush (old per-call abort removed for decision_request)
- [ ] 5.3 **Claude** (`src/bun/engine/claude/tools.ts` + `adapter.ts`): handle `page` result → emit engine event; turn-end flush before done
- [ ] 5.4 **Copilot** (`src/bun/engine/copilot/tools.ts` + `engine.ts`): `onPage` callback; turn-end flush before done
- [ ] 5.5 **OpenCode** (`src/bun/engine/opencode/mcp-server.ts` + `adapter.ts`): `page` result → return text to model and push `decision_request_page` into sideEvents; turn-end flush before done

## 6. Stream processor

- [ ] 6.1 Handle `decision_request_page` engine event in `src/bun/engine/stream/stream-processor.ts` — emit ephemeral `decision_request_page` stream event (no persistence, no execution-state change)
- [ ] 6.2 Verify the existing terminal `decision_request` case (persist `decision_request_prompt`, set `waiting_user`) is unchanged and reachable via turn-end flush

## 7. Frontend — live interview state

- [ ] 7.1 In `src/mainview/stores/conversation.ts`: maintain live-interview state per conversation; handle `decision_request_page` stream events (append page); on terminal `decision_request_prompt` persist/reconcile into the interview state
- [ ] 7.2 In `src/mainview/stores/chat.ts` / `task.ts`: route `decision_request_page` stream events appropriately (no `waiting_user` on pages; only on terminal prompt — existing logic preserved)

## 8. Frontend — DecisionRequest pagination

- [ ] 8.1 Refactor `src/mainview/components/DecisionRequest.vue` — pagination (page index, Back / Next / Submit footer, per-page validation gating), per-question `context` rendering, per-page answer state preserved
- [ ] 8.2 Extract/extend pure helpers in `src/mainview/utils/decisionRequest.ts` for page navigation + per-page validation (canSubmit per page)

## 9. Frontend — DecisionInterviewPanel

- [ ] 9.1 Create `src/mainview/components/DecisionInterviewPanel.vue` — fixed panel rendering live pages from the store; one question per page; footer Back / Next / Submit; Submit disabled until `waiting_user`; per-question context; reconciles to persisted payload at turn end
- [ ] 9.2 Mount in `src/mainview/components/TaskChatView.vue` between `ConversationBody` and `ChangedFilesPanel`/`TodoPanel` (above prompt input)
- [ ] 9.3 Mount in `src/mainview/components/SessionChatView.vue` above `ConversationInput`
- [ ] 9.4 Update `src/mainview/components/MessageBubble.vue` — retire in-chat interview form for new interviews; keep legacy persisted `decision_request_prompt` rendering

## 10. Test infrastructure (DI seams)

- [ ] 10.1 Add `makeDecisionCtx()` test helper (fresh `DecisionQuestionBuffer` + `initDb()` repos) — mirrors `common-tools-registration.test.ts` `baseContext` `beforeEach`; used wherever `executeCommonTool("decision_request", ...)` is tested
- [ ] 10.2 Update `MockCursorSdkAdapter.callTool` to mirror the `page` contract (D11): `type === "page"` → yield `decision_request_page` + tool_start/tool_result pair, no abort; `type === "suspend"` keeps abort semantics
- [ ] 10.3 Update equivalent mocks for Copilot / OpenCode (`opencode-sdk-mock.ts` `callTool`) / Claude to mirror the same `page` contract
- [ ] 10.4 Add `decision_request_page` fixture + `pushDecisionRequestPage` helper to `e2e/ui/fixtures/mock-data.ts` / `mock-ws.ts`

## 11. Tests — L1 unit

- [ ] 11.1 Create `src/bun/test/decision-buffer.test.ts` — `append`/`all`/`count`/`clear`; fresh-per-execution semantics
- [ ] 11.2 Create `src/bun/test/decision-request-executor.test.ts` (after extraction, task 12.1) — valid single question → `{ type: "page" }` + count text; missing `type` → schema-aware error + buffer preserved; `exclusive` 1 option → error; `freetext` no options → `page`; count + END-YOUR-TURN hint
- [ ] 11.3 Create `src/bun/test/build-decision-request-terminal-event.test.ts` — non-empty buffer → terminal `decision_request` with all questions; empty buffer → null
- [ ] 11.4 Extend `src/bun/test/validate-tool-args.test.ts` — missing required enum field lists valid values (generic, not just decision_request); migrate V-6..V-9 to single-question shape
- [ ] 11.5 Extend `src/mainview/utils/decisionRequest.ts` + tests — pagination helpers: `canAdvancePage`, per-page validity, answer-state preservation across Back/Next

## 12. Tests — L2 component-DI

- [ ] 12.1 Extract `decision_request` execution into `src/bun/engine/decision-request-executor.ts` (also reduces `common-tools.ts` god-file)
- [ ] 12.2 Extend `src/bun/test/pi-common-tools-bridge.test.ts` — `page` result → `pageRef.onPage` fires + text returned to model; `suspend` still routed to `suspendRef.onSuspend`
- [ ] 12.3 Rewrite `src/bun/test/claude-tools.test.ts` decision_request sections — SpyZod shape asserts single `question` object (not array); `type` enum inline; `takePendingPage` return contract; `executeCommonTool` tests use `makeDecisionCtx()`
- [ ] 12.4 Update `src/bun/test/common-tools-registration.test.ts` — `baseContext` gains `runtime.decisionBuffer`; decision_request description/registration assertions updated

## 13. Tests — L3 integration (in-memory DB + fake engines)

- [ ] 13.1 Add `runDecisionStreamingScenario(runtime)` to `src/bun/test/support/shared-rpc-scenarios.ts` — N single-question appends → 1 terminal `decision_request` → `waiting_user`; assert `decision_request_prompt` persisted and `decision_request_page` on IPC but NOT in DB
- [ ] 13.2 Update `src/bun/test/cursor/rpc-scenarios.test.ts` §6.3.5a/b — multiple `callTool("decision_request", { question })` steps; terminal persistence; follow-up restarts as fresh execution
- [ ] 13.3 Update `src/bun/test/copilot-rpc-scenarios.test.ts` L197 — single-question streaming via shared handler
- [ ] 13.4 Update `src/bun/test/opencode-rpc-scenarios.test.ts` — streaming via MCP `callTool` (single-question, page events through sideEvents)
- [ ] 13.5 Update `src/bun/test/claude-rpc-scenarios.test.ts` L160 — terminal payload shape; add page-event scenarios
- [ ] 13.6 Add ScriptedEngine turn-end flush scenario to `src/bun/test/stream-pipeline-scenarios.test.ts` — queue `[decision_request_page, decision_request_page, decision_request]`; assert IPC has pages, DB only has the terminal prompt
- [ ] 13.7 Update `src/bun/test/cursor/adapter.test.ts` L116-143 + L624 — fake tool emits page events; keep-alive comment reflects no-per-call-abort
- [ ] 13.8 Add Pi faux-provider scenario (`createFauxSessionFactory`) — scripted model calls `decision_request` 3× then ends → terminal event
- [ ] 13.9 Verify `tasks.submitDecisions` / `human-turn-executor` resume-after-terminal still works with streaming payload

## 14. Tests — L4 Playwright

- [ ] 14.1 Rework `e2e/ui/interview-me.spec.ts` — panel placement above input; pages stream via `ws.pushStreamEvent({ type: "decision_request_page" })`; pagination footer Back/Next/Submit; Submit disabled while running, enabled at `waiting_user`; per-question context; reconcile live→persisted at `done`
- [ ] 14.2 Add panel streaming scenarios — pages append without full reload; background-task pages don't disturb active conversation; answered interview renders read-only

## 15. Cleanup / refactor

- [ ] 15.1 Extract `buildDecisionRequestTerminalEvent(buffer)` pure helper (shared turn-end flush, D10) — used by all 5 engines before `done`
- [ ] 15.2 Remove obsolete decision_request abort plumbing in Cursor engine (kept only for ask_user/shell_approval)
- [ ] 15.3 Keep `executeCommonTool` dispatch thin — decision_request handled via the extracted executor module
