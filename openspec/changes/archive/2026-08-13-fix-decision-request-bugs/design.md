## Context

The streaming decision-request change (archived `2026-08-12-streaming-decision-request`) redesigned `decision_request` to a single flat question per call, streamed `decision_request_page` events, and a fixed `DecisionInterviewPanel` above the prompt input. PR #138 ("resizable scrollable interview panel") layered the resize handle on top. Investigation of the three reported bugs found:

- **Resize inversion**: `DecisionInterviewPanel.vue` `onResizeStart` computes `startHeight + delta` — dragging DOWN grows the panel. The grip sits on the panel's TOP edge and the panel's bottom is fixed in the drawer flow (chat above, files/todo + input below), so the natural mapping is drag UP → grow, drag DOWN → shrink. Playwright T-D5 codifies the wrong direction.
- **Answered interview reappears**: `DecisionRequest.vue` gates Submit purely on answer completeness (`canSubmitDecisionRequest`); the D9 `waiting_user` gate was never implemented. Submitting while the model is still streaming starts a new execution and persists the user message (id=N) BEFORE the old execution's turn-end flush persists the terminal `decision_request_prompt` (id=N+1). The panel's `answeredText` only looks for a user message AFTER the latest prompt, so it never matches; the panel also flips the task back to `waiting_user`. Secondary contributors: `liveInterviews`/`liveInterviewExecutions` are never cleared on conversation close, and the frontend `onNewMessage` guard (`streamState && !streamState.isDone && type !== "user"`) can drop the terminal prompt push, skipping the live→persisted reconcile.
- **In-chat balloon**: `MessageBubble.vue` renders `decision_request_prompt` as an assistant balloon — answered → "Interview answered" + the next user message's Q/A content; unanswered → "An interview is waiting for your input above the message box."
- **Footer scroll**: `DecisionInterviewPanel.vue` body is a single scroll container (`overflow-y: auto`), so the footer inside `DecisionRequest.vue` scrolls away on tall content.

## Goals / Non-Goals

**Goals:**
- Resize handle feels natural: drag up grows, drag down shrinks, double-click resets
- An answered interview never reappears — same session, drawer reopen, reload, or raced/legacy data
- No decision-request balloon in the chat stream (single surface = the panel)
- Back/Next/Submit footer always visible; only question content scrolls
- Server-side invariant: a terminal `decision_request_prompt` is never persisted after the user's answer to that interview, and a superseded execution never flips the task back to `waiting_user`
- Keep panel logic thin and pure/testable (mirrors the existing `utils/decisionRequest.ts` pattern)

**Non-Goals:**
- No DB schema or RPC type changes (`DecisionRequestPayload`/`DecisionRequestQuestion` unchanged)
- No change to the streaming single-question tool contract (buffer, `page` result, turn-end flush)
- No auto-fill/defaulting of answers or weights
- No changes to `ask_user` / shell-approval flows (separate UI in `MessageBubble.vue`)
- No persistence of dismissal state to the DB (ephemeral UX state)
- Testing is tracked in `tasks.md` but executed later per user directive

## Decisions

### D1 — Flip the resize direction
`DecisionInterviewPanel.vue` `onMove`: `next = startHeight - delta`. Drag up (`delta < 0`) → panel grows (capped at 70% of viewport); drag down → shrinks (floored at `MIN_PANEL_HEIGHT`). Double-click resets to `DEFAULT_PANEL_HEIGHT`. Update the misleading comment and T-D5 (drag up to enlarge).

### D2 — Submit gated on `waiting_user` via execution-state prop
`DecisionInterviewPanel` gains `executionState: string | null`, passed from `TaskChatView` (`task.executionState`) and `SessionChatView` (`session.status`). It forwards `readyToSubmit = executionState === "waiting_user"` to `DecisionRequest`, where `canSubmit = readyToSubmit && canSubmitDecisionRequest(...)`. `Next` on non-last pages stays ungated. This implements the D9 design from the streaming change and closes the early-submit ordering race at its source; the panel also uses `executionState` for the stale rule (D3).

### D3 — Robust answered/stale detection (pure helpers)
New `src/mainview/utils/decisionInterview.ts` exports:
- `latestPromptId(messages, conversationId): number | null`
- `hasUserMessageAfterPrompt(messages, conversationId, promptId): boolean` — id-based, not array-index-based
- `isInterviewStale(executionState, hasLivePages, hasPersistedPrompt): boolean` — persisted prompt exists, executionState not in `{waiting_user, running}`, and no live pages
- `episodeKey(liveExecutionId, latestPromptId): string | null`
- `isDismissedEpisode(storedKey, currentKey): boolean`

`showPanel = questions.length > 0 && !dismissedEpisode && !(answered || stale)`. The stale rule alone fixes the reported bug even for already-raced data; the gate (D2) prevents new races. The panel component only wires store + props (D9).

### D4 — Per-episode dismissal persisted in the conversation store
Add `conversationStore.dismissedInterviews: Map<number, string>` (conversationId → episode key). The panel reads/writes this map instead of component-local refs, so dismissal survives drawer reopen/remount. A new episode (different live execution id or a new latest prompt id) clears the entry so the panel can spawn again. Not persisted to the DB.

### D5 — Remove the in-chat balloon entirely
Delete the `decision_request_prompt` template branch, the `interviewAnsweredText` computed, and the `msg--interview-prompt` / `interview__answered*` / `interview__legacy-hint` styles from `MessageBubble.vue`. The message remains persisted and reachable via the panel and history API. (User decision: no trace in chat — overrides the earlier "legacy may render" clause.)

### D6 — Fixed footer; scroll only question content
`DecisionRequest.vue` restructures `.interview` into a flex column (`height: 100%; box-sizing: border-box; overflow: hidden`):
- `.interview__content` (context preamble, question section, general notes) is the single scroll container (`flex: 1; min-height: 0; overflow-y: auto`)
- `.interview__footer` (Back / counter / Record toggle / Next|Submit) sits outside the scroll region (`flex-shrink: 0`)

`DecisionInterviewPanel.vue` body becomes `overflow: hidden`. T-D6 targets the new `.interview__content` container.

### D7 — Backend superseded-flush guard
In `stream-processor.ts` `case "decision_request"`, before persisting the prompt and flipping state:
- task-backed (`taskId != null`): `SELECT current_execution_id FROM tasks WHERE id = ?` — proceed only when it equals this `executionId`
- chat session: `SELECT 1 FROM executions WHERE conversation_id = ? AND id > ? LIMIT 1` — proceed only when no newer execution exists

When superseded, skip both the `decision_request_prompt` persist and the `waiting_user`/execution-status change, logging a debug line. This keeps the invariant server-side even if a client bypasses the gate (D2). Verified: `chat-executor.ts` always creates a new execution per chat turn (no resume), so "newer execution exists" is a reliable supersede signal; task resume reuses the same execution id, so the `current_execution_id` check is safe for the normal answer flow.

### D8 — Store hygiene for live interview state
- `setActiveConversation(null)` clears `liveInterviews` and `liveInterviewExecutions` for the closed conversation (stale pages cannot resurface on drawer reopen).
- The `onNewMessage` append guard exempts `decision_request_prompt` from the "stream not done" drop: it is a terminal persisted message with no live-block equivalent, and dropping it skipped the live→persisted reconcile (`liveInterviews.delete`).

### D9 — Pure, testable panel state
All panel derivation lives in `utils/decisionInterview.ts`; the component only wires store + props. Mirrors the existing `utils/decisionRequest.ts` pattern — no Vue harness needed for unit tests (SOLID/DI-friendly, avoids a god component).### D9 — Pure, testable panel state
All panel derivation lives in `utils/decisionInterview.ts`; the component only wires store + props. Mirrors the existing `utils/decisionRequest.ts` pattern — no Vue harness needed for unit tests (SOLID/DI-friendly, avoids a god component).

### D10 — Soft `submitDecisions` policy (no backend rejection)
`tasks.submitDecisions` / `chatSessions.submitDecisions` SHALL remain callable at any time. The frontend gate (D2) prevents UI early-submits; if a client still submits while not `waiting_user`, `HumanTurnExecutor` starts a NEW execution that processes the answers as a fresh turn, and the D7 guard discards the superseded execution's turn-end flush. No new error surface; stale clients/races degrade gracefully instead of surfacing rejections. (User decision.)

## Risks / Trade-offs

- **Submit gating adds a small wait** at turn end before Submit enables; this is the originally designed UX, and users can still fill answers live while pages stream.
- **Removing the balloon loses the in-chat breadcrumb** for old interviews; the panel is the single surface (explicit user decision).
- **Dismissal persistence is in-memory** and lost on full app reload — acceptable for ephemeral UX state.
- **Stale rule may hide an unanswered interview** if the task was transitioned/moved while `waiting_user` (execution no longer waiting, no live pages) — accepted edge case; the user has moved on, and the panel is the interaction surface.
- **Superseded-flush guard changes server behavior** only in the race window; the normal flow (prompt → answer → resume) is untouched.- **Superseded-flush guard changes server behavior** only in the race window; the normal flow (prompt → answer → resume) is untouched.

## Testing Strategy

Aligned test scenarios across the project's four existing layers, driven through the existing DI seams (constructor-injected `db` + scripted engines on the backend, `vi.mock("../rpc")` for store tests, `/api` + `/ws` mocks for Playwright) — no test-only production branches.

### T1 — L1 unit (pure functions, zero IO)

- **`utils/decisionInterview.test.ts`** (new):
  - `latestPromptId`: none / single / multiple (last wins) / other-conversation filtered
  - `hasUserMessageAfterPrompt`: user after (true), user before (false), no user (false), other conversation (false)
  - `isInterviewStale`: full truth table — persisted + `{waiting_user, running}` → false; persisted + `{idle, completed, failed, cancelled, archived}` + no live pages → true; live pages present → false
  - `episodeKey` / `isDismissedEpisode`: live-exec key wins over prompt key; null handling; matching/different keys
- **`computeResizeHeight`** (extracted from `onMove` per R2): drag up (delta < 0) grows, drag down (delta > 0) shrinks, clamps at min/max, no delta → unchanged
- **`canSubmitInterview`** (R3, in `utils/decisionRequest.ts`): `readyToSubmit = false` → false even when fully answered; `true` → delegates to `canSubmitDecisionRequest`

### T2 — L3 store (in-memory, mocked `../rpc`)

`conversation.test.ts` additions to the DR suite:
- **DR-7**: `decision_request_prompt` pushed while stream active (not done) → APPENDED (D8 drop-guard exemption) + live pages cleared (reconcile runs)
- **DR-8**: `setActiveConversation(null)` clears `liveInterviews` + `liveInterviewExecutions` for the closed conversation
- **DR-9**: `dismissedInterviews` accessors — dismiss sets episode key per conversation; new episode clears it

### T3 — L3 backend (in-memory DB + scripted engines)

`stream-processor.test.ts` (engine) SP-DR suite — the terminal-flush case is currently untested:
- **SP-DR-1**: current task execution + terminal `decision_request` → prompt persisted, task + execution `waiting_user`, `done` emitted (happy path)
- **SP-DR-2**: superseded task (`tasks.current_execution_id` ≠ execution) → no prompt row, task stays `running`, execution status untouched, stream still terminates
- **SP-DR-3**: session (`taskId null`) with a newer execution for the conversation → flush discarded
- **SP-DR-4**: session current → persists + execution `waiting_user`

`shared-rpc-scenarios.ts`:
- **`runDecisionRequestEarlySubmitScenario`** (new): ScriptedEngine turn streams 2 `decision_request_page` → checkpoint → test calls `tasks.submitDecisions` (new execution starts) → proceed → old turn emits terminal `decision_request` → assert NO `decision_request_prompt` after the answer message and task NOT flipped to `waiting_user` (D7 + D10 end-to-end through the real Orchestrator)
- `runDecisionStreamingScenario` unchanged (happy path still valid)

### T4 — L4 Playwright (`interview-me.spec.ts`)

- **T-D5 rewrite**: drag UP → grows; drag DOWN → shrinks; double-click resets (both directions asserted)
- **T-D6 update**: scroll selector → `.interview__content`; add footer-visible-while-scrolled assertion (fixed footer)
- **Gating fixture impact**: T-A..T-E, T-L..T-Q seed the task as `waiting_user` (R5 helper); T-J models running → `waiting_user` transition via `task.updated` push
- **NEW T-R**: persisted prompt + `completed`/`idle` task + no live pages → panel absent (stale rule)
- **NEW T-S**: dismiss → close drawer → reopen → panel still hidden; new episode → visible (per-episode dismissal)
- **NEW T-T**: raced data — prompt persisted AFTER the answer message + task not waiting → panel absent (robust detection)
- **NEW T-U**: balloon removal — answered and unanswered cases show no `.msg--interview-prompt` in chat
- **NEW T-V** (session): `makeChatSession({ status: "waiting_user" })` + prompt → panel visible, Submit gated by status; `completed` → hidden
- **T-K addition**: prompt push while stream ACTIVE → still rendered (Playwright-level proof of the D8 exemption)

### T5 — Refactorings that enable the coverage (no behavior change beyond the fix)

- **R1** `utils/decisionInterview.ts` — pure panel state (D9)
- **R2** `computeResizeHeight` extraction — L1 direction regression test
- **R3** `canSubmitInterview` in `utils/decisionRequest.ts` — L1 gating test
- **R4** store `dismissedInterviews` accessors — store tests via mocked `api`
- **R5** Playwright `waitingTask(id)` helper — removes per-test task-override duplication
