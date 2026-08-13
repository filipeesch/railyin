# Implementation Tasks

## 1. Resize direction (D1)

- [x] 1.1 `src/mainview/components/DecisionInterviewPanel.vue` — flip `onMove` delta: `next = startHeight - delta`; update the comment ("drag UP grows, drag DOWN shrinks")
- [x] 1.2 `e2e/ui/interview-me.spec.ts` T-D5 — drag the handle UP (`startY - 120`) and assert `resizedHeight > initialHeight`; keep the double-click reset assertion

## 2. Submit gating on waiting_user (D2)

- [x] 2.1 `DecisionInterviewPanel.vue` — add `executionState: string | null` prop; compute `readyToSubmit = executionState === "waiting_user"`
- [x] 2.2 `TaskChatView.vue` — pass `:execution-state="task.executionState"`; `SessionChatView.vue` — pass `:execution-state="session.status"`
- [x] 2.3 `DecisionRequest.vue` — add `readyToSubmit` prop (default `true`); `canSubmit = readyToSubmit && canSubmitDecisionRequest(...)`; `Next` stays ungated
- [ ] 2.4 `e2e/ui/interview-me.spec.ts` T-J — assert Submit disabled while running **even with all answers filled**; enabled at `waiting_user`

## 3. Robust answered/stale detection (D3)

- [x] 3.1 Create `src/mainview/utils/decisionInterview.ts` with `latestPromptId`, `hasUserMessageAfterPrompt`, `isInterviewStale`, `episodeKey`, `isDismissedEpisode`
- [x] 3.2 `DecisionInterviewPanel.vue` — rewire `showPanel`/`answered` through the helpers + `executionState` (id-based user-after-prompt OR stale rule)
- [x] 3.3 `DecisionRequest.vue` — remove the now-dead `answeredText` prop and `answered` computed (panel never mounts it when answered)

## 4. Per-episode dismissal persistence (D4)

- [x] 4.1 `src/mainview/stores/conversation.ts` — add `dismissedInterviews: Map<number, string>` (conversationId → episode key) with accessors
- [x] 4.2 `DecisionInterviewPanel.vue` — replace component-local `dismissed`/`dismissedForExecution` with store-backed dismissal using `episodeKey`; drop the `activeConversationId` reset watcher
- [x] 4.3 Ensure dismissal clears when a new episode begins (live execution id or latest prompt id changes)

## 5. Remove the in-chat balloon (D5)

- [x] 5.1 `src/mainview/components/MessageBubble.vue` — delete the `chunk.type === "decision_request_prompt"` template branch
- [x] 5.2 Delete the `interviewAnsweredText` computed and the `msg--interview-prompt` / `interview__answered*` / `interview__legacy-hint` styles

## 6. Fixed footer, content-only scroll (D6)

- [x] 6.1 `DecisionRequest.vue` — restructure `.interview` as a flex column; wrap context/section/general-notes in `.interview__content` (`flex: 1; min-height: 0; overflow-y: auto`); footer outside the scroll region (`flex-shrink: 0`)
- [x] 6.2 `DecisionInterviewPanel.vue` — `.decision-interview-panel__body` becomes `overflow: hidden` (scroll moves inside `DecisionRequest`)
- [x] 6.3 `e2e/ui/interview-me.spec.ts` T-D6 — target the new `.interview__content` scroll container

## 7. Backend superseded-flush guard (D7)

- [x] 7.1 `src/bun/engine/stream/stream-processor.ts` `case "decision_request"` — task-backed: `SELECT current_execution_id FROM tasks WHERE id = ?`; proceed only when it equals `executionId`
- [x] 7.2 Session path: `SELECT 1 FROM executions WHERE conversation_id = ? AND id > ? LIMIT 1`; proceed only when no newer execution exists
- [x] 7.3 When superseded: skip `decision_request_prompt` persist and skip execution/task state changes; `console.debug` log

## 8. Store hygiene (D8)

- [x] 8.1 `conversation.ts` `setActiveConversation(null)` — clear `liveInterviews` and `liveInterviewExecutions` for the closed conversation
- [x] 8.2 `conversation.ts` `onNewMessage` — exempt `decision_request_prompt` from the "stream not done" drop guard so the live→persisted reconcile always runs

## 9. Verification

- [x] 9.1 `bun run build` (frontend compiles) — ✓ (also `bun run typecheck` clean)
- [x] 9.2 `bun test src/mainview/stores/conversation.test.ts` and any touched unit suites — ✓ all touched suites pass individually (utils/decisionInterview, decisionRequest, conversation store, stream-processor, stream-pipeline-scenarios, + full `src/bun` 2444 pass)
- [x] 9.3 `bun run build && bun run test:e2e:chat` — interview-me.spec.ts passes with corrected expectations — ✓ 42/42; full Playwright suite 710 pass (1 pre-existing flaky delegate-rendering S-D5, passes in isolation; CD-D-6 session test updated for the corrected gating)

## 10. Testing (aligned scenarios)

### 10.1 Refactorings that enable coverage (R1–R5)

- [x] 10.1.1 R1: create `src/mainview/utils/decisionInterview.ts` (pure panel state — also used by §3)
- [x] 10.1.2 R2: extract `computeResizeHeight(startHeight, delta, min, max)` from `DecisionInterviewPanel.onMove` into the utils module
- [x] 10.1.3 R3: add `canSubmitInterview(questions, state, readyToSubmit)` to `src/mainview/utils/decisionRequest.ts`; `DecisionRequest` uses it
- [x] 10.1.4 R4: add `dismissedInterviews` accessors (`dismissInterview(conversationId, key)`, `clearDismissedInterview(conversationId)`) to the conversation store
- [x] 10.1.5 R5: add `waitingTask(id)` helper in `e2e/ui/interview-me.spec.ts` (task with `executionState: "waiting_user"`)

### 10.2 L1 unit — `utils/decisionInterview.test.ts` (new)

- [x] 10.2.1 `latestPromptId`: none / single / multiple (last wins) / other-conversation filtered
- [x] 10.2.2 `hasUserMessageAfterPrompt`: user after (true), user before (false), no user (false), other conversation (false)
- [x] 10.2.3 `isInterviewStale`: full truth table (persisted + waiting_user/running → false; persisted + idle/completed/failed/cancelled/archived + no live pages → true; live pages present → false)
- [x] 10.2.4 `episodeKey` / `isDismissedEpisode`: live-exec key precedence, null handling, matching/different keys
- [x] 10.2.5 `computeResizeHeight`: drag up grows, drag down shrinks, clamps at min/max, no delta → unchanged
- [x] 10.2.6 `canSubmitInterview`: disabled even when fully answered while `readyToSubmit = false`; delegates when true

### 10.3 L3 store — `conversation.test.ts` DR additions

- [x] 10.3.1 DR-7: `decision_request_prompt` pushed while stream active (not done) → appended + live pages cleared (drop-guard exemption, D8)
- [x] 10.3.2 DR-8: `setActiveConversation(null)` clears `liveInterviews` + `liveInterviewExecutions` (D8)
- [x] 10.3.3 DR-9: `dismissedInterviews` — dismiss sets episode key per conversation; new episode clears it (D4)

### 10.4 L3 backend — `stream-processor.test.ts` SP-DR suite (terminal flush currently untested)

- [x] 10.4.1 SP-DR-1: current task execution + terminal `decision_request` → prompt persisted, task + execution `waiting_user`, `done` emitted
- [x] 10.4.2 SP-DR-2: superseded task (`tasks.current_execution_id` ≠ execution) → no prompt row, task stays `running`, execution untouched, stream terminates
- [x] 10.4.3 SP-DR-3: session (`taskId null`) with newer execution → flush discarded
- [x] 10.4.4 SP-DR-4: session current → persists + execution `waiting_user`

### 10.5 L3 integration — `shared-rpc-scenarios.ts`

- [x] 10.5.1 Add `runDecisionRequestEarlySubmitScenario(runtime, engine)`: ScriptedEngine turn streams 2 pages → checkpoint → `tasks.submitDecisions` (new execution) → proceed → old turn emits terminal `decision_request` → assert NO prompt after the answer and task NOT flipped to `waiting_user`
- [x] 10.5.2 Wire the scenario into `stream-pipeline-scenarios.test.ts` (S-17, ScriptedEngine caller); `runDecisionStreamingScenario` unchanged

### 10.6 L4 Playwright — `interview-me.spec.ts`

- [x] 10.6.1 T-D5 rewrite: drag UP grows / drag DOWN shrinks / double-click resets
- [x] 10.6.2 T-D6 update: scroll selector `.interview__content` + footer visible while scrolled
- [x] 10.6.3 Seed pending-interview specs (T-A..T-E, T-L..T-Q) with `waitingTask(task.id)` — done via a spec-wide `task` fixture override to `waiting_user`; T-J models running → `waiting_user` via `task.updated` push
- [x] 10.6.4 NEW T-R: stale rule hides panel (`completed`/`idle` + persisted prompt + no live pages)
- [x] 10.6.5 NEW T-S: dismissal persists across drawer reopen; new episode shows panel again
- [x] 10.6.6 NEW T-T: raced data (prompt after answer + task not waiting) hides panel
- [x] 10.6.7 NEW T-U: no `.msg--interview-prompt` balloon in chat (answered + unanswered)
- [x] 10.6.8 NEW T-V: session panel — `waiting_user` session shows panel + gated Submit; `idle` hides it
- [x] 10.6.9 T-K2: prompt push while stream ACTIVE still renders (drop-guard exemption)

> **Fixture implication**: the default Playwright task is `idle`; with the corrected gating + stale rule, every pending-interview spec must seed `executionState: "waiting_user"` (10.6.3).
